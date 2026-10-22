import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/companion',{recursive:true});
await build({entryPoints:['src/companion/app.ts'],outfile:'dist/companion/app.js',bundle:true,platform:'browser',target:['safari15.4'],format:'iife',minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'assets/[name]-[hash]'});
await Promise.all(['index.html','style.css'].map(file=>copyFile('src/companion/'+file,'dist/companion/'+file)));
