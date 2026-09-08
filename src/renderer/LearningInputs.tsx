import {ArrowRight,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import type {RecordedInputReceipt,RecordInputRequest,Session,WorkspaceSnapshot} from '../shared/types';
import {Badge,Button,budgetUsed,timeLabel} from './ui';
import {RichText} from './RichText';
export type RecordLocalInput=(sessionId:string,input:RecordInputRequest)=>Promise<RecordedInputReceipt|undefined>;
export type RespondToInput=(sessionId:string,inputId:string)=>Promise<void>;
export function responseAvailability(snapshot:WorkspaceSnapshot,busy:boolean){
 if(busy)return 'AI 正在处理另一项请求。这条记录会保存在本机，稍后由你点击获取回应，不会自动排队。';
 if(!snapshot.settings.hasApiKey)return '尚未配置 AI 服务。这条记录会保存在本机，配置后可继续获取回应。';
 if(snapshot.settings.monthlyBudgetCny<=0||budgetUsed(snapshot)>=snapshot.settings.monthlyBudgetCny*.9)return '本机预算暂不允许新的 AI 请求。这条记录会保存在本机，调整预算后可继续。';
 return '';
}
export function LocalRecordNotice({receipt,recording,error,availability,canAssess,kind='attempt'}:{receipt?:RecordedInputReceipt;recording:boolean;error:string;availability:string;canAssess?:boolean;kind?:'attempt'|'note'|'explore'}){
 return <div className="local-record-notice" aria-live="polite">{recording?<p><LoaderCircle size={13} className="spin"/>正在保存在本机…</p>:receipt?<p className="record-saved"><ShieldCheck size={14}/>已保存在本机 · {timeLabel(receipt.savedAt)}</p>:null}{error&&<p className="inline-error" role="alert">本机记录尚未保存：{error}</p>}<p>先保存在本机，再获取 AI 回应。{kind==='attempt'&&!canAssess?'当前暂不评分，可讨论思路；这次记录不作为能力证据。':kind!=='attempt'?'笔记与探索不作为能力证据。':'评价会按这次任务与帮助条件单独保留。'}</p>{availability&&<p>{availability}</p>}</div>
}
export function InputHistory({snapshot,session,busy,onRespond,onSettings,onSource}:{snapshot:WorkspaceSnapshot;session:Session;busy:boolean;onRespond:RespondToInput;onSettings:()=>void;onSource:(id:string)=>void}){
 const entries=session.messages.filter(m=>m.role==='user'&&m.inputId&&!(m.attemptId&&snapshot.attempts.some(a=>a.id===m.attemptId&&a.assessment))).slice().reverse();
 if(!entries.length)return null;
 const availability=responseAvailability(snapshot,busy);
 return <section className="input-records" aria-label="已保存的学习记录"><div className="section-heading"><h3>已经留下的想法</h3><span className="muted tiny">记录先保存在本机</span></div>{entries.map(m=>{const responses=session.messages.filter(r=>r.role==='assistant'&&r.inputId===m.inputId);const state=m.responseState||'pending';return <article key={m.inputId} className="input-record" data-input-id={m.inputId}><div className="input-record-heading"><Badge tone={state==='completed'?'green':state==='failed'?'amber':''}>{state==='running'?'正在获取回应':state==='completed'?'已收到回应':state==='failed'?'记录已保存 · 回应未完成':'记录已保存 · 等待回应'}</Badge><small>{timeLabel(m.createdAt)} · {m.kind==='attempt'?'自己的尝试':m.kind==='note'?'学习笔记':'探索问题'}</small></div>{((m.taskId&&m.taskId!==(session.teaching?.current.taskId||session.activity.id))||(m.teachingVersionId&&m.teachingVersionId!==session.teachingVersionId))&&<p className="quiet-note">此前任务或来源版本 · {m.activitySnapshot?.title||m.stepSnapshot?.title||'原来的学习内容'}</p>}<RichText text={m.text}/><p className="input-response-mode">{m.responseMode==='assessment'?'可按当时的任务条件请求评价。':'讨论思路，不计入能力证据。'}</p>{responses.map(r=><div className="input-response" key={r.id}><strong>AI 回应</strong><RichText text={r.text}/>{r.sourceIds?.map(id=><button className="text-button tiny" key={id} onClick={()=>onSource(id)}>{snapshot.fragments.find(f=>f.id===id)?.locator||'查看对应原文'}</button>)}</div>)}{m.responseError&&<p className="inline-error">{m.responseError}</p>}{state!=='completed'&&<><div className="input-record-actions"><Button disabled={busy||state==='running'||!!availability} onClick={()=>void onRespond(session.id,m.inputId!)}>{state==='failed'?<RefreshCw size={14}/>:<ArrowRight size={14}/>} {state==='failed'?'重试这次回应':state==='running'?'正在获取回应':'获取这条记录的回应'}</Button>{availability&&!busy&&<Button variant="ghost" onClick={onSettings}>前往设置</Button>}</div>{availability&&<p className="quiet-note">{availability}</p>}</>}</article>})}</section>
}
