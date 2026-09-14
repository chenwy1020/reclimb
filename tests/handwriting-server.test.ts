import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {HandwritingServer,getHandwritingAddresses} from '../src/main/handwriting-server';
import type {HandwritingTarget} from '../src/shared/handwriting';

const servers:HandwritingServer[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();await Promise.all(servers.splice(0).map(s=>s.stop()));});
const target=(id='target-a'):HandwritingTarget=>({id,projectId:'project',projectTitle:'自编测试',sessionId:'session',taskId:'task',title:'比较两条路径',instruction:'写出比较理由。',sourceIds:[],helpLevel:0,mode:'practice',createdAt:new Date().toISOString()});
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'reclimb-handwriting-http-'));mkdirSync(join(directory,'assets'));writeFileSync(join(directory,'index.html'),'<!doctype html><title>本地手写</title>');writeFileSync(join(directory,'assets','app.js'),'window.handwriting=true');writeFileSync(join(directory,'app.js'),'window.handwriting=true');writeFileSync(join(directory,'style.css'),'body{color:green}');
 const targets=new Map([['target-a',target()],['target-b',target('target-b')]]);
 const saved=new Map<string,unknown>();
 const save=vi.fn((body:any)=>{if(saved.has(body.requestId)&&JSON.stringify(saved.get(body.requestId))!==JSON.stringify(body))throw new Error('同一编号不可修改内容');saved.set(body.requestId,body);return {id:body.requestId,requestId:body.requestId,targetId:body.targetId,savedAt:new Date().toISOString(),status:'saved_unassessed' as const};});
 const server=new HandwritingServer({staticDirectory:directory,workspaceId:'workspace-test',getTarget:id=>targets.get(id),save});servers.push(server);server.setTarget(target());
 const status=await server.start(0,'127.0.0.1'),url=new URL(status.urls[0]),origin=url.origin,ticket=new URLSearchParams(url.hash.slice(1)).get('ticket')!;
 async function post(path:string,body:unknown,token?:string,extra:Record<string,string>={}){return fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)});}
 async function pair(){const current=new URL(server.status().urls[0]);const ticket=new URLSearchParams(current.hash.slice(1)).get('ticket');const request=await (await post('/api/pair',{ticket,name:'测试 iPad'})).json();server.approve(request.requestId);const approved=await (await post('/api/pair/status',{requestId:request.requestId,pollToken:request.pollToken})).json();return {token:approved.token as string,request,approved};}
 return {server,origin,ticket,post,pair,save,saved,targets,directory};
}
const submission=(requestId='write-1',targetId='target-a')=>({requestId,targetId,note:'自己的推导',pages:[{id:'page-1',width:768,height:1024,strokes:[{id:'ink-1',color:'#253e31',width:2,points:[{x:0.2,y:0.3,pressure:0.5}]}]}]});

