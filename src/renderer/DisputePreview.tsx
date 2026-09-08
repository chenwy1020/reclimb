import type {WorkspaceSnapshot} from '../shared/types';
import type {Dispute,TeachingVersion} from '../shared/reliability';
import {Button,timeLabel} from './ui';
import {RichText} from './RichText';

export default function DisputePreview({snapshot:s,dispute:d,original,busy,onCancel,onConfirm}:{
 snapshot:WorkspaceSnapshot;dispute:Dispute;original?:TeachingVersion;busy:boolean;onCancel:()=>void;onConfirm:()=>void;
}){
 const teaching=s.sessions?.find(session=>session.id===d.sessionId)?.teaching;const seenIds=new Set([...(teaching?.history||[]).map(step=>step.id),teaching?.current.id]);
 const visibleSteps=original?.steps.filter(step=>seenIds.has(step.id))||[];const hiddenSteps=(original?.steps.length||0)-visibleSteps.length;
 const evidence=s.evidence.filter(e=>e.projectId===d.projectId&&(e.teachingVersionId===d.teachingVersionId||e.activitySnapshot?.teachingVersionId===d.teachingVersionId));
 return <div className="dispute-send-preview" aria-label="核查发送范围">
  <h4>这次会发送哪些内容</h4>
  <p>接收方：{s.settings.providerName} · {s.settings.model}。核查会发送下面的内容，计入本机预算；不含其它项目资料。</p>
  <details><summary>当前题目、讲解及所引材料摘录</summary>
   {original?<><RichText text={original.activity.instruction}/>{original.activity.rubric.map((r,i)=><RichText key={i} text={r}/>)}{visibleSteps.map(st=><RichText key={st.id} text={st.content}/>)}{hiddenSteps>0&&<p>{hiddenSteps} 步已准备的教学内容也会随这一冻结版本发送；这里不提前展示尚未学习的示范。</p>}{original.sources.map(source=><article key={source.id}><strong>{source.locator}</strong><RichText text={source.text}/></article>)}</>:<p>未找到对应版本，暂时不能发送核查。</p>}
  </details>
  <details><summary>这个问题的质疑记录</summary>{d.messages.map(m=><RichText key={m.id} text={m.text}/>)}</details>
  <details><summary>同版本的作答与相关评价（{evidence.length} 条）</summary>
   {evidence.length?evidence.map(e=>{const attempt=s.attempts.find(a=>a.id===e.attemptId);return <article key={e.id}>
    <strong>{attempt?.submittedAt?timeLabel(attempt.submittedAt)+' 的尝试':'相关作答'}</strong><RichText text={attempt?.text||'未找到关联作答'}/><RichText text={e.assessment.feedback}/>
    {e.assessment.criteria.map((c,i)=><RichText key={i} text={c.criterion+'：'+c.reason}/>)}{e.assessment.limitations.map((text,i)=><RichText key={i} text={text}/>)}
   </article>}):<p>这一版本还没有关联的已评价作答。</p>}
  </details>
  <div className="transcription-actions"><Button disabled={busy} onClick={onCancel}>继续只保存在本机</Button><Button variant="primary" disabled={busy||!original} onClick={onConfirm}>发送这些内容并核对</Button></div>
 </div>
}
