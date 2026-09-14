import {describe,expect,it} from 'vitest';
import {acknowledgeSubmission,createDraft,exportDraft,freezeSubmission,normalizePoint,parsePairingLink,strokeNear} from '../src/companion/draft';
import type {HandwritingTarget} from '../src/shared/handwriting';

const target:HandwritingTarget={id:'target-a',projectId:'project-a',projectTitle:'自编材料',sessionId:'session-a',taskId:'task-a',title:'说明两个数的比较',instruction:'写下理由',sourceIds:[],helpLevel:0,mode:'practice',createdAt:'2026-09-14T00:00:00.000Z'};
function filled(){const draft=createDraft('workspace-a',target);draft.pages[0].strokes.push({id:'stroke-a',color:'#253e31',width:2,points:[{x:.1,y:.1,pressure:.5}]});draft.note='我的理由';return draft;}

describe('手写本地提交边界',()=>{
 it('冻结提交后继续书写不会修改已发送内容，重试沿用同一编号',()=>{
  const draft=filled();const frozen=freezeSubmission(draft,'request-a');draft.note='继续修改';draft.pages[0].strokes[0].points.push({x:.2,y:.2,pressure:.8});
  expect(frozen.note).toBe('我的理由');expect(frozen.pages[0].strokes[0].points).toHaveLength(1);
  expect(freezeSubmission(draft,'request-b')).toEqual(frozen);
 });
 it('迟到回执只清除原提交，不清空新增草稿或改绑任务',()=>{
  const draft=filled();freezeSubmission(draft,'request-a');draft.note='等待时补充';
  expect(acknowledgeSubmission(draft,{id:'saved-a',requestId:'other',targetId:'target-a',savedAt:'2026-09-14T01:00:00.000Z',status:'saved_unassessed'})).toBe(false);
  expect(draft.pending?.requestId).toBe('request-a');
  expect(acknowledgeSubmission(draft,{id:'saved-a',requestId:'request-a',targetId:'target-a',savedAt:'2026-09-14T01:00:00.000Z',status:'saved_unassessed'})).toBe(true);
  expect(draft.note).toBe('等待时补充');expect(draft.target).toEqual(target);expect(draft.pending).toBeUndefined();expect(draft.receipts).toHaveLength(1);
 });
 it('本地原稿和冻结提交可导出恢复信息，不包含配对凭据',()=>{
  const draft=filled();freezeSubmission(draft,'request-a');const exported=JSON.parse(exportDraft(draft));
  expect(exported.draft.target.id).toBe('target-a');expect(exported.draft.pending.requestId).toBe('request-a');expect(exported.format).toBe('reclimb-handwriting-draft');
  expect(Object.keys(exported.draft).sort()).not.toContain('token');expect(Object.keys(exported.draft).sort()).not.toContain('credentials');
 });
 it('新目标有独立草稿标识，原任务版本不被外部对象修改',()=>{
  const first=filled(),other=createDraft('workspace-a',{...target,id:'target-b'});expect(first.key).not.toBe(other.key);
  const source={...target};const draft=createDraft('workspace-a',source);source.title='修改后';expect(draft.target.title).toBe(target.title);
 });
 it('只提交当前页时冻结所选页面，其余原稿仍留在本机',()=>{
  const draft=filled();draft.pages.push({...draft.pages[0],id:'second-page'});draft.pageId='second-page';
  const frozen=freezeSubmission(draft,'current-page-submit','current');expect(frozen.pages.map(page=>page.id)).toEqual(['second-page']);expect(draft.pages).toHaveLength(2);
  draft.pageId=draft.pages[0].id;expect(freezeSubmission(draft,'retry','all')).toEqual(frozen);
 });
 it('超出传输字节上限时不冻结；可选单页发送，不删除原稿',()=>{
  const draft=filled();const points=Array.from({length:12000},()=>({x:.12345678901234567,y:.9876543210987654,pressure:.543210987654321}));
  draft.pages=[0,1].map(page=>({id:'large-'+page,width:768,height:1024,strokes:Array.from({length:5},(_,i)=>({id:'stroke-'+i,color:'#253e31' as const,width:2,points}))}));draft.pageId=draft.pages[0].id;
  expect(()=>freezeSubmission(draft,'too-large')).toThrow(/当前页/);expect(draft.pending).toBeUndefined();
  expect(freezeSubmission(draft,'one-page','current').pages).toHaveLength(1);expect(draft.pages).toHaveLength(2);expect(draft.pages[1].strokes[0].points).toHaveLength(12000);
 });
});

describe('浏览器输入',()=>{
 it('从 fragment 取票据，拒绝 query 中的凭据和外部协议',()=>{
  expect(parsePairingLink('http://192.168.1.2:3210/#ticket=abcd')).toEqual({url:'http://192.168.1.2:3210/',ticket:'abcd'});
  expect(parsePairingLink('javascript:alert(1)')).toBeNull();expect(parsePairingLink('http://example.com/?ticket=abcd')).toBeNull();
 });
 it('限制笔迹坐标且使用可靠的鼠标默认压力',()=>{
  expect(normalizePoint(-10,110,{left:0,top:0,width:100,height:100},0)).toEqual({x:0,y:1,pressure:.5});
 });
 it('橡皮按整条线段检测，不遗漏两个采样点之间的笔画',()=>{
  const stroke={id:'s',color:'#253e31' as const,width:2,points:[{x:0,y:.5,pressure:.5},{x:1,y:.5,pressure:.5}]};
  expect(strokeNear(stroke,{x:.5,y:.501,pressure:.5},8)).toBe(true);expect(strokeNear(stroke,{x:.5,y:.8,pressure:.5},8)).toBe(false);
 });
});
