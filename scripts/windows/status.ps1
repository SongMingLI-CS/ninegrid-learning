$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-NineGridDataPaths
$config = $null; $db = $null; $snapshot = $null
try {
  $config = Get-NineGridConfig
  $db = Get-NineGridConnection
  if (Test-Path -LiteralPath (Join-Path $paths.Postgres 'PG_VERSION')) { $snapshot = Invoke-NineGridNodeSnapshot -ConnectionString (New-NineGridAdminDatabaseUrl -Database $db.Database) -UploadDirectory $paths.Uploads }
} catch { Write-Host "Database check: $($_.Exception.Message)" }
$api = $null
try { $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/status' -TimeoutSec 3 } catch { }
$runner = $null
try { $runner = Get-NineGridManagedRunner } catch { Write-Host "Managed API check: $($_.Exception.Message)" }
[pscustomobject]@{
  Address = 'http://127.0.0.1:8787/'
  ApiProcess = if ($runner) { 'NineGrid managed production runner active' } elseif ($api) { 'API responds; process is not managed by the local runner' } else { 'stopped or unavailable' }
  ApiMode = if ($api) { $api.runtimeMode } else { 'unavailable' }
  AiMode = if ($api) { $api.aiMode } else { 'unavailable' }
  Commit = if ($api) { $api.commit } else { 'unavailable' }
  ApiPort = 8787
  PostgresVersion = if ($snapshot) { $snapshot.runtime.server_version } else { 'unavailable' }
  Database = if ($snapshot) { $snapshot.runtime.database } else { 'unavailable' }
  DataDirectory = if ($snapshot) { $snapshot.runtime.data_directory } else { $paths.Postgres }
  DatabasePort = if ($snapshot) { $snapshot.runtime.listen_port } else { 5433 }
  ListenAddress = if ($snapshot) { $snapshot.runtime.listen_address } else { 'unknown' }
  DatabaseSize = if ($snapshot) { $snapshot.runtime.database_size } else { 'unknown' }
  UploadFileCount = if ($snapshot) { $snapshot.uploadFileCount } else { 'unknown' }
  FreeSpaceOnF = (Get-Volume -DriveLetter F -ErrorAction SilentlyContinue).SizeRemaining
} | Format-List
