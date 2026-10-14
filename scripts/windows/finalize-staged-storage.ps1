$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$paths = Get-NineGridDataPaths
$config = Get-NineGridConfig
$db = Get-NineGridConnection
$admin = Get-NineGridConnection -Name 'DATABASE_ADMIN_URL'
$tools = Get-NineGridPostgresTools -ToolsPath (Get-NineGridPgTools -Major 18)
if (-not (Test-NineGridLoopbackHost $db.Host) -or $db.Port -ne 5433 -or -not (Test-NineGridLoopbackHost $admin.Host) -or $admin.Port -ne 5433) { throw 'Both NineGrid database URLs must use local loopback port 5433.' }
if (-not (Test-Path -LiteralPath (Join-Path $paths.Postgres 'PG_VERSION')) -or [IO.File]::ReadAllText((Join-Path $paths.Postgres 'PG_VERSION')).Trim() -ne '18') { throw 'The F: PostgreSQL 18 staging cluster is missing.' }
$listeners = @(Get-NineGridPortListeners -Port 5433)
$pidText = if (Test-Path -LiteralPath (Join-Path $paths.Postgres 'postmaster.pid')) { (Get-Content -LiteralPath (Join-Path $paths.Postgres 'postmaster.pid') -TotalCount 1).Trim() } else { '' }
$postgresPid = 0
if (-not [int]::TryParse($pidText, [ref]$postgresPid) -or @($listeners | Where-Object ProcessId -eq $postgresPid).Count -eq 0) { throw 'Port 5433 does not belong to the F: cluster; no process was stopped.' }
if (@($listeners | Where-Object { $_.Address -notin @('127.0.0.1', '::1') }).Count -gt 0) { throw 'PostgreSQL is bound beyond loopback; local configuration was not changed.' }
$apiListeners = @(Get-NineGridPortListeners -Port 8787)
$viteListeners = @(Get-NineGridPortListeners -Port 5173)
if ($apiListeners.Count -or $viteListeners.Count) { throw 'Stop the NineGrid API/Vite process before finalizing the local production configuration.' }

$snapshotUrl = New-NineGridAdminDatabaseUrl -Database $db.Database
$snapshot = Invoke-NineGridNodeSnapshot -ConnectionString $snapshotUrl -UploadDirectory $paths.Uploads
if ($snapshot.runtime.database -ne $db.Database -or $snapshot.runtime.listen_port -ne 5433 -or $snapshot.runtime.listen_address -notin @('127.0.0.1', '127.0.0.1/32')) { throw 'F: database identity or loopback binding did not verify.' }
$manifestFile = Get-ChildItem -LiteralPath $paths.Backups -Directory -Filter 'ninegrid-backup-*' | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object { Join-Path $_.FullName 'manifest.json' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $manifestFile) { throw 'No complete migration backup manifest was found.' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ($manifest.database -ne $db.Database -or ($snapshot.counts | ConvertTo-Json -Compress) -cne ($manifest.counts | ConvertTo-Json -Compress) -or ($snapshot.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -cne ($manifest.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -or $snapshot.attachmentMismatchCount -ne 0) { throw 'F: data differs from the latest backup manifest; the active configuration was not changed.' }

$appUrl = 'postgresql://' + [uri]::EscapeDataString($db.User) + ':' + [uri]::EscapeDataString($db.Password) + '@127.0.0.1:5433/' + [uri]::EscapeDataString($db.Database)
$adminUrl = 'postgresql://' + [uri]::EscapeDataString($admin.User) + ':' + [uri]::EscapeDataString($admin.Password) + '@127.0.0.1:5433/postgres'
Set-NineGridDotEnvValues -Values @{
  DATABASE_URL = $appUrl
  DATABASE_ADMIN_URL = $adminUrl
  UPLOAD_DIR = $paths.Uploads.Replace('\', '/')
  HOST = '127.0.0.1'
  PORT = '8787'
  NODE_ENV = 'development'
  APP_ORIGIN = 'http://127.0.0.1:8787'
}
Write-Host "Verified F: cluster against backup: $manifestFile"
Write-Host "Verified $($snapshot.tableCount) tables, account $($snapshot.counts.users), seasons $($snapshot.counts.seasons), and $($snapshot.uploadFileCount) uploads."
& (Join-Path $PSScriptRoot 'install-shortcut.ps1')
& (Join-Path $PSScriptRoot 'start.ps1')
