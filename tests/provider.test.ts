import { describe,it,expect } from 'vitest';
import { buildChatUrl, parseModelJson, ChatProvider } from '../src/main/provider';
describe('model boundary',()=>{
 it('keeps bounded, redacted provider schema errors separate from the user-facing message',async()=>{
  const p=new ChatProvider({baseUrl:'https://example.org',model:'x',apiKey:'private-key',fetcher:async()=>new Response(JSON.stringify({error:{message:'Unsupported root schema. token private-key'}}),{status:400,headers:{'x-request-id':'reject-1'}})});
  try{await p.complete({system:'s',user:'u',json:true});throw new Error('expected rejection');}catch(error:any){expect(error.message).toContain('请求格式');expect(error.diagnosticDetail).toContain('Unsupported root schema');expect(error.diagnosticDetail).not.toContain('private-key');expect(error.providerRequestId).toBe('reject-1');expect(error.definitelyUnbilled).toBe(true);}
 });
 it('reserves structured answer space on the verified Fireworks model without exposing reasoning text',async()=>{
  let sent:any;const p=new ChatProvider({baseUrl:'https://api.fireworks.ai/inference/v1',model:'accounts/fireworks/models/deepseek-v4-flash-0731',apiKey:'x',fetcher:async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({id:'truncated',choices:[{finish_reason:'length',message:{content:null,reasoning_content:'private reasoning must not be returned'}}],usage:{prompt_tokens:10,completion_tokens:3000,completion_tokens_details:{reasoning_tokens:3000}}}));}});
  const result=await p.complete({system:'s',user:'u',json:true,schema:{type:'object'}});
  expect(sent.reasoning_effort).toBeUndefined();
  expect(sent.thinking).toEqual({type:'enabled',budget_tokens:2048});
  expect(result).toMatchObject({text:'',finishReason:'length',outputTokens:3000,reasoningTokens:3000,usageKnown:true});
  expect(JSON.stringify(result)).not.toContain('private reasoning');
 });
 it('does not change reasoning controls for other providers, models, or short requests',async()=>{
  for(const [baseUrl,model,maxOutputTokens] of [['https://example.org/v1','accounts/fireworks/models/deepseek-v4-flash-0731',6000],['https://api.fireworks.ai/inference/v1','different-model',6000],['https://api.fireworks.ai/inference/v1','accounts/fireworks/models/deepseek-v4-flash-0731',2000]] as const){
   let sent:any;const p=new ChatProvider({baseUrl,model,apiKey:'x',fetcher:async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));}});
   await p.complete({system:'s',user:'u',json:true,schema:{type:'object'},maxOutputTokens});expect(sent.thinking).toBeUndefined();expect(sent.reasoning_effort).toBeUndefined();
  }
 });
 it('uses a schema on Fireworks and preserves finish reason and provider request id',async()=>{let sent:any;const p=new ChatProvider({baseUrl:'https://api.fireworks.ai/inference/v1',model:'configured-model',apiKey:'x',fetcher:async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({id:'remote-1',choices:[{finish_reason:'length',message:{content:'{"ok":'}}],usage:{prompt_tokens:12,completion_tokens:4096}}));}});const r=await p.complete({system:'s',user:'u',json:true,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}});expect(sent.response_format.type).toBe('json_schema');expect(r.finishReason).toBe('length');expect(r.providerRequestId).toBe('remote-1');});
 it('attaches only explicitly supplied images to the user message',async()=>{let sent:any;const p=new ChatProvider({baseUrl:'https://example.org/v1',model:'vision',apiKey:'x',fetcher:async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({choices:[{message:{content:'{"text":"x"}'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:5}}));}});await p.complete({system:'s',user:'transcribe',json:true,images:[{dataUrl:'data:image/png;base64,YQ=='}]});expect(sent.messages[1].content[0]).toEqual({type:'text',text:'transcribe'});expect(sent.messages[1].content[1].image_url.url).toBe('data:image/png;base64,YQ==');});
 it('preserves compatible API base paths',()=>{expect(buildChatUrl('https://example.org/v1/')).toBe('https://example.org/v1/chat/completions');});
 it('rejects credentials and unsafe schemes',()=>{expect(()=>buildChatUrl('file:///secret')).toThrow();expect(()=>buildChatUrl('https://user:pass@example.org')).toThrow();});
 it('accepts fenced JSON but rejects empty or invalid responses',()=>{expect(parseModelJson('~~~json\n{"ok":true}\n~~~'.replaceAll('~~~',String.fromCharCode(96).repeat(3)))).toEqual({ok:true});expect(()=>parseModelJson('')).toThrow();});
 it('does not disclose keys in error text',async()=>{const provider=new ChatProvider({baseUrl:'https://example.org',model:'test',apiKey:'secret-value',fetcher:async()=>new Response('token secret-value is invalid',{status:401}) as any});await expect(provider.complete({system:'x',user:'x',json:true})).rejects.toThrow('认证');});
 it('requires actual assistant content and finite token counts',async()=>{const p=new ChatProvider({baseUrl:'https://example.org',model:'test',apiKey:'x',fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:12,completion_tokens:5}})) as any});expect(await p.complete({system:'s',user:'u',json:true})).toMatchObject({text:'{"ok":true}',inputTokens:12,outputTokens:5});});
});

