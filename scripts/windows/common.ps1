$ErrorActionPreference = 'Stop'

function Get-NineGridDataPaths {
  $root = 'F:\Projects\NineGridData'
  [pscustomobject]@{
    Root = $root
    Postgres = Join-Path $root 'postgres'
    Uploads = Join-Path $root 'uploads'
    Backups = Join-Path $root 'backups'
    Logs = Join-Path $root 'logs'
    PostgresLogs = Join-Path (Join-Path $root 'logs') 'postgres'
  }
}

function Test-NineGridLoopbackHost([string]$HostName) {
  return @('localhost', '127.0.0.1', '::1', '[::1]') -contains $HostName.ToLowerInvariant()
}

function Assert-NineGridSafeRestoreName([string]$Name, [string]$LiveName) {
  if ($Name -notmatch '^[A-Za-z][A-Za-z0-9_]{0,62}$') { throw 'Restore database name must use only letters, digits, and underscores.' }
  if ($Name -eq $LiveName) { throw 'Refusing to restore over the live NineGrid database.' }
}

function Read-NineGridDotEnv([string]$Path = (Join-Path $script:NineGridRepoRoot '.env')) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "NineGrid configuration is missing at $Path." }
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
      $name = $matches[1]; $value = $matches[2].Trim()
      if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length - 1] -eq '"') -or ($value[0] -eq "'" -and $value[$value.Length - 1] -eq "'"))) {
        $value = $value.Substring(1, $value.Length - 2)
        if ($line -match '^\s*[^=]+=\s*"') { $value = $value.Replace('\n', "`n").Replace('\r', "`r") }
      } else {
        $value = ($value -replace '\s+#.*$', '').Trim()
      }
      $values[$name] = $value
    }
  }
  return $values
}

function Set-NineGridDotEnvValues([string]$Path = (Join-Path $script:NineGridRepoRoot '.env'), [hashtable]$Values) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "NineGrid configuration is missing at $Path." }
  $lines = [Collections.Generic.List[string]]::new()
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') {
      $name = $matches[1]
      if ($Values.ContainsKey($name)) {
        $value = [string]$Values[$name]
        if ($value -match '[\r\n]') { throw "Configuration value $name cannot contain a newline." }
        $lines.Add("$name=$value"); [void]$seen.Add($name); continue
      }
    }
    $lines.Add($line)
  }
  foreach ($name in $Values.Keys) {
    if (-not $seen.Contains($name)) {
      $value = [string]$Values[$name]
      if ($value -match '[\r\n]') { throw "Configuration value $name cannot contain a newline." }
      $lines.Add("$name=$value")
    }
  }
  $temporary = "$Path.ninegrid-tmp"
  [IO.File]::WriteAllLines($temporary, $lines, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-NineGridDatabaseParts([string]$ConnectionString) {
  $uri = [uri]$ConnectionString
  $userInfo = $uri.UserInfo.Split(':', 2)
  [pscustomobject]@{
    Host = $uri.Host
    Port = $uri.Port
    Database = [uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    User = [uri]::UnescapeDataString($userInfo[0])
    Password = if ($userInfo.Count -gt 1) { [uri]::UnescapeDataString($userInfo[1]) } else { '' }
  }
}

function Get-NineGridPortListeners([int]$Port) {
  @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
    [pscustomobject]@{ Address = $_.LocalAddress; Port = $_.LocalPort; ProcessId = $_.OwningProcess; CommandLine = $process.CommandLine }
  })
}

function Get-NineGridConfig {
  return Read-NineGridDotEnv -Path (Join-Path $script:NineGridRepoRoot '.env')
}

function Get-NineGridConnection([string]$Name = 'DATABASE_URL') {
  $config = Get-NineGridConfig
  if (-not $config.ContainsKey($Name) -or -not $config[$Name]) { throw "$Name is not configured in the ignored local .env file." }
  return Get-NineGridDatabaseParts -ConnectionString $config[$Name]
}

function New-NineGridAdminDatabaseUrl([string]$Database, [int]$Port = 5433) {
  $admin = Get-NineGridConnection -Name 'DATABASE_ADMIN_URL'
  if (-not (Test-NineGridLoopbackHost $admin.Host) -or $admin.Port -ne $Port) { throw 'DATABASE_ADMIN_URL must identify the local NineGrid PostgreSQL administrator.' }
  return 'postgresql://' + [uri]::EscapeDataString($admin.User) + ':' + [uri]::EscapeDataString($admin.Password) + '@127.0.0.1:' + $Port + '/' + [uri]::EscapeDataString($Database)
}

function Get-NineGridRunnerPath {
  return (Join-Path $script:NineGridRepoRoot 'scripts\windows\server-runner.mjs')
}

function Get-NineGridAppPidPath {
  return (Join-Path (Get-NineGridDataPaths).Logs 'app.pid')
}

