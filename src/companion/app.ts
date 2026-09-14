import {handwritingTargetSchema} from '../shared/handwriting';
import type {HandwritingClientState,HandwritingReceipt,InkPage,InkStroke} from '../shared/handwriting';
import {acknowledgeSubmission,clone,createDraft,draftKey,exportDraft,freezeSubmission,newId,newPage,normalizePoint,parsePairingLink,strokeNear,type LocalDraft} from './draft';
import {listDrafts,loadCredentials,loadDraft,loadSelection,saveCredentials,saveDraft,saveSelection,type PairCredentials} from './storage';
import {importDraft,MAX_IMPORT_BYTES} from './import-draft';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('ink-canvas'),ctx=canvas.getContext('2d')!;
const cache=new Map<string,LocalDraft>(),undo=new Map<string,InkStroke[][]>(),redo=new Map<string,InkStroke[][]>();
let credentials:PairCredentials|undefined,current:LocalDraft|undefined,remote:HandwritingClientState|undefined;
let tool:'pen'|'eraser'='pen',activePointer:number|undefined,activeStroke:InkStroke|undefined,beforeStroke:InkStroke[]|undefined;
let saving:Promise<void>=Promise.resolve(),saveTimer:ReturnType<typeof setTimeout>|undefined,polling=false,pairing=false,pairTicket='',pairGeneration=0;
let sending:string|undefined,switching=false,localFailure=false,connected=false,lastInkSave=0;
let initialized=false,latestTicket:string|undefined;
const submitErrors=new Map<string,string>();
const message=(error:unknown)=>error instanceof Error?error.message:'这一步没有完成，请重试。';
function error(text:string){$('global-error').hidden=!text;$('global-error').textContent=text;}
function connection(text:string){$('connection-status').textContent=text;}
function page(){return current?.pages.find(item=>item.id===current!.pageId)??current?.pages[0];}
function persist(draft=current):Promise<void>{
 if(!draft)return Promise.resolve();const snapshot=clone(draft);
 if(current?.key===draft.key){$('save-status').textContent='正在保存到本机…';$('save-status').classList.remove('failed');}
 const operation=saving.catch(()=>{}).then(()=>saveDraft(snapshot));saving=operation;
 return operation.then(()=>{localFailure=false;$('retry-save').hidden=true;if(current?.key===snapshot.key&&current.revision===snapshot.revision){$('save-status').textContent='✓ 已保存在本机';$('save-status').classList.remove('failed');}}).catch(reason=>{localFailure=true;if(current?.key===snapshot.key){$('save-status').textContent='本机保存未完成，请下载原稿备份，再重试保存。';$('save-status').classList.add('failed');$('retry-save').hidden=false;}throw reason;});
}
function changed(immediate=false){const draft=current;if(!draft)return;draft.revision++;draft.updatedAt=new Date().toISOString();$('save-status').textContent='尚有笔迹正在保存…';clearTimeout(saveTimer);if(immediate){void persist(draft).catch(()=>{});}else saveTimer=setTimeout(()=>void persist(draft).catch(()=>{}),350);}
async function api<T>(path:string,body?:unknown,token=credentials?.token):Promise<T>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{const result=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});const data=await result.json();if(!result.ok)throw new Error(typeof data.error==='string'?data.error:'电脑暂时无法处理这次请求。');return data as T;
 }catch(reason){if(reason instanceof DOMException&&reason.name==='AbortError')throw new Error('连接超时。原稿仍留在本机，可以主动重试。');throw reason;}finally{clearTimeout(timeout);}
}
function paint(){
 const bounds=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),width=Math.max(1,Math.round(bounds.width*ratio));
 if(canvas.width!==width){canvas.width=width;canvas.height=Math.round(width*4/3);}
 ctx.setTransform(canvas.width/768,0,0,canvas.height/1024,0,0);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,768,1024);ctx.lineCap='round';ctx.lineJoin='round';
 for(const stroke of page()?.strokes??[]){ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color;let previous=stroke.points[0];if(!previous)continue;
  if(stroke.points.length===1){ctx.beginPath();ctx.arc(previous.x*768,previous.y*1024,stroke.width/2,0,Math.PI*2);ctx.fill();continue;}
  // Keep pressure and dot widths identical to the desktop's inert SVG renderer.
  for(const point of stroke.points.slice(1)){ctx.lineWidth=stroke.width*(.45+.8*(previous.pressure+point.pressure)/2);ctx.beginPath();ctx.moveTo(previous.x*768,previous.y*1024);ctx.lineTo(point.x*768,point.y*1024);ctx.stroke();previous=point;}
 }
}
function updateActions(){const p=page(),index=current?.pages.findIndex(item=>item.id===p?.id)??0;
 $<HTMLButtonElement>('undo').disabled=switching||!p||!(undo.get(p.id)?.length);$<HTMLButtonElement>('redo').disabled=switching||!p||!(redo.get(p.id)?.length);
 $<HTMLButtonElement>('prev-page').disabled=switching||index<=0;$<HTMLButtonElement>('next-page').disabled=switching||!current||index>=current.pages.length-1;$<HTMLButtonElement>('add-page').disabled=switching||!current||current.pages.length>=12;
 $('page-label').textContent=current?`${index+1} / ${current.pages.length} 页`:'';
 const submit=$<HTMLButtonElement>('submit-ink');submit.disabled=switching||!current||sending===current.key;submit.textContent=current?.pending?'重试发送已保存的原稿':'提交这份手写';
 $<HTMLSelectElement>('submit-range').disabled=!!current?.pending||switching;
 const notice=$('submission-status');notice.hidden=!current||(!current.pending&&!current.receipts.length&&!submitErrors.has(current.key));
 if(current){const receipt=current.receipts.at(-1);notice.textContent=sending===current.key?'原稿已在本机冻结保存，正在发送到电脑。你可以继续书写。':submitErrors.get(current.key)??(current.pending?'有一份原稿尚待电脑确认。重试会发送同一份记录，不会重复生成作答。':receipt?`✓ 电脑已保存原稿（${new Date(receipt.savedAt).toLocaleString()}）。当前未进行能力评价。`:'');notice.classList.toggle('error',submitErrors.has(current.key));}
}
async function refreshPicker(){$('draft-recovery').hidden=!credentials;if(!credentials)return;let drafts:LocalDraft[]=[];try{drafts=await listDrafts(credentials.workspaceId);}catch{drafts=[...cache.values()].filter(item=>item.workspaceId===credentials!.workspaceId);}
 const all=new Map(drafts.map(item=>[item.key,item]));if(current)all.set(current.key,current);const select=$<HTMLSelectElement>('draft-picker');select.replaceChildren();
 for(const draft of all.values()){const option=document.createElement('option');option.value=draft.key;option.textContent=`${draft.target.projectTitle} · ${draft.target.title}${draft.pending?' · 待发送':''}`;select.append(option);}if(current)select.value=current.key;$('draft-picker-section').hidden=!all.size;
}
function refreshOffer(){const target=remote?.target;$('target-offer').hidden=!target||target.id===current?.target.id;if(target)$('offered-title').textContent=`${target.projectTitle} · ${target.title}`;$('waiting-target').hidden=!!current||!!target||!credentials;}
function setSwitching(value:boolean){switching=value;$<HTMLTextAreaElement>('draft-note').disabled=value;$<HTMLSelectElement>('draft-picker').disabled=value;$<HTMLButtonElement>('adopt-target').disabled=value;updateActions();}
async function showDraft(draft:LocalDraft){finishStroke();if(current&&current!==draft)await persist(current);current=draft;cache.set(draft.key,draft);$('workbench').hidden=false;$('project-title').textContent=draft.target.projectTitle;$('task-title').textContent=draft.target.title;$('task-instruction').textContent=draft.target.instruction;$<HTMLTextAreaElement>('draft-note').value=draft.note;refreshOffer();updateActions();requestAnimationFrame(paint);await saveSelection(draft.key).catch(()=>{});await refreshPicker();await persist(draft).catch(()=>{});}
async function switchDraft(resolve:()=>Promise<LocalDraft|undefined>){if(switching)return;finishStroke();setSwitching(true);try{const draft=await resolve();if(draft)await showDraft(draft);}finally{setSwitching(false);}}
async function refreshState(allowDuringPair=false){if(!credentials||polling||(pairing&&!allowDuringPair))return;polling=true;const auth=credentials,generation=pairGeneration;try{const state=await api<HandwritingClientState>('/api/state',undefined,auth.token);if(auth!==credentials||generation!==pairGeneration||(pairing&&!allowDuringPair))return;if(state.workspaceId!==auth.workspaceId)throw new Error('电脑学习空间已变化，请重新配对。当前草稿仍属于原任务。');remote={workspaceId:state.workspaceId,target:state.target?handwritingTargetSchema.parse(state.target):null};connected=true;connection('✓ 已连接电脑');$('pairing').hidden=true;refreshOffer();}
 catch(reason){if(auth!==credentials||generation!==pairGeneration)return;connected=false;connection('未连接 · 可继续书写');if(!current)error('暂时没有连接电脑。请保持同一局域网，或重新配对。'+message(reason));}finally{polling=false;}}
