import type {Activity} from './types';
import type {TeachingStep} from './teaching';

export interface TeachingSource {id:string;locator:string;text:string;warnings:string[];transcriptionIds:string[];}
/** Immutable complete teaching unit. Hash covers activity, steps and frozen sources. */
export interface TeachingVersion {id:string;projectId:string;capabilityId:string;taskId:string;version:number;contentHash:string;activity:Activity;steps:TeachingStep[];sources:TeachingSource[];createdAt:string;origin:'generated'|'legacy'|'correction';replacesVersionId?:string;}
export type VerificationStatus='ready'|'needs_correction'|'uncertain';
export interface VerificationIssue {kind:'conditions'|'calculation'|'rubric'|'missing_input'|'source'|'exposure'|'other';message:string;stepId?:string;}
export interface ConditionBranch {id:string;condition:string;applicability:'applies'|'does_not_apply'|'unknown';criterionIndexes:number[];expectedBehavior:string;}
export interface ExposureRelation {exposureId:string;relation:'same_task'|'different_task'|'uncertain';reason:string;}
export interface SourceCheck {sourceId:string;usesCriticalSymbols:boolean;independentlyEstablished:boolean;reason:string;consistency?:'consistent'|'conflicting'|'uncertain'|'not_used';}
/** These explanations are program-owned. Model prose can contain a private solution. */
export const VERIFICATION_BLOCKER_MESSAGES={
 source_unverified:'本来源的关键内容尚未核实。可以对照原文并确认转录，再采用已确认来源。',
 source_conflict:'核验指出教学内容与这个来源存在冲突，需先核对或修订。',
 source_check_missing:'核验未明确说明这个来源与教学内容是否一致。',
 content_issue:'独立核验发现教学内容或评价标准存在待处理问题。',
 condition_unknown:'部分条件是否适用仍未确定，暂不据此评价。',
 condition_conflict:'同一评价标准的条件适用性相互冲突。',
 calculation_failed:'本机精确计算发现至少一项主张与给定计算输入不一致。',
 calculation_unverified:'部分计算超出本机支持范围或输入无法核对。',
 missing_solution:'独立核验未提供可供评价依据使用的完整解答。',
 review_incomplete:'核验尚未完成。想法和尝试仍可保存在本机。',
 model_uncertain:'模型尚不能确认教学内容可靠，可以先继续探究。',
 content_changed:'教学内容与冻结的核验版本不一致。',
 open_dispute:'这道题的质疑尚未解决，暂不新增能力判断。',
 version_suspended:'这个教学版本已被暂停使用，需先处理对应问题。',
 legacy_criteria:'这个历史版本尚无完整的稳定评价标准，需要建立修订版本。',
} as const;
export type VerificationBlockerCode=keyof typeof VERIFICATION_BLOCKER_MESSAGES;
export interface VerificationBlocker {code:VerificationBlockerCode;message:string;sourceId?:string;locator?:string;stepId?:string;}
export function publicVerificationBlocker(blocker:VerificationBlocker):VerificationBlocker {
 return {code:blocker.code,message:VERIFICATION_BLOCKER_MESSAGES[blocker.code]??VERIFICATION_BLOCKER_MESSAGES.review_incomplete,...(blocker.sourceId?{sourceId:blocker.sourceId}:{}),...(blocker.locator?{locator:blocker.locator}:{}),...(blocker.stepId?{stepId:blocker.stepId}:{})};
}
export interface AssessmentFinding {evidenceId:string;verdict:'uphold'|'invalidate'|'uncertain';reason:string;}
/** privateSolution and expectedBehavior are main-process-only until explicitly requested. */
export interface TaskReview {id:string;projectId:string;teachingVersionId:string;contentHash:string;status:VerificationStatus;reportedStatus?:VerificationStatus;effectiveStatus?:VerificationStatus;blockingReasons?:VerificationBlocker[];reviewKey?:string;reviewPolicyVersion?:string;reviewerEndpoint?:string;summary:string;issues:VerificationIssue[];privateSolution:string;branches:ConditionBranch[];exposureRelations:ExposureRelation[];exposureCoverageComplete?:boolean;sourceChecks?:SourceCheck[];assessmentFindings?:AssessmentFinding[];localChecks:{status:'pass'|'fail'|'unknown';details:string}[];createdAt:string;reviewerModel:string;}
export interface DisputeMessage {id:string;role:'user'|'assistant';text:string;createdAt:string;}
export interface Dispute {id:string;projectId:string;sessionId:string;taskId:string;teachingVersionId:string;contentHash:string;issue:string;status:'open'|'reviewing'|'resolved'|'unresolved';messages:DisputeMessage[];createdAt:string;updatedAt:string;reviewId?:string;replacementVersionId?:string;}
/** Append-only corrections; original attempts and evidence remain immutable. */
export interface CorrectionRecord {id:string;projectId:string;teachingVersionId:string;action:'suspend'|'invalidate'|'restore'|'replace';reason:string;createdAt:string;disputeId?:string;reviewId?:string;evidenceId?:string;replacementVersionId?:string;}
export interface AnswerExposure {id:string;projectId:string;capabilityId:string;sessionId:string;taskId:string;teachingVersionId?:string;kind:'demonstration'|'feedback'|'answer'|'review_solution';text:string;createdAt:string;}
export interface VerificationView {teachingVersionId:string;contentHash:string;status:VerificationStatus|'pending';effectiveStatus:VerificationStatus|'pending';reportedStatus?:VerificationStatus;blockingReasons:VerificationBlocker[];summary:string;canAssess:boolean;reviewId?:string;}
