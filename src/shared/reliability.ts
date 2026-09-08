import type {Activity} from './types';
import type {TeachingStep} from './teaching';

export interface TeachingSource {id:string;locator:string;text:string;warnings:string[];transcriptionIds:string[];}
/** Immutable complete teaching unit. Hash covers activity, steps and frozen sources. */
export interface TeachingVersion {id:string;projectId:string;capabilityId:string;taskId:string;version:number;contentHash:string;activity:Activity;steps:TeachingStep[];sources:TeachingSource[];createdAt:string;origin:'generated'|'legacy'|'correction';replacesVersionId?:string;}
export type VerificationStatus='ready'|'needs_correction'|'uncertain';
export interface VerificationIssue {kind:'conditions'|'calculation'|'rubric'|'missing_input'|'source'|'exposure'|'other';message:string;stepId?:string;}
export interface ConditionBranch {id:string;condition:string;applicability:'applies'|'does_not_apply'|'unknown';criterionIndexes:number[];expectedBehavior:string;}
export interface ExposureRelation {exposureId:string;relation:'same_task'|'different_task'|'uncertain';reason:string;}
export interface SourceCheck {sourceId:string;usesCriticalSymbols:boolean;independentlyEstablished:boolean;reason:string;}
export interface AssessmentFinding {evidenceId:string;verdict:'uphold'|'invalidate'|'uncertain';reason:string;}
/** privateSolution and expectedBehavior are main-process-only until explicitly requested. */
export interface TaskReview {id:string;projectId:string;teachingVersionId:string;contentHash:string;status:VerificationStatus;summary:string;issues:VerificationIssue[];privateSolution:string;branches:ConditionBranch[];exposureRelations:ExposureRelation[];exposureCoverageComplete?:boolean;sourceChecks?:SourceCheck[];assessmentFindings?:AssessmentFinding[];localChecks:{status:'pass'|'fail'|'unknown';details:string}[];createdAt:string;reviewerModel:string;}
export interface DisputeMessage {id:string;role:'user'|'assistant';text:string;createdAt:string;}
export interface Dispute {id:string;projectId:string;sessionId:string;taskId:string;teachingVersionId:string;contentHash:string;issue:string;status:'open'|'reviewing'|'resolved'|'unresolved';messages:DisputeMessage[];createdAt:string;updatedAt:string;reviewId?:string;replacementVersionId?:string;}
/** Append-only corrections; original attempts and evidence remain immutable. */
export interface CorrectionRecord {id:string;projectId:string;teachingVersionId:string;action:'suspend'|'invalidate'|'restore'|'replace';reason:string;createdAt:string;disputeId?:string;reviewId?:string;evidenceId?:string;replacementVersionId?:string;}
export interface AnswerExposure {id:string;projectId:string;capabilityId:string;sessionId:string;taskId:string;teachingVersionId?:string;kind:'demonstration'|'feedback'|'answer'|'review_solution';text:string;createdAt:string;}
export interface VerificationView {teachingVersionId:string;contentHash:string;status:VerificationStatus|'pending';summary:string;canAssess:boolean;reviewId?:string;}
