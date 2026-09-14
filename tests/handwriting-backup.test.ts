import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {HandwritingService} from '../src/main/handwriting-service';
import {VerificationService} from '../src/main/verification-service';
import {CallRunner} from '../src/main/call-runner';
import {writeBackup,readBackup,prepareRestore} from '../src/main/backup';
import {readableExport} from '../src/main/readable-export';
import type {InkPage} from '../src/shared/handwriting';

const cleanups:(()=>void)[]=[];
afterEach(()=>cleanups.splice(0).reverse().forEach(cleanup=>cleanup()));
const pages:InkPage[]=[{id:'page-1',width:768,height:1024,strokes:[{id:'stroke-1',color:'#253e31',width:2,points:[{x:0.1,y:0.2,pressure:0.5},{x:0.4,y:0.6,pressure:0.8}]}]},{id:'page-2',width:768,height:1024,strokes:[{id:'dot',color:'#245b96',width:3,points:[{x:0.2,y:0.4,pressure:0.3}]}]}];
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'reclimb-handwriting-backup-'));
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=await LearningStore.open(join(root,'source'));cleanups.push(()=>store.close());
 const now='2026-09-01T01:00:00.000Z';
 for(const id of ['p','other']){
  store.put('projects',{id,title:id==='p'?'自编路径比较':'另一项目',goal:'写下自己的推导',status:'active',createdAt:now,updatedAt:now});
  store.put('capabilities',{id:id+'-c',projectId:id,title:'比较',description:'说明依据',prerequisites:[],sourceIds:[],order:0});
 }
 const file=join(store.dataDirectory,'own.txt');writeFileSync(file,'比较路径上的最大值。');
 store.put('materials',{id:'m',projectId:'p',title:'自编材料',kind:'txt',originalName:'own.txt',storedPath:file,importedAt:now,warnings:[],fragmentCount:1,summary:'比较'});
 store.put('fragments',{id:'f',projectId:'p',materialId:'m',locator:'第 1 段',text:'比较路径上的最大值。',ordinal:0,pageNumber:1});
 store.put('sourceTranscriptions',{id:'transcription-1',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'比较路径上的最大值。',status:'confirmed',createdAt:now,confirmedAt:now,origin:'manual',uncertainties:[]});
 const verifier=new VerificationService(store,new CallRunner(store,()=>{throw new Error('No AI call is allowed');}));
 const activity={id:'task',title:'比较两条路径',instruction:'画出两条路径并写下比较理由。',kind:'application' as const,rubric:['说明理由'],sourceIds:['f'],sourceVersions:[{fragmentId:'f',transcriptionIds:['transcription-1']}],assessmentBasis:'ai' as const};
 const version=verifier.createVersion({projectId:'p',capabilityId:'p-c',activity,steps:[{id:'step',taskId:'task',action:'attempt',title:'我的推导',content:'可以画图辅助思考。',sourceIds:['f'],activity,createdAt:now}],sources:[{id:'f',locator:'第 1 段',text:'比较路径上的最大值。',transcriptionIds:['transcription-1'],warnings:[]}]});
 store.put('sessions',{id:'s',projectId:'p',capabilityId:'p-c',activity:version.activity,teachingVersionId:version.id,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'电脑上尚未提交的文字',helpLevel:1,helpEvents:[{id:'help',kind:'hint',level:1,createdAt:now,taskId:'task'}],messages:[],checkpoint:'原步骤',nextStep:'继续',teaching:{version:1,current:version.steps[0],history:[],upcoming:[],guidance:'supported',confusionCount:0}});
 const otherActivity={...activity,id:'other-task',sourceIds:[],sourceVersions:[]};
 store.put('sessions',{id:'other-s',projectId:'other',capabilityId:'other-c',activity:otherActivity,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:''});
 const service=new HandwritingService(store),target=service.target('s'),receipt=service.save({requestId:'submission-1',targetId:target.id,pages,note:'这是我自己画的路径。'}),original=store.get('handwritings',receipt.id)!;
 const archive=join(root,'original.reclimb');writeBackup(store,archive);
 return {root,store,service,target,original,version,archive};
}
function changeArchive(path:string,change:(manifest:any,zip:AdmZip)=>void):string{
 const zip=new AdmZip(path),manifest=JSON.parse(zip.readAsText('manifest.json'));change(manifest,zip);zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));const altered=path+'.altered';writeFileSync(altered,zip.toBuffer());return altered;
}

