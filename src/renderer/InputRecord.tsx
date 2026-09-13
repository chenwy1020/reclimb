import type {ReactNode} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import type {Session,SessionMessage,WorkspaceSnapshot} from '../shared/types';
import {Badge,Button,timeLabel} from './ui';
import {RichText} from './RichText';
import {responseAvailability,type RespondToInput} from './InputStatus';
export function InputRecord({message:m,session,snapshot,busy,onRespond,onSettings,onSource,renderFollowup}:{message:SessionMessage;session:Session;snapshot:WorkspaceSnapshot;busy:boolean;onRespond:RespondToInput;onSettings:()=>void;onSource:(id:string)=>void;renderFollowup?:(message:SessionMessage)=>ReactNode}){
 const responses=session.messages.filter(r=>r.role==='assistant'&&r.inputId===m.inputId),state=m.responseState||'pending',availability=responseAvailability(snapshot,busy);
 return <article className="input-record" id={'learning-input-'+m.inputId} data-input-id={m.inputId}>
  <div className="input-record-heading"><Badge tone={state==='completed'?'green':state==='failed'?'amber':''}>{state==='running'?'正在获取回应':state==='completed'?'已收到回应':state==='failed'?'记录已保存 · 回应未完成':'记录已保存 · 等待回应'}</Badge><small>{timeLabel(m.createdAt)} · {m.kind==='attempt'?'自己的尝试':m.kind==='note'?'学习笔记':'探索问题'}</small></div>
  {m.followup&&<p className="followup-target">继续讨论：{m.followup.title}</p>}{m.followup?.contextWarning&&<p className="quiet-note">{m.followup.contextWarning}</p>}
  {m.teachingVersionId&&m.teachingVersionId!==session.teachingVersionId&&<p className="quiet-note">此前任务或来源版本 · {m.activitySnapshot?.title||m.stepSnapshot?.title||'原来的学习内容'}</p>}
  <RichText text={m.text}/><p className="input-response-mode">{m.responseMode==='assessment'?'可按当时的任务条件请求评价。':'讨论思路，不计入能力证据。'}</p>
  {responses.map(r=><div className="input-response" key={r.id} data-response-id={r.id}><strong>AI 回应</strong><RichText text={r.text}/>{r.sourceIds?.map(id=><button className="text-button tiny" key={id} onClick={()=>onSource(id)}>{snapshot.fragments.find(f=>f.id===id)?.locator||'查看对应原文'}</button>)}{renderFollowup?.(r)}</div>)}
  {m.responseError&&<p className="inline-error" role="alert">{m.responseError}</p>}{state!=='completed'&&<><div className="input-record-actions"><Button disabled={busy||state==='running'||!!availability} onClick={()=>void onRespond(session.id,m.inputId!)}>{state==='failed'?<RefreshCw size={14}/>:<ArrowRight size={14}/>} {state==='failed'?'重试这次回应':state==='running'?'正在获取回应':'获取这条记录的回应'}</Button>{availability&&!busy&&<Button variant="ghost" onClick={onSettings}>前往设置</Button>}</div>{availability&&<p className="quiet-note">{availability}</p>}</>}
 </article>;
}