it('serves only the handwriting UI and requires pairing before exposing the task',async()=>{
 const t=await fixture(),page=await fetch(t.origin);expect(await page.text()).toContain('本地手写');expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(page.headers.get('referrer-policy')).toBe('no-referrer');
 expect((await fetch(t.origin+'/api/state')).status).toBe(401);expect((await fetch(t.origin+'/credentials.json')).status).toBe(404);expect((await fetch(t.origin+'/assets/app.js')).status).toBe(200);expect((await fetch(t.origin+'/learning:request')).status).toBe(404);expect(t.save).not.toHaveBeenCalled();
});
it('serves the companion builder root assets without opening other root files',async()=>{
 const t=await fixture();for(const [path,type] of [['/app.js','text/javascript'],['/style.css','text/css']]){const response=await fetch(t.origin+path);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain(type);}
 writeFileSync(join(t.directory,'secret.js'),'private');expect((await fetch(t.origin+'/secret.js')).status).toBe(404);
});
it('requires desktop confirmation and a separate polling secret',async()=>{
 const t=await fixture(),r=await(await t.post('/api/pair',{ticket:t.ticket,name:'我的 iPad'})).json();expect(r.code).toMatch(/^\d{6}$/);expect(t.server.status().pending).toMatchObject({id:r.requestId,name:'我的 iPad',code:r.code});
 expect(await(await t.post('/api/pair/status',{requestId:r.requestId,pollToken:r.pollToken})).json()).toEqual({status:'pending'});
 expect((await t.post('/api/pair/status',{requestId:r.requestId,pollToken:'wrong'})).status).toBe(403);t.server.approve(r.requestId);
 const approved=await(await t.post('/api/pair/status',{requestId:r.requestId,pollToken:r.pollToken})).json();expect(approved).toMatchObject({status:'approved',workspaceId:'workspace-test'});expect(approved.token.length).toBeGreaterThanOrEqual(40);
 expect(await(await fetch(t.origin+'/api/state',{headers:{Authorization:'Bearer '+approved.token}})).json()).toMatchObject({workspaceId:'workspace-test',target:{id:'target-a'}});
 expect(JSON.stringify(t.server.status())).not.toContain(approved.token);
});
it('consumes pairing tickets once and reports explicit rejection',async()=>{
 const t=await fixture(),r=await(await t.post('/api/pair',{ticket:t.ticket,name:'iPad'})).json();expect((await t.post('/api/pair',{ticket:t.ticket,name:'another'})).status).toBe(403);t.server.reject(r.requestId);
 expect(await(await t.post('/api/pair/status',{requestId:r.requestId,pollToken:r.pollToken})).json()).toEqual({status:'rejected'});expect(()=>t.server.approve(r.requestId)).toThrow();
});
it('expires the pairing ticket and pending request after ten minutes',async()=>{
 const t=await fixture(),now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);const r=await(await t.post('/api/pair',{ticket:t.ticket,name:'iPad'})).json();clock.mockReturnValue(now+600001);
 expect(()=>t.server.approve(r.requestId)).toThrow();expect((await t.post('/api/pair/status',{requestId:r.requestId,pollToken:r.pollToken})).status).toBe(403);clock.mockRestore();
});
it('rejects cross-origin, missing-origin and rebinding Host writes before saving',async()=>{
 const t=await fixture(),{token}=await t.pair();
 for(const Origin of ['https://attacker.example','null',t.origin+'.evil'])expect((await t.post('/api/submit',submission(),token,{Origin})).status).toBe(403);
 expect((await fetch(t.origin+'/api/submit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(submission())})).status).toBe(403);
 const rebinding=await new Promise<number>((resolve,reject)=>{const req=httpRequest(t.origin+'/api/submit',{method:'POST',headers:{Origin:t.origin,'Content-Type':'application/json',Authorization:'Bearer '+token,Host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end(JSON.stringify(submission()));});expect(rebinding).toBe(403);
 expect((await t.post('/api/submit',submission(),token,{'Content-Type':'text/plain'})).status).toBe(415);expect(t.save).not.toHaveBeenCalled();
});
it('never grants CORS or serves arbitrary paths',async()=>{
 const t=await fixture(),response=await fetch(t.origin+'/api/state',{method:'OPTIONS',headers:{Origin:'https://attacker.example','Access-Control-Request-Method':'POST'}});expect(response.status).toBe(403);expect(response.headers.get('access-control-allow-origin')).toBeNull();
 for(const path of ['/%2e%2e%2fpackage.json','/assets/%5c..%5csecret.txt','/assets/app.js.map','/api/unknown'])expect((await fetch(t.origin+path)).status).toBeGreaterThanOrEqual(400);
});
it('binds submissions to the original target after switching and accepts idempotent retries',async()=>{
 const t=await fixture(),{token}=await t.pair();t.server.setTarget(target('target-b'));
 const first=await(await t.post('/api/submit',submission(),token)).json(),retry=await(await t.post('/api/submit',submission(),token)).json();expect(first.targetId).toBe('target-a');expect(retry.id).toBe(first.id);expect(t.saved.size).toBe(1);expect((t.saved.get('write-1') as any).targetId).toBe('target-a');
 expect((await t.post('/api/submit',submission('absent','unowned'),token)).status).toBe(409);
 t.targets.delete('target-a');expect((await t.post('/api/submit',submission('deleted'),token)).status).toBe(409);
});
it('rejects invalid or oversized ink before invoking persistence',async()=>{
 const t=await fixture(),{token}=await t.pair();expect((await t.post('/api/submit',{...submission(),pages:[]},token)).status).toBe(400);
 expect((await t.post('/api/submit',{...submission(),note:'a'.repeat(8*1024*1024)},token)).status).toBe(413);expect(t.save).not.toHaveBeenCalled();
});
it('renewing pairing preserves the current device until a different device is approved',async()=>{
 const t=await fixture(),first=await t.pair();t.server.renewPairing();expect((await fetch(t.origin+'/api/state',{headers:{Authorization:'Bearer '+first.token}})).status).toBe(200);
 const second=await t.pair();expect(second.token).not.toBe(first.token);expect((await fetch(t.origin+'/api/state',{headers:{Authorization:'Bearer '+first.token}})).status).toBe(401);expect((await fetch(t.origin+'/api/state',{headers:{Authorization:'Bearer '+second.token}})).status).toBe(200);
});
it('stopping closes connections and restarting invalidates earlier device tokens',async()=>{
 const t=await fixture(),{token}=await t.pair();await t.server.stop();expect(t.server.status()).toMatchObject({running:false,urls:[]});expect(t.server.status().connected).toBeUndefined();const next=await t.server.start(0,'127.0.0.1'),origin=new URL(next.urls[0]).origin;
 expect((await fetch(origin+'/api/state',{headers:{Authorization:'Bearer '+token}})).status).toBe(401);
});
it('a busy fixed port fails explicitly instead of changing the address',async()=>{
 const t=await fixture(),other=new HandwritingServer({staticDirectory:t.directory,workspaceId:'other',getTarget:()=>undefined,save:()=>{throw new Error('unused');}});servers.push(other);
 await expect(other.start(Number(new URL(t.origin).port),'127.0.0.1')).rejects.toThrow('端口');expect(other.status().running).toBe(false);
});
it('rejects public bind addresses and enumerates only private IPv4 addresses',async()=>{
 const t=await fixture();await t.server.stop();await expect(t.server.start(0,'8.8.8.8')).rejects.toThrow();for(const address of getHandwritingAddresses())expect(address).toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
});
it('revokes an authorized request if the device changes while its body is arriving',async()=>{
 const t=await fixture(),first=await t.pair(),body=JSON.stringify(submission());
 let begin!:()=>void;const started=new Promise<void>(r=>begin=r);
 const response=new Promise<number>((resolve,reject)=>{const req=httpRequest(t.origin+'/api/submit',{method:'POST',headers:{Origin:t.origin,'Content-Type':'application/json',Authorization:'Bearer '+first.token,'Content-Length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.write(body.slice(0,body.length-1));begin();void started.then(async()=>{t.server.renewPairing();await t.pair();req.end(body.slice(-1));}).catch(reject);});
 expect(await response).toBe(401);expect(t.save).not.toHaveBeenCalled();
});
it('limits invalid pairing attempts and does not reveal whether a task exists before authorization',async()=>{
 const t=await fixture();for(let i=0;i<12;i++)expect((await t.post('/api/pair',{ticket:'invalid',name:'unknown'})).status).toBe(403);
 expect((await t.post('/api/pair',{ticket:t.ticket,name:'iPad'})).status).toBe(429);expect((await t.post('/api/submit',submission('other','unknown'))).status).toBe(401);expect(t.save).not.toHaveBeenCalled();
});
it('rejects an expired unconsumed QR ticket',async()=>{
 const t=await fixture();vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001);expect((await t.post('/api/pair',{ticket:t.ticket,name:'iPad'})).status).toBe(403);expect(t.server.status().pairingExpiresAt).toBeUndefined();
});
it('ends an incomplete upload without invoking persistence',async()=>{
 const t=await fixture(),{token}=await t.pair();
 const status=await new Promise<number>((resolve,reject)=>{const req=httpRequest(t.origin+'/api/submit',{method:'POST',headers:{Origin:t.origin,'Content-Type':'application/json',Authorization:'Bearer '+token,'Content-Length':100}},res=>{res.resume();res.on('end',()=>{resolve(res.statusCode!);req.destroy();});});req.on('error',reject);req.write('{');});
 expect(status).toBe(408);expect(t.save).not.toHaveBeenCalled();
},15000);
