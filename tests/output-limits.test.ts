import {describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {z} from 'zod';
import {modelProfileSaveSchema,settingsInputSchema} from '../src/main/settings-schema';
import {LearningStore,normalizeSettings} from '../src/main/store';
import {prepareRestore,readBackup,writeBackup} from '../src/main/backup';
import {CallRunner} from '../src/main/call-runner';
import {ChatProvider} from '../src/main/provider';
import {reserveCost} from '../src/main/budget';

const profile=(maxOutputTokens:number)=>({id:'flash',name:'快速学习',providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',maxOutputTokens,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:'2026-09-12',enabled:true});

describe('large model output capacity',()=>{
 it.each([512,12000,384000,393216])('accepts and preserves an integer capacity of %i through both settings contracts',maxOutputTokens=>{
  expect(modelProfileSaveSchema.parse({profile:profile(maxOutputTokens)}).profile.maxOutputTokens).toBe(maxOutputTokens);
  expect(settingsInputSchema.parse({maxOutputTokens}).maxOutputTokens).toBe(maxOutputTokens);
  expect(normalizeSettings({maxOutputTokens}).maxOutputTokens).toBe(maxOutputTokens);
  expect(normalizeSettings({modelProfiles:[profile(maxOutputTokens)],activeModelProfileId:'flash'}).maxOutputTokens).toBe(maxOutputTokens);
 });

 it.each([511,393217,12000.5,NaN,Infinity,'384000'])('rejects invalid capacity %s with a readable Chinese explanation',value=>{
  for(const result of [modelProfileSaveSchema.safeParse({profile:{...profile(12000),maxOutputTokens:value}}),settingsInputSchema.safeParse({maxOutputTokens:value})]){
   expect(result.success).toBe(false);
   if(!result.success)expect(result.error.issues[0].message).toMatch(/单次回复上限.*512.*393216.*整数/);
  }
 });

 it.each([384000,393216])('retains capacity %i after saving, restarting and restoring a portable backup',async maxOutputTokens=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-large-output-')),workspace=join(root,'workspace');
  let store=await LearningStore.open(workspace);
  try{
   const parsed=modelProfileSaveSchema.parse({profile:profile(maxOutputTokens)});
   store.updateSettings({modelProfiles:[{...parsed.profile,id:'flash'}],activeModelProfileId:'flash'});
   store.close();store=await LearningStore.open(workspace);
   expect(store.getSettings().maxOutputTokens).toBe(maxOutputTokens);
   expect(store.getSettings().modelProfiles?.[0].maxOutputTokens).toBe(maxOutputTokens);
   const backup=join(root,'settings.reclimb');writeBackup(store,backup);
   expect(readBackup(backup).records.settings.maxOutputTokens).toBe(maxOutputTokens);
   await prepareRestore(backup,join(root,'restored'));
   const restored=await LearningStore.open(join(root,'restored'));
   try{expect(restored.getSettings().maxOutputTokens).toBe(maxOutputTokens);expect(restored.getSettings().modelProfiles?.[0].maxOutputTokens).toBe(maxOutputTokens);}
   finally{restored.close();}
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
 });

 it('uses the task-sized request and reservation despite a much larger configured capacity',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-capacity-budget-')),store=await LearningStore.open(root),sent:{tokens:number;reserved:number;inputCharacters:number}[]=[];
  store.updateSettings({modelProfiles:[profile(393216)],activeModelProfileId:'flash',monthlyBudgetCny:.1});
  const runner=new CallRunner(store,()=> 'test-key',()=>({complete:async request=>{
   sent.push({tokens:request.maxOutputTokens!,reserved:store.list('usage').find(row=>row.status==='reserved')!.estimatedCny,inputCharacters:request.messages!.reduce((sum,message)=>sum+message.content.length+32,0)+(request.schema?JSON.stringify(request.schema).length:0)});
   return{text:sent.length===1?'unfinished':'{"ok":true}',finishReason:sent.length===1?'length':'stop',inputTokens:10,outputTokens:10,usageKnown:true};
  }}));
  try{
   expect(store.getSettings().maxOutputTokens).toBe(393216);
   expect(runner.estimateCost(100,9000)).toBe(reserveCost(100,9000,1,1));
   await runner.run('学习路线',{}, {maxOutputTokens:9000,schema:z.object({ok:z.literal(true)})});
   expect(sent.map(call=>call.tokens)).toEqual([9000,12000]);
   for(const call of sent)expect(call.reserved).toBe(reserveCost(call.inputCharacters,call.tokens,1,1));
   expect(store.list('usage')).toHaveLength(2);
   store.updateSettings({monthlyBudgetCny:0});
   await expect(runner.run('再次生成',{}, {maxOutputTokens:9000})).rejects.toThrow(/预算/);
   expect(sent).toHaveLength(2);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
 });

 it('passes an explicitly requested larger output limit to the compatible provider unchanged',async()=>{
  let sent:any;
  const provider=new ChatProvider({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'test-key',fetcher:async(_url,options)=>{
   sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));
  }});
  await provider.complete({system:'s',user:'u',json:true,maxOutputTokens:393216});
  expect(sent.max_tokens).toBe(393216);
 });
});
