import {readFileSync,existsSync} from 'node:fs';
import {expect,it} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {sourceFiles}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const {selectTestProfile}=await import(pathToFileURL(resolve('scripts/validation/test-profile.mjs')).href);
it('preserves the 0.7 release contract and packaged graph regression workflow',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')),contract=JSON.parse(readFileSync('scripts/release/release-contract-v070.json','utf8'));
 expect(contract).toMatchObject({version:'0.7.0',suiteTag:'v070',expectedChecks:10,smokeScript:'smoke-v070.mjs',desktopReportName:'desktop-verification-v070.json',testScope:'full',targetTests:[]});
 expect(selectTestProfile(contract.version)).toEqual({scope:'full',tests:[]});expect(pkg.scripts['test:desktop:full']).toContain('smoke-v060.mjs');expect(pkg.scripts['test:desktop:full']).toContain(contract.smokeScript);expect(readFileSync('scripts/release/verify-package-v070.ps1','utf8')).toContain('release-contract-v070.json');
});
it('includes graph implementation, migration checks and upgrade guidance in the source package',()=>{
 const files=sourceFiles();for(const file of ['src/shared/knowledge-graph.ts','src/main/knowledge-service.ts','src/main/knowledge-context.ts','src/renderer/LearningRelationsPanel.tsx','tests/knowledge-storage.test.ts','tests/knowledge-learning.test.ts','scripts/desktop/smoke-v070.mjs','scripts/release/release-contract-v070.json','scripts/release/verify-package-v070.ps1','docs/guides/使用说明-0.7.md','docs/verification/验证记录-0.7.md']){expect(existsSync(file),file).toBe(true);expect(files,file).toContain(file);}
});
