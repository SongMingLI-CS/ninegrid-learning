param([switch]$ResumeStaged)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Get-FreeLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), 0)
  try { $listener.Start(); return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

function New-RandomHex([int]$ByteCount = 32) {
  $bytes = New-Object 'System.Byte[]' $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes); return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant() }
  finally { $generator.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Set-PostgresPasswordEnvironment([string]$Password) {
  $script:oldPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $Password
}

function Restore-PostgresPasswordEnvironment {
  if ($null -eq $script:oldPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $script:oldPgPassword }
}

function Invoke-PsqlInput([string]$PsqlPath, [string[]]$Arguments, [string]$Password, [string]$Sql, [string]$Label) {
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Password
    $output = @($Sql | & $PsqlPath @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE): $($output -join ' ')" }
  } finally {
    if ($null -eq $previous) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previous }
  }
}

function New-LocalDatabaseUrl($Parts, [int]$Port, [string]$Database) {
  return "postgresql://$([uri]::EscapeDataString($Parts.User)):$([uri]::EscapeDataString($Parts.Password))@127.0.0.1:$Port/$Database"
}

function Compare-SnapshotToManifest($Snapshot, $Manifest, [string]$Label) {
  if (($Snapshot.counts | ConvertTo-Json -Compress) -cne ($Manifest.counts | ConvertTo-Json -Compress)) { throw "$Label table counts differ from the pre-migration manifest." }
  if (($Snapshot.uploadManifest | ConvertTo-Json -Depth 8 -Compress) -cne ($Manifest.uploadManifest | ConvertTo-Json -Depth 8 -Compress)) { throw "$Label upload file names, sizes, or SHA-256 hashes differ from the pre-migration manifest." }
  if ($Snapshot.attachmentMismatchCount -ne 0) { throw "$Label contains attachment records that do not match their file checksums." }
}

function New-Cluster([string]$DataPath, [string]$PasswordFile, [string]$LogDirectory) {
  if (Test-Path -LiteralPath $DataPath) {
    $items = @(Get-ChildItem -LiteralPath $DataPath -Force -ErrorAction SilentlyContinue)
    if ($items.Count) { throw "Refusing to initialize a non-empty PostgreSQL directory: $DataPath" }
  } else { New-Item -ItemType Directory -Path $DataPath -Force | Out-Null }
  $output = @(& $tools['initdb.exe'] '-D' $DataPath '--username=postgres' '--auth-local=scram-sha-256' '--auth-host=scram-sha-256' '--pwfile' $PasswordFile '--encoding=UTF8' '--locale=C' 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL cluster initialization failed (exit $LASTEXITCODE): $($output -join ' ')" }
  $configFile = Join-Path $DataPath 'postgresql.conf'
  $configLines = @(
    "listen_addresses = '127.0.0.1'",
    'port = 5433',
    "password_encryption = 'scram-sha-256'",
    'logging_collector = on',
    "log_directory = '$($paths.PostgresLogs.Replace('\','/'))'",
    "log_filename = 'ninegrid-postgres-%Y-%m-%d_%H%M%S.log'",
    'log_rotation_age = 1d',
    'log_rotation_size = 20MB',
    'log_truncate_on_rotation = on',
    'log_min_messages = warning'
  )
  [IO.File]::AppendAllText($configFile, "`r`n# NineGrid local-only settings`r`n$($configLines -join "`r`n")`r`n", [Text.UTF8Encoding]::new($false))
  $hba = Join-Path $DataPath 'pg_hba.conf'
  $hbaText = [IO.File]::ReadAllText($hba)
  if ($hbaText -notmatch 'host\s+all\s+all\s+127\.0\.0\.1/32\s+scram-sha-256') { [IO.File]::AppendAllText($hba, "`r`nhost all all 127.0.0.1/32 scram-sha-256`r`nhost all all ::1/128 scram-sha-256`r`n", [Text.UTF8Encoding]::new($false)) }
}

$paths = Get-NineGridDataPaths
$volume = Get-Volume -DriveLetter F -ErrorAction SilentlyContinue
if (-not $volume -or $volume.FileSystem -ne 'NTFS') { throw 'F: must be an existing NTFS volume. No fallback directory will be created on another drive.' }
foreach ($directory in @($paths.Root, $paths.Uploads, $paths.Backups, $paths.Logs, $paths.PostgresLogs)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf) -or -not (git check-ignore .env)) { throw '.env must exist and be ignored by Git before local secrets or database paths are changed.' }

