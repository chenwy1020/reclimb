import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { LearningStore } from '../src/main/store';
import { CallRunner } from '../src/main/call-runner';
import { DiagnosticLog } from '../src/main/diagnostics';

const schema = z.object({ text: z.string() });
async function setup(complete: any, budget = 100) {
  const dir = mkdtempSync(join(tmpdir(), 'reclimb-calls-'));
  const store = await LearningStore.open(dir);
  store.updateSettings({ monthlyBudgetCny: budget, inputPriceCnyPerMillion: 1, outputPriceCnyPerMillion: 1 });
  return { store, runner: new CallRunner(store, () => 'secret-value', () => ({ complete })), log: new DiagnosticLog(join(dir, 'diagnostics')), close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const reply = (text: string, finishReason = 'stop') => ({ text, finishReason, providerRequestId: 'provider-42', inputTokens: 12, outputTokens: 8, usageKnown: true });
describe('bounded structured generation', () => {
  it('reserves generation and review before any provider call, and releases unused funds', async()=>{
    let calls=0;const t=await setup(async()=>{calls++;return reply('{"text":"ready"}');},.1);
    try{
      await expect(t.runner.withReservation('生成与核验',.1,async id=>t.runner.run('生成',{}, {schema,reservationId:id}))).rejects.toThrow('预算');
      expect(calls).toBe(0);
      const result=await t.runner.withReservation('生成与核验',.05,async id=>{
        expect(t.runner.isBusy).toBe(true);
        const output=await t.runner.run('生成',{}, {schema,reservationId:id});
        expect(t.store.list('usage').find(u=>u.entryType==='hold')?.estimatedCny).toBeGreaterThan(0);
        return output;
      });
      expect(result.text).toBe('ready');expect(calls).toBe(1);expect(t.runner.isBusy).toBe(false);
      expect(t.store.list('usage').find(u=>u.entryType==='hold')).toMatchObject({status:'failed',estimatedCny:0});
      expect(t.store.list('usage').filter(u=>u.status!=='failed').reduce((sum,u)=>sum+u.estimatedCny,0)).toBeCloseTo(.00002);
    }finally{t.close();}
  });
  it('protects review funds from other runners and rejects forged reservation ids',async()=>{
    const t=await setup(async()=>reply('{"text":"ready"}'),.1);
    const other=new CallRunner(t.store,()=> 'key',()=>({complete:async()=>reply('{"text":"other"}')}));
    try{await t.runner.withReservation('教学',.085,async id=>{
      await expect(other.run('别的请求',{}, {schema})).rejects.toThrow('预算');
      await expect(other.run('盗用预留',{}, {schema,reservationId:id})).rejects.toThrow('预留');
      await expect(t.runner.run('外部插队',{}, {schema})).rejects.toThrow('核验');
      await t.runner.run('必要核验',{}, {schema,reservationId:id});
    });expect(t.store.list('usage').filter(u=>u.entryType==='call')).toHaveLength(1);}finally{t.close();}
  });
  it('keeps the cumulative development cap across reservation, calls and failures',async()=>{
    const t=await setup(async()=>reply('{"text":"ready"}'));
    const runner=new CallRunner(t.store,()=> 'key',()=>({complete:async()=>reply('{"text":"ready"}')}),.04);
    try{
      await expect(runner.withReservation('太贵',.041,async()=>null)).rejects.toThrow('验证预算');
      await expect(runner.withReservation('失败',.03,async()=>{throw new Error('local failure');})).rejects.toThrow('local failure');
      await runner.withReservation('可执行',.03,async id=>runner.run('核验',{}, {schema,reservationId:id}));
      expect(t.store.list('usage').filter(u=>u.entryType==='hold').every(u=>u.status==='failed'&&u.estimatedCny===0)).toBe(true);
    }finally{t.close();}
  });
  it('honors a budget reduction made while the first response is in flight', async () => {
    let calls=0;
    const t=await setup(async()=>{calls++;t.store.updateSettings({monthlyBudgetCny:0});return reply('invalid');});
    try {
      await expect(t.runner.run('教学',{}, {schema})).rejects.toThrow('预算');
      expect(calls).toBe(1);
      expect(t.store.list('usage')).toHaveLength(1);
    } finally {t.close();}
  });
  it('keeps validated teaching and publication intact when diagnostic storage is unavailable', async () => {
    const t=await setup(async()=>reply('{"text":"ready"}'));
    vi.spyOn(t.runner.diagnostics,'record').mockImplementation(()=>{throw new Error('EPERM diagnostics');});
    try {
      const result=await t.runner.run('教学',{}, {schema});
      expect(result.text).toBe('ready');
      expect(()=>t.runner.markPublished(result)).not.toThrow();
      expect(t.store.list('usage')[0]).toMatchObject({status:'completed',validationStatus:'valid',publicationStatus:'published'});
    } finally {t.close();}
  });
  it('repairs a truncated reply once, accounts for both calls and only publishes the validated result', async () => {
    let calls = 0;
    const t = await setup(async () => ++calls === 1 ? reply('{"text":"unfinished', 'length') : reply('{"text":"ready"}'));
    try {
      const result = await t.runner.run('教学', {}, { schema, requestId: 'action-1' });
      expect(result.text).toBe('ready');
      expect(calls).toBe(2);
      const usage = t.store.list('usage');
      expect(usage).toHaveLength(2);
      expect(usage.map(u => u.operationId)).toEqual(['action-1', 'action-1']);
      expect(usage[0]).toMatchObject({ status: 'completed', validationStatus: 'invalid', publicationStatus: 'discarded', finishReason: 'length' });
      expect(usage[1].publicationStatus).toBe('pending');
      t.runner.markPublished(result);
      expect(t.store.list('usage')[1].publicationStatus).toBe('published');
    } finally { t.close(); }
  });
  it('stops after one structural repair and preserves diagnostic evidence without credentials', async () => {
    let calls = 0;
    const t = await setup(async () => { calls++; return reply('invalid secret-value'); });
    try {
      await expect(t.runner.run('教学', {}, { schema })).rejects.toThrow('格式');
      expect(calls).toBe(2);
      expect(t.store.list('usage').every(u => u.publicationStatus === 'discarded')).toBe(true);
      const diagnostics = JSON.stringify(t.log.preview());
      expect(diagnostics).not.toContain('secret-value');
      expect(diagnostics).toContain('invalid');
    } finally { t.close(); }
  });
  it('never repairs away an invented source or relaxes semantic validation', async () => {
    let calls = 0;
    const t = await setup(async () => { calls++; return reply('{"text":"invented"}'); });
    try {
      await expect(t.runner.run('教学', {}, { schema, validate() { throw new Error('引用不存在'); } })).rejects.toThrow('引用');
      expect(calls).toBe(1);
      expect(t.store.list('usage')[0].publicationStatus).toBe('discarded');
    } finally { t.close(); }
  });
  it('does not retry transport failures with uncertain billing', async () => {
    let calls = 0;
    const t = await setup(async () => { calls++; throw new Error('offline'); });
    try {
      await expect(t.runner.run('教学', {}, { schema })).rejects.toThrow('offline');
      expect(calls).toBe(1);
      expect(t.store.list('usage')[0]).toMatchObject({ status: 'uncertain', validationStatus: 'not_received' });
    } finally { t.close(); }
  });
  it('reserves the repair cost before contacting the provider', async () => {
    let calls = 0;
    const t = await setup(async () => { calls++; return { ...reply('invalid'), inputTokens: 500, outputTokens: 1000 }; }, .006);
    try {
      await expect(t.runner.run('教学', {}, { system: 's', schema, maxOutputTokens: 3000 })).rejects.toThrow('预算');
      expect(calls).toBeLessThanOrEqual(1);
      expect(t.store.list('usage')).toHaveLength(calls);
    } finally { t.close(); }
  });
  it('uses the active model profile for each new operation and records the provider reported model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reclimb-profile-calls-'));
    const store = await LearningStore.open(dir);
    const profiles = [
      { id:'fast',name:'快速路线',providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:2,priceUpdatedAt:'2026-09-12',enabled:true },
      { id:'careful',name:'严谨核验',providerName:'兼容服务',baseUrl:'https://example.test/v1',model:'careful-model',inputPriceCnyPerMillion:3,outputPriceCnyPerMillion:4,priceUpdatedAt:'2026-09-12',enabled:true },
    ];
    store.updateSettings({modelProfiles:profiles,activeModelProfileId:'fast',monthlyBudgetCny:100} as any);
    const seen:{model:string;key:string}[]=[];
    const runner=new CallRunner(store,(settings:any)=>'key-'+settings.activeModelProfileId,(settings,key)=>({complete:async()=>{
      seen.push({model:settings.model,key});
      return {...reply('{"text":"ready"}'),reportedModel:'resolved-'+settings.model};
    }}));
    try {
      await runner.run('第一次',{}, {schema});
      store.updateSettings({activeModelProfileId:'careful'} as any);
      await runner.run('第二次',{}, {schema});
      expect(seen).toEqual([{model:'deepseek-v4-flash',key:'key-fast'},{model:'careful-model',key:'key-careful'}]);
      expect(store.list('usage').map(u=>({profile:u.modelProfileId,name:u.profileName,requested:u.requestedModel,reported:u.reportedModel}))).toEqual([
        {profile:'fast',name:'快速路线',requested:'deepseek-v4-flash',reported:'resolved-deepseek-v4-flash'},
        {profile:'careful',name:'严谨核验',requested:'careful-model',reported:'resolved-careful-model'},
      ]);
    } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it('pins a reservation to the model profile that reserved its cost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reclimb-profile-reservation-'));
    const store = await LearningStore.open(dir);
    const profiles = [
      { id:'a',name:'A',providerName:'A',baseUrl:'https://a.test/v1',model:'model-a',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:'2026-09-12',enabled:true },
      { id:'b',name:'B',providerName:'B',baseUrl:'https://b.test/v1',model:'model-b',inputPriceCnyPerMillion:10,outputPriceCnyPerMillion:10,priceUpdatedAt:'2026-09-12',enabled:true },
    ];
    store.updateSettings({modelProfiles:profiles,activeModelProfileId:'a',monthlyBudgetCny:100} as any);
    const seen:string[]=[];
    const runner=new CallRunner(store,(settings:any)=>'key-'+settings.activeModelProfileId,(settings,key)=>({complete:async()=>{seen.push(settings.model+'/'+key);return reply('{"text":"ready"}');}}));
    try {
      await runner.withReservation('教学片段',.01,async reservationId=>{
        store.updateSettings({activeModelProfileId:'b'} as any);
        await runner.run('生成',{}, {schema,reservationId});
      });
      expect(seen).toEqual(['model-a/key-a']);
      expect(store.list('usage').find(u=>u.entryType==='call')).toMatchObject({modelProfileId:'a',requestedModel:'model-a'});
    } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it('attributes a vision call without borrowing the active teaching profile identity',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'reclimb-vision-attribution-')),store=await LearningStore.open(dir);
    store.updateSettings({monthlyBudgetCny:100,modelProfiles:[{id:'teaching',name:'教学模型',providerName:'教学服务',baseUrl:'https://teaching.test/v1',model:'teaching-model',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:'2026-09-12',enabled:true}],activeModelProfileId:'teaching'} as any);
    const runner=new CallRunner(store,()=> 'vision-key',()=>({complete:async()=>({...reply('{"text":"page"}'),reportedModel:'vision-resolved'})}));
    try{
      const settings={...store.getSettings(),providerName:'视觉服务',baseUrl:'https://vision.example/v1',model:'vision-model'};
      await runner.run('原页视觉转写',{}, {schema,settings,key:'vision-key',profileSnapshot:{name:'原页图像识别',providerName:'视觉服务'}});
      expect(store.list('usage')[0]).toMatchObject({profileName:'原页图像识别',providerName:'视觉服务',requestedModel:'vision-model',reportedModel:'vision-resolved'});
      expect(store.list('usage')[0].modelProfileId).toBeUndefined();
    }finally{store.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('never asks a configured model for more output than that profile supports, including format repair',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'reclimb-output-limit-')),store=await LearningStore.open(dir);
    store.updateSettings({monthlyBudgetCny:100,modelProfiles:[{id:'limited',name:'较短输出模型',providerName:'兼容服务',baseUrl:'https://limited.test/v1',model:'limited-model',maxOutputTokens:2048,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:'2026-09-12',enabled:true}],activeModelProfileId:'limited'} as any);
    const seen:number[]=[];let calls=0;const runner=new CallRunner(store,()=> 'key',()=>({complete:async request=>{seen.push(request.maxOutputTokens??0);calls++;return reply(calls===1?'invalid':'{"text":"ready"}');}}));
    try{await runner.run('学习路线',{}, {schema,maxOutputTokens:9000});expect(seen).toEqual([2048,2048]);}
    finally{store.close();rmSync(dir,{recursive:true,force:true});}
  });
});
