' Owner: Renzo. Double-click launcher for the Understudy desktop app (no PowerShell window).
' Starts "npm run desktop" hidden from the project folder. If the app is already running,
' only the Electron window is opened (Electron brings the existing window to the front).
' Output goes to %TEMP%\understudy.log for troubleshooting.
Option Explicit
Dim shell, fso, root, running
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Is the web app already listening on :5173?
running = (shell.Run("cmd /c netstat -ano | findstr /R /C:"":5173 .*LISTENING"" >nul", 0, True) = 0)

If running Then
  shell.Run "cmd /c cd /d """ & root & """ && npx electron .", 0, False
Else
  shell.Run "cmd /c cd /d """ & root & """ && npm run desktop > ""%TEMP%\understudy.log"" 2>&1", 0, False
End If
