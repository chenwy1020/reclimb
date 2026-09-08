import AdmZip from 'adm-zip';
import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const version=JSON.parse(readFileSync('package.json','utf8')).version;
const tag='v'+version.split('.').slice(0,2).join('');
const source='release/Reclimb-Source-'+version+'.zip';
const installer='release/Reclimb-Setup-'+version+'.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const zip=new AdmZip(source),entries=zip.getEntries(),names=entries.map(e=>e.entryName);
const allowed=/^(?:src\/|tests\/|scripts\/|docs\/|assets\/|README\.md$|package(?:-lock)?\.json$|tsconfig\.json$|vite\.config\.ts$|vitest\.config\.ts$|index\.html$|\.gitignore$|SOURCE-MANIFEST\.json$)/;
if(names.some(name=>!allowed.test(name)||/(?:^|\/)(?:output|\.test-data|\.builder-cache|node_modules|credentials\.json|learning\.sqlite)(?:\/|$)|\.(?:sqlite|reclimb|pdf)$/i.test(name)))throw new Error('源码归档含未批准文件类型或非源码目录');
const manifest=JSON.parse(zip.readAsText('SOURCE-MANIFEST.json'));
if(new Set(names).size!==names.length||manifest.length+1!==names.length)throw new Error('源码归档条目数量或重复项不一致');
for(const item of manifest){const bytes=zip.readFile(item.path);if(!bytes||sha(bytes)!==item.sha256||sha(readFileSync(item.path))!==item.sha256)throw new Error('源码清单与交付或当前源文件不一致：'+item.path);}
const installerHash=sha(readFileSync(installer));
const packageReport=JSON.parse(readFileSync('output/package-verification-'+tag+'.json','utf8'));
if(packageReport.installerSha256.toLowerCase()!==installerHash||packageReport.desktopChecksPassed<45||packageReport.externalRequests?.length!==0)throw new Error('安装包与已验证的包不一致，或桌面检查存在外部请求');
const report={at:new Date().toISOString(),version,sourceFiles:manifest.length,source:{path:resolve(source),bytes:statSync(source).size,sha256:sha(readFileSync(source))},installer:{path:resolve(installer),bytes:statSync(installer).size,sha256:installerHash},sourceMatchesManifestAndWorkspace:true,personalDataExcluded:true,packagedDesktopChecks:packageReport.desktopChecksPassed};
writeFileSync('output/delivery-'+tag+'.json',JSON.stringify(report,null,2));
const checksums=[];
for(const v of [...new Set(['0.1.0','0.2.0',version])])for(const name of ['Reclimb-Setup-'+v+'.exe','Reclimb-Source-'+v+'.zip'])if(existsSync('release/'+name))checksums.push(sha(readFileSync('release/'+name))+'  '+name);
writeFileSync('release/SHA256SUMS.txt',checksums.join('\n')+'\n');
console.log(JSON.stringify(report,null,2));
