import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
vi.mock('../src/renderer/PdfPageViewer',()=>({default:()=>null}));
import {TaskFeedback} from '../src/renderer/TaskFeedback';
import type {Activity,Assessment,EvidenceStatus,WorkspaceSnapshot} from '../src/shared/types';
const activity:Activity={id:'task',title:'判断条件',instruction:'说明条件。',kind:'argument',rubric:['说明条件'],sourceIds:[],assessmentBasis:'ai'};
function render(status:EvidenceStatus,outcome:Assessment['outcome']='met'){const assessment:Assessment={outcome,feedback:'表现摘要',criteria:[],limitations:[],sourceIds:[]},attempt={id:'attempt',projectId:'p',sessionId:'s',text:'我的回答',submittedAt:'2026-10-15',helpLevel:0,requestId:'request',assessment},snapshot={evidence:[{id:'e',attemptId:'attempt',projectId:'p',capabilityId:'c',sessionId:'s',createdAt:'2026-10-15',helpLevel:0,status,assessment}],fragments:[],teachingVersions:[],taskReviews:[],corrections:[],disputes:[]} as unknown as WorkspaceSnapshot;return renderToStaticMarkup(createElement(TaskFeedback,{attempt,activity,snapshot,onSource:()=>{},onContinue:()=>{},busy:false}));}
describe('feedback status reflects the effective performance',()=>{
 it('does not present needs-review evidence as assisted completion',()=>{const html=render('needs_review');expect(html).toContain('待复核');expect(html).not.toContain('有帮助完成');expect(html).toContain('badge amber');});
 it('does not call a partial assisted attempt completed',()=>{const html=render('assisted','partial');expect(html).toContain('尝试中');expect(html).not.toContain('有帮助完成');});
 it.each([['delayed','延迟重构'],['transfer','迁移应用']] as const)('retains the actual %s return condition', (status,label)=>{const html=render(status);expect(html).toContain(label);expect(html).toContain('经过回访');});
});
