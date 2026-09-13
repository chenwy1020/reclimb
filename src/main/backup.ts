import AdmZip from 'adm-zip';import {createHash} from 'node:crypto';import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,statSync,unlinkSync} from 'node:fs';import {join,resolve,relative,isAbsolute,basename} from 'node:path';import {z} from 'zod';
import {LearningStore,normalizeSettings} from './store';import {safeMaterialFilename} from './file-safety';import {activitySchema,assessmentSchema,startingPointSchema,learningScopeSchema,nearStepSchema,teachingStateSchema,teachingStepSchema,supportScopeSchema,taskDemandSchema} from './schemas';import {settingsInputSchema} from './settings-schema';import type {Collection,WorkspaceSnapshot} from '../shared/types';
import {teachingVersionSchema,taskReviewSchema,disputeSchema,correctionSchema,answerExposureSchema} from './reliability-record-schemas';
import {teachingContentHash} from './verification-service';
import {derivesFromDispute} from '../shared/reliability-state';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),txt=z.string().max(200000),date=z.string().refine(v=>Number.isFinite(Date.parse(v)),'日期无效'),refs=z.array(id).max(100),bookRefs=z.array(id).max(100000);
const project=z.object({id,title:txt,goal:txt,status:z.enum(['active','paused']),createdAt:date,updatedAt:date,trashedAt:date.optional(),statusBeforeTrash:z.enum(['active','paused']).optional(),routeSummary:txt.optional(),startingPoint:startingPointSchema.optional(),learningScope:learningScopeSchema.optional(),nearSteps:z.array(nearStepSchema).max(4).optional(),activeRouteVersionId:id.optional(),pendingRouteVersionId:id.optional(),learningPositionId:id.optional()});
const capability=z.object({id,projectId:id,title:txt,description:txt,prerequisites:refs,sourceIds:refs,order:z.number().int(),archived:z.boolean().optional(),goalContext:txt.optional()});
const quality=z.object({kind:z.enum(['native-text','ocr-text','image-only','mixed','unknown']),needsVerification:z.boolean(),reasons:z.array(txt).max(40)});
const page=z.object({pageNumber:z.number().int().positive(),printedPageLabel:txt.optional(),width:z.number().positive(),height:z.number().positive(),quality});
const pdfMetadata=z.object({pageCount:z.number().int().positive(),pages:z.array(page).max(20000),outline:z.array(z.object({title:txt,pageNumber:z.number().int().positive(),level:z.number().int().nonnegative()})).max(20000),analyzedAt:date});
const material=z.object({id,projectId:id,title:txt,kind:txt,originalName:txt,storedPath:txt,importedAt:date,warnings:z.array(txt),fragmentCount:z.number().int().nonnegative(),summary:txt,sourceUrl:txt.optional(),pdfMetadata:pdfMetadata.optional()});
const fragment=z.object({id,materialId:id,projectId:id,locator:txt,text:txt,ordinal:z.number().int().nonnegative(),pageNumber:z.number().int().positive().optional(),printedPageLabel:txt.optional(),quality:quality.optional(),searchableText:txt.optional()});
const followup=z.object({kind:z.enum(['step','message','source']),id,intent:z.enum(['question','example']),title:txt,text:txt,sourceIds:refs,sources:teachingVersionSchema.shape.sources,rootInputId:id,parentMessageId:id.optional(),taskId:id.optional(),stepId:id.optional(),teachingVersionId:id.optional(),contextWarning:txt.optional(),historyIndex:z.number().int().nonnegative().optional()});
const sessionMessage=z.object({
 id,role:z.enum(['user','assistant','system']),text:txt,createdAt:date,kind:txt.optional(),sourceIds:refs.optional(),taskId:id.optional(),stepId:id.optional(),scope:supportScopeSchema.optional(),
 inputId:id.optional(),requestId:id.optional(),attemptId:id.optional(),teachingVersionId:id.optional(),
 responseState:z.enum(['pending','running','completed','failed']).optional(),responseMode:z.enum(['assessment','discussion']).optional(),responseError:txt.optional(),responseUpdatedAt:date.optional(),
 activitySnapshot:activitySchema.optional(),stepSnapshot:teachingStepSchema.optional(),helpLevel:z.number().int().min(0).max(4).optional(),followup:followup.optional(),
});
const session=z.object({id,projectId:id,capabilityId:id,unitId:id.optional(),routeVersionId:id.optional(),activity:activitySchema,mode:z.enum(['practice','delayed','transfer','diagnosis','selection']),status:z.enum(['active','paused','completed']),createdAt:date,updatedAt:date,draft:txt,helpLevel:z.number().int().min(0).max(4),helpEvents:z.array(z.object({id,kind:z.enum(['hint','confused','example','answer','explore']),level:z.number().int().min(0).max(4),createdAt:date,taskId:id.optional(),scope:supportScopeSchema.optional()})),messages:z.array(sessionMessage),checkpoint:txt,nextStep:txt,dueReviewId:id.optional(),teaching:teachingStateSchema.optional(),taskDrafts:z.record(id,txt).optional()});
const attempt=z.object({id,projectId:id,sessionId:id,text:txt,submittedAt:date,helpLevel:z.number().int().min(0).max(4),requestId:id,assessment:assessmentSchema.optional(),activitySnapshot:activitySchema.optional(),taskId:id.optional(),stepId:id.optional(),mode:z.enum(['practice','delayed','transfer','diagnosis','selection']).optional(),reviewId:id.optional()});
const evidence=z.object({id,projectId:id,capabilityId:id,sessionId:id,attemptId:id,status:z.enum(['assisted','independent','delayed','transfer','needs_review']),helpLevel:z.number().int().min(0).max(4),assessment:assessmentSchema,createdAt:date,activitySnapshot:activitySchema.optional(),taskId:id.optional(),stepId:id.optional(),reviewId:id.optional()});
const review=z.object({id,projectId:id,capabilityId:id,fromSessionId:id,kind:z.enum(['delayed','transfer']),dueAt:date,status:z.enum(['pending','done','snoozed']),completedSessionId:id.optional(),fromTaskId:id.optional(),fromActivity:activitySchema.optional(),completedEvidenceId:id.optional(),completedTaskId:id.optional()});
const usage=z.object({id,createdAt:date,requestId:id,kind:txt,model:txt,inputTokens:z.number().nonnegative(),outputTokens:z.number().nonnegative(),estimatedCny:z.number().nonnegative(),status:z.enum(['reserved','completed','uncertain','failed']),operationId:id.optional(),reasoningTokens:z.number().nonnegative().optional(),finishReason:txt.optional(),providerRequestId:txt.optional(),validationStatus:z.enum(['pending','valid','invalid','not_received']).optional(),publicationStatus:z.enum(['pending','published','discarded']).optional(),modelProfileId:id.optional(),profileName:txt.optional(),providerName:txt.optional(),requestedModel:txt.optional(),reportedModel:txt.optional(),cacheHitTokens:z.number().int().nonnegative().optional(),cacheMissTokens:z.number().int().nonnegative().optional(),durationMs:z.number().int().nonnegative().optional(),requestPhase:z.enum(['initial','repair']).optional(),threadId:id.optional(),promptLayout:txt.optional(),promptPrefixHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),promptPrefixCharacters:z.number().int().nonnegative().optional(),requestCharacters:z.number().int().nonnegative().optional()});
const region=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(r=>r.x+r.width<=1.000001&&r.y+r.height<=1.000001);
const transcription=z.object({id,projectId:id,materialId:id,fragmentId:id,pageNumber:z.number().int().positive(),region:region.optional(),version:z.number().int().positive(),text:txt,status:z.enum(['machine','confirmed']),createdAt:date,confirmedAt:date.optional(),model:txt.optional(),uncertainties:z.array(txt).max(100)});
const phase=z.enum(['survey','expand','synthesize','revisit']);
const routeCapability=z.object({id,title:txt,description:txt,prerequisites:refs,sourceIds:refs,order:z.number().int(),goalContext:txt});
const routeUnit=z.object({id,capabilityId:id,title:txt,coreQuestion:txt,purpose:txt,expectedOutcome:txt,unresolvedGaps:z.array(txt).max(100).optional(),sourceIds:refs,locators:z.array(txt).max(100),prerequisiteUnitIds:refs,order:z.number().int(),phase,reusedFromUnitId:id.optional()});
const routeVersion=z.object({id,projectId:id,version:z.number().int().positive(),origin:z.enum(['generated','legacy']),status:z.enum(['proposed','adopted','superseded','dismissed']),summary:txt,coreQuestion:txt,mapNodes:z.array(z.object({id,title:txt,question:txt,role:txt,sourceIds:refs,connectsTo:refs,status:z.enum(['outlined','analyzed'])})).max(1000),capabilitySnapshots:z.array(routeCapability).max(1000),unitIds:bookRefs,unitSnapshots:z.array(routeUnit).max(1000),coverage:z.object({totalSections:z.number().int().nonnegative(),analyzedSectionIds:bookRefs,pendingSectionIds:bookRefs,method:txt}),baseVersionId:id.optional(),changeSummary:txt.optional(),scopeProposal:z.object({suggestedFocus:txt,reason:txt}).optional(),createdAt:date,adoptedAt:date.optional()});
const learningUnit=routeUnit.extend({projectId:id,routeVersionId:id,status:z.enum(['proposed','available','active','completed','retired']),createdAt:date,updatedAt:date});
const learningPosition=z.object({id,projectId:id,routeVersionId:id,unitId:id,sessionId:id.optional(),intent:z.enum(['continue','challenge','advance','synthesize','consolidate','fill_gap']),reason:txt,nextRequirement:txt,returnUnitId:id.optional(),returnSessionId:id.optional(),confidence:z.enum(['confirmed','inferred']),updatedAt:date});
const teachingObservation=z.object({id,projectId:id,unitId:id.optional(),sessionId:id, inputId:id.optional(),attemptId:id.optional(),evidenceId:id.optional(),taskId:id.optional(),teachingVersionId:id.optional(),kind:z.enum(['learner_work','learner_report','verified_performance','content_problem']),scope:txt,summary:txt,taskFamily:txt.optional(),demand:taskDemandSchema.optional(),helpLevel:z.number().int().min(0).max(4),certainty:z.enum(['verified','unverified','disputed']),outcome:z.enum(['met','partial','not_yet','uncertain']).optional(),progressionEligible:z.boolean().optional(),status:z.enum(['active','suspended']),createdAt:date});
const understandingDraft=z.object({id,projectId:id,routeVersionId:id,unitId:id.optional(),version:z.number().int().positive(),phase:z.enum(['expand','synthesize']),title:txt,blocks:z.array(z.object({id,author:z.enum(['learner','ai','learner_edited_ai']),text:txt,sourceIds:refs,sourceInputIds:refs})).min(1).max(10000),status:z.enum(['working','superseded']),basedOnDraftId:id.optional(),createdAt:date});
const readingLayout=z.object({id,projectId:id,materialId:id,fragmentId:id,pageNumber:z.number().int().positive().optional(),version:z.number().int().positive(),blocks:z.array(z.object({id,order:z.number().int().nonnegative(),kind:z.enum(['prose','source_image']),text:txt.optional(),region:region.optional(),reason:txt.optional(),source:z.enum(['extracted','confirmed_transcription','original_page']),transcriptionId:id.optional()})).max(10000),status:z.enum(['current','superseded']),createdAt:date});
const entities={projects:project,capabilities:capability,materials:material,fragments:fragment,sessions:session.extend({teachingVersionId:id.optional()}),attempts:attempt.extend({teachingVersionId:id.optional()}),evidence:evidence.extend({teachingVersionId:id.optional()}),reviews:review,usage:usage.extend({entryType:z.enum(['call','hold']).optional()}),sourceTranscriptions:transcription.extend({origin:z.enum(['manual','machine']).optional()}),teachingVersions:teachingVersionSchema,taskReviews:taskReviewSchema,disputes:disputeSchema,corrections:correctionSchema,answerExposures:answerExposureSchema,routeVersions:routeVersion,learningUnits:learningUnit,learningPositions:learningPosition,teachingObservations:teachingObservation,understandingDrafts:understandingDraft,readingLayouts:readingLayout};
export function within(root:string,target:string):boolean{const rel=relative(resolve(root),resolve(target));return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));}
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function writeBackup(store:LearningStore,target:string):void{
 const snapshot=store.snapshot();const {dataDirectory,settings,...records}=snapshot;
 const {hasApiKey,...safeSettings}=settings;if(safeSettings.modelProfiles)safeSettings.modelProfiles=safeSettings.modelProfiles.map(({hasApiKey:_profileKey,...profile})=>profile);
 if(safeSettings.vision){const {hasApiKey:visionKey,...safeVision}=safeSettings.vision;safeSettings.vision=safeVision;}
 const files:{materialId:string;entry:string;sha256:string}[]=[];const zip=new AdmZip();
 for(const m of records.materials){if(!within(dataDirectory,m.storedPath)||!existsSync(m.storedPath))throw new Error('原始材料缺失或路径异常，无法生成完整备份：'+m.title);const bytes=readFileSync(m.storedPath);const entry='materials/'+m.id+'/'+basename(m.originalName).replace(/[^\p{L}\p{N}._ -]/gu,'_');zip.addFile(entry,bytes);files.push({materialId:m.id,entry,sha256:sha(bytes)});m.storedPath=entry;}
 zip.addFile('manifest.json',Buffer.from(JSON.stringify({format:'reclimb.backup',version:7,createdAt:new Date().toISOString(),records:{...records,settings:safeSettings},files},null,2),'utf8'));
 const tmp=target+'.partial';
 try{
  writeFileSync(tmp,zip.toBuffer());
  // A backup is published only after passing the same checks used for restoration.
  readBackup(tmp);
  renameSync(tmp,target);
 }finally{
  if(existsSync(tmp)){try{unlinkSync(tmp);}catch{/* Preserve the original write or validation failure. */}}
 }
}
export function readBackup(file:string):{records:Omit<WorkspaceSnapshot,'dataDirectory'>;files:Map<string,{name:string;bytes:Buffer}>}{
 if(statSync(file).size>250*1024*1024)throw new Error('备份超过250MB，请分批整理材料后重试。');
 const zip=new AdmZip(file),entries=zip.getEntries();let size=0;
 if(entries.length>20000)throw new Error('备份条目过多');
 const names=new Set<string>();
 for(const e of entries){if(e.entryName.includes('\\')||e.entryName.startsWith('/')||e.entryName.split('/').includes('..')||names.has(e.entryName))throw new Error('备份包含不安全或重复路径');names.add(e.entryName);size+=e.header.size;if(size>500*1024*1024)throw new Error('备份展开后过大');}
 const manifest=zip.getEntry('manifest.json');if(!manifest||manifest.header.size>30*1024*1024)throw new Error('备份清单缺失或过大');
 let raw:any;try{raw=JSON.parse(zip.readAsText(manifest));}catch{throw new Error('备份清单无法解析');}
 if(raw?.format!=='reclimb.backup'||!raw.records)throw new Error('这不是受支持的重登备份文件');
 if(typeof raw.version==='number'&&raw.version>7)throw new Error('此备份由更新版本创建，请先升级应用。');
 if(![1,2,3,4,5,6,7].includes(raw.version))throw new Error('这不是受支持的重登备份文件');
 const records:any={};
 const introduced:Record<string,number>={sourceTranscriptions:2,teachingVersions:3,taskReviews:3,disputes:3,corrections:3,answerExposures:3,routeVersions:5,learningUnits:5,learningPositions:5,teachingObservations:5,understandingDrafts:5,readingLayouts:5};
 for(const [key,schema] of Object.entries(entities)){records[key]=z.array(schema).max(100000).parse(raw.version<(introduced[key]??1)?raw.records[key]??[]:raw.records[key]);const ids=new Set<string>();for(const r of records[key]){if(ids.has(r.id))throw new Error('备份包含重复记录');ids.add(r.id);}}
 const settings={...raw.records.settings};delete settings.hasApiKey;
 if(raw.version<7)for(const field of ['providerName','baseUrl','model'] as const)if(typeof settings[field]!=='string'||!settings[field].trim())delete settings[field];
 if(raw.version>=7&&(!Array.isArray(settings.modelProfiles)||typeof settings.activeModelProfileId!=='string'))throw new Error('备份缺少模型配置或当前模型标识');
 records.settings=normalizeSettings({...settingsInputSchema.parse(settings),hasApiKey:false});
 const projects=new Set<string>(records.projects.map((p:any)=>p.id));
 for(const key of Object.keys(entities).filter(key=>!['projects','usage'].includes(key)))for(const r of records[key])if(!projects.has(r.projectId))throw new Error('备份记录关联了不存在的学习项目');
 const maps:any={};for(const key of Object.keys(entities))maps[key]=new Map(records[key].map((r:any)=>[r.id,r]));
 const match=(table:string,key:string,projectId:string)=>{const r=maps[table].get(key);if(!r||r.projectId!==projectId)throw new Error('备份包含断开的或跨项目的关联');return r;};
 const activitySources=(activity:any,projectId:string)=>{if(!activity)return;for(const sourceId of activity.sourceIds)match('fragments',sourceId,projectId);for(const version of activity.sourceVersions??[]){match('fragments',version.fragmentId,projectId);if(!activity.sourceIds.includes(version.fragmentId))throw new Error('来源版本不是当前任务引用的原文');for(const key of version.transcriptionIds){const t=match('sourceTranscriptions',key,projectId);if(t.fragmentId!==version.fragmentId||t.status!=='confirmed')throw new Error('任务来源版本没有关联已核对的原文转写');}}};
 const comparableActivity=(activity:any)=>{if(!activity)return activity;const {teachingVersionId,rubricIds,...content}=activity;return content;};
 const recordedRequests=new Set<string>(),recordedInputs=new Set<string>();
 for(const f of records.fragments)match('materials',f.materialId,f.projectId);
 for(const t of records.sourceTranscriptions){const f=match('fragments',t.fragmentId,t.projectId);match('materials',t.materialId,t.projectId);if(f.materialId!==t.materialId||(f.pageNumber!==undefined&&f.pageNumber!==t.pageNumber))throw new Error('转写与原页关联不一致');if(t.status==='confirmed'&&!t.confirmedAt)throw new Error('已核对转写缺少核对时间');}
 for(const p of records.projects)for(const step of p.nearSteps??[]){match('capabilities',step.capabilityId,p.id);for(const key of step.sourceIds)match('fragments',key,p.id);}
 for(const c of records.capabilities){for(const key of c.prerequisites)match('capabilities',key,c.projectId);for(const key of c.sourceIds)match('fragments',key,c.projectId);}
 for(const p of records.projects){let activeRoute:any;if(p.activeRouteVersionId){activeRoute=match('routeVersions',p.activeRouteVersionId,p.id);if(activeRoute.status!=='adopted')throw new Error('项目当前路线并非已采用版本');}if(p.pendingRouteVersionId){const route=match('routeVersions',p.pendingRouteVersionId,p.id);if(route.status!=='proposed')throw new Error('项目待处理路线并非提案版本');}if(p.learningPositionId){const position=match('learningPositions',p.learningPositionId,p.id);if(activeRoute&&position.routeVersionId!==activeRoute.id)throw new Error('项目主线位置不属于当前路线');}}
 for(const route of records.routeVersions){if(route.baseVersionId)match('routeVersions',route.baseVersionId,route.projectId);const nodeIds=new Set(route.mapNodes.map((node:any)=>node.id)),snapshotIds=new Set(route.unitSnapshots.map((unit:any)=>unit.id));if(new Set(route.unitIds).size!==route.unitIds.length||route.unitIds.some((key:string)=>!snapshotIds.has(key))||route.unitSnapshots.some((unit:any)=>!route.unitIds.includes(unit.id)))throw new Error('路线版本的学习单元快照不完整');for(const node of route.mapNodes){for(const sourceId of node.sourceIds)match('fragments',sourceId,route.projectId);if(node.connectsTo.some((key:string)=>!nodeIds.has(key)))throw new Error('全书地图引用了不存在的节点');}for(const cap of route.capabilitySnapshots){match('capabilities',cap.id,route.projectId);for(const key of cap.prerequisites)match('capabilities',key,route.projectId);for(const key of cap.sourceIds)match('fragments',key,route.projectId);}for(const unit of route.unitSnapshots){match('capabilities',unit.capabilityId,route.projectId);for(const key of unit.sourceIds)match('fragments',key,route.projectId);if(unit.prerequisiteUnitIds.some((key:string)=>!snapshotIds.has(key)))throw new Error('路线单元引用了不存在的先修单元');if(unit.reusedFromUnitId){const old=match('learningUnits',unit.reusedFromUnitId,route.projectId);if(old.capabilityId!==unit.capabilityId)throw new Error('路线调整把旧单元改绑到了另一项能力');}}for(const key of [...route.coverage.analyzedSectionIds,...route.coverage.pendingSectionIds])match('fragments',key,route.projectId);}
 for(const unit of records.learningUnits){const route=match('routeVersions',unit.routeVersionId,unit.projectId);match('capabilities',unit.capabilityId,unit.projectId);for(const key of unit.sourceIds)match('fragments',key,unit.projectId);for(const key of unit.prerequisiteUnitIds)match('learningUnits',key,unit.projectId);if(!route.unitIds.includes(unit.id))throw new Error('学习单元不属于所关联的路线版本');}
 for(const position of records.learningPositions){const route=match('routeVersions',position.routeVersionId,position.projectId),unit=match('learningUnits',position.unitId,position.projectId);if(unit.routeVersionId!==route.id||!route.unitIds.includes(unit.id))throw new Error('主线位置与路线或学习单元关联不一致');if(position.sessionId){const linked=match('sessions',position.sessionId,position.projectId);if(linked.unitId&&linked.unitId!==unit.id)throw new Error('主线位置关联了另一学习单元的会话');}if(position.returnUnitId)match('learningUnits',position.returnUnitId,position.projectId);if(position.returnSessionId)match('sessions',position.returnSessionId,position.projectId);}
 for(const s of records.sessions){
  match('capabilities',s.capabilityId,s.projectId);
  if(s.unitId){const unit=match('learningUnits',s.unitId,s.projectId);if(unit.capabilityId!==s.capabilityId)throw new Error('会话与学习单元关联不一致');if(s.routeVersionId){const historicalRoute=match('routeVersions',s.routeVersionId,s.projectId),historicalUnit=historicalRoute.unitSnapshots.find((item:any)=>item.id===s.unitId);if(!historicalUnit||historicalUnit.capabilityId!==s.capabilityId)throw new Error('会话与当时的路线版本关联不一致');}}else if(s.routeVersionId)throw new Error('会话声明路线版本却缺少学习单元');
  activitySources(s.activity,s.projectId);
  const inputs=new Map<string,any>();
  for(const message of s.messages){
   if(message.followup){
    const anchor=message.followup,root=s.messages.find((item:any)=>item.role==='user'&&item.inputId===anchor.rootInputId);
    if(!root?.followup||root.followup.rootInputId!==root.inputId||Date.parse(root.createdAt)>Date.parse(message.createdAt))throw new Error('追问支线缺少同一会话中的原始输入');
    if(message.attemptId||message.responseMode==='assessment'||message.taskId!==anchor.taskId||message.stepId!==anchor.stepId||message.teachingVersionId!==anchor.teachingVersionId)throw new Error('追问被错误关联到能力评价或另一任务');
    if(anchor.parentMessageId){const parent=s.messages.find((item:any)=>item.id===anchor.parentMessageId&&item.role==='assistant'),owner=s.messages.find((item:any)=>item.role==='user'&&item.inputId===message.inputId);if(!parent||!owner||anchor.kind!=='message'||parent.id!==anchor.id||parent.text!==anchor.text||s.messages.indexOf(parent)>=s.messages.indexOf(owner)||Date.parse(parent.createdAt)>Date.parse(message.createdAt))throw new Error('追问父消息不属于所选的原始回应');const parentInput=parent.inputId?s.messages.find((item:any)=>item.role==='user'&&item.inputId===parent.inputId):undefined;if(parentInput?.followup&&parentInput.followup.rootInputId!==anchor.rootInputId)throw new Error('追问父消息属于另一条支线');}
    else if(anchor.kind==='message')throw new Error('回应追问缺少父消息');
    if(anchor.kind!=='message'&&anchor.rootInputId!==message.inputId)throw new Error('追问原始片段被改绑到了另一支线');
    if(anchor.kind==='source'){match('fragments',anchor.id,s.projectId);if(!anchor.sourceIds.includes(anchor.id)||anchor.teachingVersionId)throw new Error('原文追问不能伪造教学版本');}
    if(anchor.historyIndex!==undefined&&anchor.kind!=='step')throw new Error('追问的历史位置没有关联教学片段');
    if(anchor.kind==='step'){const steps=s.teaching?[s.teaching.current,...s.teaching.history]:[],step=anchor.historyIndex!==undefined?s.teaching?.history[anchor.historyIndex]:steps.find((item:any)=>item.id===anchor.id);if(!step||step.id!==anchor.id||step.content!==anchor.text||step.taskId!==anchor.taskId||step.id!==anchor.stepId||(anchor.historyIndex!==undefined&&(step.teachingVersionId??step.activity?.teachingVersionId)&&anchor.teachingVersionId!==(step.teachingVersionId??step.activity?.teachingVersionId)))throw new Error('历史追问与原教学片段不一致');}
    if(new Set(anchor.sources.map((source:any)=>source.id)).size!==anchor.sources.length||anchor.sourceIds.some((key:string)=>!anchor.sources.some((source:any)=>source.id===key)))throw new Error('追问冻结来源不完整');
    for(const source of anchor.sources){match('fragments',source.id,s.projectId);for(const key of source.transcriptionIds){const transcription=match('sourceTranscriptions',key,s.projectId);if(transcription.fragmentId!==source.id)throw new Error('追问转录版本关联了另一段原文');}}
    if(anchor.teachingVersionId){const version=match('teachingVersions',anchor.teachingVersionId,s.projectId);if(version.sources.some((source:any)=>!anchor.sources.some((frozen:any)=>frozen.id===source.id&&JSON.stringify(frozen)===JSON.stringify(source))))throw new Error('追问没有保留原教学版本的来源摘录');}
   }
   for(const key of message.sourceIds??[])match('fragments',key,s.projectId);
   activitySources(message.activitySnapshot,s.projectId);
   if(message.stepSnapshot){for(const key of message.stepSnapshot.sourceIds)match('fragments',key,s.projectId);activitySources(message.stepSnapshot.activity,s.projectId);if((message.stepId&&message.stepId!==message.stepSnapshot.id)||(message.taskId&&message.taskId!==message.stepSnapshot.taskId))throw new Error('已保存输入与当时教学步骤不一致');}
   if(message.activitySnapshot?.id&&message.taskId!==message.activitySnapshot.id)throw new Error('已保存输入与冻结任务不一致');
   if(message.teachingVersionId){
    const v=match('teachingVersions',message.teachingVersionId,s.projectId),legacy=v.origin==='legacy';
    if(v.capabilityId!==s.capabilityId||message.taskId!==v.taskId||(message.activitySnapshot&&JSON.stringify(legacy?comparableActivity(message.activitySnapshot):message.activitySnapshot)!==JSON.stringify(legacy?comparableActivity(v.activity):v.activity)))throw new Error('已保存输入的教学版本关联不一致');
    const frozenStep=v.steps.find((step:any)=>step.id===message.stepId);
    if(frozenStep&&message.stepSnapshot&&JSON.stringify(frozenStep)!==JSON.stringify(message.stepSnapshot))throw new Error('已保存输入的步骤内容与冻结版本不一致');
   }
   if(message.attemptId){
    const a=match('attempts',message.attemptId,s.projectId),legacy=!a.teachingVersionId&&message.teachingVersionId&&match('teachingVersions',message.teachingVersionId,s.projectId).origin==='legacy';
    if(a.sessionId!==s.id||(message.role==='user'&&(a.text!==message.text||(a.taskId??a.activitySnapshot?.id)!==message.taskId||(!legacy&&a.teachingVersionId!==message.teachingVersionId)||a.helpLevel!==message.helpLevel||a.requestId!==message.requestId||a.stepId!==message.stepId||a.submittedAt!==message.createdAt||(a.activitySnapshot&&JSON.stringify(a.activitySnapshot)!==JSON.stringify(message.activitySnapshot)))))throw new Error('已保存输入与对应作答不一致');
    if(message.role==='user'&&message.responseMode==='discussion'&&(a.assessment||records.evidence.some((e:any)=>e.attemptId===a.id)))throw new Error('讨论输入不能关联能力评价');
   }
   if(message.inputId&&message.role==='user'){if(recordedInputs.has(message.inputId)||!message.requestId||recordedRequests.has(message.requestId)||!message.responseMode||!message.responseState)throw new Error('本地输入缺少回应状态或包含重复编号');if(message.responseMode==='assessment'&&(!message.attemptId||message.kind!=='attempt'))throw new Error('非作答输入不能声明能力评价');inputs.set(message.inputId,message);recordedInputs.add(message.inputId);recordedRequests.add(message.requestId);}
  }
  for(const message of s.messages)if(message.inputId&&message.role!=='user'){const input=inputs.get(message.inputId);if(!input||message.taskId!==input.taskId||(message.attemptId&&message.attemptId!==input.attemptId)||(message.teachingVersionId&&message.teachingVersionId!==input.teachingVersionId))throw new Error('回应未关联同一会话中保存的原输入');}
  if(s.teaching)for(const step of [s.teaching.current,...s.teaching.upcoming,...s.teaching.history,...(s.teaching.returnStep?[s.teaching.returnStep]:[]),...(s.teaching.returnUpcoming??[])]){for(const key of step.sourceIds)match('fragments',key,s.projectId);activitySources(step.activity,s.projectId);if(step.activity?.id&&step.activity.id!==step.taskId)throw new Error('教学步骤与题目关联不一致');}
  if(s.dueReviewId){const review=match('reviews',s.dueReviewId,s.projectId);if(review.capabilityId!==s.capabilityId||review.kind!==s.mode)throw new Error('备份会话与回访的能力或模式关联不一致');}
 }
 for(const observation of records.teachingObservations){const session=match('sessions',observation.sessionId,observation.projectId);if(observation.unitId){const unit=match('learningUnits',observation.unitId,observation.projectId);if(session.unitId&&session.unitId!==unit.id)throw new Error('教学观察与会话的学习单元不一致');}if(observation.inputId&&!session.messages.some((message:any)=>message.role==='user'&&message.inputId===observation.inputId))throw new Error('教学观察引用了不存在的原始输入');if(observation.attemptId){const attempt=match('attempts',observation.attemptId,observation.projectId);if(attempt.sessionId!==session.id)throw new Error('教学观察与原作答会话不一致');}if(observation.evidenceId){const evidence=match('evidence',observation.evidenceId,observation.projectId);if(evidence.sessionId!==session.id||evidence.attemptId!==observation.attemptId)throw new Error('教学观察与能力证据关联不一致');}if(observation.teachingVersionId)match('teachingVersions',observation.teachingVersionId,observation.projectId);}
 for(const draft of records.understandingDrafts){match('routeVersions',draft.routeVersionId,draft.projectId);if(draft.unitId)match('learningUnits',draft.unitId,draft.projectId);if(draft.basedOnDraftId){const base=match('understandingDrafts',draft.basedOnDraftId,draft.projectId);if(base.unitId!==draft.unitId)throw new Error('理解稿版本跨越了不同学习单元');}for(const block of draft.blocks){for(const sourceId of block.sourceIds)match('fragments',sourceId,draft.projectId);if(block.sourceInputIds.some((inputId:string)=>!recordedInputs.has(inputId)))throw new Error('理解稿引用了不存在的学习输入');}}
 for(const layout of records.readingLayouts){const material=match('materials',layout.materialId,layout.projectId),fragment=match('fragments',layout.fragmentId,layout.projectId);if(fragment.materialId!==material.id||(layout.pageNumber!==undefined&&fragment.pageNumber!==undefined&&layout.pageNumber!==fragment.pageNumber))throw new Error('阅读布局与材料原页关联不一致');for(const block of layout.blocks){if(block.kind==='prose'&&!block.text)throw new Error('阅读布局正文为空');if(block.kind==='source_image'&&!block.region)throw new Error('原图阅读区域缺少坐标');if(block.transcriptionId){const transcription=match('sourceTranscriptions',block.transcriptionId,layout.projectId);if(transcription.fragmentId!==fragment.id||transcription.status!=='confirmed')throw new Error('阅读布局引用了未确认或错误页面的转录');}}}
 for(const a of records.attempts){
  match('sessions',a.sessionId,a.projectId);
  for(const key of a.assessment?.sourceIds??[])match('fragments',key,a.projectId);
  activitySources(a.activitySnapshot,a.projectId);
  if(a.activitySnapshot?.id&&a.taskId!==a.activitySnapshot.id)throw new Error('作答与冻结任务关联不一致');
  if(a.reviewId){const r=match('reviews',a.reviewId,a.projectId),s=match('sessions',a.sessionId,a.projectId);if(r.capabilityId!==s.capabilityId||r.kind!==a.mode)throw new Error('作答与冻结回访模式不一致');}
 }
 for(const e of records.evidence){
  const sourceSession=match('sessions',e.sessionId,e.projectId),sourceAttempt=match('attempts',e.attemptId,e.projectId);
  match('capabilities',e.capabilityId,e.projectId);
  if(sourceAttempt.sessionId!==e.sessionId||sourceSession.capabilityId!==e.capabilityId)throw new Error('备份证据与原作答、会话或能力的关联不一致');
  if(sourceAttempt.helpLevel!==e.helpLevel)throw new Error('备份证据与提交时的帮助条件不一致');
  if((sourceAttempt.mode!==undefined||sourceAttempt.reviewId!==undefined)&&e.reviewId!==sourceAttempt.reviewId)throw new Error('备份证据与提交时的回访关联不一致');
  if(e.taskId!==sourceAttempt.taskId||e.stepId!==sourceAttempt.stepId||JSON.stringify(e.activitySnapshot)!==JSON.stringify(sourceAttempt.activitySnapshot))throw new Error('备份证据与提交时的任务快照不一致');
  if((e.teachingVersionId??e.activitySnapshot?.teachingVersionId)!==(sourceAttempt.teachingVersionId??sourceAttempt.activitySnapshot?.teachingVersionId))throw new Error('备份证据与提交时冻结的教学版本不一致');
  const versionId=e.teachingVersionId??e.activitySnapshot?.teachingVersionId;
  if(versionId){
   if(['independent','delayed','transfer'].includes(e.status)&&derivesFromDispute(records,versionId))throw new Error('质疑后修订任务不能被恢复为全新独立表现');
   const v=match('teachingVersions',versionId,e.projectId),review=records.taskReviews.filter((r:any)=>r.teachingVersionId===versionId&&Date.parse(r.createdAt)<=Date.parse(e.createdAt)).at(-1),ids=v.activity.rubricIds??[];
   if(!review||review.status!=='ready'||review.contentHash!==v.contentHash)throw new Error('能力表现缺少当时有效的任务核验');
   if(!ids.length||e.assessment.criteria.length!==ids.length||new Set(e.assessment.criteria.map((c:any)=>c.criterionId)).size!==ids.length||ids.some((id:string)=>!e.assessment.criteria.some((c:any)=>c.criterionId===id)))throw new Error('能力表现未完整关联稳定评价标准');
   for(const [index,id] of ids.entries()){const criterion=e.assessment.criteria.find((c:any)=>c.criterionId===id),branches=review.branches.filter((b:any)=>b.criterionIndexes.includes(index)),inactive=branches.length>0&&branches.every((b:any)=>b.applicability==='does_not_apply');if(branches.some((b:any)=>b.applicability==='unknown')||(criterion.result==='not_applicable')!==inactive)throw new Error('能力表现与核验条件分支不一致');}
   if(e.assessment.criteria.every((c:any)=>c.result==='not_applicable'))throw new Error('全部标准不适用不能产生能力表现');
  }
  activitySources(e.activitySnapshot,e.projectId);if(e.reviewId){const reviewed=match('reviews',e.reviewId,e.projectId);if(reviewed.capabilityId!==e.capabilityId)throw new Error('回访证据关联的能力不一致');}
  for(const key of e.assessment.sourceIds)match('fragments',key,e.projectId);
 }
 for(const r of records.reviews){
  const origin=match('sessions',r.fromSessionId,r.projectId);
  activitySources(r.fromActivity,r.projectId);
  match('capabilities',r.capabilityId,r.projectId);
  if(origin.capabilityId!==r.capabilityId)throw new Error('备份回访与来源会话的能力关联不一致');
  if(r.status!=='done'){
   if(r.completedSessionId||r.completedEvidenceId||r.completedTaskId)throw new Error('未完成的回访不能声明完成会话关联');
   continue;
  }
  if(!r.completedSessionId)throw new Error('已完成回访缺少完成会话关联');
  const completed=match('sessions',r.completedSessionId,r.projectId);
  if(completed.id===origin.id||completed.capabilityId!==r.capabilityId||(!r.completedEvidenceId&&(completed.dueReviewId!==r.id||completed.mode!==r.kind)))throw new Error('备份回访与完成会话的关联不一致');
  const qualified=records.evidence.some((e:any)=>{const activity=e.activitySnapshot??completed.activity;return (!r.completedEvidenceId||e.id===r.completedEvidenceId)&&(!r.completedTaskId||e.taskId===r.completedTaskId)&&(!e.reviewId||e.reviewId===r.id)&&e.sessionId===completed.id&&e.capabilityId===r.capabilityId&&e.status===r.kind&&e.helpLevel===0&&e.assessment.outcome==='met'&&e.assessment.criteria.some((c:any)=>c.result==='met')&&e.assessment.criteria.every((c:any)=>c.result==='met'||c.result==='not_applicable')&&activity.rubric.every((criterion:string,index:number)=>e.assessment.criteria.some((c:any)=>activity.rubricIds?c.criterionId===activity.rubricIds[index]:(c.result==='met'&&c.criterion.trim()===criterion.trim())));});
  if(!qualified)throw new Error('已完成回访缺少满足原评价标准的独立验证证据');
 }
 const files=new Map<string,{name:string;bytes:Buffer}>();
 for(const v of records.teachingVersions){
  match('capabilities',v.capabilityId,v.projectId);activitySources(v.activity,v.projectId);
  if(v.activity.id!==v.taskId||teachingContentHash(v)!==v.contentHash)throw new Error('教学版本内容或任务关联校验失败');
  if(v.origin!=='legacy'&&v.activity.teachingVersionId!==v.id)throw new Error('教学版本编号与活动不一致');
  for(const step of v.steps){for(const sourceId of step.sourceIds)match('fragments',sourceId,v.projectId);activitySources(step.activity,v.projectId);if(step.taskId!==v.taskId)throw new Error('冻结教学步骤引用了其它任务');}
  for(const source of v.sources){match('fragments',source.id,v.projectId);for(const key of source.transcriptionIds){const t=match('sourceTranscriptions',key,v.projectId);if(t.fragmentId!==source.id||t.status!=='confirmed')throw new Error('冻结来源版本关联不一致');}}
  if(v.replacesVersionId){const old=match('teachingVersions',v.replacesVersionId,v.projectId);if(old.id===v.id||old.capabilityId!==v.capabilityId||v.version!==old.version+1)throw new Error('教学版本派生关联不一致');}
 }
 for(const table of ['sessions','attempts','evidence'])for(const record of records[table]){
  const versionId=record.teachingVersionId??record.activitySnapshot?.teachingVersionId??record.activity?.teachingVersionId;
  if(versionId){const v=match('teachingVersions',versionId,record.projectId),activity=record.activitySnapshot??record.activity;if(activity&&(v.taskId!==activity.id||JSON.stringify(v.activity)!==JSON.stringify(activity)))throw new Error('学习记录与冻结教学版本不一致');}
 }
 for(const r of records.taskReviews){
  const v=match('teachingVersions',r.teachingVersionId,r.projectId);if(r.contentHash!==v.contentHash)throw new Error('核验结论未绑定正确的教学版本');
  if(r.effectiveStatus!==undefined&&r.effectiveStatus!==r.status)throw new Error('核验的程序有效状态不一致');
  for(const reason of r.blockingReasons??[]){if(reason.sourceId&&!v.sources.some((source:any)=>source.id===reason.sourceId))throw new Error('核验阻断原因关联了其他材料');if(reason.stepId&&!v.steps.some((step:any)=>step.id===reason.stepId))throw new Error('核验阻断原因关联了其他步骤');}
  if(r.branches.some((b:any)=>b.criterionIndexes.some((i:number)=>i>=v.activity.rubric.length)))throw new Error('核验条件引用了不存在的标准');
  for(const relation of r.exposureRelations)match('answerExposures',relation.exposureId,r.projectId);
  for(const checked of r.sourceChecks??[])if(!v.sources.some((source:any)=>source.id===checked.sourceId))throw new Error('来源核对引用了教学片段之外的材料');
  for(const finding of r.assessmentFindings??[])match('evidence',finding.evidenceId,r.projectId);
 }
 for(const d of records.disputes){const v=match('teachingVersions',d.teachingVersionId,d.projectId),s=match('sessions',d.sessionId,d.projectId);if(v.taskId!==d.taskId||v.contentHash!==d.contentHash||s.capabilityId!==v.capabilityId)throw new Error('质疑没有绑定原任务版本');if(d.replacementVersionId){const replacement=match('teachingVersions',d.replacementVersionId,d.projectId);if(replacement.replacesVersionId!==v.id)throw new Error('议题修订版本未派生自原题');}if(d.reviewId){const r=match('taskReviews',d.reviewId,d.projectId);if(r.teachingVersionId!==v.id&&r.teachingVersionId!==d.replacementVersionId)throw new Error('争议核验版本不一致');}}
 for(const c of records.corrections){const v=match('teachingVersions',c.teachingVersionId,c.projectId);if(c.evidenceId){const e=match('evidence',c.evidenceId,c.projectId);if(e.taskId&&e.taskId!==v.taskId)throw new Error('纠正未关联原任务评价');}if(c.disputeId){const d=match('disputes',c.disputeId,c.projectId);if(d.teachingVersionId!==v.id)throw new Error('纠正与质疑版本不一致');}if(c.reviewId){const r=match('taskReviews',c.reviewId,c.projectId);let reviewed=match('teachingVersions',r.teachingVersionId,c.projectId);const visited=new Set<string>();while(reviewed.id!==v.id&&reviewed.replacesVersionId&&!visited.has(reviewed.id)){visited.add(reviewed.id);reviewed=match('teachingVersions',reviewed.replacesVersionId,c.projectId);}if(reviewed.id!==v.id)throw new Error('纠正核验没有关联原题或其修订版本');}if(c.replacementVersionId){const replacement=match('teachingVersions',c.replacementVersionId,c.projectId);if(replacement.replacesVersionId!==v.id)throw new Error('纠正的替代版本未派生自原题');}}
 for(const e of records.answerExposures){const s=match('sessions',e.sessionId,e.projectId);match('capabilities',e.capabilityId,e.projectId);if(s.capabilityId!==e.capabilityId)throw new Error('答案暴露与能力关联不一致');if(e.teachingVersionId){const v=match('teachingVersions',e.teachingVersionId,e.projectId);if(v.taskId!==e.taskId||v.capabilityId!==e.capabilityId)throw new Error('答案暴露与教学版本关联不一致');}}
 if(!Array.isArray(raw.files))throw new Error('备份原件清单无效');
 for(const f of raw.files){if(!maps.materials.has(f.materialId)||typeof f.entry!=='string'||!f.entry.startsWith('materials/'+f.materialId+'/')||files.has(f.materialId))throw new Error('备份原件关联无效');const entry=zip.getEntry(f.entry);if(!entry||entry.header.size>50*1024*1024)throw new Error('备份原件缺失或过大');const bytes=entry.getData();if(sha(bytes)!==f.sha256)throw new Error('备份原件校验失败，未更改现有档案');files.set(f.materialId,{name:safeMaterialFilename(basename(f.entry)),bytes});}
 if(files.size!==records.materials.length)throw new Error('备份未包含全部材料原件');
 return {records,files};
}
export async function prepareRestore(file:string,stagingDirectory:string,wasmPath?:string):Promise<void>{
 const {records,files}=readBackup(file);
 if(existsSync(join(stagingDirectory,'learning.sqlite')))throw new Error('恢复暂存目录已有档案，已停止以保护数据');
 mkdirSync(stagingDirectory,{recursive:true});
 for(const m of records.materials){const f=files.get(m.id)!;const folder=join(stagingDirectory,'materials',m.id);mkdirSync(folder,{recursive:true});m.storedPath=join(folder,f.name);writeFileSync(m.storedPath,f.bytes);}
 const store=await LearningStore.open(stagingDirectory,wasmPath);
 try{store.transaction(()=>{for(const collection of Object.keys(entities) as Collection[])for(const entity of records[collection])store.put(collection,entity as any);store.updateSettings(records.settings);});}finally{store.close();}
}
