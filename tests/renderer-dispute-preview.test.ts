import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import type {WorkspaceSnapshot} from '../src/shared/types';
import type {Dispute,TeachingVersion} from '../src/shared/reliability';
import DisputePreview from '../src/renderer/DisputePreview';
it('the disclosure previews only the disputed version and never sends on render',()=>{
 const snapshot={settings:{providerName:'本地测试接收方',model:'mock'},attempts:[{id:'a1',text:'本题作答'},{id:'a2',text:'其它项目私人作答'}],evidence:[{id:'e1',attemptId:'a1',projectId:'p',teachingVersionId:'v1',assessment:{feedback:'本题评价',criteria:[],limitations:[]}},{id:'e2',attemptId:'a2',projectId:'other',teachingVersionId:'v2',assessment:{feedback:'其它项目私人评价',criteria:[],limitations:[]}}]} as unknown as WorkspaceSnapshot;
 const dispute={id:'d',projectId:'p',teachingVersionId:'v1',messages:[{id:'m',text:'本题质疑'}]} as Dispute;
 const original={activity:{instruction:'当前题目',rubric:['公开标准']},steps:[],sources:[{id:'s',locator:'第1段',text:'当前引用摘录'}]} as unknown as TeachingVersion;
 let sent=false;const html=renderToStaticMarkup(createElement(DisputePreview,{snapshot,dispute,original,busy:false,onCancel:()=>{},onConfirm:()=>{sent=true}}));
 for(const text of ['本地测试接收方','当前题目','当前引用摘录','本题作答','本题评价','发送这些内容并核对','继续只保存在本机'])expect(html).toContain(text);
 expect(html).not.toContain('其它项目私人');expect(sent).toBe(false);
});
it('the send preview does not reveal a prepared demonstration before the learner has seen it',()=>{
 const snapshot={settings:{providerName:'本地服务',model:'mock'},sessions:[{id:'session',teaching:{history:[],current:{id:'seen'}}}],attempts:[],evidence:[]} as unknown as WorkspaceSnapshot;
 const dispute={id:'d',sessionId:'session',projectId:'p',teachingVersionId:'v',messages:[]} as unknown as Dispute;
 const original={activity:{instruction:'题干仍完整可核对',rubric:[]},steps:[{id:'seen',content:'已经阅读的讲解'},{id:'future',content:'还未见到的示范解答'}],sources:[]} as unknown as TeachingVersion;
 const html=renderToStaticMarkup(createElement(DisputePreview,{snapshot,dispute,original,busy:false,onCancel:()=>{},onConfirm:()=>{}}));expect(html).toContain('已经阅读的讲解');expect(html).not.toContain('还未见到的示范解答');expect(html).toContain('1 步已准备');
});
