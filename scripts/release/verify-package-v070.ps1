[CmdletBinding()]
param(
 [string]$PdfPath,
 [string]$Installer = 'release\Reclimb-Setup-0.7.0.exe',
 [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$contract = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-contract-v070.json') -Raw -Encoding UTF8 | ConvertFrom-Json
& (Join-Path $PSScriptRoot 'verify-package-v04.ps1') -PdfPath $PdfPath -Installer $Installer -SevenZip $SevenZip -SuiteTag $contract.suiteTag -SmokeScript $contract.smokeScript -DesktopReportName $contract.desktopReportName -ExpectedChecks $contract.expectedChecks
