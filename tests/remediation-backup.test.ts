import AdmZip from 'adm-zip';
import initSqlJs from 'sql.js';
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {readBackup,writeBackup} from '../src/main/backup';
import {portableWorkspaceHash} from '../src/main/sync-workspace';
import {bindingDigest} from '../src/main/operations';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const temporary=(name:string)=>{const root=mkdtempSync(join(tmpdir(),name));roots.push(root);return root;};
const now='2026-09-22T00:00:00.000Z';
function manifest(file:string):any{const zip=new AdmZip(file);return JSON.parse(zip.readAsText(zip.getEntry('manifest.json')!));}
function rewriteManifest(source:string,target:string,change:(value:any)=>void){const zip=new AdmZip(source),entry=zip.getEntry('manifest.json')!,value=JSON.parse(zip.readAsText(entry));change(value);zip.updateFile('manifest.json',Buffer.from(JSON.stringify(value)));zip.writeZip(target);}
async function populated(){
 const root=temporary('reclimb-v11-roundtrip-'),store=await LearningStore.open(root),materialFile=join(root,'source.txt');writeFileSync(materialFile,'source');
 store.put('projects',{id:'p',title:'P',goal:'G',status:'active',createdAt:now,updatedAt:now,activeRouteVersionId:'book-route',bookRouteVersionId:'book-route',learningPositionId:'position'});
 store.put('capabilities',{id:'cap',projectId:'p',title:'C',description:'D',prerequisites:[],sourceIds:[],order:0});
 store.put('materials',{id:'m',projectId:'p',title:'M',kind:'txt',originalName:'source.txt',storedPath:materialFile,importedAt:now,warnings:[],fragmentCount:1,summary:''});
 store.put('fragments',{id:'f',materialId:'m',projectId:'p',locator:'1',text:'source',ordinal:0});
 const snapshot=(id:string,scope:'local'|'book')=>({id,capabilityId:'cap',title:id,coreQuestion:'Q',purpose:'P',expectedOutcome:'E',sourceIds:[],locators:[],prerequisiteUnitIds:[],order:0,phase:'expand' as const,scope});
 for(const [id,scope] of [['local-route','local'],['book-route','book']] as const)store.put('routeVersions',{id,projectId:'p',version:1,origin:'generated',status:id==='book-route'?'adopted':'superseded',summary:'',coreQuestion:'Q',mapNodes:[],capabilitySnapshots:[],unitIds:[id+'-unit'],unitSnapshots:[snapshot(id+'-unit',scope)],coverage:{totalSections:0,analyzedSectionIds:[],pendingSectionIds:[],method:''},scope,createdAt:now} as any);
 for(const [id,route,scope] of [['local-route-unit','local-route','local'],['book-route-unit','book-route','book']] as const)store.put('learningUnits',{...snapshot(id,scope),projectId:'p',routeVersionId:route,status:'active',goal:{behavior:'explain',materialScope:'source',allowedHelp:'none',verification:'task',version:1},createdAt:now,updatedAt:now} as any);
 store.put('learningPositions',{id:'position',projectId:'p',routeVersionId:'local-route',unitId:'local-route-unit',intent:'continue',reason:'saved local work',nextRequirement:'continue',confidence:'confirmed',basedOnEvidenceIds:[],basedOnTeachingVersionIds:[],derivedStatus:'active',updatedAt:now});
 store.put('sessions',{id:'s',projectId:'p',capabilityId:'cap',activity:{title:'A',instruction:'I',kind:'application',rubric:['R'],sourceIds:[],assessmentBasis:'rule'},mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:''});
 store.put('usage',{id:'call',createdAt:now,requestId:'call-request',kind:'test',model:'local',inputTokens:0,outputTokens:0,estimatedCny:0,status:'completed',operationId:'op'});
 const binding={sessionId:'s'};store.put('operations',{id:'op',projectId:'p',requestId:'operation-request',kind:'input_response',phase:'result_saved',refs:{sessionId:'s',unitId:'local-route-unit'},binding,bindingDigest:bindingDigest(binding),savedSummary:'saved',callIds:['call'],result:{sessionId:'s'},createdAt:now,updatedAt:now});
 store.put('learningProposals',{id:'proposal',projectId:'p',requestId:'proposal-request',unitId:'local-route-unit',text:'continue',reason:'reason',status:'saved',basisDigest:'basis',basedOnEvidenceIds:[],basedOnTeachingVersionIds:[],createdAt:now,updatedAt:now});
 store.put('routeAssociations',{id:'association',projectId:'p',localUnitId:'local-route-unit',bookUnitId:'book-route-unit',status:'linked',reason:'same topic',createdAt:now,updatedAt:now});
 store.put('readerStates',{id:'reader',projectId:'p',materialId:'m',fragmentId:'f',scrollTop:10,expanded:['x'],updatedAt:now});
 store.put('validationSets',{id:'set',projectId:'p',title:'Set',description:'',createdAt:now,updatedAt:now});
 store.put('validationTasks',{id:'task',projectId:'p',setId:'set',familyId:'family',version:1,title:'Task',prompt:'Prompt',referenceAnswer:'Answer',rubric:['R'],source:{kind:'authored',citation:'fixture'},review:{status:'reviewed',reviewer:'human',basis:'fixture',reviewedAt:now},capabilityId:'cap',comparableGroup:'group',conditions:'same',transferRationale:'',createdAt:now});
 store.put('validationRuns',{id:'run',projectId:'p',requestId:'run-request',setId:'set',taskId:'task',sessionId:'s',phase:'before',status:'active',startedAt:now,selfReportedExposure:'none',exposures:[]});
 store.put('validationExposures',{id:'exposure',projectId:'p',taskId:'task',runId:'run',kind:'known',detail:'known',createdAt:now});
 store.put('trialRecords',{id:'trial',projectId:'p',kind:'device',status:'unverified',participant:'tester',environment:'fixture',protocol:'protocol',observations:'observation',runIds:['run'],createdAt:now});
 return{root,store};
}

