import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('declares the focused 0.4.6 delivery and retains previous desktop regressions',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));
 const lockFile=JSON.parse(readFileSync('package-lock.json','utf8'));
 expect(packageFile.version.split('.').map(Number)[1]).toBeGreaterThanOrEqual(4);
 expect(lockFile.version).toBe(packageFile.version);
 expect(lockFile.packages[''].version).toBe(packageFile.version);
 expect(packageFile.private).toBe(true);
 expect(packageFile.license).toBe('MIT');
 expect(packageFile.scripts['test:patch']).toBe('node scripts/test-profile.mjs');
 expect(packageFile.scripts['test:desktop:full']).toContain('smoke-v046.mjs');
 for(const name of ['smoke-v044.mjs','smoke-v045.mjs','smoke-v046.mjs'])expect(packageFile.scripts['test:desktop:full']).toContain(name);
 expect(packageFile.scripts['test:full']).toContain('npm test');
 expect(readFileSync('scripts/verify-package-v046.ps1','utf8')).toContain('release-contract-v046.json');
 const contract=JSON.parse(readFileSync('scripts/release-contract-v046.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.6',suiteTag:'v046',smokeScript:'smoke-v046.mjs',desktopReportName:'desktop-verification-v046.json'});
 expect(Number.isInteger(contract.expectedChecks)&&contract.expectedChecks>=12).toBe(true);
 expect(contract.targetTests).toContain('tests/delivery-v046.test.ts');
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.6.md','验证记录-0.4.6.md','2026-09-13-context-followups.md','smoke-v046.mjs','verify-package-v046.ps1','release-contract-v046.json','test-profile.mjs'])expect(allowlist).toContain(name);
});
