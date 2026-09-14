import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {HandwritingService} from '../src/main/handwriting-service';
import {seedSamples} from '../src/main/samples';
import {publicSnapshot} from '../src/main/public-snapshot';
import {inkPageSvg} from '../src/shared/ink-svg';
const stores:LearningStore[]=[];afterEach(()=>{vi.restoreAllMocks();stores.splice(0).forEach(s=>s.close());});
async function fixture(){
 const path=mkdtempSync(join(tmpdir(),'reclimb-ink-')),store=await LearningStore.open(path);stores.push(store);seedSamples(store);
 const service=new HandwritingService(store),session=store.list('sessions')[0],target=service.target(session.id);
 const input={requestId:'test-submit',targetId:target.id,pages:[{id:'page',width:768 as const,height:1024 as const,strokes:[{id:'stroke',color:'#253e31' as const,width:3,points:[{x:0.1,y:0.2,pressure:0.5},{x:0.5,y:0.3,pressure:0.7}]}]}],note:'我的独立推导原稿'};
 return{path,store,service,session,target,input};
}
it('freezes the original task without exposing a private answer or requiring a key/budget',async()=>{
 const {store,target,session}=await fixture();expect(store.getSettings().monthlyBudgetCny).toBe(0);expect(JSON.stringify(target)).not.toContain(session.activity.referenceAnswer!);expect(target.taskId).toBe(session.id);expect(store.list('usage')).toHaveLength(0);
});
it('saves once before any AI, repeats an identical receipt, rejects a conflicting request',async()=>{
 const {store,service,input}=await fixture();const first=service.save(input);expect(service.save(input)).toEqual(first);
 expect(store.list('handwritings')).toHaveLength(1);expect(store.list('attempts')).toHaveLength(0);expect(store.list('evidence')).toHaveLength(0);expect(store.list('usage')).toHaveLength(0);
 expect(()=>service.save({...input,note:'另一份作答'})).toThrow(/编号/);
});
it('retains task, original text draft and checkpoint after the desktop changes task',async()=>{
 const {store,service,input,session,target}=await fixture();store.put('sessions',{...session,activity:{...session.activity,id:'new-task',title:'另一题'},draft:'新题未提交草稿',checkpoint:'新题位置'});
 service.save(input);const record=store.list('handwritings')[0];expect(record.targetId).toBe(target.id);expect(store.get('handwritingTargets',record.targetId)?.title).toBe(target.title);expect(store.get('sessions',session.id)?.draft).toBe('新题未提交草稿');expect(store.get('sessions',session.id)?.checkpoint).toBe('新题位置');
});
it('captures actual help after pairing but handwriting never becomes evidence',async()=>{
 const {store,service,input,session}=await fixture();store.put('sessions',{...session,helpEvents:[{id:'answer',kind:'answer',level:4,scope:'current_task',taskId:session.id,createdAt:new Date().toISOString()}]});
 service.save(input);expect(store.list('handwritings')[0].helpLevel).toBe(4);expect(store.list('evidence')).toHaveLength(0);
});
it('rejects sending a task which changed after the desktop click',async()=>{
 const {store,service,session}=await fixture();const expected={taskId:session.id};
 expect(service.target(session.id,expected).taskId).toBe(session.id);
 const before=store.list('handwritingTargets').length;
 store.put('sessions',{...session,activity:{...session.activity,id:'new-task'}});
 expect(()=>service.target(session.id,expected)).toThrow(/题目已经更新/);
 expect(store.list('handwritingTargets')).toHaveLength(before);
 expect(service.target(session.id,{taskId:'new-task'}).taskId).toBe('new-task');
});
it('rejects unknown/deleted targets and malformed or empty ink',async()=>{
 const {store,service,input,target}=await fixture();expect(()=>service.save({...input,targetId:'unknown'})).toThrow(/原任务/);
 expect(()=>service.save({...input,pages:[{...input.pages[0],strokes:[]}],note:''})).toThrow(/笔迹/);
 expect(()=>service.save({...input,pages:[{...input.pages[0],strokes:[{...input.pages[0].strokes[0],color:'<script>'}]}]})).toThrow();
 const project=store.get('projects',target.projectId)!;store.put('projects',{...project,trashedAt:new Date().toISOString()});expect(()=>service.save(input)).toThrow(/原任务/);store.put('projects',{...project});expect(service.save(input).status).toBe('saved_unassessed');
});
it('survives a restart with its target, ink and idempotency key intact',async()=>{
 const {path,store,service,input}=await fixture();const saved=service.save(input);store.close();const restored=await LearningStore.open(path);stores.push(restored);
 expect(new HandwritingService(restored).save(input)).toEqual(saved);expect(restored.list('handwritings')[0].pages).toEqual(input.pages);
});
it('hides ink from ordinary UI snapshots and keeps it immutable',async()=>{
 const {store,service,input,target}=await fixture();service.save(input);const snapshot=publicSnapshot(store.snapshot());expect(snapshot.handwritings).toEqual([]);expect(snapshot.handwritingTargets).toEqual([]);
 expect(()=>store.put('handwritingTargets',{...target,title:'静默改题'})).toThrow();expect(store.get('handwritingTargets',target.id)?.title).toBe(target.title);
 const svg=inkPageSvg(input.pages[0]);expect(svg).toContain('fill="white"');expect(svg).not.toMatch(/script|foreignObject|href=/);
});
it('skips querying ink collections for a lightweight snapshot and keeps complete snapshots by default',async()=>{
 const {store,service,input}=await fixture();service.save(input);const list=vi.spyOn(store,'list');
 const light=store.snapshot({includeHandwriting:false});expect(light.handwritings).toEqual([]);expect(light.handwritingTargets).toEqual([]);expect(list.mock.calls.some(([name])=>name==='handwritings'||name==='handwritingTargets')).toBe(false);
 list.mockClear();const complete=store.snapshot();expect(complete.handwritings).toHaveLength(1);expect(complete.handwritingTargets).toHaveLength(1);expect(complete.handwritings?.[0].pages).toEqual(input.pages);expect(list.mock.calls.some(([name])=>name==='handwritings')).toBe(true);
});
it('polls lightweight cached metadata without repeatedly parsing ink, and isolates caller edits',async()=>{
 const {store,service,input,session,target}=await fixture();service.save(input);const list=vi.spyOn(store,'list');const first=service.list(session.id);
 expect(first).toHaveLength(1);expect(first[0].record.pages).toEqual([]);expect(first[0].pageCount).toBe(1);expect(first[0].target?.id).toBe(target.id);expect(JSON.stringify(first)).not.toContain('"points"');
 const reads=list.mock.calls.filter(([name])=>name==='handwritings').length;first[0].record.note='外部修改';first[0].target!.title='错误任务名';
 for(let i=0;i<5;i++){const next=service.list(session.id);expect(next[0].record.note).toBe(input.note);expect(next[0].target?.title).toBe(target.title);}
 expect(reads).toBe(1);expect(list.mock.calls.filter(([name])=>name==='handwritings')).toHaveLength(1);
});
it('invalidates only the changed session after a successful save and keeps repeats idempotent',async()=>{
 const {store,service,input,session}=await fixture();const other={...session,id:'another-session'};store.put('sessions',other);const otherTarget=service.target(other.id);service.save(input);service.save({...input,targetId:otherTarget.id,requestId:'other-submit'});
 service.list(session.id);service.list(other.id);service.save({...input,requestId:'next-submit',note:'另一份记录'});const list=vi.spyOn(store,'list');
 expect(service.list(other.id)).toHaveLength(1);expect(list.mock.calls.filter(([name])=>name==='handwritings')).toHaveLength(0);expect(service.list(session.id)).toHaveLength(2);expect(list.mock.calls.filter(([name])=>name==='handwritings')).toHaveLength(1);
 service.save(input);list.mockClear();expect(service.list(session.id)).toHaveLength(2);expect(list.mock.calls.filter(([name])=>name==='handwritings')).toHaveLength(0);
});
it('rechecks deleted projects and sessions on every cached listing',async()=>{
 const {store,service,input,session}=await fixture();service.save(input);service.list(session.id);const project=store.get('projects',session.projectId)!;
 store.put('projects',{...project,trashedAt:new Date().toISOString()});expect(()=>service.list(session.id)).toThrow(/删除/);store.put('projects',project);expect(service.list(session.id)).toHaveLength(1);
 store.remove('sessions',session.id);expect(()=>service.list(session.id)).toThrow(/不存在/);
});
it('recreates metadata after reopening a workspace and does not publish a failed save',async()=>{
 const {store,service,input,session,path}=await fixture();service.save(input);service.list(session.id);
 const put=store.put.bind(store),spy=vi.spyOn(store,'put').mockImplementation(((name:any,value:any)=>{if(name==='handwritings')throw new Error('模拟磁盘写入失败');return put(name,value);}) as typeof store.put);
 expect(()=>service.save({...input,requestId:'failed-submit'})).toThrow(/磁盘/);spy.mockRestore();expect(service.list(session.id)).toHaveLength(1);store.close();const reopened=await LearningStore.open(path);stores.push(reopened);expect(new HandwritingService(reopened).list(session.id)).toMatchObject([{pageCount:1,record:{requestId:input.requestId,pages:[]}}]);
});
