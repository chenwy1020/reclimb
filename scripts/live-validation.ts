import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync,realpathSync,linkSync,unlinkSync} from 'node:fs';
import {resolve,dirname,isAbsolute,relative,basename,extname} from 'node:path';
import {z} from 'zod';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {VerificationService} from '../src/main/verification-service';
import {CallRunner} from '../src/main/call-runner';
import type {Session} from '../src/shared/types';

// This harness never discovers the installed app, user projects or credentials.
// Both the fixture and all paths must be selected explicitly by the operator.
const configSchema=z.object({providerName:z.string().min(1).max(80),baseUrl:z.url(),model:z.string().min(1).max(250),apiKeyEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),inputPriceCnyPerMillion:z.number().finite().positive(),outputPriceCnyPerMillion:z.number().finite().positive(),priceUpdatedAt:z.string().min(1).max(160)}).strict();
const fixtureSchema=z.object({authorship:z.literal('original'),case:z.literal('uncertain-discussion'),activity:z.object({title:z.string().min(1).max(120),instruction:z.string().min(1).max(12000),rubric:z.array(z.string().min(1).max(500)).min(1).max(4)}).strict(),input:z.object({kind:z.enum(['attempt','explore','note']),text:z.string().min(1).max(10000)}).strict()}).strict();
export interface LiveValidationOptions {workspace:string;config:string;fixture:string;report:string;cap:number;execute:boolean;}
export function parseLiveValidationArgs(args:string[]):LiveValidationOptions {
 const values=new Map<string,string>();let execute=false;
 for(let i=0;i<args.length;i++){const name=args[i];if(name==='--execute'){if(execute)throw new Error('重复的 execute 参数。');execute=true;continue;}if(!['--workspace','--config','--fixture','--report','--cap'].includes(name)||values.has(name)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('必须明确传入 workspace、config、fixture、report、cap；只有 --execute 才发送请求。');values.set(name,args[++i]);}
 for(const name of ['--workspace','--config','--fixture','--report','--cap'])if(!values.has(name))throw new Error('缺少明确参数：'+name);
 const cap=Number(values.get('--cap'));if(!Number.isFinite(cap)||cap<=0||cap>3)throw new Error('cap 必须大于 0 且不超过 3 元。');
 const paths=Object.fromEntries(['workspace','config','fixture','report'].map(name=>{const path=values.get('--'+name)!;if(!isAbsolute(path))throw new Error(name+' 必须是明确的绝对路径。');return [name,resolve(path)];}));
 if(new Set(Object.values(paths)).size!==4)throw new Error('账本、配置、案例和报告必须使用不同路径。');
 const options={...paths,cap,execute} as LiveValidationOptions;assertLiveValidationPaths(options);return options;
}
const totalSpend=(store:LearningStore)=>store.list('usage').filter(row=>row.status!=='failed').reduce((sum,row)=>sum+row.estimatedCny,0);
const contained=(parent:string,path:string)=>{const rel=relative(parent,path);return !rel||(!rel.startsWith('..')&&!isAbsolute(rel));};
function canonicalPath(path:string):string {
 let existing=resolve(path);const remaining:string[]=[];
 while(!existsSync(existing)){const parent=dirname(existing);if(parent===existing)break;remaining.unshift(basename(existing));existing=parent;}
 const canonical=resolve(realpathSync.native(existing),...remaining);return process.platform==='win32'?canonical.replace(/[ .]+(?=[\\/]|$)/g,'').toLowerCase():canonical;
}
export function assertLiveValidationPaths(options:LiveValidationOptions):void {
 for(const path of [options.workspace,options.config,options.fixture,options.report])if(!isAbsolute(path))throw new Error('验证路径必须是明确绝对路径。');
 const workspace=canonicalPath(options.workspace),config=canonicalPath(options.config),fixture=canonicalPath(options.fixture),report=canonicalPath(options.report);
 if(new Set([workspace,config,fixture,report]).size!==4)throw new Error('报告、配置、案例和账本路径不能重合或互为路径别名。');
 if(extname(options.report).toLowerCase()!=='.json')throw new Error('报告只能写入新的 .json 文件。');
 if(contained(workspace,report))throw new Error('报告必须放在学习账本目录之外。');
 if(existsSync(options.report))throw new Error('报告文件已存在，请指定新的报告文件；不会覆盖原文件。');
 if(process.env.APPDATA){const installed=canonicalPath(resolve(process.env.APPDATA,'重登'));if(contained(installed,workspace)||contained(installed,report))throw new Error('验证账本和报告不能使用已安装应用的用户档案目录。');}
 if(contained(workspace,config))throw new Error('服务配置必须放在测试账本目录之外。');
}
function readSmallJson(file:string):unknown {const bytes=readFileSync(file);if(bytes.byteLength>100000)throw new Error('配置或案例超过 100 KB，不读取大型项目材料。');return JSON.parse(bytes.toString('utf8'));}
export function writeValidationReport(file:string,value:unknown):void {
 mkdirSync(dirname(file),{recursive:true});const temporary=file+'.partial-'+randomUUID();
 writeFileSync(temporary,JSON.stringify(value,null,2),{encoding:'utf8',flag:'wx'});
 try {linkSync(temporary,file);}finally{unlinkSync(temporary);}
}
export async function runLiveValidation(options:LiveValidationOptions):Promise<Record<string,unknown>> {
 assertLiveValidationPaths(options);
 if(!Number.isFinite(options.cap)||options.cap<=0||options.cap>3)throw new Error('cap 必须大于 0 且不超过 3 元。');
 const config=configSchema.parse(readSmallJson(options.config)),fixture=fixtureSchema.parse(readSmallJson(options.fixture)),url=new URL(config.baseUrl);
 if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不能包含凭据、查询参数或片段。');
 // An explicit path still must not be the installed user's learning archive.
 if(process.env.APPDATA&&contained(resolve(process.env.APPDATA,'重登'),options.workspace))throw new Error('验证账本不能使用已安装应用的用户档案。');
 if(contained(options.workspace,options.config))throw new Error('服务配置必须放在测试账本目录之外。');
 const plan={execute:options.execute,case:fixture.case,providerName:config.providerName,model:config.model,capCny:options.cap,fixtureHash:createHash('sha256').update(JSON.stringify(fixture)).digest('hex')};
 if(!options.execute)return {...plan,status:'dry_run',message:'只检查了显式配置和自编案例；未读取密钥、未打开账本、未调用 AI。'};
 const key=process.env[config.apiKeyEnv];if(!key)throw new Error('指定的密钥环境变量为空。');
 let store:LearningStore|undefined;
 try {
  store=await LearningStore.open(options.workspace);store.updateSettings({personalGoal:'',confirmedPreferences:'',providerName:config.providerName,baseUrl:config.baseUrl,model:config.model,monthlyBudgetCny:options.cap,inputPriceCnyPerMillion:config.inputPriceCnyPerMillion,outputPriceCnyPerMillion:config.outputPriceCnyPerMillion,priceUpdatedAt:config.priceUpdatedAt});
  const runner=new CallRunner(store,()=>key,undefined,options.cap),usedBefore=totalSpend(store),reservation=runner.estimateCost(JSON.stringify(fixture).length*5+20000,6000);
  if(usedBefore+reservation>options.cap)throw new Error('累计用量加本次保守预留将超过指定上限，未发送请求。');
  const now=new Date().toISOString(),projectId='live-input-'+randomUUID(),capabilityId=randomUUID(),sessionId=randomUUID(),taskId=randomUUID(),stepId=randomUUID();
  const verifier=new VerificationService(store,runner),activity={id:taskId,title:fixture.activity.title,instruction:fixture.activity.instruction,rubric:fixture.activity.rubric,kind:'application' as const,sourceIds:[],assessmentBasis:'ai' as const};
  store.put('projects',{id:projectId,title:'显式自编输入验证',goal:'核对待核验时保存并探讨的行为',status:'active',createdAt:now,updatedAt:now});store.put('capabilities',{id:capabilityId,projectId,title:'自编案例',description:'本工具不确认教学效果',prerequisites:[],sourceIds:[],order:0});
  const version=verifier.createVersion({projectId,capabilityId,activity,steps:[{id:stepId,taskId,action:'attempt',title:activity.title,content:activity.instruction,activity,sourceIds:[],createdAt:now}],sources:[]});
  store.put('taskReviews',{id:randomUUID(),projectId,teachingVersionId:version.id,contentHash:version.contentHash,status:'uncertain',summary:'明确构造的待核验状态；不代表模型已核验此题。',issues:[],privateSolution:'',branches:[],exposureRelations:[],localChecks:[],createdAt:now,reviewerModel:'local-fixture'});
  const session:Session={id:sessionId,projectId,capabilityId,activity:version.activity,teachingVersionId:version.id,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'等待记录',nextStep:'保存并继续探讨',teaching:{version:1,current:version.steps[0],upcoming:[],history:[],guidance:'guided',confusionCount:0}};store.put('sessions',session);
  const service=new LearningService(store,()=>key,undefined,options.cap),receipt=service.recordInput(sessionId,{requestId:randomUUID(),kind:fixture.input.kind,text:fixture.input.text,taskId,stepId,teachingVersionId:version.id});
  let responseError:string|undefined;try{await service.respondInput(sessionId,receipt.inputId);}catch(error){responseError=(error instanceof Error?error.message:'回应失败').split(key).join('[redacted]');}
  const updated=store.get('sessions',sessionId)!,input=updated.messages.find(message=>message.role==='user'&&message.inputId===receipt.inputId)!,response=updated.messages.find(message=>message.role==='assistant'&&message.inputId===receipt.inputId),evidenceCount=store.list('evidence',projectId).length;
  const report={...plan,validationScope:'仅核对保存、讨论和不产生能力证据，不证明数学正确或教学有效。',status:input.responseState==='completed'&&input.responseMode==='discussion'&&evidenceCount===0?'passed':'needs_attention',sessionId,inputId:receipt.inputId,taskHash:version.contentHash,responseMode:input.responseMode,responseState:input.responseState,savedAt:receipt.savedAt,inputPreserved:input.text===fixture.input.text,evidenceCount,response:response?{kind:response.kind,text:response.text.split(key).join('[redacted]')}:undefined,responseError,usedBeforeCny:usedBefore,preflightReservationCny:reservation,usedAfterCny:totalSpend(store),requestCount:store.list('usage').filter(row=>row.kind==='继续探讨'&&Date.parse(row.createdAt)>=Date.parse(now)).length};
  assertLiveValidationPaths(options);writeValidationReport(options.report,report);return report;
 } finally {store?.close();}
}
export async function main(args:string[]):Promise<void> {
 const report=await runLiveValidation(parseLiveValidationArgs(args));
 // Console output is deliberately limited; no input, full project or key is printed.
 process.stdout.write(JSON.stringify({status:report.status,execute:report.execute,responseMode:report.responseMode,responseState:report.responseState,evidenceCount:report.evidenceCount,usedBeforeCny:report.usedBeforeCny,usedAfterCny:report.usedAfterCny})+'\n');
}
