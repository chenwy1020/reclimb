import {mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {FileMatcher} from 'app-builder-lib/out/fileMatcher.js';

const {sourceFiles,forbiddenSourcePath}=await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);

it('includes the license and classified release scripts while excluding unapproved personal files and generated output',()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-source-layout-'));
 try {
  for(const file of ['LICENSE','scripts/release/package-source.mjs','docs/guides/使用说明-0.7.1.md','scripts/release/personal-check.mjs','docs/guides/个人记录.md','release/installer.exe','output/report.json']) {
   const target=join(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,'controlled fixture');
  }
  const build=JSON.parse(readFileSync('package.json','utf8')).build;
  const packageFilter=new FileMatcher(root,join(root,'package'),pattern=>pattern,build.files).createFilter();
  expect(packageFilter(join(root,'LICENSE'),statSync(join(root,'LICENSE')))).toBe(true);
  const included=sourceFiles(root);
  expect(included).toEqual(['LICENSE','docs/guides/使用说明-0.7.1.md','scripts/release/package-source.mjs']);
  expect(included.filter((file:string)=>forbiddenSourcePath.test(file))).toEqual([]);
 } finally {rmSync(root,{recursive:true,force:true});}
});

it('continues rejecting generated releases, nested caches, credentials and learning archives',()=>{
 for(const file of ['release/installer.exe','scripts/release/credentials.json','scripts/release/private.reclimb','src/node_modules/package.json','docs/output/private.md','src/learning.sqlite'])expect(forbiddenSourcePath.test(file),file).toBe(true);
});
