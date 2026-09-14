import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import type {CredentialCipher} from './credentials';
import type {SyncBackupSummary,SyncRemoteSnapshot,WebDavAdoptInput,WebDavAdoptResult,WebDavConfigureInput,WebDavSyncPreview,WebDavSyncState,WebDavSyncStatus,WebDavUploadInput} from '../shared/webdav-sync';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
const stamp=z.string().datetime(),MAX_BACKUP=250*1024*1024,MAX_META=64*1024;
const remoteSchema=z.object({format:z.literal('reclimb.webdav.snapshot'),version:z.literal(1),vaultId:id,snapshotId:id,deviceId:id,deviceName:z.string().max(120),parentSnapshotId:id.nullable(),createdAt:stamp,contentHash:sha,sha256:sha,bytes:z.number().int().positive().max(MAX_BACKUP)}).strict();
const configSchema=z.object({endpoint:z.string().max(3000),username:z.string().max(300),encryptedPassword:z.string().max(20000),vaultId:id,allowInsecureHTTP:z.boolean()}).strict();
const previewSchema=z.object({id, snapshot:remoteSchema,localContentHash:sha,summary:z.record(z.string(),z.unknown()),requiresReplaceConfirmation:z.boolean(),createdAt:stamp,etag:z.string().max(1024)}).strict();
const stateSchema=z.object({version:z.literal(1),deviceId:id,deviceName:z.string().max(120),config:configSchema.optional(),baselineSnapshotId:id.optional(),baselineContentHash:sha.optional(),baselineRemote:remoteSchema.optional(),pendingUpload:z.object({requestId:id,snapshot:remoteSchema,expectedHead:id.nullable()}).strict().optional(),lastUpload:z.object({requestId:id,snapshot:remoteSchema}).strict().optional(),previews:z.array(previewSchema).max(30).default([])}).strict();
type State=z.infer<typeof stateSchema>;
type MaybePromise<T>=T|Promise<T>;
export interface WebDavSyncCallbacks {
 currentHash():MaybePromise<string>;
 captureBackup(destination:string):MaybePromise<{contentHash:string}>;
 inspectBackup(file:string):MaybePromise<SyncBackupSummary>;
 /** Must recheck expectedLocalContentHash under the actual workspace transition lock. */
 adoptBackup(file:string,options:{expectedLocalContentHash:string;allowReplaceLocal:boolean;expectedRemoteSnapshotId:string}):MaybePromise<void>;
}
export interface WebDavSyncOptions {directory:string;cipher:CredentialCipher;callbacks:WebDavSyncCallbacks;fetcher?:typeof fetch;timeoutMs?:number;maxBackupBytes?:number;}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function endpoint(value:string,allowHTTP:boolean):string{
 let url:URL;try{url=new URL(value.trim());}catch{throw new Error('WebDAV 地址不是有效网址。');}
 if(url.username||url.password||url.search||url.hash||url.pathname.includes('\\'))throw new Error('WebDAV 地址不能包含账号、密码、查询参数或片段。');
 if(url.protocol!=='https:'&&!(allowHTTP&&url.protocol==='http:'))throw new Error('WebDAV 默认要求 HTTPS；仅在了解风险后允许明文 HTTP。');
 if(!url.hostname)throw new Error('WebDAV 地址缺少服务器。');url.pathname=url.pathname.replace(/\/+$/,'')+'/';return url.toString();
}
const strongETag=(value:string|null):value is string=>!!value&&value.length<=1024&&/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('aborted'));if(signal.aborted){reject(new Error('aborted'));return;}signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}

