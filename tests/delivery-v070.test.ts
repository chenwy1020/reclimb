import {readFileSync,existsSync} from 'node:fs';
import {expect,it} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {sourceFiles}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const {selectTestProfile}=await import(pathToFileURL(resolve('scripts/test-profile.mjs')).href);
it('ships a coherent 0.7 release with full regression and a packaged graph workflow',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8')),contract=JSON.parse(readFileSync('scripts/release-contract-v070.json','utf8'));
 expect(pkg.version).toBe('0.7.0');expect(lock.version).toBe(pkg.version);expect(lock.packages[''].version).toBe(pkg.version);expect(contract).toMatchObject({version:pkg.version,suiteTag:'v070',expectedChecks:10,smokeScript:'smoke-v070.mjs',desktopReportName:'desktop-verification-v070.json',testScope:'full',targetTests:[]});
 expect(selectTestProfile(pkg.version)).toEqual({scope:'full',tests:[]});expect(pkg.scripts['test:desktop']).toContain(contract.smokeScript);expect(pkg.scripts['test:desktop:full']).toContain('smoke-v060.mjs');expect(pkg.scripts['test:desktop:full']).toContain(contract.smokeScript);expect(pkg.scripts['verify:package']).toContain('verify-package-v070.ps1');
});
it('includes graph implementation, migration checks and upgrade guidance in the source package',()=>{
 const files=sourceFiles();for(const file of ['src/shared/knowledge-graph.ts','src/main/knowledge-service.ts','src/main/knowledge-context.ts','src/renderer/LearningRelationsPanel.tsx','tests/knowledge-storage.test.ts','tests/knowledge-learning.test.ts','scripts/smoke-v070.mjs','scripts/release-contract-v070.json','scripts/verify-package-v070.ps1','docs/使用说明-0.7.md','docs/验证记录-0.7.md']){expect(existsSync(file),file).toBe(true);expect(files,file).toContain(file);}
});
