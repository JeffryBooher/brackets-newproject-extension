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
    var PreferencesManager          = brackets.getModule("preferences/PreferencesManager"),
        Commands                    = brackets.getModule("command/Commands"),
        CommandManager              = brackets.getModule("command/CommandManager"),
        ExtensionUtils              = brackets.getModule("utils/ExtensionUtils"),
        Strings                     = brackets.getModule("strings"),
        StringUtils                 = brackets.getModule("utils/StringUtils"),
        Menus                       = brackets.getModule("command/Menus"),
        DefaultDialogs              = brackets.getModule("widgets/DefaultDialogs"),
        Dialogs                     = brackets.getModule("widgets/Dialogs"),
        ExtensionStrings            = require("strings"),
        ExtensionDialogTemplate     = require("text!htmlContent/MyExtensionDialog.html");
    

    /** @const {string} Extension Command ID */
    // TODO: Change these values so they are unique to your extension
    var MY_COMMANDID                = "extension.command";
    var MY_MENUID                   = "extension-menu";
    var MY_MODULENAME               = "extension-module";
    
    /* Our extension's preferences */
    var prefs = PreferencesManager.getExtensionPrefs(MY_MODULENAME);
    
    // Define a preference to keep track of how many times our extension has been ivoked
    prefs.definePreference("runCount", "number", 0);

    /* Cache our module info */
    var _module = module;
    
    function showMyDialog() {
        // Increment our run count 
        var runCount = prefs.get("runCount") || 0;
        prefs.set("runCount", ++runCount);
        
        // This is input data into the template
        var context = {
            Strings: Strings,
            ExtensionStrings: ExtensionStrings
        };
        
        // Invoke the dialog from the rendered HTML from the template
        var dialog = Dialogs.showModalDialogUsingTemplate(Mustache.render(ExtensionDialogTemplate, context));
        
        // If you add more buttons and need to know which button was pressed make sure
        //  to use unique ids for each button through the button's data-button-id attribute.
        dialog.done(function (buttonId) {
            if (buttonId === "close") {
                alert("Hello World");
            }
        });
    }
                    
    
    // Extension init code goes at the bottom
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    // Register the command -- The command and the command title are kept together
    CommandManager.register(ExtensionStrings.MENU_ITEM_LABEL, MY_COMMANDID, showMyDialog);
    // Add a new menu before the help menu.  
    //  if you want to modify an existing menu you would use Menus.getMenu -- e.g. Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
    var menu = Menus.addMenu(ExtensionStrings.MENU_LABEL, MY_MENUID, Menus.BEFORE, Menus.AppMenuBar.HELP_MENU);
    // Now add the menu item to invoke it.  Add a keyboard shortcut as well.
    menu.addMenuItem(MY_COMMANDID, "Ctrl-Alt-X");
});
