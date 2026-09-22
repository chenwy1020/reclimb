import {registerLocalDraftFlush,trackLocalSave,flushAdditionalLocalDrafts} from './local-save-queue';
import {useEffect,useRef,useState} from 'react';
import {serializeHandwritingTextPages,type HandwritingSubmission,type HandwritingTextPage,type HandwritingTranscription} from '../shared/handwriting';
import {inkPageDataUrl} from '../shared/ink-svg';
import type {RecordedInputReceipt,Session,SessionMessage,WorkspaceSnapshot} from '../shared/types';
import {Button,timeLabel,type Run} from './ui';
import {RichText} from './RichText';
import {InputRecord} from './InputRecord';
import {FollowupBox} from './FollowupBox';
import type {RecordLocalInput} from './InputStatus';
import {AssessmentView} from './EvidencePage';
import {EvidenceCorrection} from './Reliability';
import {responseAvailability} from './InputStatus';
import './handwriting-feedback.css';

export function HandwritingFeedback({record,session,snapshot,busy,run,onSettings,onSource,onRecord}:{record:HandwritingSubmission;session:Session;snapshot:WorkspaceSnapshot;busy:boolean;run:Run;onSettings:()=>void;onSource:(id:string)=>void;onRecord:RecordLocalInput}){
 const [versions,setVersions]=useState<HandwritingTranscription[]>([]),[messages,setMessages]=useState<SessionMessage[]>([]);
 const [text,setText]=useState(''),[pages,setPages]=useState<HandwritingTextPage[]>(),[pageIndex,setPageIndex]=useState(0),[parentId,setParentId]=useState<string>(),[unresolved,setUnresolved]=useState(true),[checked,setChecked]=useState(false);
 const [loading,setLoading]=useState(true),[recording,setRecording]=useState(false),[working,setWorking]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),recordLock=useRef(false),lock=useRef(false),recognitionId=useRef(crypto.randomUUID()),confirmation=useRef<{key:string;id:string}|undefined>(undefined),editGeneration=useRef(0);
 const draftToSave=useRef<{text:string;pages?:HandwritingTextPage[];parentId?:string;unresolved:boolean}|undefined>(undefined),draftSave=useRef<Promise<unknown>>(Promise.resolve()),draftTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const vision=snapshot.settings.vision,availability=responseAvailability(snapshot,busy);
 useEffect(()=>{alive.current=true;void load(true).catch(e=>{if(alive.current)setError(e.message)}).finally(()=>{if(alive.current)setLoading(false)});return()=>{alive.current=false;if(draftTimer.current)clearTimeout(draftTimer.current);if(draftToSave.current)void saveDraft(draftToSave.current).catch(()=>{})}},[record.id]);
 async function load(initial=false){
  const [items,replies,draft]=await Promise.all([window.learning.request<HandwritingTranscription[]>('handwriting.transcriptions',{handwritingId:record.id}),window.learning.request<SessionMessage[]>('handwriting.responses',{handwritingId:record.id}),initial?window.learning.request<{text:string;pages?:HandwritingTextPage[];parentId?:string;unresolved:boolean}|null>('handwriting.draft',{handwritingId:record.id}):Promise.resolve(null)]);
  if(!alive.current)return;setVersions(items);setMessages(replies);
  if(initial&&editGeneration.current===0&&draft){setText(draft.text);setPages(draft.pages);setPageIndex(0);setParentId(draft.parentId);setUnresolved(draft.unresolved);}
  else if(initial&&editGeneration.current===0&&items.length){const latest=items.at(-1)!;setText(latest.text);setPages(latest.pages);setPageIndex(0);setParentId(latest.id);setUnresolved(latest.unresolved);}
 }
 async function saveDraft(value:{text:string;pages?:HandwritingTextPage[];parentId?:string;unresolved:boolean}){
  draftSave.current=draftSave.current.catch(()=>{}).then(()=>window.learning.request('handwriting.saveDraft',{handwritingId:record.id,...value}));
  try{await trackLocalSave(draftSave.current);if(draftToSave.current===value)draftToSave.current=undefined}catch(e){if(alive.current)setError('核对草稿尚未保存：'+(e as Error).message);throw e}
 }
 useEffect(()=>{if(!editGeneration.current)return;const value={text,pages,parentId,unresolved};draftToSave.current=value;draftTimer.current=setTimeout(()=>void saveDraft(value).catch(()=>{}),150);return()=>{if(draftTimer.current)clearTimeout(draftTimer.current)}},[text,pages,parentId,unresolved]);
 useEffect(()=>registerLocalDraftFlush(async()=>{if(draftTimer.current)clearTimeout(draftTimer.current);while(draftToSave.current)await saveDraft(draftToSave.current);await draftSave.current}),[record.id]);
 useEffect(()=>{const timer=setInterval(()=>{if(alive.current)void load().catch(e=>{if(alive.current)setError(e.message)})},2500);return()=>clearInterval(timer)},[record.id]);
 useEffect(()=>{if(alive.current)void load().catch(e=>{if(alive.current)setError(e.message)})},[session.messages]);
 async function recognize(){
  if(lock.current)return;lock.current=true;setWorking('recognize');setError('');const edit=editGeneration.current;
  try{const result=await window.learning.request<HandwritingTranscription>('handwriting.recognize',{handwritingId:record.id,requestId:recognitionId.current});
   if(!alive.current)return;await load();if(editGeneration.current===edit&&!text.trim()){editGeneration.current++;setText(result.text);setPages(result.pages);setPageIndex(0);setParentId(result.id);setUnresolved(result.unresolved);setChecked(false);}
   recognitionId.current=crypto.randomUUID();setNotice('识别结果已保存。再次识别会新建版本并计费；请先核对已有结果。');
  }catch(e){if(alive.current)setError((e as Error).message)}finally{lock.current=false;if(alive.current){setWorking('');await run('workspace.snapshot');}}
 }
 async function respond(inputId:string){
  if(lock.current)return;lock.current=true;setWorking(inputId);setError('');
  try{await window.learning.request('handwriting.respond',{handwritingId:record.id,inputId});}
  catch(e){if(alive.current)setError((e as Error).message)}finally{lock.current=false;if(alive.current){setWorking('');await load().catch(e=>setError(e.message));await run('workspace.snapshot');}}
 }
 async function confirm(){
  if(recordLock.current||!text.trim()||!checked)return;
  const key=JSON.stringify({text,pages,parentId,unresolved});if(confirmation.current?.key!==key)confirmation.current={key,id:crypto.randomUUID()};
  recordLock.current=true;setRecording(true);setError('');let inputId:string|undefined;
  try{const saved=await trackLocalSave(window.learning.request<{transcription:HandwritingTranscription;receipt:RecordedInputReceipt;responseAvailability?:'busy'}>('handwriting.confirm',{handwritingId:record.id,requestId:confirmation.current.id,text,pages,transcriptionId:parentId,unresolved}));
   if(!alive.current)return;setNotice('确认文本与原任务已保存在本机。'+(saved.receipt.responseMode==='discussion'?'本次一起分析，暂不进行能力评价。':'反馈会保留原任务与帮助条件。'));await load();
   if(!availability&&!lock.current&&saved.responseAvailability!=='busy'&&saved.receipt.responseState!=='completed'&&saved.receipt.responseState!=='running')inputId=saved.receipt.inputId;
  }catch(e){if(alive.current)setError((e as Error).message)}finally{recordLock.current=false;if(alive.current)setRecording(false)}
  if(inputId&&alive.current)await respond(inputId);else if(alive.current)await run('workspace.snapshot');
 }
 async function settings(){try{await flushAdditionalLocalDrafts();onSettings()}catch(e){setError('核对草稿尚未保存：'+(e as Error).message)}}
