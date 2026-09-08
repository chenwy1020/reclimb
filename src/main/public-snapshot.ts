import type { WorkspaceSnapshot } from '../shared/types';
/** Hidden model reference answers never cross the isolated renderer boundary. */
export function publicSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const copy=structuredClone(snapshot);
  function visit(value:unknown):void {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const object=value as Record<string,unknown>;delete object.referenceAnswer;
    for(const child of Object.values(object))visit(child);
  }
  visit(copy);
  copy.taskReviews=copy.taskReviews.map(review=>({...review,summary:review.status==='ready'?'已完成独立核验；这不是正确性认证。':review.status==='needs_correction'?'核验发现需要修正的内容，暂不评价能力。':'核验尚不能确定，可以共同探究。',privateSolution:'',issues:[],branches:[],exposureRelations:[],assessmentFindings:[],sourceChecks:[],localChecks:review.localChecks.map(check=>({status:check.status,details:''}))}));
  copy.answerExposures=copy.answerExposures.map(exposure=>({...exposure,text:''}));
  return copy;
}
