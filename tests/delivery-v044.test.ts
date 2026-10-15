import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('retains the 0.4.4 offline delivery contract',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));
 expect(packageFile.scripts.package).toContain('check-package-input.mjs');
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v044.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.4',suiteTag:'v044',smokeScript:'smoke-v044.mjs',desktopReportName:'desktop-verification-v044.json'});
 expect(Number.isInteger(contract.expectedChecks)&&contract.expectedChecks>=66).toBe(true);
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.4.md','验证记录-0.4.4.md','smoke-v044.mjs','verify-package-v044.ps1','release-contract-v044.json','check-package-input.mjs','verify-packaged-dependencies.mjs'])expect(allowlist).toContain(name);
 const delivery=readFileSync('scripts/release/verify-delivery.mjs','utf8');
 expect(delivery).toContain("release-contract-'+tag+'.json");
 expect(delivery).toContain('contract.expectedChecks');
 expect(delivery).toContain('packagedRuntimeDependenciesVerified');
});
