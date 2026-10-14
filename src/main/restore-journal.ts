import {randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';

export const RESTORE_JOURNAL_FILENAME='restore-journal.json';
export interface RestoreExpectedPaths {workspace:string;teachingCredential:string;visionCredential:string}
interface CredentialMove {active:string;detached:string}
export interface RestoreJournalRecord {
 version:1;credentialMode?:'preserve-local';operationId:string;phase:'rollback'|'commit';workspace:string;stage:string;previous:string;
 credentials:{teaching:CredentialMove;vision:CredentialMove};
}
export interface RestoreRecovery {recovered:boolean;phase?:RestoreJournalRecord['phase'];failedWorkspace?:string}

const OPERATION_ID=/^[a-zA-Z0-9_-]{1,120}$/;
const canonical=(path:string)=>resolve(path).toLocaleLowerCase();
function inside(root:string,path:string):boolean{const rel=relative(resolve(root),resolve(path));return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));}
function requireFile(path:string,label:string):void{if(existsSync(path)&&!lstatSync(path).isFile())throw new Error(label+'必须是文件，恢复日志未执行。');}
function requireDirectory(path:string,label:string):void{if(existsSync(path)&&!lstatSync(path).isDirectory())throw new Error(label+'不是有效工作区目录，恢复日志未执行。');}
function journalPath(root:string):string{return join(resolve(root),RESTORE_JOURNAL_FILENAME)}

export function createRestoreJournalRecord(root:string,paths:RestoreExpectedPaths&{stage:string;previous:string},operationId:string=randomUUID()):RestoreJournalRecord{
 const base=resolve(root);if(!OPERATION_ID.test(operationId))throw new Error('恢复操作编号无效。');
 const record:RestoreJournalRecord={version:1,operationId,phase:'rollback',workspace:resolve(paths.workspace),stage:resolve(paths.stage),previous:resolve(paths.previous),credentials:{teaching:{active:resolve(paths.teachingCredential),detached:join(base,`restore-teaching-credential-${operationId}.detached`)},vision:{active:resolve(paths.visionCredential),detached:join(base,`restore-vision-credential-${operationId}.detached`)}}};
 validateRecord(base,record,{workspace:paths.workspace,teachingCredential:paths.teachingCredential,visionCredential:paths.visionCredential});return record;
}

function validateRecord(root:string,value:unknown,expected:RestoreExpectedPaths):RestoreJournalRecord{
 if(!value||typeof value!=='object')throw new Error('恢复日志格式无效，未改动任何文件。');const record=value as RestoreJournalRecord;
 if(record.credentialMode!==undefined&&record.credentialMode!=='preserve-local')throw new Error('恢复凭据模式无效。');
 if(record.version!==1||!OPERATION_ID.test(record.operationId)||!['rollback','commit'].includes(record.phase)||!record.credentials?.teaching||!record.credentials?.vision)throw new Error('恢复日志格式无效，未改动任何文件。');
 const paths=[record.workspace,record.stage,record.previous,record.credentials.teaching.active,record.credentials.teaching.detached,record.credentials.vision.active,record.credentials.vision.detached];
 if(paths.some(path=>typeof path!=='string'||!isAbsolute(path)||!inside(root,path)))throw new Error('恢复日志包含数据目录以外的路径，未改动任何文件。');
 if(new Set(paths.map(canonical)).size!==paths.length)throw new Error('恢复日志路径存在冲突，未改动任何文件。');
  if(canonical(record.workspace)!==canonical(expected.workspace)||canonical(record.credentials.teaching.active)!==canonical(expected.teachingCredential)||canonical(record.credentials.vision.active)!==canonical(expected.visionCredential))throw new Error('恢复日志路径与本机数据目录不一致，未改动任何文件。');
 if([record.workspace,record.stage,record.previous,record.credentials.teaching.active,record.credentials.teaching.detached,record.credentials.vision.active,record.credentials.vision.detached].some(path=>canonical(dirname(path))!==canonical(root)))throw new Error('恢复日志路径必须位于数据目录的直接下层，未改动任何文件。');
 if(basename(record.stage)!==`restore-${record.operationId}`||!basename(record.previous).startsWith('previous-')||!basename(record.previous).endsWith(`-${record.operationId}`)||basename(record.credentials.teaching.detached)!==`restore-teaching-credential-${record.operationId}.detached`||basename(record.credentials.vision.detached)!==`restore-vision-credential-${record.operationId}.detached`)throw new Error('恢复日志路径命名与操作编号不一致，未改动任何文件。');
 return record;
}

