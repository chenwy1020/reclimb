import {z} from 'zod';
import {assessmentSchemaFor,helpSchemaFor} from './schemas';
import {mathCheckRequestsSchema} from './math-checks';
const text=z.string().max(16000),id=z.string().min(1).max(120);
export const verificationIssueSchema=z.object({kind:z.enum(['conditions','calculation','rubric','missing_input','source','exposure','other']),message:text.min(1),stepId:id.optional()});
export const conditionBranchSchema=z.object({id,condition:text,applicability:z.enum(['applies','does_not_apply','unknown']),criterionIndexes:z.array(z.number().int().min(0).max(11)).max(12),expectedBehavior:text});
export const exposureRelationSchema=z.object({exposureId:id,relation:z.enum(['same_task','different_task','uncertain']),reason:text});
export const taskReviewResponseSchema=z.object({status:z.enum(['ready','needs_correction','uncertain']),summary:text.min(1),issues:z.array(verificationIssueSchema).max(30),privateSolution:text,branches:z.array(conditionBranchSchema).max(20),exposureRelations:z.array(exposureRelationSchema).max(100),sourceChecks:z.array(z.object({sourceId:id,usesCriticalSymbols:z.boolean(),independentlyEstablished:z.boolean(),reason:text.min(1)})).max(60).default([]),assessmentFindings:z.array(z.object({evidenceId:id,verdict:z.enum(['uphold','invalidate','uncertain']),reason:text})).max(100).default([]),mathChecks:mathCheckRequestsSchema.default([])});
export const disputeSignalSchema=z.object({dispute:z.object({issue:text.min(1),reason:text})});
export function reviewedAssessmentValueSchema(sourceIds:string[],criterionIds:string[]){
 return assessmentSchemaFor(sourceIds).extend({criteria:z.array(z.object({criterion:z.string().max(2000),criterionId:criterionIds.length?z.enum(criterionIds as [string,...string[]]):id.optional(),result:z.enum(['met','partial','not_yet','uncertain','not_applicable']),reason:text})).min(1).max(12)});
}
function responseObject<T extends z.ZodRawShape>(primary:z.ZodObject<T>){
 // Object-root grammar works across providers; runtime checks keep the alternatives exclusive.
 return primary.partial().extend({dispute:disputeSignalSchema.shape.dispute.optional()}).superRefine((value,context)=>{
  if((value as Record<string,unknown>).dispute){if(Object.keys(primary.shape).some(key=>(value as Record<string,unknown>)[key]!==undefined))context.addIssue({code:'custom',message:'质疑必须单独返回，不能同时评价或给出帮助。'});return;}
  const parsed=primary.safeParse(value);if(!parsed.success)for(const issue of parsed.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message});
 });
}
export function reviewedAssessmentSchema(sourceIds:string[],criterionIds:string[]){return responseObject(reviewedAssessmentValueSchema(sourceIds,criterionIds));}
export function reviewedHelpSchema(sourceIds:string[]){const help=helpSchemaFor(sourceIds);return responseObject(help.extend({sourceIds:help.shape.sourceIds.unwrap().optional()}));}

/** Generation-only IDs; stored reviews keep the backward-compatible persistent shape. */
export function taskReviewSchemaFor(allowed:{stepIds:string[];sourceIds:string[];exposureIds:string[];evidenceIds:string[]}){
 const exact=(values:string[])=>z.enum([...new Set(values)] as [string,...string[]]);
 const sourceCheck=z.object({sourceId:allowed.sourceIds.length?exact(allowed.sourceIds):id,usesCriticalSymbols:z.boolean(),independentlyEstablished:z.boolean(),reason:text.min(1)});
 const finding=z.object({evidenceId:allowed.evidenceIds.length?exact(allowed.evidenceIds):id,verdict:z.enum(['uphold','invalidate','uncertain']),reason:text});
 return taskReviewResponseSchema.extend({
  issues:z.array(verificationIssueSchema.extend({stepId:allowed.stepIds.length?exact(allowed.stepIds).optional():z.never().optional()})).max(30),
  sourceChecks:z.array(sourceCheck).max(allowed.sourceIds.length?60:0).default([]),
  exposureRelations:z.array(exposureRelationSchema.extend({exposureId:allowed.exposureIds.length?exact(allowed.exposureIds):id})).max(allowed.exposureIds.length?100:0),
  assessmentFindings:z.array(finding).max(allowed.evidenceIds.length?100:0).default([]),
 });
}
