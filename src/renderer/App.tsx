import ValidationPage from './ValidationPage';
import {flushAdditionalLocalDrafts} from './local-save-queue';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronRight,CircleHelp,FolderOpen,LoaderCircle,Mountain,Plus,RefreshCw,Sprout,X} from 'lucide-react';
import type {RecordInputRequest,RecordedInputReceipt,SessionMode,WorkspaceSnapshot} from '../shared/types';
import {Button,Empty,budgetUsed,isSnapshot,type Page,type Run} from './ui';
import HomePage from './HomePage';
import {RoutePage,SourceReader} from './Materials';
import DeskPage from './DeskPage';
import EvidencePage from './EvidencePage';
import SettingsPage from './SettingsPage';
import AppModal,{type Modal} from './AppModal';
import Sidebar,{navigationPages as pages,useSidebar} from './Sidebar';
import {responseAvailability} from './LearningInputs';
import {createDraftStore} from './draft-store';
import {projectTrashPayload,visibleProjects} from '../shared/projects';
import {ProjectDeleteModal} from './ProjectTrash';

export function ActiveModelControl({snapshot:s,busy,onActivate}:{snapshot:WorkspaceSnapshot;busy:boolean;onActivate:(id:string,name:string)=>void}){
 const profiles=(s.settings.modelProfiles??[]).filter(profile=>profile.enabled),active=profiles.find(profile=>profile.id===s.settings.activeModelProfileId)??profiles[0];
 if(!active)return <div className="active-model-control is-unconfigured"><span>下一次请求使用</span><strong>{s.settings.model||'尚未配置模型'}</strong><small>已有内容保持原版本</small></div>;
 return <label className="active-model-control"><span>下一次请求使用</span><span className="active-model-select"><select aria-label="下一次请求使用的模型配置" value={active.id} disabled={busy} onChange={event=>{const selected=profiles.find(profile=>profile.id===event.target.value);if(selected&&selected.id!==active.id)onActivate(selected.id,selected.name)}}>{profiles.map(profile=><option key={profile.id} value={profile.id} disabled={!profile.hasApiKey}>{profile.name} · {profile.model}{profile.hasApiKey?'':' · 待配置密钥'}</option>)}</select><ChevronDown size={13}/></span><small>已有内容保持原版本</small></label>;
}