it('keeps pages out of the manifest and restores originals, frozen sources, help and the main draft after task changes',async()=>{
 const t=await fixture(),session=t.store.get('sessions','s')!;
 const verifier=new VerificationService(t.store,new CallRunner(t.store,()=>'')),activity={...session.activity,id:'new-task',title:'后续综合任务',instruction:'连接另一概念。'};
 const next=verifier.createVersion({projectId:'p',capabilityId:'p-c',activity,steps:[{...session.teaching!.current,id:'next-step',taskId:'new-task',title:'后续综合任务',activity}],sources:t.version.sources});
 t.store.put('sessions',{...session,activity:next.activity,teachingVersionId:next.id,teaching:{...session.teaching!,current:next.steps[0],history:[session.teaching!.current]}});
 t.store.put('answerExposures',{id:'later-answer',projectId:'p',sessionId:'s',capabilityId:'p-c',taskId:'task',teachingVersionId:t.version.id,kind:'answer',text:'后来才查看的答案',createdAt:'2099-01-01T00:00:00.000Z'});
 writeBackup(t.store,t.archive);
 const zip=new AdmZip(t.archive),manifestText=zip.readAsText('manifest.json'),manifest=JSON.parse(manifestText);
 expect(manifest.version).toBe(9);expect(manifest.records.handwritings[0].pages).toBeUndefined();expect(manifestText).not.toContain('"points"');expect(manifest.handwritingFiles).toHaveLength(1);
 expect(JSON.parse(zip.readAsText(manifest.handwritingFiles[0].entry))).toEqual(pages);
 expect(manifestText).not.toMatch(/pollToken|pairingTicket|Bearer|hasApiKey/);
 const destination=join(t.root,'restored');await prepareRestore(t.archive,destination);const restored=await LearningStore.open(destination);cleanups.push(()=>restored.close());
 expect(restored.get('handwritings',t.original.id)).toEqual(t.original);
 expect(restored.get('handwritingTargets',t.target.id)).toEqual(t.target);
 expect(restored.get('sessions','s')?.draft).toBe('电脑上尚未提交的文字');expect(restored.get('sessions','s')?.activity.id).toBe('new-task');
 expect(restored.get('sourceTranscriptions','transcription-1')?.status).toBe('confirmed');expect(restored.list('evidence')).toEqual([]);expect(restored.list('attempts')).toEqual([]);
 expect(new HandwritingService(restored).save({requestId:'submission-1',targetId:t.target.id,pages,note:t.original.note}).id).toBe(t.original.id);
});

it('exports portable original ink and attribution without creating recognition or assessment',async()=>{
 const t=await fixture(),text=readableExport(t.store.snapshot(),'p');
 expect(text).toContain('学习者手写原稿：我的推导');expect(text).toContain('未识别、未评价');expect(text).toContain(t.version.id);expect(text).toContain('提交时帮助：1');expect(text).toContain('transcription-1');expect(text).toContain('第 1 段');expect(text).toContain('这是我自己画的路径。');
 const image=text.match(/!\[学习者手写原稿，第 1 页\]\((data:image\/svg\+xml;charset=utf-8,[^)]+)\)/)?.[1];expect(image).toBeDefined();const svg=decodeURIComponent(image!.split(',')[1]);expect(svg).toContain('<path');expect(svg).not.toMatch(/<script|foreignObject|href=/);expect(text).toContain('第 2 页');
 expect(readableExport(t.store.snapshot(),'other')).not.toContain(t.original.id);
});

