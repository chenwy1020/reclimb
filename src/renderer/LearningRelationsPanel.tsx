import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,ChevronDown,GitBranch,History,Search} from 'lucide-react';
import type {Capability,Project,WorkspaceSnapshot} from '../shared/types';
import {buildKnowledgeView,knowledgeMemory,knowledgeUseImpact,type KnowledgeEvidenceView,type KnowledgeGap,type KnowledgeImpact,type KnowledgeRelationKind,type KnowledgeRelationView,type KnowledgeView} from '../shared/knowledge-graph';
import {Badge,Button,evidenceLabels,outcomeLabels,type Run} from './ui';
import {RichText} from './RichText';
import './knowledge-graph.css';

type Navigate=(projectId:string,sessionId?:string)=>void;
const relationLabels:Record<KnowledgeRelationKind,string>={equivalent:'能力对应',related:'内容相关',prerequisite:'前置基础'};
const gapLabels:Record<KnowledgeGap['state'],string>={unverified:'尚未验证',assisted:'帮助后完成',independent:'当前独立表现',prior_pending:'旧项目有独立表现 · 待短验证',needs_review:'依据需要复核'};
const timeLabel=(value:string)=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
interface PanelProps {snapshot:WorkspaceSnapshot;project:Project;capabilityId?:string;busy:boolean;run:Run;onSource:(id:string)=>void;onNavigate?:Navigate;compact?:boolean;}

export default function LearningRelationsPanel({snapshot:s,project,capabilityId,busy,run,onSource,onNavigate,compact=false}:PanelProps){
 const [selection,setSelection]=useState(capabilityId??'');
 const available=s.capabilities.filter(capability=>capability.projectId===project.id&&!capability.archived);
 useEffect(()=>setSelection(capabilityId??''),[project.id,capabilityId]);
 const selected=available.find(capability=>capability.id===selection)??available.find(capability=>capability.id===capabilityId)??available[0];
 return <details className={'knowledge-panel'+(compact?' is-compact':'')}>
  <summary className="knowledge-heading"><span className="knowledge-heading-copy"><span><GitBranch size={19}/><strong>学习关联</strong></span><small>看看哪些旧经验可以带到这里</small></span><ChevronDown size={18}/></summary>
  <div className="knowledge-body">
   <p className="knowledge-boundary">对应关系由你确认。旧表现用于选择下一次短验证，当前能力仍由新的亲自尝试支持。</p>
   {!selected?<p className="knowledge-empty">这里还没有能力目标。从材料开始学习或建立路线后，就能查找相关的旧经验。</p>:<>
    <label className="knowledge-target">查看哪个能力<select aria-label="学习关联的当前能力" value={selected.id} onChange={event=>setSelection(event.target.value)}>{available.map(capability=><option key={capability.id} value={capability.id}>{capability.title}</option>)}</select></label>
    <KnowledgeContent key={project.id+':'+selected.id} snapshot={s} project={project} target={selected} busy={busy} run={run} onSource={onSource} onNavigate={onNavigate}/>
   </>}
  </div>
 </details>;
}

