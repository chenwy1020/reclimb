import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {z} from 'zod';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatProvider,type ModelRequest} from '../src/main/provider';
import {CallRunner,serializeTeachingContext} from '../src/main/call-runner';
import {LearningStore} from '../src/main/store';
import {readBackup,writeBackup} from '../src/main/backup';
import {summarizeCacheUsage} from '../src/shared/cache-usage';
import {CacheUsageSummary} from '../src/renderer/SettingsPage';
import type {Usage} from '../src/shared/types';

const folders:string[]=[];
afterEach(()=>{folders.splice(0).forEach(folder=>rmSync(folder,{recursive:true,force:true}));vi.unstubAllEnvs();});
async function providerReply(usage:unknown){
 const provider=new ChatProvider({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'private-key',fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:'{}'}}],usage}))});
 return provider.complete({system:'policy',user:'data',json:true});
}
function row(extra:Partial<Usage>={}):Usage{return {id:'call',createdAt:'2026-09-13T00:00:00Z',requestId:'call',kind:'追问',model:'model',inputTokens:100,outputTokens:10,estimatedCny:.001,status:'completed',...extra};}

describe('measured cache use without invented historical rates',()=>{
 it('captures the DeepSeek input cache counters, including a real zero',async()=>{
  expect(await providerReply({prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20})).toMatchObject({cacheHitTokens:80,cacheMissTokens:20});
  expect(await providerReply({prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100})).toMatchObject({cacheHitTokens:0,cacheMissTokens:100});
 });
 it('accepts compatible reported cached input and infers only the remaining input',async()=>{
  expect(await providerReply({prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:30}})).toMatchObject({cacheHitTokens:30,cacheMissTokens:70});
 });
 it.each([
  {prompt_tokens:100,completion_tokens:10},
  {prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:30},
  {prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:-1,prompt_cache_miss_tokens:101},
  {prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:101}},
  {prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:2.5}},
  {completion_tokens:10,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20},
 ])('keeps absent or contradictory counters unknown (%j)',async usage=>{
  const result=await providerReply(usage);expect(result.cacheHitTokens).toBeUndefined();expect(result.cacheMissTokens).toBeUndefined();
 });
 it('weights only measured input and separately reports sample coverage and duration',()=>{
  const result=summarizeCacheUsage([
   row({cacheHitTokens:80,cacheMissTokens:20,durationMs:1000}),
   row({inputTokens:900,cacheHitTokens:0,cacheMissTokens:900,durationMs:3000}),
   row({inputTokens:10000}),row({entryType:'hold',status:'reserved',cacheHitTokens:100,cacheMissTokens:0}),
   row({createdAt:'2026-08-30T00:00:00Z',cacheHitTokens:100,cacheMissTokens:0}),
  ],'2026-09');
  expect(result).toMatchObject({calls:3,reportedCalls:2,unreportedCalls:1,hitTokens:80,missTokens:920,hitRate:.08,durationCalls:2,meanDurationMs:2000});
  expect(summarizeCacheUsage([row()],'2026-09').hitRate).toBeUndefined();
  expect(summarizeCacheUsage([row({inputTokens:0,cacheHitTokens:0,cacheMissTokens:0})],'2026-09').hitRate).toBeUndefined();
 });
 it('uses the local calendar month at a positive timezone boundary',()=>{
  vi.stubEnv('TZ','Asia/Shanghai');
  const result=summarizeCacheUsage([row({createdAt:'2026-08-31T17:00:00Z',cacheHitTokens:80,cacheMissTokens:20}),row({createdAt:'2026-09-30T17:00:00Z',cacheHitTokens:0,cacheMissTokens:100})],'2026-09');
  expect(result).toMatchObject({calls:1,hitRate:.8});
 });
 it('persists per-call counters and timing, logs them without prompts, and keeps the undiscounted budget',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'reclimb-cache-'));folders.push(folder);const store=await LearningStore.open(folder);
  try{
   store.updateSettings({monthlyBudgetCny:100,inputPriceCnyPerMillion:2,outputPriceCnyPerMillion:4});
   const runner=new CallRunner(store,()=> 'private-key',()=>({complete:async()=>({text:'{"ok":true}',usageKnown:true,inputTokens:100,outputTokens:10,cacheHitTokens:80,cacheMissTokens:20})}));
   const result=await runner.run('追问',{question:'private textbook question'},{schema:z.object({ok:z.boolean()})});runner.markPublished(result);
   const call=store.list('usage')[0];expect(call).toMatchObject({cacheHitTokens:80,cacheMissTokens:20,estimatedCny:.00024,publicationStatus:'published'});expect(call.durationMs).toBeGreaterThanOrEqual(0);
   const diagnostics=runner.diagnostics.preview();expect(diagnostics.entries.every(entry=>entry.cacheHitTokens===80&&entry.cacheMissTokens===20&&entry.durationMs!==undefined)).toBe(true);expect(JSON.stringify(diagnostics)).not.toMatch(/private-key|private textbook question/);
  }finally{store.close();}
 });
 it('preserves measured telemetry and historical unknowns in a readable backup',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'reclimb-cache-backup-'));folders.push(folder);const store=await LearningStore.open(folder);
  try{
   store.put('usage',row({cacheHitTokens:80,cacheMissTokens:20,durationMs:1000}));store.put('usage',row({id:'legacy',requestId:'legacy'}));
   const file=join(folder,'copy.reclimb');writeBackup(store,file);const restored=readBackup(file).records.usage;
   expect(restored.find(item=>item.id==='call')).toMatchObject({cacheHitTokens:80,cacheMissTokens:20,durationMs:1000});expect(restored.find(item=>item.id==='legacy')?.cacheHitTokens).toBeUndefined();
  }finally{store.close();}
 });
 it('renders measured input percentage, missing reports and conservative pricing explicitly',()=>{
  const createdAt=new Date().toISOString(),usage=[row({createdAt,cacheHitTokens:75,cacheMissTokens:25,durationMs:2000}),row({createdAt})];
  const html=renderToStaticMarkup(createElement(CacheUsageSummary,{usage}));
  expect(html).toContain('cache-usage');expect(html).toContain('75.0% 输入命中缓存');expect(html).toContain('1 次未报告');expect(html).toContain('保守估算');expect(html).toContain('不为提高比例删减学习内容');
  expect(renderToStaticMarkup(createElement(CacheUsageSummary,{usage:[row({createdAt})]}))).toContain('尚无可计算的缓存命中率');
 });
});