it.each([1,2,3,4,5,6,7])('restores format %i with empty handwriting collections and does not infer originals',async version=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-old-handwriting-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const store=await LearningStore.open(join(root,'source'));cleanups.push(()=>store.close());
 const archive=join(root,'empty.reclimb');writeBackup(store,archive);
 const old=changeArchive(archive,manifest=>{manifest.version=version;delete manifest.handwritingFiles;delete manifest.records.handwritings;delete manifest.records.handwritingTargets;});
 const parsed=readBackup(old);expect(parsed.records.handwritings).toEqual([]);expect(parsed.records.handwritingTargets).toEqual([]);
});

it.each([
 ['different project',(m:any)=>{m.records.handwritings[0].projectId='other';}],
 ['different session',(m:any)=>{m.records.handwritings[0].sessionId='other-s';}],
 ['missing target',(m:any)=>{m.records.handwritings[0].targetId='absent';}],
 ['forged task',(m:any)=>{m.records.handwritingTargets[0].taskId='new-task';}],
 ['forged step',(m:any)=>{m.records.handwritingTargets[0].stepId='missing-step';}],
 ['removed teaching version',(m:any)=>{delete m.records.handwritingTargets[0].teachingVersionId;}],
 ['forged source version',(m:any)=>{m.records.handwritingTargets[0].sourceVersions[0].transcriptionIds=[];}],
 ['changed target instruction',(m:any)=>{m.records.handwritingTargets[0].instruction='另一题';}],
 ['lost help',(m:any)=>{m.records.handwritings[0].helpLevel=0;}],
 ['changed note',(m:any)=>{m.records.handwritings[0].note='被修改了';}],
 ['forged request id',(m:any)=>{m.records.handwritings[0].requestId='another-request';}],
 ['submission predating the target',(m:any)=>{m.records.handwritings[0].submittedAt='2000-01-01T00:00:00.000Z';}],
 ['capability evidence masquerading as ink',(m:any)=>{m.records.handwritings[0].status='independent';}],
 ['credential in an ink record',(m:any)=>{m.records.handwritings[0].pairingToken='must-not-restore';}],
 ['unsafe ink entry',(m:any)=>{m.handwritingFiles[0].entry='materials/../secret.json';}],
 ['missing original',(m:any,z:AdmZip)=>{z.deleteFile(m.handwritingFiles[0].entry);}],
 ['wrong original checksum',(m:any)=>{m.handwritingFiles[0].sha256='a'.repeat(64);}],
] as const)('rejects %s before touching the destination',async(_name,change)=>{
 const t=await fixture(),before=readFileSync(t.archive);expect(()=>readBackup(changeArchive(t.archive,change))).toThrow();expect(readFileSync(t.archive)).toEqual(before);
});

it('rejects a duplicate request even when its record and ZIP entry have distinct identifiers',async()=>{
 const t=await fixture();const invalid=changeArchive(t.archive,(m,z)=>{const original=m.records.handwritings[0],file=m.handwritingFiles[0],duplicate={...original,id:'duplicate'},entry='handwriting/duplicate.json';m.records.handwritings.push(duplicate);z.addFile(entry,z.getEntry(file.entry)!.getData());m.handwritingFiles.push({...file,handwritingId:duplicate.id,entry});});
 expect(()=>readBackup(invalid)).toThrow('重复提交编号');
});

it('validates ink shape even if someone recalculates the ZIP checksum',async()=>{
 const t=await fixture(),invalid=changeArchive(t.archive,(m,z)=>{const file=m.handwritingFiles[0],pages=JSON.parse(z.readAsText(file.entry));pages[0].strokes[0].points[0].x=2;const bytes=Buffer.from(JSON.stringify(pages));z.updateFile(file.entry,bytes);file.sha256=hash(bytes);});
 expect(()=>readBackup(invalid)).toThrow();
});

