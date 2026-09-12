import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {listPackage} from '@electron/asar';

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
  '/node_modules/zod/package.json'
];
const missing=required.filter(name=>!entries.has(name));
if(![...entries].some(name=>/^\/node_modules\/@napi-rs\/canvas-win32-x64-msvc\/.*\.node$/.test(name)))missing.push('/node_modules/@napi-rs/canvas-win32-x64-msvc/*.node');
if(missing.length)throw new Error('安装包缺少运行依赖：'+missing.join('、'));
console.log(`Packaged runtime dependencies verified: ${required.length} manifests and the Windows canvas binary.`);
