import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {CallRunner} from '../src/main/call-runner';
import {LearningStore} from '../src/main/store';
import {ChatProvider,type ModelRequest} from '../src/main/provider';
import {reserveCost} from '../src/main/budget';
describe('cache reuse keeps strict validation',()=>{
 it('places changing constraints after materials and appends repairs without changing the first request',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reclimb-prefix-')),store=await LearningStore.open(dir),requests:ModelRequest[]=[];
  store.updateSettings({monthlyBudgetCny:100,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1});
  const reservations:number[]=[];const runner=new CallRunner(store,()=> 'secret',()=>({complete:async request=>{requests.push(request);reservations.push(store.list('usage').filter(u=>u.status==='reserved').at(-1)!.estimatedCny);return {text:JSON.stringify({sourceId:requests.length===1?'wrong':'source-1'}),usageKnown:true,inputTokens:100,outputTokens:10};}}));
  try{
   await runner.run('讨论',{sources:[{id:'source-1',text:'original source'}],question:'why'},{schema:z.object({sourceId:z.enum(['source-1'])})});
   expect(requests).toHaveLength(2);expect(requests[0].system).not.toContain('source-1');
   expect(requests[1].messages!.slice(0,requests[0].messages!.length)).toEqual(requests[0].messages);
   expect(requests[0].messages![1].content).toContain('original source');expect(requests[0].messages!.at(-1)!.content).toContain('source-1');
   expect(requests[1].messages!.at(-1)!.role).toBe('user');expect(requests[1].messages!.at(-1)!.content).toContain('wrong');
   expect(reservations[1]).toBe(reserveCost(requests[1].messages!.reduce((n,m)=>n+m.content.length+32,0)+JSON.stringify(requests[1].schema).length,requests[1].maxOutputTokens!,1,1));
   expect(store.list('usage').filter(u=>u.requestPhase==='repair')).toHaveLength(1);
   expect(JSON.stringify(runner.diagnostics.preview())).not.toContain('original source');
  }finally{store.close();rmSync(dir,{recursive:true,force:true})}
 });
 it('uses the explicit message sequence and retains Fireworks native schema',async()=>{
  let body:any;const provider=new ChatProvider({baseUrl:'https://api.fireworks.ai/inference/v1',model:'model',apiKey:'test',fetcher:async(_url,init)=>{body=JSON.parse(init!.body as string);return Response.json({choices:[{message:{content:'{}'}}],usage:{prompt_tokens:10,completion_tokens:2}})}});
  const messages=[{role:'system' as const,content:'policy'},{role:'user' as const,content:'source'},{role:'assistant' as const,content:'old answer'},{role:'user' as const,content:'new question'}],schema={type:'object',properties:{}};
  await provider.complete({system:'policy',user:'compatibility data',messages,json:true,schema});expect(body.messages).toEqual(messages);expect(body.response_format.json_schema.schema).toEqual(schema);
 });
});
