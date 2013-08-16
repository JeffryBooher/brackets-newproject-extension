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
        NativeFileSystem            = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        ExtensionStrings            = require("strings"),
        NewProjectDialogTemplate    = require("text!htmlContent/New-Project-Dialog.html");
    

    /** @const {string} New Project command ID */
    var FILE_NEW_PROJECT                = "file.newProject";
    
    var COPY_TEMPLATE_FILES_FAILED      = -9000,
        CREATE_PARENT_DIRECTORY_ERROR   = -9001;
    
    /** @const {string} Template Config File Name */
    var TEMPLATE_CONFIG_FILENAME        = "template.json",
        TARGET_INITIAL_FILENAME         = "index.html";
    
    var prefs = PreferencesManager.getPreferenceStorage(module);

    var _illegalFilenamesRegEx = /^(\.+|com[1-9]|lpt[1-9]|nul|con|prn|aux)$/i;
    
    var _module = module;
    
    var _documentsDir;

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
    
    function showProjectErrorMessage(err, folder) {
        var message;
        if (err === COPY_TEMPLATE_FILES_FAILED) {
            message = ExtensionStrings.ONE_OR_MORE_TEMPLATE_FILES_FAILED;
        } else if (err === CREATE_PARENT_DIRECTORY_ERROR) {
            message = ExtensionStrings.ERROR_NOT_A_DIRECTORY;
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
            } else {
                // unable to read file
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
            
        brackets.fs.readdir(source, function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
                // exclude the template config file
                var newProjectConfigFileIndex = fileList.indexOf(TEMPLATE_CONFIG_FILENAME);
                if (newProjectConfigFileIndex >= 0) {
                    fileList = fileList.slice(0, newProjectConfigFileIndex - 1).concat(fileList.slice(newProjectConfigFileIndex, -1));
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
    
    function computeTemplateFolderLocation(templateName) {
        return cannonicalizeDirectoryPath(getTemplateFilesFolder()) + templateName;
    }
    
    function copyTemplateFiles(destination, templateName) {
        return copyDirectory(destination, computeTemplateFolderLocation(templateName));
    }

    function createProjectFolder(projectFolder, templateName) {
        var promise = new $.Deferred();
        brackets.fs.makedir(projectFolder, 777, function (err) {
            if (err === brackets.fs.NO_ERROR) {
                copyTemplateFiles(projectFolder, templateName)
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
    
    
    function createNewProject(projectFolder, templateName, opts) {
        var parentFolder = getParentDirectory(projectFolder),
            promise = new $.Deferred();
        
        brackets.fs.stat(parentFolder, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isDirectory()) {
                createProjectFolder(projectFolder, templateName)
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
    
    function addTemplateFromDirectoryEntry($templateSelect, directoryName) {
        var templatesFilesFolder = getTemplateFilesFolder();
        
        var addTemplateDirectory = function (err, stats) {
            if (stats.isDirectory()) {
                $templateSelect.append("<option id=\"" + directoryName + "\">" + directoryName + "</option>");
            }
        };
        brackets.fs.stat(cannonicalizeDirectoryPath(templatesFilesFolder) + directoryName, addTemplateDirectory);
    }
    
    function initProjectTemplates($templateSelect) {
        var i,
            templatesFilesFolder = getTemplateFilesFolder();
        brackets.fs.readdir(templatesFilesFolder, function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
                
                for (i = 0; i < fileList.length; i++) {
                    addTemplateFromDirectoryEntry($templateSelect, fileList[i]);
                }
            }
        });
    }
    
    function getProjectTemplateOptions(templateName) {
        var opts = {},
            result = new $.Deferred(),
            templateFolder = computeTemplateFolderLocation(templateName),
            templateConfigFilename = cannonicalizeDirectoryPath(templateFolder) + TEMPLATE_CONFIG_FILENAME;
    
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
    
    function handleNewProject(commandData) {
        var $dlg,
            $OkBtn,
            $changeProjectDirectoryBtn,
            $projectDirectoryInput,
            $projectNameInput,
            $templateSelect,
            newProjectOrdinal = prefs.getValue("newProjectOrdinal") || 1,
            defaultProjectName = ExtensionStrings.NEW_PROJECT_BASE_NAME +  newProjectOrdinal.toString(),
            prefsNewProjectFolder = prefs.getValue("newProjectsFolder"),
            newProjectFolder = _documentsDir;
        
        var context = {
            Strings: Strings,
            ExtensionStrings: ExtensionStrings,
            PROJECT_DIRECTORY: convertUnixPathToWindowsPath(prefsNewProjectFolder || newProjectFolder),
            NEXT_NEW_PROJECT_NAME: defaultProjectName
        };
        
        var dialog = Dialogs.showModalDialogUsingTemplate(Mustache.render(NewProjectDialogTemplate, context));
        
        dialog.done(function (buttonId) {
            if (buttonId === "ok") {
                var projectFolder = convertWindowsPathToUnixPath($projectDirectoryInput.val()),
                    projectName = $projectNameInput.val(),
                    destination = cannonicalizeDirectoryPath(projectFolder) + ((projectName.length > 0) ? projectName : defaultProjectName),
                    templateName = $templateSelect.val();
                
                
                getProjectTemplateOptions(templateName).done(function (opts) {
                    createNewProject(destination, templateName, opts).done(function () {
                        ProjectManager.openProject(destination).done(function () {
                            openStarterFile(destination, opts);
                        });
                        prefs.setValue("newProjectOrdinal", ++newProjectOrdinal);
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
            NativeFileSystem.showOpenDialog(false, true, Strings.CHOOSE_FOLDER, newProjectFolder, null,
                function (files) {
                    if (files.length > 0 && files[0].length > 0) {
                        newProjectFolder = files[0];
                        $projectDirectoryInput.val(convertUnixPathToWindowsPath(newProjectFolder));
                        prefs.setValue("newProjectsFolder", newProjectFolder);
                    }
                },
                function (error) {
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
    }

    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    
    brackets.fs.getDocumentsDir(function (err, documentsDir) {
        _documentsDir = documentsDir;
    
        CommandManager.register(ExtensionStrings.MENU_TITLE, FILE_NEW_PROJECT, handleNewProject);
        var menu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
        menu.addMenuItem(FILE_NEW_PROJECT, undefined, Menus.AFTER, Commands.FILE_NEW_UNTITLED);
    });
    
});
