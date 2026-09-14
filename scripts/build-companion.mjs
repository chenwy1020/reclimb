import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/companion',{recursive:true});
await build({entryPoints:['src/companion/app.ts'],outfile:'dist/companion/app.js',bundle:true,platform:'browser',target:['safari15.4'],format:'iife',minify:true});
await Promise.all(['index.html','style.css'].map(file=>copyFile('src/companion/'+file,'dist/companion/'+file)));