function KnowledgeContent({snapshot:s,project,target,busy,run,onSource,onNavigate}:Omit<PanelProps,'capabilityId'|'compact'>&{target:Capability}){
 const [search,setSearch]=useState(''),[sourceId,setSourceId]=useState(''),[kind,setKind]=useState<KnowledgeRelationKind>('equivalent'),[reason,setReason]=useState('');
 const view=buildKnowledgeView(s,project.id,target.id,search);
 const canCheck=knowledgeMemory(s,project.id,target.id).entries.length>0;
 const currentEvidence=view.evidence.filter(item=>item.evidence.projectId===project.id&&item.evidence.capabilityId===target.id);
 const candidate=view.candidates.find(item=>item.source.id===sourceId)??view.candidates[0];
 const mutable=!busy&&project.status!=='paused';
 const currentGap=view.gaps.find(gap=>!gap.isPrerequisite&&gap.capability.id===target.id);
 function chooseSource(id:string){setSourceId(id);setReason('');setKind('equivalent');}
 return <>
  <div className="knowledge-state"><div><strong>{target.title}</strong>{currentGap&&<Badge tone={currentGap.state==='independent'?'green':currentGap.state==='needs_review'?'amber':'neutral'}>{gapLabels[currentGap.state]}</Badge>}<p>{currentGap?.reason??'暂未找到可判断当前能力的表现。'}</p></div><ShortKnowledgeCheck projectId={project.id} capabilityId={target.id} busy={!mutable||!canCheck} run={run}/></div>
  <p className="knowledge-note">{canCheck?'短验证会调用模型生成并核对新任务。先作答，再记录本次表现；不提前讲解解法。':'确认能力对应，并有可参考的旧独立表现后，可以先做短验证。尚未确认时仍可沿当前路线学习。'}</p>
  {project.status==='paused'&&<p className="knowledge-note">项目已暂停。恢复后可以确认关联或开始短验证；历史记录仍可查看。</p>}
  <section className="knowledge-section"><h3>当前能力与先修缺口</h3><ul className="knowledge-gaps">{view.gaps.map(gap=>{const external=gap.capability.projectId!==project.id;return <li key={gap.capability.id}><div><span>{gap.isPrerequisite?'先修 · ':'当前 · '}{gap.capability.title}{external?'（'+(s.projects.find(item=>item.id===gap.capability.projectId)?.title??'来源项目')+'）':''}</span><Badge tone={gap.state==='needs_review'?'amber':gap.state==='independent'?'green':'neutral'}>{external&&gap.state==='independent'?'来源项目有独立表现':gapLabels[gap.state]}</Badge></div><p>{external?'来源状态：':''}{gap.reason}</p></li>})}</ul></section>
  {currentEvidence.length>0&&<details className="knowledge-section"><summary>当前能力的具体表现 <span>{currentEvidence.length}</span></summary><KnowledgeEvidenceList entries={currentEvidence} snapshot={s} onNavigate={onNavigate}/></details>}
  <section className="knowledge-section"><div className="knowledge-section-title"><h3>从其他项目找一找</h3><Badge>本机查找 · 不调用模型</Badge></div>
   <label className="knowledge-search"><span><Search size={15}/>搜索其他名称</span><input aria-label="搜索其他名称" value={search} maxLength={200} onChange={event=>{setSearch(event.target.value);chooseSource('')}} placeholder="名称不同也可搜索，例如：检查假设"/></label>
   <p className="knowledge-note">名称相近只是候选。请对照行为要求、目标和来源，再决定两者是什么关系。</p>
   {view.candidates.length===0?<p className="knowledge-empty">没有找到候选。可以换一个名称或项目关键词；没有对应关系的部分仍保持未知。</p>:<>
    <div className="knowledge-candidates" role="group" aria-label="跨项目候选能力">{view.candidates.map(item=><button type="button" className={'knowledge-candidate'+(item.source.id===candidate?.source.id?' selected':'')} aria-pressed={item.source.id===candidate?.source.id} key={item.source.id} onClick={()=>chooseSource(item.source.id)}><strong>{item.source.title}</strong><small>{item.sourceProject.title}</small><span>候选 · 待你核对</span></button>)}</div>
    {candidate&&<article className="knowledge-comparison" key={candidate.source.id}>
     <div className="knowledge-definition-grid"><CapabilityDefinition title="来源能力" capability={candidate.source} project={candidate.sourceProject} snapshot={s} onSource={onSource} onNavigate={onNavigate}/><span className="knowledge-compare-arrow" aria-hidden="true"><ArrowRight size={20}/></span><CapabilityDefinition title="当前能力" capability={candidate.target} project={candidate.targetProject} snapshot={s} onSource={onSource}/></div>
     <h4>旧项目留下的具体表现</h4><KnowledgeEvidenceList entries={candidate.evidence} snapshot={s} onNavigate={onNavigate}/>
     <RelationConfirmation projectId={project.id} targetCapabilityId={target.id} sourceCapabilityId={candidate.source.id} kind={kind} reason={reason} busy={!mutable} run={run} onKind={setKind} onReason={setReason} onSaved={()=>{setReason('');setSourceId('')}}/>
    </article>}
   </>}
  </section>
  <section className="knowledge-section"><h3>已作出的关系决定</h3>{view.relations.length?view.relations.map(item=><RelationshipRecord key={item.relation.id} item={item} snapshot={s} busy={!mutable} run={run} onSource={onSource} onNavigate={onNavigate}/>):<p className="knowledge-empty">还没有确认过关系。候选不会自动用于教学。</p>}</section>
  <KnowledgeLocalGraph view={view}/>
  <KnowledgeImpacts impacts={view.impacts} snapshot={s} onNavigate={onNavigate}/>
 </>;
}

