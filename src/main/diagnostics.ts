import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface DiagnosticEntry {
  id: string; createdAt: string; operationId: string; kind: string; model: string;
  modelProfileId?: string; profileName?: string; providerName?: string; requestedModel?: string; reportedModel?: string;
  status: 'valid' | 'invalid' | 'transport_error' | 'published';
  reasoningTokens?: number; finishReason?: string; providerRequestId?: string; error?: string; response?: string;
  promptLayout?:string;promptPrefixHash?:string;promptPrefixCharacters?:number;requestCharacters?:number;requestPhase?:'initial'|'repair';threadId?:string;
  cacheHitTokens?:number; cacheMissTokens?:number; durationMs?:number;
}
const MAX_BYTES = 20 * 1024 * 1024, MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function redactDiagnostic(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[密钥已隐藏]');
  return result.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [密钥已隐藏]').replace(/\b(?:sk-|fw_)[A-Za-z0-9_-]{12,}\b/g, '[密钥已隐藏]');
}
/** Only local failure snippets and call metadata; WebDAV events contain allowlisted fields, never headers or file bodies. */
export class DiagnosticLog {
  constructor(readonly directory: string, private now = () => Date.now()) {}
  private files() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter(name=>/^[\w-]+\.json$/.test(name)).map(name=>({ path:join(this.directory,name),stat:statSync(join(this.directory,name)) })).sort((a,b)=>a.stat.mtimeMs-b.stat.mtimeMs);
  }
  private prune(reserve = 0) {
    const files=this.files(); let size=files.reduce((sum,f)=>sum+f.stat.size,0);
    for(const file of files) if(this.now()-file.stat.mtimeMs>MAX_AGE || size+reserve>MAX_BYTES) { unlinkSync(file.path);size-=file.stat.size; }
  }
  record(entry: Omit<DiagnosticEntry,'id'|'createdAt'> & Partial<Pick<DiagnosticEntry,'id'|'createdAt'>>, secrets: string[] = []): string {
    mkdirSync(this.directory,{recursive:true});
    const id=randomUUID();
    const safe:DiagnosticEntry={id,createdAt:new Date(this.now()).toISOString(),operationId:entry.operationId,kind:entry.kind,model:entry.model,status:entry.status,...(entry.modelProfileId?{modelProfileId:entry.modelProfileId}:{}),...(entry.profileName?{profileName:entry.profileName}:{}),...(entry.providerName?{providerName:entry.providerName}:{}),...(entry.requestedModel?{requestedModel:entry.requestedModel}:{}),...(entry.reportedModel?{reportedModel:entry.reportedModel}:{}),...(entry.reasoningTokens!==undefined?{reasoningTokens:entry.reasoningTokens}:{}),...(entry.finishReason?{finishReason:entry.finishReason}:{}),...(entry.providerRequestId?{providerRequestId:entry.providerRequestId}:{}),...(entry.error?{error:entry.error.slice(0,4000)}:{}),...(entry.response?{response:entry.response.slice(0,65536)}:{})};
    for(const field of ['cacheHitTokens','cacheMissTokens','durationMs','promptPrefixCharacters','requestCharacters'] as const){const value=entry[field];if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)safe[field]=value;}
    if(entry.promptPrefixHash&&/^[a-f0-9]{64}$/.test(entry.promptPrefixHash))safe.promptPrefixHash=entry.promptPrefixHash;
    if(entry.promptLayout)safe.promptLayout=entry.promptLayout.slice(0,80);
    if(entry.requestPhase==='initial'||entry.requestPhase==='repair')safe.requestPhase=entry.requestPhase;
    if(entry.threadId)safe.threadId=entry.threadId.slice(0,120);
    const body=redactDiagnostic(JSON.stringify(safe,null,2),secrets);
    this.prune(Buffer.byteLength(body));writeFileSync(join(this.directory,id+'.json'),body,{encoding:'utf8',mode:0o600});
    return id;
  }
  preview():{entries:DiagnosticEntry[];bytes:number;description:string} {
    this.prune(); const entries:DiagnosticEntry[]=[];let bytes=0;
    for(const file of this.files()){try{entries.push(JSON.parse(readFileSync(file.path,'utf8')));bytes+=file.stat.size;}catch{/* A damaged diagnostic must not block access to learning records. */}}
    entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {entries,bytes,description:'包含 WebDAV 同步请求状态和校验失败原因（不含地址、认证头及文件正文），以及最近 7 天的模型配置、请求模型、服务商报告模型、调用标识、结束原因、已报告的缓存用量与耗时、请求结构版本与本机前缀摘要（不是命中证明）、恢复类型、校验结果和失败回复片段。片段可能包含学习内容；不包含密钥、认证头或完整请求。总量最多 20 MB。'};
  }
  clear():void{for(const file of this.files())unlinkSync(file.path);}
}
