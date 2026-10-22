import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';

const {sourceFiles}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const {selectTestProfile}=await import(pathToFileURL(resolve('scripts/validation/test-profile.mjs')).href);

it('preserves the historical 0.7.1 full-regression delivery contract',()=>{
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v071.json','utf8'));
 expect(contract).toEqual({version:'0.7.1',suiteTag:'v071',expectedChecks:10,smokeScript:'smoke-v070.mjs',desktopReportName:'desktop-verification-v070.json',testScope:'full',targetTests:[]});
 expect(selectTestProfile(contract.version)).toEqual({scope:contract.testScope,tests:contract.targetTests});
});

it('ships the maintenance verification entry point, dependency checks and upgrade guidance',()=>{
 const files=sourceFiles();
 for(const file of ['scripts/release/release-contract-v071.json','scripts/release/verify-package-v071.ps1','scripts/release/verify-packaged-dependencies.mjs','scripts/desktop/smoke-ipc-validation.mjs','docs/guides/使用说明-0.7.1.md','docs/verification/验证记录-0.7.1.md']){
  expect(existsSync(file),file).toBe(true);
  expect(files,file).toContain(file);
 }
 const verifier=readFileSync('scripts/release/verify-package-v071.ps1','utf8');
 expect(verifier).toContain('Reclimb-Setup-0.7.1.exe');
 expect(verifier).toContain('release-contract-v071.json');
 expect(verifier).toContain('verify-packaged-dependencies.mjs');
 expect(verifier).toContain('$contract.version');
 expect(verifier).toContain('$env:RECLIMB_TEST_EXECUTABLE = $report.executable');
 expect(verifier).toContain('smoke-ipc-validation.mjs');
 const index=readFileSync('docs/README.md','utf8');
 for(const file of ['guides/使用说明-0.7.1.md','verification/验证记录-0.7.1.md'])expect(index).toContain(`](${file})`);
});
