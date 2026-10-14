param([switch]$AppOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-NineGridDataPaths

$runner = Get-NineGridManagedRunner
if ($runner) {
  $stopPath = Join-Path $paths.Logs 'app.stop'
  [IO.File]::WriteAllText($stopPath, 'stop')
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 300
    $stillRunning = Get-CimInstance Win32_Process -Filter "ProcessId=$($runner.ProcessId)" -ErrorAction SilentlyContinue
  } while ($stillRunning -and (Get-Date) -lt $deadline)
  if ($stillRunning) { throw "NineGrid API did not shut down gracefully. The process was not force-killed; inspect $($paths.Logs)." }
  Write-Host 'NineGrid API stopped gracefully.'
} else {
  $listeners = @(Get-NineGridPortListeners -Port 8787)
  if ($listeners.Count) { Write-Host 'A process is using port 8787 but is not owned by the NineGrid local runner; it was left untouched.' }
  else { Write-Host 'NineGrid API is already stopped.' }
}

if ($AppOnly) { return }
$pgListeners = @(Get-NineGridPortListeners -Port 5433)
if (-not $pgListeners.Count) { Write-Host 'NineGrid PostgreSQL is already stopped.'; return }
$expected = (Get-NineGridDataPaths).Postgres.Replace('/', '\').TrimEnd('\')
$pgProcess = $pgListeners | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ProcessId)" -ErrorAction SilentlyContinue } | Where-Object { $_.CommandLine -match '(?i)postgres\.exe' } | Select-Object -First 1
$command = [string]$pgProcess.CommandLine
$normalizedCommand = $command.Replace('/', '\')
if (-not $pgProcess -or $normalizedCommand -notmatch [regex]::Escape($expected)) {
  $owners = ($pgListeners | ForEach-Object { "PID $($_.ProcessId) on $($_.Address):5433" }) -join ', '
  throw "Port 5433 belongs to $owners, not the F: NineGrid cluster; it was left running."
}
$toolsPath = Get-NineGridPgTools -Major 18
$output = @(& (Join-Path $toolsPath 'pg_ctl.exe') '-D' $expected '-m' 'fast' '-w' '-t' '30' 'stop' 2>&1)
if ($LASTEXITCODE -ne 0) { throw "NineGrid PostgreSQL did not stop cleanly: $($output -join ' ')" }
Write-Host 'NineGrid PostgreSQL on F: stopped cleanly.'
