import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {extractFile,listPackage} from '@electron/asar';

const archive=resolve(process.argv[2]??'');
if(!archive||!existsSync(archive))throw new Error('找不到待核对的 app.asar。');
const entries=new Set(listPackage(archive).map(name=>name.replaceAll('\\','/')));
const required=[
  '/node_modules/@mozilla/readability/package.json',
  '/node_modules/@napi-rs/canvas/package.json',
  '/node_modules/adm-zip/package.json',
  '/node_modules/cheerio/package.json',
  '/node_modules/mammoth/package.json',
  '/node_modules/pdfjs-dist/package.json',
  '/node_modules/sql.js/package.json',
  '/node_modules/zod/package.json',
  '/dist/companion/index.html',
  '/dist/companion/app.js',
  '/dist/companion/style.css',
  '/dist/companion/app.css'
];
const missing=required.filter(name=>!entries.has(name));
if(![...entries].some(name=>/^\/node_modules\/@napi-rs\/canvas-win32-x64-msvc\/.*\.node$/.test(name)))missing.push('/node_modules/@napi-rs/canvas-win32-x64-msvc/*.node');
if(![...entries].some(name=>/^\/dist\/companion\/assets\/KaTeX_[A-Za-z0-9_-]+\.woff2$/.test(name)))missing.push('/dist/companion/assets/KaTeX_*.woff2');
if(missing.length)throw new Error('安装包缺少运行依赖：'+missing.join('、'));
const expectedVersion=process.argv[3];
if(expectedVersion){
 const packaged=JSON.parse(extractFile(archive,'package.json').toString('utf8'));
 const zip=JSON.parse(extractFile(archive,join('node_modules','adm-zip','package.json')).toString('utf8'));
 if(packaged.version!==expectedVersion)throw new Error('安装包版本与发行合同不一致');
 if(zip.version!=='0.6.1')throw new Error('安装包未包含本次核验的 adm-zip 0.6.1');
 console.log('Packaged application version verified: '+packaged.version+'; adm-zip '+zip.version+'.');
}
console.log('Packaged runtime dependencies verified: 8 dependency manifests, Windows canvas binary, 4 companion entry assets and local KaTeX woff2 font.');
