import {z} from 'zod';
import {rasterImageSchema,MAX_IMAGES_BYTES} from './raster-image';
const id=z.string().min(1).max(120);
export const inkPointSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),pressure:z.number().min(0).max(1)}).strict();
export const inkStrokeSchema=z.object({id,color:z.enum(['#253e31','#245b96','#a33e36']),width:z.number().min(0.5).max(12),points:z.array(inkPointSchema).min(1).max(12000)}).strict();
export const inkPageSchema=z.object({id,width:z.literal(768),height:z.literal(1024),strokes:z.array(inkStrokeSchema).max(1500),image:rasterImageSchema.optional()}).strict().refine(page=>!page.image||!page.strokes.length,'图片页不能同时包含笔迹');
export const inkPagesSchema=z.array(inkPageSchema).min(1).max(12).superRefine((pages,ctx)=>{let imageBytes=0;for(const page of pages)if(page.image)imageBytes+=page.image.dataUrl.length*3/4;if(imageBytes>MAX_IMAGES_BYTES)ctx.addIssue({code:'custom',message:'图片合计不能超过 16 MB，请分次提交'});let count=0;const ids=new Set<string>();for(const page of pages){if(ids.has(page.id))ctx.addIssue({code:'custom',message:'页面编号重复'});ids.add(page.id);const strokes=new Set<string>();for(const stroke of page.strokes){if(strokes.has(stroke.id))ctx.addIssue({code:'custom',message:'笔画编号重复'});strokes.add(stroke.id);count+=stroke.points.length;}}if(count>120000)ctx.addIssue({code:'custom',message:'这次笔迹较多，请分次提交'});});
export const handwritingTargetSchema=z.object({id,projectId:id,projectTitle:z.string().max(200),sessionId:id,taskId:id,stepId:id.optional(),teachingVersionId:id.optional(),reviewId:id.optional(),title:z.string().max(1000),instruction:z.string().max(100000),sourceIds:z.array(id).max(100),sourceVersions:z.array(z.object({fragmentId:id,transcriptionIds:z.array(id)})).optional(),helpLevel:z.number().int().min(0).max(4),mode:z.enum(['practice','delayed','transfer','diagnosis','selection']),createdAt:z.string().datetime()}).strict();
export const handwritingSubmitSchema=z.object({requestId:id,targetId:id,pages:inkPagesSchema,note:z.string().max(10000).default('')}).strict();
export const handwritingSubmissionSchema=z.object({id,projectId:id,sessionId:id,targetId:id,requestId:id,contentHash:z.string().regex(/^[a-f0-9]{64}$/),submittedAt:z.string().datetime(),helpLevel:z.number().int().min(0).max(4),pages:inkPagesSchema,note:z.string().max(10000),author:z.literal('learner'),status:z.literal('saved_unassessed')}).strict();
export const handwritingBlockUncertaintySchema=z.object({id,text:z.string().min(1).max(2000),critical:z.boolean(),resolved:z.boolean()}).strict();
export const handwritingTextBlockSchema=z.object({id,text:z.string().max(100000),uncertainties:z.array(handwritingBlockUncertaintySchema).max(100)}).strict();
export const handwritingTextPageSchema=z.object({pageId:id,blocks:z.array(handwritingTextBlockSchema).min(1).max(500)}).strict();
export const handwritingTextPagesSchema=z.array(handwritingTextPageSchema).min(1).max(12).superRefine((pages,ctx)=>{const pageIds=new Set<string>(),blockIds=new Set<string>();for(const [pageIndex,page] of pages.entries()){if(pageIds.has(page.pageId))ctx.addIssue({code:'custom',message:'转写页面编号重复',path:[pageIndex,'pageId']});pageIds.add(page.pageId);for(const [blockIndex,block] of page.blocks.entries()){if(blockIds.has(block.id))ctx.addIssue({code:'custom',message:'转写段落编号重复',path:[pageIndex,'blocks',blockIndex,'id']});blockIds.add(block.id);}}});
export type HandwritingTextPage=z.infer<typeof handwritingTextPageSchema>;
export function serializeHandwritingTextPages(pages:HandwritingTextPage[]):string{return pages.map((page,index)=>page.blocks.map(block=>block.text).join('\n\n')+(index<pages.length-1?'\n\n--- 第 '+(index+2)+' 页 ---':'')).join('\n\n');}
export const handwritingTranscriptionSchema=z.object({id,handwritingId:id,projectId:id,sessionId:id,targetId:id,contentHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:id,createdAt:z.string().datetime(),status:z.enum(['machine','confirmed']),text:z.string().max(100000),pages:handwritingTextPagesSchema.optional(),uncertainties:z.array(z.string().max(2000)).max(100),unresolved:z.boolean(),model:z.string().max(400).optional(),callId:id.optional(),parentId:id.optional(),inputId:id.optional()}).strict();
export type HandwritingTranscription=z.infer<typeof handwritingTranscriptionSchema>;
export interface HandwritingTextDraft {text:string;pages?:HandwritingTextPage[];parentId?:string;unresolved:boolean;updatedAt:string;}
export type InkPoint=z.infer<typeof inkPointSchema>;
export type InkStroke=z.infer<typeof inkStrokeSchema>;
export type InkPage=z.infer<typeof inkPageSchema>;
export type HandwritingTarget=z.infer<typeof handwritingTargetSchema>;
export type HandwritingSubmission=z.infer<typeof handwritingSubmissionSchema>;
export type HandwritingSubmit=z.infer<typeof handwritingSubmitSchema>;
export interface HandwritingReceipt {id:string;requestId:string;targetId:string;savedAt:string;status:'saved_unassessed';}
export interface HandwritingServerStatus {running:boolean;urls:string[];pairingExpiresAt?:string;pending?:{id:string;name:string;code:string};connected?:{id:string;name:string};target?:HandwritingTarget;error?:string;}
export interface HandwritingClientState {workspaceId:string;target:HandwritingTarget|null;}
