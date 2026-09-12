import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {CredentialsStore,type CredentialCipher} from '../src/main/credentials';
import {ModelProfileManager} from '../src/main/model-profile-manager';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
function cipher():CredentialCipher{const secret=randomBytes(32);return{isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),aes=createCipheriv('aes-256-gcm',secret,iv),body=Buffer.concat([aes.update(value,'utf8'),aes.final()]);return Buffer.concat([iv,aes.getAuthTag(),body]);},decryptString(value){const aes=createDecipheriv('aes-256-gcm',secret,value.subarray(0,12));aes.setAuthTag(value.subarray(12,28));return Buffer.concat([aes.update(value.subarray(28)),aes.final()]).toString('utf8');}};}
async function fixture(busy=()=>false){const root=mkdtempSync(join(tmpdir(),'reclimb-profile-manager-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace')),credentials=new CredentialsStore(join(root,'credentials.json'),cipher()),manager=new ModelProfileManager(store,credentials,busy);return{store,credentials,manager};}
const input=(name:string,model:string)=>({name,providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:2,priceUpdatedAt:'2026-09-12',enabled:true});

describe('model profile manager',()=>{
 it('adds independent profiles, activates one locally and resolves its immutable call settings',async()=>{const t=await fixture();try{
  const fast=t.manager.save(input('快速路线','deepseek-v4-flash'),'key-fast');
  const careful=t.manager.save(input('严谨核验','deepseek-v4-pro'),'key-careful');
  t.manager.activate(careful);
  const context=t.manager.context();
  expect(context.profile).toMatchObject({id:careful,name:'严谨核验',model:'deepseek-v4-pro'});
  expect(context.settings).toMatchObject({activeModelProfileId:careful,model:'deepseek-v4-pro'});
  expect(context.key).toBe('key-careful');
  expect(t.credentials.read(fast,'https://api.deepseek.com')).toBe('key-fast');
 }finally{t.store.close();}});

 it('tests a non-active profile context without changing the current profile',async()=>{const t=await fixture();try{
  const fast=t.manager.save(input('快速路线','deepseek-v4-flash'),'key-fast'),careful=t.manager.save({...input('严谨核验','deepseek-v4-pro'),maxOutputTokens:4096},'key-careful');t.manager.activate(fast);
  const context=t.manager.context(careful);
  expect(context.settings.model).toBe('deepseek-v4-pro');expect(context.settings.maxOutputTokens).toBe(4096);expect(context.key).toBe('key-careful');
  expect(t.store.getSettings().activeModelProfileId).toBe(fast);
 }finally{t.store.close();}});

 it('requires a replacement key before moving a configured profile to another endpoint',async()=>{const t=await fixture();try{
  const first=t.manager.save(input('快速路线','flash'),'key-first'),second=t.manager.save(input('严谨核验','pro'),'key-second');
  const before=t.store.getSettings().modelProfiles!.find(profile=>profile.id===first);
  expect(()=>t.manager.save({...input('快速路线','flash'),id:first,baseUrl:'https://other.example/v1'})).toThrow(/接口地址|密钥/);
  expect(t.store.getSettings().modelProfiles!.find(profile=>profile.id===first)).toEqual(before);
  expect(t.credentials.read(first,'https://api.deepseek.com')).toBe('key-first');
  expect(t.credentials.read(second,'https://api.deepseek.com')).toBe('key-second');
  t.manager.save({...input('快速路线','flash'),id:first,baseUrl:'https://other.example/v1'},'key-replacement');
  expect(t.credentials.read(first,'https://api.deepseek.com')).toBe('');
  expect(t.credentials.read(first,'https://other.example/v1')).toBe('key-replacement');
 }finally{t.store.close();}});

 it('does not change profile metadata when encrypted credential storage rejects a new key',async()=>{const t=await fixture();try{
  const id=t.manager.save(input('快速路线','flash'),'key-first'),before=t.store.getSettings().modelProfiles!.find(profile=>profile.id===id)!;
  vi.spyOn(t.credentials,'write').mockImplementationOnce(()=>{throw new Error('密钥文件无法读取，原文件已保留');});
  expect(()=>t.manager.save({...input('快速路线','changed-model'),id},'replacement')).toThrow(/保留/);
  expect(t.store.getSettings().modelProfiles!.find(profile=>profile.id===id)).toEqual(before);
 }finally{t.store.close();}});

 it('protects the active and in-use configuration from deletion or switching',async()=>{let busy=false;const t=await fixture(()=>busy);try{
  const first=t.manager.save(input('快速路线','flash'),'key-first'),second=t.manager.save(input('严谨核验','pro'),'key-second');t.manager.activate(first);
  expect(()=>t.manager.remove(first)).toThrow(/当前|切换/);
  busy=true;expect(()=>t.manager.activate(second)).toThrow(/进行|稍候/);expect(()=>t.manager.save({...input('快速路线','flash-2'),id:first})).toThrow(/进行|稍候/);
 }finally{t.store.close();}});

 it('does not activate a profile until that profile has its own readable key',async()=>{const t=await fixture();try{
  const configured=t.manager.save(input('已配置','flash'),'key-fast'),missing=t.manager.save(input('待配置','pro'));t.manager.activate(configured);
  expect(()=>t.manager.activate(missing)).toThrow(/密钥|配置/);
  expect(t.store.getSettings().activeModelProfileId).toBe(configured);
 }finally{t.store.close();}});

 it('rejects duplicate names and removes only an inactive profile and its key',async()=>{const t=await fixture();try{
  const first=t.manager.save(input('快速路线','flash'),'key-first'),second=t.manager.save(input('严谨核验','pro'),'key-second');t.manager.activate(first);
  expect(()=>t.manager.save(input(' 快速路线 ','other'))).toThrow(/名称/);
  t.manager.remove(second);expect(t.store.getSettings().modelProfiles!.some(profile=>profile.id===second)).toBe(false);expect(t.credentials.read(second,'https://api.deepseek.com')).toBe('');
 }finally{t.store.close();}});

 it('rejects a twenty-first profile before writing its key or changing the existing twenty',async()=>{const t=await fixture();try{
  const write=vi.spyOn(t.credentials,'write');for(let index=1;index<20;index++)t.manager.save(input('配置 '+index,'model-'+index),'key-'+index);
  const before=t.store.getSettings().modelProfiles;expect(before).toHaveLength(20);write.mockClear();
  expect(()=>t.manager.save(input('第 21 项','overflow'),'must-not-write')).toThrow(/20/);
  expect(write).not.toHaveBeenCalled();expect(t.store.getSettings().modelProfiles).toEqual(before);
 }finally{t.store.close();}});
});
