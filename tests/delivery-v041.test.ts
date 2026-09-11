import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('declares the complete 0.4.1 offline delivery contract',()=>{
 const packageFile=JSON.parse(readFileSync('package.json','utf8'));
 expect(packageFile.version).toBe('0.4.1');
 expect(packageFile.scripts['test:desktop']).toContain('smoke-v041.mjs');
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.1.md','验证记录-0.4.1.md','开发与扩展-0.4.1.md','IMPLEMENTATION-0.4.1.md','2026-09-11-project-trash-design.md','2026-09-11-project-trash.md','smoke-v041.mjs','verify-package-v041.ps1'])expect(allowlist).toContain(name);
 expect(readFileSync('scripts/verify-delivery.mjs','utf8')).toContain('desktopChecksPassed!==66');
});
