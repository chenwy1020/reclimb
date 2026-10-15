import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import electron from 'electron';
import {cp} from 'node:fs/promises';
await import('./build/build-companion.mjs');
for(const folder of ['cmaps','standard_fonts','wasm'])await cp('node_modules/pdfjs-dist/'+folder,'public/pdf-assets/'+folder,{recursive:true});
await build({entryPoints:['src/main/index.ts'],outfile:'dist/main/index.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
await build({entryPoints:['src/main/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'});
for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:5173');break;}catch{await new Promise(r=>setTimeout(r,500));}}
const app=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,RECLIMB_DEV_URL:'http://127.0.0.1:5173'}});
app.on('exit',()=>{vite.kill();process.exit();});
