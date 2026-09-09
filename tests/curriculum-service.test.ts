import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import type {ModelProvider,ModelRequest} from '../src/main/provider';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

class RouteProvider implements ModelProvider{
 requests:Record<string,any>[]=[];
 hijackExisting=false;
 async complete(request:ModelRequest){
  const input=JSON.parse(request.user);this.requests.push(input);
  const existing=input.existingUnits?.[0];
  const capability=(title:string,sourceId:string)=>({existingCapabilityId:input.existingCapabilities?.find((item:any)=>item.title===title)?.id,title,description:this.hijackExisting&&existing&&title==='建立全书问题图'?'在完全不同的领域设计实验':'能够解释并使用'+title,prerequisites:[],sourceIds:[sourceId]});
  const capabilities=[capability('建立全书问题图','f1'),capability('展开关键机制','f2'),capability('综合选择方法','f3')];
  const result={summary:'先看全书处理的问题，再深入机制，最后重新组织方法。',coreQuestion:'这本书如何把条件转化为可用的方法？',mapNodes:[
   {key:'map-1',title:'全书问题',question:'作者要解决什么？',role:'定位对象',sourceIds:['f1'],connectsTo:['map-2']},
   {key:'map-2',title:'关键机制',question:'结论为何成立？',role:'展开证明',sourceIds:['f2'],connectsTo:['map-3']},
   {key:'map-3',title:'方法选择',question:'何时使用什么方法？',role:'综合迁移',sourceIds:['f3'],connectsTo:[]},
  ],capabilities,units:[
   {existingUnitId:existing?.id,capabilityTitle:capabilities[0].title,title:existing?'修订后的全书入口':'先建立全书粗图',coreQuestion:'全书围绕什么问题展开？',purpose:'先建立方向，不把概览当作掌握。',expectedOutcome:'能指出核心问题和三个章节关系。',phase:'survey',sourceIds:['f1'],locators:['第 1 章'],prerequisiteTitles:[]},
   {capabilityTitle:capabilities[1].title,title:'展开关键机制',coreQuestion:'关键推导如何连接？',purpose:'补充条件、例子和反例。',expectedOutcome:'能重构一条证明骨架。',phase:'expand',sourceIds:['f2'],locators:['第 2 章'],prerequisiteTitles:[existing?'修订后的全书入口':'先建立全书粗图']},
   {capabilityTitle:capabilities[2].title,title:'压缩为方法框架',coreQuestion:'怎样在新问题中选路？',purpose:'形成自己的简洁框架。',expectedOutcome:'能说明适用条件与边界。',phase:'synthesize',sourceIds:['f3'],locators:['第 3 章'],prerequisiteTitles:['展开关键机制']},
  ],scopeProposal:{suggestedFocus:'先从全书问题与章节关系开始',reason:'先获得粗图，再选择局部深入。'},changeSummary:existing?'保留原单元身份，更新其标题与后续关系。':'首次建立全书路线。'};
  return {text:JSON.stringify(result),inputTokens:100,outputTokens:200,usageKnown:true};
 }
}

async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'reclimb-curriculum-service-'));roots.push(root);const store=await LearningStore.open(root);const now='2026-09-09T00:00:00Z';
 store.transaction(()=>{
  store.put('projects',{id:'p',title:'一本教材',goal:'能够理解、使用并独立重构整本教材',status:'active',createdAt:now,updatedAt:now});
  store.put('materials',{id:'m',projectId:'p',title:'原创教材',kind:'md',originalName:'book.md',storedPath:join(root,'book.md'),importedAt:now,warnings:[],fragmentCount:3,summary:'全书由问题、机制和应用组成。'});
  ['作者提出全书问题。','第二章展开关键机制。','第三章比较应用条件。'].forEach((text,index)=>store.put('fragments',{id:'f'+(index+1),projectId:'p',materialId:'m',locator:'第 '+(index+1)+' 章',text,ordinal:index}));
  store.updateSettings({monthlyBudgetCny:100});
 });
 const provider=new RouteProvider();const service=new LearningService(store,()=>'test',()=>provider);return {store,service,provider};
}

describe('whole-book route versions',()=>{
 it('adopts the first map and creates a durable current unit and position',async()=>{
  const {store,service}=await fixture();const route=await service.generateRoute('p');const project=store.get('projects','p')!;
  expect(route.status).toBe('adopted');expect(project.activeRouteVersionId).toBe(route.id);expect(project.pendingRouteVersionId).toBeUndefined();
  expect(route.coverage).toMatchObject({totalSections:3,analyzedSectionIds:['f1','f2','f3'],pendingSectionIds:[]});
  const units=store.list('learningUnits','p').sort((a,b)=>a.order-b.order);expect(units).toHaveLength(3);expect(units[0]).toMatchObject({status:'active',phase:'survey'});
  expect(store.list('learningPositions','p')[0]).toMatchObject({routeVersionId:route.id,unitId:units[0].id,confidence:'confirmed'});
 });
 it('keeps an adjusted route as a proposal until adoption, then reuses an explicitly matched unit',async()=>{
  const {store,service,provider}=await fixture();const first=await service.generateRoute('p'),unit=store.list('learningUnits','p')[0],position=store.list('learningPositions','p')[0];const before=store.list('learningUnits','p');
  store.put('sessions',{id:'historical-session',projectId:'p',capabilityId:unit.capabilityId,unitId:unit.id,routeVersionId:first.id,activity:{id:'historical-task',title:'旧路线中的任务',instruction:'说明全书问题。',kind:'argument',rubric:['说明问题'],sourceIds:['f1'],assessmentBasis:'source'},mode:'practice',status:'active',createdAt:first.createdAt,updatedAt:first.createdAt,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'旧位置',nextStep:'继续'});store.put('learningPositions',{...position,sessionId:'historical-session'});
  const proposal=await service.generateRoute('p');expect(proposal.status).toBe('proposed');expect(store.get('projects','p')?.activeRouteVersionId).toBe(first.id);expect(store.get('projects','p')?.pendingRouteVersionId).toBe(proposal.id);expect(store.list('learningUnits','p')).toEqual(before);
  service.adoptRoute('p',proposal.id);expect(store.get('projects','p')?.activeRouteVersionId).toBe(proposal.id);expect(store.get('learningUnits',unit.id)?.title).toBe('修订后的全书入口');expect(store.get('learningUnits',unit.id)?.routeVersionId).toBe(proposal.id);expect(store.get('routeVersions',first.id)?.status).toBe('superseded');expect(store.get('sessions','historical-session')?.routeVersionId).toBe(first.id);expect(store.list('learningPositions','p')[0].sessionId).toBe('historical-session');
  expect(store.get('learningUnits',unit.id)?.capabilityId).toBe(unit.capabilityId);expect(store.get('capabilities',unit.capabilityId)?.description).toBe('能够解释并使用建立全书问题图');
  expect((provider.requests[1].existingCapabilities as any[]).find(item=>item.id===unit.capabilityId)).toMatchObject({sourceIds:['f1'],prerequisites:[]});
 });
 it('rejects reuse of an old capability ID for a different ability description',async()=>{
  const {store,service,provider}=await fixture();await service.generateRoute('p');const original=store.list('capabilities','p').find(item=>item.title==='建立全书问题图')!;provider.hijackExisting=true;
  await expect(service.generateRoute('p')).rejects.toThrow(/能力.*身份|旧能力/);expect(store.get('capabilities',original.id)).toEqual(original);expect(store.get('projects','p')?.pendingRouteVersionId).toBeUndefined();
 });
});
