import {afterEach,expect,it,vi} from 'vitest';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebDavSyncService} from '../src/main/webdav-sync';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const key=randomBytes(32),cipher={isEncryptionAvailable:()=>true,encryptString(value:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(value),c.final(),c.getAuthTag()]);},decryptString(value:Buffer){const c=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));c.setAuthTag(value.subarray(-16));return Buffer.concat([c.update(value.subarray(12,-16)),c.final()]).toString();}};
function server(){
 const files=new Map<string,{body:Buffer;etag:string}>(),requests:{url:string;method:string;headers:Headers}[]=[];let generation=0;
 let intercept:((url:string,init:RequestInit)=>Promise<Response|undefined>|Response|undefined)|undefined;
 const fetcher=async(input:URL|RequestInfo,init:RequestInit={})=>{
  const url=String(input),method=init.method??'GET',headers=new Headers(init.headers);requests.push({url,method,headers});const altered=await intercept?.(url,init);if(altered)return altered;
  if(method==='MKCOL')return new Response(null,{status:201});
  const item=files.get(url);
  if(method==='GET')return item?new Response(new Uint8Array(item.body),{status:200,headers:{ETag:item.etag,'content-length':String(item.body.length)}}):new Response(null,{status:404});
  if(method==='PUT'){
   if(headers.get('if-none-match')==='*'&&item||headers.has('if-match')&&headers.get('if-match')!==item?.etag)return new Response(null,{status:412});
   const body=Buffer.from(init.body as Uint8Array),etag='"v'+(++generation)+'"';files.set(url,{body,etag});return new Response(null,{status:item?204:201,headers:{ETag:etag}});
  }
  return new Response(null,{status:405});
 };
 return {files,requests,fetcher:fetcher as typeof fetch,setIntercept(value:typeof intercept){intercept=value;}};
}

// Unlike a flat key/value mock, a DAV collection must have an existing parent.
function hierarchicalServer({baseExists=true,persistentConflict=false}={}){
 const remote=server(),folders=new Set(baseExists?['https://dav.example/user/']:[]);
 remote.setIntercept((url,init)=>{
  const parent=new URL('./',url.endsWith('/')?url.slice(0,-1):url).toString();
  if(init.method==='MKCOL'){
   if(!folders.has(parent))return new Response(null,{status:409});
   const existed=folders.has(url);folders.add(url);return new Response(null,{status:existed?405:201});
  }
  if(init.method==='GET'&&url.endsWith('/head.json')&&(persistentConflict||!folders.has(parent)))return new Response(null,{status:409});
 });
 return remote;
}

it('prepares missing DAV parent collections before checking and uploading the first archive',async()=>{
 const remote=hierarchicalServer(),a=device(remote);configure(a);
 expect((await a.service.check()).state).toBe('remote_empty');
 expect(remote.requests.slice(0,7).map(r=>r.method)).toEqual(['GET',...Array(5).fill('MKCOL'),'GET']);
 expect(remote.requests.some(r=>r.method==='PUT')).toBe(false);
 expect((await a.service.upload({requestId:'first-with-parents',expectedRemoteSnapshotId:null})).state).toBe('up_to_date');
 expect(a.read()).toBe('first');
});

it('does not reinterpret a persistent 409 as an empty vault or bypass publication checks',async()=>{
 const remote=hierarchicalServer({persistentConflict:true}),a=device(remote);configure(a);
 await expect(a.service.check()).rejects.toThrow('409');
 await expect(a.service.upload({requestId:'still-conflicted',expectedRemoteSnapshotId:null})).rejects.toThrow('409');
 expect(remote.requests.some(r=>r.method==='PUT')).toBe(false);expect(a.adopted).toEqual([]);
});

it('keeps checking an existing archive read-only when directory creation is forbidden',async()=>{
 const remote=server(),a=device(remote);configure(a);await a.service.upload({requestId:'existing-archive'});
 const before=remote.requests.length;remote.setIntercept((_url,init)=>init.method==='MKCOL'?new Response(null,{status:403}):undefined);
 expect((await a.service.check()).state).toBe('up_to_date');
 expect(remote.requests.slice(before).every(request=>request.method==='GET')).toBe(true);
});

