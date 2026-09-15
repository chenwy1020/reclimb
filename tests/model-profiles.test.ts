import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import initSqlJs from 'sql.js';
import {activeModelProfile,LearningStore} from '../src/main/store';
import {assertNoLegacyTeachingCredentials} from '../src/main/settings-schema';
import {DEFAULT_MODEL_PROFILE_ID,type ModelProfile} from '../src/shared/types';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

function profile(id:string,model:string,enabled=true):ModelProfile{
 return {id,name:id==='fast'?'快速模型':'稳健模型',providerName:'测试服务',baseUrl:'https://example.test/v1',model,inputPriceCnyPerMillion:id==='fast'?1:3,outputPriceCnyPerMillion:id==='fast'?2:6,priceUpdatedAt:'2026-09-12',enabled};
}

describe('model profile settings',()=>{
 it('rejects the removed one-shot teaching key contract before it can bind a key to stale endpoint metadata',()=>{
  expect(()=>assertNoLegacyTeachingCredentials({settings:{providerName:'new',baseUrl:'https://new.example/v1',model:'new-model'},apiKey:'secret'})).toThrow(/模型配置/);
  expect(()=>assertNoLegacyTeachingCredentials({settings:{monthlyBudgetCny:20},visionApiKey:'vision-secret'})).not.toThrow();
 });

 it('migrates legacy scalar settings into one stable active profile',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-model-profile-'));roots.push(root);const store=await LearningStore.open(root);
  const settings=store.getSettings(),active=activeModelProfile(settings);
  expect(settings.activeModelProfileId).toBe(DEFAULT_MODEL_PROFILE_ID);
  expect(settings.modelProfiles).toEqual([expect.objectContaining({id:DEFAULT_MODEL_PROFILE_ID,enabled:true,model:'deepseek-v4-pro'})]);
  expect(active).toMatchObject({id:DEFAULT_MODEL_PROFILE_ID,model:settings.model,baseUrl:settings.baseUrl});
  store.close();
 });

 it('projects the selected profile into legacy fields and keeps legacy updates compatible',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-model-select-'));roots.push(root);const store=await LearningStore.open(root);
  store.updateSettings({modelProfiles:[profile('fast','flash'),profile('steady','reasoner')],activeModelProfileId:'steady'});
  expect(store.getSettings()).toMatchObject({activeModelProfileId:'steady',model:'reasoner',inputPriceCnyPerMillion:3,outputPriceCnyPerMillion:6});
  store.updateSettings({model:'reasoner-v2',baseUrl:'https://other.test/v1'});
  const settings=store.getSettings();expect(activeModelProfile(settings)).toMatchObject({id:'steady',model:'reasoner-v2',baseUrl:'https://other.test/v1'});
  expect(settings.modelProfiles?.find(item=>item.id==='fast')?.model).toBe('flash');
  store.close();
 });

 it('strips runtime key flags and chooses an enabled profile when the requested one is disabled',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-model-clean-'));roots.push(root);const store=await LearningStore.open(root);
  store.updateSettings({modelProfiles:[{...profile('fast','flash'),hasApiKey:true,apiKey:'must-not-persist'} as ModelProfile,profile('steady','reasoner',false)],activeModelProfileId:'steady'});
  const settings=store.getSettings();expect(settings.activeModelProfileId).toBe('fast');expect(settings.hasApiKey).toBe(false);
  expect(JSON.stringify(settings)).not.toContain('must-not-persist');expect(settings.modelProfiles?.[0].hasApiKey).not.toBe(true);
  store.close();
 });

 it('backs up a version 6 database before upgrading to version 8 without changing legacy records',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-model-migration-'));roots.push(root);let store=await LearningStore.open(root);const now='2026-09-12T00:00:00.000Z';
  store.put('projects',{id:'p',title:'旧项目',goal:'保留记录',status:'active',createdAt:now,updatedAt:now});store.updateSettings({providerName:'旧服务',baseUrl:'https://legacy.test/v1',model:'legacy-model',inputPriceCnyPerMillion:4,outputPriceCnyPerMillion:8});store.close();
  const SQL=await initSqlJs(),db=new SQL.Database(readFileSync(join(root,'learning.sqlite')));db.run('PRAGMA user_version=6');const settings=JSON.parse(String(db.exec('SELECT entity FROM settings WHERE id=1')[0].values[0][0]));delete settings.modelProfiles;delete settings.activeModelProfileId;db.run('UPDATE settings SET entity=? WHERE id=1',[JSON.stringify(settings)]);const original=Buffer.from(db.export());db.close();writeFileSync(join(root,'learning.sqlite'),original);
  store=await LearningStore.open(root);expect(store.get('projects','p')?.goal).toBe('保留记录');expect(activeModelProfile(store.getSettings())).toMatchObject({id:DEFAULT_MODEL_PROFILE_ID,providerName:'旧服务',model:'legacy-model'});store.close();
  const backups=readdirSync(join(root,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.4\.2-/);expect(readFileSync(join(root,'upgrade-backups',backups[0]))).toEqual(original);
  const upgraded=new SQL.Database(readFileSync(join(root,'learning.sqlite')));expect(upgraded.exec('PRAGMA user_version')[0].values[0][0]).toBe(10);upgraded.close();
 });
});
