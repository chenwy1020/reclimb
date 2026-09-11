import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {prepareRestore,readBackup,writeBackup} from '../src/main/backup';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

it('round-trips recently deleted projects and their materials in format 6',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-v6-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace'));const now='2026-09-11T00:00:00.000Z';const original=join(store.dataDirectory,'book.md');writeFileSync(original,'仍需保留的原件');
 store.put('projects',{id:'p',title:'最近删除的项目',goal:'可以恢复',status:'paused',statusBeforeTrash:'active',trashedAt:now,createdAt:now,updatedAt:now});
 store.put('materials',{id:'m',projectId:'p',title:'原件',kind:'md',originalName:'book.md',storedPath:original,importedAt:now,warnings:[],fragmentCount:0,summary:''});
 const file=join(root,'format-6.reclimb');writeBackup(store,file);store.close();
 const manifest=JSON.parse(new AdmZip(file).readAsText('manifest.json'));expect(manifest.version).toBe(6);
 const parsed=readBackup(file);expect(parsed.records.projects[0]).toMatchObject({id:'p',trashedAt:now,statusBeforeTrash:'active'});expect(parsed.files.get('m')?.bytes.toString()).toBe('仍需保留的原件');
 const restoredDirectory=join(root,'restored');await prepareRestore(file,restoredDirectory);const restored=await LearningStore.open(restoredDirectory);expect(restored.get('projects','p')).toMatchObject({trashedAt:now,statusBeforeTrash:'active'});expect(restored.get('materials','m')).toBeDefined();restored.close();
});

it('accepts format 5 without trash metadata and rejects a newer backup format',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-compat-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace'));const now='2026-09-11T00:00:00.000Z';store.put('projects',{id:'p',title:'旧项目',goal:'继续',status:'active',createdAt:now,updatedAt:now});const current=join(root,'current.reclimb');writeBackup(store,current);store.close();
 const oldZip=new AdmZip(current),oldEntry=oldZip.getEntry('manifest.json')!,oldManifest=JSON.parse(oldZip.readAsText(oldEntry));oldManifest.version=5;delete oldManifest.records.projects[0].trashedAt;delete oldManifest.records.projects[0].statusBeforeTrash;oldZip.updateFile(oldEntry.entryName,Buffer.from(JSON.stringify(oldManifest)));const oldFile=join(root,'format-5.reclimb');writeFileSync(oldFile,oldZip.toBuffer());expect(readBackup(oldFile).records.projects[0]).toMatchObject({id:'p',status:'active'});
 const newerZip=new AdmZip(current),newerEntry=newerZip.getEntry('manifest.json')!,newerManifest=JSON.parse(newerZip.readAsText(newerEntry));newerManifest.version=7;newerZip.updateFile(newerEntry.entryName,Buffer.from(JSON.stringify(newerManifest)));const newerFile=join(root,'format-7.reclimb');writeFileSync(newerFile,newerZip.toBuffer());expect(()=>readBackup(newerFile)).toThrow(/不支持|更新版本/);
});
