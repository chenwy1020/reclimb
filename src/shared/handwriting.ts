import {z} from 'zod';
const id=z.string().min(1).max(120);
export const inkPointSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),pressure:z.number().min(0).max(1)}).strict();
export const inkStrokeSchema=z.object({id,color:z.enum(['#253e31','#245b96','#a33e36']),width:z.number().min(0.5).max(12),points:z.array(inkPointSchema).min(1).max(12000)}).strict();
export const inkPageSchema=z.object({id,width:z.literal(768),height:z.literal(1024),strokes:z.array(inkStrokeSchema).max(1500)}).strict();
export const inkPagesSchema=z.array(inkPageSchema).min(1).max(12).superRefine((pages,ctx)=>{let count=0;const ids=new Set<string>();for(const page of pages){if(ids.has(page.id))ctx.addIssue({code:'custom',message:'页面编号重复'});ids.add(page.id);const strokes=new Set<string>();for(const stroke of page.strokes){if(strokes.has(stroke.id))ctx.addIssue({code:'custom',message:'笔画编号重复'});strokes.add(stroke.id);count+=stroke.points.length;}}if(count>120000)ctx.addIssue({code:'custom',message:'这次笔迹较多，请分次提交'});});
export const handwritingTargetSchema=z.object({id,projectId:id,projectTitle:z.string().max(200),sessionId:id,taskId:id,stepId:id.optional(),teachingVersionId:id.optional(),title:z.string().max(1000),instruction:z.string().max(100000),sourceIds:z.array(id).max(100),sourceVersions:z.array(z.object({fragmentId:id,transcriptionIds:z.array(id)})).optional(),helpLevel:z.number().int().min(0).max(4),mode:z.enum(['practice','delayed','transfer','diagnosis','selection']),createdAt:z.string().datetime()}).strict();
export const handwritingSubmitSchema=z.object({requestId:id,targetId:id,pages:inkPagesSchema,note:z.string().max(10000).default('')}).strict();
export const handwritingSubmissionSchema=z.object({id,projectId:id,sessionId:id,targetId:id,requestId:id,contentHash:z.string().regex(/^[a-f0-9]{64}$/),submittedAt:z.string().datetime(),helpLevel:z.number().int().min(0).max(4),pages:inkPagesSchema,note:z.string().max(10000),author:z.literal('learner'),status:z.literal('saved_unassessed')}).strict();
export type InkPoint=z.infer<typeof inkPointSchema>;
export type InkStroke=z.infer<typeof inkStrokeSchema>;
export type InkPage=z.infer<typeof inkPageSchema>;
export type HandwritingTarget=z.infer<typeof handwritingTargetSchema>;
export type HandwritingSubmission=z.infer<typeof handwritingSubmissionSchema>;
export type HandwritingSubmit=z.infer<typeof handwritingSubmitSchema>;
export interface HandwritingReceipt {id:string;requestId:string;targetId:string;savedAt:string;status:'saved_unassessed';}
export interface HandwritingServerStatus {running:boolean;urls:string[];pairingExpiresAt?:string;pending?:{id:string;name:string;code:string};connected?:{id:string;name:string};target?:HandwritingTarget;error?:string;}
export interface HandwritingClientState {workspaceId:string;target:HandwritingTarget|null;}