function Get-NineGridManagedRunner {
  $pidPath = Get-NineGridAppPidPath
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { return $null }
  $pidText = ([IO.File]::ReadAllText($pidPath)).Trim()
  $pidNumber = 0
  if (-not [int]::TryParse($pidText, [ref]$pidNumber)) { throw 'NineGrid app PID marker is invalid; refusing to stop any process.' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidNumber" -ErrorAction SilentlyContinue
  if (-not $process) { Remove-Item -LiteralPath $pidPath -Force; return $null }
  $expected = [IO.Path]::GetFullPath((Get-NineGridRunnerPath)).ToLowerInvariant()
  $commandLine = $process.CommandLine.ToLowerInvariant()
  if (-not $commandLine.Contains($expected) -and -not $commandLine.Contains('scripts/windows/server-runner.mjs')) { throw "PID $pidNumber does not identify the NineGrid local runner; refusing to signal it." }
  return $process
}

function Invoke-NineGridNodeSnapshot([string]$ConnectionString, [string]$UploadDirectory) {
  $oldUrl = $env:NINEGRID_DATABASE_URL; $oldUploadDir = $env:NINEGRID_UPLOAD_DIR
  try {
    $env:NINEGRID_DATABASE_URL = $ConnectionString
    $env:NINEGRID_UPLOAD_DIR = $UploadDirectory
    $output = & node (Join-Path $script:NineGridRepoRoot 'scripts\windows\db-snapshot.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'NineGrid database snapshot failed; see its non-secret diagnostics above.' }
    $joined = $output -join [Environment]::NewLine
    return $joined | ConvertFrom-Json
  } finally {
    if ($null -eq $oldUrl) { Remove-Item Env:NINEGRID_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:NINEGRID_DATABASE_URL = $oldUrl }
    if ($null -eq $oldUploadDir) { Remove-Item Env:NINEGRID_UPLOAD_DIR -ErrorAction SilentlyContinue } else { $env:NINEGRID_UPLOAD_DIR = $oldUploadDir }
  }
}

function Get-NineGridPostgresTools([string]$ToolsPath) {
  $names = @('pg_ctl.exe', 'initdb.exe', 'pg_dump.exe', 'pg_restore.exe', 'psql.exe', 'createdb.exe', 'pg_isready.exe')
  $result = @{}
  foreach ($name in $names) {
    $file = Join-Path $ToolsPath $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required PostgreSQL tool is missing: $file" }
    $result[$name] = $file
  }
  return $result
}

function Get-NineGridPgTools([int]$Major = 18) {
  $candidate = Join-Path $env:ProgramFiles "PostgreSQL\$Major\bin"
  if (-not (Test-Path -LiteralPath (Join-Path $candidate 'pg_ctl.exe') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $candidate 'initdb.exe') -PathType Leaf)) {
    throw "PostgreSQL $Major client/server tools were not found at the expected Windows installation path: $candidate"
  }
  return $candidate
}

function Invoke-NineGridPgTool([string]$ToolPath, [string[]]$Arguments, [string]$Password, [string]$ErrorLabel) {
  $oldPassword = $env:PGPASSWORD
  $oldTimeout = $env:PGCONNECT_TIMEOUT
  try {
    $env:PGPASSWORD = $Password
    $env:PGCONNECT_TIMEOUT = '8'
    $result = @(& $ToolPath @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "$ErrorLabel failed (exit $LASTEXITCODE). Output: $($result -join ' ')" }
    return $result
  } finally {
    if ($null -eq $oldPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $oldPassword }
    if ($null -eq $oldTimeout) { Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue } else { $env:PGCONNECT_TIMEOUT = $oldTimeout }
  }
}

function Assert-NineGridPortFree([int]$Port, [string]$Purpose) {
  $listeners = @(Get-NineGridPortListeners -Port $Port)
  if ($listeners.Count) {
    $owners = ($listeners | ForEach-Object { "PID $($_.ProcessId) on $($_.Address):$Port" }) -join ', '
    throw "$Purpose port $Port is occupied by $owners. NineGrid left the listener untouched."
  }
}

function Invoke-NineGridLogRetention {
  $paths = Get-NineGridDataPaths
  $cutoff = (Get-Date).AddDays(-30)
  Get-ChildItem -LiteralPath $paths.PostgresLogs -File -Filter 'ninegrid-postgres-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  $startup = Join-Path $paths.Logs 'postgres-startup.log'
  if ((Test-Path -LiteralPath $startup -PathType Leaf) -and (Get-Item -LiteralPath $startup).Length -ge 5MB) {
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $startup -Destination (Join-Path $paths.Logs "ninegrid-postgres-startup-$stamp.log")
  }
  $oldStartup = @(Get-ChildItem -LiteralPath $paths.Logs -File -Filter 'ninegrid-postgres-startup-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5)
  foreach ($file in $oldStartup) { Remove-Item -LiteralPath $file.FullName -Force }
}

function Get-NineGridRepositoryRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$script:NineGridRepoRoot = Get-NineGridRepositoryRoot
