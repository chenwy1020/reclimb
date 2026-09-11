import type {WorkspaceSnapshot} from '../shared/types';
import {evidenceStanding,reviewStanding} from '../shared/reliability-state';
import {publicVerificationBlocker} from '../shared/reliability';
import {visibleProjects} from '../shared/projects';
export function readableExport(snapshot:WorkspaceSnapshot,projectId?:string):string{
 const body=['# 我的重登学习档案','导出时间：'+new Date().toISOString(),'能力记录描述具体任务表现；AI核验与评价不等于正确性认证或全面掌握。'];
 const available=visibleProjects(snapshot.projects);const projects=projectId?available.filter(p=>p.id===projectId):available;
 if(projectId&&!projects.length)throw new Error('学习项目不存在');
 for(const project of projects){
  body.push('## '+project.title,'项目编号：'+project.id,project.goal,project.routeSummary??'');
  for(const source of snapshot.materials.filter(m=>m.projectId===project.id))body.push('### 材料：'+source.title,'材料编号：'+source.id,'原件：'+source.originalName,source.warnings.join('；'));
  for(const version of snapshot.teachingVersions.filter(v=>v.projectId===project.id)){
   body.push('### 教学版本：'+version.activity.title,'版本编号：'+version.id+'；任务：'+version.taskId+'；内容校验：'+version.contentHash,version.activity.instruction,'评价标准：',...version.activity.rubric.map((r,i)=>'- '+(version.activity.rubricIds?.[i]??String(i+1))+'：'+r));
   for(const step of version.steps)body.push('#### '+step.title,step.content);
   for(const source of version.sources)body.push('来源：'+source.locator+'（'+source.id+'）','转写版本：'+(source.transcriptionIds.join('、')||'原始提取文本'),source.warnings.join('；'));
  }
  for(const session of snapshot.sessions.filter(s=>s.projectId===project.id)){
   body.push('### 学习记录：'+session.activity.title,'会话编号：'+session.id,'继续位置：'+session.checkpoint,'当前草稿：',session.draft);
   for(const message of session.messages){
    body.push(message.createdAt+' | '+message.role+' | '+(message.kind??'对话'),message.text);
    if(message.inputId)body.push('输入编号：'+message.inputId+'；任务：'+(message.taskId??'历史任务')+'；题目版本：'+(message.teachingVersionId??'历史记录未保存'));
    if(message.role==='user'&&message.responseState){
     const states={pending:'待回应',running:'正在回应',completed:'已回应',failed:'回应失败'};
     body.push('已保存在本机；'+states[message.responseState]+'；'+(message.responseMode==='assessment'?'可请求正式反馈':'一起分析，不作能力判断'));
     if(message.responseError)body.push('回应情况：'+message.responseError);
    }
   }
   for(const attempt of snapshot.attempts.filter(a=>a.sessionId===session.id))body.push('#### 作答 '+attempt.id,attempt.submittedAt+'；任务：'+(attempt.taskId??'旧任务')+'；提交时帮助：'+attempt.helpLevel,attempt.text);
  }
  for(const review of snapshot.taskReviews.filter(r=>r.projectId===project.id)){
   body.push('### 题目核验 '+review.id,'题目版本：'+review.teachingVersionId+'；系统状态：'+(review.effectiveStatus??review.status)+'；模型原始状态：'+(review.reportedStatus??'历史记录未保存，未知'));
   for(const reason of review.blockingReasons??[])body.push('- '+publicVerificationBlocker(reason).message+(reason.locator?'（'+reason.locator+'）':''));
  }
  for(const e of snapshot.evidence.filter(e=>e.projectId===project.id)){const state=evidenceStanding(snapshot,e);body.push('### 能力表现 '+e.id,e.createdAt+' | 原标签：'+e.status+' | 帮助：'+e.helpLevel+' | 作答：'+e.attemptId,'当前是否采用：'+(state.effective?'是':'否；'+state.reason),e.assessment.feedback,...e.assessment.criteria.map(c=>'- '+(c.criterionId??c.criterion)+'：'+c.result+'；'+c.reason),'限制：'+e.assessment.limitations.join('；'));}
  for(const d of snapshot.disputes.filter(d=>d.projectId===project.id))body.push('### 核对议题 '+d.id,'状态：'+d.status+'；原版本：'+d.teachingVersionId+(d.replacementVersionId?'；修订版本：'+d.replacementVersionId:''),...d.messages.map(m=>m.createdAt+' | '+m.role+'\n\n'+m.text));
  for(const c of snapshot.corrections.filter(c=>c.projectId===project.id))body.push('纠正记录 '+c.id+'：'+c.action+'；版本：'+c.teachingVersionId+(c.evidenceId?'；评价：'+c.evidenceId:''),c.createdAt+' '+c.reason);
  for(const exposure of snapshot.answerExposures.filter(e=>e.projectId===project.id))body.push('帮助与答案暴露 '+exposure.id+'：'+exposure.kind+'；任务：'+exposure.taskId,exposure.createdAt,exposure.text);
  for(const r of snapshot.reviews.filter(r=>r.projectId===project.id)){const state=reviewStanding(snapshot,r);body.push('回访 '+r.id+'：'+r.kind+'；计划：'+r.dueAt+'；'+(state.effective?r.status:'暂停：'+state.reason));}
 }
 return body.filter(Boolean).join('\n\n');
}