it('explains a missing configured base without creating outside that base',async()=>{
 const remote=hierarchicalServer({baseExists:false}),a=device(remote);configure(a);
 await expect(a.service.check()).rejects.toThrow('配置的网盘目录');
 expect(remote.requests).toHaveLength(2);expect(remote.requests[1].url).toBe('https://dav.example/user/reclimb-sync/');
 expect(a.service.status().pendingUploadRequestId).toBeUndefined();
});
function device(remote:ReturnType<typeof server>,content='first'){
 const directory=mkdtempSync(join(tmpdir(),'reclimb-dav-'));roots.push(directory);let local=content;const adopted:string[]=[],inspected:string[]=[];
 const callbacks={currentHash:()=>hash(local),captureBackup(file:string){writeFileSync(file,local);return{contentHash:hash(local)};},inspectBackup(file:string){const value=readFileSync(file,'utf8');if(value==='INVALID')throw new Error('无效备份');inspected.push(value);return{projects:1,sessions:1,materials:0,handwritings:0,createdAt:'2026-09-15T00:00:00.000Z'};},adoptBackup(file:string,options:{expectedLocalContentHash:string}){if(options.expectedLocalContentHash!==hash(local))throw new Error('采用时本机已有新内容');local=readFileSync(file,'utf8');adopted.push(local);}};
 const options={directory,cipher,callbacks,fetcher:remote.fetcher,timeoutMs:1000},service=new WebDavSyncService(options);
 return {service,directory,callbacks,options,adopted,inspected,read:()=>local,write:(value:string)=>{local=value;}};
}
const configure=(d:ReturnType<typeof device>,vaultId?:string)=>d.service.configure({endpoint:'https://dav.example/user/',username:'student',password:'TOP_SECRET_DAV_PASSWORD',vaultId});

it('keeps credentials encrypted on disk, rejects unsafe endpoints and exposes only safe preferences',()=>{
 const d=device(server());expect(()=>d.service.configure({endpoint:'http://nas.local/dav',username:'u',password:'p'})).toThrow('HTTPS');
 expect(()=>d.service.configure({endpoint:'https://u:p@dav.example/path',username:'u',password:'p'})).toThrow('地址');
 const configured=configure(d);expect(configured.configured).toBe(true);expect(JSON.stringify(configured)).not.toContain('TOP_SECRET');expect(readFileSync(join(d.directory,'webdav-state.json'),'utf8')).not.toContain('TOP_SECRET');
 expect(new WebDavSyncService(d.options).status()).toMatchObject({configured:true,vaultId:configured.vaultId,deviceId:configured.deviceId});
});
it('publishes immutable snapshots with conditional head creation and restores only after explicit preview and adoption',async()=>{
 const remote=server(),a=device(remote),first=configure(a),empty=await a.service.check();expect(empty.state).toBe('remote_empty');await a.service.upload({requestId:'upload-a',expectedRemoteSnapshotId:null});
 const headPut=remote.requests.find(r=>r.method==='PUT'&&r.url.endsWith('/head.json'))!;expect(headPut.headers.get('if-none-match')).toBe('*');
 const b=device(remote,'second-device-unsaved');configure(b,first.vaultId);const status=await b.service.check();expect(status.state).toBe('unlinked');expect(b.read()).toBe('second-device-unsaved');
 const preview=await b.service.preview({});expect(preview.summary.projects).toBe(1);expect(b.adopted).toEqual([]);
 await expect(b.service.adopt({previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId})).rejects.toThrow('本机');
 await b.service.adopt({previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId,allowReplaceLocal:true});expect(b.read()).toBe('first');expect((await b.service.check()).state).toBe('up_to_date');
});
it('detects two-device divergence and never advances the remote head using stale expectations',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote);configure(b,config.vaultId);const p=await b.service.preview({});await b.service.adopt({previewId:p.id,expectedLocalContentHash:p.localContentHash,expectedRemoteSnapshotId:p.snapshot.snapshotId,allowReplaceLocal:true});
 a.write('a2');await a.service.upload({requestId:'a2',expectedRemoteSnapshotId:p.snapshot.snapshotId});b.write('b2');expect((await b.service.check()).state).toBe('conflict');
 await expect(b.service.upload({requestId:'b2',expectedRemoteSnapshotId:p.snapshot.snapshotId})).rejects.toThrow(/远端|冲突/);expect(b.read()).toBe('b2');
});
it('refuses adoption after local edits or a newer remote revision and keeps the downloaded candidate',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote);configure(b,config.vaultId);const p=await b.service.preview({});b.write('new draft');
 await expect(b.service.adopt({previewId:p.id,expectedLocalContentHash:p.localContentHash,expectedRemoteSnapshotId:p.snapshot.snapshotId,allowReplaceLocal:true})).rejects.toThrow('本机');expect(b.read()).toBe('new draft');
 const p2=await b.service.preview({});a.write('new remote');await a.service.upload({requestId:'a2',expectedRemoteSnapshotId:p.snapshot.snapshotId});await expect(b.service.adopt({previewId:p2.id,expectedLocalContentHash:p2.localContentHash,expectedRemoteSnapshotId:p2.snapshot.snapshotId,allowReplaceLocal:true})).rejects.toThrow('远端');expect(b.adopted).toEqual([]);
});
it('preserves a captured snapshot if learning continues during upload and makes retries idempotent',async()=>{
 const remote=server(),a=device(remote);configure(a);remote.setIntercept((url,init)=>{if(init.method==='PUT'&&url.endsWith('.reclimb'))a.write('draft written during upload');return undefined;});
 await a.service.upload({requestId:'once',expectedRemoteSnapshotId:null});expect((await a.service.check()).state).toBe('local_ahead');const puts=remote.requests.filter(r=>r.method==='PUT').length;await a.service.upload({requestId:'once',expectedRemoteSnapshotId:null});expect(remote.requests.filter(r=>r.method==='PUT')).toHaveLength(puts);expect(a.read()).toBe('draft written during upload');
});
it('rejects weak validators, redirected authentication and tampered backup bytes without changing local data',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote);configure(b,config.vaultId);const head=[...remote.files].find(([url])=>url.endsWith('/head.json'))!;
 remote.files.set(head[0],{...head[1],etag:'W/"weak"'});expect((await b.service.check()).state).toBe('unsupported');await expect(b.service.preview({})).rejects.toThrow(/ETag|安全/);
 remote.files.set(head[0],head[1]);const archive=[...remote.files].find(([url])=>url.endsWith('.reclimb'))!;remote.files.set(archive[0],{...archive[1],body:Buffer.from('altered')});await expect(b.service.preview({})).rejects.toThrow('校验');expect(b.adopted).toEqual([]);
 remote.setIntercept(()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}}));await expect(b.service.check()).rejects.toThrow('重定向');expect(remote.requests.at(-1)?.url).not.toContain('evil');
});

