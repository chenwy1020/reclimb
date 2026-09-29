import {createElement, isValidElement, type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import type {Capability, Evidence, Project, WorkspaceSnapshot} from '../src/shared/types';
import LearningRelationsPanel, {KnowledgeEvidenceList, KnowledgeImpactNotice, KnowledgeLocalGraph, RelationConfirmation, RelationRetraction, ShortKnowledgeCheck} from '../src/renderer/LearningRelationsPanel';
import {capabilitySignature,type KnowledgeView} from '../src/shared/knowledge-graph';
import {knowledgeCheckDestination} from '../src/renderer/knowledge-navigation';

const date='2026-09-30T08:00:00.000Z';
const current:Project={id:'new',title:'概率方法',goal:'在新问题中解释条件',status:'active',createdAt:date,updatedAt:date};
const prior:Project={...current,id:'old',title:'逻辑学习',goal:'能说明前提的作用'};
const target:Capability={id:'target',projectId:'new',title:'解释条件',description:'解释概率问题的条件和适用边界',goalContext:current.goal,sourceIds:[],prerequisites:['base'],order:0};
const source:Capability={...target,id:'source',projectId:'old',title:'解释条件',description:'通过反例说明前提不可省略',goalContext:prior.goal,prerequisites:[]};
const other:Capability={...source,id:'other',title:'检查假设的必要性'};
const evidence:Evidence={id:'e',projectId:'old',capabilityId:'source',sessionId:'old-session',attemptId:'attempt',status:'independent',helpLevel:0,createdAt:date,assessment:{outcome:'met',feedback:'能指出删除条件造成的变化',criteria:[{criterion:'说明必要性',result:'met',reason:'给出反例'}],sourceIds:[],limitations:[]}};
function snapshot():WorkspaceSnapshot{return {projects:[current,prior],capabilities:[target,source,other,{...target,id:'base',title:'辨认前提',prerequisites:[],order:1}],materials:[],fragments:[],sessions:[{id:'old-session',projectId:'old',capabilityId:'source',activity:{id:'old-task',title:'说明前提',instruction:'为什么这个前提需要保留？',kind:'argument',rubric:['说明必要性'],sourceIds:[],assessmentBasis:'ai'},mode:'practice',status:'completed',createdAt:date,updatedAt:date,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:''}],attempts:[{id:'attempt',projectId:'old',sessionId:'old-session',text:'删去前提就产生这个反例。',submittedAt:date,helpLevel:0,requestId:'request'}],evidence:[evidence],reviews:[],usage:[],sourceTranscriptions:[],teachingVersions:[],taskReviews:[],disputes:[],corrections:[],answerExposures:[],routeVersions:[],learningUnits:[],learningPositions:[],teachingObservations:[],understandingDrafts:[],readingLayouts:[],knowledgeRelations:[],knowledgeUses:[],settings:{providerName:'test',baseUrl:'https://example.test',model:'m',monthlyBudgetCny:10,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:date,hasApiKey:true,personalGoal:'',studyMinutes:30,confirmedPreferences:''},dataDirectory:'local'};}
function confirmed(s=snapshot()):WorkspaceSnapshot{s.knowledgeRelations=[{id:'decision',rootId:'decision',projectId:'new',sourceProjectId:'old',sourceCapabilityId:'source',targetCapabilityId:'target',kind:'equivalent',status:'confirmed',reason:'两边均须解释条件的必要性',sourceSignature:capabilitySignature(s,source),targetSignature:capabilitySignature(s,target),createdAt:date}];return s;}
const render=(s=snapshot())=>renderToStaticMarkup(createElement(LearningRelationsPanel,{snapshot:s,project:current,capabilityId:'target',busy:false,run:async()=>null,onSource:()=>{},onNavigate:()=>{}}));
function find(node:ReactNode,test:(props:Record<string,any>)=>boolean):Record<string,any>|undefined{
 if(Array.isArray(node)){for(const child of node){const hit=find(child,test);if(hit)return hit;}return;}
 if(!isValidElement<Record<string,any>>(node))return;
 if(test(node.props))return node.props;
 return find(node.props.children,test);
}

describe('learning relationship presentation',()=>{
 it('keeps missing abilities unknown and exposes no invalid confirmation',()=>{
  const s=snapshot();s.capabilities=[];const html=render(s);
  expect(html).toContain('学习关联');expect(html).toContain('还没有能力目标');expect(html).not.toContain('确认这项关联');
 });
 it('presents same-name matches as candidates with separate definitions and goals',()=>{
  const html=render();expect(html).toContain('候选');expect(html).toContain('解释概率问题的条件和适用边界');expect(html).toContain('通过反例说明前提不可省略');expect(html).toContain('概率方法');expect(html).toContain('逻辑学习');expect(html).toContain('确认这项关联');expect(html).toContain('尚未验证');expect(html).toContain('辨认前提');expect(html).toContain('搜索其他名称');
 });
 it('shows old evidence conditions without assigning current-project mastery',()=>{
  const html=render();expect(html).toContain('独立完成过');expect(html).toContain('直接帮助 0');expect(html).toContain('2026');expect(html).not.toContain('当前能力已掌握');expect(html).toContain('查看旧作答');
 });
 it('enables a short check only after a confirmed mapping has usable independent evidence',()=>{
  const before=render(),after=render(confirmed());
  expect(before).toMatch(/<button[^>]*disabled=""[^>]*>先做短验证<\/button>/);expect(after).not.toMatch(/<button[^>]*disabled=""[^>]*>先做短验证<\/button>/);expect(after).toContain('待短验证');expect(after).not.toContain('当前能力的具体表现');
 });
 it('retains retraction history and removes eligibility without calling the learner incapable',()=>{
  const s=confirmed(),first=s.knowledgeRelations![0];s.knowledgeRelations!.push({...first,id:'withdrawal',previousId:first.id,status:'retracted',reason:'任务条件并不相当'});const html=render(s);
  expect(html).toContain('已撤回');expect(html).toContain('两边均须解释条件的必要性');expect(html).toContain('任务条件并不相当');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>先做短验证<\/button>/);expect(html).not.toContain('学习者不会');
 });
 it('marks helped and unsuccessful old attempts unavailable for independent short-check context',()=>{
  const s=confirmed();s.evidence=[{...evidence,status:'assisted',helpLevel:2,assessment:{...evidence.assessment,outcome:'partial'}}];const html=render(s);
  expect(html).toContain('直接帮助 2');expect(html).toContain('本次尚未达到标准');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>先做短验证<\/button>/);
 });
 it('keeps a readable relation list equivalent to the local picture',()=>{
  const view={nodes:[{id:'a',kind:'attempt',label:'那次反例作答',projectId:'old',entityId:'attempt'},{id:'e',kind:'evidence',label:'独立完成记录',projectId:'old',entityId:'e'}],edges:[{id:'edge',from:'a',to:'e',kind:'supports',label:'形成表现证据'}]} as KnowledgeView;
  const html=renderToStaticMarkup(createElement(KnowledgeLocalGraph,{view}));expect(html).toContain('文字关系与来源');expect(html).toContain('那次反例作答');expect(html).toContain('形成表现证据');expect(html).toContain('独立完成记录');expect(html).toContain('aria-hidden="true"');
 });
 it('continues warning after a confirmed-source version replaces the version that used old knowledge',()=>{
  const s=snapshot();s.teachingVersions=[{id:'revised',projectId:'new',capabilityId:'target',replacesVersionId:'original'},{id:'original',projectId:'new',capabilityId:'target'}] as WorkspaceSnapshot['teachingVersions'];
  s.knowledgeUses=[{id:'use',projectId:'new',targetCapabilityId:'target',teachingVersionId:'original',createdAt:date,fingerprint:'saved',entries:[{relationId:'removed-relation',sourceProjectId:'old',sourceProjectTitle:'逻辑学习',sourceCapabilityId:'source',sourceCapabilityTitle:'解释条件',sourceCapabilityDescription:source.description,targetCapabilityId:'target',relationReason:'行为相当',evidenceId:'e',attemptId:'attempt',sessionId:'old-session',performedAt:date,status:'independent',helpLevel:0,outcome:'met',summary:'旧表现摘要'}]}];
  const html=renderToStaticMarkup(createElement(KnowledgeImpactNotice,{snapshot:s,projectId:'new',capabilityId:'target',teachingVersionId:'revised'}));expect(html).toContain('旧依据需要复核');expect(html).toContain('原作答');
 });
 it('does not hide an old-use warning when its target ability has left the active route',()=>{
  const s=snapshot();s.capabilities=s.capabilities.map(item=>item.id==='target'?{...item,archived:true}:item);
  s.knowledgeUses=[{id:'use',projectId:'new',targetCapabilityId:'target',teachingVersionId:'historical',createdAt:date,fingerprint:'saved',entries:[{relationId:'removed-relation',sourceProjectId:'removed-project',sourceProjectTitle:'已清除的来源',sourceCapabilityId:'removed-capability',sourceCapabilityTitle:'旧能力',sourceCapabilityDescription:'旧范围',targetCapabilityId:'target',relationReason:'当时确认',evidenceId:'missing',attemptId:'missing',sessionId:'missing',performedAt:date,status:'independent',helpLevel:0,outcome:'met',summary:'保留下来的公开旧表现'}]}];
  const html=renderToStaticMarkup(createElement(KnowledgeImpactNotice,{snapshot:s,projectId:'new',capabilityId:'target',teachingVersionId:'historical'}));expect(html).toContain('旧依据需要复核');expect(html).toContain('清除');
 });
});

