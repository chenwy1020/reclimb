import {describe,it,expect} from 'vitest';
import initSqlJs from 'sql.js';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';

describe('archive adoption',()=>{
 it('backs up exact v2 bytes before creating the current collections and never repeats the upgrade',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reclimb-v03-')),SQL=await initSqlJs(),db=new SQL.Database();
  db.run('CREATE TABLE projects(id TEXT PRIMARY KEY,project_id TEXT,entity TEXT NOT NULL)');
  const project={id:'p',title:'已有项目',goal:'自己的目标',status:'active',createdAt:'2026-09-08T00:00:00Z',updatedAt:'2026-09-08T00:00:00Z'};
  db.run('INSERT INTO projects VALUES (?,?,?)',['p',null,JSON.stringify(project)]);db.run('PRAGMA user_version=2');const original=Buffer.from(db.export());db.close();writeFileSync(join(dir,'learning.sqlite'),original);
  const store=await LearningStore.open(dir);
  try{
   const backups=readdirSync(join(dir,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.4-/);expect(readFileSync(join(dir,'upgrade-backups',backups[0]))).toEqual(original);
   expect(store.get('projects','p')).toEqual(project);
   for(const collection of ['teachingVersions','taskReviews','disputes','corrections','answerExposures'])expect(store.list(collection as never)).toEqual([]);
  }finally{store.close();}
  const next=await LearningStore.open(dir);next.close();expect(readdirSync(join(dir,'upgrade-backups'))).toHaveLength(1);
  const check=new SQL.Database(readFileSync(join(dir,'learning.sqlite')));expect(check.exec('PRAGMA user_version')[0].values[0][0]).toBe(6);check.close();
 });
});
