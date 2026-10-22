[CmdletBinding()]
param(
  [string]$PdfPath,
  [string]$Installer = 'release\Reclimb-Setup-0.4.1.exe',
  [string]$SevenZip = '.builder-cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'
)
$ErrorActionPreference = 'Stop'
$arguments = @{
  PdfPath = $PdfPath
  Installer = $Installer
  SevenZip = $SevenZip
  SuiteTag = 'v041'
  SmokeScript = 'smoke-v041.mjs'
  DesktopReportName = 'desktop-verification-v041.json'
  ExpectedChecks = 66
}
& (Join-Path $PSScriptRoot 'verify-package-v04.ps1') @arguments
