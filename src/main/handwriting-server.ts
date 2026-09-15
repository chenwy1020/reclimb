import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {readFile,realpath,stat} from 'node:fs/promises';
import {extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {handwritingSubmitSchema,type HandwritingReceipt,type HandwritingServerStatus,type HandwritingTarget} from '../shared/handwriting';

const PAIRING_LIFETIME=10*60*1000,MAX_BODY=8*1024*1024,BODY_TIMEOUT=10000;
const secret=()=>randomBytes(32).toString('base64url');
const privateIPv4=(address:string)=>{
 const octets=address.split('.').map(Number);
 if(octets.length!==4||octets.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 return octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168);
};
const localPeer=(address='')=>{const value=address.replace(/^::ffff:/,'');return value==='127.0.0.1'||value==='::1'||privateIPv4(value);};
export function getHandwritingAddresses():string[]{
 return [...new Set(Object.values(networkInterfaces()).flatMap(entries=>(entries??[]).filter(entry=>entry.family==='IPv4'&&!entry.internal&&privateIPv4(entry.address)).map(entry=>entry.address)))].sort();
}
class HttpFailure extends Error{constructor(readonly status:number,message:string){super(message);}}
function equalSecret(value:unknown,expected:string):boolean{
 if(typeof value!=='string'||value.length!==expected.length)return false;
 const left=Buffer.from(value),right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right);
}
interface Pairing {id:string;name:string;code:string;pollToken:string;expiresAt:number;status:'pending'|'approved'|'rejected';token?:string;}
interface Device {id:string;name:string;token:string;}
interface Options {staticDirectory:string;workspaceId:string;getTarget:(id:string)=>HandwritingTarget|undefined;save:(body:unknown)=>HandwritingReceipt;}
const pairSchema=z.object({ticket:z.string().min(1).max(100),name:z.string().trim().min(1).max(80).transform(value=>value.replace(/[\u0000-\u001f\u007f]/g,'').trim())}).strict();
const pollSchema=z.object({requestId:z.string().min(1).max(120),pollToken:z.string().min(1).max(100)}).strict();
const contentTypes:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.webp':'image/webp'};

/** An opt-in, narrowly scoped companion endpoint. It never exposes Electron IPC or model calls. */
export class HandwritingServer{
 private server?:Server;
 private starting?:Promise<HandwritingServerStatus>;
 private origin='';
 private host='';
 private ticket?:string;
 private ticketExpiresAt=0;
 private pairings=new Map<string,Pairing>();
 private device?:Device;
 private target?:HandwritingTarget;
 private rates=new Map<string,{since:number;count:number}>();
 private generation=0;
 private error?:string;
 constructor(private readonly options:Options){}

