/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, brackets, window, $, Mustache, navigator */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var ProjectManager              = brackets.getModule("project/ProjectManager"),
        PreferencesManager          = brackets.getModule("preferences/PreferencesManager"),
        Commands                    = brackets.getModule("command/Commands"),
        CommandManager              = brackets.getModule("command/CommandManager"),
        ExtensionUtils              = brackets.getModule("utils/ExtensionUtils"),
        Strings                     = brackets.getModule("strings"),
        StringUtils                 = brackets.getModule("utils/StringUtils"),
        Menus                       = brackets.getModule("command/Menus"),
        FileUtils                   = brackets.getModule("file/FileUtils"),
        DefaultDialogs              = brackets.getModule("widgets/DefaultDialogs"),
        Dialogs                     = brackets.getModule("widgets/Dialogs"),
        FileSystem                  = brackets.getModule("filesystem/FileSystem"),
        ExtensionStrings            = require("strings"),
        NewProjectDialogTemplate    = require("text!htmlContent/New-Project-Dialog.html");
    
    var MODULE_NAME                     = "BracketsNewProjectExtension";
    
    
    /** @const {string} New Project command ID */
    var FILE_NEW_PROJECT                = "file.newProject";
    
    var COPY_TEMPLATE_FILES_FAILED      = -9000,
        CREATE_PARENT_DIRECTORY_ERROR   = -9001;
    
    var STATUS_SUCCEEDED                = 1,
        STATUS_FAILED                   = 0;
    
    /** @const {string} Template Config File Name */
    var TEMPLATE_CONFIG_FILENAME        = "template.json",
        TARGET_INITIAL_FILENAME         = "index.html",
        USER_TEMPLATE_FOLDERNAME        = "BracketsProjectTemplates";
    
    var _id                             = 0;
    
    var _illegalFilenamesRegEx = /^(\.+|com[1-9]|lpt[1-9]|nul|con|prn|aux)$/i;
    
    var _module = module;
    
    var _documentsDir = brackets.app.getUserDocumentsDirectory();
    
    var _prefs = PreferencesManager.getExtensionPrefs(MODULE_NAME);

    function convertUnixPathToWindowsPath(path) {
        if (brackets.platform === "win") {
            path = path.replace(new RegExp(/\//g), "\\");
        }
        return path;
    }
    
    function convertWindowsPathToUnixPath(path) {
        return FileUtils.convertWindowsPathToUnixPath(path);
    }
    
    function cannonicalizeDirectoryPath(path) {
        if (path && path.length) {
            var lastChar = path[path.length - 1];
            if (lastChar !== "/") {
                path += "/";
            }
        }
        return path;
    }
    
    function getParentDirectory(path) {
        if (path && path.length) {
            var lastChar = path[path.length - 1];
            if (lastChar !== "/") {
                path = FileUtils.getDirectoryPath(path);
            } else {
                path = FileUtils.getDirectoryPath(path.slice(0, -1));
            }
        }
        return path;
    }
    
    function getFilenameFromPath(path) {
        return FileUtils.getBaseName(path);
    }
    
    function getTemplateFilesFolder() {
        return FileUtils.getNativeModuleDirectoryPath(_module) + "/templateFiles";
    }
    
    function getUserTemplateFilesFolder() {
        return _prefs.get("userTemplatesFolder");
    }
    
    function showProjectErrorMessage(err, folder) {
        var message;
        if (err === COPY_TEMPLATE_FILES_FAILED) {
            message = ExtensionStrings.ONE_OR_MORE_TEMPLATE_FILES_FAILED;
        } else if (err === CREATE_PARENT_DIRECTORY_ERROR) {
            message = ExtensionStrings.ERROR_NOT_A_DIRECTORY;
        } else if (err === brackets.fs.ERR_FILE_EXISTS) {
            message = ExtensionStrings.ERROR_DIRECTORY_ALREADY_EXISTS;
        } else {
            message = ExtensionStrings.ERROR_UNABLE_TO_WRITE_DIRECTORY;
        }
        
        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_ERROR,
            ExtensionStrings.DIALOG_TITLE,
            StringUtils.format(message, err, convertUnixPathToWindowsPath(folder))
        );
    }
    
    function validateProjectName(projectName) {
        // Validate file name
        // Checks for valid Windows filenames:
        // See http://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx
        if ((projectName.search(/[\/?*:;\{\}<>\\|]+/) !== -1) || projectName.match(_illegalFilenamesRegEx)) {
            Dialogs.showModalDialog(
                DefaultDialogs.DIALOG_ID_ERROR,
                ExtensionStrings.INVALID_PROJECT_NAME,
                ExtensionStrings.INVALID_PROJECT_NAME_MESSAGE
            );
            return false;
        }
        return true;
    }
    
    function copyFile(destination, inFile) {
        var promise = new $.Deferred(),
            outFile = cannonicalizeDirectoryPath(destination) + getFilenameFromPath(inFile);
        brackets.fs.stat(outFile, function (err, stats) {
            if (err === brackets.fs.ERR_NOT_FOUND) {
                brackets.fs.copyFile(inFile, outFile, function (err) {
                    if (err === brackets.fs.NO_ERROR) {
                        promise.resolve();
                    } else {
                        // unable to write file
                        promise.reject(err);
                    }
                });
            } else if (err === brackets.fs.NO_ERROR) {
                if (stats.isDirectory()) {
                    promise.reject(brackets.fs.ERR_CANT_WRITE);
                } else {
                    promise.reject(brackets.fs.ERR_FILE_EXISTS);
                }
            } else {
                promise.reject(err);
            }
        });
    
        return promise;
    }


    function copyDirectory(destination, source) {
        var i,
            completeCount = 0,
            errorCount = 0,
            promise = new $.Deferred();
        
        if (!source || !destination) {
            return promise.resolve(0);
        }
            
        brackets.fs.readdir(source, function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
                // exclude the template config file
                var newProjectConfigFileIndex = fileList.indexOf(TEMPLATE_CONFIG_FILENAME);
                if (newProjectConfigFileIndex >= 0) {
                    fileList = fileList.slice(0, newProjectConfigFileIndex).concat(fileList.slice(newProjectConfigFileIndex, -1));
                }
                var failHandler = function () {
                    ++errorCount;
                };
                var alwaysHandler = function () {
                    if (++completeCount === fileList.length) {
                        promise.resolve(errorCount);
                    }
                };
                
                var doCopy = function (destination, source) {
                    brackets.fs.stat(source, function (err, stats) {
                        if (stats.isFile()) {
                            copyFile(destination, source)
                                .fail(failHandler)
                                .always(alwaysHandler);
                        } else if (stats.isDirectory()) {
                            destination = cannonicalizeDirectoryPath(destination) + getFilenameFromPath(source);
                            brackets.fs.makedir(destination, 777, function (err) {
                                if (err === brackets.fs.NO_ERROR) {
                                    copyDirectory(destination, source)
                                        .fail(failHandler)
                                        .always(alwaysHandler);
                                } else {
                                    ++errorCount;
                                }
                            });
                        }
                    });
                };
                
                for (i = 0; i < fileList.length; i++) {
                    doCopy(destination, cannonicalizeDirectoryPath(source) + fileList[i]);
                }

                // avoid race condition on empty folder                
                if (fileList.length === 0) {
                    promise.resolve(0);
                }
                
            } else if (err === brackets.fs.ERR_NOT_FOUND) {
                // No template folder is ok. Nothing to copy..
                promise.resolve(0);
            } else {
                promise.reject(err);
            }
        });
        
        return promise;
    }
    
    function copyTemplateFiles(destination, templateDetails) {
        return copyDirectory(destination, templateDetails.dir);
    }

    function createProjectFolder(projectFolder, templateDetails) {
        var promise = new $.Deferred();
        brackets.fs.makedir(projectFolder, 777, function (err) {
            if (err === brackets.fs.NO_ERROR) {
                copyTemplateFiles(projectFolder, templateDetails)
                    .done(function (errorCount) {
                        if (errorCount && errorCount > 0) {
                            showProjectErrorMessage(COPY_TEMPLATE_FILES_FAILED, projectFolder);
                            promise.reject();
                        } else {
                            promise.resolve();
                        }
                    })
                    .fail(function (err) {
                        showProjectErrorMessage(err, projectFolder);
                        promise.reject(err);
                    });
                
            } else {
                showProjectErrorMessage(err, projectFolder);
                promise.reject(err);
            }
        });
        return promise;
    }
    
    
    function createNewProject(projectFolder, templateDetails, opts) {
        var parentFolder = getParentDirectory(projectFolder),
            promise = new $.Deferred();
        
        brackets.fs.stat(parentFolder, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isDirectory()) {
                createProjectFolder(projectFolder, templateDetails)
                    .done(function () {
                        promise.resolve();
                    })
                    .fail(function () {
                        promise.reject();
                    });
            } else {
                showProjectErrorMessage(CREATE_PARENT_DIRECTORY_ERROR, parentFolder);
                promise.reject();
            }
        });
        return promise;
    }
    
    function doOpenProjectFile(destination, filename, opts) {
        var fullpath = cannonicalizeDirectoryPath(destination) + filename;
        brackets.fs.stat(fullpath, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isFile()) {
                CommandManager.execute(Commands.FILE_ADD_TO_WORKING_SET, { fullPath: fullpath });
            }
        });
    }
    
    function openStarterFile(destination, opts) {
        if (opts.hasOwnProperty("starterFilename")) {
            doOpenProjectFile(destination, opts.starterFilename, opts);
        } else {
            doOpenProjectFile(destination, TARGET_INITIAL_FILENAME, opts);
        }
    }
    
    function addTemplateFromDirectoryEntry($templateSelect, templateFolder, templateName) {
        var sourceFolder = cannonicalizeDirectoryPath(templateFolder) + templateName;
        var addTemplateDirectory = function (err, stats) {
            if (stats.isDirectory()) {
                $templateSelect.append("<option id=\"Template_" + (_id++).toString() + "\" source=\"" + sourceFolder + "\">" + templateName + "</option>");
            }
        };
        brackets.fs.stat(sourceFolder, addTemplateDirectory);
    }
    
    function initProjectTemplatesFromFolder($templateSelect, templateFolder) {
        var i,
            result = $.Deferred();
        
        brackets.fs.readdir(templateFolder, function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
                
                for (i = 0; i < fileList.length; i++) {
                    addTemplateFromDirectoryEntry($templateSelect, templateFolder, fileList[i]);
                }
            }
            
            result.resolve();
        });
        
        return result;
    }
    
    function initProjectTemplates($templateSelect) {
        var result = $.Deferred();
        initProjectTemplatesFromFolder($templateSelect, getTemplateFilesFolder())
            .always(function () {
                initProjectTemplatesFromFolder($templateSelect, getUserTemplateFilesFolder())
                    .always(function () {
                        result.resolve();
                    });
            });
        
        return result;
    }
    
    function getProjectTemplateOptions(templateDetails) {
        var opts = {},
            result = new $.Deferred(),
            templateConfigFilename = cannonicalizeDirectoryPath(templateDetails.dir) + TEMPLATE_CONFIG_FILENAME;
    
        brackets.fs.stat(templateConfigFilename, function (err) {
            if (err !== brackets.fs.NO_ERROR) {
                result.resolve(opts);
            } else {
                brackets.fs.readFile(templateConfigFilename, "utf8", function (err, data) {
                    if (err === brackets.fs.NO_ERROR) {
                        opts = $.extend({}, opts, JSON.parse(data));
                    }
                    result.resolve(opts);
                });
            }
        });
        
        return result;
    }
    
    function _makeid() {
        var i,
            id = "",
            possible = "0123456789";

        for (i = 0; i < 5; i++) {
            id += possible.charAt(Math.floor(Math.random() * possible.length));
        }

        return id;
    }
    
    function getNewProjectName(folder, startingOrdinal, depth) {
        var result = new $.Deferred(),
            projectFolder = convertUnixPathToWindowsPath(folder),
            projectName = ExtensionStrings.NEW_PROJECT_BASE_NAME + startingOrdinal.toString(),
            destination = cannonicalizeDirectoryPath(projectFolder) + projectName;
       
        brackets.fs.stat(destination, function (err) {
            if (err === brackets.fs.ERR_NOT_FOUND) {
                result.resolve({status: STATUS_SUCCEEDED,
                                newProjectName: projectName,
                                ordinal: startingOrdinal});
            } else if (err !== brackets.fs.NO_ERROR) {
                // Unknown File system error so just give up and try a random numbered project
                startingOrdinal = _makeid();
                result.resolve({status: STATUS_FAILED,
                                reason: "unknown-error",
                                newProjectName: ExtensionStrings.NEW_PROJECT_BASE_NAME + startingOrdinal,
                                ordinal: startingOrdinal});
            } else if (depth && depth > 100) {
                // Depth 
                startingOrdinal = _makeid();
                result.resolve({status: STATUS_FAILED,
                                reason: "max-try-limit-hit",
                                newProjectName: ExtensionStrings.NEW_PROJECT_BASE_NAME + startingOrdinal,
                                ordinal: startingOrdinal});
            } else {
                getNewProjectName(folder, startingOrdinal + 1, depth ? depth + 1 : 1).done(function (data) {
                    result.resolve(data);
                });
            }
        });
        
        return result;
    }
    
    function handleNewProject(commandData) {
        var $dlg,
            $OkBtn,
            $changeProjectDirectoryBtn,
            $projectDirectoryInput,
            $projectNameInput,
            $templateSelect,
            newProjectOrdinal = _prefs.get("newProjectOrdinal") || 1,
            newProjectFolder = _prefs.get("newProjectsFolder") || _documentsDir;


        getNewProjectName(newProjectFolder, newProjectOrdinal).done(function (data) {
        
            var defaultProjectName = data.newProjectName;

            var context = {
                Strings: Strings,
                ExtensionStrings: ExtensionStrings,
                PROJECT_DIRECTORY: convertUnixPathToWindowsPath(newProjectFolder),
                NEXT_NEW_PROJECT_NAME: defaultProjectName
            };

            var getSelectedTemplateDetails = function () {
                var index = $templateSelect[0].selectedIndex,
                    $el = $templateSelect.children("option").eq(index),
                    templateDir = $el ? $el.attr("source") || "" : "",
                    templateName = ($el && $el.length === 1) ? $el[0].innerText || "" : "";
                return { name: templateName, dir: templateDir };
            };
            
            var dialog = Dialogs.showModalDialogUsingTemplate(Mustache.render(NewProjectDialogTemplate, context));

            dialog.done(function (buttonId) {
                if (buttonId === "ok") {
                    var projectFolder = convertWindowsPathToUnixPath($projectDirectoryInput.val()),
                        projectName = $projectNameInput.val(),
                        destination = cannonicalizeDirectoryPath(projectFolder) + ((projectName.length > 0) ? projectName : defaultProjectName),
                        templateDetails = getSelectedTemplateDetails();
                    
                    getProjectTemplateOptions(templateDetails).done(function (opts) {
                        createNewProject(destination, templateDetails, opts).done(function () {
                            ProjectManager.openProject(destination).done(function () {
                                openStarterFile(destination, opts);
                            });
                            if (projectName === defaultProjectName && data.status === STATUS_SUCCEEDED) {
                                _prefs.set("newProjectOrdinal", ++data.ordinal);
                            }
                        });
                    });
                }
            });

            $dlg = dialog.getElement();
            $OkBtn = $dlg.find(".dialog-button[data-button-id='ok']");
            $changeProjectDirectoryBtn = $("#change-directory", $dlg);
            $projectDirectoryInput = $("#project-directory", $dlg);
            $projectNameInput = $("#project-name", $dlg);
            $templateSelect = $("#project-template", $dlg);

            $changeProjectDirectoryBtn.click(function (e) {
                FileSystem.showOpenDialog(false, true, Strings.CHOOSE_FOLDER, newProjectFolder, null,
                    function (error, files) {
                        if (!error && files && files.length > 0 && files[0].length > 0) {
                            newProjectFolder = files[0];
                            $projectDirectoryInput.val(convertUnixPathToWindowsPath(newProjectFolder));
                            _prefs.set("newProjectsFolder", newProjectFolder);
                        }
                    });

                e.preventDefault();
                e.stopPropagation();
            });

            $OkBtn.click(function (e) {
                if (!validateProjectName($projectNameInput.val())) {
                    e.preventDefault();
                    e.stopPropagation();
                }

            });

            initProjectTemplates($templateSelect);
        });
        
    }

    function getDefaultTemplateFolder() {
        return cannonicalizeDirectoryPath(_documentsDir) + USER_TEMPLATE_FOLDERNAME;
    }
    
    _prefs.definePreference("newProjectsFolder", "string", "");
    _prefs.definePreference("userTemplatesFolder", "string", getDefaultTemplateFolder());
    _prefs.definePreference("newProjectOrdinal", "number", 1);
    
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    
    CommandManager.register(ExtensionStrings.MENU_TITLE, FILE_NEW_PROJECT, handleNewProject);
    var menu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
    menu.addMenuItem(FILE_NEW_PROJECT, undefined, Menus.AFTER, Commands.FILE_NEW_UNTITLED);
});
