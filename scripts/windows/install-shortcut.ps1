$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop '九格行动本机版.lnk'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start.ps1') + '"'
if (Test-Path -LiteralPath $linkPath) {
  $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($linkPath)
  if ($existing.TargetPath -ieq $powershell -and $existing.Arguments -ceq $arguments) {
    Write-Host "Existing NineGrid desktop shortcut already points to the local startup script: $linkPath"
    return
  }
  throw "A desktop item already exists at $linkPath and points elsewhere; it was not overwritten."
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'Start the local NineGrid learning app and open it in the browser.'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$shortcut.Save()
Write-Host "Created desktop shortcut: $linkPath"