async function beginPair(ticket:string){if(pairing&&pairTicket===ticket)return;pairing=true;pairTicket=ticket;const generation=++pairGeneration,isCurrent=()=>generation===pairGeneration;$('pairing').hidden=false;$('pair-status').hidden=false;$('pair-retry').hidden=true;$('pair-status').textContent='正在申请配对…';
 try{const request=await api<{requestId:string;pollToken:string;code:string}>('/api/pair',{ticket,name:'iPad 手写板'},'');if(!isCurrent())return;$('pair-status').textContent=`配对确认码：${request.code}\n请在电脑上核对相同号码，点击允许连接。`;
  for(let count=0;count<180;count++){await new Promise(resolve=>setTimeout(resolve,1200));if(!isCurrent())return;const result=await api<{status:'pending'|'approved'|'rejected';token?:string;workspaceId?:string}>('/api/pair/status',{requestId:request.requestId,pollToken:request.pollToken},'');if(!isCurrent())return;
   if(result.status==='rejected')throw new Error('电脑没有允许本次配对。请在电脑上重新生成配对链接。');if(result.status!=='approved')continue;
   if(!result.token||!result.workspaceId)throw new Error('配对结果不完整，请重新配对。');const approved={token:result.token,workspaceId:result.workspaceId};await saveCredentials(approved).catch(()=>{if(isCurrent())error('配对已完成，但本机无法保存连接信息。请保留页面并下载重要原稿。');});if(!isCurrent())return;
   if(current&&current.workspaceId!==approved.workspaceId){await persist(current);if(!isCurrent())return;current=undefined;$('workbench').hidden=true;}credentials=approved;
   $('pair-status').textContent='✓ 配对完成';error('');await refreshPicker();if(isCurrent())await refreshState(true);return;
  }throw new Error('等待确认已超时，请在电脑上重新打开配对入口。');
 }catch(reason){if(isCurrent()){$('pair-status').textContent=message(reason);$('pair-retry').hidden=false;}}finally{if(isCurrent())pairing=false;}}
