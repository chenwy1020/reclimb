import type { WorkspaceSnapshot } from '../shared/types';
import {publicVerificationBlocker} from '../shared/reliability';
/** Hidden model reference answers never cross the isolated renderer boundary. */
export function publicSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const copy=structuredClone(snapshot);
  // Ink is fetched explicitly for its session, never copied into routine UI snapshots.
  copy.handwritingTargets=[];copy.handwritings=[];copy.handwritingTranscriptions=[];
  for(const session of copy.sessions??[])delete session.handwritingDrafts;
  function visit(value:unknown):void {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const object=value as Record<string,unknown>;delete object.referenceAnswer;
    for(const child of Object.values(object))visit(child);
  }
  visit(copy);
  copy.operations=copy.operations?.map(({result:_result,binding:_binding,...operation})=>({...operation,binding:{}}));
  copy.validationTasks=copy.validationTasks?.map(task=>({...task,prompt:'',referenceAnswer:'',review:{...task.review,basis:''}}));
  copy.taskReviews=copy.taskReviews.map(review=>({...review,...(review.blockingReasons?{blockingReasons:review.blockingReasons.map(publicVerificationBlocker)}:{}),summary:review.status==='ready'?'已完成独立核验；这不是正确性认证。':review.status==='needs_correction'?'核验发现需要修正的内容，暂不评价能力。':'核验尚不能确定，可以共同探究。',privateSolution:'',issues:[],branches:[],exposureRelations:[],assessmentFindings:[],sourceChecks:[],localChecks:review.localChecks.map(check=>({status:check.status,details:''}))}));
  copy.answerExposures=copy.answerExposures.map(exposure=>({...exposure,text:''}));
  return copy;
}
