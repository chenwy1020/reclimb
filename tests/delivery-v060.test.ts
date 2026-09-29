import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('defines the full 0.6.0 release and packaged desktop contract',()=>{
 const contract=JSON.parse(readFileSync('scripts/release-contract-v060.json','utf8')),pkg=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8'));
 expect(contract).toMatchObject({version:'0.6.0',suiteTag:'v060',expectedChecks:8,smokeScript:'smoke-v060.mjs',desktopReportName:'desktop-verification-v060.json',testScope:'full',targetTests:[]});
 expect(lock.version).toBe(pkg.version);expect(lock.packages[''].version).toBe(pkg.version);
 expect(pkg.scripts['test:desktop:full']).toContain('smoke-v060.mjs');
 expect(readFileSync('scripts/verify-package-v060.ps1','utf8')).toContain('release-contract-v060.json');
});
it('keeps cumulative desktop gates and the three 0.6 review documents in the source archive',()=>{
 const smoke=readFileSync('scripts/smoke-v060.mjs','utf8'),sources=readFileSync('scripts/source-files.mjs','utf8');
 for(const marker of ['当前材料的问题','解释这里','重新请求（可能收费）','保存目标','分析提议（调用模型）','采用建议','开始固定任务','validation.trial','validation.export','reader.save'])expect(smoke).toContain(marker);
 for(const file of ['smoke-v060.mjs','verify-package-v060.ps1','release-contract-v060.json','smoke-reader-continuity.mjs','验证记录-0.6.md','重登-产品审查总结.md','重登-0.6-整改方案.md'])expect(sources).toContain(file);
 for(const file of ['docs/验证记录-0.6.md','docs/重登-产品审查总结.md','docs/plans/重登-0.6-整改方案.md','scripts/smoke-v060.mjs'])expect(existsSync(file),file).toBe(true);
});