$config = Get-NineGridConfig
$oldDb = Get-NineGridConnection
if (-not (Test-NineGridLoopbackHost $oldDb.Host)) { throw 'The current database URL does not point to loopback; it was not touched.' }
$toolsPath = Get-NineGridPgTools -Major 18
$tools = Get-NineGridPostgresTools -ToolsPath $toolsPath
$oldSnapshot = Invoke-NineGridNodeSnapshot -ConnectionString $config.DATABASE_URL -UploadDirectory $config.UPLOAD_DIR
$oldDataDirectory = [string]$oldSnapshot.runtime.data_directory
$oldPort = [int]$oldSnapshot.runtime.listen_port
if ($oldSnapshot.runtime.database -ne $oldDb.Database -or $oldPort -ne $oldDb.Port) { throw 'DATABASE_URL and the live PostgreSQL connection do not identify the same database.' }
if ($oldSnapshot.attachmentMismatchCount -ne 0) { throw 'Current attachment records fail their stored hashes; migration stopped before backup.' }
$apiListeners = @(Get-NineGridPortListeners -Port 8787)
$viteListeners = @(Get-NineGridPortListeners -Port 5173)
if ($apiListeners.Count -or $viteListeners.Count) { throw 'Stop the NineGrid development/API session cleanly, then rerun migration. No other process was stopped.' }

$targetContents = if (Test-Path -LiteralPath $paths.Postgres) { @(Get-ChildItem -LiteralPath $paths.Postgres -Force) } else { @() }
$isStagedResume = $false
if ($targetContents.Count) {
  $targetConfigText = if (Test-Path -LiteralPath (Join-Path $paths.Postgres 'postgresql.conf')) { [IO.File]::ReadAllText((Join-Path $paths.Postgres 'postgresql.conf')) } else { '' }
  $targetVersion = if (Test-Path -LiteralPath (Join-Path $paths.Postgres 'PG_VERSION')) { [IO.File]::ReadAllText((Join-Path $paths.Postgres 'PG_VERSION')).Trim() } else { '' }
  $stagedUploadsExists = Test-Path -LiteralPath (Join-Path $paths.Root '.uploads-staged')
  $alreadyMovedUploadsEmpty = (Test-Path -LiteralPath $paths.Uploads) -and @(Get-ChildItem -LiteralPath $paths.Uploads -Force -ErrorAction SilentlyContinue).Count -eq 0
  if (-not $ResumeStaged -or $targetVersion -ne '18' -or $targetConfigText -notmatch '# NineGrid local-only settings' -or (-not $stagedUploadsExists -and -not $alreadyMovedUploadsEmpty) -or -not $config.ContainsKey('DATABASE_ADMIN_URL')) {
    throw "F: PostgreSQL target is non-empty and is not a recognized NineGrid staged migration. It was not overwritten: $($paths.Postgres)"
  }
  $isStagedResume = $true
  Write-Host 'Recognized the previously restored stopped NineGrid staging cluster; validating it in place.'
}
$backupStartedAt = (Get-Date).ToUniversalTime()
& (Join-Path $PSScriptRoot 'backup.ps1') -LeaveAppStopped
$bundle = Get-ChildItem -LiteralPath $paths.Backups -Directory -Filter 'ninegrid-backup-*' | Where-Object { $_.LastWriteTimeUtc -ge $backupStartedAt } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $bundle) { throw 'The pre-migration backup bundle was not created.' }
$manifest = Get-Content -LiteralPath (Join-Path $bundle.FullName 'manifest.json') -Raw | ConvertFrom-Json
$dump = Join-Path $bundle.FullName 'database.dump'
$archive = Join-Path $bundle.FullName 'uploads.tar.gz'
$tar = (Get-Command tar.exe -ErrorAction Stop).Source

