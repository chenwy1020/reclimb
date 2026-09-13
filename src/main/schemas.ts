import {z} from 'zod';
import type {TaskDemand} from '../shared/curriculum';
import {DEFAULT_MODEL_OUTPUT_TOKENS,MAX_MODEL_OUTPUT_TOKENS,MIN_MODEL_OUTPUT_TOKENS,MODEL_OUTPUT_LIMIT_MESSAGE} from '../shared/model-limits';
const short=z.string().max(2000),text=z.string().max(100000),id=z.string().min(1).max(120);
// Generation uses only this request's sources; persisted records retain generic IDs.
function generatedSourceIds(allowedSourceIds?:string[],max?:number){
 const allowed=allowedSourceIds===undefined?undefined:[...new Set(allowedSourceIds)];
 const item=allowed?.length?z.enum(allowed as [string,...string[]],{error:'引用只能选择本次提供的真实来源编号'}):id;
 const array=z.array(item);
 return allowed?.length===0?array.max(0,{error:'没有材料来源时，引用必须为空数组'}):max===undefined?array:array.max(max);
}
function disclosesExplicitAnswer(value:string):boolean {
 const normalized=value.normalize('NFKC');
 // Only explicit answer disclosures observed in public criteria, not mathematical truth checks.
 return /(?:答出|正确回答|答案(?:是|为))\s*[：:"“'‘（(=$]*\s*(?:[-+]?\d+(?:\.\d+)?|[甲乙丙丁]|[A-D])(?=$|[\s”"'’）)$。。，,！!；;]|即可|就)/i.test(normalized)
  ||/(?:正确)?说出[^。！？；\n]{0,40}(?:是|为|等于)\s*[：:"“'‘(=$]*\s*[-+]?\d+(?:\.\d+)?(?=$|[\s”"'’)\$。。，,！!；;]|即可)/i.test(normalized)
  ||/(?:正确)?(?:选择|选出)\s*[“"'‘(]*\s*(?:选项)?(?:[甲乙丙丁]|[A-D]|\d+)(?=路径|路线|选项|[”"'’)\s。。，,！!；;]|即可|$)/i.test(normalized)
  ||/(?:回答|答出|说出)\s*[“"'‘(]*\s*更(?:小|大)或不变(?=$|[”"'’)\s。。，,！!；;]|即可)/.test(normalized);
}
const taskInputDescription='题目必须自包含完成任务所需的原句、数据、选项或代码；提到下表或如下代码时必须在本instruction内给出，来源链接和另一道已解示例不能替代当前题目输入。要求学习者自构时必须明确说明。';
function missingTaskInput(instruction:string):boolean {
 if(/(?:自行|自己|自拟)(?:构造|编写|设计|制作|列出)/.test(instruction))return false;
 const refersTable=/下表|(?:下面|下方|以下|如下|下列|给定)(?:的)?表格?|表格中(?:列出|给出|某条|的)|表中(?:列出|给出)/.test(instruction);
 const rows=instruction.split(/\r?\n/).filter(line=>line.includes('|')&&line.split('|').filter(cell=>cell.trim()).length>=2&&!/^[|\s:=-]+$/.test(line));
 const hasData=rows.length>=2||/[-+]?\d+(?:\.\d+)?(?:\s*[,，、;；]\s*[-+]?\d+(?:\.\d+)?){1,}/.test(instruction);
 const refersCode=/(?:下面|下方|以下|如下|下列|给定)(?:的)?代码/.test(instruction);
 const hasCode=/```[^\n]*\n[\s\S]*?\S[\s\S]*?```|`[^`\n]+`/.test(instruction);
 return (refersTable&&!hasData)||(refersCode&&!hasCode);
}
export const supportScopeSchema=z.enum(['concept','other_example','current_task','navigation']);
export const transferCheckSchema=z.object({changedSituation:short,sharedPrinciple:short,requiredAdaptation:short,verdict:z.enum(['valid','same_task','uncertain']),reason:short});
export const taskDemandSchema:z.ZodType<TaskDemand>=z.object({kind:z.enum(['recognize','explain','calculate','derive','compare','integrate','transfer','synthesize']),complexity:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),novelty:z.union([z.literal(1),z.literal(2),z.literal(3)]),scaffolding:z.enum(['guided','supported','independent']),concepts:z.array(z.string().min(1).max(100)).min(1).max(12)});
export const activitySchema=z.object({id:id.optional(),teachingVersionId:id.optional(),rubricIds:z.array(id).max(12).optional(),transferCheck:transferCheckSchema.optional(),sourceVersions:z.array(z.object({fragmentId:id,transcriptionIds:z.array(id).max(100)})).max(30).optional(),title:short,instruction:text.min(1),kind:z.enum(['prediction','application','argument','reconstruction','diagnosis','selection']),rubric:z.array(short.min(1)).min(1).max(12),sourceIds:z.array(id).max(30),referenceAnswer:text.optional(),assessmentBasis:z.enum(['source','rule','ai']),demand:taskDemandSchema.optional(),workSize:z.enum(['short','extended']).optional(),milestones:z.array(short.min(1)).max(12).optional()});
export const generatedActivitySchema=activitySchema.omit({referenceAnswer:true,id:true,teachingVersionId:true,rubricIds:true,transferCheck:true,sourceVersions:true}).extend({instruction:z.string().min(1).max(2400).describe(taskInputDescription),rubric:z.array(short.min(1)).min(1).max(4)});
export const assessmentSchema=z.object({outcome:z.enum(['met','partial','not_yet','uncertain']),feedback:text,criteria:z.array(z.object({criterionId:id.optional(),criterion:short,result:z.enum(['met','partial','not_yet','uncertain','not_applicable']),reason:text})).min(1).max(12),limitations:z.array(short).max(20),sourceIds:z.array(id).max(30)});
export function assessmentSchemaFor(allowedSourceIds?:string[]){return assessmentSchema.extend({sourceIds:generatedSourceIds(allowedSourceIds,30)});}
export const startingPointSchema=z.object({familiarity:z.enum(['new','some','experienced']),background:text,updatedAt:short});
export const learningScopeSchema=z.object({suggestedFocus:short,reason:short,status:z.enum(['proposed','confirmed']),confirmedAt:short.optional()});
export const nearStepSchema=z.object({id,capabilityId:id,title:short,objective:short,reason:short,sourceIds:z.array(id).max(30),completion:short.optional(),prerequisites:z.array(short).max(12).optional()});
const action=z.enum(['explain','demonstrate','attempt','feedback','check','reflect']);
export const teachingStepSchema=z.object({id,taskId:id,teachingVersionId:id.optional(),action,title:short,content:text,sourceIds:z.array(id).max(30),activity:activitySchema.optional(),createdAt:short});
export const teachingStateSchema=z.object({version:z.literal(1),current:teachingStepSchema,upcoming:z.array(teachingStepSchema).max(8),history:z.array(teachingStepSchema).max(10000),guidance:z.enum(['guided','supported','independent']),confusionCount:z.number().int().min(0),lastConfusion:z.enum(['term','reason','step','overload']).optional(),returnStep:teachingStepSchema.optional(),returnUpcoming:z.array(teachingStepSchema).max(8).optional()});
export function requiresUnavailableInput(value:string):boolean {
 return /(?:用|以|使用)[^。！？\n]{0,12}(?:颜色|彩色|横线|波浪线|下划线)[^。！？\n]{0,16}(?:标出|画出|划出|标记|区分)|(?:口头|语音|录音)(?:说明|解释|回答|讲述|复述|表达)|拖(?:动|拽)[^。！？\n]{0,8}(?:卡片|图形)|\b(?:underline|drag and drop|speak aloud|answer orally)\b/i.test(value);
}
export function teachingPlanSchemaFor(limits:{maxCriteria?:number;maxInstruction?:number;maxContent?:number;maxSteps?:number}={},allowedSourceIds?:string[],independent=false) {
 const task=generatedActivitySchema.extend({rubric:z.array(short.min(1).describe('公开给学习者的可观察标准：只描述比较对象或操作，不写具体结果、数值答案或正确选项。')).min(1).max(limits.maxCriteria??4),instruction:z.string().min(1).max(limits.maxInstruction??2400).describe(taskInputDescription),sourceIds:generatedSourceIds(allowedSourceIds,30)});
 return z.object({steps:z.array(z.object({action:independent?z.literal('check'):z.enum(['explain','demonstrate','attempt','check','reflect']),title:short.min(1),content:z.string().min(1).max(limits.maxContent??100000),sourceIds:generatedSourceIds(allowedSourceIds,30),activity:independent?task:task.optional()})).min(1).max(independent?1:limits.maxSteps??4)}).superRefine((plan,ctx)=>{
  const tasks=plan.steps.filter(step=>step.action==='attempt'||step.action==='check');
  if(tasks.length!==1||!tasks[0]?.activity)ctx.addIssue({code:'custom',message:'教学片段必须包含恰好一个有完整activity的尝试或检验'});
  if(plan.steps.some(step=>step.action!=='attempt'&&step.action!=='check'&&step.activity))ctx.addIssue({code:'custom',message:'讲解和示范步骤不可携带当前任务答案'});
  if(tasks.length&&plan.steps.at(-1)!==tasks[0])ctx.addIssue({code:'custom',message:'先教学，最后才进入尝试'});
  for(const [index,step] of plan.steps.entries()){
   const requested=step.content+'\n'+(step.activity?.instruction??'');
   if(requiresUnavailableInput(requested))ctx.addIssue({code:'custom',path:['steps',index],message:'当前界面只支持文本、编号选择和数学式，请把划线或拖动要求改成可直接输入的回答'});
   if(step.activity&&missingTaskInput(step.activity.instruction))ctx.addIssue({code:'custom',path:['steps',index,'activity','instruction'],message:'当前题目引用了未提供的表格、数据或代码。请在instruction内补齐实际表格/数值列表或代码片段；另一道示范和来源编号不能替代当前题目的输入。若要求学习者自行构造，必须明确说明。'});
   step.activity?.rubric.forEach((criterion,rubricIndex)=>{if(disclosesExplicitAnswer(criterion))ctx.addIssue({code:'custom',path:['steps',index,'activity','rubric',rubricIndex],message:'公开标准不能提前给出数值答案或正确选项；只写可观察的操作，并为尝试换一个未示范的新例子。'});});
  }
 });
}
export const teachingPlanSchema=teachingPlanSchemaFor();
export function routeSchemaFor(beginner=false,allowedSourceIds?:string[],existingUnitIds:string[]=[],existingCapabilityIds:string[]=[],existingIdentity?:{goal:string;capabilities:Array<{id:string;title:string;description:string;goalContext?:string;sourceIds:string[];prerequisites:string[]}>;units:Array<{id:string;capabilityId:string}>}){
 const capabilityTitle=z.string().min(1).max(80).describe('逐字引用本次返回对象中 capabilities[].title 的完整名称；不是能力ID、学习单元标题或概念简称。');
 const capabilityPrerequisites=z.array(z.string().min(1).max(80)).max(8).default([]).describe('路线内部的能力先修关系：每项必须逐字等于本次返回对象中另一项 capabilities[].title，不得引用自身或形成循环。无内部先修时填 []。外部基础或尚未确认的概念写入相关 units[].unresolvedGaps，保持未知，不得据此宣布基础薄弱或已经掌握。');
 const unitPrerequisites=z.array(z.string().min(1).max(100)).max(8).default([]).describe('路线内部的单元先修关系：每项必须逐字等于本次返回对象中另一项 units[].title；不是 capabilities[].title、概念名称或旧单元ID。无内部先修时填 []，不得引用自身或形成循环。');
 const near=z.object({capabilityTitle:z.string().min(1).max(80),title:z.string().min(1).max(80),objective:z.string().min(1).max(360).describe('只预览一个具体行动目标，不写练习题、题目数值、选项、已解示范或答案；实际题目在开始活动时生成。对主题陌生不等于先修陌生；已有相关背景可从一个连接新旧概念的短判断开始，缺少基础才先讲解。主题陌生的首步不超过140字符，不合并多构件、多例子和理由说明。'),reason:z.string().min(1).max(220).describe('解释本步与用户具体背景、主题缺口的关系；不能仅因主题陌生忽略已陈述先修。'),completion:z.string().min(1).max(220).describe('仅描述方法层面的可观察动作，不预先求值、展示练习解答或透露其他步骤的答案；不额外添加任务。区分证据支持与主张真假。'),prerequisites:z.array(z.string().max(80)).max(5),sourceIds:generatedSourceIds(allowedSourceIds,3).default([])});
 const existing=existingUnitIds.length?z.enum(existingUnitIds as [string,...string[]]):id.refine(()=>false,{message:'首次路线不能引用旧学习单元'});
 const existingCapability=existingCapabilityIds.length?z.enum(existingCapabilityIds as [string,...string[]]):id.refine(()=>false,{message:'首次路线不能引用旧能力'});
 const unit=z.object({existingUnitId:existing.optional(),capabilityTitle,title:z.string().min(1).max(100).describe('本路线学习单元的唯一完整标题；被其他单元的 prerequisiteTitles 引用。'),coreQuestion:z.string().min(1).max(360),purpose:z.string().min(1).max(360),expectedOutcome:z.string().min(1).max(360),unresolvedGaps:z.array(z.string().min(1).max(360)).max(12).default([]).describe('保留当前材料中未解决的问题，以及不属于路线内部节点的外部先修或尚未确认的基础；未知基础应标明尚待核对，不能自动判为缺失或掌握。需要外部材料时写明选择标准，由学习者决定是否加入。'),phase:z.enum(['survey','expand','synthesize','revisit']),sourceIds:generatedSourceIds(allowedSourceIds,6).default([]),locators:z.array(z.string().min(1).max(240)).max(20).default([]),prerequisiteTitles:unitPrerequisites});
 const mapNode=z.object({key:z.string().min(1).max(80).describe('本次 mapNodes 中唯一的节点编号，供 connectsTo 引用；与显示标题分开。'),title:z.string().min(1).max(100),question:z.string().min(1).max(360),role:z.string().min(1).max(360),sourceIds:generatedSourceIds(allowedSourceIds,6).default([]),connectsTo:z.array(z.string().min(1).max(80)).max(12).default([]).describe('每项必须逐字引用本次返回对象中的 mapNodes[].key；不能写节点标题、能力标题或学习单元标题。没有关联时填 []。')});
 return z.object({summary:z.string().max(1200),coreQuestion:z.string().min(1).max(500).optional(),mapNodes:z.array(mapNode).min(1).max(24).optional(),capabilities:z.array(z.object({existingCapabilityId:existingCapability.optional(),title:z.string().min(1).max(80).describe('本路线能力的唯一完整名称；能力先修和单元归属必须逐字引用此名称。'),description:z.string().max(500),prerequisites:capabilityPrerequisites,sourceIds:generatedSourceIds(allowedSourceIds,6).default([])})).min(3).max(10),nearSteps:z.array(near.extend({capabilityTitle,prerequisites:near.shape.prerequisites.describe('旧版步骤的自然语言基础说明，不是内部能力关系；新路线请使用 units，并将外部或未知基础保留在 unresolvedGaps。')})).min(2).max(4).optional(),units:z.array(unit).min(2).max(16).optional(),scopeProposal:z.object({suggestedFocus:z.string().min(1).max(360),reason:z.string().min(1).max(360)}).optional(),changeSummary:z.string().max(600).optional()}).superRefine((route,ctx)=>{
  if(!route.units?.length&&!route.nearSteps?.length)ctx.addIssue({code:'custom',path:['units'],message:'路线必须给出学习单元'});
  const capabilityTitles=new Set(route.capabilities.map(item=>item.title));
  if(capabilityTitles.size!==route.capabilities.length)ctx.addIssue({code:'custom',path:['capabilities'],message:'能力名称不能重复'});
  route.capabilities.forEach((item,index)=>{item.prerequisites.forEach((title,referenceIndex)=>{if(!capabilityTitles.has(title))ctx.addIssue({code:'custom',path:['capabilities',index,'prerequisites',referenceIndex],message:`能力引用了不存在的先修能力 ${JSON.stringify(title)}；必须逐字引用本次 capabilities[].title，可用名称：${JSON.stringify([...capabilityTitles])}。外部或尚待确认的基础保留到相关 units[].unresolvedGaps，不得猜测映射或为通过校验新增虚假能力。`});});});
  const capabilityState=new Map<string,'visiting'|'done'>();
  const visitCapability=(title:string)=>{if(capabilityState.get(title)==='visiting'){ctx.addIssue({code:'custom',path:['capabilities'],message:'能力先修关系不能形成循环'});return;}if(capabilityState.get(title)==='done')return;capabilityState.set(title,'visiting');const item=route.capabilities.find(capability=>capability.title===title);item?.prerequisites.filter(prerequisite=>capabilityTitles.has(prerequisite)).forEach(visitCapability);capabilityState.set(title,'done');};
  route.capabilities.forEach(item=>visitCapability(item.title));
  const unitTitles=new Set(route.units?.map(item=>item.title));
  if(route.units&&unitTitles.size!==route.units.length)ctx.addIssue({code:'custom',path:['units'],message:'学习单元标题不能重复'});
  route.units?.forEach((item,index)=>{if(!capabilityTitles.has(item.capabilityTitle))ctx.addIssue({code:'custom',path:['units',index,'capabilityTitle'],message:`学习单元必须对应路线中的能力；${JSON.stringify(item.capabilityTitle)} 不在本次 capabilities[].title 中，可用名称：${JSON.stringify([...capabilityTitles])}`});item.prerequisiteTitles.forEach((title,referenceIndex)=>{if(!unitTitles.has(title))ctx.addIssue({code:'custom',path:['units',index,'prerequisiteTitles',referenceIndex],message:`学习单元引用了不存在的先修单元 ${JSON.stringify(title)}；必须逐字引用本次 units[].title，可用标题：${JSON.stringify([...unitTitles])}。不能使用能力标题、旧单元ID或概念简称；外部或未知基础保留到 unresolvedGaps。`});});});
  const unitState=new Map<string,'visiting'|'done'>();
  const visitUnit=(title:string)=>{if(unitState.get(title)==='visiting'){ctx.addIssue({code:'custom',path:['units'],message:'学习单元先修关系不能形成循环'});return;}if(unitState.get(title)==='done')return;unitState.set(title,'visiting');const item=route.units?.find(unit=>unit.title===title);item?.prerequisiteTitles.filter(prerequisite=>unitTitles.has(prerequisite)).forEach(visitUnit);unitState.set(title,'done');};
  route.units?.forEach(item=>visitUnit(item.title));
  route.nearSteps?.forEach((item,index)=>{if(!capabilityTitles.has(item.capabilityTitle))ctx.addIssue({code:'custom',path:['nearSteps',index,'capabilityTitle'],message:`近期步骤必须对应路线中的能力；${JSON.stringify(item.capabilityTitle)} 不在本次 capabilities[].title 中，可用名称：${JSON.stringify([...capabilityTitles])}`});});
  const reused=route.units?.flatMap(item=>item.existingUnitId?[item.existingUnitId]:[])??[];if(new Set(reused).size!==reused.length)ctx.addIssue({code:'custom',path:['units'],message:'同一个旧学习单元不能在新路线中重复使用'});
  const reusedCapabilities=route.capabilities.flatMap(item=>item.existingCapabilityId?[item.existingCapabilityId]:[]);if(new Set(reusedCapabilities).size!==reusedCapabilities.length)ctx.addIssue({code:'custom',path:['capabilities'],message:'同一个旧能力不能在新路线中重复使用'});
  if(existingIdentity){
   const previousCapabilities=new Map(existingIdentity.capabilities.map(item=>[item.id,item])),previousByTitle=new Map(existingIdentity.capabilities.map(item=>[item.title,item])),previousUnits=new Map(existingIdentity.units.map(item=>[item.id,item])),sameStrings=(a:string[],b:string[])=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort()),identityMemo=new Map<string,string|undefined>(),resolvingIdentity=new Set<string>();
   const inferredPreviousId=(item:(typeof route.capabilities)[number]):string|undefined=>{if(item.existingCapabilityId)return item.existingCapabilityId;if(identityMemo.has(item.title))return identityMemo.get(item.title);if(resolvingIdentity.has(item.title))return undefined;resolvingIdentity.add(item.title);const previous=previousByTitle.get(item.title);let matched:string|undefined;if(previous&&previous.goalContext===existingIdentity.goal&&previous.description===item.description&&sameStrings(previous.sourceIds,item.sourceIds)){const prerequisiteIds=item.prerequisites.map(title=>route.capabilities.find(candidate=>candidate.title===title)).map(candidate=>candidate?inferredPreviousId(candidate):undefined);if(prerequisiteIds.every((id):id is string=>!!id)&&sameStrings(previous.prerequisites,prerequisiteIds))matched=previous.id;}resolvingIdentity.delete(item.title);identityMemo.set(item.title,matched);return matched;};
   route.capabilities.forEach((item,index)=>{if(!item.existingCapabilityId)return;const previous=previousCapabilities.get(item.existingCapabilityId);if(!previous||previous.goalContext!==existingIdentity.goal||previous.title!==item.title||previous.description!==item.description)ctx.addIssue({code:'custom',path:['capabilities',index,'existingCapabilityId'],message:'复用旧能力时必须原样保留名称、说明与长期目标；含义改变时请建立新能力'});});
   route.units?.forEach((item,index)=>{if(!item.existingUnitId)return;const previous=previousUnits.get(item.existingUnitId),capability=route.capabilities.find(candidate=>candidate.title===item.capabilityTitle);if(!previous||!capability||inferredPreviousId(capability)!==previous.capabilityId)ctx.addIssue({code:'custom',path:['units',index,'existingUnitId'],message:'旧学习单元只能继续绑定原来的能力；能力含义改变时请建立新单元'});});
  }
  const mapKeys=new Set(route.mapNodes?.map(item=>item.key));if(route.mapNodes&&mapKeys.size!==route.mapNodes.length)ctx.addIssue({code:'custom',path:['mapNodes'],message:'全书地图节点编号不能重复'});route.mapNodes?.forEach((item,index)=>{item.connectsTo.forEach((key,referenceIndex)=>{if(!mapKeys.has(key))ctx.addIssue({code:'custom',path:['mapNodes',index,'connectsTo',referenceIndex],message:`全书地图引用了不存在的节点 ${JSON.stringify(key)}；必须逐字引用本次 mapNodes[].key，可用编号：${JSON.stringify([...mapKeys])}。不是节点标题、能力名称或单元标题。`});});});
  route.nearSteps?.forEach((step,index)=>{if(requiresUnavailableInput(step.objective+'\n'+step.completion))ctx.addIssue({code:'custom',path:['nearSteps',index],message:'本界面只支持文本、编号选择或数学式；将颜色、划线、口头或拖拽要求改为可直接输入的任务。'});if(disclosesExplicitAnswer(step.completion))ctx.addIssue({code:'custom',path:['nearSteps',index,'completion'],message:'completion只能描述可观察标准，不能预告具体数值答案或正确选项。'});});
  if(beginner){
   const first=route.nearSteps?.[0];
   if(!first)return;
   if(first.objective.length>140)ctx.addIssue({code:'custom',path:['nearSteps',0,'objective'],message:'主题陌生的首步只留一个可着手动作，objective不能超过140字符。'});
   if(/至少\s*(?:两|二|2|三|3|多)(?:个|种|组|条)?(?:例子|案例|示例)/.test(first.objective+'\n'+first.completion))ctx.addIssue({code:'custom',path:['nearSteps',0],message:'主题陌生的首步不能要求多个例子；依据具体先修背景，选择短解释、示范或一个局部判断。'});
  }
 });
}
export const routeSchema=routeSchemaFor();
export const helpSchema=z.object({text:text.min(1),sourceIds:z.array(id).default([]),scope:supportScopeSchema.optional()});
export function helpSchemaFor(allowedSourceIds?:string[]){return helpSchema.extend({sourceIds:generatedSourceIds(allowedSourceIds).default([])});}
const outputLimitSchema=z.number({error:MODEL_OUTPUT_LIMIT_MESSAGE}).int({error:MODEL_OUTPUT_LIMIT_MESSAGE}).min(MIN_MODEL_OUTPUT_TOKENS,{error:MODEL_OUTPUT_LIMIT_MESSAGE}).max(MAX_MODEL_OUTPUT_TOKENS,{error:MODEL_OUTPUT_LIMIT_MESSAGE});
export const modelProfileSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),name:z.string().trim().min(1).max(120),providerName:z.string().trim().min(1).max(200),baseUrl:z.string().trim().min(1).max(2000),model:z.string().trim().min(1).max(150),maxOutputTokens:outputLimitSchema.default(DEFAULT_MODEL_OUTPUT_TOKENS),inputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),outputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),priceUpdatedAt:short,enabled:z.boolean()}).strict();
export const settingsInputSchema=z.object({providerName:short.optional(),baseUrl:z.string().max(2000).optional(),model:z.string().min(1).max(150).optional(),maxOutputTokens:outputLimitSchema.optional(),monthlyBudgetCny:z.number().finite().min(0).max(100000).optional(),inputPriceCnyPerMillion:z.number().finite().min(.01).max(100000).optional(),outputPriceCnyPerMillion:z.number().finite().min(.01).max(100000).optional(),priceUpdatedAt:short.optional(),personalGoal:text.optional(),studyMinutes:z.number().int().min(5).max(240).optional(),confirmedPreferences:text.optional(),modelProfiles:z.array(modelProfileSchema).max(20).optional(),activeModelProfileId:id.optional()}).strict();
