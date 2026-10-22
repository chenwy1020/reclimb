import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('retains the 0.4.2 offline delivery contract',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));



 expect(packageFile.scripts.package).toContain('check-package-input.mjs');
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v042.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.2',suiteTag:'v042',smokeScript:'smoke-v042.mjs',desktopReportName:'desktop-verification-v042.json'});
 expect(Number.isInteger(contract.expectedChecks)&&contract.expectedChecks>=66).toBe(true);
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.2.md','验证记录-0.4.2.md','开发与扩展-0.4.2.md','IMPLEMENTATION-0.4.2.md','smoke-v042.mjs','verify-package-v042.ps1','release-contract-v042.json','check-package-input.mjs','verify-packaged-dependencies.mjs'])expect(allowlist).toContain(name);
 const delivery=readFileSync('scripts/release/verify-delivery.mjs','utf8');
 expect(delivery).toContain("release-contract-'+tag+'.json");
 expect(delivery).toContain('contract.expectedChecks');
 expect(delivery).toContain('packagedRuntimeDependenciesVerified');

});
