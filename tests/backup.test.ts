import {describe,it,expect} from 'vitest';import {mkdtempSync,readFileSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';import {writeBackup,readBackup,prepareRestore} from '../src/main/backup';import {isPublicAddress} from '../src/main/public-article';
describe('portable backups and public inputs',()=>{
 it('restores durable records without API credentials',async()=>{const dir=mkdtempSync(join(tmpdir(),'reclimb-backup-'));const store=await LearningStore.open(join(dir,'one'));try{const now=new Date().toISOString();store.put('projects',{id:'p',title:'学习目标',goal:'可以独立说明',status:'active',createdAt:now,updatedAt:now});store.updateSettings({monthlyBudgetCny:100});const file=join(dir,'copy.reclimb');writeBackup(store,file);expect(new AdmZip(file).readAsText('manifest.json')).not.toContain('apiKey');await prepareRestore(file,join(dir,'two'));const restored=await LearningStore.open(join(dir,'two'));expect(restored.get('projects','p')?.title).toBe('学习目标');expect(restored.getSettings().hasApiKey).toBe(false);restored.close();}finally{store.close();rmSync(dir,{recursive:true,force:true});}});
 it('rejects corrupt archives and malicious entry paths',()=>{const dir=mkdtempSync(join(tmpdir(),'reclimb-badzip-'));try{const z=new AdmZip();z.addFile('manifest.json',Buffer.from('{"format":"wrong"}'));z.writeZip(join(dir,'bad.zip'));expect(()=>readBackup(join(dir,'bad.zip'))).toThrow();}finally{rmSync(dir,{recursive:true,force:true});}});
 it('blocks loopback, LAN, link-local and mapped IPv6',()=>{for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])expect(isPublicAddress(ip)).toBe(false);expect(isPublicAddress('8.8.8.8')).toBe(true);expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);});
});



