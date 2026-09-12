import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {readBackup,writeBackup} from '../src/main/backup';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

it('round-trips route, position, observations, understanding and reading layout in format 7',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-v5-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace')),now='2026-09-09T00:00:00.000Z',original=join(store.dataDirectory,'book.md');writeFileSync(original,'原创材料');
 store.transaction(()=>{
  store.put('projects',{id:'p',title:'书',goal:'掌握方法',status:'active',activeRouteVersionId:'r',learningPositionId:'pos',createdAt:now,updatedAt:now});
  store.put('materials',{id:'m',projectId:'p',title:'书',kind:'md',originalName:'book.md',storedPath:original,importedAt:now,warnings:[],fragmentCount:1,summary:'原创'});
  store.put('fragments',{id:'f',projectId:'p',materialId:'m',locator:'第 1 章',text:'正文',ordinal:0});
  store.put('capabilities',{id:'c',projectId:'p',title:'方法',description:'解释方法',prerequisites:[],sourceIds:['f'],order:0});
  const unit={id:'u',capabilityId:'c',title:'建立问题图',coreQuestion:'解决什么？',purpose:'定位',expectedOutcome:'能解释',sourceIds:['f'],locators:['第 1 章'],prerequisiteUnitIds:[],order:0,phase:'survey' as const};
  store.put('routeVersions',{id:'old-route',projectId:'p',version:1,origin:'generated',status:'superseded',summary:'旧粗图',coreQuestion:'全书问题',mapNodes:[],capabilitySnapshots:[{id:'c',title:'方法',description:'解释方法',prerequisites:[],sourceIds:['f'],order:0,goalContext:'掌握方法'}],unitIds:['u'],unitSnapshots:[unit],coverage:{totalSections:1,analyzedSectionIds:['f'],pendingSectionIds:[],method:'完整索引'},createdAt:now,adoptedAt:now});
  store.put('routeVersions',{id:'r',projectId:'p',version:2,origin:'generated',status:'adopted',summary:'粗图',coreQuestion:'全书问题',mapNodes:[{id:'node',title:'问题',question:'什么？',role:'定位',sourceIds:['f'],connectsTo:[],status:'analyzed'}],capabilitySnapshots:[{id:'c',title:'方法',description:'解释方法',prerequisites:[],sourceIds:['f'],order:0,goalContext:'掌握方法'}],unitIds:['u'],unitSnapshots:[{...unit,reusedFromUnitId:'u'}],coverage:{totalSections:1,analyzedSectionIds:['f'],pendingSectionIds:[],method:'完整索引'},baseVersionId:'old-route',createdAt:now,adoptedAt:now});
  store.put('learningUnits',{...unit,projectId:'p',routeVersionId:'r',status:'active',createdAt:now,updatedAt:now});
  store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',unitId:'u',routeVersionId:'old-route',activity:{id:'task',title:'历史任务',instruction:'解释正文。',kind:'argument',rubric:['给出解释'],sourceIds:['f'],assessmentBasis:'source'},mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'历史位置',nextStep:'继续'});
  store.put('learningPositions',{id:'pos',projectId:'p',routeVersionId:'r',unitId:'u',sessionId:'s',intent:'continue',reason:'继续',nextRequirement:'解释问题',confidence:'confirmed',updatedAt:now});
  store.put('teachingObservations',{id:'observation',projectId:'p',unitId:'u',sessionId:'s',taskId:'task',kind:'verified_performance',scope:'解释问题',summary:'完成了当前要求',taskFamily:'explain:problem',helpLevel:0,certainty:'verified',outcome:'met',progressionEligible:true,status:'active',createdAt:now});
  store.put('understandingDrafts',{id:'draft',projectId:'p',routeVersionId:'r',unitId:'u',version:1,phase:'expand',title:'我的理解',blocks:[{id:'block',author:'learner',text:'我的解释',sourceIds:['f'],sourceInputIds:[]}],status:'working',createdAt:now});
  store.put('readingLayouts',{id:'layout',projectId:'p',materialId:'m',fragmentId:'f',version:1,blocks:[{id:'reading',order:0,kind:'prose',text:'正文',source:'extracted'}],status:'current',createdAt:now});
 });
 const file=join(root,'all.reclimb');writeBackup(store,file);const zip=new AdmZip(file),manifest=JSON.parse(zip.readAsText(zip.getEntry('manifest.json')!));expect(manifest.version).toBe(7);
 const restored=readBackup(file).records;expect(restored.routeVersions).toHaveLength(2);expect(restored.routeVersions.every(route=>route.unitIds[0]==='u')).toBe(true);expect(restored.learningPositions[0]).toMatchObject({unitId:'u',sessionId:'s'});expect(restored.sessions[0].routeVersionId).toBe('old-route');expect(restored.teachingObservations[0]).toMatchObject({outcome:'met',progressionEligible:true});expect(restored.understandingDrafts[0].blocks[0].author).toBe('learner');expect(restored.readingLayouts[0].fragmentId).toBe('f');
 const mismatched=new AdmZip(file),entry=mismatched.getEntry('manifest.json')!,changed=JSON.parse(mismatched.readAsText(entry));changed.records.projects[0].activeRouteVersionId='old-route';changed.records.routeVersions.find((route:any)=>route.id==='old-route').status='adopted';changed.records.routeVersions.find((route:any)=>route.id==='r').status='superseded';mismatched.updateFile(entry.entryName,Buffer.from(JSON.stringify(changed)));const mismatchFile=join(root,'mainline-mismatch.reclimb');writeFileSync(mismatchFile,mismatched.toBuffer());expect(()=>readBackup(mismatchFile)).toThrow(/主线|当前路线/);store.close();
});

it('rejects a format 7 learning position that crosses project boundaries',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-backup-v5-invalid-'));roots.push(root);const store=await LearningStore.open(join(root,'workspace')),now='2026-09-09T00:00:00.000Z',original=join(store.dataDirectory,'book.md');writeFileSync(original,'x');
 store.put('projects',{id:'p',title:'书',goal:'学',status:'active',createdAt:now,updatedAt:now});store.put('materials',{id:'m',projectId:'p',title:'书',kind:'md',originalName:'book.md',storedPath:original,importedAt:now,warnings:[],fragmentCount:0,summary:''});const file=join(root,'base.reclimb');writeBackup(store,file);store.close();
 const zip=new AdmZip(file),entry=zip.getEntry('manifest.json')!,manifest=JSON.parse(zip.readAsText(entry));manifest.records.learningPositions=[{id:'pos',projectId:'p',routeVersionId:'missing',unitId:'missing',intent:'continue',reason:'x',nextRequirement:'x',confidence:'inferred',updatedAt:now}];zip.updateFile(entry.entryName,Buffer.from(JSON.stringify(manifest)));const broken=join(root,'broken.reclimb');writeFileSync(broken,zip.toBuffer());expect(()=>readBackup(broken)).toThrow(/关联|路线|单元/);
});
