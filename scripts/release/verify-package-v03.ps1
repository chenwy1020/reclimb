[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PdfPath,
  [string]$Installer = 'release\Reclimb-Setup-0.3.0.exe',
  [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $workspace
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$pdfSourcePath = (Resolve-Path -LiteralPath $PdfPath).Path
$sevenZipPath = (Resolve-Path -LiteralPath $SevenZip).Path
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$outputRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'output'))
$extractionDirectory = [IO.Path]::GetFullPath((Join-Path $outputRoot ('package-v03-' + $stamp)))
$artifactDirectory = [IO.Path]::GetFullPath((Join-Path $outputRoot ('playwright\v03-package-' + $stamp)))
foreach($directory in @($extractionDirectory,$artifactDirectory)) {
  if(-not $directory.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'The output directory must remain inside this workspace output folder.' }
  if(Test-Path -LiteralPath $directory) { throw ('Refusing to overwrite an existing validation directory: ' + $directory) }
  New-Item -ItemType Directory -Path $directory | Out-Null
}
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
$installerBytes = (Get-Item -LiteralPath $installerPath).Length
# Read the embedded archive as data. Never execute the NSIS installer.
& $sevenZipPath x $installerPath ('-o' + $extractionDirectory) -y | Out-File -LiteralPath (Join-Path $artifactDirectory 'extraction.log') -Encoding utf8
if($LASTEXITCODE -ne 0) { throw ('Archive extraction failed with exit code ' + $LASTEXITCODE) }
# Some 7za versions expose the application directly; others expose the NSIS payload first.
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
$executable = Get-CheckedExtractionPath (Join-Path $extractionDirectory '重登.exe')
if(-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  $embeddedArchive = Get-CheckedExtractionPath (Join-Path $extractionDirectory '$PLUGINSDIR\app-64.7z')
  if(-not (Test-Path -LiteralPath $embeddedArchive -PathType Leaf)) { throw 'Neither a root application nor the expected NSIS app-64.7z payload was found.' }
  $applicationDirectory = Get-CheckedExtractionPath (Join-Path $extractionDirectory 'application')
  if(Test-Path -LiteralPath $applicationDirectory) { throw 'Refusing to overwrite the second-stage application directory.' }
  New-Item -ItemType Directory -Path $applicationDirectory | Out-Null
  # The nested archive is still data: run 7za only, never the NSIS executable.
  & $sevenZipPath x $embeddedArchive ('-o' + $applicationDirectory) -y | Out-File -LiteralPath (Join-Path $artifactDirectory 'application-extraction.log') -Encoding utf8
  if($LASTEXITCODE -ne 0) { throw ('Embedded application extraction failed with exit code ' + $LASTEXITCODE) }
  $executable = Get-CheckedExtractionPath (Join-Path $applicationDirectory '重登.exe')
}
if(-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'The actual application executable was not found after extraction.' }
$previousExecutable = $env:RECLIMB_TEST_EXECUTABLE
$previousPdf = $env:RECLIMB_TEST_PDF
$previousArtifact = $env:RECLIMB_TEST_ARTIFACT_DIR
try {
  $env:RECLIMB_TEST_EXECUTABLE = $executable
  $env:RECLIMB_TEST_PDF = $pdfSourcePath
  $env:RECLIMB_TEST_ARTIFACT_DIR = $artifactDirectory
  & node (Join-Path $workspace 'scripts\desktop\smoke-v03.mjs')
  if($LASTEXITCODE -ne 0) { throw ('Packaged desktop validation failed with exit code ' + $LASTEXITCODE) }
} finally {
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_EXECUTABLE',$previousExecutable,'Process')
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_PDF',$previousPdf,'Process')
  [Environment]::SetEnvironmentVariable('RECLIMB_TEST_ARTIFACT_DIR',$previousArtifact,'Process')
}
if((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $installerHash) { throw 'The installer changed during validation; no final package report will be published.' }
$desktopReport = Join-Path $artifactDirectory 'desktop-verification-v03.json'
$desktop = Get-Content -LiteralPath $desktopReport -Raw | ConvertFrom-Json
if($desktop.executable -ne $executable -or $desktop.passed -ne 45 -or @($desktop.externalRequests).Count -ne 0) { throw 'The desktop report did not satisfy the final 45-check packaged validation contract.' }
$report = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  validation = '安装包内实际应用解包运行通过'
  installer = $installerPath
  installerBytes = $installerBytes
  installerSha256 = $installerHash
  executable = $executable
  extractionDirectory = $extractionDirectory
  applicationDirectory = $applicationDirectory
  nsisInstallerExecuted = $false
  freshWindowsInstallationVerified = $false
  desktopChecksPassed = $desktop.passed
  localMockRequests = $desktop.localMockRequests
  externalRequests = @($desktop.externalRequests)
  desktopReport = $desktopReport
  limits = @('未执行安装器，未改动已有安装；本次不代表全新 Windows 安装验证。','教学与视觉仅使用本地模拟服务，软件流程通过不证明真实教学或跨日学习效果。')
}
$json = $report | ConvertTo-Json -Depth 8
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $artifactDirectory 'package-verification.json'),$json,$utf8)
[IO.File]::WriteAllText((Join-Path $outputRoot 'package-verification-v03.json'),$json,$utf8)
$report | ConvertTo-Json -Depth 8