$probeRoot = Join-Path $paths.Backups ('.ninegrid-restore-check-' + [guid]::NewGuid().ToString('N'))
$probeCluster = Join-Path $probeRoot 'postgres'
$probeUploads = Join-Path $probeRoot 'uploads'
$probePort = Get-FreeLoopbackPort
Assert-NineGridPortFree -Port $probePort -Purpose 'isolated backup verification'
$probePassword = New-RandomHex
$probePasswordFile = Join-Path $env:TEMP ('ninegrid-probe-' + [guid]::NewGuid().ToString('N') + '.pw')
[IO.File]::WriteAllText($probePasswordFile, $probePassword, [Text.UTF8Encoding]::new($false))
$probeStarted = $false
try {
  Write-Host 'Verifying the pre-migration backup in a disposable PostgreSQL cluster...'
  New-Cluster -DataPath $probeCluster -PasswordFile $probePasswordFile -LogDirectory $paths.PostgresLogs
  Write-Host 'Disposable cluster initialized; requesting startup...'
  & $tools['pg_ctl.exe'] '-D' $probeCluster '-l' (Join-Path $probeRoot 'postgres-start.log') '-o' "-h 127.0.0.1 -p $probePort" '-w' '-t' '30' 'start'
  Write-Host 'Startup command returned.'
  if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL did not start; inspect its temporary postgres-start.log.' }
  $probeStarted = $true
  Write-Host 'Isolated PostgreSQL started; restoring the database dump...'
  $env:PGPASSWORD = $probePassword
  $createdb = @(& $tools['createdb.exe'] '--no-password' '--host' '127.0.0.1' '--port' ([string]$probePort) '--username' 'postgres' 'ninegrid_probe' 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not create isolated verification database: $($createdb -join ' ')" }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Invoke-NineGridPgTool -ToolPath $tools['pg_restore.exe'] -Arguments @('--no-password', '--exit-on-error', '--no-owner', '--host', '127.0.0.1', '--port', [string]$probePort, '--username', 'postgres', '--dbname', 'ninegrid_probe', $dump) -Password $probePassword -ErrorLabel 'Pre-migration isolated restore' | Out-Null
  Write-Host 'Database restore completed; restoring the upload archive...'
  New-Item -ItemType Directory -Path $probeUploads -Force | Out-Null
  $extract = @(& $tar '-xzf' $archive '-C' $probeUploads 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Isolated upload restore failed: $($extract -join ' ')" }
  Write-Host 'Upload restore completed; comparing database and file manifests...'
  $probeUrl = "postgresql://postgres:$probePassword@127.0.0.1:$probePort/ninegrid_probe"
  $probeSnapshot = Invoke-NineGridNodeSnapshot -ConnectionString $probeUrl -UploadDirectory $probeUploads
  Compare-SnapshotToManifest -Snapshot $probeSnapshot -Manifest $manifest -Label 'Pre-migration isolated restore'
  Write-Host 'Isolated backup comparison passed.'
  Write-Host "Pre-migration backup restored in an isolated PostgreSQL 18 cluster; $($manifest.tableCount) tables and $($manifest.uploadFileCount) upload files match."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($probeStarted) { & $tools['pg_ctl.exe'] '-D' $probeCluster '-m' 'fast' '-w' '-t' '30' 'stop' }
  Remove-Item -LiteralPath $probePasswordFile -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $probeRoot) {
    $resolvedProbe = (Resolve-Path -LiteralPath $probeRoot).Path
    $resolvedBackupRoot = (Resolve-Path -LiteralPath $paths.Backups).Path.TrimEnd('\') + '\'
    if (-not $resolvedProbe.StartsWith($resolvedBackupRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedProbe -Leaf) -notmatch '^\.ninegrid-restore-check-[a-f0-9]{32}$') { throw 'Isolated verification cleanup target escaped its generated backup child directory.' }
    Remove-Item -LiteralPath $resolvedProbe -Recurse -Force
  }
}

$oldAdmin = if ($isStagedResume) { Get-NineGridConnection -Name 'DATABASE_ADMIN_URL' } else { $null }
if ($isStagedResume -and -not (Test-NineGridLoopbackHost $oldAdmin.Host)) { throw 'Staged administrator URL is not loopback.' }
$adminPassword = if ($isStagedResume) { $oldAdmin.Password } else { New-RandomHex }
$adminUrl = if ($isStagedResume) { New-LocalDatabaseUrl -Parts $oldAdmin -Port 5433 -Database 'postgres' } else { "postgresql://postgres:$adminPassword@127.0.0.1:5433/postgres" }
$adminParts = Get-NineGridDatabaseParts -ConnectionString $adminUrl
$adminPasswordFile = Join-Path $env:TEMP ('ninegrid-admin-' + [guid]::NewGuid().ToString('N') + '.pw')
[IO.File]::WriteAllText($adminPasswordFile, $adminPassword, [Text.UTF8Encoding]::new($false))
$targetPort = Get-FreeLoopbackPort
Assert-NineGridPortFree -Port $targetPort -Purpose 'staged F: PostgreSQL restore'
$targetInitialized = $false
$targetStarted = $false
$oldStopped = $false
$configChanged = $false
$oldEnvValues = @{
  DATABASE_URL = $config.DATABASE_URL
  UPLOAD_DIR = $config.UPLOAD_DIR
  NODE_ENV = $config.NODE_ENV
  HOST = $config.HOST
  PORT = $config.PORT
  APP_ORIGIN = $config.APP_ORIGIN
  DATABASE_ADMIN_URL = if ($config.ContainsKey('DATABASE_ADMIN_URL')) { $config.DATABASE_ADMIN_URL } else { '' }
}
try {
  Set-NineGridDotEnvValues -Values @{ DATABASE_ADMIN_URL = $adminUrl }
  if (-not $isStagedResume) {
    New-Cluster -DataPath $paths.Postgres -PasswordFile $adminPasswordFile -LogDirectory $paths.PostgresLogs
    $targetInitialized = $true
  }
  & $tools['pg_ctl.exe'] '-D' $paths.Postgres '-l' (Join-Path $paths.Logs 'postgres-startup.log') '-o' "-h 127.0.0.1 -p $targetPort" '-w' '-t' '30' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'Staged F: PostgreSQL did not start; inspect postgres-startup.log.' }
  $targetStarted = $true
  $roleName = $oldDb.User
  if ($roleName -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,62}$') { throw 'The existing application database role is not a safe SQL identifier; migration stopped.' }
  $quotedRole = '"' + $roleName.Replace('"', '""') + '"'
  $escapedPassword = $oldDb.Password.Replace("'", "''")
  $targetUploadsStage = if (Test-Path -LiteralPath (Join-Path $paths.Root '.uploads-staged')) { Join-Path $paths.Root '.uploads-staged' } else { $paths.Uploads }
  $uploadsAlreadyMoved = $targetUploadsStage -eq $paths.Uploads
  if ($isStagedResume) {
    $existsAtStage = Invoke-NineGridPgTool -ToolPath $tools['psql.exe'] -Arguments @('--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--host', '127.0.0.1', '--port', [string]$targetPort, '--username', 'postgres', '--dbname', 'postgres', '--command', "SELECT 1 FROM pg_database WHERE datname='$($oldDb.Database)'") -Password $adminPassword -ErrorLabel 'Staged database check'
    if (($existsAtStage -join '').Trim() -ne '1') { throw 'Staged database is missing; it was not recreated or overwritten.' }
  } else {
    Invoke-PsqlInput -PsqlPath $tools['psql.exe'] -Arguments @('--no-password', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--host', '127.0.0.1', '--port', [string]$targetPort, '--username', 'postgres', '--dbname', 'postgres') -Password $adminPassword -Sql "CREATE ROLE $quotedRole LOGIN PASSWORD '$escapedPassword';" -Label 'Application role setup'
    $env:PGPASSWORD = $adminPassword
    $createdbTarget = @(& $tools['createdb.exe'] '--no-password' '--host' '127.0.0.1' '--port' ([string]$targetPort) '--username' 'postgres' '--owner' $roleName $oldDb.Database 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Could not create the F: application database: $($createdbTarget -join ' ')" }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Invoke-NineGridPgTool -ToolPath $tools['pg_restore.exe'] -Arguments @('--no-password', '--exit-on-error', '--no-owner', '--host', '127.0.0.1', '--port', [string]$targetPort, '--username', $roleName, '--dbname', $oldDb.Database, $dump) -Password $oldDb.Password -ErrorLabel 'F: database restore' | Out-Null
    if (Test-Path -LiteralPath $targetUploadsStage) { throw 'Staged upload directory already exists; it was not overwritten.' }
    New-Item -ItemType Directory -Path $targetUploadsStage -Force | Out-Null
    $extractTarget = @(& $tar '-xzf' $archive '-C' $targetUploadsStage 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "F: upload restore failed: $($extractTarget -join ' ')" }
  }
  $targetUrlAtStage = New-LocalDatabaseUrl -Parts $adminParts -Port $targetPort -Database $oldDb.Database
  $targetSnapshot = Invoke-NineGridNodeSnapshot -ConnectionString $targetUrlAtStage -UploadDirectory $targetUploadsStage
  Compare-SnapshotToManifest -Snapshot $targetSnapshot -Manifest $manifest -Label 'Staged F: database'
  if (-not $uploadsAlreadyMoved -and (Test-Path -LiteralPath $paths.Uploads)) {
    $existingUploads = @(Get-ChildItem -LiteralPath $paths.Uploads -Force -ErrorAction SilentlyContinue)
    if ($existingUploads.Count) { throw "F: uploads target is not empty and will not be overwritten: $($paths.Uploads)" }
    Remove-Item -LiteralPath $paths.Uploads -Force
  }
  if (-not $uploadsAlreadyMoved) { Move-Item -LiteralPath $targetUploadsStage -Destination $paths.Uploads }
  & $tools['pg_ctl.exe'] '-D' $paths.Postgres '-m' 'fast' '-w' '-t' '30' 'stop'
  if ($LASTEXITCODE -ne 0) { throw 'Staged F: PostgreSQL did not stop cleanly before port switch.' }
  $targetStarted = $false

  $oldExpected = (Resolve-Path (Join-Path $script:NineGridRepoRoot 'data\dev-postgres\cluster')).Path.TrimEnd('\')
  $listenerOwners = @(Get-NineGridPortListeners -Port $oldPort)
  $oldPidPath = Join-Path $oldExpected 'postmaster.pid'
  $oldPid = 0
  $pidText = if (Test-Path -LiteralPath $oldPidPath) { (Get-Content -LiteralPath $oldPidPath -TotalCount 1).Trim() } else { '' }
  $oldProcess = if ([int]::TryParse($pidText, [ref]$oldPid)) { Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -ErrorAction SilentlyContinue } else { $null }
  $oldListenerMatches = @($listenerOwners | Where-Object { $_.ProcessId -eq $oldPid }).Count -gt 0
  $clusterStatus = @(& $tools['pg_ctl.exe'] '-D' $oldExpected 'status' 2>&1)
  if (-not $oldProcess -or $oldProcess.Name -ne 'postgres.exe' -or -not $oldListenerMatches -or $LASTEXITCODE -ne 0) { throw 'The verified D: data directory PID, pg_ctl status, and database listener do not all match; the old database was left untouched.' }
  & $tools['pg_ctl.exe'] '-D' $oldExpected '-m' 'fast' '-w' '-t' '30' 'stop'
  if ($LASTEXITCODE -ne 0) { throw 'Could not cleanly stop the verified D: cluster; it was left intact.' }
  $oldStopped = $true

  Set-NineGridDotEnvValues -Values @{
    DATABASE_URL = 'postgresql://' + [uri]::EscapeDataString($oldDb.User) + ':' + [uri]::EscapeDataString($oldDb.Password) + '@127.0.0.1:5433/' + [uri]::EscapeDataString($oldDb.Database)
    UPLOAD_DIR = $paths.Uploads.Replace('\', '/')
    HOST = '127.0.0.1'
    PORT = '8787'
    NODE_ENV = 'development'
    APP_ORIGIN = 'http://127.0.0.1:8787'
    DATABASE_ADMIN_URL = New-LocalDatabaseUrl -Parts $adminParts -Port 5433 -Database 'postgres'
  }
  $configChanged = $true
  Assert-NineGridPortFree -Port 5433 -Purpose 'NineGrid PostgreSQL'
  & $tools['pg_ctl.exe'] '-D' $paths.Postgres '-l' (Join-Path $paths.Logs 'postgres-startup.log') '-o' '-h 127.0.0.1 -p 5433' '-w' '-t' '30' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'F: PostgreSQL failed to start on port 5433; inspect postgres-startup.log.' }
  $targetStarted = $true
  $finalConfig = Get-NineGridConfig
  $finalAdmin = Get-NineGridConnection -Name 'DATABASE_ADMIN_URL'
  $finalSnapshotUrl = New-LocalDatabaseUrl -Parts $finalAdmin -Port 5433 -Database $oldDb.Database
  $finalSnapshot = Invoke-NineGridNodeSnapshot -ConnectionString $finalSnapshotUrl -UploadDirectory $paths.Uploads
  Compare-SnapshotToManifest -Snapshot $finalSnapshot -Manifest $manifest -Label 'Live F: database'
  if ($finalSnapshot.runtime.data_directory.Replace('/', '\').TrimEnd('\') -ine $paths.Postgres.Replace('/', '\').TrimEnd('\') -or $finalSnapshot.runtime.listen_address -notin @('127.0.0.1','127.0.0.1/32')) { throw 'Live PostgreSQL is not using the F: cluster and loopback address.' }
  Remove-Item -LiteralPath $adminPasswordFile -Force -ErrorAction SilentlyContinue
  Write-Host "Migration verified. F: database $($finalSnapshot.runtime.database) has $($manifest.counts.users) users, $($manifest.counts.seasons) seasons, $($manifest.counts.reward_ledger) rewards, and $($manifest.uploadFileCount) upload files."
  Write-Host "Original data directory retained at $oldExpected. Backup: $($bundle.FullName)"
  & (Join-Path $PSScriptRoot 'install-shortcut.ps1')
  & (Join-Path $PSScriptRoot 'start.ps1')
  $targetStarted = $false
} catch {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  try { & (Join-Path $PSScriptRoot 'stop.ps1') -AppOnly } catch { Write-Host 'Rollback notice: managed API runner could not be stopped automatically; it was not force-killed.' }
  if ($targetStarted) { & $tools['pg_ctl.exe'] '-D' $paths.Postgres '-m' 'fast' '-w' '-t' '30' 'stop' }
  if ($configChanged) { Set-NineGridDotEnvValues -Values $oldEnvValues }
  if ($oldStopped) {
    $oldLog = Join-Path (Split-Path $oldExpected -Parent) 'postgres.log'
    & $tools['pg_ctl.exe'] '-D' $oldExpected '-l' $oldLog '-o' '-h 127.0.0.1 -p 5433' '-w' '-t' '30' 'start'
    if ($LASTEXITCODE -ne 0) { Write-Host "Rollback warning: the old D: cluster did not restart automatically. Its directory remains intact: $oldExpected" }
  }
  Remove-Item -LiteralPath $adminPasswordFile -Force -ErrorAction SilentlyContinue
  throw
}