 async start(port=47149,host?:string):Promise<HandwritingServerStatus>{
  if(this.starting)return this.starting;
  if(this.server?.listening)return this.status();
  const selected=host??getHandwritingAddresses()[0]??'127.0.0.1';
  if(!Number.isInteger(port)||port<0||port>65535||(!privateIPv4(selected)&&selected!=='127.0.0.1'))throw new Error('请选择有效的本机局域网 IPv4 地址和端口。');
  if(selected!=='127.0.0.1'&&!getHandwritingAddresses().includes(selected))throw new Error('所选局域网地址已不可用，请重新选择连接地址。');
  const epoch=++this.generation;
  this.starting=(async()=>{
   const server=createServer({maxHeaderSize:8192},(request,response)=>{void this.handle(request,response).catch(error=>{
    if(response.destroyed||response.writableEnded)return;
    this.json(response,error instanceof HttpFailure?error.status:500,{error:error instanceof HttpFailure?error.message:'操作尚未完成，原稿仍保留在 iPad，请重试。'});
   });});
   this.server=server;this.host=selected;this.error=undefined;
   server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=2000;server.maxRequestsPerSocket=100;
   server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');else socket.destroy();});
   try{await new Promise<void>((resolveListen,reject)=>{const failed=(error:Error)=>reject(error);server.once('error',failed);server.listen(port,selected,()=>{server.off('error',failed);resolveListen();});});}
   catch(error){if(this.server===server)this.server=undefined;this.origin='';this.error=(error as NodeJS.ErrnoException).code==='EADDRINUSE'?'手写连接端口已被占用，请关闭占用此端口的程序后重试；未自动更换地址。':'手写连接未能启动，请检查本机网络地址。';throw new Error(this.error);}
   if(epoch!==this.generation){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));throw new Error('手写连接已关闭。');}
   const address=server.address();if(!address||typeof address==='string')throw new Error('无法取得手写连接地址。');
   this.origin=`http://${selected}:${address.port}`;this.renewPairing();return this.status();
  })();
  try{return await this.starting;}finally{this.starting=undefined;}
 }

 status():HandwritingServerStatus{
  this.prune();const running=!!this.server?.listening&&!!this.origin;
  const pending=[...this.pairings.values()].find(p=>p.status==='pending');
  const current=this.target?this.options.getTarget(this.target.id):undefined;
  return {running,urls:running?[this.origin+(this.ticket?'#ticket='+encodeURIComponent(this.ticket):'')]:[],
   ...(running&&this.ticket?{pairingExpiresAt:new Date(this.ticketExpiresAt).toISOString()}:{}),
   ...(pending?{pending:{id:pending.id,name:pending.name,code:pending.code}}:{}),
   ...(this.device?{connected:{id:this.device.id,name:this.device.name}}:{}),...(current?{target:structuredClone(current)}:{}),
   ...(this.error?{error:this.error}:running&&this.host==='127.0.0.1'?{error:'当前连接仅本机可用。请连接可信局域网，并选择电脑的局域网地址供 iPad 使用。'}:{})};
 }
 setTarget(target:HandwritingTarget):void{this.target=structuredClone(target);}
 renewPairing():HandwritingServerStatus{
  if(!this.server?.listening)throw new Error('请先开启手写连接。');
  this.ticket=secret();this.ticketExpiresAt=Date.now()+PAIRING_LIFETIME;this.pairings.clear();return this.status();
 }
 approve(id:string):void{
  this.prune();const pairing=this.pairings.get(id);
  if(!this.server?.listening||!pairing||pairing.status!=='pending')throw new Error('配对请求已失效，请在 iPad 重新配对。');
  for(const old of this.pairings.values())if(old.status==='approved'){old.status='rejected';old.token=undefined;}
  pairing.status='approved';pairing.token=secret();this.device={id:pairing.id,name:pairing.name,token:pairing.token};
 }
 reject(id:string):void{const pairing=this.pairings.get(id);if(pairing?.status==='pending')pairing.status='rejected';}
 async stop():Promise<void>{
  ++this.generation;this.ticket=undefined;this.ticketExpiresAt=0;this.pairings.clear();this.device=undefined;this.rates.clear();this.target=undefined;this.origin='';
  const starting=this.starting;if(starting)await starting.catch(()=>undefined);
  const server=this.server;this.server=undefined;if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
 }
 private prune():void{
  const now=Date.now();if(this.ticketExpiresAt<=now)this.ticket=undefined;
  for(const [id,pairing] of this.pairings)if(pairing.expiresAt<=now)this.pairings.delete(id);
  for(const [key,rate] of this.rates)if(now-rate.since>60000)this.rates.delete(key);
 }
 private throttle(request:IncomingMessage,bucket:string,max:number):void{
  this.prune();const key=(request.socket.remoteAddress??'unknown')+':'+bucket,previous=this.rates.get(key);
  if(this.rates.size>=256&&!previous)throw new HttpFailure(429,'连接请求过多，请稍后重试。');
  const rate=previous??{since:Date.now(),count:0};rate.count++;this.rates.set(key,rate);if(rate.count>max)throw new HttpFailure(429,'请求过于频繁，请稍后重试。');
 }
 private headers(response:ServerResponse):void{
  response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
  response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 }
 private json(response:ServerResponse,status:number,body:unknown):void{this.headers(response);response.statusCode=status;response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify(body));}
 private authenticated(request:IncomingMessage):Device{
  const authorization=request.headers.authorization,token=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):undefined;
  if(!this.device||!equalSecret(token,this.device.token))throw new HttpFailure(401,'连接授权已失效，请在电脑确认重新配对；原稿仍保留在 iPad。');return this.device;
 }
 private async body(request:IncomingMessage):Promise<unknown>{
  if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpFailure(415,'请求必须使用 JSON 格式。');
  const stated=Number(request.headers['content-length']??0);if(!Number.isFinite(stated)||stated<0||stated>MAX_BODY)throw new HttpFailure(413,'本次原稿过大，请减少选中页面后分次提交。');
  return new Promise((resolveBody,reject)=>{
   let chunks:Buffer[]=[],size=0,finished=false;
   const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);request.off('data',onData);request.off('end',onEnd);request.off('error',onError);request.off('aborted',onAbort);if(error){chunks=[];request.resume();reject(error);}};
   const onError=()=>finish(new HttpFailure(400,'连接中断，原稿仍保留在 iPad，请重试。'));
   const onAbort=()=>onError();
   const onData=(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_BODY){finish(new HttpFailure(413,'本次原稿过大，请减少选中页面后分次提交。'));return;}chunks.push(chunk);};
   const onEnd=()=>{if(finished)return;try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));finish();resolveBody(parsed);}catch{finish(new HttpFailure(400,'无法读取提交内容，原稿仍保留在 iPad。'));}};
   const timer=setTimeout(()=>finish(new HttpFailure(408,'传输超时，原稿仍保留在 iPad，请重试。')),BODY_TIMEOUT);timer.unref();
   request.on('data',onData);request.once('end',onEnd);request.once('error',onError);request.once('aborted',onAbort);
  });
 }
 private parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new HttpFailure(400,'提交格式不完整或笔迹超出单次限制，请检查选中页面。');return result.data;}
 private async handle(request:IncomingMessage,response:ServerResponse):Promise<void>{
  this.headers(response);
  if(!this.origin||!localPeer(request.socket.remoteAddress)||request.headers.host!==new URL(this.origin).host)throw new HttpFailure(403,'只接受当前电脑连接地址上的局域网请求。');
  if(request.headers.origin!==undefined&&request.headers.origin!==this.origin)throw new HttpFailure(403,'不允许其他网页访问手写连接。');
  const raw=request.url??'';if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\'))throw new HttpFailure(400,'连接路径无效。');
  const url=new URL(raw,this.origin);if(url.origin!==this.origin)throw new HttpFailure(403,'连接地址不匹配。');
  if(request.method!=='GET'&&request.method!=='HEAD'&&request.headers.origin!==this.origin)throw new HttpFailure(403,'提交必须来自当前配对页面。');
  this.throttle(request,'all',300);
  if(url.pathname==='/api/pair'&&request.method==='POST'){
   this.throttle(request,'pair',12);const data=this.parse(pairSchema,await this.body(request));this.prune();
   if(!this.ticket||!equalSecret(data.ticket,this.ticket))throw new HttpFailure(403,'配对二维码已使用或过期，请在电脑刷新配对。');
   if(!data.name||this.pairings.size>=4)throw new HttpFailure(429,'请先处理电脑上的配对请求。');
   const pairing:Pairing={id:randomUUID(),name:data.name,code:randomInt(1000000).toString().padStart(6,'0'),pollToken:secret(),expiresAt:Date.now()+PAIRING_LIFETIME,status:'pending'};
   this.ticket=undefined;this.pairings.set(pairing.id,pairing);this.json(response,200,{requestId:pairing.id,pollToken:pairing.pollToken,code:pairing.code});return;
  }
  if(url.pathname==='/api/pair/status'&&request.method==='POST'){
   const data=this.parse(pollSchema,await this.body(request));this.prune();const pairing=this.pairings.get(data.requestId);
   if(!pairing||!equalSecret(data.pollToken,pairing.pollToken))throw new HttpFailure(403,'配对请求已失效，请在电脑刷新配对。');
   this.json(response,200,pairing.status==='approved'&&pairing.token&&this.device?.id===pairing.id?{status:'approved',token:pairing.token,workspaceId:this.options.workspaceId}:{status:pairing.status==='approved'?'rejected':pairing.status});return;
  }
  if(url.pathname==='/api/state'&&request.method==='GET'){
   this.authenticated(request);this.json(response,200,{workspaceId:this.options.workspaceId,target:this.target?(this.options.getTarget(this.target.id)??null):null});return;
  }
  if(url.pathname==='/api/submit'&&request.method==='POST'){
   const device=this.authenticated(request),epoch=this.generation;const data=this.parse(handwritingSubmitSchema,await this.body(request));
   if(epoch!==this.generation||this.authenticated(request).id!==device.id)throw new HttpFailure(401,'配对已经变更，请重新连接后提交。');
   if(!this.options.getTarget(data.targetId))throw new HttpFailure(409,'原任务已不可用，原稿仍保留在 iPad，请在电脑确认项目和任务。');
   try{const receipt=this.options.save(data);this.json(response,200,receipt);}catch{throw new HttpFailure(409,'电脑尚未完成保存，原稿仍保留在 iPad；请检查原任务后重试。');}return;
  }
  if(url.pathname.startsWith('/api/'))throw new HttpFailure(404,'没有这个手写操作。');
  if(request.method!=='GET'&&request.method!=='HEAD')throw new HttpFailure(405,'不支持此请求方法。');
  let path:string;try{path=decodeURIComponent(url.pathname);}catch{throw new HttpFailure(400,'连接路径无效。');}
  if(path.includes('\\')||path.includes('\0')||path.split('/').includes('..'))throw new HttpFailure(404,'文件不存在。');
  const asset=path==='/'?'index.html':path.slice(1),mime=contentTypes[extname(asset)];
  if(!mime||(!['index.html','app.js','app.css','style.css'].includes(asset)&&!asset.startsWith('assets/')))throw new HttpFailure(404,'文件不存在。');
  try{
   const root=await realpath(this.options.staticDirectory),file=await realpath(resolve(root,asset)),inside=relative(root,file);
   if(!inside||isAbsolute(inside)||inside==='..'||inside.startsWith('..'+sep))throw new HttpFailure(404,'文件不存在。');
   const metadata=await stat(file);if(!metadata.isFile()||metadata.size>8*1024*1024)throw new HttpFailure(404,'文件不存在。');
   response.statusCode=200;response.setHeader('Content-Type',mime);response.end(request.method==='HEAD'?undefined:await readFile(file));
  }catch(error){if(error instanceof HttpFailure)throw error;throw new HttpFailure(404,'文件不存在。');}
 }
}