function finishStroke(){if(activePointer===undefined)return;const pointer=activePointer;activePointer=undefined;const p=page();if(p&&beforeStroke){const history=undo.get(p.id)??[];history.push(beforeStroke);undo.set(p.id,history.slice(-50));redo.delete(p.id);}try{canvas.releasePointerCapture(pointer);}catch{}activeStroke=undefined;beforeStroke=undefined;changed(true);updateActions();}
function writePoint(event:PointerEvent){const p=page();if(!p)return;const point=normalizePoint(event.clientX,event.clientY,canvas.getBoundingClientRect(),event.pressure);
 if(tool==='eraser')p.strokes=p.strokes.filter(stroke=>!strokeNear(stroke,point,12));else if(activeStroke&&activeStroke.points.length<12000){const previous=activeStroke.points.at(-1);if(!previous||Math.hypot((point.x-previous.x)*768,(point.y-previous.y)*1024)>.4)activeStroke.points.push(point);}
 paint();if(Date.now()-lastInkSave>800){lastInkSave=Date.now();changed(true);}
}
canvas.addEventListener('pointerdown',event=>{if(switching||!current||activePointer!==undefined||event.button>0||(event.pointerType==='touch'&&!$<HTMLInputElement>('finger-mode').checked))return;const p=page()!;if(tool==='pen'&&p.strokes.length>=1500){error('这一页笔画较多，请加一页继续书写。');return;}event.preventDefault();beforeStroke=clone(p.strokes);activePointer=event.pointerId;canvas.setPointerCapture(event.pointerId);if(tool==='pen'){activeStroke={id:newId(),color:$<HTMLSelectElement>('pen-color').value as InkStroke['color'],width:Number($<HTMLSelectElement>('pen-width').value),points:[normalizePoint(event.clientX,event.clientY,canvas.getBoundingClientRect(),event.pressure)]};p.strokes.push(activeStroke);}writePoint(event);});
canvas.addEventListener('pointermove',event=>{if(event.pointerId!==activePointer)return;event.preventDefault();const points=typeof event.getCoalescedEvents==='function'?event.getCoalescedEvents():[event];for(const point of points.length?points:[event])writePoint(point);});
canvas.addEventListener('pointerup',event=>{if(event.pointerId!==activePointer)return;writePoint(event);finishStroke();});canvas.addEventListener('pointercancel',event=>{if(event.pointerId===activePointer)finishStroke();});canvas.addEventListener('lostpointercapture',event=>{if(event.pointerId===activePointer)finishStroke();});
for(const selected of ['pen','eraser'] as const)$(selected+'-tool').addEventListener('click',()=>{finishStroke();tool=selected;$('pen-tool').setAttribute('aria-pressed',String(tool==='pen'));$('eraser-tool').setAttribute('aria-pressed',String(tool==='eraser'));});
for(const [button,from,to] of [['undo',undo,redo],['redo',redo,undo]] as const)$(button).addEventListener('click',()=>{finishStroke();const p=page();if(!p)return;const value=from.get(p.id)?.pop();if(!value)return;const history=to.get(p.id)??[];history.push(clone(p.strokes));to.set(p.id,history);p.strokes=value;changed(true);paint();updateActions();});
for(const [button,direction] of [['prev-page',-1],['next-page',1]] as const)$(button).addEventListener('click',()=>{finishStroke();if(!current)return;const next=current.pages[current.pages.findIndex(p=>p.id===current!.pageId)+direction];if(next){current.pageId=next.id;changed(true);paint();updateActions();}});
$('add-page').addEventListener('click',()=>{finishStroke();if(!current||current.pages.length>=12)return;const next=newPage();current.pages.push(next);current.pageId=next.id;changed(true);paint();updateActions();});
$('draft-note').addEventListener('input',()=>{if(!current)return;current.note=$<HTMLTextAreaElement>('draft-note').value;changed();});
$('adopt-target').addEventListener('click',()=>{const target=remote?.target,auth=credentials;if(!target||!auth)return;void switchDraft(async()=>{const key=draftKey(auth.workspaceId,target.id);return cache.get(key)??await loadDraft(key).catch(()=>undefined)??createDraft(auth.workspaceId,target);}).catch(reason=>error(message(reason)));});
$('draft-picker').addEventListener('change',()=>{const key=$<HTMLSelectElement>('draft-picker').value;void switchDraft(async()=>{const draft=cache.get(key)??await loadDraft(key);return draft?.workspaceId===credentials?.workspaceId?draft:undefined;}).catch(reason=>error(message(reason)));});
$('submit-ink').addEventListener('click',()=>void(async()=>{finishStroke();const draft=current,auth=credentials;if(!draft||sending)return;sending=draft.key;submitErrors.delete(draft.key);
 try{const frozen=freezeSubmission(draft,undefined,$<HTMLSelectElement>('submit-range').value==='current'?'current':'all');draft.revision++;await persist(draft);updateActions();if(!auth||auth.workspaceId!==draft.workspaceId)throw new Error('原稿已保存，请连接原来的学习空间后再重试发送。');const receipt=await api<HandwritingReceipt>('/api/submit',frozen,auth.token);if(!acknowledgeSubmission(draft,receipt))throw new Error('电脑返回的记录不对应本次原稿，请保留原稿并重试。');draft.revision++;await persist(draft);}
 catch(reason){submitErrors.set(draft.key,message(reason));}finally{sending=undefined;updateActions();await refreshPicker();}})());
