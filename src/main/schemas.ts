import {z} from 'zod';
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
export const activitySchema=z.object({id:id.optional(),teachingVersionId:id.optional(),rubricIds:z.array(id).max(12).optional(),transferCheck:transferCheckSchema.optional(),sourceVersions:z.array(z.object({fragmentId:id,transcriptionIds:z.array(id).max(100)})).max(30).optional(),title:short,instruction:text.min(1),kind:z.enum(['prediction','application','argument','reconstruction','diagnosis','selection']),rubric:z.array(short.min(1)).min(1).max(12),sourceIds:z.array(id).max(30),referenceAnswer:text.optional(),assessmentBasis:z.enum(['source','rule','ai'])});
export const generatedActivitySchema=activitySchema.omit({referenceAnswer:true,id:true,teachingVersionId:true,rubricIds:true,transferCheck:true,sourceVersions:true}).extend({instruction:z.string().min(1).max(2400).describe(taskInputDescription),rubric:z.array(short.min(1)).min(1).max(4)});
export const assessmentSchema=z.object({outcome:z.enum(['met','partial','not_yet','uncertain']),feedback:text,criteria:z.array(z.object({criterionId:id.optional(),criterion:short,result:z.enum(['met','partial','not_yet','uncertain','not_applicable']),reason:text})).min(1).max(12),limitations:z.array(short).max(20),sourceIds:z.array(id).max(30)});
export function assessmentSchemaFor(allowedSourceIds?:string[]){return assessmentSchema.extend({sourceIds:generatedSourceIds(allowedSourceIds,30)});}
export const startingPointSchema=z.object({familiarity:z.enum(['new','some','experienced']),background:text,updatedAt:short});
export const learningScopeSchema=z.object({suggestedFocus:short,reason:short,status:z.enum(['proposed','confirmed']),confirmedAt:short.optional()});
export const nearStepSchema=z.object({id,capabilityId:id,title:short,objective:short,reason:short,sourceIds:z.array(id).max(30),completion:short.optional(),prerequisites:z.array(short).max(12).optional()});
const action=z.enum(['explain','demonstrate','attempt','feedback','check','reflect']);
export const teachingStepSchema=z.object({id,taskId:id,action,title:short,content:text,sourceIds:z.array(id).max(30),activity:activitySchema.optional(),createdAt:short});
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
export function routeSchemaFor(beginner=false,allowedSourceIds?:string[]) {
 const near=z.object({capabilityTitle:z.string().min(1).max(80),title:z.string().min(1).max(80),objective:z.string().min(1).max(360).describe('只预览一个具体行动目标，不写练习题、题目数值、选项、已解示范或答案；实际题目在开始活动时生成。对主题陌生不等于先修陌生；已有相关背景可从一个连接新旧概念的短判断开始，缺少基础才先讲解。主题陌生的首步不超过140字符，不合并多构件、多例子和理由说明。'),reason:z.string().min(1).max(220).describe('解释本步与用户具体背景、主题缺口的关系；不能仅因主题陌生忽略已陈述先修。'),completion:z.string().min(1).max(220).describe('仅描述方法层面的可观察动作，不预先求值、展示练习解答或透露其他步骤的答案；不额外添加任务。区分证据支持与主张真假。'),prerequisites:z.array(z.string().max(80)).max(5),sourceIds:generatedSourceIds(allowedSourceIds,3).default([])});
 return z.object({summary:z.string().max(700),capabilities:z.array(z.object({title:z.string().min(1).max(80),description:z.string().max(300),prerequisites:z.array(z.string().max(80)).max(5).default([]),sourceIds:generatedSourceIds(allowedSourceIds,3).default([])})).min(3).max(6),nearSteps:z.array(near).min(2).max(4),scopeProposal:z.object({suggestedFocus:z.string().min(1).max(220),reason:z.string().min(1).max(220)}).optional()}).superRefine((route,ctx)=>{
  route.nearSteps.forEach((step,index)=>{if(requiresUnavailableInput(step.objective+'\n'+step.completion))ctx.addIssue({code:'custom',path:['nearSteps',index],message:'本界面只支持文本、编号选择或数学式；将颜色、划线、口头或拖拽要求改为可直接输入的任务。'});if(disclosesExplicitAnswer(step.completion))ctx.addIssue({code:'custom',path:['nearSteps',index,'completion'],message:'completion只能描述可观察标准，不能预告具体数值答案或正确选项。'});});
  if(beginner){
   const first=route.nearSteps[0];
   if(first.objective.length>140)ctx.addIssue({code:'custom',path:['nearSteps',0,'objective'],message:'主题陌生的首步只留一个可着手动作，objective不能超过140字符。'});
   if(/至少\s*(?:两|二|2|三|3|多)(?:个|种|组|条)?(?:例子|案例|示例)/.test(first.objective+'\n'+first.completion))ctx.addIssue({code:'custom',path:['nearSteps',0],message:'主题陌生的首步不能要求多个例子；依据具体先修背景，选择短解释、示范或一个局部判断。'});
  }
 });
}
export const routeSchema=routeSchemaFor();
export const helpSchema=z.object({text:text.min(1),sourceIds:z.array(id).default([]),scope:supportScopeSchema.optional()});
export function helpSchemaFor(allowedSourceIds?:string[]){return helpSchema.extend({sourceIds:generatedSourceIds(allowedSourceIds).default([])});}
export const settingsInputSchema=z.object({providerName:short.optional(),baseUrl:z.string().max(2000).optional(),model:z.string().min(1).max(150).optional(),monthlyBudgetCny:z.number().finite().min(0).max(100000).optional(),inputPriceCnyPerMillion:z.number().finite().min(.01).max(100000).optional(),outputPriceCnyPerMillion:z.number().finite().min(.01).max(100000).optional(),priceUpdatedAt:short.optional(),personalGoal:text.optional(),studyMinutes:z.number().int().min(5).max(240).optional(),confirmedPreferences:text.optional()}).strict();
