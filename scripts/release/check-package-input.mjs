import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const root=process.cwd();
const packageFile=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
for(const name of Object.keys(packageFile.dependencies??{})){
  const manifest=resolve(root,'node_modules',name,'package.json');
  if(!existsSync(manifest))throw new Error(`打包依赖不完整：缺少 ${name}。请在当前检出中运行 npm ci 后再打包。`);
  const directory=dirname(manifest);
  if(lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==directory)throw new Error(`打包依赖 ${name} 是链接目录。请在当前检出中运行 npm ci，避免安装包漏收运行组件。`);
  const installed=JSON.parse(readFileSync(manifest,'utf8'));
  if(!installed.version)throw new Error(`打包依赖 ${name} 缺少可识别版本。`);
}
const electron=resolve(root,'node_modules','electron','dist','electron.exe');
if(!existsSync(electron))throw new Error('Electron 打包运行环境不完整。请完成 Electron 本机安装后再打包。');
console.log(`Pack input verified: ${Object.keys(packageFile.dependencies??{}).length} physical runtime dependencies.`);
