import {existsSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';

const directories=['src','tests','assets','docs/fixtures','.github/workflows'];
const roots=['README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','index.html','.gitignore','.gitattributes'];
const documents=['使用说明-0.3.1.md','验证记录-0.3.1.md','开发与扩展-0.3.1.md','IMPLEMENTATION-0.3.1.md','使用说明-0.4.md','验证记录-0.4.md','设计原则.md','开发与扩展-0.4.md','IMPLEMENTATION-0.4.md','使用说明-0.4.1.md','验证记录-0.4.1.md','开发与扩展-0.4.1.md','IMPLEMENTATION-0.4.1.md','使用说明-0.4.2.md','验证记录-0.4.2.md','开发与扩展-0.4.2.md','IMPLEMENTATION-0.4.2.md','使用说明-0.4.3.md','验证记录-0.4.3.md','使用说明-0.4.4.md','验证记录-0.4.4.md','使用说明-0.4.5.md','验证记录-0.4.5.md','使用说明-0.4.6.md','验证记录-0.4.6.md','使用说明-0.4.7.md','验证记录-0.4.7.md','使用说明-0.4.8.md','验证记录-0.4.8.md'];
const plans=['2026-09-11-project-trash-design.md','2026-09-11-project-trash.md','2026-09-13-context-followups.md','2026-09-14-inline-appearance-cache.md'];
const scripts=['build-main.mjs','dev.mjs','render-icon.mjs','package-source.mjs','source-files.mjs','audit-source.mjs','check-package-input.mjs','verify-packaged-dependencies.mjs','smoke-desktop.mjs','smoke-v02.mjs','smoke-v03.mjs','smoke-v04.mjs','smoke-v041.mjs','smoke-v042.mjs','verify-delivery.mjs','verify-package-v03.ps1','verify-package-v031.ps1','verify-package-v04.ps1','verify-package-v041.ps1','verify-package-v042.ps1','release-contract-v042.json','smoke-v043.mjs','verify-package-v043.ps1','release-contract-v043.json','smoke-v044.mjs','verify-package-v044.ps1','release-contract-v044.json','fixture-pdf.mjs','live-validation.mjs','live-validation.ts','run-live-validation.mjs','smoke-v045.mjs','verify-package-v045.ps1','release-contract-v045.json','test-profile.mjs','smoke-v046.mjs','verify-package-v046.ps1','release-contract-v046.json','smoke-v047.mjs','verify-package-v047.ps1','release-contract-v047.json','smoke-v048.mjs','verify-package-v048.ps1','release-contract-v048.json'];
export function sourceFiles(root=process.cwd()){
 const files=[];
 function add(name){const absolute=resolve(root,name);if(relative(root,absolute).startsWith('..'))throw new Error('Source path escaped workspace');if(!existsSync(absolute))return;const stat=lstatSync(absolute);if(stat.isSymbolicLink())throw new Error('Source links are not included: '+name);if(stat.isDirectory()){for(const entry of readdirSync(absolute).sort())add(join(name,entry));}else files.push(name.replaceAll('\\','/'));}
 for(const name of [...roots,...directories,...documents.map(n=>'docs/'+n),...plans.map(n=>'docs/plans/'+n),...scripts.map(n=>'scripts/'+n)])add(name);
 return [...new Set(files)].sort();
}
export const forbiddenSourcePath=/(?:^|\/)(?:output|release|node_modules|\.test-data|\.local-test-data|\.builder-cache|credentials\.json|vision-credentials\.json)(?:\/|$)|\.(?:sqlite(?:-\w+)?|reclimb|docx|pdf|log)$/i;
