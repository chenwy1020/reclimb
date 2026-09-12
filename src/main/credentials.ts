import {randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {DEFAULT_MODEL_PROFILE_ID} from '../shared/types';
import {buildChatUrl} from './provider';

/** Electron safeStorage satisfies this interface; tests can inject another authenticated cipher. */
export interface CredentialCipher {
  isEncryptionAvailable():boolean;
  encryptString(value:string):Buffer;
  decryptString(value:Buffer):string;
}
const LEGACY_PURPOSE='reclimb-endpoint-credential',PROFILE_PURPOSE='reclimb-profile-credentials',PROFILE_ID=/^[a-zA-Z0-9_-]{1,120}$/;
interface ProfileCredential {profileId:string;endpoint:string;key:string}
export interface CredentialClearTransaction {commit():void;rollback():void}

/** All profile identifiers, normalized endpoints and keys are inside one encrypted payload. */
export class CredentialsStore {
  private readonly filePath:string;
  constructor(filePath:string,private readonly cipher:CredentialCipher){this.filePath=resolve(filePath);}

  private unreadable(forWrite:boolean):ProfileCredential[]{
    if(forWrite)throw new Error('本机密钥文件无法读取或已经损坏；为避免丢失其他模型的密钥，原文件已保留，未写入新密钥。');
    return[];
  }

  private load(forWrite=false):ProfileCredential[]{
    if(!existsSync(this.filePath))return[];
    try{
      if(!this.cipher.isEncryptionAvailable()||statSync(this.filePath).size>262144)throw new Error('credential storage unavailable');
      const outer:unknown=JSON.parse(readFileSync(this.filePath,'utf8'));if(!outer||typeof outer!=='object')throw new Error('invalid envelope');
      const envelope=outer as {version?:unknown;encrypted?:unknown};if(![1,2].includes(Number(envelope.version))||typeof envelope.encrypted!=='string'||!envelope.encrypted)throw new Error('invalid envelope');
      const plain:unknown=JSON.parse(this.cipher.decryptString(Buffer.from(envelope.encrypted,'base64')));if(!plain||typeof plain!=='object')throw new Error('invalid payload');
      const value=plain as Record<string,unknown>;
      if(value.purpose===LEGACY_PURPOSE&&value.version===1&&typeof value.endpoint==='string'&&typeof value.key==='string'&&value.key.trim()&&value.key.length<=4096)return[{profileId:DEFAULT_MODEL_PROFILE_ID,endpoint:value.endpoint,key:value.key}];
      if(value.purpose!==PROFILE_PURPOSE||value.version!==2||!Array.isArray(value.entries)||value.entries.length>100)throw new Error('invalid payload');
      const result:ProfileCredential[]=[],ids=new Set<string>();
      for(const item of value.entries){if(!item||typeof item!=='object')throw new Error('invalid entry');const entry=item as Record<string,unknown>;if(typeof entry.profileId!=='string'||!PROFILE_ID.test(entry.profileId)||ids.has(entry.profileId)||typeof entry.endpoint!=='string'||typeof entry.key!=='string'||!entry.key.trim()||entry.key.length>4096)throw new Error('invalid entry');ids.add(entry.profileId);result.push({profileId:entry.profileId,endpoint:entry.endpoint,key:entry.key});}
      return result;
    }catch{return this.unreadable(forWrite);}
  }

  read(baseUrl:string):string;
  read(profileId:string,baseUrl:string):string;
  read(profileOrBase:string,maybeBase?:string):string{
    const profileId=maybeBase===undefined?DEFAULT_MODEL_PROFILE_ID:profileOrBase,baseUrl=maybeBase??profileOrBase;if(!PROFILE_ID.test(profileId))return'';
    let endpoint:string;try{endpoint=buildChatUrl(baseUrl);}catch{return'';}
    return this.load().find(entry=>entry.profileId===profileId&&entry.endpoint===endpoint)?.key??'';
  }

  configured(profiles:{id:string;baseUrl:string}[]):Set<string>{
    const entries=this.load(),available=new Set<string>();
    for(const profile of profiles){if(!PROFILE_ID.test(profile.id))continue;let endpoint:string;try{endpoint=buildChatUrl(profile.baseUrl);}catch{continue;}if(entries.some(entry=>entry.profileId===profile.id&&entry.endpoint===endpoint))available.add(profile.id);}
    return available;
  }

  write(baseUrl:string,key:string):void;
  write(profileId:string,baseUrl:string,key:string):void;
  write(profileOrBase:string,baseOrKey:string,maybeKey?:string):void{
    const profileId=maybeKey===undefined?DEFAULT_MODEL_PROFILE_ID:profileOrBase,baseUrl=maybeKey===undefined?profileOrBase:baseOrKey,key=maybeKey??baseOrKey;
    if(!PROFILE_ID.test(profileId))throw new Error('模型配置编号无效，密钥未保存。');
    const endpoint=buildChatUrl(baseUrl),cleanKey=key.trim();if(!cleanKey){this.remove(profileId);return;}if(cleanKey.length>4096)throw new Error('AI密钥过长，未保存。');
    const entries=this.load(true).filter(entry=>entry.profileId!==profileId);entries.push({profileId,endpoint,key:cleanKey});this.persist(entries);
  }

  remove(profileId:string):void{
    if(!PROFILE_ID.test(profileId))throw new Error('模型配置编号无效，密钥未移除。');
    const entries=this.load(true),next=entries.filter(entry=>entry.profileId!==profileId);if(next.length===entries.length)return;if(!next.length){this.clear();return;}this.persist(next);
  }

  private persist(entries:ProfileCredential[]):void{
    let ciphertext:Buffer;
    try{if(!this.cipher.isEncryptionAvailable())throw new Error('Encryption is unavailable');ciphertext=this.cipher.encryptString(JSON.stringify({purpose:PROFILE_PURPOSE,version:2,entries}));if(!Buffer.isBuffer(ciphertext)||!ciphertext.length)throw new Error('Encryption returned no ciphertext');}
    catch{throw new Error('系统密钥保护不可用或加密失败，原凭据已保留，未保存新密钥。');}
    const temporary=`${this.filePath}.${randomUUID()}.tmp`;let descriptor:number|undefined;
    try{mkdirSync(dirname(this.filePath),{recursive:true,mode:0o700});descriptor=openSync(temporary,'wx',0o600);writeFileSync(descriptor,JSON.stringify({version:2,encrypted:ciphertext.toString('base64')}),'utf8');fsyncSync(descriptor);closeSync(descriptor);descriptor=undefined;renameSync(temporary,this.filePath);}
    catch{throw new Error('密钥未能安全保存，原凭据已保留。请检查数据目录后重试。');}
    finally{if(descriptor!==undefined){try{closeSync(descriptor);}catch{/* No plaintext was written. */}}if(existsSync(temporary)){try{unlinkSync(temporary);}catch{/* Any leftover is encrypted only. */}}}
  }

  clear():void{try{if(existsSync(this.filePath))unlinkSync(this.filePath);}catch{throw new Error('本机凭据暂时无法移除，请检查数据目录后重试。');}}
  clearAll():void{this.clear();}

  /** Detach encrypted credentials so a larger transaction can still roll back. */
  beginClear(detachedPath?:string):CredentialClearTransaction{
    if(!existsSync(this.filePath))return{commit(){/* Nothing was stored. */},rollback(){/* Nothing was stored. */}};
    const detached=detachedPath?resolve(detachedPath):`${this.filePath}.restore-${randomUUID()}.cleared`;
    if(dirname(detached)!==dirname(this.filePath)||!basename(detached).endsWith('.detached')&&detachedPath!==undefined)throw new Error('凭据分离路径无效，原凭据已保留。');
    if(existsSync(detached))throw new Error('凭据分离位置已存在，原凭据已保留。');
    try{renameSync(this.filePath,detached);}catch{throw new Error('本机凭据暂时无法安全分离，学习档案尚未恢复。请检查数据目录后重试。');}
    let pending=true;
    return{
      commit:()=>{if(!pending)return;pending=false;try{if(existsSync(detached))unlinkSync(detached);}catch{/* The encrypted detached file is no longer used by the app. */}},
      rollback:()=>{if(!pending)return;if(existsSync(this.filePath))throw new Error('恢复原凭据时发现新的凭据文件，已停止以避免覆盖。');try{renameSync(detached,this.filePath);pending=false;}catch{throw new Error('学习档案恢复失败，原加密凭据未能自动放回。请保留数据目录并停止继续操作。');}}
    };
  }
}
