import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  RESTORE_JOURNAL_FILENAME,
  createRestoreJournalRecord,
  recoverInterruptedRestore,
  writeRestoreJournal,
  type RestoreExpectedPaths,
} from '../src/main/restore-journal';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'reclimb-restore-journal-'));roots.push(root);
  const expected:RestoreExpectedPaths={
    workspace:join(root,'workspace'),
    teachingCredential:join(root,'credentials.json'),
    visionCredential:join(root,'vision-credentials.json'),
  };
  const stage=join(root,'restore-operation-1'),previous=join(root,'previous-1700000000000-operation-1');
  const record=createRestoreJournalRecord(root,{...expected,stage,previous},'operation-1');
  return {root,expected,stage,previous,record,journal:join(root,RESTORE_JOURNAL_FILENAME)};
}

function put(path:string,value:string){mkdirSync(path.substring(0,path.lastIndexOf('\\'))||path.substring(0,path.lastIndexOf('/')),{recursive:true});writeFileSync(path,value,'utf8');}

describe('restore journal',()=>{
  for(const phase of ['commit','rollback'] as const)it('preserves local credentials in sync '+phase,()=>{
    const {root,record,expected,previous,stage}=fixture();
    mkdirSync(record.workspace,{recursive:true});mkdirSync(previous,{recursive:true});
    writeFileSync(join(record.workspace,'marker'),'remote');writeFileSync(join(previous,'marker'),'local');
    writeFileSync(expected.teachingCredential,'protected-local-key');writeFileSync(expected.visionCredential,'protected-vision-key');
    writeRestoreJournal(root,{...record,credentialMode:'preserve-local',phase});
    const recovery=recoverInterruptedRestore(root,expected);
    expect(recovery.phase).toBe(phase);expect(readFileSync(expected.teachingCredential,'utf8')).toBe('protected-local-key');
    expect(readFileSync(expected.visionCredential,'utf8')).toBe('protected-vision-key');
    expect(readFileSync(join(record.workspace,'marker'),'utf8')).toBe(phase==='commit'?'remote':'local');
    if(phase==='rollback')expect(readFileSync(join(stage,'marker'),'utf8')).toBe('remote');
  });
  it('creates predictable detached credential paths and writes the journal atomically',()=>{
    const {root,record,journal}=fixture();
    expect(record.credentials.teaching.detached).toBe(join(root,'restore-teaching-credential-operation-1.detached'));
    expect(record.credentials.vision.detached).toBe(join(root,'restore-vision-credential-operation-1.detached'));
    writeRestoreJournal(root,record);
    expect(JSON.parse(readFileSync(journal,'utf8'))).toEqual(record);
    writeRestoreJournal(root,{...record,phase:'commit'});
    expect(JSON.parse(readFileSync(journal,'utf8')).phase).toBe('commit');
    expect(readdirSync(root).some(name=>name.includes('.tmp'))).toBe(false);
  });

  it('rolls the replaced workspace and detached credentials back without overwriting either',()=>{
    const {root,expected,previous,record,journal}=fixture();
    put(join(expected.workspace,'state.txt'),'restored archive');put(join(previous,'state.txt'),'original archive');
    put(record.credentials.teaching.detached,'teaching secret');put(record.credentials.vision.detached,'vision secret');
    writeRestoreJournal(root,record);
    const result=recoverInterruptedRestore(root,expected);
    expect(result.recovered).toBe(true);expect(result.phase).toBe('rollback');
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('original archive');
    expect(readFileSync(expected.teachingCredential,'utf8')).toBe('teaching secret');
    expect(readFileSync(expected.visionCredential,'utf8')).toBe('vision secret');
    expect(result.failedWorkspace&&readFileSync(join(result.failedWorkspace,'state.txt'),'utf8')).toBe('restored archive');
    expect(existsSync(journal)).toBe(false);
  });

  it('cancels safely before the first workspace rename',()=>{
    const {root,expected,stage,record,journal}=fixture();put(join(expected.workspace,'state.txt'),'original');put(join(stage,'state.txt'),'staged backup');put(record.credentials.teaching.detached,'teaching secret');writeRestoreJournal(root,record);
    expect(recoverInterruptedRestore(root,expected)).toMatchObject({recovered:true,phase:'rollback'});
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('original');expect(readFileSync(join(stage,'state.txt'),'utf8')).toBe('staged backup');expect(readFileSync(expected.teachingCredential,'utf8')).toBe('teaching secret');expect(existsSync(journal)).toBe(false);
  });

  it('puts the original workspace back after only the first workspace rename',()=>{
    const {root,expected,stage,previous,record,journal}=fixture();put(join(stage,'state.txt'),'staged backup');put(join(previous,'state.txt'),'original');put(record.credentials.vision.detached,'vision secret');writeRestoreJournal(root,record);
    expect(recoverInterruptedRestore(root,expected)).toMatchObject({recovered:true,phase:'rollback'});
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('original');expect(readFileSync(join(stage,'state.txt'),'utf8')).toBe('staged backup');expect(existsSync(previous)).toBe(false);expect(readFileSync(expected.visionCredential,'utf8')).toBe('vision secret');expect(existsSync(journal)).toBe(false);
  });

  it('finishes a committed restore by preserving its workspace and removing every old credential copy',()=>{
    const {root,expected,previous,record,journal}=fixture();
    put(join(expected.workspace,'state.txt'),'restored archive');put(join(previous,'state.txt'),'original archive');
    put(record.credentials.teaching.detached,'detached teaching');put(record.credentials.vision.detached,'detached vision');
    writeRestoreJournal(root,{...record,phase:'commit'});
    const result=recoverInterruptedRestore(root,expected);
    expect(result).toMatchObject({recovered:true,phase:'commit'});
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('restored archive');
    for(const path of [expected.teachingCredential,record.credentials.teaching.detached,expected.visionCredential,record.credentials.vision.detached,journal])expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(previous,'state.txt'),'utf8')).toBe('original archive');
  });

  it('rejects a journal path outside the data root before changing any file',()=>{
    const {root,expected,previous,record,journal}=fixture(),outside=mkdtempSync(join(tmpdir(),'reclimb-outside-'));roots.push(outside);
    put(join(expected.workspace,'state.txt'),'current');put(join(previous,'state.txt'),'previous');put(record.credentials.teaching.detached,'secret');
    writeFileSync(journal,JSON.stringify({...record,stage:join(outside,'restore-stolen')}),'utf8');
    expect(()=>recoverInterruptedRestore(root,expected)).toThrow(/路径|日志/);
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('current');
    expect(readFileSync(join(previous,'state.txt'),'utf8')).toBe('previous');
    expect(readFileSync(record.credentials.teaching.detached,'utf8')).toBe('secret');
    expect(existsSync(journal)).toBe(true);
  });

  it('rejects nested and colliding paths before moving or deleting workspace content',()=>{
    const first=fixture();put(join(first.expected.workspace,'state.txt'),'current');const nestedPrevious=join(first.expected.workspace,'previous-nested');mkdirSync(nestedPrevious);writeFileSync(first.journal,JSON.stringify({...first.record,previous:nestedPrevious}),'utf8');
    expect(()=>recoverInterruptedRestore(first.root,first.expected)).toThrow(/直接下层|路径/);expect(readFileSync(join(first.expected.workspace,'state.txt'),'utf8')).toBe('current');
    const second=fixture();put(join(second.expected.workspace,'state.txt'),'current');const nestedDetached=join(second.expected.workspace,`restore-teaching-credential-${second.record.operationId}.detached`);writeFileSync(second.journal,JSON.stringify({...second.record,phase:'commit',credentials:{...second.record.credentials,teaching:{...second.record.credentials.teaching,detached:nestedDetached}}}),'utf8');
    expect(()=>recoverInterruptedRestore(second.root,second.expected)).toThrow(/直接下层|路径/);expect(readFileSync(join(second.expected.workspace,'state.txt'),'utf8')).toBe('current');
  });

  it('never overwrites an unrelated or already committed restore journal',()=>{
    const {root,record,journal}=fixture();writeRestoreJournal(root,record);const before=readFileSync(journal);
    const other=createRestoreJournalRecord(root,{workspace:record.workspace,stage:join(root,'restore-operation-2'),previous:join(root,'previous-other-operation-2'),teachingCredential:record.credentials.teaching.active,visionCredential:record.credentials.vision.active},'operation-2');
    expect(()=>writeRestoreJournal(root,other)).toThrow(/已有|覆盖/);expect(readFileSync(journal)).toEqual(before);
    writeRestoreJournal(root,{...record,phase:'commit'});const committed=readFileSync(journal);expect(()=>writeRestoreJournal(root,record)).toThrow(/已有|覆盖/);expect(readFileSync(journal)).toEqual(committed);
  });

  it('stops on credential and workspace conflicts instead of overwriting them',()=>{
    const {root,expected,previous,record,journal}=fixture();
    put(join(expected.workspace,'state.txt'),'current');put(join(previous,'state.txt'),'previous');
    put(expected.teachingCredential,'new credential');put(record.credentials.teaching.detached,'old credential');writeRestoreJournal(root,record);
    expect(()=>recoverInterruptedRestore(root,expected)).toThrow(/覆盖|冲突/);
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('current');
    expect(readFileSync(join(previous,'state.txt'),'utf8')).toBe('previous');
    expect(readFileSync(expected.teachingCredential,'utf8')).toBe('new credential');
    expect(readFileSync(record.credentials.teaching.detached,'utf8')).toBe('old credential');
    expect(existsSync(journal)).toBe(true);
  });

  it('does not partially commit when a credential path is a directory or the restored workspace is missing',()=>{
    const first=fixture();put(join(first.expected.workspace,'state.txt'),'restored');put(join(first.previous,'state.txt'),'original');put(first.expected.teachingCredential,'teaching');mkdirSync(first.record.credentials.vision.detached);writeRestoreJournal(first.root,{...first.record,phase:'commit'});
    expect(()=>recoverInterruptedRestore(first.root,first.expected)).toThrow(/凭据|文件/);
    expect(readFileSync(first.expected.teachingCredential,'utf8')).toBe('teaching');expect(existsSync(first.journal)).toBe(true);

    const second=fixture();put(join(second.previous,'state.txt'),'original');put(second.expected.teachingCredential,'teaching');writeRestoreJournal(second.root,{...second.record,phase:'commit'});
    expect(()=>recoverInterruptedRestore(second.root,second.expected)).toThrow(/工作区/);
    expect(readFileSync(second.expected.teachingCredential,'utf8')).toBe('teaching');expect(existsSync(second.journal)).toBe(true);
  });

  it('rejects an ambiguous rollback state before reconnecting detached credentials',()=>{
    const {root,expected,record,journal}=fixture();put(join(expected.workspace,'state.txt'),'unknown workspace');put(record.credentials.teaching.detached,'old secret');writeRestoreJournal(root,record);
    expect(()=>recoverInterruptedRestore(root,expected)).toThrow(/状态|工作区/);
    expect(readFileSync(join(expected.workspace,'state.txt'),'utf8')).toBe('unknown workspace');
    expect(readFileSync(record.credentials.teaching.detached,'utf8')).toBe('old secret');
    expect(existsSync(expected.teachingCredential)).toBe(false);expect(existsSync(journal)).toBe(true);
  });

  it('binds stage and previous directory names to the journal operation id',()=>{
    const {root,expected,previous}=fixture();
    expect(()=>createRestoreJournalRecord(root,{...expected,stage:join(root,'restore-other-operation'),previous},'operation-1')).toThrow(/命名|编号/);
    expect(()=>createRestoreJournalRecord(root,{...expected,stage:join(root,'restore-operation-1'),previous:join(root,'previous-1700000000000-other')},'operation-1')).toThrow(/命名|编号/);
  });

  it('does not delete an unexpected active key while finishing a committed journal',()=>{
    const {root,expected,previous,record,journal}=fixture();put(join(expected.workspace,'state.txt'),'restored');put(join(previous,'state.txt'),'original');put(expected.teachingCredential,'new key');put(record.credentials.teaching.detached,'old key');writeRestoreJournal(root,{...record,phase:'commit'});
    expect(()=>recoverInterruptedRestore(root,expected)).toThrow(/凭据|冲突/);
    expect(readFileSync(expected.teachingCredential,'utf8')).toBe('new key');expect(readFileSync(record.credentials.teaching.detached,'utf8')).toBe('old key');expect(existsSync(journal)).toBe(true);
  });

  it('does not report commit completion while its journal is still present',()=>{
    const {root,expected,previous,record,journal}=fixture();put(join(expected.workspace,'state.txt'),'restored');put(join(previous,'state.txt'),'original');put(record.credentials.teaching.detached,'old key');writeRestoreJournal(root,{...record,phase:'commit'});
    expect(()=>recoverInterruptedRestore(root,expected,{removeJournal:()=>{throw new Error('locked')}})).toThrow(/日志|清理|重启/);
    expect(existsSync(journal)).toBe(true);expect(existsSync(record.credentials.teaching.detached)).toBe(false);
    expect(recoverInterruptedRestore(root,expected)).toMatchObject({recovered:true,phase:'commit'});expect(existsSync(journal)).toBe(false);
  });
});
