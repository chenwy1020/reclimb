import {existsSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';

const directories=['src','tests','assets','docs/fixtures','.github/workflows'];
const roots=['README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','index.html','.gitignore','.gitattributes'];
const documents=['使用说明-0.3.1.md','验证记录-0.3.1.md','设计原则.md','开发与扩展-0.3.1.md','IMPLEMENTATION-0.3.1.md'];
const scripts=['build-main.mjs','dev.mjs','render-icon.mjs','package-source.mjs','source-files.mjs','audit-source.mjs','smoke-desktop.mjs','smoke-v02.mjs','smoke-v03.mjs','smoke-v031.mjs','verify-delivery.mjs','verify-package-v03.ps1','verify-package-v031.ps1','fixture-pdf.mjs','live-validation.mjs','live-validation.ts','run-live-validation.mjs'];
export function sourceFiles(root=process.cwd()){
 const files=[];
 function add(name){const absolute=resolve(root,name);if(relative(root,absolute).startsWith('..'))throw new Error('Source path escaped workspace');if(!existsSync(absolute))return;const stat=lstatSync(absolute);if(stat.isSymbolicLink())throw new Error('Source links are not included: '+name);if(stat.isDirectory()){for(const entry of readdirSync(absolute).sort())add(join(name,entry));}else files.push(name.replaceAll('\\','/'));}
 for(const name of [...roots,...directories,...documents.map(n=>'docs/'+n),...scripts.map(n=>'scripts/'+n)])add(name);
 return [...new Set(files)].sort();
}
export const forbiddenSourcePath=/(?:^|\/)(?:output|release|node_modules|\.test-data|\.local-test-data|\.builder-cache|credentials\.json|vision-credentials\.json)(?:\/|$)|\.(?:sqlite(?:-\w+)?|reclimb|docx|pdf|log)$/i;
