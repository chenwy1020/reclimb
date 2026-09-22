import {useEffect,useRef,useState,type RefObject} from 'react';
import type {Fragment,WorkspaceSnapshot} from '../shared/types';
import type {ReaderState} from '../shared/remediation';
import {registerLocalDraftFlush,trackLocalSave} from './local-save-queue';
export function latestReaderState(snapshot:WorkspaceSnapshot,projectId:string,materialId?:string){return (snapshot.readerStates??[]).filter(r=>r.projectId===projectId&&(!materialId||r.materialId===materialId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];}
export function useReaderContinuity(snapshot:WorkspaceSnapshot,fragment:Fragment|undefined,tab:string,root:RefObject<HTMLDivElement|null>,body:RefObject<HTMLDivElement|null>){
 const [error,setError]=useState(''),pending=useRef<Omit<ReaderState,'id'|'updatedAt'>|undefined>(undefined),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),tail=useRef(Promise.resolve()),current=useRef({fragment,tab}),saved=useRef(new Map<string,ReaderState>());current.current={fragment,tab};
 for(const state of snapshot.readerStates??[]){const prior=saved.current.get(state.materialId);if(!prior||prior.updatedAt<=state.updatedAt)saved.current.set(state.materialId,state);}
 const restoring=useRef<{fragmentId:string;scrollTop:number}|undefined>(undefined);
 const scrollElement=()=>root.current?.querySelector<HTMLDivElement>('.pdf-canvas-scroll')??body.current;
 const flush=async()=>{if(timer.current)clearTimeout(timer.current);const value=pending.current;if(!value)return tail.current;pending.current=undefined;const save=tail.current.catch(()=>{}).then(()=>window.learning.request<ReaderState>('reader.save',value)).then(state=>{saved.current.set(state.materialId,state);setError('')},e=>{if(!pending.current)pending.current=value;setError('阅读位置尚未保存，可重试。');throw e});tail.current=save;await trackLocalSave(save)};
 const flushRef=useRef(flush);flushRef.current=flush;
 function queue(){const {fragment:f,tab:t}=current.current;if(!f)return;pending.current={projectId:f.projectId,materialId:f.materialId,fragmentId:f.id,pageNumber:f.pageNumber,scrollTop:restoring.current?.fragmentId===f.id?restoring.current.scrollTop:scrollElement()?.scrollTop??0,expanded:['tab:'+t,...[...(root.current?.querySelectorAll<HTMLDetailsElement>('details[data-reader-section][open]')??[])].map(el=>el.dataset.readerSection!)]};if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void flushRef.current().catch(()=>{}),250);}
 useEffect(()=>{const element=root.current;if(!element)return;const onScroll=(event:Event)=>{if(event.target===scrollElement())queue()};element.addEventListener('toggle',queue,true);element.addEventListener('scroll',onScroll,true);return()=>{element.removeEventListener('toggle',queue,true);element.removeEventListener('scroll',onScroll,true)}},[fragment?.id]);
 useEffect(()=>registerLocalDraftFlush(()=>flushRef.current()),[]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);void flushRef.current().catch(()=>{})},[]);
 useEffect(()=>{
  if(!fragment)return;void flushRef.current().catch(()=>{});
  const state=saved.current.get(fragment.materialId),scrollTop=state?.fragmentId===fragment.id?state.scrollTop:0;
  restoring.current={fragmentId:fragment.id,scrollTop};
  for(const el of root.current?.querySelectorAll<HTMLDetailsElement>('details[data-reader-section]')??[])el.open=state?.expanded.includes(el.dataset.readerSection!)??false;
  // A PDF gets its scrollable height only after the requested page finishes rendering.
  // Preserve the saved offset while loading instead of replacing it with a clamped zero.
  const restore=()=>{
   if(restoring.current?.fragmentId!==fragment.id)return true;
   const element=scrollElement();if(!element)return false;
   if(element.classList.contains('pdf-canvas-scroll')){
    const canvas=element.querySelector('canvas');
    if(!canvas||canvas.dataset.renderedPage!==String(fragment.pageNumber)||element.querySelector('.pdf-loading'))return false;
   }
   element.scrollTop=restoring.current.scrollTop;restoring.current=undefined;queue();return true;
  };
  const observer=new MutationObserver(()=>{if(restore())observer.disconnect()});
  if(!restore()&&root.current)observer.observe(root.current,{subtree:true,childList:true,attributes:true,attributeFilter:['data-rendered-page','width','height']});
  queue();return()=>observer.disconnect();
 },[fragment?.id]);
 useEffect(()=>queue(),[tab]);
 return {queue,flush:()=>flushRef.current(),latest:(materialId:string)=>saved.current.get(materialId),error,retry:()=>void flushRef.current().catch(()=>{})};
}
