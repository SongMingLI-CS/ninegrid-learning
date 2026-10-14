$common = Join-Path $PSScriptRoot '..\scripts\windows\common.ps1'
. $common

Describe 'NineGrid Windows storage safety' {
  It 'uses the exact persistent directories on the existing F volume' {
    $paths = Get-NineGridDataPaths
    $paths.Postgres | Should BeExactly 'F:\Projects\NineGridData\postgres'
    $paths.Uploads | Should BeExactly 'F:\Projects\NineGridData\uploads'
    $paths.Backups | Should BeExactly 'F:\Projects\NineGridData\backups'
    $paths.Logs | Should BeExactly 'F:\Projects\NineGridData\logs'
  }

  It 'allows only explicit loopback hosts for local application binding' {
    Test-NineGridLoopbackHost '127.0.0.1' | Should Be $true
    Test-NineGridLoopbackHost 'localhost' | Should Be $true
    Test-NineGridLoopbackHost '0.0.0.0' | Should Be $false
  }

  It 'rejects unsafe restore database names and the live database name' {
    Assert-NineGridSafeRestoreName -Name 'ninegrid_restore_01' -LiveName 'ninegrid_dev'
    $true | Should Be $true
    $sameNameRejected = $false
    try { Assert-NineGridSafeRestoreName -Name 'ninegrid_dev' -LiveName 'ninegrid_dev' } catch { $sameNameRejected = $true }
    $sameNameRejected | Should Be $true
    $unsafeNameRejected = $false
    try { Assert-NineGridSafeRestoreName -Name 'ninegrid;drop' -LiveName 'ninegrid_dev' } catch { $unsafeNameRejected = $true }
    $unsafeNameRejected | Should Be $true
  }

  It 'updates selected dotenv entries without changing unrelated secret values' {
    $file = Join-Path $env:TEMP ('ninegrid-env-test-' + [guid]::NewGuid().ToString('N') + '.env')
    try {
      [IO.File]::WriteAllText($file, "DEEPSEEK_API_KEY=keep-existing-value`r`nUPLOAD_DIR=D:/old/uploads`r`n# retain this comment`r`n")
      Set-NineGridDotEnvValues -Path $file -Values @{ UPLOAD_DIR = 'F:/Projects/NineGridData/uploads'; NODE_ENV = 'production' }
      $parsed = Read-NineGridDotEnv -Path $file
      $parsed.DEEPSEEK_API_KEY | Should BeExactly 'keep-existing-value'
      $parsed.UPLOAD_DIR | Should BeExactly 'F:/Projects/NineGridData/uploads'
      $parsed.NODE_ENV | Should BeExactly 'production'
      [IO.File]::ReadAllText($file) | Should Match '# retain this comment'
    }
    finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  }
}
