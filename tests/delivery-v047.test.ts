import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('declares the focused 0.4.7 delivery and retains previous desktop regressions',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));
 const lockFile=JSON.parse(readFileSync('package-lock.json','utf8'));
 expect(packageFile.version.split('.').map(Number)[1]).toBeGreaterThanOrEqual(4);
 expect(lockFile.version).toBe(packageFile.version);
 expect(lockFile.packages[''].version).toBe(packageFile.version);
 expect(packageFile.private).toBe(true);
 expect(packageFile.license).toBe('UNLICENSED');
 expect(packageFile.scripts['test:patch']).toBe('node scripts/test-profile.mjs');
 expect(packageFile.scripts['test:desktop:full']).toContain('smoke-v047.mjs');
 for(const name of ['smoke-v044.mjs','smoke-v045.mjs','smoke-v047.mjs'])expect(packageFile.scripts['test:desktop:full']).toContain(name);
 expect(packageFile.scripts['test:full']).toContain('npm test');
 expect(readFileSync('scripts/verify-package-v047.ps1','utf8')).toContain('release-contract-v047.json');
 const contract=JSON.parse(readFileSync('scripts/release-contract-v047.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.7',suiteTag:'v047',smokeScript:'smoke-v047.mjs',desktopReportName:'desktop-verification-v047.json'});
 expect(Number.isInteger(contract.expectedChecks)&&contract.expectedChecks>=12).toBe(true);
 expect(contract.targetTests).toContain('tests/delivery-v047.test.ts');
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.7.md','验证记录-0.4.7.md','2026-09-14-inline-appearance-cache.md','smoke-v047.mjs','verify-package-v047.ps1','release-contract-v047.json','test-profile.mjs'])expect(allowlist).toContain(name);
});
