import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COLLECTIONS,LearningStore} from '../src/main/store';
import type {Collection,Project} from '../src/shared/types';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const project=(id:string):Project=>({id,title:id,goal:'学习',status:'active',createdAt:'2026-09-11T00:00:00.000Z',updatedAt:'2026-09-11T00:00:00.000Z'});

describe('whole-project database purge',()=>{
 it('removes every project-scoped collection and search term without touching another project or settings',async()=>{
  const root=mkdtempSync(join(tmpdir(),'reclimb-project-purge-'));roots.push(root);
  const store=await LearningStore.open(root);
  try{
   store.updateSettings({personalGoal:'保留整个学习空间的设置'});
   store.put('projects',project('delete-me'));store.put('projects',project('keep-me'));
   for(const collection of COLLECTIONS.filter(name=>name!=='projects')){
    const make=(projectId:string)=>({id:`${collection}-${projectId}`,projectId,...(collection==='fragments'?{materialId:`material-${projectId}`,locator:'第一段',ordinal:0,text:projectId==='delete-me'?'只属于待删项目的检索词':'保留项目检索词'}:{})});
    store.put(collection as Exclude<Collection,'projects'>,make('delete-me') as never);
    store.put(collection as Exclude<Collection,'projects'>,make('keep-me') as never);
   }
   expect(store.searchFragments('delete-me','待删项目')).toHaveLength(1);

   store.deleteProjectRecords('delete-me');

   expect(store.get('projects','delete-me')).toBeUndefined();
   for(const collection of COLLECTIONS.filter(name=>name!=='projects'))expect(store.list(collection as Exclude<Collection,'projects'>,'delete-me')).toEqual([]);
   expect(store.searchFragments('delete-me','待删项目')).toEqual([]);
   expect(store.get('projects','keep-me')).toBeDefined();
   for(const collection of COLLECTIONS.filter(name=>name!=='projects'))expect(store.list(collection as Exclude<Collection,'projects'>,'keep-me')).toHaveLength(1);
   expect(store.searchFragments('keep-me','保留项目')).toHaveLength(1);
   expect(store.getSettings().personalGoal).toBe('保留整个学习空间的设置');
  }finally{store.close();}
 });
});
