import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {CallRunner} from '../src/main/call-runner';
import {VerificationService} from '../src/main/verification-service';
import {HandwritingService} from '../src/main/handwriting-service';
import {HandwritingFeedbackService} from '../src/main/handwriting-recognition';
import {seedSamples} from '../src/main/samples';
import {writeBackup,readBackup} from '../src/main/backup';
import {followupsForAnchor,hasInlineHome} from '../src/renderer/followup-placement';

const stores:LearningStore[]=[];afterEach(()=>stores.splice(0).forEach(s=>s.close()));
async function fixture(versioned:boolean){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-ink-followup-')));stores.push(store);seedSamples(store);store.updateSettings({monthlyBudgetCny:100});
 let session=store.get('sessions','sample-reasoning-session')!;const verifier=new VerificationService(store,new CallRunner(store,()=>''));
 if(versioned){const version=verifier.createVersion({projectId:session.projectId,capabilityId:session.capabilityId,activity:session.activity,steps:[],sources:session.activity.sourceIds.map(id=>{const f=store.get('fragments',id)!;return{id,locator:f.locator,text:f.text,warnings:[],transcriptionIds:[]}})});session={...session,activity:version.activity,teachingVersionId:version.id};store.put('sessions',session)}
 const hand=new HandwritingService(store),target=hand.target(session.id),saved=hand.save({requestId:'ink-original',targetId:target.id,note:'图上箭头是我的说明。',pages:[{id:'page',width:768,height:1024,strokes:[{id:'stroke',color:'#253e31',width:3,points:[{x:.2,y:.3,pressure:.5}]}]}]});
 const calls:any[]=[],learning=new LearningService(store,()=> 'test-key',()=>({complete:async request=>{const input=JSON.parse(request.user);calls.push(input);return{text:JSON.stringify({text:input.operation==='discuss_followup'?'这次原稿支线的具体支持。':'针对确认文字的第一条回应。',sourceIds:(input.sources??[]).map((s:any)=>s.id),scope:'current_task'}),inputTokens:10,outputTokens:10,usageKnown:true}}}));
 const feedback=new HandwritingFeedbackService(store,learning,new CallRunner(store,()=>''),()=>''),confirmed=feedback.confirm({handwritingId:saved.id,requestId:'confirmed',text:'我写出的原始推导，还有一个符号不确定。',unresolved:true});await feedback.respond(saved.id,confirmed.receipt.inputId);
 const first=feedback.responses(saved.id).find(m=>m.role==='assistant')!;
 return {store,session,target,saved,learning,verifier,feedback,confirmed,first,calls};
}
it.each([false,true])('keeps an inline multiround handwritten branch tied to the original (%s)',async versioned=>{
 const t=await fixture(versioned),before=t.store.get('sessions',t.session.id)!,count=t.calls.length;
 const root=t.learning.recordInput(t.session.id,{requestId:'followup-one',kind:'explore',text:'请解释我原稿回应中的这一步。',followup:{kind:'message',id:t.first.id,intent:'question'}});
 expect(t.calls.length).toBe(count);expect(t.store.get('sessions',t.session.id)?.helpEvents).toEqual(before.helpEvents);
 await t.feedback.respond(t.saved.id,root.inputId);const response=t.feedback.responses(t.saved.id).find(m=>m.role==='assistant'&&m.inputId===root.inputId)!;
 const child=t.learning.recordInput(t.session.id,{requestId:'followup-two',kind:'explore',text:'再给一个实质不同的例子。',followup:{kind:'message',id:response.id,intent:'example'}});await t.feedback.respond(t.saved.id,child.inputId);
 const current=t.store.get('sessions',t.session.id)!,rootMessage=current.messages.find(m=>m.inputId===root.inputId&&m.role==='user')!,childMessage=current.messages.find(m=>m.inputId===child.inputId&&m.role==='user')!;
 expect(rootMessage).toMatchObject({handwritingId:t.saved.id,handwritingTranscriptionId:t.confirmed.transcription.id,taskId:t.target.taskId,responseMode:'discussion'});expect(childMessage.followup?.rootInputId).toBe(root.inputId);
 expect(t.feedback.responses(t.saved.id)).toHaveLength(6);expect(followupsForAnchor(current,{kind:'message',id:t.first.id}).map(m=>m.inputId)).toEqual([root.inputId,child.inputId]);expect(hasInlineHome(rootMessage,current,t.store.snapshot())).toBe(true);
 expect(followupsForAnchor(current,{kind:'message',id:response.id})).toEqual([]);expect(current.draft).toBe(before.draft);expect(current.checkpoint).toBe(before.checkpoint);expect(t.store.list('evidence')).toEqual([]);
 expect(current.helpEvents.at(-1)?.taskId).toBe(t.target.taskId);expect(t.calls.at(-1).handwritingContext).toMatchObject({originalNote:'图上箭头是我的说明。',unresolved:true});
 const file=join(t.store.dataDirectory,'roundtrip.reclimb');writeBackup(t.store,file);const restored=readBackup(file),restoredSession=restored.records.sessions.find(s=>s.id===t.session.id)!;expect(restoredSession.messages.find(m=>m.id===childMessage.id)?.followup?.rootInputId).toBe(root.inputId);
 const zip=new AdmZip(file),manifest=JSON.parse(zip.readAsText('manifest.json'));manifest.records.sessions.find((s:any)=>s.id===t.session.id).messages.find((m:any)=>m.id===childMessage.id).followup.parentMessageId='missing-parent';zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));writeFileSync(file+'.bad',zip.toBuffer());expect(()=>readBackup(file+'.bad')).toThrow();
});
it('does not infer an unversioned handwritten task from a later matching version and keeps active-task help separate',async()=>{
 const t=await fixture(false),previous=t.store.get('sessions',t.session.id)!,activity={...previous.activity,id:t.target.taskId,instruction:'LATER_TASK_ONLY: 不属于原稿的新要求'};
 const version=t.verifier.createVersion({projectId:previous.projectId,capabilityId:previous.capabilityId,activity,steps:[],sources:[]});
 t.store.put('sessions',{...previous,activity:version.activity,teachingVersionId:version.id,draft:'LATER_DRAFT_ONLY',helpLevel:0});
 const record=t.learning.recordInput(previous.id,{requestId:'legacy-question',kind:'explore',text:'回到我的原稿再讲讲',followup:{kind:'message',id:t.first.id,intent:'question'}});await t.feedback.respond(t.saved.id,record.inputId);
 const input=t.calls.at(-1);expect(input.anchor.teachingVersionId).toBeUndefined();expect(input.anchor.contextWarning).toContain('没有可核对');expect(input.activity).toBeUndefined();expect(input.legacyDiscussion.originalTask.instruction).toBe(t.target.instruction);expect(input.legacyDiscussion.originalTask.id).toBe(t.target.id);expect(JSON.stringify(input)).not.toContain('LATER_TASK_ONLY');expect(JSON.stringify(input)).not.toContain('LATER_DRAFT_ONLY');
 expect(t.store.get('sessions',previous.id)?.helpLevel).toBe(0);expect(t.store.list('answerExposures').at(-1)).toMatchObject({taskId:t.target.taskId});expect(t.store.list('evidence')).toEqual([]);
});
it('leaves a saved handwritten followup pending when no budget is available',async()=>{
 const t=await fixture(true),count=t.calls.length;t.store.updateSettings({monthlyBudgetCny:0});const record=t.learning.recordInput(t.session.id,{requestId:'offline-question',kind:'explore',text:'先保留这个疑问。',followup:{kind:'message',id:t.first.id,intent:'question'}});await expect(t.feedback.respond(t.saved.id,record.inputId)).rejects.toThrow('预算');
 expect(t.calls.length).toBe(count);expect(t.feedback.responses(t.saved.id).find(m=>m.inputId===record.inputId)).toMatchObject({text:'先保留这个疑问。',responseState:'failed'});
});
it('rejects a backup that grafts a handwritten branch onto a different original with the same task and response text',async()=>{
 const t=await fixture(true),hand=new HandwritingService(t.store),other=hand.save({requestId:'other-original',targetId:t.target.id,note:'另一张原稿',pages:[{id:'other-page',width:768,height:1024,strokes:[{id:'other-stroke',color:'#253e31',width:3,points:[{x:.3,y:.2,pressure:.5}]}]}]});
 const confirmed=t.feedback.confirm({handwritingId:other.id,requestId:'other-confirmation',text:'同题另一份独立原稿',unresolved:true});await t.feedback.respond(other.id,confirmed.receipt.inputId);const otherReply=t.feedback.responses(other.id).find(m=>m.role==='assistant')!;expect(otherReply.text).toBe(t.first.text);
 const record=t.learning.recordInput(t.session.id,{requestId:'graft-question',kind:'explore',text:'原稿这一步是什么意思？',followup:{kind:'message',id:t.first.id,intent:'question'}}),file=join(t.store.dataDirectory,'grafted.reclimb');writeBackup(t.store,file);expect(()=>readBackup(file)).not.toThrow();
 const zip=new AdmZip(file),manifest=JSON.parse(zip.readAsText('manifest.json')),input=manifest.records.sessions.find((s:any)=>s.id===t.session.id).messages.find((m:any)=>m.inputId===record.inputId);input.followup.parentMessageId=otherReply.id;input.followup.id=otherReply.id;zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));writeFileSync(file,zip.toBuffer());expect(()=>readBackup(file)).toThrow('手写追问的父链没有回到这份已确认原稿');
});
