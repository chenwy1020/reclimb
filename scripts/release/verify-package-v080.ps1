[CmdletBinding()]
param(
 [string]$PdfPath,
 [string]$Installer = 'release\Reclimb-Setup-0.8.0.exe',
 [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$contract = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-contract-v080.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$reportPath = Join-Path $workspace 'output\package-verification-v080.json'
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
function Read-SuiteReport([string]$Path,[int]$ExpectedChecks,[bool]$CheckRenderer) {
 $suite = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
 if($suite.validationStatus -ne 'passed' -or $suite.passed -ne $ExpectedChecks -or $suite.executable -cne $report.executable -or $null -eq $suite.externalRequests -or @($suite.externalRequests).Count -ne 0) {
  throw ('Packaged suite report does not match the required executable and complete checks: ' + $Path)
 }
 if($CheckRenderer -and ($null -eq $suite.rendererErrors -or @($suite.rendererErrors).Count -ne 0)) { throw 'The product suite reported renderer errors.' }
 return $suite
}

[IO.Directory]::CreateDirectory((Split-Path -Parent $reportPath)) | Out-Null
Write-VerificationReport $reportPath ([ordered]@{at=[DateTime]::UtcNow.ToString('o');validationStatus='pending';validation='Packaged 0.8 verification is in progress'})
$previousExecutable = $env:RECLIMB_TEST_EXECUTABLE
$previousArtifactDirectory = $env:RECLIMB_TEST_ARTIFACT_DIR
try {
 if($contract.version -ne '0.8.0' -or $contract.suiteTag -ne 'v080' -or $contract.expectedChecks -ne 10 -or $contract.expectedProductChecks -ne 9 -or $contract.ipcValidationChecks -ne 13) { throw 'The 0.8 release contract is invalid.' }
 # Extract once; all three suites must use this exact packaged application.
 & (Join-Path $PSScriptRoot 'verify-package-v04.ps1') -PdfPath $PdfPath -Installer $Installer -SevenZip $SevenZip -SuiteTag $baseTag -SmokeScript $contract.smokeScript -DesktopReportName $contract.desktopReportName -ExpectedChecks $contract.expectedChecks | Out-Null
 $report = Get-Content -LiteralPath $baseReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
 $artifactDirectory = Split-Path -Parent $report.desktopReport
 $artifactReportPath = Join-Path $artifactDirectory 'package-verification.json'
 $report | Add-Member -NotePropertyName validationStatus -NotePropertyValue 'pending' -Force
 $report | Add-Member -NotePropertyName validation -NotePropertyValue 'Knowledge checks passed; product, version and IPC checks are pending' -Force
 Write-VerificationReport $baseReportPath $report
 Write-VerificationReport $artifactReportPath $report

 & node (Join-Path $PSScriptRoot 'verify-packaged-dependencies.mjs') (Join-Path $report.applicationDirectory 'resources\app.asar') $contract.version
 if($LASTEXITCODE -ne 0) { throw 'Packaged version or runtime dependency validation failed.' }
 $env:RECLIMB_TEST_EXECUTABLE = $report.executable
 $env:RECLIMB_TEST_ARTIFACT_DIR = Join-Path $artifactDirectory 'product'
 if(Test-Path -LiteralPath $env:RECLIMB_TEST_ARTIFACT_DIR) { throw 'Refusing to reuse a product verification directory.' }
 & node (Join-Path $PSScriptRoot ('../desktop/' + $contract.productSmokeScript))
 if($LASTEXITCODE -ne 0) { throw 'Packaged product verification failed.' }
 $productReportPath = Join-Path $env:RECLIMB_TEST_ARTIFACT_DIR $contract.productReportName
 $product = Read-SuiteReport $productReportPath $contract.expectedProductChecks $true

 $env:RECLIMB_TEST_ARTIFACT_DIR = Join-Path $artifactDirectory 'ipc'
 if(Test-Path -LiteralPath $env:RECLIMB_TEST_ARTIFACT_DIR) { throw 'Refusing to reuse an IPC verification directory.' }
 & node (Join-Path $PSScriptRoot '../desktop/smoke-ipc-validation.mjs')
 if($LASTEXITCODE -ne 0) { throw 'Packaged IPC validation failed.' }
 $ipcReportPath = Join-Path $env:RECLIMB_TEST_ARTIFACT_DIR $contract.ipcReportName
 $ipc = Read-SuiteReport $ipcReportPath $contract.ipcValidationChecks $false
 if((Get-InstallerHash $report.installer) -ne $report.installerSha256) { throw 'The installer changed during verification; this package cannot be delivered.' }

 $report | Add-Member -NotePropertyName productChecksPassed -NotePropertyValue $product.passed -Force
 $report | Add-Member -NotePropertyName productExecutable -NotePropertyValue $product.executable -Force
 $report | Add-Member -NotePropertyName productExternalRequests -NotePropertyValue @($product.externalRequests) -Force
 $report | Add-Member -NotePropertyName productRendererErrors -NotePropertyValue @($product.rendererErrors) -Force
 $report | Add-Member -NotePropertyName productDesktopReport -NotePropertyValue $productReportPath -Force
 $report | Add-Member -NotePropertyName ipcValidationChecksPassed -NotePropertyValue $ipc.passed -Force
 $report | Add-Member -NotePropertyName ipcExecutable -NotePropertyValue $ipc.executable -Force
 $report | Add-Member -NotePropertyName ipcExternalRequests -NotePropertyValue @($ipc.externalRequests) -Force
 $report | Add-Member -NotePropertyName ipcReport -NotePropertyValue $ipcReportPath -Force
 $report | Add-Member -NotePropertyName applicationVersion -NotePropertyValue $contract.version -Force
 $report.validationStatus = 'passed'
 $report.validation = 'Packaged product, knowledge, version, runtime dependencies and IPC boundary verified successfully'
 $report | Add-Member -NotePropertyName at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
 Write-VerificationReport $baseReportPath $report
 Write-VerificationReport $artifactReportPath $report
 # Publish the delivery entry point last, after every required result has been checked.
 Write-VerificationReport $reportPath $report
 $report | ConvertTo-Json -Depth 8
} catch {
 $failure = [ordered]@{at=[DateTime]::UtcNow.ToString('o');validationStatus='failed';validation='Packaged verification failed; this report cannot be used for delivery';error=$_.Exception.Message}
 Write-VerificationReport $reportPath $failure
 if($report) { Write-VerificationReport $baseReportPath $failure }
 if($artifactReportPath) { Write-VerificationReport $artifactReportPath $failure }
 throw
} finally {
 [Environment]::SetEnvironmentVariable('RECLIMB_TEST_EXECUTABLE',$previousExecutable,'Process')
 [Environment]::SetEnvironmentVariable('RECLIMB_TEST_ARTIFACT_DIR',$previousArtifactDirectory,'Process')
}
