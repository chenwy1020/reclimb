[CmdletBinding()]
param(
  [string]$PdfPath,
  [string]$Installer = 'release\Reclimb-Setup-0.4.0.exe',
  [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe',
  [string]$SuiteTag = 'v040',
  [string]$SmokeScript = 'smoke-v04.mjs',
  [string]$DesktopReportName = 'desktop-verification-v04.json',
  [int]$ExpectedChecks = 62
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspace
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$pdfSourcePath = if($PdfPath) { (Resolve-Path -LiteralPath $PdfPath).Path } else { $null }
$sevenZipPath = (Resolve-Path -LiteralPath $SevenZip).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$outputRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'output'))
$extractionDirectory = [IO.Path]::GetFullPath((Join-Path $outputRoot ('package-' + $SuiteTag + '-' + $stamp)))
$artifactDirectory = [IO.Path]::GetFullPath((Join-Path $outputRoot ('playwright\' + $SuiteTag + '-package-' + $stamp)))
foreach($directory in @($extractionDirectory,$artifactDirectory)) {
  if(-not $directory.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'The output directory must remain inside this workspace output folder.' }
  if(Test-Path -LiteralPath $directory) { throw ('Refusing to overwrite an existing validation directory: ' + $directory) }
  New-Item -ItemType Directory -Path $directory | Out-Null
}
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
$installerBytes = (Get-Item -LiteralPath $installerPath).Length
$productExecutableName = ([string][char]0x91CD) + ([string][char]0x767B) + '.exe'

# Treat the installer as an archive. This check never executes the NSIS installer.
& $sevenZipPath x $installerPath ('-o' + $extractionDirectory) -y | Out-File -LiteralPath (Join-Path $artifactDirectory 'extraction.log') -Encoding utf8
if($LASTEXITCODE -ne 0) { throw ('Archive extraction failed with exit code ' + $LASTEXITCODE) }

function Get-CheckedExtractionPath([string]$Candidate) {
  $full = [IO.Path]::GetFullPath($Candidate)
  $boundary = $extractionDirectory + [IO.Path]::DirectorySeparatorChar
  if(-not $full.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'An application archive or executable path escaped this extraction directory.' }
  $cursor = $full
  while($cursor -ne $extractionDirectory) {
    if(Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not allowed in the extracted application path.' }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if(-not $parent -or $parent -eq $cursor) { throw 'Cannot resolve the extracted application path inside its directory.' }
    $cursor = $parent
  }
  return $full
}

$applicationDirectory = $extractionDirectory
$executable = Get-CheckedExtractionPath (Join-Path $extractionDirectory $productExecutableName)
if(-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  $embeddedArchive = Get-CheckedExtractionPath (Join-Path $extractionDirectory '$PLUGINSDIR\app-64.7z')
  if(-not (Test-Path -LiteralPath $embeddedArchive -PathType Leaf)) { throw 'Neither a root application nor the expected NSIS app-64.7z payload was found.' }
  $applicationDirectory = Get-CheckedExtractionPath (Join-Path $extractionDirectory 'application')
  if(Test-Path -LiteralPath $applicationDirectory) { throw 'Refusing to overwrite the second-stage application directory.' }
  New-Item -ItemType Directory -Path $applicationDirectory | Out-Null
  & $sevenZipPath x $embeddedArchive ('-o' + $applicationDirectory) -y | Out-File -LiteralPath (Join-Path $artifactDirectory 'application-extraction.log') -Encoding utf8
  if($LASTEXITCODE -ne 0) { throw ('Embedded application extraction failed with exit code ' + $LASTEXITCODE) }
  $executable = Get-CheckedExtractionPath (Join-Path $applicationDirectory $productExecutableName)
}
if(-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'The actual application executable was not found after extraction.' }
$appAsar = Get-CheckedExtractionPath (Join-Path $applicationDirectory 'resources\app.asar')
if(-not (Test-Path -LiteralPath $appAsar -PathType Leaf)) { throw 'The packaged app.asar was not found.' }
& node (Join-Path $workspace 'scripts\verify-packaged-dependencies.mjs') $appAsar
if($LASTEXITCODE -ne 0) { throw ('Packaged runtime dependency validation failed with exit code ' + $LASTEXITCODE) }

$previousExecutable = $env:RECLIMB_TEST_EXECUTABLE
$previousPdf = $env:RECLIMB_TEST_PDF
$previousArtifact = $env:RECLIMB_TEST_ARTIFACT_DIR
try {
  $env:RECLIMB_TEST_EXECUTABLE = $executable
  $env:RECLIMB_TEST_PDF = $pdfSourcePath
  $env:RECLIMB_TEST_ARTIFACT_DIR = $artifactDirectory
  & node (Join-Path $workspace ('scripts\' + $SmokeScript))
  if($LASTEXITCODE -ne 0) { throw ('Packaged desktop validation failed with exit code ' + $LASTEXITCODE) }
} finally {
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_EXECUTABLE',$previousExecutable,'Process')
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_PDF',$previousPdf,'Process')
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_ARTIFACT_DIR',$previousArtifact,'Process')
}
if((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $installerHash) { throw 'The installer changed during validation; no final package report will be published.' }

$desktopReport = Join-Path $artifactDirectory $DesktopReportName
$desktop = Get-Content -LiteralPath $desktopReport -Raw -Encoding UTF8 | ConvertFrom-Json
if($desktop.executable -ne $executable -or $desktop.passed -ne $ExpectedChecks -or @($desktop.externalRequests).Count -ne 0) { throw 'The desktop report did not satisfy the required packaged validation contract.' }
$report = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  validation = 'Packaged application extracted and exercised successfully'
  installer = $installerPath
  installerBytes = $installerBytes
  installerSha256 = $installerHash
  executable = $executable
  extractionDirectory = $extractionDirectory
  applicationDirectory = $applicationDirectory
  nsisInstallerExecuted = $false
  freshWindowsInstallationVerified = $false
  packagedRuntimeDependenciesVerified = $true
  desktopChecksPassed = $desktop.passed
  localMockRequests = $desktop.localMockRequests
  externalRequests = @($desktop.externalRequests)
  desktopReport = $desktopReport
  limits = @('The installer was not executed and this does not establish a fresh Windows installation.','Teaching and vision used only a local mock; software-flow checks do not establish learning effectiveness.')
}
$json = $report | ConvertTo-Json -Depth 8
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $artifactDirectory 'package-verification.json'),$json,$utf8)
[IO.File]::WriteAllText((Join-Path $outputRoot ('package-verification-' + $SuiteTag + '.json')),$json,$utf8)
$report | ConvertTo-Json -Depth 8