/** Explicit snapshot transfer; this service never merges learning records or silently adopts a remote head. */
export class WebDavSyncService {
 private readonly directory:string;private readonly stateFile:string;private state:State;
 private busy=false;private controller:AbortController|undefined;private checked:Partial<WebDavSyncStatus>={};private conditionalVerified=false;
 private readonly adoptedPreviews=new Map<string,{inputKey:string;result:WebDavAdoptResult}>();
 constructor(private readonly options:WebDavSyncOptions){
  this.directory=resolve(options.directory);this.stateFile=join(this.directory,'webdav-state.json');mkdirSync(this.directory,{recursive:true,mode:0o700});mkdirSync(join(this.directory,'transfers'),{recursive:true,mode:0o700});
  if(existsSync(this.stateFile)){try{if(statSync(this.stateFile).size>512*1024)throw new Error();this.state=stateSchema.parse(JSON.parse(readFileSync(this.stateFile,'utf8')));if(this.state.config)this.state.config.endpoint=endpoint(this.state.config.endpoint,this.state.config.allowInsecureHTTP);}catch{throw new Error('本机同步设置损坏，原文件已保留，请先核对同步目录。');}}
  else{this.state={version:1,deviceId:randomUUID(),deviceName:'我的电脑',previews:[]};this.persist();}
 }
 get isBusy(){return this.busy;}
 status():WebDavSyncStatus{const c=this.state.config;return{configured:!!c,busy:this.busy,deviceId:this.state.deviceId,deviceName:this.state.deviceName,vaultId:c?.vaultId,endpoint:c?.endpoint,username:c?.username,hasPassword:!!c?.encryptedPassword,allowInsecureHTTP:c?.allowInsecureHTTP??false,state:c?'unchecked':'not_configured',message:c?'连接已保存；点击检查远端更新。':'尚未配置 WebDAV。',baselineContentHash:this.state.baselineContentHash,baselineSnapshotId:this.state.baselineSnapshotId,pendingUploadRequestId:this.state.pendingUpload?.requestId,lastUploadedAt:this.state.lastUpload?.snapshot.createdAt,...this.checked};}
 configure(body:WebDavConfigureInput):WebDavSyncStatus{
  if(this.busy)throw new Error('同步操作正在进行，请结束后再修改连接。');
  const input=z.object({endpoint:z.string().max(3000),username:z.string().max(300),password:z.string().max(4096).optional(),vaultId:id.optional(),deviceName:z.string().trim().min(1).max(120).optional(),allowInsecureHTTP:z.boolean().optional()}).strict().parse(body);
  if(/[\r\n:]/.test(input.username))throw new Error('WebDAV 用户名包含不支持的字符。');
  const url=endpoint(input.endpoint,input.allowInsecureHTTP??false),old=this.state.config,same=old?.endpoint===url&&old.username===input.username;
  let encrypted= same?old!.encryptedPassword:'';
  if(input.password!==undefined){try{if(!this.options.cipher.isEncryptionAvailable())throw new Error();encrypted=this.options.cipher.encryptString(JSON.stringify({purpose:'reclimb-webdav-password',endpoint:url,username:input.username,password:input.password})).toString('base64');}catch{throw new Error('系统密钥保护不可用，WebDAV 密码未保存。');}}
  if(!encrypted)throw new Error('请为这个 WebDAV 地址填写密码或应用密码。');
  const vaultId=input.vaultId??(same?old?.vaultId:undefined)??randomUUID(),keep=same&&old?.vaultId===vaultId;
  const before=this.state;this.state={...this.state,deviceName:input.deviceName??this.state.deviceName,config:{endpoint:url,username:input.username,encryptedPassword:encrypted,vaultId,allowInsecureHTTP:input.allowInsecureHTTP??false},...(!keep?{baselineSnapshotId:undefined,baselineContentHash:undefined,baselineRemote:undefined,pendingUpload:undefined,lastUpload:undefined,previews:[]}:{})};
  try{this.persist();}catch(error){this.state=before;throw error;}this.checked={};this.conditionalVerified=false;if(!keep)this.adoptedPreviews.clear();return this.status();
 }
 cancel():void{this.controller?.abort();}
 private persist(){const temporary=this.stateFile+'.'+randomUUID()+'.tmp';let fd:number|undefined;try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(this.state),'utf8');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,this.stateFile);}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}}
 private file(snapshotId:string){id.parse(snapshotId);return join(this.directory,'transfers',snapshotId+'.reclimb');}
 private connection(){const c=this.state.config;if(!c)throw new Error('请先配置 WebDAV 连接。');return c;}
 private url(path:string){const c=this.connection();return new URL('reclimb-sync/v1/'+c.vaultId+'/'+path,c.endpoint).toString();}
 private authorization(){const c=this.connection();try{if(!this.options.cipher.isEncryptionAvailable())throw new Error();const secret=JSON.parse(this.options.cipher.decryptString(Buffer.from(c.encryptedPassword,'base64')));if(secret.purpose!=='reclimb-webdav-password'||secret.endpoint!==c.endpoint||secret.username!==c.username||typeof secret.password!=='string')throw new Error();return'Basic '+Buffer.from(c.username+':'+secret.password).toString('base64');}catch{throw new Error('本机 WebDAV 密码无法解密，请重新配置连接。');}}
 private async run<T>(fn:()=>Promise<T>):Promise<T>{if(this.busy)throw new Error('已有同步操作正在进行，不会重复执行。');this.connection();this.busy=true;this.controller=new AbortController();try{const result=await fn();return result&&typeof result==='object'&&'configured' in result?{...result,busy:false}:result;}finally{this.busy=false;this.controller=undefined;}}
 private async request(url:string,method:string,body?:Buffer,headers:Record<string,string>={},limit=MAX_META):Promise<{status:number;headers:Headers;bytes:Buffer}>{
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),this.options.timeoutMs??30000),signal=AbortSignal.any([timeout.signal,...(this.controller?[this.controller.signal]:[])]);
  try{
   const response=await abortable((this.options.fetcher??fetch)(url,{method,redirect:'manual',headers:{Authorization:this.authorization(),...headers},body:body as BodyInit|undefined,signal}),signal);
   if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});throw new Error('WebDAV 返回重定向，已停止以避免密码发送到其他地址；请直接填写最终地址。');}
   const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit)){void response.body?.cancel().catch(()=>{});throw new Error('WebDAV 响应超过允许大小，当前学习档案未改变。');}
   const chunks:Buffer[]=[];let total=0;const reader=response.body?.getReader();
   if(reader)try{while(true){const {value,done}=await abortable(reader.read(),signal);if(done)break;if(signal.aborted)throw new Error('aborted');total+=value.byteLength;if(total>limit)throw new Error('WebDAV 响应超过允许大小，当前学习档案未改变。');chunks.push(Buffer.from(value));}}catch(error){void reader.cancel().catch(()=>{});throw error;}
   if(response.status===401||response.status===403)throw new Error('WebDAV 认证失败或当前目录无访问权限，请核对账号与应用密码。');
   return{status:response.status,headers:response.headers,bytes:Buffer.concat(chunks,total)};
  }catch(error){if(signal.aborted)throw new Error(this.controller?.signal.aborted?'同步已取消；已经保存的本机内容和快照仍保留。':'WebDAV 请求超时；请检查网络后主动重试，未自动覆盖档案。');if(error instanceof Error&&error.message.startsWith('WebDAV '))throw error;throw new Error('WebDAV 请求失败，请检查网络和服务器；本机档案未被覆盖。');}finally{clearTimeout(timer);}
 }
 private async remote(){const result=await this.request(this.url('head.json'),'GET');if(result.status===404)return null;if(result.status!==200)throw new Error('WebDAV 无法读取远端版本（HTTP '+result.status+'）。');let snapshot:SyncRemoteSnapshot;try{snapshot=remoteSchema.parse(JSON.parse(result.bytes.toString('utf8')));if(snapshot.vaultId!==this.connection().vaultId)throw new Error();}catch{throw new Error('WebDAV 远端版本清单无效或不属于这个同步空间。');}return{snapshot,etag:result.headers.get('etag')};}
 private requireStrong(remote:Awaited<ReturnType<WebDavSyncService['remote']>>){if(remote&&!strongETag(remote.etag))throw new Error('WebDAV 服务器未提供强 ETag，不能安全检查或覆盖远端版本；已保留本机档案。');}
 private baselineRewritten(remote:Awaited<ReturnType<WebDavSyncService['remote']>>){return!!remote&&remote.snapshot.snapshotId===this.state.baselineSnapshotId&&!!this.state.baselineRemote&&JSON.stringify(remote.snapshot)!==JSON.stringify(this.state.baselineRemote);}
 private async currentHash(){return sha.parse(await this.options.callbacks.currentHash());}
 private async observe(remote:Awaited<ReturnType<WebDavSyncService['remote']>>){
  const localContentHash=await this.currentHash(),base=this.state.baselineSnapshotId;let state:WebDavSyncState,message:string;
  if(remote&&!strongETag(remote.etag)){state='unsupported';message='服务器未提供强 ETag，安全同步暂停。';}
  else if(!remote){state=base?'conflict':'remote_empty';message=base?'远端主版本已不存在，停止自动重建，避免覆盖或复活已移除的数据。':'远端空间没有快照，可以主动上传当前档案。';}
  else if(this.baselineRewritten(remote)){state='conflict';message='远端改写了已经保存的同编号快照，已暂停同步，请保留本机档案。';}
  else if(!base){state='unlinked';message='尚未采用这个空间的共同版本，请预览远端档案后选择。';}
  else if(remote.snapshot.snapshotId===base){state=localContentHash===this.state.baselineContentHash?'up_to_date':'local_ahead';message=state==='up_to_date'?'本机与上次同步版本一致。':'本机有尚未上传的修改。';}
  else{state=localContentHash===this.state.baselineContentHash?'remote_ahead':'conflict';message=state==='remote_ahead'?'远端有新版本，请预览后采用。':'本机和远端都有修改；不会自动合并或覆盖，请先保留两份档案。';}
  this.checked={state,message,localContentHash,remote:remote?.snapshot,checkedAt:new Date().toISOString()};return this.status();
 }
 async check(){return this.run(async()=>this.observe(await this.remote()));}
 private async directories(){const c=this.connection();for(const path of ['reclimb-sync/','reclimb-sync/v1/','reclimb-sync/v1/'+c.vaultId+'/','reclimb-sync/v1/'+c.vaultId+'/snapshots/','reclimb-sync/v1/'+c.vaultId+'/probes/']){const result=await this.request(new URL(path,c.endpoint).toString(),'MKCOL');if(![201,405].includes(result.status))throw new Error('WebDAV 无法建立同步目录（HTTP '+result.status+'）。');}}
 private async verifyConditionalWrites(){
  if(this.conditionalVerified)return;const url=this.url('probes/'+randomUUID()+'.txt'),first=Buffer.from('reclimb conditional write probe'),second=Buffer.from('reclimb conditional write verified');
  try{
   let result=await this.request(url,'PUT',first,{'If-None-Match':'*'});if(![200,201,204].includes(result.status))throw new Error('WebDAV 不能创建条件写入核对文件。');
   const read=await this.request(url,'GET');if(read.status!==200||!strongETag(read.headers.get('etag'))||!read.bytes.equals(first))throw new Error('WebDAV 条件写入核对未获得可靠强 ETag。');
   result=await this.request(url,'PUT',second,{'If-None-Match':'*'});if(result.status!==412)throw new Error('WebDAV 服务器没有执行防覆盖条件，已暂停安全同步。');
   result=await this.request(url,'PUT',second,{'If-Match':'"reclimb-invalid-'+randomUUID()+'"'});if(result.status!==412)throw new Error('WebDAV 服务器没有执行版本条件，已暂停安全同步。');
   result=await this.request(url,'PUT',second,{'If-Match':read.headers.get('etag')!});if(![200,201,204].includes(result.status))throw new Error('WebDAV 条件更新核对失败。');
   const after=await this.request(url,'GET');if(after.status!==200||!strongETag(after.headers.get('etag'))||after.headers.get('etag')===read.headers.get('etag')||!after.bytes.equals(second))throw new Error('WebDAV 版本更新核对失败。');this.conditionalVerified=true;
  }finally{try{await this.request(url,'DELETE');}catch{/* Only this operation's small probe may remain; never delete snapshots. */}}
 }
 async upload(body:WebDavUploadInput){return this.run(async()=>{
  const input=z.object({requestId:id,expectedRemoteSnapshotId:id.nullable().optional()}).strict().parse(body);
  if(this.state.lastUpload?.requestId===input.requestId)return this.observe(await this.remote());
  let remote=await this.remote();this.requireStrong(remote);if(this.baselineRewritten(remote))throw new Error('WebDAV 远端已改写同编号快照，不能覆盖或沿用这个版本。');const currentHead=remote?.snapshot.snapshotId??null;
  let pending=this.state.pendingUpload;
  if(pending&&pending.requestId!==input.requestId)throw new Error('上次上传尚未确认，请使用原操作编号重试，避免遗漏已保存的快照。');
  if(pending&&remote?.snapshot.snapshotId===pending.snapshot.snapshotId){if(JSON.stringify(remote.snapshot)!==JSON.stringify(pending.snapshot))throw new Error('WebDAV 同编号快照清单已经改变，待上传本机版本仍保留。');await this.verifyRemoteArchive(pending.snapshot);return this.finishUpload(pending.requestId,pending.snapshot,remote);}
  if(input.expectedRemoteSnapshotId!==undefined&&input.expectedRemoteSnapshotId!==currentHead)throw new Error('WebDAV 远端版本已经变化，请重新检查；本机修改仍保留。');
  if(pending&&pending.expectedHead!==currentHead)throw new Error('WebDAV 远端与待上传快照出现冲突，两份内容均保留。');
  if(!pending){
   if(currentHead!== (this.state.baselineSnapshotId??null))throw new Error('WebDAV 远端有未采用的版本，请先检查冲突，不会覆盖另一设备的记录。');
   const snapshotId=randomUUID(),file=this.file(snapshotId),captured=await this.options.callbacks.captureBackup(file);sha.parse(captured.contentHash);
   const inspected=await this.options.callbacks.inspectBackup(file);if(typeof inspected.contentHash==='string'&&inspected.contentHash!==captured.contentHash)throw new Error('WebDAV 本机快照内容与冻结的学习版本不一致。');if(statSync(file).size>this.maxBytes())throw new Error('WebDAV 完整备份超过允许大小，尚未上传。');const bytes=readFileSync(file);if(!bytes.length)throw new Error('WebDAV 完整备份为空，尚未上传。');
   const snapshot:SyncRemoteSnapshot={format:'reclimb.webdav.snapshot',version:1,vaultId:this.connection().vaultId,snapshotId,deviceId:this.state.deviceId,deviceName:this.state.deviceName,parentSnapshotId:currentHead,createdAt:new Date().toISOString(),contentHash:captured.contentHash,sha256:digest(bytes),bytes:bytes.length};
   pending={requestId:input.requestId,snapshot,expectedHead:currentHead};this.state.pendingUpload=pending;this.persist();
  }
  const bytes=this.localArchive(pending.snapshot);await this.options.callbacks.inspectBackup(this.file(pending.snapshot.snapshotId));await this.directories();await this.verifyConditionalWrites();
  // Re-read immediately before publication; CAS still protects the interval after this read.
  remote=await this.remote();this.requireStrong(remote);if(this.baselineRewritten(remote)||(remote?.snapshot.snapshotId??null)!==pending.expectedHead)throw new Error('WebDAV 远端在上传期间发生变化，已停止覆盖；待上传快照仍保留。');
  const archive=await this.request(this.url('snapshots/'+pending.snapshot.snapshotId+'.reclimb'),'PUT',bytes,{'Content-Type':'application/octet-stream','If-None-Match':'*'});if(![200,201,204,412].includes(archive.status))throw new Error('WebDAV 上传快照失败（HTTP '+archive.status+'）。');
  await this.verifyRemoteArchive(pending.snapshot);
  const metadata=Buffer.from(JSON.stringify(pending.snapshot));const manifest=await this.request(this.url('snapshots/'+pending.snapshot.snapshotId+'.json'),'PUT',metadata,{'Content-Type':'application/json','If-None-Match':'*'});
  if(manifest.status===412){const found=await this.request(this.url('snapshots/'+pending.snapshot.snapshotId+'.json'),'GET');if(found.status!==200||!found.bytes.equals(metadata))throw new Error('WebDAV 已有快照清单与本次内容不同，未覆盖。');}else if(![200,201,204].includes(manifest.status))throw new Error('WebDAV 快照清单上传失败。');
  const published=await this.request(this.url('head.json'),'PUT',metadata,remote?{'Content-Type':'application/json','If-Match':remote.etag!}:{'Content-Type':'application/json','If-None-Match':'*'});
  if(published.status===412)throw new Error('WebDAV 同时收到另一设备的新版本，当前快照已保留，主版本未覆盖。');if(![200,201,204].includes(published.status))throw new Error('WebDAV 主版本提交未确认，请使用原操作编号重试。');
  const confirmed=await this.remote();this.requireStrong(confirmed);if(confirmed?.snapshot.snapshotId!==pending.snapshot.snapshotId)throw new Error('WebDAV 主版本提交结果不一致，保留本机快照并暂停。');
  return this.finishUpload(pending.requestId,pending.snapshot,confirmed);
 });}
 private maxBytes(){return Math.min(MAX_BACKUP,this.options.maxBackupBytes??MAX_BACKUP);}
 private localArchive(snapshot:SyncRemoteSnapshot){const file=this.file(snapshot.snapshotId);if(!existsSync(file)||statSync(file).size>this.maxBytes())throw new Error('WebDAV 本机快照缺失或过大，请保留当前档案后检查同步目录。');const bytes=readFileSync(file);if(bytes.length!==snapshot.bytes||digest(bytes)!==snapshot.sha256)throw new Error('WebDAV 本机快照校验失败，未发起覆盖。');return bytes;}
 private async verifyRemoteArchive(snapshot:SyncRemoteSnapshot){if(snapshot.bytes>this.maxBytes())throw new Error('WebDAV 远端快照超过允许大小。');const response=await this.request(this.url('snapshots/'+snapshot.snapshotId+'.reclimb'),'GET',undefined,{},this.maxBytes());if(response.status!==200||response.bytes.length!==snapshot.bytes||digest(response.bytes)!==snapshot.sha256)throw new Error('WebDAV 远端快照内容校验失败，当前档案未改变。');return response.bytes;}
 private async finishUpload(requestId:string,snapshot:SyncRemoteSnapshot,remote:Awaited<ReturnType<WebDavSyncService['remote']>>){this.state.baselineSnapshotId=snapshot.snapshotId;this.state.baselineContentHash=snapshot.contentHash;this.state.baselineRemote=snapshot;this.state.lastUpload={requestId,snapshot};this.state.pendingUpload=undefined;this.persist();return this.observe(remote);}
 async preview(body:{snapshotId?:string}={}){return this.run(async()=>{
  const input=z.object({snapshotId:id.optional()}).strict().parse(body),remote=await this.remote();this.requireStrong(remote);if(!remote)throw new Error('WebDAV 远端没有可预览的快照。');
  let snapshot=remote.snapshot;
  if(input.snapshotId&&input.snapshotId!==snapshot.snapshotId){const meta=await this.request(this.url('snapshots/'+input.snapshotId+'.json'),'GET');if(meta.status!==200)throw new Error('WebDAV 远端快照清单不存在。');try{snapshot=remoteSchema.parse(JSON.parse(meta.bytes.toString('utf8')));if(snapshot.snapshotId!==input.snapshotId||snapshot.vaultId!==this.connection().vaultId)throw new Error();}catch{throw new Error('WebDAV 远端快照清单关联无效。');}}
  const bytes=await this.verifyRemoteArchive(snapshot),file=this.file(snapshot.snapshotId);if(existsSync(file)){if(statSync(file).size!==bytes.length||digest(readFileSync(file))!==snapshot.sha256)throw new Error('WebDAV 下载快照与本机已保存的同编号内容不同，原本机快照未覆盖。');}else writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  const summary=await this.options.callbacks.inspectBackup(file),localContentHash=await this.currentHash();if(typeof summary.contentHash==='string'&&summary.contentHash!==snapshot.contentHash)throw new Error('WebDAV 远端快照的内容版本校验失败，当前档案未改变。');
  const preview:WebDavSyncPreview={id:randomUUID(),snapshot,localContentHash,summary,requiresReplaceConfirmation:!this.state.baselineSnapshotId||localContentHash!==this.state.baselineContentHash,createdAt:new Date().toISOString()};
  this.state.previews=[...this.state.previews.slice(-29),{...preview,etag:remote.etag!}];this.persist();return preview;
 });}
 async adopt(body:WebDavAdoptInput):Promise<WebDavAdoptResult>{return this.run(async()=>{
  const input=z.object({previewId:id,expectedLocalContentHash:sha,expectedRemoteSnapshotId:id,allowReplaceLocal:z.boolean().optional()}).strict().parse(body),inputKey=JSON.stringify(input),prior=this.adoptedPreviews.get(input.previewId);
  if(prior){if(prior.inputKey!==inputKey)throw new Error('这次预览已经采用，不能用同一编号替换不同的确认条件。');return prior.result;}
  const preview=this.state.previews.find(value=>value.id===input.previewId);
  if(!preview)throw new Error('WebDAV 预览记录不存在，请重新预览。');
  if(preview.localContentHash!==input.expectedLocalContentHash||await this.currentHash()!==input.expectedLocalContentHash)throw new Error('本机在预览之后已有修改，请重新预览，当前作答不会被覆盖。');
  if(preview.requiresReplaceConfirmation&&!input.allowReplaceLocal)throw new Error('本机包含尚未同步或未关联的内容，请先保留副本并明确确认采用远端档案。');
  const remote=await this.remote();this.requireStrong(remote);if(!remote||remote.snapshot.snapshotId!==input.expectedRemoteSnapshotId||remote.snapshot.snapshotId!==preview.snapshot.snapshotId||remote.etag!==preview.etag)throw new Error('WebDAV 远端在预览后发生变化或所选为历史快照，请重新检查；本机未改变。');
  this.localArchive(preview.snapshot);await this.options.callbacks.inspectBackup(this.file(preview.snapshot.snapshotId));
  if(this.controller?.signal.aborted)throw new Error('同步已取消，尚未采用远端档案。');
  // Revoke abandoned uploads durably BEFORE replacing learning data. A failed later status write
  // or restart must never revive a snapshot from the workspace the user just left.
  const beforeAdopt=this.state;this.state={...this.state,pendingUpload:undefined,lastUpload:undefined};
  try{this.persist();}catch(error){this.state=beforeAdopt;throw error;}
  await this.options.callbacks.adoptBackup(this.file(preview.snapshot.snapshotId),{expectedLocalContentHash:input.expectedLocalContentHash,allowReplaceLocal:input.allowReplaceLocal??false,expectedRemoteSnapshotId:remote.snapshot.snapshotId});
  // The callback has committed the workspace. From this point an error must not tell the UI to retain old drafts.
  let result:WebDavAdoptResult;
  try{
   this.state.baselineSnapshotId=remote.snapshot.snapshotId;this.state.baselineContentHash=await this.currentHash();this.state.baselineRemote=remote.snapshot;this.state.pendingUpload=undefined;this.persist();
   result={...await this.observe(remote),busy:false,adopted:true};
  }catch{
   this.state={...this.state,baselineSnapshotId:undefined,baselineContentHash:undefined,baselineRemote:undefined,pendingUpload:undefined,lastUpload:undefined};
   // If disk access has recovered, persist the conservative unknown baseline; otherwise old state remains inspectable.
   try{this.persist();}catch{/* The committed learning workspace is independent from this installation-local state file. */}
   const warning='学习档案已接续，但本机同步状态未能完整确认或保存。请重新检查并预览远端版本后建立同步基线；暂不上传覆盖。';
   this.checked={state:'unchecked',message:warning,remote:remote.snapshot};result={...this.status(),busy:false,adopted:true,warning};
  }
  this.adoptedPreviews.set(input.previewId,{inputKey,result});if(this.adoptedPreviews.size>30)this.adoptedPreviews.delete(this.adoptedPreviews.keys().next().value!);return result;
 });}
 /** Main process only: the renderer receives an ID and cannot choose an arbitrary read path. */
 validatedPreviewPath(previewId:string):string{const preview=this.state.previews.find(value=>value.id===id.parse(previewId));if(!preview)throw new Error('WebDAV 预览记录不存在。');this.localArchive(preview.snapshot);return this.file(preview.snapshot.snapshotId);}
}
