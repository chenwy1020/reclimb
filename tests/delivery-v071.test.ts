import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';

const {sourceFiles}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const {selectTestProfile}=await import(pathToFileURL(resolve('scripts/validation/test-profile.mjs')).href);

it('aligns the maintenance version, installed app label and full-regression delivery contract',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v071.json','utf8'));
 expect(pkg.version).toBe('0.7.1');
 expect(lock.version).toBe(pkg.version);
 expect(lock.packages[''].version).toBe(pkg.version);
 expect(readFileSync('src/renderer/App.tsx','utf8')).toContain(`重登 · ${pkg.version}`);
 expect(contract).toEqual({version:pkg.version,suiteTag:'v071',expectedChecks:10,smokeScript:'smoke-v070.mjs',desktopReportName:'desktop-verification-v070.json',testScope:'full',targetTests:[]});
 expect(selectTestProfile(pkg.version)).toEqual({scope:contract.testScope,tests:contract.targetTests});
 expect(pkg.scripts['verify:package']).toContain('scripts/release/verify-package-v071.ps1');
 expect(pkg.scripts['test:desktop']).toContain(contract.smokeScript);
 expect(pkg.scripts['test:desktop:full']).toContain('smoke-ipc-validation.mjs');
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
 const readme=readFileSync('README.md','utf8');
 for(const file of ['docs/guides/使用说明-0.7.1.md','docs/verification/验证记录-0.7.1.md'])expect(readme).toContain(`](${file})`);
});
