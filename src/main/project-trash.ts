import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {basename,isAbsolute,join,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TRASH_RETENTION_MS,isTrashed,trashedProjects} from '../shared/projects';
import type {Project} from '../shared/types';
import {LearningStore} from './store';

interface DiagnosticCleaner{clear():void;}
export interface ProjectPurgeFailure{projectId:string;error:string;}
interface DeletionManifest{projectId:string;materialIds?:string[];}

function isWithin(parent:string,target:string):boolean{
 const rel=relative(resolve(parent),resolve(target));
 return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);
}

export class ProjectTrashService{
 constructor(private store:LearningStore,private workspaceDirectory:string,private diagnostics?:DiagnosticCleaner,private now=()=>new Date()){}

 trash(projectId:string):Project{
  const project=this.requireProject(projectId);if(isTrashed(project))return project;
  const changedAt=this.now().toISOString(),trashed={...project,trashedAt:changedAt,statusBeforeTrash:project.status,updatedAt:changedAt};
  this.store.put('projects',trashed);return trashed;
 }

 restore(projectId:string):Project{
  const project=this.requireProject(projectId);if(!isTrashed(project))return project;
  try{this.recoverProjectStaging(projectId);}catch(error){throw new Error('暂存材料尚未安全回到原位，项目仍保留在最近删除中。请关闭占用材料的程序后重试。',{cause:error});}
  const restored:Project={...project,status:project.statusBeforeTrash??project.status,updatedAt:this.now().toISOString()};
  delete restored.trashedAt;delete restored.statusBeforeTrash;
  this.store.put('projects',restored);return restored;
 }

 purge(projectId:string):void{
  const project=this.requireProject(projectId);if(!isTrashed(project))throw new Error('项目尚未进入最近删除，不能永久删除。');
  const materialsRoot=resolve(this.workspaceDirectory,'materials');
  const folders=[...new Map(this.store.list('materials',projectId).map(material=>{
   const folder=resolve(materialsRoot,material.id),storedPath=resolve(material.storedPath);
   if(!isWithin(materialsRoot,folder)||!isWithin(folder,storedPath))throw new Error('材料路径超出本项目的安全目录，项目仍保留在最近删除中。');
   return [material.id,folder] as const;
  }).filter(([,folder])=>existsSync(folder)))];
  const stagingRoot=this.stagingRoot();
  const staging=resolve(stagingRoot,randomUUID());
  const moved:{from:string;to:string}[]=[];
  try{
   mkdirSync(staging,{recursive:true});writeFileSync(join(staging,'project.json'),JSON.stringify({projectId,materialIds:folders.map(([materialId])=>materialId)}),{flag:'wx'});
   for(const [,folder] of folders){const target=join(staging,basename(folder));renameSync(folder,target);moved.push({from:folder,to:target});}
   this.store.deleteProjectRecords(projectId);
  }catch(error){
   let rollbackError:unknown;
   for(const move of moved.reverse())if(existsSync(move.to)&&!existsSync(move.from))try{renameSync(move.to,move.from);}catch(failure){rollbackError??=failure;}
   if(!rollbackError&&existsSync(staging))try{rmSync(staging,{recursive:true,force:true});}catch{/* Keep recoverable staged files when Windows still holds them. */}
   if(rollbackError)throw new Error('数据库删除未完成，材料回滚也被本机文件占用阻止；暂存材料已保留，请重启后重试。',{cause:rollbackError});
   throw error;
  }
  try{writeFileSync(join(staging,'.committed'),'',{flag:'wx'});}catch{/* Absence of the project also proves the staged deletion committed. */}
  let diagnosticsCleared=true;try{this.diagnostics?.clear();}catch{diagnosticsCleared=false;}
  if(diagnosticsCleared&&existsSync(staging))try{rmSync(staging,{recursive:true,force:true});}catch{/* Cleaned at next startup. */}
 }

 purgeExpired():ProjectPurgeFailure[]{
  const now=this.now().getTime(),failures:ProjectPurgeFailure[]=[];
  for(const project of trashedProjects(this.store.list('projects'))){
   const deletedAt=Date.parse(project.trashedAt!);if(!Number.isFinite(deletedAt)||now-deletedAt<TRASH_RETENTION_MS)continue;
   try{this.purge(project.id);}catch(error){failures.push({projectId:project.id,error:error instanceof Error?error.message:'项目到期清理失败'});}
  }
  return failures;
 }

