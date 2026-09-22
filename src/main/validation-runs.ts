import type {ValidationRun} from '../shared/remediation';
import {LearningStore} from './store';

/**
 * Freeze a validation run to its first submitted attempt and, when available,
 * attach the evidence derived from that exact attempt. Safe to call again so
 * legacy IPC completion can remain as a fallback without rebinding the run.
 */
export function completeValidationRun(store:LearningStore,sessionId:string):ValidationRun|undefined {
 const run=store.list('validationRuns').find(item=>item.sessionId===sessionId);
 if(!run)return;
 const attempt=run.attemptId
  ? store.get('attempts',run.attemptId)
  : store.list('attempts',run.projectId).find(item=>item.sessionId===sessionId);
 if(!attempt||attempt.projectId!==run.projectId||attempt.sessionId!==sessionId)return;
 const evidence=store.list('evidence',run.projectId).find(item=>item.attemptId===attempt.id);
 const completed:ValidationRun={...run,status:'completed',attemptId:attempt.id,evidenceId:evidence?.id,completedAt:attempt.submittedAt,elapsedSeconds:Math.max(0,(Date.parse(attempt.submittedAt)-Date.parse(run.startedAt))/1000)};
 store.put('validationRuns',completed);
 return completed;
}
