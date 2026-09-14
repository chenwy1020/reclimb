import {handwritingSubmitSchema} from '../shared/handwriting';
import type {HandwritingReceipt,HandwritingSubmit,HandwritingTarget,InkPage,InkPoint,InkStroke} from '../shared/handwriting';

export interface LocalDraft {
 key:string;workspaceId:string;target:HandwritingTarget;pages:InkPage[];note:string;
 pageId:string;revision:number;updatedAt:string;pending?:HandwritingSubmit;receipts:HandwritingReceipt[];
}
export function newId(){const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
// Points and frozen submissions are append-only in the editor. Copy their
// containing arrays instead of serializing every coordinate on every pen-up.
export function snapshotDraft(draft:LocalDraft):LocalDraft{return{...draft,pages:draft.pages.map(page=>({...page,strokes:page.strokes.map(stroke=>({...stroke,points:stroke.points.slice()}))})),receipts:draft.receipts.slice()};}
export function newPage():InkPage{return{id:newId(),width:768,height:1024,strokes:[]};}
export function draftKey(workspaceId:string,targetId:string){return JSON.stringify([workspaceId,targetId]);}
export function createDraft(workspaceId:string,target:HandwritingTarget):LocalDraft{const page=newPage();return{key:draftKey(workspaceId,target.id),workspaceId,target:clone(target),pages:[page],note:'',pageId:page.id,revision:0,updatedAt:new Date().toISOString(),receipts:[]};}
export const MAX_SUBMISSION_BYTES=7.5*1024*1024;
export function freezeSubmission(draft:LocalDraft,requestId=newId(),range:'all'|'current'='all'):HandwritingSubmit{
 if(draft.pending)return clone(draft.pending);
 const pages=range==='current'?draft.pages.filter(page=>page.id===draft.pageId):draft.pages;
 const result=handwritingSubmitSchema.safeParse({requestId,targetId:draft.target.id,pages:clone(pages),note:draft.note});
 if(!result.success)throw new Error('原稿超过一次提交的容量，或有笔迹数据无法读取。请先下载原稿备份，再分次整理提交。');
 const frozen=result.data;
 if(!frozen.note.trim()&&!frozen.pages.some(page=>page.strokes.length))throw new Error('先写下一些笔迹或说明，再提交。');
 if(new TextEncoder().encode(JSON.stringify(frozen)).byteLength>MAX_SUBMISSION_BYTES)throw new Error('这份原稿超过一次传输容量，请改为“当前页”分次提交。原稿完整保留在本机，也可以下载备份。');
 draft.pending=clone(frozen);return frozen;
}
export function acknowledgeSubmission(draft:LocalDraft,receipt:HandwritingReceipt):boolean{
 if(receipt.status!=='saved_unassessed'||!draft.pending||receipt.requestId!==draft.pending.requestId||receipt.targetId!==draft.target.id)return false;
 if(!draft.receipts.some(item=>item.requestId===receipt.requestId))draft.receipts.push(clone(receipt));
 delete draft.pending;return true;
}
export function exportDraft(draft:LocalDraft){return JSON.stringify({format:'reclimb-handwriting-draft',version:1,exportedAt:new Date().toISOString(),draft:clone(draft)},null,2);}
export function parsePairingLink(text:string):{url:string;ticket:string}|null{
 try{const url=new URL(text);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  const ticket=new URLSearchParams(url.hash.slice(1)).get('ticket');if(!ticket||ticket.length>256)return null;
  url.hash='';url.search='';return{url:url.href,ticket};
 }catch{return null;}
}
export function normalizePoint(clientX:number,clientY:number,rect:Pick<DOMRect,'left'|'top'|'width'|'height'>,pressure:number,pointerType='mouse'):InkPoint{
 const clamp=(value:number)=>Math.min(1,Math.max(0,value));return{x:clamp((clientX-rect.left)/Math.max(1,rect.width)),y:clamp((clientY-rect.top)/Math.max(1,rect.height)),pressure:pointerType==='pen'?clamp(pressure):pressure>0?clamp(pressure):.5};
}
export function strokeNear(stroke:InkStroke,point:InkPoint,radius:number){
 const px=point.x*768,py=point.y*1024,limit=(radius+stroke.width/2)**2;
 return stroke.points.some((end,index)=>{const start=stroke.points[Math.max(0,index-1)],ax=start.x*768,ay=start.y*1024,bx=end.x*768,by=end.y*1024,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));return(px-ax-t*dx)**2+(py-ay-t*dy)**2<=limit;});
}
