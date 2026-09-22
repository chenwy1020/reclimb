import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Settings,Usage,WorkspaceSnapshot} from '../shared/types';
import {LearningStore} from './store';

export function canonicalSyncJson(value:unknown):string {
 const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,normalize(v[k])])):v;
 return JSON.stringify(normalize(value));
}
export function portableWorkspaceHash(snapshot:Omit<WorkspaceSnapshot,'dataDirectory'>,materialBytes:(id:string)=>Buffer):string {
 const {settings,dataDirectory:_directory,...collections}=snapshot as WorkspaceSnapshot;
 const formatVersion=(snapshot as unknown as {__reclimbBackupFormatVersion?:number}).__reclimbBackupFormatVersion;
 const remediation=new Set(['operations','learningProposals','routeAssociations','readerStates','validationSets','validationTasks','validationRuns','validationExposures','trialRecords']);
 const content:Record<string,unknown>={settings:{personalGoal:settings.personalGoal,studyMinutes:settings.studyMinutes,confirmedPreferences:settings.confirmedPreferences}};
 for(const [key,items] of Object.entries(collections))if(Array.isArray(items)&&!(formatVersion!==undefined&&formatVersion<11&&remediation.has(key)))content[key]=items.map(item=>{
  if(key!=='materials')return item;
  const {storedPath:_path,...material}=item as import('../shared/types').Material;
  return {...material,fileSha256:createHash('sha256').update(materialBytes(item.id)).digest('hex')};
 });
 for(const key of ['handwritingTargets','handwritings','handwritingTranscriptions'])content[key]??=[];
 return createHash('sha256').update(canonicalSyncJson(content)).digest('hex');
}
export function currentWorkspaceHash(store:LearningStore):string {
 const snapshot=store.snapshot();
 return portableWorkspaceHash(snapshot,id=>readFileSync(snapshot.materials.find(m=>m.id===id)!.storedPath));
}

/** Endpoint and key bindings, local budget and all local charges survive adopting another device. */
export function mergeSyncDeviceState(local:{settings:Settings;usage:Usage[]},remote:{settings:Settings;usage:Usage[]}):{settings:Settings;usage:Usage[]} {
 const usage=new Map(remote.usage.map(row=>[row.id,row]));
 for(const row of local.usage){
  const other=usage.get(row.id);
  if(other&&canonicalSyncJson(other)!==canonicalSyncJson(row))throw new Error('两台电脑存在同编号但内容不同的费用记录。为保留账本，本次未替换档案。');
  usage.set(row.id,row);
 }
 return {settings:{...local.settings,vision:local.settings.vision,personalGoal:remote.settings.personalGoal,studyMinutes:remote.settings.studyMinutes,confirmedPreferences:remote.settings.confirmedPreferences},usage:[...usage.values()]};
}