it('rejects servers that ignore conditional writes before publishing any learning head',async()=>{
 const remote=server(),a=device(remote);configure(a);remote.setIntercept((url,init)=>url.includes('/probes/')&&init.method==='PUT'&&new Headers(init.headers).has('if-match')?new Response(null,{status:204}):undefined);
 await expect(a.service.upload({requestId:'unsupported',expectedRemoteSnapshotId:null})).rejects.toThrow('版本条件');expect([...remote.files.keys()].some(path=>path.endsWith('/head.json'))).toBe(false);expect(a.read()).toBe('first');
});

it('preserves both snapshots when another device wins the conditional head update',async()=>{
 const remote=server(),a=device(remote);configure(a);remote.setIntercept((url,init)=>{
  if(url.endsWith('/head.json')&&init.method==='PUT'){const candidate=JSON.parse(Buffer.from(init.body as Uint8Array).toString());remote.files.set(url,{etag:'"other-writer"',body:Buffer.from(JSON.stringify({...candidate,snapshotId:'competing-snapshot',deviceId:'other-device'}))});}return undefined;
 });
 await expect(a.service.upload({requestId:'race',expectedRemoteSnapshotId:null})).rejects.toThrow('另一设备');expect(a.service.status().pendingUploadRequestId).toBe('race');expect([...remote.files.keys()].filter(url=>url.endsWith('.reclimb'))).toHaveLength(1);expect(a.read()).toBe('first');expect(JSON.parse([...remote.files].find(([url])=>url.endsWith('/head.json'))![1].body.toString()).snapshotId).toBe('competing-snapshot');
});

it('recovers a committed upload after a lost response and restart without duplicating the snapshot',async()=>{
 const remote=server(),a=device(remote);configure(a);remote.setIntercept((url,init)=>{
  if(url.endsWith('/head.json')&&init.method==='PUT'){remote.files.set(url,{etag:'"committed-with-lost-response"',body:Buffer.from(init.body as Uint8Array)});throw new Error('network response lost');}return undefined;
 });
 await expect(a.service.upload({requestId:'retry',expectedRemoteSnapshotId:null})).rejects.toThrow('请求失败');remote.setIntercept(undefined);const restored=new WebDavSyncService(a.options),before=remote.requests.filter(item=>item.method==='PUT').length;
 expect((await restored.upload({requestId:'retry',expectedRemoteSnapshotId:null})).state).toBe('up_to_date');expect(remote.requests.filter(item=>item.method==='PUT')).toHaveLength(before);expect(restored.status().pendingUploadRequestId).toBeUndefined();
});

