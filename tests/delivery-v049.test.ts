import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('keeps version, Windows delivery and cumulative desktop checks consistent',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8'));
 expect(lock.version).toBe(pkg.version);expect(lock.packages[''].version).toBe(pkg.version);expect(pkg.private).toBe(true);expect(pkg.license).toBe('MIT');
 if(pkg.version==='0.4.9'){
  expect(pkg.scripts['test:desktop']).toBe('node scripts/desktop/smoke-v049.mjs');expect(pkg.scripts['verify:package']).toContain('verify-package-v049.ps1');
 }
 for(const script of ['smoke-v044.mjs','smoke-v045.mjs','smoke-v046.mjs','smoke-v047.mjs','smoke-v048.mjs','smoke-v049.mjs'])expect(pkg.scripts['test:desktop:full']).toContain(script);
 expect(pkg.scripts['test:full']).toContain('npm test');expect(pkg.scripts['test:patch']).toBe('node scripts/validation/test-profile.mjs');
 expect(pkg.build.files).toContain('dist/**/*');expect(readFileSync('scripts/build/build-main.mjs','utf8')).toContain('./build-companion.mjs');
});

it('binds the handwriting package validation to eight desktop checks and relevant offline coverage',()=>{
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v049.json','utf8'));
 expect(contract).toMatchObject({version:'0.4.9',suiteTag:'v049',smokeScript:'smoke-v049.mjs',desktopReportName:'desktop-verification-v049.json',expectedChecks:8});
 expect(readFileSync('scripts/release/verify-package-v049.ps1','utf8')).toContain('release-contract-v049.json');
 expect(existsSync('scripts/desktop/'+contract.smokeScript)).toBe(true);
 expect(new Set(contract.targetTests).size).toBe(contract.targetTests.length);
 for(const name of ['handwriting-service','handwriting-server','handwriting-backup','companion-draft','companion-import','public-snapshot','evidence','budget','workspace-recovery','test-profile','delivery-v049'])expect(contract.targetTests).toContain('tests/'+name+'.test.ts');
 for(const file of contract.targetTests)expect(existsSync(file),file).toBe(true);
});

it('ships the companion build, reviewable usage limits and the original-source plan in the source allowlist',()=>{
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const file of ['build-companion.mjs','smoke-v049.mjs','release-contract-v049.json','verify-package-v049.ps1','使用说明-0.4.9.md','验证记录-0.4.9.md','2026-09-14-ipad-handwriting.md'])expect(allowlist).toContain(file);
 for(const file of ['docs/guides/使用说明-0.4.9.md','docs/verification/验证记录-0.4.9.md','docs/plans/2026-09-14-ipad-handwriting.md'])expect(existsSync(file),file).toBe(true);
 const guide=readFileSync('docs/guides/使用说明-0.4.9.md','utf8');
 expect(guide).toContain('不需要安装 App');expect(guide).toContain('47149');expect(guide).toContain('不加密');expect(guide).toContain('未识别、未评价');expect(guide).toContain('下载原稿备份');expect(guide).toContain('格式 1—7');
 expect(readFileSync('README.md','utf8')).toContain('docs/README.md');
 expect(readFileSync('docs/README.md','utf8')).toContain('guides/使用说明-0.4.9.md');
});
