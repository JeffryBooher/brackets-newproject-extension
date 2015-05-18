New Project Extension
=============


This Extension provides a platform for creating new projects for [Brackets](https://github.com/adobe/brackets).  
I have a lot of ideas of where I want this to go but wanted to get it out there for folks to play with and hopefully extend.

To use this extension, simply install it then select `File > New Project...`

This command will present a dialog from which you can specify the name of the project and the folder in which to create it. 
You can select from a list of templates that are basic "copy" templates -- meaning the files in the template are just copied to the project folder.

This extension has support for a user templates folder. This folder doesn't get overwritten with each new release like the built in templates. The folder defaults to `Documents/BracketsProjectTemplates` but you can point it to another location by editing Brackets' preferences file and adding `BracketsNewProjectExtension.userTemplatesFolder: <folder>`.   

I'd also like to have a script that would run after the files are created to further customize the project by `templatizing` the templates so that simple replacement values can be applied.

Feel free to fork this repository and contribute back to this project.  

My goal is to see have folks authoring and sharing new project templates through this repository.


