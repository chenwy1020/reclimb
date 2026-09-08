import { describe,it,expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';import { tmpdir } from 'node:os';import initSqlJs from 'sql.js';
import { LearningStore } from '../src/main/store';
describe('0.1 archive upgrade',()=>{
 it('keeps an exact pre-upgrade database and all legacy records while adding source versions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reclimb-migration-'));let store:LearningStore|undefined;
  try{
   store=await LearningStore.open(dir);const p={id:'legacy-p',title:'原目标',goal:'原目标',status:'active' as const,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.put('projects',p);store.close();
   const SQL=await initSqlJs();const db=new SQL.Database(readFileSync(join(dir,'learning.sqlite')));db.run('PRAGMA user_version=1');db.run('DROP TABLE IF EXISTS sourceTranscriptions');const original=Buffer.from(db.export());db.close();writeFileSync(join(dir,'learning.sqlite'),original);
   store=await LearningStore.open(dir);
   expect(store.get('projects','legacy-p')).toEqual(p);
   expect(store.list('sourceTranscriptions')).toEqual([]);
   const backups=readdirSync(join(dir,'upgrade-backups'));expect(backups).toHaveLength(1);
   expect(readFileSync(join(dir,'upgrade-backups',backups[0]))).toEqual(original);
   store.close();store=await LearningStore.open(dir);expect(readdirSync(join(dir,'upgrade-backups'))).toHaveLength(1);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('whitelists vision settings and never persists a nested API key',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reclimb-vision-settings-'));const store=await LearningStore.open(dir);
  try{store.updateSettings({vision:{enabled:true,providerName:'vision',baseUrl:'https://example.org/v1',model:'v',inputPriceCnyPerMillion:10,outputPriceCnyPerMillion:30,priceUpdatedAt:'manual',apiKey:'DO-NOT-PERSIST',hasApiKey:true}} as any);expect(store.getSettings().vision?.model).toBe('v');expect(JSON.stringify(store.snapshot())).not.toContain('DO-NOT-PERSIST');expect(store.getSettings().vision?.hasApiKey).not.toBe(true);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
 });
});
