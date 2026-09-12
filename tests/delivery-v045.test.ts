import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('declares the focused 0.4.5 delivery and retains the accumulated full suite',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));
 expect(packageFile.version).toBe('0.4.5');
 expect(packageFile.scripts['test:patch']).toBe('node scripts/test-profile.mjs');
 expect(packageFile.scripts['test:desktop']).toBe('node scripts/smoke-v045.mjs');
 expect(packageFile.scripts['test:desktop:full']).toContain('smoke-v044.mjs');
 expect(packageFile.scripts['test:desktop:full']).toContain('smoke-v045.mjs');
 expect(packageFile.scripts['test:full']).toContain('npm test');
 expect(packageFile.scripts['verify:package']).toContain('verify-package-v045.ps1');
 const contract=JSON.parse(readFileSync('scripts/release-contract-v045.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.5',suiteTag:'v045',smokeScript:'smoke-v045.mjs',desktopReportName:'desktop-verification-v045.json',expectedChecks:10});
 expect(contract.targetTests).toContain('tests/delivery-v045.test.ts');
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.5.md','验证记录-0.4.5.md','smoke-v045.mjs','verify-package-v045.ps1','release-contract-v045.json','test-profile.mjs'])expect(allowlist).toContain(name);
 expect(readFileSync('README.md','utf8')).toContain('docs/使用说明-0.4.5.md');
});