export default function App(){
const sidebar=useSidebar();
const[snapshot,setSnapshot]=useState<WorkspaceSnapshot|null>(null);const[page,setPage]=useState<Page>('home');const[projectId,setProjectId]=useState('');const[sessionId,setSessionId]=useState('');const[busy,setBusy]=useState('');const[error,setError]=useState('');const[notice,setNotice]=useState('');const[modal,setModal]=useState<Modal>(null);const[sourceId,setSourceId]=useState<string|null>(null);const[deleteOpen,setDeleteOpen]=useState(false);
const draftTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const[restoreVersion,setRestoreVersion]=useState(0);const[draftStatus,setDraftStatus]=useState('');const[draft,setDraft]=useState('');const operationLock=useRef(false);const pendingRecords=useRef(new Set<Promise<RecordedInputReceipt|undefined>>());
const workspaceEpoch=useRef(0);
const refresh=useCallback(async()=>{const epoch=workspaceEpoch.current;const next=await window.learning.request<WorkspaceSnapshot>('workspace.snapshot');if(epoch!==workspaceEpoch.current)throw new Error('档案已经切换，旧的读取结果未采用。');setSnapshot(next);return next},[]);
useEffect(()=>{if(!window.learning){setError('桌面连接未就绪，请通过“重登”应用打开此页面。');return}void refresh().catch(e=>setError(String(e.message||e)))},[refresh]);
useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(t)}},[notice]);
useEffect(()=>{if(!snapshot)return;const projects=visibleProjects(snapshot.projects);if(!projects.some(p=>p.id===projectId))setProjectId(projects[0]?.id||'');if(sessionId&&!snapshot.sessions.some(s=>s.id===sessionId&&projects.some(project=>project.id===s.projectId)))setSessionId('')},[snapshot,projectId,sessionId]);
const[drafts]=useState(()=>createDraftStore(async captured=>{
 await window.learning.request('session.saveDraft',{id:captured.id,taskId:captured.taskId,stepId:captured.stepId,draft:captured.text});
 setSnapshot(current=>current?{...current,sessions:current.sessions.map(s=>s.id===captured.id?{...s,taskDrafts:captured.taskId?{...s.taskDrafts,[captured.taskId]:captured.text}:s.taskDrafts,...(!captured.taskId||captured.taskId===(s.teaching?.current.taskId||s.activity.id||s.id)?{draft:captured.text}:{})}:s)}:current);
}));
const flushDraft=useCallback(async()=>{if(draftTimer.current)clearTimeout(draftTimer.current);if(drafts.hasDirty())setDraftStatus('正在保存…');try{await drafts.flush();setDraftStatus('已保存到本机')}catch(e){setDraftStatus('保存失败，请重试');throw e}},[drafts]);
const run:Run=useCallback(async(action,payload,success)=>{
 if(operationLock.current)return null;operationLock.current=true;setBusy(action);setError('');setNotice('');
 try{
  await flushDraft();if(action.startsWith('sync.')||action==='backup.restore'){await flushAdditionalLocalDrafts();await Promise.all([...pendingRecords.current]);}
  const result=await window.learning.request<WorkspaceSnapshot|{message:string;restored?:boolean}>(action,payload);
  const restored=(action==='backup.restore'||action==='sync.adopt')&&!isSnapshot(result)&&result.restored===true;
  // The workspace has committed. Discard old bindings before any fallible refresh.
  if(restored){workspaceEpoch.current++;if(draftTimer.current)clearTimeout(draftTimer.current);drafts.clear();setDraft('');setDraftStatus('');setSessionId('');setProjectId('');setSourceId(null);setModal(null);setDeleteOpen(false);setSnapshot(null);setRestoreVersion(v=>v+1);}
  const next=isSnapshot(result)?result:await refresh();setSnapshot(next);
  if(action==='lesson.startFromSources'){const id=(payload as {projectId:string}).projectId,p=next.projects.find(p=>p.id===id),position=next.learningPositions.find(pos=>pos.id===p?.learningPositionId);if(position?.sessionId)setSessionId(position.sessionId);setProjectId(id);setSourceId(null);setPage('desk');}
  if(action==='proposal.adopt'){const proposal=next.learningProposals?.find(p=>p.id===(payload as {proposalId:string}).proposalId),project=next.projects.find(p=>p.id===proposal?.projectId),position=next.learningPositions.find(p=>p.id===project?.learningPositionId);setSessionId(position?.sessionId??'');setPage(position?.sessionId?'desk':'route');}
  if(restored)setProjectId(visibleProjects(next.projects)[0]?.id||'');
  if(success)setNotice(success);else if(!isSnapshot(result)&&result?.message)setNotice(result.message);return next;
 }catch(e){if(action!=='session.respondInput')setError(String((e as Error).message||e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,''));try{await refresh()}catch{}return null}
 finally{operationLock.current=false;setBusy('')}
},[flushDraft,refresh]);
useEffect(()=>{if(!modal&&!sourceId&&!deleteOpen)return;const timer=setTimeout(()=>document.querySelector<HTMLElement>('.modal input:not([disabled]),.modal textarea:not([disabled]),.modal button:not([disabled])')?.focus(),0);const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!operationLock.current){setModal(null);setSourceId(null);setDeleteOpen(false)}if(event.key==='Tab'){const items=[...document.querySelectorAll<HTMLElement>('.modal button:not([disabled]),.modal input:not([disabled]),.modal textarea:not([disabled]),.modal select:not([disabled]),.modal summary')].filter(el=>el.offsetParent!==null);if(!items.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};window.addEventListener('keydown',onKey);return()=>{clearTimeout(timer);window.removeEventListener('keydown',onKey)}},[modal,sourceId,deleteOpen]);
const availableProjects=snapshot?visibleProjects(snapshot.projects):[];
const project=availableProjects.find(p=>p.id===projectId);
const learningPosition=snapshot?.learningPositions.find(position=>position.id===project?.learningPositionId);
const positionedSession=snapshot?.sessions.find(session=>session.id===learningPosition?.sessionId&&session.projectId===projectId);
const legacyLatestSession=!project?.learningPositionId?snapshot?.sessions.filter(session=>session.projectId===projectId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]:undefined;
const currentSession=snapshot?.sessions.find(session=>session.id===sessionId&&session.projectId===projectId)||positionedSession||legacyLatestSession;
useEffect(()=>{const session=currentSession;const taskId=session?.teaching?.current.taskId||session?.activity.id||session?.id;const saved=(taskId?session?.taskDrafts?.[taskId]:undefined)??session?.draft??'';const current=session?drafts.bind({id:session.id,taskId,stepId:session.teaching?.current.id,text:saved}):undefined;setDraft(current?.text||'');setDraftStatus(drafts.hasDirty()?'尚未保存':session?'已保存到本机':'')},[currentSession?.id,currentSession?.teaching?.current.id,currentSession?.teaching?.current.taskId,restoreVersion,drafts]);
useEffect(()=>{const onBlur=()=>{void flushDraft().catch(()=>{})};window.addEventListener('blur',onBlur);window.addEventListener('beforeunload',onBlur);return()=>{window.removeEventListener('blur',onBlur);window.removeEventListener('beforeunload',onBlur)}},[flushDraft]);
useEffect(()=>window.learning?.onCloseRequested?.(async()=>{try{await flushAdditionalLocalDrafts();await flushDraft();await Promise.all([...pendingRecords.current])}catch(e){setError('本机记录还未保存，窗口暂时保持打开。请重试保存。');throw e}}),[flushDraft]);
function changeDraft(value:string){setDraft(value);if(!currentSession)return;drafts.change({id:currentSession.id,taskId:currentSession.teaching?.current.taskId||currentSession.activity.id||currentSession.id,stepId:currentSession.teaching?.current.id,text:value});setDraftStatus('尚未保存');if(draftTimer.current)clearTimeout(draftTimer.current);draftTimer.current=setTimeout(()=>{void flushDraft().catch(e=>setError(String(e.message||e)))},550)}
async function navigate(nextPage:Page,nextProject?:string,nextSession?:string){try{await flushAdditionalLocalDrafts();await flushDraft();await Promise.all([...pendingRecords.current])}catch{setError('草稿尚未保存，请重试保存后再切换。');return}try{await refresh()}catch(e){setError(String((e as Error).message||e));return}if(nextProject)setProjectId(nextProject);if(nextSession)setSessionId(nextSession);else if(nextProject&&nextProject!==projectId)setSessionId('');setPage(nextPage)}
async function reviewSolution(id:string){if(operationLock.current)return;operationLock.current=true;setBusy('session.reviewSolution');setError('');try{await flushDraft();const result=await window.learning.request<{text:string}>('session.reviewSolution',{sessionId:id});await refresh();return result.text}catch(e){setError(String((e as Error).message||e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,''));try{await refresh()}catch{}return undefined}finally{operationLock.current=false;setBusy('')}}
async function respondInput(id:string,inputId:string){if(operationLock.current)return;setSnapshot(current=>current?{...current,sessions:current.sessions.map(session=>session.id===id?{...session,messages:session.messages.map(message=>message.role==='user'&&message.inputId===inputId?{...message,responseState:'running'}:message)}:session)}:current);await run('session.respondInput',{sessionId:id,inputId})}
function recordInput(id:string,input:RecordInputRequest):Promise<RecordedInputReceipt|undefined>{
 const allowImmediateResponse=!operationLock.current;
 const saving=(async()=>{try{
  await flushDraft();
  const receipt=await window.learning.request<RecordedInputReceipt>('session.recordInput',{sessionId:id,...input});
  if(!input.followup)setNotice('已保存在本机。'+(receipt.responseMode==='discussion'?'这条记录可以讨论思路，不作为能力证据。':''));
  let latest:WorkspaceSnapshot|undefined;try{latest=await refresh()}catch{setError('记录已保存，但列表刷新失败。重新打开学习桌后可继续。')}
  if(allowImmediateResponse&&latest&&!operationLock.current&&!responseAvailability(latest,false)&&receipt.responseState!=='completed'&&receipt.responseState!=='running')void respondInput(id,receipt.inputId);
  return receipt;
 }catch(e){throw new Error(String((e as Error).message||e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,''))}})();
 pendingRecords.current.add(saving);void saving.then(()=>pendingRecords.current.delete(saving),()=>pendingRecords.current.delete(saving));return saving;
}
async function startLesson(capabilityId?:string,reviewId?:string,mode?:SessionMode,nearStepId?:string,unitId?:string,newAttempt=false){if(!project)return;const next=await run('lesson.start',{projectId:project.id,capabilityId,reviewId,mode,nearStepId,unitId,newAttempt});if(next){const updatedProject=next.projects.find(item=>item.id===project.id);const position=next.learningPositions.find(item=>item.id===updatedProject?.learningPositionId);const resumed=next.sessions.find(item=>item.id===position?.sessionId)||next.sessions.find(item=>item.dueReviewId===reviewId&&item.status==='active');if(resumed)setSessionId(resumed.id);setPage('desk')}}
async function reviewLesson(reviewId:string){const review=snapshot?.reviews.find(r=>r.id===reviewId);if(!review)return;const next=await run('lesson.start',{projectId:review.projectId,capabilityId:review.capabilityId,reviewId,mode:review.kind});if(next){const newest=next.sessions.find(s=>s.dueReviewId===reviewId&&s.status==='active')||next.sessions.filter(s=>s.projectId===review.projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];setProjectId(review.projectId);if(newest)setSessionId(newest.id);setPage('desk')}}
async function trashCurrentProject(){if(!project)return;const next=await run('project.trash',projectTrashPayload(project.id),'项目已移到最近删除，可在设置中恢复。');if(!next)return;setDeleteOpen(false);setSessionId('');setSourceId(null);setProjectId(visibleProjects(next.projects)[0]?.id||'');setPage('home')}
if(!snapshot)return <div className="startup"><div className="brand-mark"><Mountain size={28}/></div><h1>重登</h1><p>{error||'正在打开你的学习空间…'}</p>{error?<Button onClick={()=>void refresh().catch(e=>setError(e.message))}><RefreshCw size={15}/>重新连接</Button>:<LoaderCircle className="spin"/>}</div>;
const pageTitle=pages.find(p=>p.id===page)?.label;
return <div className="app-shell" style={sidebar.style}><Sidebar snapshot={snapshot} page={page} projectId={projectId} navigate={navigate} onCreate={()=>setModal('project')} layout={sidebar} modalOpen={!!modal||!!sourceId||deleteOpen}/>
<main className="main" tabIndex={-1}><header className="topbar"><div className="breadcrumb">我的空间 <ChevronRight size={13}/> <span>{pageTitle}</span></div><div className="topbar-right"><ActiveModelControl snapshot={snapshot} busy={!!busy} onActivate={(id,name)=>void run('settings.modelProfile.activate',{id},'之后的新请求将使用“'+name+'”；已有路线和题目保持原版本。')}/><span className="local-indicator"><i/>本地保存</span><span className="date">{new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span></div></header><div className="content-wrap">
{error&&<div className="alert error" role="alert"><CircleHelp size={18}/><div><strong>这一步还没有完成</strong><p>{error}</p></div><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={16}/></button></div>}{notice&&<div className="alert success" role="status"><Check size={18}/><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}{busy&&busy!=='session.respondInput'&&<div className="working" role="status"><LoaderCircle className="spin" size={15}/>{busy.startsWith('lesson')?'正在准备适合这一步的学习活动…':busy==='route.generate'?'正在结合目标和材料整理学习路线…':busy.startsWith('session.')?'已保存你的尝试，正在处理…':'正在处理，请稍候…'}</div>}
{page==='home'&&<HomePage snapshot={snapshot} busy={!!busy} onCreate={()=>setModal('project')} navigate={navigate} onSeed={async()=>{const next=await run('sample.seed',{},'内置练习示例已加入，可离线阅读与作答。');const seeded=next?visibleProjects(next.projects)[0]:undefined;if(seeded)setProjectId(seeded.id)}} onReview={reviewLesson} run={run}/>}
{page!=='home'&&page!=='settings'&&<div className="page-heading"><div><span className="eyebrow">{page==='route'?'MAKE A PATH':page==='desk'?'LEARN BY DOING':'EVIDENCE OF GROWTH'}</span><h1>{page==='route'?'让目标，有路可走':page==='desk'?'把这一步，走扎实':page==='validation'?'用独立任务检验学习':'看见真实发生的成长'}</h1><p>{page==='route'?'从材料到能力，每一步都知道为什么。':page==='desk'?'理解、亲自尝试，再一点点放开扶手。':'记录你做到了什么，以及当时得到过多少帮助。'}</p></div><div className="heading-actions">{availableProjects.length>0&&<label className="project-picker"><FolderOpen size={16}/><select aria-label="当前学习项目" value={projectId} onChange={e=>void navigate(page,e.target.value)}>{availableProjects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select><ChevronDown size={14}/></label>}<Button onClick={()=>setModal('project')}><Plus size={15}/>新建项目</Button></div></div>}
{page!=='home'&&page!=='settings'&&!project&&<Empty title="先留下一颗学习的种子" icon={Sprout} action={<Button variant="primary" onClick={()=>setModal('project')}><Plus size={16}/>新建学习项目</Button>}>从想读的材料开始，也可以先说清楚你想拥有的能力。</Empty>}
{page==='route'&&project&&<RoutePage snapshot={snapshot} project={project} busy={!!busy} onStart={startLesson} onSettings={()=>void navigate('settings')} onEdit={()=>setModal('editProject')} onDelete={()=>setDeleteOpen(true)} onFiles={()=>void run('material.importFiles',{projectId})} onUrl={()=>setModal('url')} onText={()=>setModal('text')} onSource={setSourceId} run={run}/>}
{page==='desk'&&project&&<DeskPage snapshot={snapshot} project={project} session={currentSession} onRecord={recordInput} onRespond={respondInput} onSolution={reviewSolution} draft={draft} draftStatus={draftStatus} busy={!!busy} onDraft={changeDraft} onSave={()=>void flushDraft().catch(e=>setError(e.message))} onSelectSession={id=>void navigate('desk',projectId,id)} onStart={startLesson} onSource={setSourceId} run={run} onSettings={()=>void navigate('settings')}/>}
{page==='evidence'&&project&&<EvidencePage snapshot={snapshot} project={project} evidence={snapshot.evidence.filter(e=>e.projectId===projectId)} busy={!!busy} onSource={setSourceId} onSession={id=>void navigate('desk',projectId,id)} onReview={reviewLesson} run={run}/>}
{page==='validation'&&project&&<ValidationPage snapshot={snapshot} project={project} busy={!!busy} run={run} onSession={id=>void navigate('desk',projectId,id)}/>}
{page==='settings'&&<SettingsPage key={'settings-'+restoreVersion} snapshot={snapshot} used={budgetUsed(snapshot)} busy={!!busy} run={run} onRestore={()=>setModal('restore')}/>}
<footer className="page-footer"><Mountain size={14}/> 每一次独立走过的路，都会留下来。<span>重登 · 0.6.0</span></footer>
</div></main>
{modal&&<AppModal error={error} modal={modal} project={project} busy={!!busy} close={()=>setModal(null)} run={run} onCreated={id=>{setProjectId(id);setSessionId('');setPage('route')}}/>}
{deleteOpen&&project&&<ProjectDeleteModal snapshot={snapshot} project={project} busy={!!busy} onCancel={()=>setDeleteOpen(false)} onConfirm={trashCurrentProject}/>}
{sourceId&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSourceId(null)}}><section className="modal source-modal" role="dialog" aria-modal="true" aria-label="原文定位"><div className="modal-heading"><div><span className="eyebrow">BACK TO THE SOURCE</span><h2>回到材料，核对理解</h2></div><button className="icon-button" aria-label="关闭原文" onClick={()=>setSourceId(null)}><X size={20}/></button></div><SourceReader snapshot={snapshot} projectId={snapshot.fragments.find(f=>f.id===sourceId)?.projectId||projectId} focusId={sourceId} run={run} full/></section></div>}
</div>;
}
