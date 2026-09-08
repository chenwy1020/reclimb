import DisputePreview from './DisputePreview';
import {evidenceStanding} from '../shared/reliability-state';
import {useEffect,useState} from 'react';
import {AlertCircle,ChevronDown,Eye,Flag,MessageCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import type {Session,WorkspaceSnapshot} from '../shared/types';
import type {VerificationView} from '../shared/reliability';
import {Badge,Button,timeLabel,type Run} from './ui';
import {RichText} from './RichText';
const verificationLabels={pending:'尚待核验',ready:'本次核验通过',needs_correction:'内容需要修订',uncertain:'仍有不确定之处'};
const disputeLabels={open:'疑问已保留',reviewing:'正在核查',resolved:'已有处理结果',unresolved:'尚未解决'};
export function useVerification(session:Session|undefined,snapshot:WorkspaceSnapshot){
 const key=session?[session.id,session.teachingVersionId||session.activity.teachingVersionId||'legacy',session.teaching?.current.taskId||session.activity.id||'',snapshot.taskReviews?.length||0,snapshot.disputes?.map(d=>d.id+d.updatedAt).join('|')||'',snapshot.corrections?.length||0].join(':'):'';
 const[result,setResult]=useState<{key:string;view?:VerificationView;error?:string}>({key:''});
 useEffect(()=>{let active=true;if(!session)return;void window.learning.request<VerificationView>('session.verification',{sessionId:session.id}).then(view=>{if(active)setResult({key,view})}).catch(e=>{if(active)setResult({key,error:String(e.message||e)})});return()=>{active=false}},[key]);
 return {view:result.key===key?result.view:undefined,error:result.key===key?result.error:undefined};
}
export function VerificationSummary({view}:{view?:VerificationView}){return <div className={'verification-summary '+(view?.canAssess?'ready':'pending')}><div><ShieldCheck size={16}/><strong>{view?.status==='ready'&&!view.canAssess?'存在待核对的问题':view?verificationLabels[view.status]:'正在读取核验记录'}</strong><Badge tone={view?.canAssess?'green':'amber'}>{view?.canAssess?'可以提交评价':'暂不进行能力评价'}</Badge></div>{view?.summary&&<RichText text={view.summary}/>}<small>核验是另一轮检查，不保证内容无误。你始终可以阅读、保存想法、探索和指出问题。</small></div>}
export function ReliabilityPanel({session,snapshot:s,view,error,busy,run,onSolution}:{session:Session;snapshot:WorkspaceSnapshot;view?:VerificationView;error?:string;busy:boolean;run:Run;onSolution:(sessionId:string)=>Promise<string|undefined>}){
 const[composing,setComposing]=useState(false),[issue,setIssue]=useState(''),[solution,setSolution]=useState(''),[reviewingId,setReviewingId]=useState('');
 const disputes=(s.disputes||[]).filter(d=>d.sessionId===session.id).slice().reverse();
 const version=session.teachingVersionId||session.activity.teachingVersionId;
 useEffect(()=>{setComposing(false);setIssue('');setSolution('');setReviewingId('')},[session.id,version]);
 return <section className="reliability-panel" aria-label="内容核验与疑问"><VerificationSummary view={view}/>{error&&<p className="inline-error" role="alert">暂时无法读取核验状态：{error}</p>}<div className="reliability-actions"><Button disabled={busy} onClick={()=>setComposing(v=>!v)}><Flag size={14}/>这里可能有错</Button>{(!view?.canAssess||view.status==='pending')&&<Button disabled={busy} onClick={()=>void run('session.verify',{sessionId:session.id},'核验记录已更新，请查看检查结果。')}><RefreshCw size={14}/>核验这段内容</Button>}{view?.reviewId&&<Button variant="ghost" disabled={busy} onClick={async()=>{const text=await onSolution(session.id);if(text!==undefined)setSolution(text)}}><Eye size={14}/>查看核验解答（计入帮助）</Button>}</div>
 {composing&&<div className="dispute-compose"><label className="form-label">你怀疑哪里有问题？<textarea aria-label="内容疑问" value={issue} onChange={e=>setIssue(e.target.value)} placeholder="可以指出某一步、某个条件，也可以先不解释。系统会保存对应的内容版本。" rows={3}/></label><small>先保留疑问不调用模型。受影响的内容暂不用于能力评价；之后可选择核查。</small><div className="transcription-actions"><Button disabled={busy} onClick={()=>setComposing(false)}>暂不提交</Button><Button variant="primary" disabled={busy} onClick={async()=>{const next=await run('session.dispute',{sessionId:session.id,issue:issue.trim()||undefined},'疑问与对应内容版本已保留。');if(next){setComposing(false);setIssue('')}}}>保留这个疑问</Button></div></div>}
 {solution&&<details className="review-solution" open><summary><Eye size={14}/>刚才查看的核验解答<ChevronDown size={14}/></summary><p>这次查看已经计入当前任务的帮助记录。解答本身也可能存在错误。</p><RichText text={solution}/></details>}
 {disputes.length>0&&<div className="dispute-list"><h3><MessageCircle size={15}/>尚需厘清与已经处理的问题 <span>{disputes.length}</span></h3>{disputes.map(d=>{const original=s.teachingVersions?.find(v=>v.id===d.teachingVersionId);return <details className={'dispute-card '+d.status} key={d.id} open={d.status!=='resolved'}><summary><Badge tone={d.status==='resolved'?'green':'amber'}>{disputeLabels[d.status]}</Badge><span>{d.issue||'这段内容可能有错'}</span><ChevronDown size={14}/></summary><div className="dispute-body"><small>{timeLabel(d.createdAt)} · {original?'内容版本 '+original.version:'对应内容已留档'}{d.teachingVersionId!==version?' · 之前的任务':''}</small>{original&&<details className="dispute-original"><summary>查看当时的任务</summary><RichText text={original.activity.title}/><RichText text={original.activity.instruction}/></details>}{d.messages.map(m=><article key={m.id}><strong>{m.role==='user'?'我的疑问':'核查回应'}</strong><RichText text={m.text}/></article>)}{d.replacementVersionId&&<p className="dispute-resolution">已经留下新的内容版本；旧任务、作答与评价仍然保留，可在能力记录中核对修订状态。</p>}{d.status!=='resolved'&&<Button disabled={busy||d.status==='reviewing'} onClick={()=>setReviewingId(reviewingId===d.id?'':d.id)}><RefreshCw size={14}/>{d.status==='reviewing'?'正在核查':d.status==='unresolved'?'重新核查这个问题':'核查这个问题'}</Button>}{reviewingId===d.id&&<DisputePreview snapshot={s} dispute={d} original={original} busy={busy} onCancel={()=>setReviewingId('')} onConfirm={async()=>{const next=await run('dispute.review',{disputeId:d.id,allowSendingPrivateContext:true});if(next)setReviewingId('')}}/>}{d.status!=='resolved'&&<p className="dispute-cost">核查需要一次模型操作，计入本机预算。暂时跳过也会保留这个问题。</p>}</div></details>})}</div>}
 </section>
}

export function EvidenceCorrection({snapshot,evidence}:{snapshot:WorkspaceSnapshot;evidence:import('../shared/types').Evidence}){
 const standing=evidenceStanding(snapshot,evidence);if(standing.effective)return null;
 const corrections=(snapshot.corrections||[]).filter(c=>c.evidenceId===evidence.id||(!c.evidenceId&&c.teachingVersionId===(evidence.teachingVersionId||evidence.activitySnapshot?.teachingVersionId)));
 const action=corrections.at(-1)?.action;const label=action==='invalidate'?'这条评价已撤销':action==='replace'?'原内容已被新版本替代':'这条记录暂不作为能力依据';
 return <div className="evidence-correction" role="note"><strong>{label}</strong><RichText text={standing.reason||'原任务或评价仍待核对。'}/><small>下面展示当时的作答与原评价，保留历史；当前不计入能力统计或作为回访依据。</small>{corrections.length>0&&<details><summary>查看修订记录</summary>{corrections.map(c=><div key={c.id}><p>{timeLabel(c.createdAt)} · {{suspend:'暂停采用',invalidate:'撤销评价',restore:'恢复采用',replace:'新版本替代'}[c.action]}：</p><RichText text={c.reason}/></div>)}</details>}</div>
}

