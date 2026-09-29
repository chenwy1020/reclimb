import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import initSqlJs from 'sql.js';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {writeBackup,readBackup,prepareRestore} from '../src/main/backup';

describe('durable input archives remain compatible in 0.4',()=>{
 it('backs up an exact v3 database before migration to v8 without rewriting its records',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reclimb-v4-upgrade-'));let store:LearningStore|undefined;
  try{
   store=await LearningStore.open(dir);const now=new Date().toISOString();
   const project={id:'old-project',title:'原项目',goal:'保留我的尝试',status:'active' as const,createdAt:now,updatedAt:now};
   store.put('projects',project);store.close();
   const SQL=await initSqlJs(),db=new SQL.Database(readFileSync(join(dir,'learning.sqlite')));
   db.run('PRAGMA user_version=3');const original=Buffer.from(db.export());db.close();writeFileSync(join(dir,'learning.sqlite'),original);
   store=await LearningStore.open(dir);expect(store.get('projects',project.id)).toEqual(project);store.close();store=undefined;
   const after=new SQL.Database(readFileSync(join(dir,'learning.sqlite')));expect(after.exec('PRAGMA user_version')[0].values[0][0]).toBe(12);after.close();
   const backups=readdirSync(join(dir,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.4-/);
   expect(readFileSync(join(dir,'upgrade-backups',backups[0]))).toEqual(original);
   store=await LearningStore.open(dir);expect(readdirSync(join(dir,'upgrade-backups'))).toHaveLength(1);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('round-trips a saved note and failed response without converting it into evidence',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-v4-backup-'));let store:LearningStore|undefined,restored:LearningStore|undefined;
  try{
   store=await LearningStore.open(join(root,'source'));const now=new Date().toISOString();
   store.put('projects',{id:'p',title:'原创项目',goal:'解释我的理解',status:'active',createdAt:now,updatedAt:now});
   store.put('capabilities',{id:'c',projectId:'p',title:'理解',description:'理解',prerequisites:[],sourceIds:[],order:0});
   const activity={id:'task',title:'解释概念',instruction:'写下你的理解',kind:'reconstruction' as const,rubric:['说明理由'],sourceIds:[],assessmentBasis:'ai' as const};
   const message={id:'input',role:'user' as const,text:'我还不明白，但这个想法需要保留。',createdAt:now,kind:'note',taskId:'task',inputId:'input',requestId:'request',responseMode:'discussion' as const,responseState:'failed' as const,responseError:'网络不可用',responseUpdatedAt:now,activitySnapshot:activity,helpLevel:0};
   store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',activity,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'仍在继续写',helpLevel:0,helpEvents:[],messages:[message],checkpoint:'已保存',nextStep:'稍后回应'});
   const file=join(root,'archive.reclimb');writeBackup(store,file);
   expect(JSON.parse(new AdmZip(file).readAsText('manifest.json')).version).toBe(12);
   const backup=readBackup(file);expect(backup.records.sessions[0].messages[0]).toEqual(message);expect(backup.records.evidence).toEqual([]);
   await prepareRestore(file,join(root,'restored'));restored=await LearningStore.open(join(root,'restored'));
   expect(restored.get('sessions','s')?.messages[0]).toEqual(message);expect(restored.list('evidence')).toEqual([]);
  }finally{restored?.close();store?.close();rmSync(root,{recursive:true,force:true});}
 });
});

import {VerificationService} from '../src/main/verification-service';
import {CallRunner} from '../src/main/call-runner';
import {LearningService} from '../src/main/learning-service';
import {finishAssessment} from '../src/main/evidence';

async function inputArchiveCase(change:(records:any)=>void,withEvidence=false){
 const root=mkdtempSync(join(tmpdir(),'reclimb-v4-input-graph-'));let store:LearningStore|undefined;
 try{
  store=await LearningStore.open(join(root,'source'));const now=new Date().toISOString();
  store.put('projects',{id:'p',title:'原创关联测试',goal:'保存原始思路',status:'active',createdAt:now,updatedAt:now});
  store.put('capabilities',{id:'c',projectId:'p',title:'比较',description:'比较条件',prerequisites:[],sourceIds:[],order:0});
  const activity={id:'task',title:'比较',instruction:'比较 3 与 5 并说明。',kind:'selection' as const,rubric:['说明比较依据'],sourceIds:[],assessmentBasis:'ai' as const};
  const verifier=new VerificationService(store,new CallRunner(store,()=>''));
  const version=verifier.createVersion({projectId:'p',capabilityId:'c',activity,sources:[],steps:[{id:'intro',taskId:'task',action:'explain',title:'认识对象',content:'先辨认比较的两个对象。',sourceIds:[],createdAt:now},{id:'attempt-step',taskId:'task',action:'attempt',title:'尝试比较',content:activity.instruction,activity,sourceIds:[],createdAt:now}]});
  store.put('taskReviews',{id:'ready',projectId:'p',teachingVersionId:version.id,contentHash:version.contentHash,status:'ready',summary:'可开展',privateSolution:'按次序比较',issues:[],branches:[],exposureRelations:[],localChecks:[],createdAt:now,reviewerModel:'local-fixture'});
  store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',activity:version.activity,teachingVersionId:version.id,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'当前草稿',helpLevel:0,helpEvents:[],messages:[],checkpoint:'原步骤',nextStep:'继续',teaching:{version:1,current:version.steps[1],upcoming:[],history:[version.steps[0]],guidance:'guided',confusionCount:0}});
  const service=new LearningService(store,()=>''),receipt=service.recordInput('s',{requestId:'request',text:'我按次序比较了两个数。',kind:'attempt',taskId:'task',stepId:'attempt-step',teachingVersionId:version.id});
  const originalSession=store.get('sessions','s')!;
  store.put('sessions',{...originalSession,messages:originalSession.messages.map(m=>({...m,responseMode:'discussion' as const}))});
  expect(()=>finishAssessment(store!,receipt.attemptId!,{outcome:'met',feedback:'已给依据',criteria:[{criterion:activity.rubric[0],criterionId:version.activity.rubricIds![0],result:'met',reason:'写出次序'}],limitations:[],sourceIds:[]})).toThrow('不补发能力评价');
  expect(store.list('evidence')).toHaveLength(0);store.put('sessions',originalSession);
  if(withEvidence){finishAssessment(store,receipt.attemptId!,{outcome:'met',feedback:'已给依据',criteria:[{criterion:activity.rubric[0],criterionId:version.activity.rubricIds![0],result:'met',reason:'写出次序'}],limitations:[],sourceIds:[]});const session=store.get('sessions','s')!;store.put('sessions',{...session,messages:session.messages.map(message=>message.inputId===receipt.inputId?{...message,responseState:'completed' as const}:message)});}
  const file=join(root,'original.reclimb');writeBackup(store,file);expect(readBackup(file).records.sessions[0].messages).toHaveLength(1);
  const zip=new AdmZip(file),manifest=JSON.parse(zip.readAsText('manifest.json'));change(manifest.records);zip.addFile('manifest.json',Buffer.from(JSON.stringify(manifest)));const altered=join(root,'altered.reclimb');zip.writeZip(altered);expect(()=>readBackup(altered)).toThrow();
 }finally{store?.close();rmSync(root,{recursive:true,force:true});}
}
describe('v4 input provenance counterexamples',()=>{
 it('rejects changed teaching text under an unchanged frozen step ID',async()=>inputArchiveCase(records=>{records.sessions[0].messages[0].stepSnapshot.content='伪造：原步骤要求把大于当成小于。';}));
 it('rejects a saved input attached to another step than its corresponding attempt',async()=>inputArchiveCase(records=>{const message=records.sessions[0].messages[0];message.stepId='intro';message.stepSnapshot=records.teachingVersions[0].steps[0];}));
 it('rejects a saved input with a different idempotency request ID than its corresponding attempt',async()=>inputArchiveCase(records=>{records.sessions[0].messages[0].requestId='other-request';}));
 it('rejects capability evidence attributed to an input frozen as discussion only',async()=>inputArchiveCase(records=>{records.sessions[0].messages[0].responseMode='discussion';},true));
});
