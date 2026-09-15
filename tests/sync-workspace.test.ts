import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {readBackup,writeBackup} from '../src/main/backup';
import {currentWorkspaceHash,portableWorkspaceHash,mergeSyncDeviceState} from '../src/main/sync-workspace';
import {WorkspaceTransitionGate} from '../src/main/workspace-recovery';

describe('multi-computer workspace adoption',()=>{
 it('keeps local endpoint/key bindings and budget while retaining charges from both computers',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-sync-state-')),store=await LearningStore.open(root);
  try{
   const settings=store.getSettings(),a={id:'a',createdAt:new Date().toISOString(),requestId:'a',kind:'feedback',model:'local-model',inputTokens:20,outputTokens:10,estimatedCny:1,status:'completed' as const};
   const remoteSettings={...settings,baseUrl:'https://different.example',monthlyBudgetCny:900,personalGoal:'new goal'};
   const result=mergeSyncDeviceState({settings,usage:[a]},{settings:remoteSettings,usage:[{...a,id:'b'}]});
   expect(result.settings.baseUrl).toBe(settings.baseUrl);expect(result.settings.monthlyBudgetCny).toBe(settings.monthlyBudgetCny);expect(result.settings.personalGoal).toBe('new goal');expect(Object.hasOwn(result.settings,'vision')).toBe(true);
   expect(result.usage.reduce((sum,row)=>sum+row.estimatedCny,0)).toBe(2);
   expect(()=>mergeSyncDeviceState({settings,usage:[a]},{settings:remoteSettings,usage:[{...a,estimatedCny:0}]})).toThrow(/费用记录/);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
 });
 it('hashes the same validated archive across paths and excludes local model settings',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-sync-hash-')),store=await LearningStore.open(root);
  try{
   const before=currentWorkspaceHash(store),file=join(root,'test.reclimb');writeBackup(store,file);const backup=readBackup(file);
   expect(portableWorkspaceHash(backup.records,id=>backup.files.get(id)!.bytes)).toBe(before);
   store.updateSettings({monthlyBudgetCny:789,baseUrl:'https://local.example'});expect(currentWorkspaceHash(store)).toBe(before);
   store.put('projects',{id:'p',title:'example',goal:'learn',status:'active',createdAt:'2026-09-14T00:00:00.000Z',updatedAt:'2026-09-14T00:00:00.000Z'});expect(currentWorkspaceHash(store)).not.toBe(before);
   const snapshot=store.snapshot(),empty=()=>Buffer.alloc(0),rows=[{id:'review1',status:'uncertain'},{id:'review2',status:'ready'}];
   snapshot.taskReviews=rows as any;const ordered=portableWorkspaceHash(snapshot,empty);snapshot.taskReviews=[...rows].reverse() as any;expect(portableWorkspaceHash(snapshot,empty)).not.toBe(ordered);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
 });
 it('does not replace a workspace while an earlier asynchronous write is in flight',()=>{
  const gate=new WorkspaceTransitionGate(),done=gate.enterOperation();expect(()=>gate.begin()).toThrow(/仍有/);done();done();
  const finish=gate.begin();expect(()=>gate.enterOperation()).toThrow(/切换/);finish();expect(()=>gate.enterOperation()()).not.toThrow();
 });
});
