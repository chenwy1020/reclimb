[CmdletBinding()]
param(
  [string]$PdfPath,
  [string]$Installer = 'release\Reclimb-Setup-0.4.9.exe',
  [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$contract = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-contract-v049.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$arguments = @{
  PdfPath = $PdfPath
  Installer = $Installer
  SevenZip = $SevenZip
  SuiteTag = [string]$contract.suiteTag
  SmokeScript = [string]$contract.smokeScript
  DesktopReportName = [string]$contract.desktopReportName
  ExpectedChecks = [int]$contract.expectedChecks
}
& (Join-Path $PSScriptRoot 'verify-package-v04.ps1') @arguments
