import {expect,it} from 'vitest';
import initSqlJs from 'sql.js';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {seedSamples} from '../src/main/samples';

it('upgrades an actual version-7 database to 8 only after preserving its exact original bytes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'reclimb-ink-v7-')),file=join(directory,'learning.sqlite');
 const setup=await LearningStore.open(directory);seedSamples(setup);const originalSessions=setup.list('sessions'),originalProjects=setup.list('projects'),originalSettings=setup.getSettings();setup.close();
 const SQL=await initSqlJs(),legacy=new SQL.Database(readFileSync(file));legacy.run('DROP TABLE handwritingTargets');legacy.run('DROP TABLE handwritings');legacy.run('PRAGMA user_version=7');const original=Buffer.from(legacy.export());legacy.close();writeFileSync(file,original);
 const upgraded=await LearningStore.open(directory);
 try{
  const backups=readdirSync(join(directory,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.4\.9-/);expect(readFileSync(join(directory,'upgrade-backups',backups[0]))).toEqual(original);
  expect(upgraded.list('sessions')).toEqual(originalSessions);expect(upgraded.list('projects')).toEqual(originalProjects);expect(upgraded.getSettings()).toEqual(originalSettings);expect(upgraded.list('handwritings')).toEqual([]);expect(upgraded.list('handwritingTargets')).toEqual([]);
 }finally{upgraded.close();}
 const check=new SQL.Database(readFileSync(file));try{expect(check.exec('PRAGMA user_version')[0].values[0][0]).toBe(8);expect(check.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('handwritings','handwritingTargets')")[0].values).toHaveLength(2);}finally{check.close();}
 const again=await LearningStore.open(directory);again.close();expect(readdirSync(join(directory,'upgrade-backups'))).toHaveLength(1);expect(readFileSync(join(directory,'upgrade-backups',readdirSync(join(directory,'upgrade-backups'))[0]))).toEqual(original);
});