function replacePages(next:HandwritingTextPage[]){editGeneration.current++;setPages(next);setText(serializeHandwritingTextPages(next));setUnresolved(next.some(page=>page.blocks.some(block=>block.uncertainties.some(item=>item.critical&&!item.resolved))));setChecked(false);}
 function updateBlock(blockId:string,value:string){if(!pages)return;replacePages(pages.map(page=>({...page,blocks:page.blocks.map(block=>block.id===blockId?{...block,text:value}:block)})));}
 function resolveUncertainty(blockId:string,uncertaintyId:string,resolved:boolean){if(!pages)return;replacePages(pages.map(page=>({...page,blocks:page.blocks.map(block=>block.id===blockId?{...block,uncertainties:block.uncertainties.map(item=>item.id===uncertaintyId?{...item,resolved}:item)}:block)})));}
 const savedMatching=versions.some(v=>v.status==='confirmed'&&v.text===text&&JSON.stringify(v.pages)===JSON.stringify(pages)&&v.unresolved===unresolved);
 const effectiveSession={...session,messages},inputs=messages.filter(m=>m.role==='user'&&m.inputId&&!m.followup);
 const followupSnapshot={...snapshot,sessions:snapshot.sessions.map(item=>item.id===session.id?effectiveSession:item)};
 const recordFollowup:RecordLocalInput=async(id,input)=>{await flushAdditionalLocalDrafts();const result=await onRecord(id,input);if(alive.current)await load();return result;};
 const followup=(reply:SessionMessage)=><FollowupBox sessionId={session.id} anchor={{kind:'message',id:reply.id}} title={reply.text.slice(0,70)} snapshot={followupSnapshot} busy={busy||!!working} onRecord={recordFollowup} onRespond={async(_id,inputId)=>respond(inputId)} onSettings={()=>void settings()} onSource={onSource} allowExample/>;
 return <section className="handwriting-feedback" aria-label="手写识别与反馈">
  <h3>让这份推导进入学习</h3><p>先识别原稿，再核对文字与公式，最后按当时的题目回应。确认转写不等于证明推理正确。</p>
  <div className="handwriting-controls"><Button disabled={!!working||busy||!vision?.enabled||!vision.hasApiKey||loading} onClick={()=>void recognize()}>{working==='recognize'?'正在识别原稿…':versions.some(v=>v.status==='machine')?'再次识别（新版本，计费）':'识别这份原稿（计费）'}</Button>{(!vision?.enabled||!vision.hasApiKey)&&<Button onClick={()=>void settings()}>配置视觉服务</Button>}</div>
  <p className="quiet-note">{vision?.enabled?'识别使用：'+vision.providerName+' · '+vision.model+'。图片仅在主动识别时发给此服务，识别和后续反馈分别计费。':'尚未启用视觉服务。仍可对照原稿手工录入并保存。'}</p>
  {error&&<div><p className="handwriting-error" role="alert">{error}</p><Button disabled={loading} onClick={()=>{setLoading(true);setError('');void load(true).catch(e=>setError(e.message)).finally(()=>{if(alive.current)setLoading(false)})}}>重新读取已保存记录（不计费）</Button></div>}{notice&&<p className="record-saved" role="status">{notice}</p>}
  {loading?<p role="status">正在读取此前的识别与回应…</p>:<>
   {versions.some(v=>v.status==='machine')&&<details className="handwriting-versions"><summary>已保存的机器识别结果</summary>{versions.filter(v=>v.status==='machine').map(v=><article key={v.id}><p>{timeLabel(v.createdAt)} · {v.model??'模型未知'} · 待人工核对</p><RichText text={v.text}/>{v.uncertainties.length>0&&<ul>{v.uncertainties.map((u,i)=><li key={i}>{u}</li>)}</ul>}<Button disabled={!!working} onClick={()=>{editGeneration.current++;setText(v.text);setPages(v.pages);setPageIndex(0);setParentId(v.id);setUnresolved(v.unresolved);setChecked(false)}}>用此结果核对（替换下方未保存文字）</Button></article>)}</details>}
   <p className="handwriting-warning" role="note">机器未标出疑点不代表文字或公式正确。请逐页对照原稿；影响结论而尚未解决的歧义只能进入讨论。</p>
   {pages?<div className="handwriting-page-review">
    <div className="handwriting-page-nav"><Button disabled={pageIndex===0} onClick={()=>setPageIndex(value=>value-1)}>上一页</Button><span>第 {pageIndex+1} / {record.pages.length} 页</span><Button disabled={pageIndex===record.pages.length-1} onClick={()=>setPageIndex(value=>value+1)}>下一页</Button></div>
    <div className="handwriting-page-columns"><figure><img src={inkPageDataUrl(record.pages[pageIndex])} alt={'待核对原稿第 '+(pageIndex+1)+' 页'}/><figcaption>保存的原始第 {pageIndex+1} 页</figcaption></figure><div className="handwriting-blocks">{pages[pageIndex].blocks.map((block,blockIndex)=><section key={block.id} className="handwriting-block"><label>第 {blockIndex+1} 段<textarea aria-label={'第 '+(pageIndex+1)+' 页第 '+(blockIndex+1)+' 段转写'} rows={5} maxLength={100000} value={block.text} onChange={event=>updateBlock(block.id,event.target.value)}/></label><details><summary>预览本段文字与公式</summary><RichText text={block.text}/></details>{block.uncertainties.length>0?<div className="handwriting-uncertainties"><strong>本段识别疑点</strong>{block.uncertainties.map(item=><label key={item.id}><input type="checkbox" checked={item.resolved} onChange={event=>resolveUncertainty(block.id,item.id,event.target.checked)}/><span>{item.text}{item.critical?'（影响确定评价）':''} · {item.resolved?'已核对':'待核对'}</span></label>)}</div>:<p className="quiet-note">模型未标出疑点；这不表示本段已经正确。</p>}</section>)}</div></div>
    <details className="handwriting-complete-original"><summary>查看完整原稿</summary>{record.pages.map((page,index)=><figure key={page.id}><img src={inkPageDataUrl(page)} alt={'完整手写原稿第 '+(index+1)+' 页'}/><figcaption>第 {index+1} 页</figcaption></figure>)}{record.note&&<RichText text={record.note}/>}</details>
   </div>:<><p className="handwriting-warning">这是旧版完整转写，未建立页段对应。系统不会猜测对应关系或自动重新识别计费。</p><label className="handwriting-transcript-label">核对后的完整文字与公式<textarea aria-label="手写核对文本" rows={9} maxLength={100000} value={text} onChange={e=>{editGeneration.current++;setText(e.target.value);setChecked(false)}} placeholder="可以手工输入。用 $…$ 或 $$…$$ 表示公式；图形可补充文字说明。请保留原稿中的错误，不让识别替你解题。"/></label>{text&&<details><summary>预览完整文字与公式</summary><RichText text={text}/></details>}</>}
   <label className="handwriting-check"><input type="checkbox" checked={unresolved} onChange={e=>{editGeneration.current++;setUnresolved(e.target.checked);setChecked(false)}}/>仍有无法辨认的符号、缺失图形或未确定内容（只分析，不评价能力）</label>
   <label className="handwriting-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已对照原稿核对这份文字；尚不确定的地方已保留并说明</label>
   <Button variant="primary" disabled={!text.trim()||!checked||recording||loading||savedMatching} onClick={()=>void confirm()}>{recording?'正在本地保存…':savedMatching?'这份文字已保存，可在下方获取回应':'保存确认文本并获取反馈'}</Button>
   {availability&&<p className="quiet-note">{availability}</p>}
   <p className="quiet-note">原始笔迹与识别版本分别保留。这里的反馈不会切换当前任务或替换作答框草稿。</p>
   {inputs.length>0&&<div className="handwriting-replies"><h4>这份原稿的已保存表达与回应</h4>{inputs.map(m=><div key={m.id}><InputRecord message={m} session={effectiveSession} snapshot={snapshot} busy={busy||!!working} onRespond={async(_sessionId,inputId)=>respond(inputId)} onSettings={()=>void settings()} onSource={onSource} renderFollowup={followup}/>{snapshot.evidence.filter(e=>e.attemptId===m.attemptId).map(e=><EvidenceCorrection key={e.id} snapshot={snapshot} evidence={e}/>)}{snapshot.attempts.filter(a=>a.id===m.attemptId&&a.assessment).map(a=><details key={a.id}><summary>查看本次评价依据与限制</summary><AssessmentView assessment={a.assessment!} snapshot={snapshot} onSource={onSource}/></details>)}</div>)}</div>}
  </>}
 </section>;
}
