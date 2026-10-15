import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import AdmZip from 'adm-zip';
import {afterEach,beforeAll,expect,it} from 'vitest';

const workspace=process.cwd(),fixtureRoot=resolve('output/release-verification-tests'),fixtures:string[]=[];
const {sourceFiles}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const json=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
const powershell=join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
beforeAll(()=>{
 if(process.platform!=='win32')return;
 // A fresh Windows runner can spend over 40 seconds initializing PowerShell itself.
 // Keep that setup separate from the normal 20-second behavior checks.
 const result=spawnSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command','exit 0'],{encoding:'utf8',windowsHide:true,timeout:55000});
 expect(result.error?.message,result.stderr).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
},60000);
function fixture(){
 mkdirSync(fixtureRoot,{recursive:true});
 const root=mkdtempSync(join(fixtureRoot,'case-'));fixtures.push(root);
 for(const dir of ['scripts/release','scripts/desktop','output','release'])mkdirSync(join(root,dir),{recursive:true});
 return root;
}
afterEach(()=>{for(const root of fixtures.splice(0)){if(!root.startsWith(fixtureRoot+sep))throw new Error('Fixture escaped test root');rmSync(root,{recursive:true,force:true});}});

function deliveryFixture(version='0.7.1'){
 const root=fixture(),tag='v'+version.replaceAll('.','');
 for(const name of ['release/verify-delivery.mjs','source-files.mjs'])copyFileSync(join(workspace,'scripts',name),join(root,'scripts',name));
 writeFileSync(join(root,'package.json'),JSON.stringify({version}));
 writeFileSync(join(root,'scripts/release','release-contract-'+tag+'.json'),JSON.stringify({version,suiteTag:tag,expectedChecks:10}));
 const installer=Buffer.from('controlled installer bytes');
 writeFileSync(join(root,'release','Reclimb-Setup-'+version+'.exe'),installer);
 const zip=new AdmZip(),manifest=[];
 for(const file of sourceFiles(root)){const bytes=readFileSync(join(root,file));zip.addFile(file,bytes);manifest.push({path:file,sha256:hash(bytes)});}
 zip.addFile('SOURCE-MANIFEST.json',Buffer.from(JSON.stringify(manifest)));
 writeFileSync(join(root,'release','Reclimb-Source-'+version+'.zip'),zip.toBuffer());
 const report={installerSha256:hash(installer),packagedRuntimeDependenciesVerified:true,desktopChecksPassed:10,externalRequests:[]};
 return {root,tag,report};
}
function runDelivery(root:string){return spawnSync(process.execPath,[join(root,'scripts/release/verify-delivery.mjs')],{cwd:root,encoding:'utf8'});}

it.each([
 ['missing maintenance checks',{}],
 ['wrong packaged version',{validationStatus:'passed',applicationVersion:'0.7.0',ipcValidationChecksPassed:13}],
 ['incomplete IPC checks',{validationStatus:'passed',applicationVersion:'0.7.1',ipcValidationChecksPassed:12}],
 ['failed verification',{validationStatus:'failed',applicationVersion:'0.7.1',ipcValidationChecksPassed:13}],
])('refuses delivery when the package report has %s',(_,extra)=>{
 const {root,tag,report}=deliveryFixture();
 writeFileSync(join(root,'output','package-verification-'+tag+'.json'),JSON.stringify({...report,...extra}));
 const result=runDelivery(root);
 expect(result.status,result.stderr).not.toBe(0);
 expect(existsSync(join(root,'output','delivery-'+tag+'.json'))).toBe(false);
 expect(existsSync(join(root,'release','SHA256SUMS.txt'))).toBe(false);
});
it('delivers only after the maintenance report confirms the version and all IPC checks',()=>{
 const {root,tag,report}=deliveryFixture();
 writeFileSync(join(root,'output','package-verification-'+tag+'.json'),JSON.stringify({...report,validationStatus:'passed',applicationVersion:'0.7.1',ipcValidationChecksPassed:13}));
 const result=runDelivery(root);
 expect(result.status,result.stderr).toBe(0);
 expect(json(join(root,'output','delivery-'+tag+'.json')).packagedIpcValidationChecks).toBe(13);
});
it('keeps historical 0.7 delivery reports usable without the new maintenance fields',()=>{
 const {root,tag,report}=deliveryFixture('0.7.0');
 writeFileSync(join(root,'output','package-verification-'+tag+'.json'),JSON.stringify(report));
 const result=runDelivery(root);
 expect(result.status,result.stderr).toBe(0);
});

