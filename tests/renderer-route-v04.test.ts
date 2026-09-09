import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('../src/renderer/SourceReader',()=>({SourceReader:()=>null}));
import {RoutePage} from '../src/renderer/Materials';
import type {Project,WorkspaceSnapshot} from '../src/shared/types';

const now='2026-09-09T00:00:00.000Z';
const project:Project={id:'p',title:'一本书',goal:'理解、会用并重构方法',status:'active',createdAt:now,updatedAt:now};
const emptySnapshot={projects:[project],capabilities:[],materials:[],fragments:[],sessions:[],attempts:[],evidence:[],reviews:[],usage:[],sourceTranscriptions:[],teachingVersions:[],taskReviews:[],disputes:[],corrections:[],answerExposures:[],routeVersions:[],learningUnits:[],learningPositions:[],teachingObservations:[],understandingDrafts:[],readingLayouts:[],settings:{providerName:'test',baseUrl:'https://example.test',model:'m',monthlyBudgetCny:10,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:now,hasApiKey:true,personalGoal:'',studyMinutes:30,confirmedPreferences:''},dataDirectory:'x'} satisfies WorkspaceSnapshot;
const props={busy:false,onStart:async()=>{},onEdit:()=>{},onFiles:()=>{},onUrl:()=>{},onText:()=>{},onSource:()=>{},onSettings:()=>{},run:async()=>null};

it('offers one initial route entry instead of two competing suggestion controls',()=>{
 const html=renderToStaticMarkup(createElement(RoutePage,{snapshot:emptySnapshot,project,...props}));expect((html.match(/建立学习路线/g)??[])).toHaveLength(1);expect(html).not.toContain('眼下可以走的几步');expect(html).not.toContain('根据我的起点准备几步建议');
});

it('shows a durable current unit, whole-book map and an adoptable adjustment proposal',()=>{
 const activeProject={...project,activeRouteVersionId:'r1',pendingRouteVersionId:'r2',learningPositionId:'pos'};
 const unit={id:'u1',projectId:'p',routeVersionId:'r1',capabilityId:'c',title:'展开关键条件',coreQuestion:'这些条件为何需要？',purpose:'从例子进入推导',expectedOutcome:'能说明条件作用与边界',sourceIds:[],locators:['第 2 章'],prerequisiteUnitIds:[],order:0,phase:'expand' as const,status:'active' as const,createdAt:now,updatedAt:now};
 const route={id:'r1',projectId:'p',version:1,origin:'generated' as const,status:'adopted' as const,summary:'先看全书问题，再深入条件。',coreQuestion:'全书怎样建立方法？',mapNodes:[{id:'n',title:'核心问题',question:'作者解决什么？',role:'全书入口',sourceIds:[],connectsTo:[],status:'outlined' as const}],capabilitySnapshots:[],unitIds:['u1'],unitSnapshots:[],coverage:{totalSections:12,analyzedSectionIds:['f1'],pendingSectionIds:['f2'],method:'先索引后分批读取'},createdAt:now,adoptedAt:now};
 const proposal={...route,id:'r2',version:2,status:'proposed' as const,baseVersionId:'r1',changeSummary:'保留当前单元，增加综合单元。',createdAt:'2026-09-09T01:00:00.000Z'};
 const snapshot={...emptySnapshot,projects:[activeProject],capabilities:[{id:'c',projectId:'p',title:'分析条件',description:'解释条件',prerequisites:[],sourceIds:[],order:0}],routeVersions:[route,proposal],learningUnits:[unit],learningPositions:[{id:'pos',projectId:'p',routeVersionId:'r1',unitId:'u1',intent:'continue' as const,reason:'上次完成了例子比较。',nextRequirement:'转向条件推导',confidence:'confirmed' as const,updatedAt:now}]};
 const html=renderToStaticMarkup(createElement(RoutePage,{snapshot,project:activeProject,...props}));expect(html).toContain('当前学习');expect(html).toContain('展开关键条件');expect(html).toContain('继续学习');expect(html).toContain('全书地图');expect(html).toContain('尚待深入');expect(html).toContain('路线调整提案');expect(html).toContain('采用这次调整');
});
