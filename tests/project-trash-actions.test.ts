import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleProjectTrashAction} from '../src/main/project-trash-actions';
import {LearningService} from '../src/main/learning-service';
import {LearningStore} from '../src/main/store';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('project trash desktop actions',()=>{
 it('validates the project id and dispatches trash, restore and purge without a model',()=>{
  const operations={trash:vi.fn(),restore:vi.fn(),purge:vi.fn()};
  handleProjectTrashAction(operations,'project.trash',{id:'p'});
  handleProjectTrashAction(operations,'project.restore',{id:'p'});
  handleProjectTrashAction(operations,'project.purge',{id:'p'});
  expect(operations.trash).toHaveBeenCalledWith('p');expect(operations.restore).toHaveBeenCalledWith('p');expect(operations.purge).toHaveBeenCalledWith('p');
  expect(()=>handleProjectTrashAction(operations,'project.trash',{id:''})).toThrow();
  expect(()=>handleProjectTrashAction(operations,'project.restore',{id:'p',unexpected:true})).toThrow();
 });

 it('refuses project management while an AI operation can still publish project records',()=>{
  for(const action of ['project.trash','project.restore','project.purge'] as const){
   const operations={trash:vi.fn(),restore:vi.fn(),purge:vi.fn()};
   expect(()=>handleProjectTrashAction(operations,action,{id:'p'},true)).toThrow('AI 请求');
   expect(operations.trash).not.toHaveBeenCalled();expect(operations.restore).not.toHaveBeenCalled();expect(operations.purge).not.toHaveBeenCalled();
  }
 });

 it('blocks learning operations for a recently deleted project before any model request',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-trash-actions-'));roots.push(root);const store=await LearningStore.open(root);
  const complete=vi.fn(async()=>{throw new Error('model must not run');});
  try{
   const now='2026-09-11T00:00:00.000Z';store.put('projects',{id:'p',title:'已删除',goal:'学习',status:'active',createdAt:now,updatedAt:now,trashedAt:now,statusBeforeTrash:'active'});
   const service=new LearningService(store,()=>'',()=>({complete}));
   expect(()=>service.saveStartingPoint('p',{familiarity:'new',background:''})).toThrow('最近删除');
   await expect(service.start('p')).rejects.toThrow('最近删除');
   expect(complete).not.toHaveBeenCalled();
  }finally{store.close();}
 });
});