function CapabilityDefinition({title,capability,project,snapshot:s,onSource,onNavigate}:{title:string;capability:Capability;project:Project;snapshot:WorkspaceSnapshot;onSource:(id:string)=>void;onNavigate?:Navigate}){
 const units=(s.learningUnits??[]).filter(unit=>unit.projectId===project.id&&unit.capabilityId===capability.id&&unit.status!=='retired'),sourceIds=[...new Set([...capability.sourceIds,...units.flatMap(unit=>unit.sourceIds??[])])];
 return <section className="knowledge-definition"><span className="knowledge-caption">{title} · {project.title}</span><h4>{capability.title}</h4><RichText text={capability.description}/><strong className="knowledge-caption">原学习目标</strong><RichText text={capability.goalContext||project.goal}/>
  {project.learningScope?.suggestedFocus&&<><strong className="knowledge-caption">当前学习范围</strong><RichText text={project.learningScope.suggestedFocus}/></>}
  {capability.goalContext&&capability.goalContext!==project.goal&&<><strong className="knowledge-caption">当前项目目标</strong><RichText text={project.goal}/></>}
  {units.map(unit=><div key={unit.id}><strong className="knowledge-caption">当前单元目标 · {unit.title}</strong>{unit.coreQuestion&&<RichText text={unit.coreQuestion}/>}<dl>{([['目标行为',unit.goal?.behavior??unit.expectedOutcome],['材料范围',unit.goal?.materialScope??(unit.locators??[]).join('、')],['允许的帮助',unit.goal?.allowedHelp],['检验方式',unit.goal?.verification]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd><RichText text={value?.trim()||'尚未单独约定'}/></dd></div>)}</dl></div>)}
  <strong className="knowledge-caption">材料来源</strong><div className="source-links">{sourceIds.length?sourceIds.map(id=>{const fragment=s.fragments.find(item=>item.id===id),material=fragment?s.materials.find(item=>item.id===fragment.materialId):undefined;return fragment?<button type="button" key={id} onClick={()=>onSource(id)}>{material?.title??'材料'} · {fragment.locator}</button>:<span key={id}>原来源暂不可用</span>}):<span className="muted tiny">尚未关联材料</span>}</div>{onNavigate&&<button type="button" className="text-button" onClick={()=>onNavigate(project.id)}>返回来源项目</button>}</section>;
}

export function KnowledgeEvidenceList({entries,snapshot:s,onNavigate}:{entries:KnowledgeEvidenceView[];snapshot:WorkspaceSnapshot;onNavigate?:Navigate}){
 if(!entries.length)return <p className="knowledge-empty">还没有具体表现记录；关联本身不会增加能力证据。</p>;
 return <ul className="knowledge-evidence">{entries.map(({evidence:e,effective,reason,sessionId})=>{
  const attempt=s.attempts.find(item=>item.id===e.attemptId),activity=e.activitySnapshot??attempt?.activitySnapshot;
  const visibleProject=s.projects.some(item=>item.id===e.projectId&&!item.trashedAt),session=s.sessions.find(item=>item.id===sessionId&&item.projectId===e.projectId);
  return <li key={e.id}><div className="knowledge-evidence-meta"><Badge tone={!effective?'amber':e.status==='assisted'?'neutral':'green'}>{effective?evidenceLabels[e.status]:'不作独立依据 · '+evidenceLabels[e.status]}</Badge><span>{timeLabel(e.createdAt)} · 直接帮助 {e.helpLevel}</span><span>{outcomeLabels[e.assessment.outcome]}</span></div>{activity&&<strong>{activity.title}</strong>}<RichText text={e.assessment.feedback}/>{!effective&&<p className="knowledge-warning">{reason||'这条旧依据需要重新核对。'}</p>}{e.assessment.outcome!=='met'&&<p className="knowledge-note">本次尚未达到标准，不能作为独立完成的支持。</p>}{e.assessment.limitations.length>0&&<p className="knowledge-note">原评价保留的限制：{e.assessment.limitations.join('；')}</p>}{onNavigate&&visibleProject&&session?<button type="button" className="text-button" onClick={()=>onNavigate(e.projectId,sessionId)}>查看旧作答</button>:<small className="muted">{visibleProject?'原学习会话暂不可用':'来源项目当前不可用'}</small>}</li>;
 })}</ul>;
}

interface ConfirmationProps {projectId:string;targetCapabilityId:string;sourceCapabilityId:string;kind:KnowledgeRelationKind;reason:string;busy:boolean;run:Run;onKind:(kind:KnowledgeRelationKind)=>void;onReason:(reason:string)=>void;onSaved:()=>void;}
export function RelationConfirmation({projectId,targetCapabilityId,sourceCapabilityId,kind,reason,busy,run,onKind,onReason,onSaved}:ConfirmationProps){
 async function submit(event:FormEvent){event.preventDefault();if(busy||!reason.trim())return;const result=await run('knowledge.confirm',{projectId,targetCapabilityId,sourceCapabilityId,kind,reason:reason.trim()},'关系决定已保存在本机；当前能力仍等待自己的新表现。');if(result)onSaved();}
 return <form className="knowledge-decision" onSubmit={submit}><label>两者是什么关系<select aria-label="关联种类" value={kind} disabled={busy} onChange={event=>onKind(event.target.value as KnowledgeRelationKind)}><option value="equivalent">能力对应：要求相当，可参考旧表现</option><option value="related">内容相关：有联系，但不视为同一能力</option><option value="prerequisite">前置基础：来源能力支持当前目标</option></select></label><p className="knowledge-note">{kind==='equivalent'?'只有你确认的能力对应，才会把有效旧表现作为短验证的背景。':kind==='prerequisite'?'方向是“来源能力 → 当前能力”；前置关系只说明补学方向，不转移能力证据。':'相关关系帮助理解联系，不把旧证据当作当前能力的证据。'}</p><label>为什么这样关联<textarea aria-label="确认关联的理由" value={reason} maxLength={4000} rows={2} disabled={busy} onChange={event=>onReason(event.target.value)} placeholder="说明共同的行为要求、适用条件，以及仍需核对的差别"/></label><Button type="submit" disabled={busy||!reason.trim()}>确认这项关联</Button></form>;
}

export function RelationRetraction({relationId,reason,busy,run,onReason,onSaved}:{relationId:string;reason:string;busy:boolean;run:Run;onReason:(reason:string)=>void;onSaved:()=>void}){
 async function submit(event:FormEvent){event.preventDefault();if(busy||!reason.trim())return;const result=await run('knowledge.retract',{relationId,reason:reason.trim()},'关联已撤回。原决定、旧作答和已经发生的学习过程仍然保留。');if(result)onSaved();}
 return <form className="knowledge-decision" onSubmit={submit}><label>撤回理由<textarea aria-label="撤回关联的理由" rows={2} maxLength={4000} value={reason} disabled={busy} onChange={event=>onReason(event.target.value)} placeholder="例如，两边的条件或目标范围并不相同"/></label><p className="knowledge-note">撤回后停止采用这项对应的旧依据，使用过这些依据的教学会显示复核提示。</p><Button type="submit" disabled={busy||!reason.trim()}>撤回这项关联</Button></form>;
}

function RelationshipRecord({item,snapshot:s,busy,run,onSource,onNavigate}:{item:KnowledgeRelationView;snapshot:WorkspaceSnapshot;busy:boolean;run:Run;onSource:(id:string)=>void;onNavigate?:Navigate}){
 const [reason,setReason]=useState('');
 return <article className="knowledge-record"><div className="knowledge-record-title"><strong>{item.source?.title??'原能力已不可用'} → {item.target?.title??'目标能力已不可用'}</strong><Badge tone={item.effective?'green':item.relation.status==='retracted'?'neutral':'amber'}>{relationLabels[item.relation.kind]} · {item.relation.status==='retracted'?'已撤回':item.effective?'已确认':'需重新确认'}</Badge></div><p>{item.relation.reason}</p><small>{timeLabel(item.relation.createdAt)}</small>{!item.effective&&<p className="knowledge-warning">{item.reason}</p>}
  {item.source&&item.sourceProject&&item.target&&item.targetProject&&<details><summary>对照两端定义与来源</summary><div className="knowledge-definition-grid"><CapabilityDefinition title="来源能力" capability={item.source} project={item.sourceProject} snapshot={s} onSource={onSource} onNavigate={!item.sourceProject.trashedAt?onNavigate:undefined}/><span className="knowledge-compare-arrow" aria-hidden="true"><ArrowRight size={20}/></span><CapabilityDefinition title="当前能力" capability={item.target} project={item.targetProject} snapshot={s} onSource={onSource}/></div></details>}
  <details><summary><History size={14}/>关系决定历史 <span>{item.history.length}</span></summary><ol className="knowledge-history">{item.history.map(decision=><li key={decision.id}><strong>{decision.status==='retracted'?'撤回':'确认'} · {relationLabels[decision.kind]}</strong><small>{timeLabel(decision.createdAt)}</small><p>{decision.reason}</p></li>)}</ol></details>
  {item.relation.status==='confirmed'&&<details><summary>撤回关联</summary><RelationRetraction relationId={item.relation.id} reason={reason} busy={busy} run={run} onReason={setReason} onSaved={()=>setReason('')}/></details>}
 </article>;
}

export function ShortKnowledgeCheck({projectId,capabilityId,busy,run}:{projectId:string;capabilityId:string;busy:boolean;run:Run}){
 return <Button disabled={busy} onClick={()=>{if(!busy)void run('knowledge.check',{projectId,capabilityId},'已准备新的短验证。请先亲自尝试，再核对本次表现。')}}>先做短验证</Button>;
}

export function KnowledgeLocalGraph({view}:{view:KnowledgeView}){
 if(!view.nodes.length)return null;
 const shown=view.nodes.slice(0,16),byId=new Map(view.nodes.map(node=>[node.id,node])),edges=view.edges.filter(edge=>shown.some(node=>node.id===edge.from)&&shown.some(node=>node.id===edge.to)).slice(0,24);
 const column=(kind:string)=>['fragment','material','source'].includes(kind)?0:['attempt','session','teachingVersion','teaching_version'].includes(kind)?1:kind==='evidence'?2:3;
 const counts=[0,0,0,0],positions=new Map(shown.map(node=>{const col=column(node.kind),row=counts[col]++;return [node.id,{x:col*210+8,y:row*86+20}]}));
 const height=Math.max(...counts,1)*86+20;
 return <details className="knowledge-section knowledge-graph"><summary>局部关联图与文字说明</summary><p className="knowledge-note">沿来源、具体作答和证据查看联系；连线不表示能力已经掌握。</p><div className="knowledge-graph-scroll"><svg viewBox={'0 0 840 '+height} aria-hidden="true" focusable="false">{edges.map(edge=>{const from=positions.get(edge.from)!,to=positions.get(edge.to)!;return <g key={edge.id}><path d={'M'+(from.x+185)+','+(from.y+27)+' C'+(from.x+205)+','+(from.y+27)+' '+(to.x-20)+','+(to.y+27)+' '+to.x+','+(to.y+27)}/><text x={(from.x+185+to.x)/2} y={(from.y+to.y)/2+17} textAnchor="middle">{edge.label.slice(0,12)}</text></g>})}{shown.map(node=>{const pos=positions.get(node.id)!;return <g key={node.id}><rect x={pos.x} y={pos.y} width="184" height="55" rx="8"/><text className="knowledge-node-label" x={pos.x+12} y={pos.y+32}>{node.label.length>11?node.label.slice(0,10)+'…':node.label}</text><title>{node.label}</title></g>})}</svg></div><div className="knowledge-text-equivalent"><h4>文字关系与来源</h4>{view.edges.length?<ul>{view.edges.slice(0,40).map(edge=><li key={edge.id}><strong>{byId.get(edge.from)?.label??'原节点不可用'}</strong><span> — {edge.label} → </span><strong>{byId.get(edge.to)?.label??'原节点不可用'}</strong></li>)}</ul>:<p>{shown.map(node=>node.label).join('、')}：尚未建立可显示的关系。</p>}{(view.nodes.length>shown.length||view.edges.length>edges.length)&&<p className="knowledge-note">图中只展示附近的一部分节点；文字保留关系名称，具体依据可在上方记录中展开。</p>}</div></details>;
}

export function KnowledgeImpacts({impacts,snapshot:s,onNavigate}:{impacts:KnowledgeImpact[];snapshot:WorkspaceSnapshot;onNavigate?:Navigate}){
 if(!impacts.length)return null;
 return <section className="knowledge-section knowledge-impacts"><h3>这些依据曾用于哪些教学</h3><p className="knowledge-note">复核提示只说明旧背景是否仍适用，不会抹去你后来真实完成的作答。</p>{impacts.map(impact=>{const session=knowledgeUseSession(s,impact.use),version=s.teachingVersions.find(item=>item.id===impact.use.teachingVersionId);return <article key={impact.use.id} className={!impact.effective?'needs-review':''}><Badge tone={impact.effective?'neutral':'amber'}>{impact.effective?'原参考仍有效':'旧依据需要复核'}</Badge><strong>{version?.activity.title??session?.activity.title??'历史教学记录'}</strong><small>{timeLabel(impact.use.createdAt)}</small>{impact.reasons.map(reason=><p key={reason}>{reason}</p>)}<details><summary>当时实际参考的旧表现</summary><ul>{impact.use.entries.map(entry=><li key={entry.relationId+entry.evidenceId}><strong>{entry.sourceProjectTitle} · {entry.sourceCapabilityTitle}</strong><p>{entry.summary}</p><small>{timeLabel(entry.performedAt)} · 直接帮助 {entry.helpLevel}</small></li>)}</ul></details>{session&&onNavigate&&<button type="button" className="text-button" onClick={()=>onNavigate(session.projectId,session.id)}>查看受影响教学</button>}</article>})}</section>;
}

function knowledgeUseSession(snapshot:WorkspaceSnapshot,use:KnowledgeImpact['use']){
 return snapshot.sessions.find(session=>{
  if(session.projectId!==use.projectId||session.capabilityId!==use.targetCapabilityId)return false;
  const teaching=session.teaching,steps=teaching?[teaching.current,...(teaching.upcoming??[]),...(teaching.history??[]),...(teaching.returnStep?[teaching.returnStep]:[]),...(teaching.returnUpcoming??[])]:[];
  const versions=[session.teachingVersionId,session.activity.teachingVersionId,...steps.flatMap(step=>[step.teachingVersionId,step.activity?.teachingVersionId])];
  return versions.some(id=>teachingLineage(snapshot,id,use.projectId,use.targetCapabilityId).has(use.teachingVersionId));
 });
}

export function KnowledgeImpactNotice({snapshot:s,projectId,capabilityId,teachingVersionId}:{snapshot:WorkspaceSnapshot;projectId:string;capabilityId:string;teachingVersionId?:string}){
 const lineage=teachingLineage(s,teachingVersionId,projectId,capabilityId);
 if(!lineage.size||(s.knowledgeUses??[]).every(use=>!lineage.has(use.teachingVersionId)))return null;
 const impacts=(s.knowledgeUses??[]).filter(use=>use.projectId===projectId&&use.targetCapabilityId===capabilityId&&lineage.has(use.teachingVersionId)).map(use=>knowledgeUseImpact(s,use)).filter(impact=>!impact.effective);
 if(!impacts.length)return null;
 return <aside className="knowledge-impact-notice" role="status"><strong>这次教学用过的旧依据需要复核</strong>{[...new Set(impacts.flatMap(impact=>impact.reasons))].map(reason=><p key={reason}>{reason}</p>)}<p>原作答和新产生的表现仍保留。请展开“学习关联”查看来源，再决定怎样继续。</p></aside>;
}

function teachingLineage(snapshot:WorkspaceSnapshot,versionId?:string,projectId?:string,capabilityId?:string):Set<string>{
 const visited=new Set<string>();let current=versionId;
 while(current&&!visited.has(current)){const version=snapshot.teachingVersions.find(version=>version.id===current);if(version&&((projectId&&version.projectId!==projectId)||(capabilityId&&version.capabilityId!==capabilityId)))break;visited.add(current);current=version?.replacesVersionId;}
 return visited;
}
