import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {ProjectDeleteModal,ProjectTrashPanel} from '../src/renderer/ProjectTrash';
import EvidencePage from '../src/renderer/EvidencePage';
import HomePage from '../src/renderer/HomePage';
import type {Project,WorkspaceSnapshot} from '../src/shared/types';

vi.mock('../src/renderer/PdfPageViewer',()=>({default:()=>null}));

const now='2026-09-11T00:00:00.000Z';
const active:Project={id:'active',title:'仍在学习的项目',goal:'继续学习',status:'active',createdAt:now,updatedAt:now};
const trashed:Project={id:'trashed',title:'已经删除的项目',goal:'可恢复',status:'paused',statusBeforeTrash:'active',trashedAt:'2026-09-10T00:00:00.000Z',createdAt:now,updatedAt:now};
const activity={kind:'application' as const,title:'一次学习',instruction:'完成一次尝试',rubric:[],sourceIds:[],assessmentBasis:'rule' as const};
const assessment={outcome:'met' as const,feedback:'完成',criteria:[],limitations:[],sourceIds:[]};
const snapshot={projects:[active,trashed],capabilities:[],materials:[{id:'m',projectId:'trashed',title:'材料',kind:'txt',originalName:'material.txt',storedPath:'x',importedAt:now,fragmentCount:1,warnings:[],summary:''}],fragments:[],sessions:[{id:'s',projectId:'trashed',capabilityId:'c',mode:'practice',status:'completed',activity,messages:[],helpEvents:[],helpLevel:0,draft:'',checkpoint:'',nextStep:'',createdAt:now,updatedAt:now}],attempts:[{id:'a',projectId:'trashed',sessionId:'s',text:'一次作答',submittedAt:now,helpLevel:0,requestId:'request'}],evidence:[{id:'e',projectId:'trashed',capabilityId:'c',sessionId:'s',attemptId:'a',status:'assisted',helpLevel:0,assessment,createdAt:now}],reviews:[],usage:[],sourceTranscriptions:[],teachingVersions:[],taskReviews:[],disputes:[],corrections:[],answerExposures:[],routeVersions:[],learningUnits:[],learningPositions:[],teachingObservations:[],understandingDrafts:[],readingLayouts:[],settings:{providerName:'test',baseUrl:'https://example.test',model:'m',monthlyBudgetCny:10,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:now,hasApiKey:true,personalGoal:'',studyMinutes:30,confirmedPreferences:''},dataDirectory:'x'} satisfies WorkspaceSnapshot;

it('keeps trashed projects out of the learning home',()=>{
 const html=renderToStaticMarkup(createElement(HomePage,{snapshot,busy:false,onCreate:vi.fn(),navigate:vi.fn(),onSeed:vi.fn(),onReview:vi.fn(),run:vi.fn()}));
 expect(html).toContain('仍在学习的项目');
 expect(html).not.toContain('已经删除的项目');
 expect(html).toContain('正在走的路 <span>1</span>');
});

it('routes an empty learning home to recent trash when retained projects can be restored',()=>{
 const html=renderToStaticMarkup(createElement(HomePage,{snapshot:{...snapshot,projects:[trashed]},busy:false,onCreate:vi.fn(),navigate:vi.fn(),onSeed:vi.fn(),onReview:vi.fn(),run:vi.fn()}));
 expect(html).toContain('查看最近删除');
 expect(html).toContain('恢复后可以接着原来的学习过程');
 expect(html).not.toContain('先体验内置练习示例');
});

it('keeps evidence from trashed projects out of another project experience panel',()=>{
 const html=renderToStaticMarkup(createElement(EvidencePage,{snapshot,project:active,evidence:[],busy:false,onSource:vi.fn(),onSession:vi.fn(),onReview:vi.fn(),run:vi.fn()}));
 expect(html).not.toContain('其他项目留下的经验');
 expect(html).not.toContain('已经删除的项目');
});

it('summarizes retained learning records before moving a project to trash',()=>{
 const html=renderToStaticMarkup(createElement(ProjectDeleteModal,{snapshot,project:trashed,busy:false,onCancel:vi.fn(),onConfirm:vi.fn()}));
 expect(html).toContain('移到最近删除');
 expect(html).toContain('1 份材料');
 expect(html).toContain('1 次学习');
 expect(html).toContain('1 次尝试');
 expect(html).toContain('1 条能力证据');
 expect(html).toContain('30 天');
});

it('offers restore and a guarded permanent deletion from recent trash',()=>{
 const html=renderToStaticMarkup(createElement(ProjectTrashPanel,{snapshot,busy:false,now:new Date('2026-09-11T00:00:00.000Z'),onRestore:vi.fn(),onPurge:vi.fn()}));
 expect(html).toContain('最近删除');
 expect(html).toContain('已经删除的项目');
 expect(html).toContain('9月10日移入');
 expect(html).toContain('29 天后自动永久删除');
 expect(html).toContain('恢复项目');
 expect(html).toContain('永久删除');
 expect(html).not.toContain('确认永久删除');
});
