import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {HandwritingService} from '../src/main/handwriting-service';
import {reconcileDerivedState} from '../src/main/operations';
import {seedSamples} from '../src/main/samples';
import {VerificationService} from '../src/main/verification-service';
import {CallRunner} from '../src/main/call-runner';

const cleanups:(()=>void)[]=[];
afterEach(()=>{vi.restoreAllMocks();while(cleanups.length)cleanups.pop()!();});

async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'reclimb-reconcile-snapshot-'));
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=await LearningStore.open(root);cleanups.push(()=>store.close());seedSamples(store);
 const session=store.get('sessions','sample-reasoning-session')!,service=new HandwritingService(store),target=service.target(session.id);
 const image={width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII='};
 const receipt=service.save({requestId:'original',targetId:target.id,pages:[{id:'page',width:768,height:1024,strokes:[],image}],note:'原始作答'});
 const original=store.get('handwritings',receipt.id)!,stamp=original.submittedAt;
 const transcription={id:'confirmed',projectId:session.projectId,sessionId:session.id,targetId:target.id,handwritingId:original.id,contentHash:original.contentHash,requestId:'confirm',createdAt:stamp,status:'confirmed' as const,text:'24升，超过容量时需调整关系式。',uncertainties:[],unresolved:false};
 store.put('handwritingTranscriptions',transcription);
 return {store,session,target,original,transcription,stamp};
}

it('reconciles without loading historical handwriting collections and keeps originals readable',async()=>{
 const t=await fixture(),list=vi.spyOn(t.store,'list');
 reconcileDerivedState(t.store);
 expect(list.mock.calls.filter(([collection])=>['handwritings','handwritingTargets','handwritingTranscriptions'].includes(collection))).toEqual([]);
 expect(t.store.get('handwritings',t.original.id)).toEqual(t.original);
 expect(t.store.get('handwritingTargets',t.target.id)).toEqual(t.target);
 expect(t.store.get('handwritingTranscriptions',t.transcription.id)).toEqual(t.transcription);
});

it('still suspends all conclusions based on a corrected handwritten attempt while preserving unrelated evidence',async()=>{
 const t=await fixture(),{store,session,stamp}=t;
 const assessment={outcome:'met' as const,feedback:'已说明关系与适用条件',criteria:session.activity.rubric.map(criterion=>({criterion,result:'met' as const,reason:'已说明'})),limitations:[],sourceIds:session.activity.sourceIds};
 store.transaction(()=>{
  store.put('attempts',{id:'attempt',projectId:session.projectId,sessionId:session.id,text:t.transcription.text,submittedAt:stamp,helpLevel:0,requestId:'attempt',handwritingId:t.original.id,handwritingTranscriptionId:t.transcription.id});
  for(const id of ['corrected','unrelated']){
   store.put('evidence',{id,projectId:session.projectId,sessionId:session.id,capabilityId:session.capabilityId,attemptId:'attempt',status:'independent',helpLevel:0,assessment,createdAt:stamp});
   store.put('teachingObservations',{id,projectId:session.projectId,sessionId:session.id,evidenceId:id,kind:'verified_performance',scope:'当前任务',summary:'原任务表现',helpLevel:0,certainty:'verified',status:'active',progressionEligible:true,createdAt:stamp});
  }
  store.put('understandingDrafts',{id:'draft',projectId:session.projectId,routeVersionId:'route',version:1,phase:'synthesize',title:'理解稿',blocks:[{id:'block',author:'learner',text:'保留我的理解',sourceIds:[],sourceInputIds:[]}],status:'working',basedOnEvidenceIds:['corrected'],derivedStatus:'active',createdAt:stamp});
  store.put('learningPositions',{id:'position',projectId:session.projectId,routeVersionId:'route',unitId:'unit',sessionId:session.id,intent:'continue',reason:'原建议',nextRequirement:'继续任务',confidence:'confirmed',basedOnEvidenceIds:['corrected'],derivedStatus:'active',updatedAt:stamp});
  store.put('learningProposals',{id:'proposal',projectId:session.projectId,requestId:'proposal',text:'下一步建议',reason:'原表现',status:'adopted',basisDigest:'',basedOnEvidenceIds:['corrected'],basedOnTeachingVersionIds:[],createdAt:stamp,updatedAt:stamp});
 });
 reconcileDerivedState(store);
 expect(store.get('teachingObservations','corrected')?.status).toBe('active');
 expect(store.get('learningPositions','position')?.derivedStatus).toBe('active');
 const verifier=new VerificationService(store,new CallRunner(store,()=>{throw new Error('No model call is allowed');}));
 const version=verifier.createVersion({projectId:session.projectId,capabilityId:session.capabilityId,activity:session.activity,steps:[],sources:[],origin:'legacy'});
 store.put('corrections',{id:'correction',projectId:session.projectId,teachingVersionId:version.id,evidenceId:'corrected',action:'invalidate',reason:'复核发现原评价不成立',createdAt:stamp});
 const beforeAttempt=store.get('attempts','attempt'),beforeEvidence=store.list('evidence'),beforeBlocks=store.get('understandingDrafts','draft')!.blocks;
 reconcileDerivedState(store);
 expect(store.get('teachingObservations','corrected')).toMatchObject({status:'suspended',progressionEligible:false});
 expect(store.get('teachingObservations','unrelated')).toMatchObject({status:'active',progressionEligible:true});
 expect(store.get('understandingDrafts','draft')).toMatchObject({derivedStatus:'suspended',blocks:beforeBlocks});
 expect(store.get('learningPositions','position')?.derivedStatus).toBe('suspended');
 expect(store.get('learningProposals','proposal')?.status).toBe('stale');
 expect(store.get('sessions',session.id)?.nextStep).toContain('失效');
 expect(store.get('attempts','attempt')).toEqual(beforeAttempt);
 expect(store.list('evidence')).toEqual(beforeEvidence);
 expect(store.get('handwritings',t.original.id)).toEqual(t.original);
 expect(store.get('handwritingTranscriptions',t.transcription.id)).toEqual(t.transcription);
});
