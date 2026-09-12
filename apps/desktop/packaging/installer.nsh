; NSIS customisation for the LIVETAP Windows installer.
;
; electron-builder already writes the `livetap://` protocol registration from the `protocols` block
; in electron-builder.yml. This file exists so that registration is removed cleanly on uninstall
; rather than leaving a dead handler pointing at a deleted executable — a small thing that otherwise
; makes a later reinstall behave strangely.

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\livetap"
  DeleteRegKey HKLM "Software\Classes\livetap"
!macroend