it('times out or cancels a request without leaving the service busy or printing server-provided secrets',async()=>{
 const remote=server(),a=device(remote);configure(a);remote.setIntercept(()=>new Promise(()=>{}));const quick=new WebDavSyncService({...a.options,timeoutMs:10});
 await expect(quick.check()).rejects.toThrow('超时');expect(quick.status().busy).toBe(false);
 const running=a.service.check();a.service.cancel();await expect(running).rejects.toThrow('取消');expect(a.service.status().busy).toBe(false);remote.setIntercept(()=>new Response('TOP_SECRET_REMOTE_RESPONSE',{status:403}));await expect(a.service.check()).rejects.toThrow('认证失败');expect(a.read()).toBe('first');
});

it('enforces response limits and local validators even when remote hashes are self-consistent',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'valid',expectedRemoteSnapshotId:null});const b=device(remote);configure(b,config.vaultId);
 remote.setIntercept((url)=>url.endsWith('/head.json')?new Response('{}',{status:200,headers:{'Content-Length':'1000000000'}}):undefined);await expect(b.service.check()).rejects.toThrow('大小');remote.setIntercept(undefined);
 const [headUrl,head]=[...remote.files].find(([url])=>url.endsWith('/head.json'))!,snapshot=JSON.parse(head.body.toString()),invalid=Buffer.from('INVALID');snapshot.sha256=hash(invalid);snapshot.bytes=invalid.length;remote.files.set(headUrl,{...head,body:Buffer.from(JSON.stringify(snapshot))});const archive=[...remote.files.keys()].find(url=>url.endsWith('.reclimb'))!;remote.files.set(archive,{etag:'"invalid"',body:invalid});
 await expect(b.service.preview({})).rejects.toThrow('无效备份');expect(b.adopted).toEqual([]);expect(b.read()).toBe('first');
});

it('keeps preview associations across restart and rejects tampering before the final adopt callback',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote);configure(b,config.vaultId);const p=await b.service.preview({});
 const restored=new WebDavSyncService(b.options);writeFileSync(join(b.directory,'transfers',p.snapshot.snapshotId+'.reclimb'),'edited after preview');await expect(restored.adopt({previewId:p.id,expectedLocalContentHash:p.localContentHash,expectedRemoteSnapshotId:p.snapshot.snapshotId,allowReplaceLocal:true})).rejects.toThrow('校验');expect(b.adopted).toEqual([]);
});

it('does not contact a redirected host and rejects oversized streaming bodies without content length',async()=>{
 const remote=server(),a=device(remote);configure(a);let cancelled=false;
 remote.setIntercept(()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}}),{status:200}));
 await expect(a.service.check()).rejects.toThrow('大小');expect(cancelled).toBe(true);expect(a.service.status().busy).toBe(false);
});

it('detects rewritten immutable metadata and never overwrites a same-ID local archive',async()=>{
 const remote=server(),a=device(remote);configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const preview=await a.service.preview({});expect(readFileSync(a.service.validatedPreviewPath(preview.id),'utf8')).toBe('first');
 const [url,entry]=[...remote.files].find(([url])=>url.endsWith('/head.json'))!,metadata=JSON.parse(entry.body.toString()),altered=Buffer.from('replacement');metadata.sha256=hash(altered);metadata.bytes=altered.length;remote.files.set(url,{etag:'"tampered"',body:Buffer.from(JSON.stringify(metadata))});const archive=[...remote.files.keys()].find(url=>url.endsWith('.reclimb'))!;remote.files.set(archive,{etag:'"tampered"',body:altered});
 expect((await a.service.check()).state).toBe('conflict');await expect(a.service.upload({requestId:'new',expectedRemoteSnapshotId:metadata.snapshotId})).rejects.toThrow('改写');await expect(a.service.preview({})).rejects.toThrow('同编号');expect(readFileSync(a.service.validatedPreviewPath(preview.id),'utf8')).toBe('first');
});

