import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {prepareRestore,readBackup,writeBackup} from '../src/main/backup';
import {DEFAULT_MODEL_PROFILE_ID} from '../src/shared/types';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

it('round-trips recently deleted projects, model profile metadata and their materials in format 7 without credentials',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-v6-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace'));const now='2026-09-11T00:00:00.000Z';const original=join(store.dataDirectory,'book.md');writeFileSync(original,'仍需保留的原件');
 store.put('projects',{id:'p',title:'最近删除的项目',goal:'可以恢复',status:'paused',statusBeforeTrash:'active',trashedAt:now,createdAt:now,updatedAt:now});
 store.put('materials',{id:'m',projectId:'p',title:'原件',kind:'md',originalName:'book.md',storedPath:original,importedAt:now,warnings:[],fragmentCount:0,summary:''});
 store.updateSettings({modelProfiles:[{id:'fast',name:'快速模型',providerName:'测试服务',baseUrl:'https://example.test/v1',model:'flash',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:2,priceUpdatedAt:now,enabled:true,hasApiKey:true,apiKey:'must-not-back-up'} as any],activeModelProfileId:'fast'});
 store.put('usage',{id:'u',requestId:'u',operationId:'op',createdAt:now,kind:'学习路线',model:'flash',modelProfileId:'fast',profileName:'快速模型',providerName:'测试服务',requestedModel:'flash',reportedModel:'resolved-flash',inputTokens:10,outputTokens:20,estimatedCny:.01,status:'completed',entryType:'call',validationStatus:'valid',publicationStatus:'published'});
 const file=join(root,'format-7.reclimb');writeBackup(store,file);store.close();
 const manifestText=new AdmZip(file).readAsText('manifest.json'),manifest=JSON.parse(manifestText);expect(manifest.version).toBe(7);expect(manifest.records.settings.activeModelProfileId).toBe('fast');expect(manifest.records.settings.modelProfiles[0]).toMatchObject({id:'fast',model:'flash'});expect(manifestText).not.toContain('must-not-back-up');expect(manifestText).not.toContain('hasApiKey');
 const parsed=readBackup(file);expect(parsed.records.projects[0]).toMatchObject({id:'p',trashedAt:now,statusBeforeTrash:'active'});expect(parsed.records.usage[0]).toMatchObject({modelProfileId:'fast',profileName:'快速模型',requestedModel:'flash',reportedModel:'resolved-flash'});expect(parsed.files.get('m')?.bytes.toString()).toBe('仍需保留的原件');
 const restoredDirectory=join(root,'restored');await prepareRestore(file,restoredDirectory);const restored=await LearningStore.open(restoredDirectory);expect(restored.get('projects','p')).toMatchObject({trashedAt:now,statusBeforeTrash:'active'});expect(restored.get('materials','m')).toBeDefined();restored.close();
});

it('accepts format 6 without model profiles and rejects a newer backup format',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-compat-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace'));const now='2026-09-11T00:00:00.000Z';store.put('projects',{id:'p',title:'旧项目',goal:'继续',status:'active',createdAt:now,updatedAt:now});const current=join(root,'current.reclimb');writeBackup(store,current);store.close();
 const oldZip=new AdmZip(current),oldEntry=oldZip.getEntry('manifest.json')!,oldManifest=JSON.parse(oldZip.readAsText(oldEntry));oldManifest.version=6;delete oldManifest.records.settings.modelProfiles;delete oldManifest.records.settings.activeModelProfileId;oldManifest.records.settings.providerName='';oldManifest.records.settings.baseUrl='';oldManifest.records.settings.model='';oldZip.updateFile(oldEntry.entryName,Buffer.from(JSON.stringify(oldManifest)));const oldFile=join(root,'format-6.reclimb');writeFileSync(oldFile,oldZip.toBuffer());const parsed=readBackup(oldFile);expect(parsed.records.projects[0]).toMatchObject({id:'p',status:'active'});expect(parsed.records.settings.modelProfiles?.[0]).toMatchObject({id:DEFAULT_MODEL_PROFILE_ID,providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-pro'});
 const newerZip=new AdmZip(current),newerEntry=newerZip.getEntry('manifest.json')!,newerManifest=JSON.parse(newerZip.readAsText(newerEntry));newerManifest.version=8;newerZip.updateFile(newerEntry.entryName,Buffer.from(JSON.stringify(newerManifest)));const newerFile=join(root,'format-8.reclimb');writeFileSync(newerFile,newerZip.toBuffer());expect(()=>readBackup(newerFile)).toThrow(/不支持|更新版本/);
});

it('rejects a format 7 profile identifier that cannot be bound to encrypted credentials',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-profile-id-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace'));const current=join(root,'current.reclimb');writeBackup(store,current);store.close();
 const zip=new AdmZip(current),entry=zip.getEntry('manifest.json')!,manifest=JSON.parse(zip.readAsText(entry));manifest.records.settings.modelProfiles[0].id='invalid profile id';manifest.records.settings.activeModelProfileId='invalid profile id';zip.updateFile(entry.entryName,Buffer.from(JSON.stringify(manifest)));const invalid=join(root,'invalid-profile.reclimb');writeFileSync(invalid,zip.toBuffer());
 expect(()=>readBackup(invalid)).toThrow(/模型配置|格式|Invalid|invalid/i);
});
