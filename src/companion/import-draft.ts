import {z} from 'zod';
import {handwritingTargetSchema,handwritingSubmitSchema,inkPagesSchema} from '../shared/handwriting';
import {draftKey,type LocalDraft} from './draft';

// A local export may include pretty-printed ink and a second, frozen pending copy.
// This file bound is separate from the smaller HTTP submission bound.
export const MAX_IMPORT_BYTES=64*1024*1024;
const id=z.string().min(1).max(120),date=z.string().datetime(),note=z.string().max(10000);
const target=handwritingTargetSchema.extend({sourceVersions:z.array(z.object({fragmentId:id,transcriptionIds:z.array(id).max(100)}).strict()).max(100).optional()});
const receipt=z.object({id,requestId:id,targetId:id,savedAt:date,status:z.literal('saved_unassessed')}).strict();
const draftSchema=z.object({
 key:z.string().min(1).max(1000),workspaceId:id,target,pages:inkPagesSchema,note,
 pageId:id,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),updatedAt:date,
 pending:handwritingSubmitSchema.extend({note}).optional(),receipts:z.array(receipt).max(10000),
}).strict();
const envelope=z.object({format:z.literal('reclimb-handwriting-draft'),version:z.literal(1),exportedAt:date,draft:draftSchema}).strict();

/** Restore only local work. Imported claims of a computer receipt are never trusted. */
export function importDraft(text:string,workspaceId:string):LocalDraft{
 if(typeof text!=='string'||text.length>MAX_IMPORT_BYTES||new TextEncoder().encode(text).byteLength>MAX_IMPORT_BYTES)throw new Error('原稿文件过大，请选择不超过 64 MB 的本机导出文件。');
 let input:unknown;try{input=JSON.parse(text);}catch{throw new Error('原稿文件不是可读取的 JSON，请选择重登导出的手写原稿。');}
 const result=envelope.safeParse(input);if(!result.success)throw new Error('原稿格式、版本或笔迹数据不完整，未导入；现有草稿不会被替换。');
 const draft=result.data.draft;
 if(!workspaceId||draft.workspaceId!==workspaceId)throw new Error('这份原稿属于另一个学习空间。请连接原来的电脑空间后再导入。');
 if(draft.key!==draftKey(draft.workspaceId,draft.target.id)||!draft.pages.some(page=>page.id===draft.pageId))throw new Error('原稿的任务或当前页面关联不一致，未导入。');
 if(draft.target.sourceVersions?.some(source=>!draft.target.sourceIds.includes(source.fragmentId)))throw new Error('原稿的来源版本关联不一致，未导入。');
 if(draft.pending){
  if(draft.pending.targetId!==draft.target.id)throw new Error('待发送原稿绑定了另一个任务，未导入。');
  if(!draft.pending.note.trim()&&!draft.pending.pages.some(page=>page.strokes.length))throw new Error('待发送原稿没有笔迹或文字，未导入。');
 }
 const requests=new Set<string>();
 for(const item of draft.receipts){
  if(item.targetId!==draft.target.id||requests.has(item.requestId))throw new Error('原稿内的历史提交关联不一致，未导入。');
  requests.add(item.requestId);
 }
 // Preserve pending request IDs for safe retries; the receiving computer remains
 // the authority on whether a submission has actually reached its database.
 return {...draft,receipts:[]};
}