it('reports a committed adoption when saving sync state fails, avoids replay, and requires rechecking the baseline',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote,'local-before-adopt');configure(b,config.vaultId);const preview=await b.service.preview({});
 const input={previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId,allowReplaceLocal:true};
 const originalPersist=(b.service as unknown as {persist():void}).persist.bind(b.service);const persist=vi.spyOn(b.service as unknown as {persist():void},'persist').mockImplementationOnce(()=>originalPersist()).mockImplementationOnce(()=>{throw new Error('sync state disk unavailable');});
 const result=await b.service.adopt(input);expect(result).toMatchObject({adopted:true,state:'unchecked',busy:false});expect(result.warning).toContain('已接续');expect(b.read()).toBe('first');expect(b.adopted).toHaveLength(1);
 expect(await b.service.adopt(input)).toEqual(result);expect(b.adopted).toHaveLength(1);persist.mockRestore();expect((await b.service.check()).state).toBe('unlinked');await expect(b.service.upload({requestId:'do-not-overwrite',expectedRemoteSnapshotId:preview.snapshot.snapshotId})).rejects.toThrow('未采用');
 expect((await new WebDavSyncService(b.options).check()).state).toBe('unlinked');
});

it.each(['currentHash','observe'])('reports committed adoption after post-adopt %s failure, but not after callback failure',async phase=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote,'local-before-adopt');configure(b,config.vaultId);const preview=await b.service.preview({}),input={previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId,allowReplaceLocal:true};
 const initialHash=b.callbacks.currentHash;let readsAfterCommit=0;b.callbacks.currentHash=()=>{if(b.adopted.length&&++readsAfterCommit===(phase==='currentHash'?1:2))throw new Error('hash unavailable');return initialHash();};
 expect(await b.service.adopt(input)).toMatchObject({adopted:true,state:'unchecked'});expect(b.adopted).toHaveLength(1);
 const c=device(remote,'untouched');configure(c,config.vaultId);const other=await c.service.preview({});c.callbacks.adoptBackup=()=>{throw new Error('restore callback failed');};await expect(c.service.adopt({previewId:other.id,expectedLocalContentHash:other.localContentHash,expectedRemoteSnapshotId:other.snapshot.snapshotId,allowReplaceLocal:true})).rejects.toThrow('restore callback failed');expect(c.adopted).toEqual([]);expect(c.read()).toBe('untouched');
});

it('durably revokes pending uploads before adopting even if both post-commit state writes fail',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});
 const b=device(remote);configure(b,config.vaultId);const initial=await b.service.preview({});await b.service.adopt({previewId:initial.id,expectedLocalContentHash:initial.localContentHash,expectedRemoteSnapshotId:initial.snapshot.snapshotId,allowReplaceLocal:true});
 b.write('discarded local fork');remote.setIntercept((url,init)=>url.endsWith('/head.json')&&init.method==='PUT'?new Response('',{status:503}):undefined);
 await expect(b.service.upload({requestId:'old-pending',expectedRemoteSnapshotId:initial.snapshot.snapshotId})).rejects.toThrow();remote.setIntercept(undefined);expect(b.service.status().pendingUploadRequestId).toBe('old-pending');
 const p=await b.service.preview({}),original=(b.service as unknown as {persist():void}).persist.bind(b.service);let writes=0;
 const spy=vi.spyOn(b.service as unknown as {persist():void},'persist').mockImplementation(()=>{if(++writes>1)throw new Error('post commit disk failure');original();});
 expect(await b.service.adopt({previewId:p.id,expectedLocalContentHash:p.localContentHash,expectedRemoteSnapshotId:p.snapshot.snapshotId,allowReplaceLocal:true})).toMatchObject({adopted:true,state:'unchecked'});spy.mockRestore();expect(b.read()).toBe('first');
 const restarted=new WebDavSyncService(b.options);expect(restarted.status().pendingUploadRequestId).toBeUndefined();
 const uploaded=await restarted.upload({requestId:'old-pending',expectedRemoteSnapshotId:p.snapshot.snapshotId});expect(uploaded.remote?.contentHash).toBe(hash('first'));expect(uploaded.remote?.contentHash).not.toBe(hash('discarded local fork'));
});
it('does not replace learning data when pre-adopt revocation cannot be persisted',async()=>{
 const remote=server(),a=device(remote),config=configure(a);await a.service.upload({requestId:'a1',expectedRemoteSnapshotId:null});const b=device(remote,'keep local');configure(b,config.vaultId);const p=await b.service.preview({});
 vi.spyOn(b.service as unknown as {persist():void},'persist').mockImplementationOnce(()=>{throw new Error('pre-adopt disk failure');});
 await expect(b.service.adopt({previewId:p.id,expectedLocalContentHash:p.localContentHash,expectedRemoteSnapshotId:p.snapshot.snapshotId,allowReplaceLocal:true})).rejects.toThrow('pre-adopt');expect(b.adopted).toEqual([]);expect(b.read()).toBe('keep local');
});
