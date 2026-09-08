import {build} from 'esbuild';
import {mkdir,copyFile,readFile,cp} from 'node:fs/promises';
await mkdir('dist/main',{recursive:true});
await build({entryPoints:['src/main/index.ts'],outfile:'dist/main/index.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',packages:'external'});
await build({entryPoints:['src/main/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron']});
for(const folder of ['cmaps','standard_fonts','wasm'])await cp('node_modules/pdfjs-dist/'+folder,'dist/renderer/pdf-assets/'+folder,{recursive:true});

