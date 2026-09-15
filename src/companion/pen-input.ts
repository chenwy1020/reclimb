export type PenSample=Pick<PointerEvent,'clientX'|'clientY'|'pressure'|'pointerType'|'pointerId'|'timeStamp'|'button'>;
export interface PenInputDiagnostics {
 starts:number; completed:number; cancelled:number; captureFallbacks:number; captureLosses:number;
 recoveredDowns:number; rejectedTouches:number; moveEvents:number; samples:number; preventedSelections:number;
 pointerPenDowns:number; stylusTouchDowns:number; nativeStrokes:number; streamHandovers:number;
 suppressedPointerEvents:number; directTouchStarts:number; uncancelableTouches:number;
 trace:{event:string;source:string;contact:number;cancelable:boolean}[];
}
export interface PenInputHandlers {
 start(event:PenSample):boolean;
 move(events:PenSample[]):void;
 finish():void;
 allowFinger():boolean;
}
type StylusTouch=Pick<Touch,'identifier'|'target'|'clientX'|'clientY'> & {touchType?:string;force?:number};

/** Preserve PointerEvents for mouse/finger and browsers without stylus touches.
 * Safari's explicit touchType="stylus" can own a Pencil contact when Scribble
 * interrupts its pointer stream. One contact has one owner; secondary pointer
 * up/cancel events cannot terminate the native touch stroke. No timing delay or
 * user-agent sniffing is used to guess that a finger is a Pencil. */
