; DeskForge installer hooks (referenced by bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; "Start DeskForge when I sign in" is stored by the autostart plugin as a per-user Run entry. Uninstalling removes the
; program but not that entry, which would leave a dangling startup item. Remove it (nothing happens if it isn't there).
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeskForge"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "deskforge"
!macroend
