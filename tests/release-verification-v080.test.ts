import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const workspace = process.cwd(), fixtureRoot = resolve('output/release-v080-tests'), fixtures: string[] = [];
const { sourceFiles } = await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
describe.each(['0.8.0', '0.8.1'])('0.8 package verification for %s', (version) => {
const suiteTag = 'v' + version.replaceAll('.', '');
const contract = { version, suiteTag, expectedChecks: 10, smokeScript: 'smoke-v070.mjs', desktopReportName: 'desktop-verification-v070.json', expectedProductChecks: 9, productSmokeScript: 'smoke-product-review.mjs', productReportName: 'verification.json', ipcValidationChecks: 13, ipcReportName: 'ipc-validation.json', testScope: 'full', targetTests: [] };
beforeAll(() => {
  if (process.platform !== 'win32') return;
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8', windowsHide: true, timeout: 55000 });
  expect(result.error?.message, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}, 60000);
function fixture() {
  mkdirSync(fixtureRoot, { recursive: true });
  const root = mkdtempSync(join(fixtureRoot, 'case-')); fixtures.push(root);
  for (const dir of ['scripts/release', 'scripts/desktop', 'output', 'release']) mkdirSync(join(root, dir), { recursive: true });
  return root;
}
afterEach(() => { for (const root of fixtures.splice(0)) { if (!root.startsWith(fixtureRoot + sep)) throw new Error('Fixture escaped test root'); rmSync(root, { recursive: true, force: true }); } });
function deliveryFixture() {
  const root = fixture();
  for (const name of ['release/verify-delivery.mjs', 'source-files.mjs']) copyFileSync(join(workspace, 'scripts', name), join(root, 'scripts', name));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: contract.version }));
  writeFileSync(join(root, `scripts/release/release-contract-${suiteTag}.json`), JSON.stringify(contract));
  const installer = Buffer.from('controlled 0.8 installer bytes');
  writeFileSync(join(root, `release/Reclimb-Setup-${version}.exe`), installer);
  const zip = new AdmZip(), manifest = [];
  for (const file of sourceFiles(root)) { const bytes = readFileSync(join(root, file)); zip.addFile(file, bytes); manifest.push({ path: file, sha256: hash(bytes) }); }
  zip.addFile('SOURCE-MANIFEST.json', Buffer.from(JSON.stringify(manifest)));
  writeFileSync(join(root, `release/Reclimb-Source-${version}.zip`), zip.toBuffer());
  const executable = join(root, 'application/packaged.exe');
  const report = { installerSha256: hash(installer), packagedRuntimeDependenciesVerified: true, desktopChecksPassed: 10, externalRequests: [], executable, validationStatus: 'passed', applicationVersion: version, productChecksPassed: 9, productExecutable: executable, productExternalRequests: [], productRendererErrors: [], ipcValidationChecksPassed: 13, ipcExecutable: executable, ipcExternalRequests: [] };
  return { root, report };
}
it.each([
  ['wrong version', { applicationVersion: '0.7.1' }], ['missing final success', { validationStatus: undefined }],
  ['incomplete product checks', { productChecksPassed: 8 }], ['wrong product executable', { productExecutable: 'development-electron' }],
  ['product renderer error', { productRendererErrors: ['unhandled error'] }], ['product external request', { productExternalRequests: ['https://example.invalid'] }],
  ['incomplete IPC checks', { ipcValidationChecksPassed: 12 }], ['wrong IPC executable', { ipcExecutable: 'development-electron' }],
  ['IPC external request', { ipcExternalRequests: ['https://example.invalid'] }],
])('refuses the 0.8 delivery report with %s', (_, extra) => {
  const { root, report } = deliveryFixture();
  writeFileSync(join(root, `output/package-verification-${suiteTag}.json`), JSON.stringify({ ...report, ...extra }));
  const result = spawnSync(process.execPath, [join(root, 'scripts/release/verify-delivery.mjs')], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stderr).not.toBe(0);
  expect(existsSync(join(root, `output/delivery-${suiteTag}.json`))).toBe(false);
  expect(existsSync(join(root, 'release/SHA256SUMS.txt'))).toBe(false);
});
it('delivers only with the packaged product, knowledge and IPC results bound to one executable', () => {
  const { root, report } = deliveryFixture();
  writeFileSync(join(root, `output/package-verification-${suiteTag}.json`), JSON.stringify(report));
  const result = spawnSync(process.execPath, [join(root, 'scripts/release/verify-delivery.mjs')], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(json(join(root, `output/delivery-${suiteTag}.json`))).toMatchObject({ applicationVersion: version, packagedProductChecks: 9, packagedDesktopChecks: 10, packagedIpcValidationChecks: 13 });
});
function wrapperFixture() {
  const root = fixture();
  copyFileSync(join(workspace, 'scripts/release/verify-package-v080.ps1'), join(root, 'scripts/release/verify-package-v080.ps1'));
  writeFileSync(join(root, `scripts/release/release-contract-${suiteTag}.json`), JSON.stringify(contract));
  writeFileSync(join(root, `release/Reclimb-Setup-${version}.exe`), 'controlled installer bytes');
  writeFileSync(join(root, 'scripts/release/verify-package-v04.ps1'), String.raw`param($PdfPath,$Installer,$SevenZip,$SuiteTag,$SmokeScript,$DesktopReportName,$ExpectedChecks)
$ErrorActionPreference='Stop'
if($env:RECLIMB_VERIFY_FAIL -eq 'base'){throw 'controlled base failure'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$artifact=Join-Path $root 'output\artifact'
New-Item -ItemType Directory -Path $artifact -Force | Out-Null
$report=[ordered]@{installer=(Resolve-Path -LiteralPath $Installer).Path;installerSha256=$env:RECLIMB_VERIFY_INSTALLER_HASH;executable=(Join-Path $root 'application\packaged.exe');applicationDirectory=(Join-Path $root 'application');desktopReport=(Join-Path $artifact $DesktopReportName);packagedRuntimeDependenciesVerified=$true;desktopChecksPassed=$ExpectedChecks;externalRequests=@()}
$text=$report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $artifact 'package-verification.json'),$text)
[IO.File]::WriteAllText((Join-Path $root ('output\package-verification-'+$SuiteTag+'.json')),$text)
`);
  writeFileSync(join(root, 'scripts/release/verify-packaged-dependencies.mjs'), "if(process.env.RECLIMB_VERIFY_FAIL==='version')process.exitCode=23;");
  for (const [stage, name, count, reportName] of [['product', 'smoke-product-review.mjs', 9, 'verification.json'], ['ipc', 'smoke-ipc-validation.mjs', 13, 'ipc-validation.json']] as const) {
    writeFileSync(join(root, 'scripts/desktop', name), `import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const stage=${JSON.stringify(stage)}, failure=process.env.RECLIMB_VERIFY_FAIL;
if(process.env.RECLIMB_TEST_EXECUTABLE!==process.env.RECLIMB_VERIFY_EXPECTED_EXE)throw new Error('wrong executable');
if(failure===stage)process.exit(24);
mkdirSync(process.env.RECLIMB_TEST_ARTIFACT_DIR,{recursive:true});
writeFileSync(join(process.env.RECLIMB_TEST_ARTIFACT_DIR,${JSON.stringify(reportName)}),JSON.stringify({validationStatus:'passed',passed:failure===stage+'-count'?0:${count},executable:failure===stage+'-executable'?'development-electron':process.env.RECLIMB_TEST_EXECUTABLE,externalRequests:[],rendererErrors:[]}));
if(stage==='ipc'&&failure==='hash')writeFileSync(process.env.RECLIMB_VERIFY_INSTALLER,'changed installer');`);
  }
  writeFileSync(join(root, `output/package-verification-${suiteTag}.json`), JSON.stringify({ validationStatus: 'passed' }));
  return root;
}
function runWrapper(root: string, fail = '') {
  const installer = join(root, `release/Reclimb-Setup-${version}.exe`);
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/release/verify-package-v080.ps1'), ...(version === '0.8.0' ? [] : ['-Version', version])], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, RECLIMB_VERIFY_FAIL: fail, RECLIMB_VERIFY_EXPECTED_EXE: join(root, 'application/packaged.exe'), RECLIMB_VERIFY_INSTALLER: installer, RECLIMB_VERIFY_INSTALLER_HASH: hash(readFileSync(installer)) } });
  if (result.error) throw result.error;
  return result;
}
it.skipIf(process.platform !== 'win32').each(['base', 'version', 'product', 'product-count', 'product-executable', 'ipc', 'ipc-count', 'ipc-executable', 'hash'])('invalidates all final reports after a %s failure', (stage) => {
  const root = wrapperFixture(), result = runWrapper(root, stage);
  expect(result.status, result.stderr).not.toBe(0);
  expect(json(join(root, `output/package-verification-${suiteTag}.json`)).validationStatus).toBe('failed');
  if (stage !== 'base') expect(json(join(root, 'output/artifact/package-verification.json')).validationStatus).toBe('failed');
});
it.skipIf(process.platform !== 'win32')('publishes final success only after all three packaged suites succeed', () => {
  const root = wrapperFixture(), result = runWrapper(root);
  expect(result.status, result.stderr).toBe(0);
  const report = json(join(root, `output/package-verification-${suiteTag}.json`));
  expect(report).toMatchObject({ validationStatus: 'passed', applicationVersion: version, productChecksPassed: 9, desktopChecksPassed: 10, ipcValidationChecksPassed: 13 });
  expect(report.productExecutable).toBe(report.executable);
  expect(report.ipcExecutable).toBe(report.executable);
  expect(json(join(root, 'output/artifact/package-verification.json'))).toEqual(report);
});
});
