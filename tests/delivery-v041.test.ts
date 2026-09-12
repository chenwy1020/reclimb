import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('retains the 0.4.1 delivery sources for historical verification',()=>{
 const allowlist=readFileSync('scripts/source-files.mjs','utf8');
 for(const name of ['使用说明-0.4.1.md','验证记录-0.4.1.md','开发与扩展-0.4.1.md','IMPLEMENTATION-0.4.1.md','2026-09-11-project-trash-design.md','2026-09-11-project-trash.md','smoke-v041.mjs','verify-package-v041.ps1'])expect(allowlist).toContain(name);
});