 cleanStaging():void{
  const stagingRoot=this.stagingRoot();
  if(!existsSync(stagingRoot))return;
  const failures:string[]=[];
  for(const candidate of this.stagingDirectories()){
   const committedMarker=existsSync(join(candidate,'.committed')),manifest=this.readManifest(candidate);
   if(!manifest){if(committedMarker)try{this.diagnostics?.clear();rmSync(candidate,{recursive:true,force:true});}catch(error){failures.push(error instanceof Error?error.message:'已完成的删除暂存清理失败');}continue;}
   const committed=committedMarker||!this.store.get('projects',manifest.projectId);
   try{if(committed){this.diagnostics?.clear();rmSync(candidate,{recursive:true,force:true});}else this.recoverStagingDirectory(candidate,manifest);}catch(error){failures.push(error instanceof Error?error.message:'删除暂存恢复失败');}
  }
  if(failures.length)throw new Error(failures.join('；'));
 }

 private stagingRoot():string{const stagingRoot=resolve(this.workspaceDirectory,'deletion-staging');if(!isWithin(this.workspaceDirectory,stagingRoot))throw new Error('清理暂存目录无效。');return stagingRoot;}
 private stagingDirectories():string[]{const root=this.stagingRoot();if(!existsSync(root))return [];return readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>resolve(root,entry.name)).filter(candidate=>isWithin(root,candidate));}
 private readManifest(candidate:string):DeletionManifest|undefined{try{const value=JSON.parse(readFileSync(join(candidate,'project.json'),'utf8')) as Partial<DeletionManifest>;if(typeof value.projectId!=='string'||!value.projectId||value.projectId.length>120)return undefined;if(value.materialIds!==undefined&&(!Array.isArray(value.materialIds)||value.materialIds.some(id=>typeof id!=='string')))return undefined;return {projectId:value.projectId,...(value.materialIds?{materialIds:value.materialIds}:{})};}catch{return undefined;}}
 private recoverProjectStaging(projectId:string):void{for(const candidate of this.stagingDirectories()){const manifest=this.readManifest(candidate);if(manifest?.projectId===projectId)this.recoverStagingDirectory(candidate,manifest);}}
 private recoverStagingDirectory(candidate:string,manifest:DeletionManifest):void{
  const project=this.store.get('projects',manifest.projectId);if(!project)throw new Error('暂存项目已经不存在，不能执行材料回滚。');
  const stagedEntries=readdirSync(candidate,{withFileTypes:true}).filter(entry=>!['project.json','.committed'].includes(entry.name));
  const materialIds=manifest.materialIds??stagedEntries.filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  const materialsRoot=resolve(this.workspaceDirectory,'materials');mkdirSync(materialsRoot,{recursive:true});
  for(const materialId of [...new Set(materialIds)]){
   if(!/^[A-Za-z0-9_-]+$/.test(materialId))throw new Error('删除暂存清单包含无效的材料编号。');
   const material=this.store.get('materials',materialId);if(!material||material.projectId!==manifest.projectId)throw new Error('删除暂存清单与项目材料不一致。');
   const from=resolve(materialsRoot,materialId),staged=resolve(candidate,materialId),storedPath=resolve(material.storedPath);if(!isWithin(materialsRoot,from)||!isWithin(candidate,staged)||!isWithin(from,storedPath))throw new Error('删除暂存材料路径无效。');
   if(existsSync(staged)&&existsSync(from))throw new Error('材料在原目录和删除暂存区同时存在，未自动覆盖。');
   if(existsSync(staged))renameSync(staged,from);
   if(!existsSync(storedPath))throw new Error('暂存材料回到原位后仍缺少原件，项目未恢复。');
  }
  const remaining=readdirSync(candidate).filter(name=>!['project.json','.committed'].includes(name));if(remaining.length)throw new Error('删除暂存区包含无法确认归属的文件，已原样保留。');
  rmSync(candidate,{recursive:true,force:true});
 }

 private requireProject(projectId:string):Project{const project=this.store.get('projects',projectId);if(!project)throw new Error('学习项目不存在');return project;}
}