export function attachPenInput(canvas:HTMLCanvasElement,handlers:PenInputHandlers){
 const doc=canvas.ownerDocument,win=doc.defaultView!;
 const diagnostics:PenInputDiagnostics={starts:0,completed:0,cancelled:0,captureFallbacks:0,captureLosses:0,recoveredDowns:0,rejectedTouches:0,moveEvents:0,samples:0,preventedSelections:0,pointerPenDowns:0,stylusTouchDowns:0,nativeStrokes:0,streamHandovers:0,suppressedPointerEvents:0,directTouchStarts:0,uncancelableTouches:0,trace:[]};
 let active:{owner:'pointer'|'stylus-touch';id:number;startedAt:number;pointerId?:number;pointerType:string;receivedMoves:number}|undefined;
 const prevent=(event:Event)=>{if(event.cancelable)event.preventDefault();};
 const trace=(event:Event,source:string)=>{if(event.type==='pointermove'||event.type==='touchmove')return;diagnostics.trace.push({event:event.type,source,contact:diagnostics.starts,cancelable:event.cancelable});if(diagnostics.trace.length>96)diagnostics.trace.shift();};
 const belongs=(event:PointerEvent)=>active?.owner==='pointer'&&active.id===event.pointerId&&event.timeStamp>=active.startedAt;
 const selectionBlocked=()=>!!active||doc.body.classList.contains('writing-focus');
 function clearSelection(){const selection=doc.getSelection();if(selection?.rangeCount&&!selection.isCollapsed){diagnostics.preventedSelections++;selection.removeAllRanges();}}
 function enter(sample:PenSample){
  doc.body.classList.add('inking');doc.getSelection()?.removeAllRanges();
  const focused=doc.activeElement;
  if(sample.pointerType==='pen'&&focused instanceof win.HTMLElement&&focused.matches('input,textarea,[contenteditable=true]'))focused.blur();
 }
 function finish(cancelled=false){
  if(!active)return;const pointer=active.pointerId;active=undefined;doc.body.classList.remove('inking');
  if(cancelled)diagnostics.cancelled++;else diagnostics.completed++;
  if(pointer!==undefined)try{if(canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);}catch{}
  handlers.finish();
 }
 function down(event:PointerEvent){
  trace(event,event.pointerType);prevent(event);
  if(event.pointerType==='pen')diagnostics.pointerPenDowns++;
  if(event.button>0)return;
  if(event.pointerType==='touch'&&!handlers.allowFinger()){diagnostics.rejectedTouches++;return;}
  if(active?.owner==='stylus-touch'){diagnostics.suppressedPointerEvents++;return;}
  if(active){
   if(active.id!==event.pointerId&&!(active.pointerType==='pen'&&event.pointerType==='pen'))return;
   diagnostics.recoveredDowns++;finish(true);
  }
  if(!handlers.start(event))return;
  active={owner:'pointer',id:event.pointerId,pointerId:event.pointerId,pointerType:event.pointerType,startedAt:event.timeStamp,receivedMoves:0};diagnostics.starts++;enter(event);
  try{canvas.setPointerCapture(event.pointerId);}catch{diagnostics.captureFallbacks++;}
 }
 function move(event:PointerEvent){
  if(active?.owner==='stylus-touch'){if(event.pointerType==='pen'){prevent(event);diagnostics.suppressedPointerEvents++;}return;}
  if(!belongs(event))return;prevent(event);diagnostics.moveEvents++;active!.receivedMoves++;
  let samples:PointerEvent[]=[];try{samples=event.getCoalescedEvents?.()??[];}catch{}
  if(!samples.length)samples=[event];diagnostics.samples+=samples.length;handlers.move(samples);
 }
 function up(event:PointerEvent){trace(event,event.pointerType);if(active?.owner==='stylus-touch'){if(event.pointerType==='pen'){prevent(event);diagnostics.suppressedPointerEvents++;}return;}if(!belongs(event))return;prevent(event);handlers.move([event]);finish();}
 function cancel(event:PointerEvent){trace(event,event.pointerType);if(active?.owner==='stylus-touch'){diagnostics.suppressedPointerEvents++;return;}if(!belongs(event))return;prevent(event);finish(true);}
 function lost(event:PointerEvent){trace(event,event.pointerType);if(active?.pointerId===event.pointerId)diagnostics.captureLosses++;}
 const touches=(event:TouchEvent)=>Array.from(event.changedTouches??[]) as StylusTouch[];
 const sample=(touch:StylusTouch,event:TouchEvent):PenSample=>({clientX:touch.clientX,clientY:touch.clientY,pressure:typeof touch.force==='number'&&Number.isFinite(touch.force)?touch.force:0,pointerType:'pen',pointerId:touch.identifier,timeStamp:event.timeStamp,button:0});
 function touchStart(event:TouchEvent){
  prevent(event);if(!event.cancelable)diagnostics.uncancelableTouches++;
  const changed=touches(event);diagnostics.directTouchStarts+=changed.filter(t=>t.touchType!=='stylus').length;
  const touch=changed.find(t=>t.touchType==='stylus'&&t.target===canvas);if(!touch)return;
  trace(event,'stylus');diagnostics.stylusTouchDowns++;const point=sample(touch,event);
  // Handover the same not-yet-moved pointer contact instead of adding a dot.
  if(active?.owner==='pointer'&&active.pointerType==='pen'&&active.receivedMoves===0){
   active={...active,owner:'stylus-touch',id:touch.identifier};diagnostics.streamHandovers++;diagnostics.nativeStrokes++;return;
  }
  if(active){diagnostics.recoveredDowns++;finish(true);}
  if(!handlers.start(point))return;
  active={owner:'stylus-touch',id:touch.identifier,pointerType:'pen',startedAt:event.timeStamp,receivedMoves:0};diagnostics.starts++;diagnostics.nativeStrokes++;enter(point);
 }
 function touchMove(event:TouchEvent){
  if(active?.owner!=='stylus-touch'||event.timeStamp<active.startedAt)return;
  const touch=touches(event).find(t=>t.identifier===active!.id);if(!touch)return;
  prevent(event);if(!event.cancelable)diagnostics.uncancelableTouches++;diagnostics.moveEvents++;diagnostics.samples++;active.receivedMoves++;handlers.move([sample(touch,event)]);
 }
 function touchEnd(event:TouchEvent){
  if(active?.owner!=='stylus-touch'||event.timeStamp<active.startedAt)return;
  const touch=touches(event).find(t=>t.identifier===active!.id);if(!touch)return;
  trace(event,'stylus');prevent(event);if(event.type!=='touchcancel')handlers.move([sample(touch,event)]);finish(event.type==='touchcancel');
 }
 function select(event:Event){if(selectionBlocked()){diagnostics.preventedSelections++;prevent(event);}}
 function selectionChange(){if(selectionBlocked())clearSelection();}
 function blur(){finish(true);}
 canvas.addEventListener('pointerdown',down,{passive:false});
 win.addEventListener('pointermove',move,{capture:true,passive:false});win.addEventListener('pointerup',up,{capture:true,passive:false});win.addEventListener('pointercancel',cancel,{capture:true,passive:false});
 canvas.addEventListener('lostpointercapture',lost);canvas.addEventListener('touchstart',touchStart,{passive:false});
 // Native touch targets remain the original canvas, including moves outside it.
 win.addEventListener('touchmove',touchMove,{capture:true,passive:false});win.addEventListener('touchend',touchEnd,{capture:true,passive:false});win.addEventListener('touchcancel',touchEnd,{capture:true,passive:false});
 canvas.addEventListener('touchmove',prevent,{passive:false});canvas.addEventListener('contextmenu',prevent);
 doc.addEventListener('selectstart',select,{capture:true});doc.addEventListener('selectionchange',selectionChange);win.addEventListener('blur',blur);
 return{finish,diagnostics,dispose(){finish(true);canvas.removeEventListener('pointerdown',down);win.removeEventListener('pointermove',move,true);win.removeEventListener('pointerup',up,true);win.removeEventListener('pointercancel',cancel,true);canvas.removeEventListener('lostpointercapture',lost);canvas.removeEventListener('touchstart',touchStart);win.removeEventListener('touchmove',touchMove,true);win.removeEventListener('touchend',touchEnd,true);win.removeEventListener('touchcancel',touchEnd,true);canvas.removeEventListener('touchmove',prevent);canvas.removeEventListener('contextmenu',prevent);doc.removeEventListener('selectstart',select,true);doc.removeEventListener('selectionchange',selectionChange);win.removeEventListener('blur',blur);}};
}
