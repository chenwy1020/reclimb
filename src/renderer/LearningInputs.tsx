import type {Session,WorkspaceSnapshot} from '../shared/types';
import {FollowupBox} from './FollowupBox';
import {InputRecord} from './InputRecord';
import {hasInlineHome} from './followup-placement';
import type {RespondToInput,RecordLocalInput} from './InputStatus';
export {LocalRecordNotice,responseAvailability} from './InputStatus';
export type {RecordLocalInput,RespondToInput} from './InputStatus';
export function InputHistory({snapshot,session,busy,onRespond,onSettings,onSource,onRecord}:{snapshot:WorkspaceSnapshot;session:Session;busy:boolean;onRespond:RespondToInput;onSettings:()=>void;onSource:(id:string)=>void;onRecord:RecordLocalInput}){
 const entries=session.messages.filter(m=>m.role==='user'&&!m.handwritingId&&m.inputId&&!hasInlineHome(m,session,snapshot)&&!(m.attemptId&&snapshot.attempts.some(a=>a.id===m.attemptId&&a.assessment))).slice().reverse();
 if(!entries.length)return null;
 return <section className="input-records" aria-label="已保存的学习记录"><div className="section-heading"><h3>已经留下的想法</h3><span className="muted tiny">记录先保存在本机</span></div>{entries.map(m=><div key={m.inputId}>{m.followup&&<p className="quiet-note">原入口暂不可定位，以下保留当时的问题与回应。</p>}<InputRecord message={m} session={session} snapshot={snapshot} busy={busy} onRespond={onRespond} onSettings={onSettings} onSource={onSource} renderFollowup={r=><FollowupBox sessionId={session.id} anchor={{kind:'message',id:r.id}} title={r.text.slice(0,70)} snapshot={snapshot} busy={busy} onRecord={onRecord} onRespond={onRespond} onSettings={onSettings} onSource={onSource} composerOnly={!!m.followup} allowExample/>}/></div>)}</section>;
}
