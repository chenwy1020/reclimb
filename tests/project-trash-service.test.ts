import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DiagnosticLog} from '../src/main/diagnostics';
import {ProjectTrashService} from '../src/main/project-trash';
import {LearningStore} from '../src/main/store';
import type {Project} from '../src/shared/types';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const at='2026-09-11T00:00:00.000Z';
const project=(id:string,status:Project['status']='active'):Project=>({id,title:id,goal:'学习',status,createdAt:at,updatedAt:at});
async function fixture(){const root=mkdtempSync(join(tmpdir(),'reclimb-trash-service-'));roots.push(root);const store=await LearningStore.open(root);return {root,store,close:()=>store.close()};}

describe('ProjectTrashService',()=>{
 it('keeps a project deleted when an original is missing without a deletion staging manifest',async()=>{
  const {root,store,close}=await fixture();
  try{
   const original=join(root,'materials','missing-original','book.md');
   store.put('projects',{...project('ordinary-restore'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'missing-original',projectId:'ordinary-restore',title:'缺失原件',kind:'md',originalName:'book.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));
   expect(()=>service.restore('ordinary-restore')).toThrow('原件');
   expect(store.get('projects','ordinary-restore')?.trashedAt).toBe(at);
   mkdirSync(join(root,'materials','missing-original'),{recursive:true});writeFileSync(original,'restored original');
   expect(service.restore('ordinary-restore').trashedAt).toBeUndefined();
   expect(readFileSync(original,'utf8')).toBe('restored original');
  }finally{close();}
 });
 it('moves a project to recent deletion and restores its prior active or paused state without changing related records',async()=>{
  const {root,store,close}=await fixture();
  try{
   store.put('projects',project('active'));store.put('projects',project('paused','paused'));
   store.put('attempts',{id:'a',projectId:'paused',sessionId:'s',text:'原作答',submittedAt:at,helpLevel:0,requestId:'r'});
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   expect(service.trash('active')).toMatchObject({status:'active',statusBeforeTrash:'active',trashedAt:at});
   expect(service.trash('paused')).toMatchObject({status:'paused',statusBeforeTrash:'paused',trashedAt:at});
   expect(service.trash('paused').trashedAt).toBe(at);
   expect(store.get('attempts','a')?.text).toBe('原作答');

   expect(service.restore('paused')).toMatchObject({status:'paused'});
   expect(store.get('projects','paused')).not.toHaveProperty('trashedAt');
   expect(store.get('attempts','a')?.text).toBe('原作答');
   expect(service.restore('paused').status).toBe('paused');
  }finally{close();}
 });

 it('purges only the selected project after staging its material folders and clears short-lived diagnostics',async()=>{
  const {root,store,close}=await fixture();
  try{
   const materialFolder=join(root,'materials','m-delete');mkdirSync(materialFolder,{recursive:true});const original=join(materialFolder,'book.md');writeFileSync(original,'private material');
   const keptFolder=join(root,'materials','m-keep');mkdirSync(keptFolder,{recursive:true});const kept=join(keptFolder,'keep.md');writeFileSync(kept,'keep');
   store.put('projects',{...project('delete-me'),trashedAt:at,statusBeforeTrash:'active'});store.put('projects',project('keep-me'));
   store.put('materials',{id:'m-delete',projectId:'delete-me',title:'待删材料',kind:'md',originalName:'book.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   store.put('materials',{id:'m-keep',projectId:'keep-me',title:'保留材料',kind:'md',originalName:'keep.md',storedPath:kept,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const log=new DiagnosticLog(join(root,'diagnostics'),()=>Date.parse(at));log.record({operationId:'op',kind:'test',model:'local',status:'invalid',response:'project content'});
   const service=new ProjectTrashService(store,root,log,()=>new Date(at));

   service.purge('delete-me');

   expect(store.get('projects','delete-me')).toBeUndefined();expect(store.list('materials','delete-me')).toEqual([]);expect(existsSync(materialFolder)).toBe(false);
   expect(store.get('projects','keep-me')).toBeDefined();expect(readFileSync(kept,'utf8')).toBe('keep');expect(log.preview().entries).toEqual([]);
  }finally{close();}
 });

 it('refuses an unexpected material path and rolls staged folders back if database deletion fails',async()=>{
  const {root,store,close}=await fixture();
  try{
   const outside=join(root,'outside.md');writeFileSync(outside,'outside');
   store.put('projects',{...project('unsafe'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'unsafe-material',projectId:'unsafe',title:'异常材料',kind:'md',originalName:'outside.md',storedPath:outside,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));
   expect(()=>service.purge('unsafe')).toThrow('材料路径');
   expect(store.get('projects','unsafe')).toBeDefined();expect(readFileSync(outside,'utf8')).toBe('outside');

   const folder=join(root,'materials','safe-material');mkdirSync(folder,{recursive:true});const file=join(folder,'safe.md');writeFileSync(file,'safe');
   store.put('projects',{...project('rollback'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'safe-material',projectId:'rollback',title:'安全材料',kind:'md',originalName:'safe.md',storedPath:file,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   vi.spyOn(store,'deleteProjectRecords').mockImplementationOnce(()=>{throw new Error('database failed');});
   expect(()=>service.purge('rollback')).toThrow('database failed');
   expect(store.get('projects','rollback')).toBeDefined();expect(readFileSync(file,'utf8')).toBe('safe');
  }finally{close();}
 });

 it('purges only expired projects and cleans abandoned staging directories',async()=>{
  const {root,store,close}=await fixture();
  try{
   store.put('projects',{...project('expired'),trashedAt:'2026-08-01T00:00:00.000Z',statusBeforeTrash:'active'});
   store.put('projects',{...project('recent'),trashedAt:'2026-09-10T00:00:00.000Z',statusBeforeTrash:'active'});
   const abandoned=join(root,'deletion-staging','abandoned');mkdirSync(abandoned,{recursive:true});writeFileSync(join(abandoned,'.committed'),'');writeFileSync(join(abandoned,'old'),'old');
   const recoverable=join(root,'deletion-staging','recoverable');mkdirSync(recoverable,{recursive:true});writeFileSync(join(recoverable,'material'),'must remain');
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   service.cleanStaging();expect(existsSync(abandoned)).toBe(false);expect(readFileSync(join(recoverable,'material'),'utf8')).toBe('must remain');
   const failures=service.purgeExpired();

   expect(failures).toEqual([]);expect(store.get('projects','expired')).toBeUndefined();expect(store.get('projects','recent')).toBeDefined();
  }finally{close();}
 });

 it('recovers material folders left in deletion staging before restoring the project',async()=>{
  const {root,store,close}=await fixture();
  try{
   const materialFolder=join(root,'materials','recover-material');mkdirSync(materialFolder,{recursive:true});const original=join(materialFolder,'book.md');writeFileSync(original,'recover me');
   store.put('projects',{...project('recover-me'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'recover-material',projectId:'recover-me',title:'待恢复材料',kind:'md',originalName:'book.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const staging=join(root,'deletion-staging','interrupted');mkdirSync(staging,{recursive:true});
   writeFileSync(join(staging,'project.json'),JSON.stringify({projectId:'recover-me',materialIds:['recover-material']}));renameSync(materialFolder,join(staging,'recover-material'));
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   const restored=service.restore('recover-me');

   expect(restored.status).toBe('active');expect(restored.trashedAt).toBeUndefined();expect(readFileSync(original,'utf8')).toBe('recover me');expect(existsSync(staging)).toBe(false);
  }finally{close();}
 });

 it('recovers legacy interrupted staging on startup while preserving unknown staging',async()=>{
  const {root,store,close}=await fixture();
  try{
   const materialFolder=join(root,'materials','legacy-material');mkdirSync(materialFolder,{recursive:true});const original=join(materialFolder,'legacy.md');writeFileSync(original,'legacy recovery');
   store.put('projects',{...project('legacy-recover'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'legacy-material',projectId:'legacy-recover',title:'旧暂存材料',kind:'md',originalName:'legacy.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const staging=join(root,'deletion-staging','legacy-interrupted');mkdirSync(staging,{recursive:true});writeFileSync(join(staging,'project.json'),JSON.stringify({projectId:'legacy-recover'}));renameSync(materialFolder,join(staging,'legacy-material'));
   const unknown=join(root,'deletion-staging','unknown');mkdirSync(unknown,{recursive:true});writeFileSync(join(unknown,'project.json'),'not json');writeFileSync(join(unknown,'keep'),'keep');
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   service.cleanStaging();

   expect(readFileSync(original,'utf8')).toBe('legacy recovery');expect(existsSync(staging)).toBe(false);expect(readFileSync(join(unknown,'keep'),'utf8')).toBe('keep');
  }finally{close();}
 });

 it('keeps a project in recent deletion when staged and original material folders conflict',async()=>{
  const {root,store,close}=await fixture();
  try{
   const materialFolder=join(root,'materials','conflict-material');mkdirSync(materialFolder,{recursive:true});const original=join(materialFolder,'book.md');writeFileSync(original,'current copy');
   store.put('projects',{...project('conflict-project'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'conflict-material',projectId:'conflict-project',title:'冲突材料',kind:'md',originalName:'book.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const staging=join(root,'deletion-staging','conflict');mkdirSync(join(staging,'conflict-material'),{recursive:true});writeFileSync(join(staging,'project.json'),JSON.stringify({projectId:'conflict-project',materialIds:['conflict-material']}));writeFileSync(join(staging,'conflict-material','book.md'),'staged copy');
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   expect(()=>service.restore('conflict-project')).toThrow('仍保留在最近删除');

   expect(store.get('projects','conflict-project')?.trashedAt).toBe(at);expect(readFileSync(original,'utf8')).toBe('current copy');expect(readFileSync(join(staging,'conflict-material','book.md'),'utf8')).toBe('staged copy');
  }finally{close();}
 });

 it('refuses to restore staged material whose recorded file path escapes its material folder',async()=>{
  const {root,store,close}=await fixture();
  try{
   const outside=join(root,'outside.md');writeFileSync(outside,'outside');
   store.put('projects',{...project('unsafe-recovery'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'unsafe-recovery-material',projectId:'unsafe-recovery',title:'异常恢复材料',kind:'md',originalName:'outside.md',storedPath:outside,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const staging=join(root,'deletion-staging','unsafe-recovery-stage');mkdirSync(join(staging,'unsafe-recovery-material'),{recursive:true});writeFileSync(join(staging,'project.json'),JSON.stringify({projectId:'unsafe-recovery',materialIds:['unsafe-recovery-material']}));writeFileSync(join(staging,'unsafe-recovery-material','book.md'),'staged');
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   expect(()=>service.restore('unsafe-recovery')).toThrow('仍保留在最近删除');

   expect(store.get('projects','unsafe-recovery')?.trashedAt).toBe(at);expect(readFileSync(outside,'utf8')).toBe('outside');expect(existsSync(join(staging,'unsafe-recovery-material'))).toBe(true);
  }finally{close();}
 });

 it('preserves the recovery manifest when a listed material folder is missing from both locations',async()=>{
  const {root,store,close}=await fixture();
  try{
   const original=join(root,'materials','missing-material','book.md');
   store.put('projects',{...project('missing-project'),trashedAt:at,statusBeforeTrash:'active'});
   store.put('materials',{id:'missing-material',projectId:'missing-project',title:'缺失材料',kind:'md',originalName:'book.md',storedPath:original,importedAt:at,warnings:[],fragmentCount:0,summary:''});
   const staging=join(root,'deletion-staging','missing-stage');mkdirSync(staging,{recursive:true});writeFileSync(join(staging,'project.json'),JSON.stringify({projectId:'missing-project',materialIds:['missing-material']}));
   const service=new ProjectTrashService(store,root,undefined,()=>new Date(at));

   expect(()=>service.restore('missing-project')).toThrow('仍保留在最近删除');

   expect(store.get('projects','missing-project')?.trashedAt).toBe(at);expect(existsSync(join(staging,'project.json'))).toBe(true);
  }finally{close();}
 });

 it('keeps a committed marker until diagnostic cleanup succeeds on a later startup',async()=>{
  const {root,store,close}=await fixture();
  try{
   store.put('projects',{...project('diagnostic-retry'),trashedAt:at,statusBeforeTrash:'active'});
   const diagnostics={clear:vi.fn().mockImplementationOnce(()=>{throw new Error('diagnostic file is locked');}).mockImplementation(()=>{})};
   const service=new ProjectTrashService(store,root,diagnostics,()=>new Date(at));

   service.purge('diagnostic-retry');

   expect(store.get('projects','diagnostic-retry')).toBeUndefined();expect(diagnostics.clear).toHaveBeenCalledTimes(1);
   expect(existsSync(join(root,'deletion-staging'))).toBe(true);

   service.cleanStaging();

   expect(diagnostics.clear).toHaveBeenCalledTimes(2);expect(existsSync(join(root,'deletion-staging'))).toBe(true);expect(readdirSync(join(root,'deletion-staging'))).toEqual([]);
  }finally{close();}
 });
});
