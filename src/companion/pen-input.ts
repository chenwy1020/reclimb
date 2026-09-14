export interface PenInputDiagnostics {
 starts:number; completed:number; cancelled:number; captureFallbacks:number; captureLosses:number;
 recoveredDowns:number; rejectedTouches:number; moveEvents:number; samples:number; preventedSelections:number;
}
export interface PenInputHandlers {
 start(event:PointerEvent):boolean;
 move(events:PointerEvent[]):void;
 finish():void;
 allowFinger():boolean;
}

/** A capture loss is not a pen-up. Safari may dispatch the previous stroke's
 * lostpointercapture after a new stroke reused that pointer ID. Keep receiving
 * on the window until an actual up/cancel, so a capture failure cannot eat ink. */
export function attachPenInput(canvas:HTMLCanvasElement,handlers:PenInputHandlers){
 const doc=canvas.ownerDocument,win=doc.defaultView!;
 const diagnostics:PenInputDiagnostics={starts:0,completed:0,cancelled:0,captureFallbacks:0,captureLosses:0,recoveredDowns:0,rejectedTouches:0,moveEvents:0,samples:0,preventedSelections:0};
 let active:{id:number;startedAt:number}|undefined;
 const prevent=(event:Event)=>{if(event.cancelable)event.preventDefault();};
 const belongs=(event:PointerEvent)=>active?.id===event.pointerId&&event.timeStamp>=active.startedAt;
 function finish(cancelled=false){
  if(!active)return;const pointer=active.id;active=undefined;
  doc.body.classList.remove('inking');
  if(cancelled)diagnostics.cancelled++;else diagnostics.completed++;
  try{if(canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);}catch{}
  handlers.finish();
 }
 function down(event:PointerEvent){
  // Stop Safari's compatibility selection gestures even for a rejected palm.
  prevent(event);
  if(event.button>0)return;
  if(event.pointerType==='touch'&&!handlers.allowFinger()){diagnostics.rejectedTouches++;return;}
  if(active){
   if(active.id!==event.pointerId)return;
   // A new down is a new physical stroke, even if the previous up was lost.
   diagnostics.recoveredDowns++;finish(true);
  }
  if(!handlers.start(event))return;
  active={id:event.pointerId,startedAt:event.timeStamp};diagnostics.starts++;
  doc.body.classList.add('inking');doc.getSelection()?.removeAllRanges();
  const focused=doc.activeElement;
  if(event.pointerType==='pen'&&focused instanceof win.HTMLElement&&focused.matches('input,textarea,[contenteditable=true]'))focused.blur();
  try{canvas.setPointerCapture(event.pointerId);}catch{diagnostics.captureFallbacks++;}
 }
 function move(event:PointerEvent){
  if(!belongs(event))return;prevent(event);diagnostics.moveEvents++;
  let samples:PointerEvent[]=[];
  try{samples=event.getCoalescedEvents?.()??[];}catch{}
  if(!samples.length)samples=[event];
  diagnostics.samples+=samples.length;handlers.move(samples);
 }
 function up(event:PointerEvent){if(!belongs(event))return;prevent(event);handlers.move([event]);finish();}
 function cancel(event:PointerEvent){if(!belongs(event))return;prevent(event);finish(true);}
 function lost(event:PointerEvent){if(active?.id===event.pointerId)diagnostics.captureLosses++;}
 function select(event:Event){if(active){diagnostics.preventedSelections++;prevent(event);}}
 function blur(){finish(true);}
 canvas.addEventListener('pointerdown',down,{passive:false});
 // Window capture also receives points outside the canvas and works when
 // setPointerCapture is unavailable or rejected by the browser.
 win.addEventListener('pointermove',move,{capture:true,passive:false});
 win.addEventListener('pointerup',up,{capture:true,passive:false});
 win.addEventListener('pointercancel',cancel,{capture:true,passive:false});
 canvas.addEventListener('lostpointercapture',lost);
 canvas.addEventListener('touchstart',prevent,{passive:false});
 canvas.addEventListener('touchmove',prevent,{passive:false});
 canvas.addEventListener('contextmenu',prevent);
 doc.addEventListener('selectstart',select,{capture:true});win.addEventListener('blur',blur);
 return{finish,diagnostics,dispose(){finish(true);canvas.removeEventListener('pointerdown',down);win.removeEventListener('pointermove',move,true);win.removeEventListener('pointerup',up,true);win.removeEventListener('pointercancel',cancel,true);canvas.removeEventListener('lostpointercapture',lost);canvas.removeEventListener('touchstart',prevent);canvas.removeEventListener('touchmove',prevent);canvas.removeEventListener('contextmenu',prevent);doc.removeEventListener('selectstart',select,true);win.removeEventListener('blur',blur);}};
}
