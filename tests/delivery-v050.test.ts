import {readFileSync,existsSync} from 'node:fs';
import {expect,it} from 'vitest';
it('requires full accumulated desktop verification for the major release',()=>{
 const contract=JSON.parse(readFileSync('scripts/release/release-contract-v050.json','utf8'));
 expect(contract).toMatchObject({version:'0.5.0',testScope:'full',expectedChecks:11});
 const wrapper=readFileSync('scripts/desktop/smoke-v050.mjs','utf8'),sources=readFileSync('scripts/source-files.mjs','utf8');
 for(const file of ['smoke-v044.mjs','smoke-v045.mjs','smoke-v046.mjs','smoke-v047.mjs','smoke-v048.mjs','smoke-v049.mjs','smoke-v0410.mjs','smoke-pen-v050.mjs','smoke-handwriting-v050.mjs','smoke-sync-v050.mjs','smoke-storage-v050.mjs']){expect(existsSync('scripts/desktop/'+file)).toBe(true);expect(wrapper).toContain(file);expect(sources).toContain(file);}
 expect(readFileSync('scripts/release/verify-package-v050.ps1','utf8')).toContain('release-contract-v050.json');
});
