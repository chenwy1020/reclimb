/** A user-entered writing view removes nearby editable fields from Safari's
 * Scribble targeting area. It does not claim to disable a system gesture or to
 * recover Pencil events that the OS never delivers to this page. */
export function installWritingFocus(finishStroke:()=>void){
 const button=document.getElementById('writing-focus') as HTMLButtonElement|null;
 const visibleStatus=document.getElementById('focus-save-status'),saveStatus=document.getElementById('save-status');
 if(!button||!visibleStatus||!saveStatus)return;
 let enabled=false,previousScroll=0;
 function set(next:boolean){
  if(next===enabled)return;finishStroke();
  if(next){previousScroll=scrollY;const focused=document.activeElement;if(focused instanceof HTMLElement)focused.blur();getSelection()?.removeAllRanges();}
  enabled=next;document.body.classList.toggle('writing-focus',next);visibleStatus!.hidden=!next;
  button!.textContent=next?'退出专注':'专注书写';button!.setAttribute('aria-pressed',String(next));
  requestAnimationFrame(()=>{window.scrollTo({top:next?0:previousScroll,behavior:'instant'});button!.focus({preventScroll:true});});
 }
 const update=()=>{visibleStatus!.textContent=saveStatus!.textContent;visibleStatus!.classList.toggle('failed',saveStatus!.classList.contains('failed'));};
 const observer=new MutationObserver(update);observer.observe(saveStatus,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class']});update();
 button.addEventListener('click',()=>set(!enabled));
 window.addEventListener('keydown',event=>{if(enabled&&event.key==='Escape'){event.preventDefault();set(false);}});
}