export function writeRestoreJournal(root:string,record:RestoreJournalRecord):void{
  const base=resolve(root),expected={workspace:record.workspace,teachingCredential:record.credentials.teaching.active,visionCredential:record.credentials.vision.active};validateRecord(base,record,expected);mkdirSync(base,{recursive:true});
 const destination=journalPath(base);
 if(existsSync(destination)){
  requireFile(destination,'恢复日志');let existing:RestoreJournalRecord;try{existing=validateRecord(base,JSON.parse(readFileSync(destination,'utf8')),expected);}catch{throw new Error('已有恢复事务日志无法安全识别，未覆盖原日志。');}
  const identity=(value:RestoreJournalRecord)=>JSON.stringify({...value,phase:'rollback'});
  if(identity(existing)!==identity(record)||existing.phase==='commit'&&record.phase==='rollback')throw new Error('已有另一项恢复事务尚未处理，未覆盖原日志。');
  if(existing.phase===record.phase)return;
 }
 const temporary=destination+'.'+randomUUID()+'.tmp';let descriptor:number|undefined;
 try{descriptor=openSync(temporary,'wx',0o600);writeFileSync(descriptor,JSON.stringify(record),'utf8');fsyncSync(descriptor);closeSync(descriptor);descriptor=undefined;renameSync(temporary,destination);}
 catch{throw new Error('恢复事务日志未能安全保存，学习档案尚未替换。');}
 finally{if(descriptor!==undefined)try{closeSync(descriptor);}catch{/* Preserve the original journal failure if descriptor cleanup also fails. */}if(existsSync(temporary))try{unlinkSync(temporary);}catch{/* An unpublished temporary journal is safe to retain for diagnosis. */}}
}

export function recoverInterruptedRestore(root:string,expected:RestoreExpectedPaths,options:{removeJournal?:(path:string)=>void}={}):RestoreRecovery{
 const base=resolve(root),file=journalPath(base);if(!existsSync(file))return{recovered:false};
 const removeJournal=options.removeJournal??unlinkSync;
 requireFile(file,'恢复日志');if(lstatSync(file).size>65536)throw new Error('恢复日志过大或已经损坏，未改动任何文件。');
 let parsed:unknown;try{parsed=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('恢复日志无法读取，未改动任何文件。');}
 const record=validateRecord(base,parsed,expected),moves=record.credentialMode==='preserve-local'?[]:[record.credentials.teaching,record.credentials.vision];
 if(record.credentialMode==='preserve-local'&&[record.credentials.teaching,record.credentials.vision].some(item=>existsSync(item.detached)))throw new Error('保留本机凭据的恢复出现意外分离文件，已停止。');
 requireDirectory(record.workspace,'当前工作区');requireDirectory(record.previous,'恢复前工作区');requireDirectory(record.stage,'暂存工作区');for(const item of moves){requireFile(item.active,'当前凭据');requireFile(item.detached,'分离凭据');}
 if(record.phase==='commit'){
  if(!existsSync(record.workspace)||!existsSync(record.previous)||existsSync(record.stage))throw new Error('已提交的恢复工作区状态不完整，未删除任何凭据文件。');
  if(moves.some(item=>existsSync(item.active)))throw new Error('已提交的恢复出现意外的当前凭据冲突，未删除任何凭据文件。');
  for(const item of moves)if(existsSync(item.detached))unlinkSync(item.detached);
  try{removeJournal(file);}catch{throw new Error('恢复已经提交，但事务日志清理尚未完成；请停止操作并重新启动。');}
  return{recovered:true,phase:'commit'};
 }
 for(const item of moves)if(existsSync(item.active)&&existsSync(item.detached))throw new Error('恢复凭据存在覆盖冲突，未改动任何文件。');
 const workspacePresent=existsSync(record.workspace),stagePresent=existsSync(record.stage),previousPresent=existsSync(record.previous);
 const state=workspacePresent&&stagePresent&&!previousPresent?'prepared':!workspacePresent&&stagePresent&&previousPresent?'original_moved':workspacePresent&&!stagePresent&&previousPresent?'replacement_moved':undefined;
 if(!state)throw new Error('中断的恢复工作区状态存在歧义，未改动任何文件或凭据。');
 const undo:(()=>void)[]=[],failedWorkspace=state==='replacement_moved'?record.stage:undefined;
 try{
  if(state==='replacement_moved'){renameSync(record.workspace,record.stage);undo.push(()=>renameSync(record.stage,record.workspace));}
  if(state!=='prepared'){renameSync(record.previous,record.workspace);undo.push(()=>renameSync(record.workspace,record.previous));}
  for(const item of moves)if(existsSync(item.detached)){renameSync(item.detached,item.active);undo.push(()=>renameSync(item.active,item.detached));}
 }catch(error){for(const reverse of undo.reverse())try{reverse();}catch{/* Attempt every remaining reversal before reporting incomplete recovery. */}throw new Error('中断的恢复未能完整回滚；原文件均已保留，请停止操作并检查数据目录。');}
 try{removeJournal(file);}catch{/* The now-idempotent rollback journal can be cleaned on next startup. */}
 return{recovered:true,phase:'rollback',...(failedWorkspace?{failedWorkspace}: {})};
}