describe('relationship actions and navigation',()=>{
 it('requires a nonempty reason and sends exact source and target identities',async()=>{
  const run=vi.fn(async()=>snapshot());const props={projectId:'new',targetCapabilityId:'target',sourceCapabilityId:'other',kind:'prerequisite' as const,reason:'   ',busy:false,run,onKind:()=>{},onReason:()=>{},onSaved:()=>{}};
  let tree=RelationConfirmation(props);let form=find(tree,p=>!!p.onSubmit)!;
  await form.onSubmit({preventDefault(){}});expect(run).not.toHaveBeenCalled();
  tree=RelationConfirmation({...props,reason:'前提识别用于当前条件判断'});form=find(tree,p=>!!p.onSubmit)!;await form.onSubmit({preventDefault(){}});
  expect(run).toHaveBeenCalledWith('knowledge.confirm',{projectId:'new',targetCapabilityId:'target',sourceCapabilityId:'other',kind:'prerequisite',reason:'前提识别用于当前条件判断'},expect.any(String));
 });
 it('appends a retraction request with its reason rather than deleting evidence',async()=>{
  const run=vi.fn(async()=>snapshot());const tree=RelationRetraction({relationId:'decision-1',reason:'目标范围不同',busy:false,run,onReason:()=>{},onSaved:()=>{}});
  await find(tree,p=>!!p.onSubmit)!.onSubmit({preventDefault(){}});
  expect(run).toHaveBeenCalledWith('knowledge.retract',{relationId:'decision-1',reason:'目标范围不同'},expect.any(String));
 });
 it('opens the actual source project and session for an old answer',()=>{
  const navigate=vi.fn();const tree=KnowledgeEvidenceList({entries:[{evidence,effective:true,reason:'',sessionId:evidence.sessionId,attemptId:evidence.attemptId}],snapshot:snapshot(),onNavigate:navigate});
  find(tree,p=>p.children==='查看旧作答')!.onClick();expect(navigate).toHaveBeenCalledWith('old','old-session');
 });
 it('does not offer navigation into a trashed source project',()=>{
  const s=snapshot();s.projects[1]={...prior,trashedAt:date};const tree=KnowledgeEvidenceList({entries:[{evidence,effective:false,reason:'来源项目在最近删除中',sessionId:evidence.sessionId,attemptId:evidence.attemptId}],snapshot:s,onNavigate:vi.fn()});
  expect(find(tree,p=>p.children==='查看旧作答')).toBeUndefined();expect(renderToStaticMarkup(tree)).toContain('来源项目当前不可用');
 });
 it('requests a new check only for the chosen current capability',()=>{
  const run=vi.fn(async()=>snapshot());const tree=ShortKnowledgeCheck({projectId:'new',capabilityId:'target',busy:false,run});
  find(tree,p=>p.children==='先做短验证')!.onClick();expect(run).toHaveBeenCalledWith('knowledge.check',{projectId:'new',capabilityId:'target'},expect.any(String));
 });
 it('selects the newly active check and never a session from another project',()=>{
  const s=snapshot();s.projects[0]={...current,learningPositionId:'position'};s.learningPositions=[{id:'position',projectId:'new',routeVersionId:'r',unitId:'u',sessionId:'check',intent:'challenge',reason:'',nextRequirement:'',confidence:'confirmed',updatedAt:date}];
  s.sessions=[{id:'foreign',projectId:'old',capabilityId:'source',createdAt:'2027-01-01'},{id:'check',projectId:'new',capabilityId:'target',createdAt:date}] as WorkspaceSnapshot['sessions'];
  expect(knowledgeCheckDestination(s,'new','target')).toEqual({projectId:'new',sessionId:'check'});expect(knowledgeCheckDestination(s,'new','missing')).toBeUndefined();
 });
});
