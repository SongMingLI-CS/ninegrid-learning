param([switch]$LeaveAppStopped)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-NineGridDataPaths
$config = Get-NineGridConfig
$db = Get-NineGridConnection
if (-not (Test-NineGridLoopbackHost $db.Host) -or $db.Port -ne 5433) { throw 'Backup refused: DATABASE_URL is not the local NineGrid database on 127.0.0.1:5433.' }
$tools = Get-NineGridPostgresTools -ToolsPath (Get-NineGridPgTools -Major 18)
foreach ($directory in @($paths.Backups, $paths.Uploads, $paths.Logs)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

$appWasRunning = $false
$apiListeners = @(Get-NineGridPortListeners -Port 8787)
if ($apiListeners.Count) {
  $managed = Get-NineGridManagedRunner
  if (-not $managed) { throw 'Backup refused while an unmanaged app is using port 8787. Stop the NineGrid development session first; no service was stopped.' }
  $appWasRunning = $true
  & (Join-Path $PSScriptRoot 'stop.ps1') -AppOnly
}

$bundle = $null
try {
  $snapshotUrl = if ($config.ContainsKey('DATABASE_ADMIN_URL') -and $config.DATABASE_ADMIN_URL) { New-NineGridAdminDatabaseUrl -Database $db.Database } else { $config.DATABASE_URL }
  $before = Invoke-NineGridNodeSnapshot -ConnectionString $snapshotUrl -UploadDirectory $paths.Uploads
  if ($before.attachmentMismatchCount -ne 0) { throw 'Backup refused: one or more database attachments do not match their stored checksum.' }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $bundle = Join-Path $paths.Backups "ninegrid-backup-$stamp"
  if (Test-Path -LiteralPath $bundle) { throw 'Backup timestamp already exists; wait for the next second and retry.' }
  New-Item -ItemType Directory -Path $bundle -Force | Out-Null
  $dump = Join-Path $bundle 'database.dump'
  $archive = Join-Path $bundle 'uploads.tar.gz'
  $dumpDb = if ($config.ContainsKey('DATABASE_ADMIN_URL') -and $config.DATABASE_ADMIN_URL) { Get-NineGridDatabaseParts -ConnectionString (New-NineGridAdminDatabaseUrl -Database $db.Database) } else { $db }
  Invoke-NineGridPgTool -ToolPath $tools['pg_dump.exe'] -Arguments @('--no-password', '--host', $dumpDb.Host, '--port', [string]$dumpDb.Port, '--username', $dumpDb.User, '--dbname', $db.Database, '--format=custom', '--no-owner', '--file', $dump) -Password $dumpDb.Password -ErrorLabel 'PostgreSQL backup' | Out-Null
  $tar = (Get-Command tar.exe -ErrorAction Stop).Source
  $tarOutput = @(& $tar '-czf' $archive '-C' $paths.Uploads '.')
  if ($LASTEXITCODE -ne 0) { throw "Upload backup failed with exit $LASTEXITCODE." }
  $after = Invoke-NineGridNodeSnapshot -ConnectionString $snapshotUrl -UploadDirectory $paths.Uploads
  if (($before.counts | ConvertTo-Json -Compress) -cne ($after.counts | ConvertTo-Json -Compress) -or ($before.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -cne ($after.uploadManifest | ConvertTo-Json -Depth 8 -Compress)) {
    throw 'Database or upload state changed during backup; this bundle will not be marked complete.'
  }
  $manifest = [ordered]@{
    formatVersion = 1
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    policy = 'Keep the newest 14 daily NineGrid bundles; this tool never deletes existing backups.'
    database = $before.runtime.database
    postgresVersion = $before.runtime.server_version
    sourceDataDirectory = $before.runtime.data_directory
    tableCount = $before.tableCount
    counts = $before.counts
    uploadFileCount = $before.uploadFileCount
    attachmentCount = $before.attachmentCount
    uploadManifest = $before.uploadManifest
    databaseDumpSha256 = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
    uploadsArchiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  [IO.File]::WriteAllText((Join-Path $bundle 'manifest.json'), ($manifest | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  $allBundles = @(Get-ChildItem -LiteralPath $paths.Backups -Directory -Filter 'ninegrid-backup-*' -ErrorAction SilentlyContinue)
  Write-Host "Created database-and-upload backup: $bundle"
  Write-Host "Tables: $($before.tableCount) · account $($before.counts.users) · seasons $($before.counts.seasons) · evidence/evaluations $($before.counts.task_evaluations) · rewards $($before.counts.reward_ledger) · attachments $($before.attachmentCount)"
  if ($allBundles.Count -gt 14) { Write-Host "Retention notice: $($allBundles.Count) NineGrid bundles exist. Review retention manually; no previous backup was deleted." }
} catch {
  if ($bundle -and (Test-Path -LiteralPath $bundle)) { Write-Host "Incomplete backup artifacts remain for review: $bundle" }
  throw
} finally {
  if ($appWasRunning -and -not $LeaveAppStopped) { & (Join-Path $PSScriptRoot 'start.ps1') -NoBrowser }
}
