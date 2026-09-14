import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('binds this patch to its four focused desktop groups and preserves cumulative checks',()=>{
 const contract=JSON.parse(readFileSync('scripts/release-contract-v0410.json','utf8')),pkg=JSON.parse(readFileSync('package.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.10',suiteTag:'v0410',expectedChecks:4,smokeScript:'smoke-v0410.mjs',desktopReportName:'desktop-verification-v0410.json'});
 for(const file of contract.targetTests)expect(existsSync(file),file).toBe(true);
 const wrapper=readFileSync('scripts/smoke-v0410.mjs','utf8'),allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const file of ['smoke-v049.mjs','smoke-layout-v0410.mjs','smoke-pen-v0410.mjs','smoke-feedback-v0410.mjs']){expect(wrapper).toContain(file);expect(allowlist).toContain(file);}
 expect(pkg.scripts['test:desktop:full']).toContain('smoke-v0410.mjs');
 if(pkg.version==='0.4.10')expect(pkg.scripts['test:desktop']).toBe('node scripts/smoke-v0410.mjs');
 expect(readFileSync('scripts/verify-package-v0410.ps1','utf8')).toContain('release-contract-v0410.json');
});
