import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sourceFiles,forbiddenSourcePath} from '../source-files.mjs';
const allowed=new Set(sourceFiles());
const tracked=process.argv.includes('--tracked');
const files=tracked?execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean):[...allowed];
const violations=[];
for(const file of files){
 if(!allowed.has(file)||forbiddenSourcePath.test(file)){violations.push({file,reason:'not in release source allowlist'});continue;}
 if(/\.(?:png|ico)$/.test(file))continue;
 const body=readFileSync(file,'utf8');
 if(/gh[pousr]_[A-Za-z0-9]{24,}|sk-[A-Za-z0-9]{28,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body))violations.push({file,reason:'potential credential; inspect locally'});
}
console.log(JSON.stringify({files:files.length,violations,scope:'Path allowlist and common credential markers; not a universal secret detector.'},null,2));
if(violations.length)process.exitCode=1;