it('validates record relationships before replacing an existing valid backup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-backup-validation-'));
 const store=await LearningStore.open(join(dir,'workspace'));
 try{
  const file=join(dir,'copy.reclimb');
  writeBackup(store,file);
  const before=readFileSync(file);
  store.put('capabilities',{id:'orphan',projectId:'missing',title:'能力',description:'尚无项目',prerequisites:[],sourceIds:[],order:0});
  expect(()=>writeBackup(store,file)).toThrow(/不存在|关联/);
  expect(readFileSync(file).equals(before)).toBe(true);
  expect(existsSync(file+'.partial')).toBe(false);
  expect(readBackup(file).records.capabilities).toEqual([]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('keeps the last valid backup when a new manifest exceeds the restore limit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-backup-capacity-'));
 const store=await LearningStore.open(join(dir,'workspace'));
 try{
  const file=join(dir,'copy.reclimb');
  writeBackup(store,file);
  const before=readFileSync(file);
  const now=new Date().toISOString();
  store.transaction(()=>{
   for(let i=0;i<160;i++)store.put('projects',{id:'project-'+i,title:'学习项目 '+i,goal:'长期学习',status:'active',createdAt:now,updatedAt:now,routeSummary:'a'.repeat(200000)});
  });
  expect(()=>writeBackup(store,file)).toThrow(/清单.*过大/);
  expect(readFileSync(file).equals(before)).toBe(true);
  expect(existsSync(file+'.partial')).toBe(false);
  expect(readBackup(file).records.projects).toEqual([]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},20000);

it('cleans the partial file when destination replacement fails',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-backup-rename-'));
 const store=await LearningStore.open(join(dir,'workspace'));
 try{
  const destination=join(dir,'existing-directory');
  mkdirSync(destination);
  expect(()=>writeBackup(store,destination)).toThrow();
  expect(existsSync(destination)).toBe(true);
  expect(existsSync(destination+'.partial')).toBe(false);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('preserves archived capabilities and their historical goal through backup restoration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-backup-capability-'));
 const store=await LearningStore.open(join(dir,'workspace'));
 try{
  const now=new Date().toISOString();
  store.put('projects',{id:'p',title:'新目标',goal:'修订后的目标',status:'active',createdAt:now,updatedAt:now});
  const capability={id:'c',projectId:'p',title:'历史能力',description:'历史任务的能力目标',prerequisites:[],sourceIds:[],order:0,archived:true,goalContext:'最初想获得的能力'};
  store.put('capabilities',capability);
  const file=join(dir,'copy.reclimb');
  writeBackup(store,file);
  expect(readBackup(file).records.capabilities[0]).toMatchObject({archived:true,goalContext:'最初想获得的能力'});
  await prepareRestore(file,join(dir,'restored'));
  const restored=await LearningStore.open(join(dir,'restored'));
  try{expect(restored.get('capabilities','c')).toMatchObject({archived:true,goalContext:'最初想获得的能力'});}finally{restored.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});


async function linkedBackupFixture(){
 const dir=mkdtempSync(join(tmpdir(),'reclimb-linked-backup-'));
 const store=await LearningStore.open(join(dir,'workspace'));
 const started='2026-09-01T00:00:00Z',returned='2026-09-03T00:00:00Z';
 const assessment={outcome:'met' as const,feedback:'给出了依据',criteria:[{criterion:'说明依据',result:'met' as const,reason:'作答中明确说明'}],limitations:[],sourceIds:[]};
 const activity={title:'判断练习',instruction:'说明第一种情境的依据',kind:'application' as const,rubric:['说明依据'],sourceIds:[],assessmentBasis:'ai' as const};
 store.transaction(()=>{
  for(const id of ['p','other'])store.put('projects',{id,title:id,goal:'独立说明依据',status:'active',createdAt:started,updatedAt:started});
  for(const [id,projectId] of [['c1','p'],['c2','p'],['other-c','other']])store.put('capabilities',{id,projectId,title:id,description:'能力定义',prerequisites:[],sourceIds:[],order:0});
  for(const [id,capabilityId] of [['s1','c1'],['s2','c2'],['return','c1']])store.put('sessions',{id,projectId:'p',capabilityId,activity:id==='return'?{...activity,instruction:'说明新的情境与条件'}:activity,mode:id==='return'?'delayed':'practice',status:'active',createdAt:id==='return'?returned:started,updatedAt:id==='return'?returned:started,draft:'作答',helpLevel:1,helpEvents:[],messages:[],checkpoint:'继续位置',nextStep:'',...(id==='return'?{dueReviewId:'review'}:{})});
  for(const [id,sessionId] of [['a1','s1'],['a2','s2'],['return-a','return']])store.put('attempts',{id,projectId:'p',sessionId,text:'明确说明依据',submittedAt:sessionId==='return'?returned:started,helpLevel:0,requestId:id,assessment});
  store.put('evidence',{id:'e1',projectId:'p',capabilityId:'c1',sessionId:'s1',attemptId:'a1',status:'independent',helpLevel:0,assessment,createdAt:started});
  store.put('evidence',{id:'return-e',projectId:'p',capabilityId:'c1',sessionId:'return',attemptId:'return-a',status:'delayed',helpLevel:0,assessment,createdAt:returned});
  store.put('reviews',{id:'review',projectId:'p',capabilityId:'c1',fromSessionId:'s1',kind:'delayed',dueAt:returned,status:'done',completedSessionId:'return'});
  const original=join(store.dataDirectory,'other.txt');writeFileSync(original,'其他项目的材料');
  store.put('materials',{id:'other-m',projectId:'other',title:'其他材料',kind:'txt',originalName:'other.txt',storedPath:original,importedAt:started,warnings:[],fragmentCount:1,summary:'其他材料'});
  store.put('fragments',{id:'other-f',projectId:'other',materialId:'other-m',locator:'第一段',text:'其他项目的材料',ordinal:0});
 });
 const file=join(dir,'valid.reclimb');writeBackup(store,file);
 return {dir,store,file,cleanup:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}
function alteredBackup(file:string,change:(records:any)=>void){
 const zip=new AdmZip(file),manifest=JSON.parse(zip.readAsText('manifest.json'));
 change(manifest.records);zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));
 const invalid=file+'.altered';zip.writeZip(invalid);return invalid;
}

describe('restored learning evidence association integrity',()=>{
 it.each([
  ['attempt from a different session',(r:any)=>{r.evidence[0].attemptId='a2';}],
  ['capability different from the evidence session',(r:any)=>{r.evidence[0].capabilityId='c2';}],
  ['help level different from the submitted attempt',(r:any)=>{r.evidence[0].helpLevel=4;}],
  ['review origin with another capability',(r:any)=>{r.reviews[0].fromSessionId='s2';}],
  ['missing completion session',(r:any)=>{r.reviews[0].completedSessionId='missing';}],
  ['completion session from another capability',(r:any)=>{r.reviews[0].completedSessionId='s2';}],
  ['completion session without its review link',(r:any)=>{delete r.sessions.find((s:any)=>s.id==='return').dueReviewId;}],
  ['done review without completion evidence',(r:any)=>{r.evidence=r.evidence.filter((e:any)=>e.id!=='return-e');}],
  ['done review with an ordinary rather than delayed evaluation',(r:any)=>{r.evidence.find((e:any)=>e.id==='return-e').status='independent';}],
  ['done review with unfulfilled evaluation criteria',(r:any)=>{r.evidence.find((e:any)=>e.id==='return-e').assessment.criteria[0].result='not_yet';}],
  ['pending review claiming a completion session',(r:any)=>{r.reviews[0].status='pending';}],
  ['session message citing another project',(r:any)=>{r.sessions[0].messages.push({id:'message',role:'assistant',text:'引用',createdAt:'2026-09-01T00:00:00Z',sourceIds:['other-f']});}],
  ['attempt assessment citing another project',(r:any)=>{r.attempts[0].assessment.sourceIds=['other-f'];}],
 ] as const)('rejects %s before restoration',async(_name,change)=>{
  const fixture=await linkedBackupFixture();
  try{expect(()=>readBackup(alteredBackup(fixture.file,change))).toThrow(/关联|证据|回访|来源|帮助|标准/);}finally{fixture.cleanup();}
 });

 it('restores valid evidence and completed reviews with all original links intact',async()=>{
  const fixture=await linkedBackupFixture();
  try{
   await prepareRestore(fixture.file,join(fixture.dir,'restored'));
   const restored=await LearningStore.open(join(fixture.dir,'restored'));
   try{
    for(const evidence of restored.list('evidence')){
     const attempt=restored.get('attempts',evidence.attemptId)!;
     const session=restored.get('sessions',evidence.sessionId)!;
     expect(attempt.sessionId).toBe(session.id);
     expect(session.capabilityId).toBe(evidence.capabilityId);
     expect(attempt.helpLevel).toBe(evidence.helpLevel);
    }
    const review=restored.get('reviews','review')!;
    expect(restored.get('sessions',review.completedSessionId!)?.dueReviewId).toBe(review.id);
    expect(restored.get('evidence','return-e')?.status).toBe('delayed');
   }finally{restored.close();}
  }finally{fixture.cleanup();}
 });
});
