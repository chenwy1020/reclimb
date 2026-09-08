import {it,expect} from 'vitest';
import {LearningStore} from '../src/main/store';
import {readableExport} from '../src/main/readable-export';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('exports saved discussion status and safe review blockers without exposing a hidden solution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reclimb-export-')),store=await LearningStore.open(dir);
 try{
  const snapshot=store.snapshot(),now=new Date().toISOString();
  const activity={id:'task',title:'自编比较任务',instruction:'写下观察',kind:'application' as const,rubric:['说明条件'],sourceIds:[],assessmentBasis:'ai' as const};
  snapshot.projects.push({id:'p',title:'自编材料',goal:'独立判断',status:'active',createdAt:now,updatedAt:now});
  snapshot.sessions.push({id:'s',projectId:'p',capabilityId:'c',activity,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'未提交草稿',helpLevel:0,helpEvents:[],messages:[{id:'i',inputId:'i',role:'user',text:'我认为需要补充条件',kind:'attempt',taskId:'task',teachingVersionId:'v',responseMode:'discussion',responseState:'failed',responseError:'连接中断',createdAt:now}],checkpoint:'已保存',nextStep:'继续讨论'});
  snapshot.taskReviews.push({id:'r',projectId:'p',teachingVersionId:'v',contentHash:'hash',createdAt:now,status:'uncertain',effectiveStatus:'uncertain',reportedStatus:'ready',summary:'题目正确',privateSolution:'SECRET_SOLUTION',issues:[],branches:[],sourceChecks:[],localChecks:[],exposureRelations:[],assessmentFindings:[],reviewerModel:'mock',blockingReasons:[{code:'source_unverified',message:'SECRET_SOLUTION',sourceId:'f',locator:'第13页'}]});
  const text=readableExport(snapshot);
  expect(text).toContain('一起分析，不作能力判断');expect(text).toContain('回应失败');expect(text).toContain('输入编号：i');expect(text).toContain('题目版本：v');expect(text).toContain('系统状态：uncertain；模型原始状态：ready');expect(text).toContain('第13页');expect(text).not.toContain('SECRET_SOLUTION');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
