import {describe,it,expect,vi} from 'vitest';
import {attachPenInput,type PenSample} from '../src/companion/pen-input';
import {createDraft,normalizePoint,snapshotDraft} from '../src/companion/draft';
import {inkLineWidth,inkPageSvg} from '../src/shared/ink-svg';

function fixture(){
 const classes=new Set<string>(),selection={removeAllRanges:vi.fn()};
 const win=Object.assign(new EventTarget(),{HTMLElement:class{}});
 const doc=Object.assign(new EventTarget(),{defaultView:win,activeElement:null,body:{classList:{add:(s:string)=>classes.add(s),remove:(s:string)=>classes.delete(s),contains:(s:string)=>classes.has(s)}},getSelection:()=>selection});
 let captured=false,clock=0;
 const canvas=Object.assign(new EventTarget(),{ownerDocument:doc,setPointerCapture:vi.fn(()=>{captured=true;}),hasPointerCapture:()=>captured,releasePointerCapture:vi.fn(()=>{captured=false;})});
 const handlers={start:vi.fn((_event:PenSample)=>true),move:vi.fn(),finish:vi.fn(),allowFinger:vi.fn(()=>false)};
 const input=attachPenInput(canvas as unknown as HTMLCanvasElement,handlers);
 function send(to:EventTarget,type:string,options:Record<string,unknown>={}){const event=new Event(type,{bubbles:true,cancelable:true});for(const [key,value] of Object.entries({pointerId:4,pointerType:'pen',button:0,timeStamp:++clock,clientX:20,clientY:30,pressure:.001,...options}))Object.defineProperty(event,key,{value});to.dispatchEvent(event);return event;}
 return{input,canvas,doc,win,handlers,classes,selection,send};
}
describe('continuous pen lifecycle',()=>{
 it('records native stylus touch strokes when Safari omits pointerdown, while direct touch remains opt-in',()=>{
  const f=fixture(),touch=(x:number)=>({identifier:17,target:f.canvas,touchType:'stylus',clientX:x,clientY:40,force:.006});
  for(let i=0;i<3;i++){f.send(f.canvas,'touchstart',{changedTouches:[touch(20)],touches:[touch(20)]});f.send(f.win,'touchmove',{changedTouches:[touch(40)],touches:[touch(40)]});f.send(f.win,'touchend',{changedTouches:[touch(60)],touches:[]});}
  expect(f.handlers.start).toHaveBeenCalledTimes(3);expect(f.handlers.move).toHaveBeenCalledTimes(6);expect(f.handlers.finish).toHaveBeenCalledTimes(3);
  expect(f.handlers.start.mock.calls[0][0]).toMatchObject({pointerType:'pen',pressure:.006});
  f.send(f.canvas,'touchstart',{changedTouches:[{...touch(20),touchType:'direct'}]});expect(f.handlers.start).toHaveBeenCalledTimes(3);
 });
 it('hands one physical stroke from PointerEvents to stylus TouchEvents without duplicating or ending it',()=>{
  const f=fixture(),touch=(x:number)=>({identifier:17,target:f.canvas,touchType:'stylus',clientX:x,clientY:40,force:.008});
  f.send(f.canvas,'pointerdown');f.send(f.canvas,'touchstart',{changedTouches:[touch(20)]});
  f.send(f.win,'pointercancel');f.send(f.win,'pointermove');f.send(f.canvas,'lostpointercapture');
  f.send(f.win,'touchmove',{changedTouches:[touch(50)]});f.send(f.win,'pointerup');expect(f.handlers.finish).not.toHaveBeenCalled();
  f.send(f.win,'touchend',{changedTouches:[touch(70)]});expect(f.handlers.start).toHaveBeenCalledTimes(1);expect(f.handlers.finish).toHaveBeenCalledTimes(1);
  expect(f.handlers.move.mock.calls.flat()[0][0]).toMatchObject({clientX:50,pointerType:'pen',pressure:.008});
 });
 it('ignores duplicate pointerdown after native touchstart and accepts the next native stroke immediately',()=>{
  const f=fixture(),touch=(identifier:number)=>({identifier,target:f.canvas,touchType:'stylus',clientX:20,clientY:40,force:.006});
  for(let i=0;i<3;i++){f.send(f.canvas,'touchstart',{changedTouches:[touch(i)]});f.send(f.canvas,'pointerdown',{pointerId:4});f.send(f.win,'touchmove',{changedTouches:[{...touch(i),clientX:70}]});f.send(f.win,'touchend',{changedTouches:[{...touch(i),clientX:80}]});f.send(f.win,'pointerup',{pointerId:4});}
  expect(f.handlers.start).toHaveBeenCalledTimes(3);expect(f.handlers.finish).toHaveBeenCalledTimes(3);expect(f.handlers.move).toHaveBeenCalledTimes(6);
 });
 it('keeps a Pencil stroke when a palm ends and terminates only the matching native touch',()=>{
  const f=fixture(),touch={identifier:17,target:f.canvas,touchType:'stylus',clientX:20,clientY:40,force:0};
  f.send(f.canvas,'touchstart',{changedTouches:[touch]});f.send(f.win,'touchend',{changedTouches:[{...touch,identifier:99,touchType:'direct'}]});expect(f.handlers.finish).not.toHaveBeenCalled();
  f.send(f.win,'touchcancel',{changedTouches:[touch]});expect(f.handlers.finish).toHaveBeenCalledTimes(1);expect(f.handlers.start.mock.calls[0][0]).toMatchObject({pressure:0});
 });
 it('does not apply stale native samples or an old native end to a reused contact identifier',()=>{
  const f=fixture(),touch={identifier:17,target:f.canvas,touchType:'stylus',clientX:20,clientY:40,force:.01};
  f.send(f.canvas,'touchstart',{changedTouches:[touch],timeStamp:100});f.send(f.win,'touchmove',{changedTouches:[touch],timeStamp:80});f.send(f.win,'touchend',{changedTouches:[touch],timeStamp:90});expect(f.handlers.move).not.toHaveBeenCalled();expect(f.handlers.finish).not.toHaveBeenCalled();
  f.send(f.win,'touchcancel',{changedTouches:[touch],timeStamp:110});f.send(f.canvas,'touchstart',{changedTouches:[touch],timeStamp:111});f.send(f.win,'touchend',{changedTouches:[touch],timeStamp:120});expect(f.handlers.start).toHaveBeenCalledTimes(2);expect(f.handlers.finish).toHaveBeenCalledTimes(2);
 });
 it('keeps adjacent strokes with a reused pointer ID after a delayed capture loss',()=>{
  const f=fixture();for(let i=0;i<50;i++){f.send(f.canvas,'pointerdown');f.send(f.canvas,'lostpointercapture');f.send(f.win,'pointermove');f.send(f.win,'pointerup');}
  expect(f.handlers.start).toHaveBeenCalledTimes(50);expect(f.handlers.move).toHaveBeenCalledTimes(100);expect(f.handlers.finish).toHaveBeenCalledTimes(50);expect(f.input.diagnostics.captureLosses).toBe(50);expect(f.classes.has('inking')).toBe(false);
 });
 it('retains the full stroke through a capture exception and window movement',()=>{
  const f=fixture();f.canvas.setPointerCapture.mockImplementation(()=>{throw new Error('capture unavailable');});
  f.send(f.canvas,'pointerdown');f.send(f.win,'pointermove');f.send(f.win,'pointerup');expect(f.handlers.move).toHaveBeenCalledTimes(2);expect(f.handlers.finish).toHaveBeenCalledTimes(1);expect(f.input.diagnostics.captureFallbacks).toBe(1);
 });
 it('recovers a missing pen-up without refusing the next down',()=>{
  const f=fixture();f.send(f.canvas,'pointerdown');f.send(f.win,'pointermove');f.send(f.canvas,'pointerdown');f.send(f.win,'pointermove');f.send(f.win,'pointerup');expect(f.handlers.start).toHaveBeenCalledTimes(2);expect(f.handlers.finish).toHaveBeenCalledTimes(2);expect(f.input.diagnostics.recoveredDowns).toBe(1);
 });
 it('does not finish a current stroke for an old up or a different palm',()=>{
  const f=fixture();f.send(f.canvas,'pointerdown',{timeStamp:100});f.send(f.win,'pointerup',{timeStamp:50});f.send(f.canvas,'pointerdown',{pointerType:'touch',pointerId:9});expect(f.handlers.finish).not.toHaveBeenCalled();expect(f.input.diagnostics.rejectedTouches).toBe(1);f.send(f.win,'pointercancel',{timeStamp:110});expect(f.handlers.finish).toHaveBeenCalledTimes(1);
 });
 it('suppresses selection and touch defaults while keeping finger writing opt-in',()=>{
  const f=fixture();const touch=f.send(f.canvas,'pointerdown',{pointerType:'touch'});expect(touch.defaultPrevented).toBe(true);expect(f.handlers.start).not.toHaveBeenCalled();
  f.handlers.allowFinger.mockReturnValue(true);f.send(f.canvas,'pointerdown',{pointerType:'touch'});const select=f.send(f.doc,'selectstart');expect(select.defaultPrevented).toBe(true);expect(f.selection.removeAllRanges).toHaveBeenCalledTimes(1);f.send(f.win,'pointerup',{pointerType:'touch'});const after=f.send(f.doc,'selectstart');expect(after.defaultPrevented).toBe(false);
 });
 it('delivers one coalesced batch and falls back when the API is empty or throws',()=>{
  const f=fixture();f.send(f.canvas,'pointerdown');const batch=[{clientX:21,pressure:0},{clientX:22,pressure:.002}];f.send(f.win,'pointermove',{getCoalescedEvents:()=>batch});expect(f.handlers.move).toHaveBeenLastCalledWith(batch);
  f.send(f.win,'pointermove',{getCoalescedEvents:()=>[]});f.send(f.win,'pointermove',{getCoalescedEvents:()=>{throw new Error('unsupported');}});expect(f.handlers.move).toHaveBeenCalledTimes(3);expect(f.input.diagnostics.samples).toBe(4);
 });
 it('ends once on blur/dispose, then removes listeners',()=>{
  const f=fixture();f.send(f.canvas,'pointerdown');f.send(f.win,'blur');f.input.dispose();f.send(f.canvas,'pointerdown');expect(f.handlers.start).toHaveBeenCalledTimes(1);expect(f.handlers.finish).toHaveBeenCalledTimes(1);
 });
});
describe('ink pressure and immutable local save',()=>{
 it('preserves true Pencil pressure including zero and draws visible low-pressure lines',()=>{
  const rect={left:0,top:0,width:768,height:1024};const points=[0,.001,.08].map((pressure,i)=>normalizePoint(i*20,20,rect,pressure,'pen'));expect(points.map(p=>p.pressure)).toEqual([0,.001,.08]);
  expect(inkLineWidth(2.5,0)).toBe(1.875);expect(inkLineWidth(2.5,.001)).toBeGreaterThan(1.87);
  const svg=inkPageSvg({id:'p',width:768,height:1024,strokes:[{id:'s',color:'#253e31',width:2.5,points}]});expect(svg).toContain('stroke-width="1.88"');expect(points[0].pressure).toBe(0);
 });
 it('snapshots a draft without sharing mutable stroke arrays or serializing coordinates',()=>{
  const target={id:'t',projectId:'p',projectTitle:'original',sessionId:'s',taskId:'task',title:'test',instruction:'draw',sourceIds:[],helpLevel:0,mode:'practice' as const,createdAt:'2026-09-14T00:00:00.000Z'};
  const draft=createDraft('workspace',target);draft.pages[0].strokes.push({id:'s',color:'#253e31',width:2.5,points:[{x:.1,y:.2,pressure:.001}]});const frozen=snapshotDraft(draft);
  draft.pages[0].strokes[0].points.push({x:.2,y:.3,pressure:0});draft.pages[0].strokes.push({id:'later',color:'#253e31',width:2.5,points:[]});draft.note='new';
  expect(frozen.pages[0].strokes).toHaveLength(1);expect(frozen.pages[0].strokes[0].points).toHaveLength(1);expect(frozen.note).toBe('');expect(frozen.pages[0].strokes[0].points[0]).toBe(draft.pages[0].strokes[0].points[0]);
 });
});
