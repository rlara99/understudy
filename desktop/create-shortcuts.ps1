# Owner: Renzo. Puts "Understudy" and "Understudy (browser)" shortcuts on your desktop and in the Start menu
# (so searching "Understudy" in Start finds them).
# Run once from the project folder:  powershell -ExecutionPolicy Bypass -File desktop\create-shortcuts.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$folders = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))
$icon = Join-Path $here "understudy.ico"
$shell = New-Object -ComObject WScript.Shell

function New-Link($name, $script, $description) {
  foreach ($folder in $folders) {
  $link = $shell.CreateShortcut((Join-Path $folder "$name.lnk"))
  $link.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $link.Arguments = '"' + (Join-Path $here $script) + '"'
  $link.WorkingDirectory = $root
  $link.IconLocation = "$icon,0"
  $link.Description = $description
  $link.Save()
  Write-Output "Created: $(Join-Path $folder "$name.lnk")"
  }
}

New-Link "Understudy" "launch-desktop.vbs" "Understudy desktop app"
New-Link "Understudy (browser)" "launch-browser.vbs" "Understudy in your browser"