it('preserves a valid backup if stored ink metadata is corrupted',async()=>{
 const t=await fixture(),before=readFileSync(t.archive);
 // Emulate imported corrupt state through a snapshot, without mutating append-only records.
 const snapshot=t.store.snapshot();snapshot.handwritings![0].targetId='absent';
 expect(()=>writeBackup({snapshot:()=>snapshot} as LearningStore,t.archive)).toThrow();expect(readFileSync(t.archive)).toEqual(before);
});

it('restores a response step absent from the frozen version through the preserved session history',async()=>{
 const t=await fixture(),session=t.store.get('sessions','s')!,feedback={id:'feedback-step',taskId:'task',teachingVersionId:t.version.id,action:'feedback' as const,title:'接着说明你的想法',content:'试着画出你认为缺少的部分。',sourceIds:['f'],createdAt:new Date().toISOString()};
 t.store.put('sessions',{...session,teaching:{...session.teaching!,current:feedback,history:[session.teaching!.current]}});
 const target=t.service.target('s'),receipt=t.service.save({targetId:target.id,requestId:'feedback-original',pages,note:'回应反馈'});
 const later=t.store.get('sessions','s')!;t.store.put('sessions',{...later,teaching:{...later.teaching!,current:session.teaching!.current,history:[feedback]}});
 writeBackup(t.store,t.archive);const restored=readBackup(t.archive);
 expect(restored.records.handwritingTargets?.find(item=>item.id===target.id)?.stepId).toBe(feedback.id);expect(restored.records.handwritings?.find(item=>item.id===receipt.id)?.note).toBe('回应反馈');
});

it('preserves a legacy unversioned task using its original activity and session identifier',async()=>{
 const t=await fixture(),session=t.store.get('sessions','s')!,{id:_task,teachingVersionId:_version,rubricIds:_criteria,sourceVersions:_sources,...activity}=session.activity;
 t.store.put('sessions',{...session,id:'legacy-s',activity,teachingVersionId:undefined,teaching:undefined,helpEvents:[],helpLevel:0});
 const target=t.service.target('legacy-s'),receipt=t.service.save({targetId:target.id,requestId:'legacy-original',pages,note:'旧任务也可以保存原稿'});
 writeBackup(t.store,t.archive);const restored=readBackup(t.archive);
 expect(restored.records.handwritingTargets?.find(item=>item.id===target.id)).toMatchObject({sessionId:'legacy-s',taskId:'legacy-s'});expect(restored.records.handwritings?.find(item=>item.id===receipt.id)?.status).toBe('saved_unassessed');
});

it('restores an unversioned original after the session advances without retaining the old activity',async()=>{
 const t=await fixture(),session=t.store.get('sessions','s')!,{teachingVersionId:_version,rubricIds:_criteria,...activity}=session.activity;
 t.store.put('sessions',{...session,id:'legacy-s',activity,teachingVersionId:undefined,teaching:undefined,helpEvents:[],helpLevel:0});
 const target=t.service.target('legacy-s');
 t.store.put('sessions',{...t.store.get('sessions','legacy-s')!,activity:{...activity,id:'later-task',title:'后来的新题目',instruction:'另一道题，不能用来覆盖旧题。'},draft:'新题草稿'});
 const receipt=t.service.save({targetId:target.id,requestId:'old-task-after-advance',pages,note:'离线时仍在写原题'});
 writeBackup(t.store,t.archive);const destination=join(t.root,'restored-legacy');await prepareRestore(t.archive,destination);const restored=await LearningStore.open(destination);cleanups.push(()=>restored.close());
 expect(restored.get('handwritingTargets',target.id)).toEqual(target);expect(restored.get('handwritings',receipt.id)?.targetId).toBe(target.id);expect(restored.get('handwritings',receipt.id)?.status).toBe('saved_unassessed');expect(restored.get('sessions','legacy-s')?.activity.id).toBe('later-task');expect(restored.get('sessions','legacy-s')?.draft).toBe('新题草稿');expect(restored.list('evidence')).toEqual([]);
});