describe('format 11 persistence and backup',()=>{
 it('preserves exact version-10 database bytes before upgrading once',async()=>{
  const root=temporary('reclimb-v11-migration-'),file=join(root,'learning.sqlite'),SQL=await initSqlJs(),db=new SQL.Database();
  db.run('CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, project_id TEXT, entity TEXT NOT NULL)');
  db.run('CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), entity TEXT NOT NULL)');
  db.run('PRAGMA user_version=10');
  writeFileSync(file,db.export());db.close();const original=readFileSync(file);
  const store=await LearningStore.open(root);store.close();
  const backups=readdirSync(join(root,'upgrade-backups'));expect(backups).toHaveLength(1);expect(backups[0]).toMatch(/^pre-0\.6-/);
  expect(readFileSync(join(root,'upgrade-backups',backups[0]))).toEqual(original);
  const upgraded=new SQL.Database(readFileSync(file));expect(upgraded.exec('PRAGMA user_version')[0].values[0][0]).toBe(11);upgraded.close();
  const reopened=await LearningStore.open(root);reopened.close();expect(readdirSync(join(root,'upgrade-backups'))).toHaveLength(1);
 });
 it('keeps the original version-10 database intact when schema upgrade fails',async()=>{
  const root=temporary('reclimb-v11-rollback-'),file=join(root,'learning.sqlite'),SQL=await initSqlJs(),db=new SQL.Database();
  db.run('CREATE TABLE operations (id TEXT PRIMARY KEY NOT NULL)');db.run('PRAGMA user_version=10');writeFileSync(file,db.export());db.close();const original=readFileSync(file);
  await expect(LearningStore.open(root)).rejects.toThrow();expect(readFileSync(file)).toEqual(original);
  const backups=readdirSync(join(root,'upgrade-backups'));expect(backups).toHaveLength(1);expect(readFileSync(join(root,'upgrade-backups',backups[0]))).toEqual(original);
 });
 it('writes format 11 and roundtrips every remediation collection and provenance field',async()=>{
  const {root,store}=await populated(),file=join(root,'all.reclimb');writeBackup(store,file);store.close();
  expect(manifest(file).version).toBe(11);const backup=readBackup(file);
  for(const key of ['operations','learningProposals','routeAssociations','readerStates','validationSets','validationTasks','validationRuns','validationExposures','trialRecords'] as const)expect(backup.records[key]).toHaveLength(1);
  expect(backup.records.projects[0].bookRouteVersionId).toBe('book-route');expect(backup.records.learningUnits[0].goal?.version).toBe(1);expect(backup.records.learningPositions[0].basedOnEvidenceIds).toEqual([]);
 });
 it('rejects missing, malformed, duplicate-request and foreign remediation references',async()=>{
  const {root,store}=await populated(),valid=join(root,'valid.reclimb');writeBackup(store,valid);store.close();
  for(const [name,change] of [
   ['missing',(m:any)=>{delete m.records.validationExposures;}],
   ['malformed',(m:any)=>{m.records.validationSets[0].unexpected=true;}],
   ['duplicate',(m:any)=>{m.records.learningProposals.push({...m.records.learningProposals[0],id:'proposal-duplicate'});}],
   ['foreign',(m:any)=>{m.records.routeAssociations[0].bookUnitId='local-route-unit';}],
  ] as const){const file=join(root,name+'.reclimb');rewriteManifest(valid,file,change);expect(()=>readBackup(file),name).toThrow();}
 });
 it('accepts repair-call chains and interrupted calls that failed before usage reservation',async()=>{
  const {root,store}=await populated(),valid=join(root,'valid-call-chain.reclimb');
  store.put('usage',{...store.get('usage','call')!,id:'repair-call',requestId:'repair-request',operationId:'call',requestPhase:'repair'});
  store.put('operations',{...store.get('operations','op')!,callIds:['call','repair-call']});writeBackup(store,valid);store.close();expect(()=>readBackup(valid)).not.toThrow();
  const interrupted=join(root,'interrupted-preflight.reclimb');rewriteManifest(valid,interrupted,m=>{m.records.operations[0].phase='interrupted';m.records.operations[0].callIds.push('preflight-call');});expect(()=>readBackup(interrupted)).not.toThrow();
  const retried=join(root,'completed-after-retry.reclimb');rewriteManifest(interrupted,retried,m=>{m.records.operations[0].phase='completed';});expect(()=>readBackup(retried)).not.toThrow();
  const noCall=join(root,'saved-without-actual-call.reclimb');rewriteManifest(retried,noCall,m=>{m.records.usage=[];});expect(()=>readBackup(noCall)).toThrow(/缺少实际费用调用/);
 }); it('hashes a migrated format-10 archive with its original collection set while format 11 includes new records',async()=>{
  const {root,store}=await populated(),current=join(root,'current.reclimb');writeBackup(store,current);store.close();const currentBackup=readBackup(current),currentHash=portableWorkspaceHash(currentBackup.records,id=>currentBackup.files.get(id)!.bytes);
  const legacy=join(root,'legacy.reclimb');rewriteManifest(current,legacy,m=>{m.version=10;for(const key of ['operations','learningProposals','routeAssociations','readerStates','validationSets','validationTasks','validationRuns','validationExposures','trialRecords'])delete m.records[key];});
  const old=readBackup(legacy),oldHash=portableWorkspaceHash(old.records,id=>old.files.get(id)!.bytes);
  const legacyShape=structuredClone(old.records) as any;for(const key of ['operations','learningProposals','routeAssociations','readerStates','validationSets','validationTasks','validationRuns','validationExposures','trialRecords'])delete legacyShape[key];
  expect(oldHash).toBe(portableWorkspaceHash(legacyShape,id=>old.files.get(id)!.bytes));expect(currentHash).not.toBe(oldHash);
 });
 it('rejects missing provenance references on positions and understanding drafts',async()=>{
  const {root,store}=await populated(),valid=join(root,'valid-provenance.reclimb');writeBackup(store,valid);store.close();
  for(const [name,change] of [
   ['position-evidence',(m:any)=>{m.records.learningPositions[0].basedOnEvidenceIds=['missing-evidence'];}],
   ['position-version',(m:any)=>{m.records.learningPositions[0].basedOnTeachingVersionIds=['missing-version'];}],
   ['draft-evidence',(m:any)=>{m.records.understandingDrafts.push({id:'draft',projectId:'p',routeVersionId:'local-route',unitId:'local-route-unit',version:1,phase:'expand',title:'draft',blocks:[{id:'block',author:'learner',text:'draft',sourceIds:[],sourceInputIds:[]}],status:'working',basedOnEvidenceIds:['missing-evidence'],createdAt:now});}],
  ] as const){const file=join(root,name+'.reclimb');rewriteManifest(valid,file,change);expect(()=>readBackup(file),name).toThrow(/断开的或跨项目|不存在|另一学习项目/);}
 }); it('keeps validation tasks, exposures and trial records append-only while operational records remain mutable',async()=>{
  const {store}=await populated();
  expect(()=>store.put('validationTasks',{...store.get('validationTasks','task')!,title:'changed'})).toThrow(/不可覆盖/);
  expect(()=>store.put('validationExposures',{...store.get('validationExposures','exposure')!,detail:'changed'})).toThrow(/不可覆盖/);
  expect(()=>store.put('trialRecords',{...store.get('trialRecords','trial')!,observations:'changed'})).toThrow(/不可覆盖/);
  expect(()=>store.put('operations',{...store.get('operations','op')!,phase:'completed'})).not.toThrow();store.close();
 });
 it('rejects same-project task-set, baseline, revision and attempt rewiring',async()=>{
  const {root,store}=await populated(),valid=join(root,'valid-relations.reclimb');writeBackup(store,valid);store.close();
  const cases:[string,(m:any)=>void][]=[
   ['wrong-set',m=>{m.records.validationSets.push({...m.records.validationSets[0],id:'set-2'});m.records.validationTasks[0].setId='set-2';}],
   ['wrong-revision-family',m=>{m.records.validationTasks.push({...m.records.validationTasks[0],id:'task-v2',version:2,familyId:'other-family',supersedesId:'task'});}],
   ['reversed-baseline',m=>{m.records.validationRuns.push({...m.records.validationRuns[0],id:'after',requestId:'after-request',phase:'after'});m.records.validationRuns[0].baselineRunId='after';}],
   ['wrong-session-attempt',m=>{m.records.sessions.push({...m.records.sessions[0],id:'other-session'});m.records.attempts.push({id:'other-attempt',projectId:'p',sessionId:'other-session',text:'another response',submittedAt:now,helpLevel:0,requestId:'other-attempt',activitySnapshot:m.records.sessions[0].activity});m.records.validationRuns[0].attemptId='other-attempt';}],
  ];
  for(const [name,change] of cases){const file=join(root,name+'.reclimb');rewriteManifest(valid,file,change);expect(()=>readBackup(file),name).toThrow();}
 });

});
