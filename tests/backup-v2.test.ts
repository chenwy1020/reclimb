import {it,expect} from 'vitest';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';import {writeBackup,readBackup,prepareRestore} from '../src/main/backup';
it('round-trips teaching position, task support, source transcription versions and provider publication status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-v2-backup-'));const store=await LearningStore.open(join(dir,'one'));
 try{
  const now=new Date().toISOString(),materialPath=join(store.dataDirectory,'materials','m','source.txt');mkdirSync(join(store.dataDirectory,'materials','m'),{recursive:true});writeFileSync(materialPath,'original');
  store.put('projects',{id:'p',title:'项目',goal:'长期目标',status:'active',createdAt:now,updatedAt:now,startingPoint:{familiarity:'new',background:'未知',updatedAt:now},nearSteps:[{id:'n',capabilityId:'c',title:'比较',objective:'比较两个解释',reason:'找起点',sourceIds:['f']}]});
  store.put('capabilities',{id:'c',projectId:'p',title:'解释',description:'判断条件',sourceIds:['f'],prerequisites:[],order:0});
  store.put('materials',{id:'m',projectId:'p',title:'原件',kind:'txt',originalName:'source.txt',storedPath:materialPath,importedAt:now,warnings:[],fragmentCount:1,summary:'original'});
  store.put('fragments',{id:'f',projectId:'p',materialId:'m',locator:'第1页',ordinal:0,text:'raw',searchableText:'clean',pageNumber:1,quality:{kind:'ocr-text',needsVerification:true,reasons:['OCR']}});
  const activity={id:'task',title:'比较',instruction:'给出一个区别',kind:'argument' as const,rubric:['具体区别'],sourceIds:['f'],assessmentBasis:'source' as const};
  const step={id:'step',taskId:'task',action:'attempt' as const,title:'比较',content:'现在试一次',sourceIds:['f'],activity,createdAt:now};
  store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',activity,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'我的解释',taskDrafts:{task:'我的解释'},helpLevel:1,helpEvents:[{id:'h',kind:'hint',level:1,createdAt:now,taskId:'task',scope:'current_task'}],messages:[],checkpoint:'这里',nextStep:'继续',teaching:{version:1,current:step,upcoming:[],history:[],guidance:'supported',confusionCount:1}});
  store.put('sourceTranscriptions',{id:'tr',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'核对后公式',status:'confirmed',createdAt:now,confirmedAt:now,uncertainties:[]});
  store.put('usage',{id:'u',requestId:'u',operationId:'op',createdAt:now,kind:'教学',model:'custom',status:'completed',inputTokens:1,outputTokens:2,estimatedCny:.01,validationStatus:'valid',publicationStatus:'published',finishReason:'stop'});
  const file=join(dir,'copy.reclimb');writeBackup(store,file);const records=readBackup(file).records;
  expect(records.projects[0].startingPoint?.familiarity).toBe('new');expect(records.sessions[0].teaching?.current.id).toBe('step');expect(records.sessions[0].helpEvents[0].taskId).toBe('task');expect(records.fragments[0].searchableText).toBe('clean');expect(records.sourceTranscriptions).toHaveLength(1);expect(records.usage[0].publicationStatus).toBe('published');
  await prepareRestore(file,join(dir,'two'));const restored=await LearningStore.open(join(dir,'two'));try{expect(restored.get('sessions','s')?.taskDrafts?.task).toBe('我的解释');expect(restored.list('sourceTranscriptions')[0].fragmentId).toBe('f');}finally{restored.close();}
  const active=store.get('sessions','s')!;store.put('sessions',{...active,id:'origin',teaching:undefined});
  const assessment={outcome:'met' as const,feedback:'具体表现',criteria:[{criterion:'具体区别',result:'met' as const,reason:'提出区别'}],limitations:[],sourceIds:['f']};
  store.put('attempts',{id:'a',projectId:'p',sessionId:'s',text:'已比较',submittedAt:now,helpLevel:0,requestId:'a',activitySnapshot:activity,taskId:'task',assessment,mode:'transfer',reviewId:'r'});
  store.put('evidence',{id:'ev',projectId:'p',capabilityId:'c',sessionId:'s',attemptId:'a',status:'transfer',helpLevel:0,assessment,createdAt:now,activitySnapshot:activity,taskId:'task',reviewId:'r'});
  store.put('reviews',{id:'r',projectId:'p',capabilityId:'c',fromSessionId:'origin',fromActivity:activity,fromTaskId:'task',kind:'transfer',dueAt:now,status:'done',completedSessionId:'s',completedEvidenceId:'ev',completedTaskId:'task'});
  store.put('sessions',{...active,mode:'practice',activity:{...activity,id:'next-task',instruction:'后续另一题'}});
  writeBackup(store,file);expect(readBackup(file).records.reviews[0].completedEvidenceId).toBe('ev');
  const validReview=store.get('reviews','r')!;
  store.put('reviews',{...validReview,id:'other-review',status:'pending',completedSessionId:undefined,completedEvidenceId:undefined,completedTaskId:undefined});
  store.put('attempts',{...store.get('attempts','a')!,reviewId:'other-review'});
  expect(()=>writeBackup(store,join(dir,'mismatched.reclimb'))).toThrow('回访');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
