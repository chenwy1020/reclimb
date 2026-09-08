import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
vi.mock('../src/renderer/PdfPageViewer',()=>({default:()=>null}));
import DeskPage from '../src/renderer/DeskPage';
import Sidebar from '../src/renderer/Sidebar';
import {createSidebarController} from '../src/renderer/sidebar-state';
import type {Session,WorkspaceSnapshot} from '../src/shared/types';
const session:Session={id:'s',projectId:'p',capabilityId:'c',activity:{id:'task',title:'本地练习',instruction:'说明你的理由。',kind:'argument',rubric:['说明理由'],sourceIds:[],assessmentBasis:'ai'},mode:'practice',status:'active',createdAt:'2026-09-08',updatedAt:'2026-09-08',draft:'已有的旧草稿',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:''};
const snapshot={projects:[{id:'p',title:'测试项目',goal:'练习判断',status:'active'}],capabilities:[],materials:[],fragments:[],sessions:[session],attempts:[],evidence:[],reviews:[],usage:[],sourceTranscriptions:[],teachingVersions:[],taskReviews:[],disputes:[],corrections:[],answerExposures:[],learnerInputs:[],settings:{hasApiKey:false,monthlyBudgetCny:0},dataDirectory:'local'} as unknown as WorkspaceSnapshot;
function renderDesk(value:Session=session,busy=false){return renderToStaticMarkup(createElement(DeskPage,{snapshot,project:snapshot.projects[0],session:value,draft:'已有的旧草稿',draftStatus:'已保存到本机',busy,onDraft:()=>{},onSave:()=>{},onSelectSession:()=>{},onStart:async()=>{},onSource:()=>{},run:async()=>null,onSettings:()=>{},onSolution:async()=>undefined,onRecord:vi.fn(),onRespond:vi.fn()} as unknown as Parameters<typeof DeskPage>[0]));}
function attemptButton(html:string){return html.match(/<button[^>]*>[^]*?提交这次尝试<\/button>/g)?.at(-1)?.split('<button').at(-1)||'';}
describe('local learning records are always available',()=>{
 it('an old draft can be recorded with no key, no budget and no verification',()=>{const html=renderDesk();const button=attemptButton(html);expect(button).toContain('提交这次尝试');expect(button).not.toContain('disabled');expect(html).toContain('先保存在本机');});
 it('AI busy does not lock the local attempt textarea or its record button',()=>{const html=renderDesk(session,true);expect(html.match(/<textarea[^>]*aria-label="我的尝试"[^>]*>/)?.[0]).not.toContain('disabled');expect(attemptButton(html)).not.toContain('disabled');});
 it('an explanation has a local note entry without calling it capability evidence',()=>{const note={...session,teaching:{current:{id:'step',taskId:'task',action:'explain',title:'先看解释',content:'一点解释',sourceIds:[],createdAt:'2026-09-08'},upcoming:[],history:[],guidance:'guided',version:1,confusionCount:0}} as Session;const html=renderDesk(note);expect(html).toContain('aria-label="我的学习笔记"');expect(html).toContain('保存这条笔记');expect(html).toContain('不作为能力证据');});
 it('sidebar keeps one settings entry and the local storage note',()=>{const controller=createSidebarController();const html=renderToStaticMarkup(createElement(Sidebar,{snapshot,page:'home',projectId:'p',navigate:async()=>{},onCreate:()=>{},layout:{controller,state:controller.getSnapshot(),style:{}},modalOpen:false}));expect(html).not.toContain('个人学习空间设置');expect(html).not.toContain('AI 服务已配置');expect(html).toContain('aria-label="设置"');expect(html).toContain('学习记录，保存在你的电脑');});
});
