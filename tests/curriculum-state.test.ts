import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import initSqlJs from 'sql.js';
import {LearningStore} from '../src/main/store';
import {activityDemandAdvanced,chooseResumeSession,progressionDecision,taskFamilySignature} from '../src/main/curriculum';
import type {Activity,Session,TaskDemand,TeachingObservation} from '../src/shared/types';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

function activity(instruction:string,complexity:TaskDemand['complexity']=1,kind:TaskDemand['kind']='recognize'):Activity{
 return {id:'task',title:'练习',instruction,kind:'application',rubric:['说明依据'],sourceIds:[],assessmentBasis:'ai',demand:{kind,complexity,novelty:1,scaffolding:'supported',concepts:['条件']},workSize:'short'};
}
function session(id:string,unitId:string,updatedAt:string,status:Session['status']='active'):Session{
 const task=activity('判断 2 是否满足条件。');
 return {id,projectId:'p',capabilityId:'c',unitId,routeVersionId:'route',activity:task,mode:'practice',status,createdAt:updatedAt,updatedAt,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'这里',nextStep:'继续'};
}
function observation(id:string,signature:string):TeachingObservation{
 return {id,projectId:'p',unitId:'u',sessionId:'s',kind:'verified_performance',scope:'一个条件判断',summary:'学习者提交了判断与理由',taskFamily:signature,demand:activity('题目').demand!,helpLevel:0,certainty:'verified',outcome:'met',progressionEligible:true,status:'active',createdAt:'2026-09-09T00:00:00Z'};
}

describe('curriculum progression',()=>{
 it('treats number and variable substitutions as the same task family',()=>{
  expect(taskFamilySignature('设 I(x)=x^2，判断 x=2 是否满足条件。')).toBe(taskFamilySignature('设 I(y)=y^2，判断 y=5 是否满足条件。'));
  const demand=activity('题目').demand!;expect(taskFamilySignature('换一种说法判断条件。',demand)).toBe(taskFamilySignature('完全不同的表述，但仍是同一认知操作。',demand));
 });
 it('requires a real increase in cognitive demand for a harder task',()=>{
  const previous=activity('判断 2 是否满足条件。',1,'recognize').demand!;
  expect(activityDemandAdvanced(previous,{...previous,complexity:1,concepts:['条件']})).toBe(false);
  expect(activityDemandAdvanced(previous,{...previous,kind:'derive',complexity:2,concepts:['条件','证明机制']})).toBe(true);
 });
 it('stops a third same-level repetition and recommends one discriminating challenge',()=>{
  const signature=taskFamilySignature('判断 2 是否满足条件。');
  const decision=progressionDecision({intent:'continue',currentDemand:activity('题目').demand!,recentObservations:[observation('o1',signature),observation('o2',signature)],currentTaskFamily:signature});
  expect(decision.action).toBe('challenge');
  expect(decision.reason).toContain('同类');
 });
 it('does not count the saved input and its later verification as two tasks',()=>{
  const signature=taskFamilySignature('判断 2 是否满足条件。'),oneTask=[{...observation('saved',signature),taskId:'task-1',kind:'learner_work' as const,certainty:'unverified' as const,outcome:undefined,progressionEligible:false},{...observation('verified',signature),taskId:'task-1'}];
  expect(progressionDecision({intent:'continue',currentDemand:activity('题目').demand!,recentObservations:oneTask,currentTaskFamily:signature}).action).toBe('continue');
 });
 it('does not turn two failed, self-reported or unverified expressions into an automatic challenge',()=>{
  const signature=taskFamilySignature('判断 2 是否满足条件。'),base=observation('base',signature);
  const failed=[{...base,id:'failed-1',taskId:'task-1',outcome:'not_yet' as const,progressionEligible:false},{...base,id:'failed-2',taskId:'task-2',outcome:'partial' as const,progressionEligible:false}];
  const unverified=[{...base,id:'draft-1',taskId:'task-1',kind:'learner_work' as const,certainty:'unverified' as const,outcome:undefined,progressionEligible:false},{...base,id:'report-2',taskId:'task-2',kind:'learner_report' as const,certainty:'unverified' as const,outcome:undefined,progressionEligible:false}];
  expect(progressionDecision({intent:'continue',currentDemand:activity('题目').demand!,recentObservations:failed,currentTaskFamily:signature}).action).toBe('continue');
  expect(progressionDecision({intent:'continue',currentDemand:activity('题目').demand!,recentObservations:unverified,currentTaskFamily:signature}).action).toBe('continue');
 });
 it('fills only the gap exposed by an unfinished challenge',()=>{
  const decision=progressionDecision({intent:'continue',currentPositionIntent:'challenge',currentOutcome:'partial',gapSummary:'还没有说明第二个条件的作用',recentObservations:[]});expect(decision).toMatchObject({action:'fill_gap'});expect(decision.reason).toContain('第二个条件');
 });
 it('resumes the latest durable session for a unit, including a paused session',()=>{
  expect(chooseResumeSession([session('older','u','2026-09-08T00:00:00Z'),session('other','v','2026-09-10T00:00:00Z'),session('latest','u','2026-09-09T00:00:00Z','paused')],'u')?.id).toBe('latest');
 });
});

describe('schema version 9 curriculum storage',()=>{
 it('backs up the exact v4 database before adding curriculum collections',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-v5-'));roots.push(root);
  let store=await LearningStore.open(root);store.put('projects',{id:'p',title:'教材',goal:'掌握整本教材',status:'active',createdAt:'2026-09-09T00:00:00Z',updatedAt:'2026-09-09T00:00:00Z'});store.close();
  const SQL=await initSqlJs(),db=new SQL.Database(readFileSync(join(root,'learning.sqlite')));db.run('PRAGMA user_version=4');const original=Buffer.from(db.export());db.close();writeFileSync(join(root,'learning.sqlite'),original);
  store=await LearningStore.open(root);
  expect(store.list('routeVersions')).toEqual([]);
  expect(store.list('learningUnits')).toEqual([]);
  expect(store.list('learningPositions')).toEqual([]);
  expect(store.list('teachingObservations')).toEqual([]);
  expect(store.list('understandingDrafts')).toEqual([]);
  store.close();
  const migrated=new SQL.Database(readFileSync(join(root,'learning.sqlite')));expect(migrated.exec('PRAGMA user_version')[0].values[0][0]).toBe(9);migrated.close();
  const backups=readdirSync(join(root,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.4-/);expect(readFileSync(join(root,'upgrade-backups',backups[0]))).toEqual(original);
 });
});
