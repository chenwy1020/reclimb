import {describe,expect,it,vi} from 'vitest';
import {recoverFailedRestoreSafely,WorkspaceTransitionGate} from '../src/main/workspace-recovery';

describe('failed restore workspace gate',()=>{
 it('does not reopen an ambiguous workspace when journal recovery fails',async()=>{
  const reopen=vi.fn(async()=>{}),block=vi.fn();
  await expect(recoverFailedRestoreSafely({recover:()=>{throw new Error('locked move')},workspaceExists:()=>true,reopen,block})).rejects.toThrow(/停止访问|重启/);
  expect(reopen).not.toHaveBeenCalled();
  expect(block).toHaveBeenCalledOnce();
 });

 it('blocks access when recovery leaves no workspace or reopening itself fails',async()=>{
  const absentReopen=vi.fn(async()=>{}),absentBlock=vi.fn();
  await expect(recoverFailedRestoreSafely({recover:()=>({recovered:true,phase:'rollback'}),workspaceExists:()=>false,reopen:absentReopen,block:absentBlock})).rejects.toThrow(/停止访问|重启/);
  expect(absentReopen).not.toHaveBeenCalled();expect(absentBlock).toHaveBeenCalledOnce();
  const openBlock=vi.fn();
  await expect(recoverFailedRestoreSafely({recover:()=>({recovered:true,phase:'rollback'}),workspaceExists:()=>true,reopen:async()=>{throw new Error('cannot open')},block:openBlock})).rejects.toThrow(/停止访问|重启/);
  expect(openBlock).toHaveBeenCalledOnce();
 });

 it('reopens only after journal recovery succeeds and the workspace exists',async()=>{
  const order:string[]=[],block=vi.fn();
  await recoverFailedRestoreSafely({recover:()=>{order.push('recover');return{recovered:true,phase:'rollback'}},workspaceExists:()=>{order.push('exists');return true},reopen:async()=>{order.push('reopen')},block});
  expect(order).toEqual(['recover','exists','reopen']);expect(block).not.toHaveBeenCalled();
 });

 it('refuses to reopen when the journal was missing or described a committed restore',async()=>{
  for(const result of [{recovered:false} as const,{recovered:true,phase:'commit'} as const]){
   const reopen=vi.fn(async()=>{}),block=vi.fn();
   await expect(recoverFailedRestoreSafely({recover:()=>result,workspaceExists:()=>true,reopen,block})).rejects.toThrow(/停止访问|重启/);
   expect(reopen).not.toHaveBeenCalled();expect(block).toHaveBeenCalledOnce();
  }
 });

 it('blocks every concurrent operation during a workspace transition and stays blocked after an ambiguous failure',()=>{
  const gate=new WorkspaceTransitionGate(),finish=gate.begin();
  expect(()=>gate.assertAvailable()).toThrow(/切换|恢复/);
  finish();expect(()=>gate.assertAvailable()).not.toThrow();
  const finishBlocked=gate.begin();gate.block('档案状态待恢复');finishBlocked();
  expect(()=>gate.assertAvailable()).toThrow('档案状态待恢复');
  expect(()=>gate.begin()).toThrow('档案状态待恢复');
 });
});