$('download-draft').addEventListener('click',()=>{finishStroke();if(!current)return;const blob=new Blob([exportDraft(current)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`重登手写-${current.target.id.slice(0,12)}-${Date.now()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});
$('import-draft').addEventListener('change',()=>void(async()=>{const input=$<HTMLInputElement>('import-draft'),file=input.files?.[0],auth=credentials;input.value='';if(!file||!auth)return;if(file.size>MAX_IMPORT_BYTES){error('这份备份过大，请选择重登导出的原稿 JSON 文件。');return;}
 try{await switchDraft(async()=>{const draft=importDraft(await file.text(),auth.workspaceId);if(cache.has(draft.key)||await loadDraft(draft.key))throw new Error('本机已经有这份任务的草稿，未覆盖它。请在“本机保留的草稿”中切换查看。');await persist(current);await saveDraft(draft);return draft;});error('');$('submission-status').hidden=false;$('submission-status').classList.remove('error');$('submission-status').textContent='已恢复本机草稿；电脑保存状态需重新核对。待发送的原稿会保留原提交编号。';}catch(reason){error(message(reason));}
})());
$('retry-save').addEventListener('click',()=>void persist().catch(()=>{}));$('refresh-state').addEventListener('click',()=>void refreshState());$('refresh-connection').addEventListener('click',()=>{$('pairing').hidden=false;void refreshState();});$('pair-retry').addEventListener('click',()=>void beginPair(pairTicket));
$('pair-form').addEventListener('submit',event=>{event.preventDefault();const parsed=parsePairingLink($<HTMLInputElement>('pair-link').value.trim());if(!parsed){error('请粘贴电脑生成的完整配对链接（包含 #ticket= 后面的内容）。');return;}if(new URL(parsed.url).origin!==location.origin){location.assign(parsed.url+'#ticket='+encodeURIComponent(parsed.ticket));return;}$<HTMLInputElement>('pair-link').value='';void beginPair(parsed.ticket);});
window.addEventListener('online',()=>void refreshState());window.addEventListener('offline',()=>{connected=false;connection('已断线 · 可继续书写');});window.addEventListener('pagehide',()=>{finishStroke();void persist().catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(document.hidden){finishStroke();void persist().catch(()=>{});}else void refreshState();});
new ResizeObserver(()=>{if(current)paint();}).observe(canvas);
function consumeTicket(){const parsed=parsePairingLink(location.href);if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(parsed){latestTicket=parsed.ticket;if(initialized)void beginPair(parsed.ticket);}}
window.addEventListener('hashchange',consumeTicket);consumeTicket();
void(async()=>{
 try{credentials=await loadCredentials();const selected=await loadSelection();if(selected){const draft=await loadDraft(selected);if(draft&&draft.workspaceId===credentials?.workspaceId)await showDraft(draft);}await refreshPicker();}catch(reason){error(message(reason));}
 initialized=true;if(latestTicket)await beginPair(latestTicket);else if(credentials)await refreshState();else connection('尚未配对');setInterval(()=>{if(!document.hidden&&!pairing)void refreshState();},8000);
})().catch(reason=>error(message(reason)));
