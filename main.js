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
        AppInit                     = brackets.getModule("utils/AppInit"),
        Strings                     = brackets.getModule("strings"),
        StringUtils                 = brackets.getModule("utils/StringUtils"),
        SidebarView                 = brackets.getModule("project/SidebarView"),
        Menus                       = brackets.getModule("command/Menus"),
        PopUpManager                = brackets.getModule("widgets/PopUpManager"),
        FileUtils                   = brackets.getModule("file/FileUtils"),
        DefaultDialogs              = brackets.getModule("widgets/DefaultDialogs"),
        Dialogs                     = brackets.getModule("widgets/Dialogs"),
        NativeFileSystem            = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        ExtensionStrings            = require("strings"),
        NewProjectDialogTemplate    = require("text!htmlContent/New-Project-Dialog.html");
    

    /** @const {string} New Project command ID */
    var FILE_NEW_PROJECT            = "file.newProject";
        
    var prefs = PreferencesManager.getPreferenceStorage(module);

    var _illegalFilenamesRegEx = /^(\.+|com[1-9]|lpt[1-9]|nul|con|prn|aux)$/i;

    
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
    
    function isLegacyWindowsVersion() {
        return (navigator.userAgent.indexOf("Winodws NT 5.") !== -1);
    }
    
    function getUserHomeDirectory() {
        var parts = 4,
            folder = brackets.app.getApplicationSupportDirectory();
        
        if (brackets.platform === "win") {
            parts = 3;
        }
        return folder.split("/").slice(0, parts).join("/");
        
    }

    function getTemplateFilesFolder() {
        return brackets.app.getApplicationSupportDirectory() + "/extensions/user/newproject/templateFiles";
    }
    
    function getUserDocumentsFolder() {
        // TODO: Move this to the shell
        var home = getUserHomeDirectory(),
            documents;
        
        if (isLegacyWindowsVersion()) {
            documents = home + "/" + ExtensionStrings.MY_DOCUMENTS;
        } else {
            documents = home + "/" + ExtensionStrings.DOCUMENTS;
        }
        
        return documents;
    }

    function showProjectErrorMessage(err, folder, isDirectory) {
        var message;
        if (err === brackets.fs.NO_ERROR && !isDirectory) {
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
                ExtensionStrings.INVALID_PROJECGT_NAME_MESSAGE
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
                brackets.fs.readFile(inFile, "utf8", function (err, data) {
                    brackets.fs.writeFile(outFile, data, "utf8", function (err) {
                        promise.resolve(err);
                    });
                });
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
            
        brackets.fs.readdir(source, function (err, fileList) {
            if (err === brackets.fs.NO_ERROR) {
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
            } else if (err === brackets.fs.ERR_NOT_FOUND){
                // No Template Folder? No Problem... Nothing to copy!
                promise.resolve();
            } else {
                promise.reject(err);
            }
        });
        
        return promise;
    }
    
    function copyTemplateFiles(destination, templateName) {
        var templatesFilesFolder = cannonicalizeDirectoryPath(getTemplateFilesFolder()) + templateName;
        return copyDirectory(destination, templatesFilesFolder);
    }

    function createProjectFolder(projectFolder, templateName) {
        var promise = new $.Deferred();
        brackets.fs.makedir(projectFolder, 777, function (err) {
            if (err === brackets.fs.NO_ERROR) {
                copyTemplateFiles(projectFolder, templateName)
                    .done(function () {
                        promise.resolve();
                    })
                    .fail(function () {
                        promise.reject();
                    });
                
            } else {
                showProjectErrorMessage(err, projectFolder);
                promise.reject(err);
            }
        });
        return promise;
    }
    
    
    function createNewProject(projectFolder, templateName) {
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
                showProjectErrorMessage(err, projectFolder, stats.isDirectory());
                promise.reject();
            }
        });
        return promise;
    }
    
    function openIndexFile(destination) {
        var indexFilename = cannonicalizeDirectoryPath(destination) + "index.html";
        brackets.fs.stat(indexFilename, function (err, stats) {
            if (err === brackets.fs.NO_ERROR && stats.isFile()) {
                CommandManager.execute(Commands.FILE_ADD_TO_WORKING_SET, { fullPath: indexFilename });
            }
        });

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
            newProjectFolder = getUserDocumentsFolder();
        
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

                createNewProject(destination, templateName).done(function () {
                    ProjectManager.openProject(destination).done(function () {
                        openIndexFile(destination);
                    });
                    prefs.setValue("newProjectOrdinal", ++newProjectOrdinal);
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
        
        $OkBtn.click(function(e) {
            if (!validateProjectName($projectNameInput.val())) {
                e.preventDefault();
                e.stopPropagation();
            }
            
        });
        
        initProjectTemplates($templateSelect);
    }
    
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    CommandManager.register(ExtensionStrings.MENU_TITLE, FILE_NEW_PROJECT, handleNewProject);
    var menu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
    menu.addMenuItem(FILE_NEW_PROJECT, undefined, Menus.AFTER, Commands.FILE_NEW_UNTITLED);

});
