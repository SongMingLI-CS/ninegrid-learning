param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$paths = Get-NineGridDataPaths
$toolsPath = Get-NineGridPgTools -Major 18
$tools = Get-NineGridPostgresTools -ToolsPath $toolsPath
$config = Get-NineGridConfig
$db = Get-NineGridConnection

if (-not (Test-NineGridLoopbackHost $db.Host) -or $db.Port -ne 5433) { throw 'Local mode requires DATABASE_URL on 127.0.0.1:5433; no service was started.' }
if (-not (Test-NineGridLoopbackHost $config.HOST) -or $config.PORT -ne '8787' -or $config.NODE_ENV -ne 'development') { throw 'Local production runner configuration must use HOST=127.0.0.1, PORT=8787, with NODE_ENV=development in .env; the runner sets its child to production.' }
if (-not (Test-Path -LiteralPath (Join-Path $paths.Postgres 'PG_VERSION') -PathType Leaf)) { throw "F: PostgreSQL cluster is missing: $($paths.Postgres). Run scripts/windows/migrate-storage.ps1 first." }
if ([IO.File]::ReadAllText((Join-Path $paths.Postgres 'PG_VERSION')).Trim() -ne '18') { throw 'F: PostgreSQL data directory is not PostgreSQL 18; refusing to start it.' }
foreach ($directory in @($paths.Uploads, $paths.Backups, $paths.Logs, $paths.PostgresLogs)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
Invoke-NineGridLogRetention

$pgListeners = @(Get-NineGridPortListeners -Port 5433)
$fClusterRunning = $false
if ($pgListeners.Count) {
  $status = @(& $tools['pg_ctl.exe'] '-D' $paths.Postgres 'status' 2>&1)
  $fClusterRunning = $LASTEXITCODE -eq 0
  if (-not $fClusterRunning) {
    $owners = ($pgListeners | ForEach-Object { "PID $($_.ProcessId) on $($_.Address):5433" }) -join ', '
    throw "PostgreSQL port 5433 is occupied by $owners, not the configured F: cluster. Nothing was stopped."
  }
} else {
  & $tools['pg_ctl.exe'] '-D' $paths.Postgres '-l' (Join-Path $paths.Logs 'postgres-startup.log') '-o' '-h 127.0.0.1 -p 5433' '-w' '-t' '30' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'NineGrid PostgreSQL did not start. Review F:\Projects\NineGridData\logs\postgres-startup.log.' }
}

$dbSnapshot = Invoke-NineGridNodeSnapshot -ConnectionString (New-NineGridAdminDatabaseUrl -Database $db.Database) -UploadDirectory $paths.Uploads
$actualDirectory = ([string]$dbSnapshot.runtime.data_directory).Replace('/', '\').TrimEnd('\')
$expectedDirectory = $paths.Postgres.Replace('/', '\').TrimEnd('\')
if ($actualDirectory -ine $expectedDirectory -or $dbSnapshot.runtime.listen_address -notin @('127.0.0.1', '127.0.0.1/32') -or [int]$dbSnapshot.runtime.listen_port -ne 5433) {
  throw 'The live database did not report the configured F: path and loopback-only address; the API was not started.'
}

$apiListeners = @(Get-NineGridPortListeners -Port 8787)
if ($apiListeners.Count) {
  $apiStatus = $null
  try { $apiStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/status' -TimeoutSec 3 } catch { }
  if ($apiStatus.application -eq 'ninegrid-learning' -and $apiStatus.environment -eq 'production') {
    if (-not (Get-NineGridManagedRunner)) { Write-Host 'NineGrid production API is already responding on 127.0.0.1:8787; leaving the existing process untouched.' }
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8787/' }
    Write-Host "Database: PostgreSQL $($dbSnapshot.runtime.server_version), $($dbSnapshot.runtime.database) on F: (127.0.0.1:5433)"
    Write-Host "API: http://127.0.0.1:8787/ · mode=$($apiStatus.runtimeMode) · AI=$($apiStatus.aiMode) · commit=$($apiStatus.commit)"
    return
  }
  $owners = ($apiListeners | ForEach-Object { "PID $($_.ProcessId) on $($_.Address):8787" }) -join ', '
  throw "API port 8787 is occupied by $owners and is not the managed NineGrid production service. Nothing was stopped."
}

$runner = Get-NineGridRunnerPath
$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList @('scripts/windows/server-runner.mjs') -WorkingDirectory $script:NineGridRepoRoot -WindowStyle Hidden | Out-Null
$deadline = (Get-Date).AddSeconds(45)
$apiStatus = $null
do {
  Start-Sleep -Milliseconds 500
  try { $apiStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/status' -TimeoutSec 2 } catch { $apiStatus = $null }
} while (-not $apiStatus -and (Get-Date) -lt $deadline)
if (-not $apiStatus -or $apiStatus.application -ne 'ninegrid-learning' -or $apiStatus.environment -ne 'production' -or $apiStatus.accountAvailability -ne 'enabled') {
  throw "NineGrid failed production readiness checks; no fallback mode was selected. Review $($paths.Logs)\ninegrid-app-*.log and fix the reported cause."
}
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8787/' }
Write-Host "Database: PostgreSQL $($dbSnapshot.runtime.server_version), $($dbSnapshot.runtime.database) on F: (127.0.0.1:5433)"
Write-Host "API: http://127.0.0.1:8787/ · mode=$($apiStatus.runtimeMode) · AI=$($apiStatus.aiMode) · commit=$($apiStatus.commit)"
