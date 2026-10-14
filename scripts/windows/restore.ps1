param(
  [Parameter(Mandatory = $true)][string]$BundlePath,
  [Parameter(Mandatory = $true)][string]$DatabaseName
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$config = Get-NineGridConfig
$live = Get-NineGridConnection
Assert-NineGridSafeRestoreName -Name $DatabaseName -LiveName $live.Database
$bundle = (Resolve-Path -LiteralPath $BundlePath -ErrorAction Stop).Path
$manifestPath = Join-Path $bundle 'manifest.json'
$dump = Join-Path $bundle 'database.dump'
$archive = Join-Path $bundle 'uploads.tar.gz'
foreach ($file in @($manifestPath, $dump, $archive)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Backup bundle is incomplete: $file" } }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.formatVersion -ne 1) { throw 'Unsupported NineGrid backup manifest version.' }
if ((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.databaseDumpSha256 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.uploadsArchiveSha256) { throw 'Backup checksum mismatch; restore was not started.' }

$paths = Get-NineGridDataPaths
$tools = Get-NineGridPostgresTools -ToolsPath (Get-NineGridPgTools -Major 18)
$admin = Get-NineGridConnection -Name 'DATABASE_ADMIN_URL'
if (-not (Test-NineGridLoopbackHost $admin.Host) -or $admin.Port -ne 5433) { throw 'Restore requires the NineGrid PostgreSQL administrator URL on 127.0.0.1:5433.' }
$existsSql = "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'"
$exists = Invoke-NineGridPgTool -ToolPath $tools['psql.exe'] -Arguments @('--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--host', $admin.Host, '--port', [string]$admin.Port, '--username', $admin.User, '--dbname', $admin.Database, '--command', $existsSql) -Password $admin.Password -ErrorLabel 'Restore target check'
if (($exists -join '').Trim() -eq '1') { throw "Restore target database already exists: $DatabaseName. It was not overwritten." }
$uploadTarget = Join-Path $paths.Uploads "restore-$DatabaseName"
if (Test-Path -LiteralPath $uploadTarget) { throw "Restore upload directory already exists: $uploadTarget. It was not overwritten." }

$env:PGPASSWORD = $admin.Password
try {
  $createdbOutput = @(& $tools['createdb.exe'] '--no-password' '--host' $admin.Host '--port' ([string]$admin.Port) '--username' $admin.User '--owner' $live.User $DatabaseName 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not create isolated restore database (exit $LASTEXITCODE). $($createdbOutput -join ' ')" }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

Invoke-NineGridPgTool -ToolPath $tools['pg_restore.exe'] -Arguments @('--no-password', '--exit-on-error', '--no-owner', '--host', $live.Host, '--port', [string]$live.Port, '--username', $live.User, '--dbname', $DatabaseName, $dump) -Password $live.Password -ErrorLabel 'Isolated database restore' | Out-Null

$tar = (Get-Command tar.exe -ErrorAction Stop).Source
$entries = @(& $tar '-tzf' $archive 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect uploads archive.' }
foreach ($entry in $entries) {
  $normalized = ([string]$entry).Replace('\', '/')
  while ($normalized.StartsWith('./')) { $normalized = $normalized.Substring(2) }
  if (-not $normalized) { continue }
  if ($normalized.StartsWith('/') -or $normalized -match '(^|/)\.\.?(/|$)' -or $normalized.Contains(':')) { throw 'Uploads archive contains an unsafe path; extraction refused.' }
}
New-Item -ItemType Directory -Path $uploadTarget -Force | Out-Null
$extractOutput = @(& $tar '-xzf' $archive '-C' $uploadTarget 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Could not restore isolated uploads directory: $($extractOutput -join ' ')" }
$targetUrl = New-NineGridAdminDatabaseUrl -Database $DatabaseName -Port $admin.Port
$restored = Invoke-NineGridNodeSnapshot -ConnectionString $targetUrl -UploadDirectory $uploadTarget
if (($restored.counts | ConvertTo-Json -Compress) -cne ($manifest.counts | ConvertTo-Json -Compress) -or ($restored.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -cne ($manifest.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -or $restored.attachmentMismatchCount -ne 0) {
  throw "Restore contents do not match the backup manifest. Isolated data remains at database $DatabaseName and $uploadTarget for diagnosis; the live database is unchanged."
}
Write-Host "Restored and verified isolated database $DatabaseName and uploads $uploadTarget. The live DATABASE_URL was not changed."
Write-Host "Verified tables: $($restored.tableCount) · users $($restored.counts.users) · seasons $($restored.counts.seasons) · rewards $($restored.counts.reward_ledger) · uploads $($restored.uploadFileCount)"
