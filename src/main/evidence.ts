import { randomUUID } from 'node:crypto';
import type { Activity, Assessment, Evidence, EvidenceStatus, Review, Session } from '../shared/types';
import type { LearningStore } from './store';
import {evidenceStanding,reviewStanding,versionStanding,derivesFromDispute} from '../shared/reliability-state';
import {teachingContentHash} from './verification-service';
const DAY = 24 * 60 * 60 * 1000;
const normalize = (text: string) => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]+/gu, '').toLocaleLowerCase();
function timestamp(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label}时间无效。`);
  return time;
}
function checkSources(store: LearningStore, sourceIds: string[], projectId: string): void {
  for (const id of sourceIds) {
    const source = store.get('fragments', id);
    if (!source || source.projectId !== projectId) throw new Error('评估引用的材料片段不存在或不属于当前学习项目。');
    const material = store.get('materials', source.materialId);
    if (!material || material.projectId !== projectId) throw new Error('评估引用的原始材料不属于当前学习项目。');
  }
}
function latestRecordedExposure(store: LearningStore, session: Session, submittedAt: number, baseline: number, currentTaskId?: string): number {
  let latest = baseline;
  const include = (value: string) => {
    const time = timestamp(value, '学习记录');
    // A later answer view must not change attribution of an already submitted test.
    if (time <= submittedAt) latest = Math.max(latest, time);
  };
  const related = store.list('sessions', session.projectId).filter(item => item.capabilityId === session.capabilityId);
  const sessionIds = new Set(related.map(item => item.id));
  const otherTask = (sessionId:string,task?:string) => sessionId !== session.id || !!(currentTaskId && task && task !== currentTaskId);
  for (const item of related) {
    for (const help of item.helpEvents) if(otherTask(item.id,help.taskId)&&help.scope!=='navigation') include(help.createdAt);
    for (const message of item.messages) {
      if (otherTask(item.id,message.taskId)&&message.scope!=='navigation'&&(message.role === 'assistant' || message.kind === 'attempt')) include(message.createdAt);
    }
    // Reading persisted teaching explanations is recorded when they become current/history.
    for(const step of [...(item.teaching?.history??[]),...(item.teaching?[item.teaching.current]:[])]) {
      if(otherTask(item.id,step.taskId)&&(step.action==='explain'||step.action==='demonstrate'||step.action==='feedback')) include(step.createdAt);
    }
  }
  for (const attempt of store.list('attempts', session.projectId)) {
    if (sessionIds.has(attempt.sessionId)&&otherTask(attempt.sessionId,attempt.taskId)) include(attempt.submittedAt);
  }
  for (const evidence of store.list('evidence', session.projectId)) {
    if (evidence.capabilityId === session.capabilityId && sessionIds.has(evidence.sessionId)&&otherTask(evidence.sessionId,evidence.taskId)) include(evidence.createdAt);
  }
  return latest;
}
function successful(activity: Activity, assessment: Assessment): boolean {
  if(activity.rubricIds){const applicable=assessment.criteria.filter(c=>c.result!=='not_applicable');return assessment.outcome==='met'&&applicable.length>0&&assessment.criteria.length===activity.rubricIds.length&&new Set(assessment.criteria.map(c=>c.criterionId)).size===activity.rubricIds.length&&activity.rubricIds.every(id=>assessment.criteria.some(c=>c.criterionId===id))&&applicable.every(c=>c.result==='met');}
  const required = activity.rubric.map(normalize).filter(Boolean);
  const criteria = assessment.criteria.filter(item => normalize(item.criterion));
  return assessment.outcome === 'met' && required.length > 0 && criteria.length > 0
    && criteria.every(item => item.result === 'met')
    && required.every(criterion => criteria.some(item => normalize(item.criterion) === criterion && item.result === 'met'));
}

/** Save a preliminary AI evaluation without turning assisted work into independent ability. */
export function finishAssessment(store: LearningStore, attemptId: string, assessment: Assessment, now = new Date().toISOString()): Evidence {
  return store.transaction(() => {
    const existing = store.list('evidence').find(evidence => evidence.attemptId === attemptId);
    if (existing) return existing;
    const attempt = store.get('attempts', attemptId);
    if (!attempt) throw new Error('找不到这次提交。');
    const session = store.get('sessions', attempt.sessionId);
    if (!session || session.projectId !== attempt.projectId) throw new Error('提交与学习会话不属于同一项目。');
    const project = store.get('projects', attempt.projectId);
    const capability = store.get('capabilities', session.capabilityId);
    if (!project || !capability || capability.projectId !== attempt.projectId) throw new Error('会话与学习能力不属于同一项目。');
    if (!Number.isFinite(attempt.helpLevel) || attempt.helpLevel < 0) throw new Error('提交时的帮助等级无效。');
    const activity=attempt.activitySnapshot??session.activity;
    const taskId=attempt.taskId??activity.id;const mode=attempt.mode??session.mode;const reviewId=attempt.mode!==undefined?attempt.reviewId:session.dueReviewId;
    const snapshot=store.snapshot(),versionId=attempt.teachingVersionId??activity.teachingVersionId;
    let exposureUncertain=false;
    if(versionId){
      const version=store.get('teachingVersions',versionId),standing=versionStanding(snapshot,versionId);
      if(!version||!standing.effective)throw new Error('已保存作答；'+(standing.reason??'本题尚待核验')+'，暂停能力评价。');
      if(version.projectId!==attempt.projectId||version.capabilityId!==session.capabilityId||version.taskId!==taskId||teachingContentHash(version)!==version.contentHash||JSON.stringify(version.activity)!==JSON.stringify(activity))throw new Error('当前作答与已核验内容不一致，暂停能力评价。');
      const review=snapshot.taskReviews.filter(r=>r.teachingVersionId===versionId).at(-1)!;
      const ids=activity.rubricIds??[];
      if(ids.length!==activity.rubric.length||assessment.criteria.length!==ids.length||new Set(assessment.criteria.map(c=>c.criterionId)).size!==ids.length||ids.some(id=>!assessment.criteria.some(c=>c.criterionId===id)))throw new Error('评价标准编号缺失或重复，当前结果尚未保存为能力记录。');
      if(review.branches.some(b=>b.applicability==='unknown'))throw new Error('题目的条件分支尚未确定，暂停能力评价。');
      for(const [index,id] of ids.entries()){
        const criterion=assessment.criteria.find(c=>c.criterionId===id)!;
        const branches=review.branches.filter(b=>b.criterionIndexes.includes(index));
        const inapplicable=branches.length>0&&branches.every(b=>b.applicability==='does_not_apply');
        if((criterion.result==='not_applicable')!==inapplicable)throw new Error('评价与已核对的适用条件不一致，暂停能力评价。');
        criterion.criterion=activity.rubric[index];
      }
      if(assessment.criteria.every(c=>c.result==='not_applicable'))throw new Error('本次所有标准均不适用，已保留作答，不产生能力判断。');
      const exposures=snapshot.answerExposures.filter(e=>e.projectId===attempt.projectId&&e.capabilityId===session.capabilityId&&Date.parse(e.createdAt)<=Date.parse(attempt.submittedAt));
      for(const exposure of exposures){
        if(exposure.kind==='demonstration'&&exposure.teachingVersionId===version.id&&version.steps.some(step=>(step.action==='explain'||step.action==='demonstrate')&&step.content===exposure.text))continue;
        const relation=review.exposureRelations.find(r=>r.exposureId===exposure.id);
        const same=relation?.relation==='same_task'||(!relation&&exposure.taskId===taskId&&exposure.kind!=='demonstration');
        if(same&&attempt.helpLevel===0)throw new Error('当前题已有答案或相关帮助暴露，不能作为无帮助的独立完成。作答已保留。');
        if(!same&&(!relation||relation.relation==='uncertain'))exposureUncertain=true;
      }
    }else if(taskId){
      const legacy=snapshot.teachingVersions.filter(v=>v.projectId===attempt.projectId&&v.taskId===taskId).at(-1);
      if(legacy&&!versionStanding(snapshot,legacy.id).effective)throw new Error('这道旧题已有待核对或失效记录，暂停能力评价。');
    }
    if(attempt.taskId&&activity.id&&attempt.taskId!==activity.id)throw new Error('提交的任务与活动快照不一致。');
    checkSources(store, [...capability.sourceIds, ...activity.sourceIds, ...assessment.sourceIds], attempt.projectId);
    for(const version of activity.sourceVersions??[]){
      if(!activity.sourceIds.includes(version.fragmentId))throw new Error('任务引用的核对版本不属于本次材料片段。');
      for(const id of version.transcriptionIds){const transcription=store.get('sourceTranscriptions',id);const fragment=store.get('fragments',version.fragmentId);if(!transcription||transcription.projectId!==attempt.projectId||transcription.fragmentId!==version.fragmentId||transcription.materialId!==fragment?.materialId||transcription.status!=='confirmed')throw new Error('任务引用的核对版本不存在或关联异常。');}
    }
    const evaluatedAt = timestamp(now, '评估');
    const submittedAt = timestamp(attempt.submittedAt, '提交');
    const sessionCreatedAt = timestamp(session.createdAt, '会话');
    if (submittedAt < sessionCreatedAt || submittedAt > evaluatedAt) throw new Error('提交时间必须在会话开始之后且不能晚于评估时间。');
    const reviewed: Assessment = JSON.parse(JSON.stringify(assessment)) as Assessment;
    const met = successful(activity, reviewed);
    if(exposureUncertain)reviewed.limitations.push('与部分已见内容的关系尚未确定，本次可以获得反馈，但不能据此确认独立完成。');
    if (reviewed.outcome === 'met' && !met) reviewed.limitations.push('评分标准尚未逐项得到明确满足，暂不能据此认定独立掌握。');
    let status: EvidenceStatus = met ? attempt.helpLevel > 0 ? 'assisted' : exposureUncertain?'needs_review':'independent' : 'needs_review';
    if(status==='independent'&&versionId&&derivesFromDispute(snapshot,versionId)){status='needs_review';reviewed.limitations.push('这是质疑后修订的练习，保留反馈，不作为未受帮助的新题独立表现；可以另开独立任务再验证。');}
    let linked: Review | undefined;
    let validReturn = false;
    if (reviewId) {
      linked = store.get('reviews', reviewId);
      if (!linked || linked.projectId !== session.projectId || linked.capabilityId !== session.capabilityId) throw new Error('回访记录不属于当前项目和能力。');
      if(!reviewStanding(snapshot,linked).effective)throw new Error('这次回访的原始依据已暂停或失效，当前作答已保留。');
      const origin = store.get('sessions', linked.fromSessionId);
      if (!origin || origin.projectId !== session.projectId || origin.capabilityId !== session.capabilityId) throw new Error('回访来源会话不属于当前项目和能力。');
      const originCreatedAt = timestamp(origin.createdAt, '原会话');
      const originEvidence = store.list('evidence', session.projectId).filter(item => item.sessionId === origin.id);
      const originTime = Math.max(originCreatedAt, ...originEvidence.map(item => timestamp(item.createdAt, '原评估')).filter(time => time <= submittedAt));
      const lastExposure = linked.kind === 'delayed' ? latestRecordedExposure(store, session, submittedAt, originTime,taskId) : originTime;
      const sameSession = origin.id === session.id;
      if (sameSession) reviewed.limitations.push('当前提交与原练习属于同一次会话，不能作为延迟或迁移回访。');
      else if (linked.status !== 'pending') reviewed.limitations.push('该回访目前不是待完成状态，当前结果只记录本次练习。');
      else if (mode !== linked.kind) reviewed.limitations.push('当前练习模式与所关联的回访类型不一致。');
      else if (submittedAt < originTime || evaluatedAt < submittedAt) reviewed.limitations.push('回访时间关系无效，不能认定为延迟或迁移表现。');
      else if (linked.kind === 'delayed' && submittedAt - lastExposure < DAY) reviewed.limitations.push('距离这项能力最近一次已记录的学习支持或作答尚未满 24 小时，本次不能作为延迟重构证据。');
      else if (linked.kind === 'transfer' && normalize(activity.instruction) === normalize((linked.fromActivity??origin.activity).instruction)) reviewed.limitations.push('本次任务与原题相同，尚不能证明在新情境中的迁移。');
      else if (linked.kind === 'transfer' && (!activity.transferCheck||activity.transferCheck.verdict!=='valid'||![activity.transferCheck.changedSituation,activity.transferCheck.sharedPrinciple,activity.transferCheck.requiredAdaptation].every(value=>value.trim()))) reviewed.limitations.push('尚无充分的情境变化与方法适配核对，本次仅作为普通练习，不能认定迁移。');
      else validReturn = true;
    } else if (mode === 'delayed' || mode === 'transfer') {
      reviewed.limitations.push('本次没有关联待完成的回访记录，只记录普通练习表现。');
    }
    if (status === 'independent' && validReturn && linked) status = linked.kind;
    const evidence: Evidence = { id: randomUUID(), projectId: attempt.projectId, capabilityId: capability.id, sessionId: session.id, attemptId, status, helpLevel: attempt.helpLevel, assessment: reviewed, createdAt: new Date(evaluatedAt).toISOString(),activitySnapshot:JSON.parse(JSON.stringify(activity)),...(taskId?{taskId}:{}),...(attempt.stepId?{stepId:attempt.stepId}:{}),...(linked?{reviewId:linked.id}:{}) };
    if(versionId)evidence.teachingVersionId=versionId;
    store.put('attempts', { ...attempt, assessment: reviewed,activitySnapshot:evidence.activitySnapshot,...(taskId?{taskId}:{}),...(versionId?{teachingVersionId:versionId}:{}) });
    store.put('evidence', evidence);
    // Feedback is support for any later revision, never for the answer already submitted.
    store.put('sessions', {
      ...session, helpLevel: !taskId||taskId===(session.teaching?.current.taskId??session.activity.id)?Math.max(session.helpLevel, 1):session.helpLevel, updatedAt: evidence.createdAt,
      helpEvents: [...session.helpEvents, { id: `assessment-feedback-${attemptId}`, kind: 'hint', level: 1, createdAt: evidence.createdAt,scope:'current_task',...(taskId?{taskId}:{}) }],
    });
    if ((status === 'delayed' || status === 'transfer') && linked) store.put('reviews', { ...linked, status: 'done', completedSessionId: session.id,completedEvidenceId:evidence.id,...(taskId?{completedTaskId:taskId}:{}) });
    // One optional pair per capability. Returns never recursively produce more returns.
    const hasPriorSuccess = store.list('evidence', attempt.projectId).some(item => item.id !== evidence.id && item.capabilityId === capability.id && item.status !== 'needs_review'&&evidenceStanding(snapshot,item).effective);
    const hasReviews = store.list('reviews', attempt.projectId).some(item => item.capabilityId === capability.id&&reviewStanding(snapshot,item).effective);
    if (met && status!=='needs_review' && !hasPriorSuccess && !hasReviews && !reviewId && mode !== 'delayed' && mode !== 'transfer') {
      for (const kind of ['delayed', 'transfer'] as const) store.put('reviews', { id: randomUUID(), projectId: attempt.projectId, capabilityId: capability.id, fromSessionId: session.id, kind, dueAt: new Date(evaluatedAt + (kind === 'delayed' ? DAY : 7 * DAY)).toISOString(), status: 'pending',fromActivity:JSON.parse(JSON.stringify(activity)),...(taskId?{fromTaskId:taskId}:{}) });
    }
    return evidence;
  });
}