function wrapperFixture(){
 const root=fixture();
 for(const name of ['verify-package-v071.ps1','release-contract-v071.json'])copyFileSync(join(workspace,'scripts/release',name),join(root,'scripts/release',name));
 writeFileSync(join(root,'release','Reclimb-Setup-0.7.1.exe'),'controlled installer bytes');
 // Only the desktop/extraction boundary is replaced; the actual wrapper manages reports and child failures.
 writeFileSync(join(root,'scripts/release','verify-package-v04.ps1'),String.raw`param($PdfPath,$Installer,$SevenZip,$SuiteTag,$SmokeScript,$DesktopReportName,$ExpectedChecks)
$ErrorActionPreference='Stop'
if($env:RECLIMB_VERIFY_FAIL -eq 'base'){throw 'controlled base failure'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$artifact=Join-Path $root 'output\artifact'
New-Item -ItemType Directory -Path $artifact -Force | Out-Null
$installerPath=(Resolve-Path -LiteralPath $Installer).Path
$report=[ordered]@{validation='Packaged application extracted and exercised successfully';installer=$installerPath;installerSha256=$env:RECLIMB_VERIFY_INSTALLER_HASH;executable=(Join-Path $root 'application\packaged.exe');applicationDirectory=(Join-Path $root 'application');desktopReport=(Join-Path $artifact $DesktopReportName);packagedRuntimeDependenciesVerified=$true;desktopChecksPassed=$ExpectedChecks;externalRequests=@()}
$text=$report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $artifact 'package-verification.json'),$text)
[IO.File]::WriteAllText((Join-Path $root ('output\package-verification-'+$SuiteTag+'.json')),$text)
`);
 writeFileSync(join(root,'scripts/release','verify-packaged-dependencies.mjs'),"if(process.env.RECLIMB_VERIFY_FAIL==='version')process.exitCode=23;");
 writeFileSync(join(root,'scripts/desktop','smoke-ipc-validation.mjs'),`import {writeFileSync} from 'node:fs';
if(process.env.RECLIMB_TEST_EXECUTABLE!==process.env.RECLIMB_VERIFY_EXPECTED_EXE)throw new Error('wrong executable');
if(process.env.RECLIMB_VERIFY_FAIL==='ipc')process.exitCode=24;
if(process.env.RECLIMB_VERIFY_FAIL==='hash')writeFileSync(process.env.RECLIMB_VERIFY_INSTALLER,'changed during IPC');`);
 writeFileSync(join(root,'output','package-verification-v071.json'),JSON.stringify({validationStatus:'passed',applicationVersion:'0.7.1',ipcValidationChecksPassed:13}));
 return root;
}
function runWrapper(root:string,fail=''){
 const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts/release/verify-package-v071.ps1')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,RECLIMB_VERIFY_FAIL:fail,RECLIMB_VERIFY_EXPECTED_EXE:join(root,'application','packaged.exe'),RECLIMB_VERIFY_INSTALLER:join(root,'release','Reclimb-Setup-0.7.1.exe'),RECLIMB_VERIFY_INSTALLER_HASH:hash(readFileSync(join(root,'release','Reclimb-Setup-0.7.1.exe')))}});
 if(result.error)throw new Error('Packaged verification subprocess failed: '+result.error.message);
 return result;
}
it.skipIf(process.platform!=='win32').each(['base','version','ipc','hash'])('invalidates any final success report after a %s failure',stage=>{
 const root=wrapperFixture(),result=runWrapper(root,stage);
 expect(result.status,result.stderr).not.toBe(0);
 expect(json(join(root,'output','package-verification-v071.json')).validationStatus).toBe('failed');
 if(stage!=='base')expect(json(join(root,'output','artifact','package-verification.json')).validationStatus).toBe('failed');
});
it.skipIf(process.platform!=='win32')('publishes matching final and artifact reports after every packaged check succeeds',()=>{
 const root=wrapperFixture(),result=runWrapper(root);
 expect(result.status,result.stderr).toBe(0);
 const report=json(join(root,'output','package-verification-v071.json'));
 expect(report).toMatchObject({validationStatus:'passed',applicationVersion:'0.7.1',ipcValidationChecksPassed:13});
 expect(report.installerSha256.toLowerCase()).toBe(hash(readFileSync(join(root,'release','Reclimb-Setup-0.7.1.exe'))));
 expect(json(join(root,'output','artifact','package-verification.json'))).toEqual(report);
});
