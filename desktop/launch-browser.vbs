' Owner: Renzo. Double-click launcher for Understudy in your normal browser (no PowerShell window).
' Starts the web app and server hidden ("npm run dev") if they aren't running, waits until
' http://localhost:5173 answers, then opens it. The server keeps running in the background
' after you close the browser; the desktop launcher reuses it. Log: %TEMP%\understudy-web.log
Option Explicit
Dim shell, fso, root, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

Function Running()
  Running = (shell.Run("cmd /c netstat -ano | findstr /R /C:"":5173 .*LISTENING"" >nul", 0, True) = 0)
End Function

If Not Running() Then
  shell.Run "cmd /c cd /d """ & root & """ && npm run dev > ""%TEMP%\understudy-web.log"" 2>&1", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If Running() Then Exit For
  Next
  WScript.Sleep 1500
End If

shell.Run "http://localhost:5173/", 1, False
