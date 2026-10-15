[CmdletBinding()]
param(
 [string]$PdfPath,
 [string]$Installer = 'release\Reclimb-Setup-0.7.1.exe',
 [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$contract = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-contract-v071.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$reportPath = Join-Path $workspace 'output\package-verification-v071.json'
$baseTag = $contract.suiteTag + '-base'
$baseReportPath = Join-Path $workspace ('output\package-verification-' + $baseTag + '.json')
$artifactReportPath = $null
$report = $null

function Write-VerificationReport([string]$Path,[object]$Value) {
 $temporaryPath = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
 try {
  [IO.File]::WriteAllText($temporaryPath,($Value | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  if([IO.File]::Exists($Path)) { [IO.File]::Replace($temporaryPath,$Path,[NullString]::Value) }
  else { [IO.File]::Move($temporaryPath,$Path) }
 } finally {
  if([IO.File]::Exists($temporaryPath)) { [IO.File]::Delete($temporaryPath) }
 }
}
function Get-InstallerHash([string]$Path) {
 $stream = [IO.File]::OpenRead($Path)
 try {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','') }
  finally { $algorithm.Dispose() }
 } finally { $stream.Dispose() }
}

[IO.Directory]::CreateDirectory((Split-Path -Parent $reportPath)) | Out-Null
# Invalidate a previous result before starting another attempt on the same installer.
Write-VerificationReport $reportPath ([ordered]@{at=[DateTime]::UtcNow.ToString('o');validationStatus='pending';validation='Packaged maintenance verification is in progress'})
$previousExecutable = $env:RECLIMB_TEST_EXECUTABLE
try {
 # The shared validator's two reports describe only the base desktop stage.
 & (Join-Path $PSScriptRoot 'verify-package-v04.ps1') -PdfPath $PdfPath -Installer $Installer -SevenZip $SevenZip -SuiteTag $baseTag -SmokeScript $contract.smokeScript -DesktopReportName $contract.desktopReportName -ExpectedChecks $contract.expectedChecks | Out-Null
 $report = Get-Content -LiteralPath $baseReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $artifactReportPath = Join-Path (Split-Path -Parent $report.desktopReport) 'package-verification.json'
 $report | Add-Member -NotePropertyName validationStatus -NotePropertyValue 'pending' -Force
 $report.validation = 'Base desktop checks passed; maintenance checks are pending'
 Write-VerificationReport $baseReportPath $report
 Write-VerificationReport $artifactReportPath $report

 & node (Join-Path $PSScriptRoot 'verify-packaged-dependencies.mjs') (Join-Path $report.applicationDirectory 'resources\app.asar') $contract.version
 if($LASTEXITCODE -ne 0) { throw 'Packaged version or ZIP dependency validation failed.' }
 # Exercise the fixed IPC boundary in the exact application extracted above.
 $env:RECLIMB_TEST_EXECUTABLE = $report.executable
 & node (Join-Path $PSScriptRoot '../desktop/smoke-ipc-validation.mjs')
 if($LASTEXITCODE -ne 0) { throw 'Packaged IPC validation failed.' }
 if((Get-InstallerHash $report.installer) -ne $report.installerSha256) { throw 'The installer changed during maintenance validation; this package cannot be delivered.' }

 $report | Add-Member -NotePropertyName ipcValidationChecksPassed -NotePropertyValue 13 -Force
 $report | Add-Member -NotePropertyName applicationVersion -NotePropertyValue $contract.version -Force
 $report.validationStatus = 'passed'
 $report.validation = 'Packaged application, version, runtime dependencies and IPC boundary verified successfully'
 $report | Add-Member -NotePropertyName at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
 Write-VerificationReport $baseReportPath $report
 Write-VerificationReport $artifactReportPath $report
 # Publish the delivery entry point last, once every check has succeeded.
 Write-VerificationReport $reportPath $report
 $report | ConvertTo-Json -Depth 8
} catch {
 $failure = [ordered]@{at=[DateTime]::UtcNow.ToString('o');validationStatus='failed';validation='Packaged maintenance verification failed; this report cannot be used for delivery';error=$_.Exception.Message}
 Write-VerificationReport $reportPath $failure
 if($report) { Write-VerificationReport $baseReportPath $failure }
 if($artifactReportPath) { Write-VerificationReport $artifactReportPath $failure }
 throw
} finally {
 [Environment]::SetEnvironmentVariable('RECLIMB_TEST_EXECUTABLE',$previousExecutable,'Process')
}
