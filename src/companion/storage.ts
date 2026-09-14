import {snapshotDraft,type LocalDraft} from './draft';
export interface PairCredentials {token:string;workspaceId:string;}
let opening:Promise<IDBDatabase>|undefined;
function open(){return opening??=new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('reclimb-handwriting',1);
 request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('drafts',{keyPath:'key'});db.createObjectStore('connection');};
 request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 request.onerror=()=>{opening=undefined;reject(new Error('无法打开本机草稿存储。请保留当前页面并下载原稿。'));};
 request.onblocked=()=>{opening=undefined;reject(new Error('草稿存储正被另一个页面占用，请关闭旧页面后重试。'));};
 });}
async function read<T>(store:string,key:IDBValidKey):Promise<T|undefined>{const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction(store,'readonly').objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function write(store:string,value:unknown,key?:IDBValidKey):Promise<void>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error??new Error('本机保存没有完成，请下载原稿。'));tx.objectStore(store).put(value,key);});}
export async function saveDraft(draft:LocalDraft){await write('drafts',snapshotDraft(draft));}
export async function loadDraft(key:string){return read<LocalDraft>('drafts',key);}
export async function listDrafts(workspaceId:string){const db=await open();return new Promise<LocalDraft[]>((resolve,reject)=>{const request=db.transaction('drafts','readonly').objectStore('drafts').getAll();request.onsuccess=()=>resolve((request.result as LocalDraft[]).filter(draft=>draft.workspaceId===workspaceId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));request.onerror=()=>reject(request.error);});}
export const loadCredentials=()=>read<PairCredentials>('connection','credentials');
export const saveCredentials=(value:PairCredentials)=>write('connection',value,'credentials');
export const loadSelection=()=>read<string>('connection','selection');
export const saveSelection=(key:string)=>write('connection',key,'selection');
