import AdmZip from 'adm-zip';
import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {sourceFiles,forbiddenSourcePath} from '../source-files.mjs';

const version=JSON.parse(readFileSync('package.json','utf8')).version;
const tag='v'+version.split('.').join('');
const contractPath='scripts/release/release-contract-'+tag+'.json';
if(!existsSync(contractPath))throw new Error('缺少当前版本的交付契约：'+contractPath);
const contract=JSON.parse(readFileSync(contractPath,'utf8'));
if(contract.version!==version||contract.suiteTag!==tag||!Number.isInteger(contract.expectedChecks)||contract.expectedChecks<1)throw new Error('当前版本的交付契约无效');
const source='release/Reclimb-Source-'+version+'.zip';
const installer='release/Reclimb-Setup-'+version+'.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const zip=new AdmZip(source),entries=zip.getEntries(),names=entries.map(e=>e.entryName);
const allowed=new Set([...sourceFiles(),'SOURCE-MANIFEST.json']);
if(names.length!==allowed.size||names.some(name=>!allowed.has(name)||forbiddenSourcePath.test(name)))throw new Error('源码归档含未批准文件类型、缺少源文件或非源码目录');
const manifest=JSON.parse(zip.readAsText('SOURCE-MANIFEST.json'));
if(new Set(names).size!==names.length||manifest.length+1!==names.length)throw new Error('源码归档条目数量或重复项不一致');
for(const item of manifest){const bytes=zip.readFile(item.path);if(!bytes||sha(bytes)!==item.sha256||sha(readFileSync(item.path))!==item.sha256)throw new Error('源码清单与交付或当前源文件不一致：'+item.path);}
const installerHash=sha(readFileSync(installer));
const packageReport=JSON.parse(readFileSync('output/package-verification-'+tag+'.json','utf8'));
const requiredIpcChecks=contract.ipcValidationChecks??(version==='0.7.1'?13:undefined);
if(requiredIpcChecks!==undefined&&(!Number.isInteger(requiredIpcChecks)||requiredIpcChecks<1||packageReport.validationStatus!=='passed'||packageReport.applicationVersion!==version||packageReport.ipcValidationChecksPassed!==requiredIpcChecks))throw new Error('安装包尚未通过当前契约要求的版本、运行依赖与全部 IPC 边界检查，不能交付');
if(contract.expectedProductChecks!==undefined){
 if(!Number.isInteger(contract.expectedProductChecks)||contract.expectedProductChecks<1||!requiredIpcChecks)throw new Error('产品交付契约缺少完整检查数量或 IPC 边界要求');
 if(packageReport.productChecksPassed!==contract.expectedProductChecks||!packageReport.executable||packageReport.productExecutable!==packageReport.executable||packageReport.ipcExecutable!==packageReport.executable||packageReport.productExternalRequests?.length!==0||packageReport.productRendererErrors?.length!==0||packageReport.ipcExternalRequests?.length!==0)throw new Error('产品或 IPC 检查未在同一安装包内完整通过，不能交付');
}
if(packageReport.installerSha256.toLowerCase()!==installerHash||packageReport.packagedRuntimeDependenciesVerified!==true||packageReport.desktopChecksPassed!==contract.expectedChecks||packageReport.externalRequests?.length!==0)throw new Error('安装包与已验证的包不一致、缺少运行依赖，或桌面检查存在外部请求');
const report={at:new Date().toISOString(),version,sourceFiles:manifest.length,source:{path:resolve(source),bytes:statSync(source).size,sha256:sha(readFileSync(source))},installer:{path:resolve(installer),bytes:statSync(installer).size,sha256:installerHash},sourceMatchesManifestAndWorkspace:true,personalDataExcluded:true,packagedDesktopChecks:packageReport.desktopChecksPassed,...(requiredIpcChecks?{packagedIpcValidationChecks:packageReport.ipcValidationChecksPassed,applicationVersion:packageReport.applicationVersion}:{}),...(contract.expectedProductChecks?{packagedProductChecks:packageReport.productChecksPassed}:{})};
writeFileSync('output/delivery-'+tag+'.json',JSON.stringify(report,null,2));
const checksums=[];
for(const name of ['Reclimb-Setup-'+version+'.exe','Reclimb-Source-'+version+'.zip'])if(existsSync('release/'+name))checksums.push(sha(readFileSync('release/'+name))+'  '+name);
writeFileSync('release/SHA256SUMS.txt',checksums.join('\n')+'\n');
console.log(JSON.stringify(report,null,2));
