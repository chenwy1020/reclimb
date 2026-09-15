import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
const {selectTestProfile}=await import(pathToFileURL(resolve('scripts/test-profile.mjs')).href);
it('limits the patch to sync/settings checks and expires the exception at the next release',()=>{
 const contract=JSON.parse(readFileSync('scripts/release-contract-v051.json','utf8'));
 expect(contract).toMatchObject({version:'0.5.1',testScope:'targeted',expectedChecks:9});
 expect(selectTestProfile('0.5.1').tests).toEqual(contract.targetTests);
 for(const version of ['0.5.3','0.6.0'])expect(selectTestProfile(version)).toEqual({scope:'full',tests:[]});
 expect(selectTestProfile('0.5.1','full')).toEqual({scope:'full',tests:[]});
 const sources=readFileSync('scripts/source-files.mjs','utf8');for(const file of ['smoke-v051.mjs','release-contract-v051.json','verify-package-v051.ps1']){expect(existsSync('scripts/'+file)).toBe(true);expect(sources).toContain(file);}
});
it('keeps the new desktop regression in the full suite and runs patch desktops in CI',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'));expect(pkg.scripts['test:desktop:full']).toContain('scripts/smoke-v051.mjs');
 expect(readFileSync('.github/workflows/ci.yml','utf8')).toContain("steps.tests.outputs.scope == 'targeted'");
});
