export const SIDEBAR_STORAGE_KEY='reclimb.ui.sidebar.v1';
export interface SidebarSnapshot {mode:'auto'|'pinned';expanded:boolean;width:number;resizing:boolean}
type PreferenceStorage=Pick<Storage,'getItem'|'setItem'>;
const clamp=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(220,Math.min(360,value))):236;
export function createSidebarController(storage?:PreferenceStorage){
 let mode:SidebarSnapshot['mode']='auto',width=236;
 try{const saved=JSON.parse(storage?.getItem(SIDEBAR_STORAGE_KEY)||'null');if(saved){mode=saved.mode==='pinned'?'pinned':'auto';width=clamp(saved.width)}}catch{/* Invalid or unavailable preferences use the default sidebar layout. */}
 let snapshot:SidebarSnapshot={mode,width,expanded:mode==='pinned',resizing:false};
 let pointer=false,focused=false;let opening:ReturnType<typeof setTimeout>|undefined,closing:ReturnType<typeof setTimeout>|undefined;
 const listeners=new Set<()=>void>();
 function update(next:Partial<SidebarSnapshot>){snapshot={...snapshot,...next};listeners.forEach(fn=>fn())}
 function clear(){clearTimeout(opening);clearTimeout(closing)}
 function persist(){try{storage?.setItem(SIDEBAR_STORAGE_KEY,JSON.stringify({mode:snapshot.mode,width:snapshot.width}))}catch{/* Layout changes remain usable in memory when preference storage is unavailable. */}}
 function laterClose(){clearTimeout(closing);if(snapshot.mode==='auto'&&!pointer&&!focused&&!snapshot.resizing)closing=setTimeout(()=>{if(!pointer&&!focused&&!snapshot.resizing&&snapshot.mode==='auto')update({expanded:false})},250)}
 return {
  getSnapshot:()=>snapshot,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
  clearTimers:clear,
  pointerEnter(){pointer=true;clearTimeout(closing);if(!snapshot.expanded){clearTimeout(opening);opening=setTimeout(()=>{if(pointer)update({expanded:true})},120)}},
  pointerLeave(){pointer=false;clearTimeout(opening);laterClose()},
  focusEnter(){focused=true;clear();update({expanded:true})},
  focusLeave(){focused=false;laterClose()},
  escape(){if(snapshot.mode==='pinned')return;clear();focused=false;pointer=false;update({expanded:false})},
  toggleOpen(){clear();if(snapshot.mode==='pinned')return;if(snapshot.expanded){focused=false;pointer=false;update({expanded:false})}else update({expanded:true})},
  togglePinned(){clear();const mode=snapshot.mode==='pinned'?'auto':'pinned';update({mode,expanded:true});persist();laterClose()},
  beginResize(){clear();update({resizing:true,expanded:true})},
  setWidth(value:number){update({width:clamp(value)})},
  endResize(){update({resizing:false});persist();laterClose()}
 };
}
