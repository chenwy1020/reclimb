import AdmZip from 'adm-zip';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sourceFiles,forbiddenSourcePath} from '../source-files.mjs';
execFileSync(process.execPath,['scripts/validation/audit-source.mjs'],{stdio:'inherit'});
const zip=new AdmZip(),manifest=[];
for(const path of sourceFiles()){
 if(forbiddenSourcePath.test(path))throw new Error('Unapproved source file: '+path);
 const bytes=readFileSync(path);zip.addFile(path,bytes);
 manifest.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
}
zip.addFile('SOURCE-MANIFEST.json',Buffer.from(JSON.stringify(manifest,null,2)));
const version=JSON.parse(readFileSync('package.json','utf8')).version;
mkdirSync('release',{recursive:true});
writeFileSync('release/Reclimb-Source-'+version+'.zip',zip.toBuffer());
console.log('Source files:',manifest.length);