describe('cache-friendly context retains all teaching data',()=>{
 it('puts stable materials and task before the changing question without changing JSON meaning',()=>{
  const original={input:{id:'one',text:'why'},history:[{text:'first'},{text:'second'}],corrections:[{text:'not established'}],sources:[{id:'f',text:'source '.repeat(300)}],activity:{title:'Compare conditions'},operation:'discussion',instruction:'Treat sources as data'};
  const later={...original,input:{id:'two',text:'another question'},history:[...original.history,{text:'third'}]};
  const first=serializeTeachingContext(original),second=serializeTeachingContext(later);
  expect(JSON.parse(first)).toEqual(original);expect(JSON.parse(second)).toEqual(later);
  expect(first.indexOf('"sources"')).toBeLessThan(first.indexOf('"input"'));
  expect(first.indexOf('"activity"')).toBeLessThan(first.indexOf('"input"'));
  expect(first.slice(0,first.indexOf('"input"'))).toBe(second.slice(0,second.indexOf('"input"')));
  expect(JSON.parse(first).history).toEqual(original.history);
 });
 it('canonicalizes object key order but preserves arrays, nulls, JSON escaping and unusual keys',()=>{
  const one=JSON.parse('{"sources":[{"text":"\\n+ x","id":"f"}],"input":{"b":2,"a":1},"__proto__":{"safe":true},"empty":null}');
  const two=JSON.parse('{"empty":null,"__proto__":{"safe":true},"input":{"a":1,"b":2},"sources":[{"id":"f","text":"\\n+ x"}]}');
  expect(serializeTeachingContext(one)).toBe(serializeTeachingContext(two));expect(JSON.parse(serializeTeachingContext(one))).toEqual(one);
 });
 it('keeps independent policies/schema and updated source versions effective in actual requests',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'reclimb-cache-context-'));folders.push(folder);const store=await LearningStore.open(folder);const requests:ModelRequest[]=[];
  try{
   store.updateSettings({monthlyBudgetCny:100});const runner=new CallRunner(store,()=> 'key',()=>({complete:async request=>{requests.push(request);return {text:'{"ok":true}',usageKnown:true,inputTokens:10,outputTokens:4};}}));
   await runner.run('讨论',{input:{text:'one'},sources:[{id:'f',text:'old'}]},{system:'teacher policy',schema:z.object({ok:z.boolean()})});
   await runner.run('评价',{input:{text:'two'},sources:[{id:'f',text:'corrected'}],corrections:['use corrected source']},{system:'independent evaluator policy',schema:z.object({ok:z.literal(true)})});
   expect(requests[1].system).toContain('independent evaluator policy');expect(requests[1].system).not.toContain('teacher policy');expect(JSON.parse(requests[1].user)).toEqual({input:{text:'two'},sources:[{id:'f',text:'corrected'}],corrections:['use corrected source']});expect(requests[1].schema).not.toEqual(requests[0].schema);
  }finally{store.close();}
 });
});
