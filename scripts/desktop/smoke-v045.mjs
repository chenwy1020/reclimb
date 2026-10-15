// Focused 0.4.5 desktop regression. No private data, real model, or broad PDF suite.
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {openDeskDetails,openDeskTools,closeDeskTools} from './desktop-navigation.mjs';

const require=createRequire(import.meta.url),root=process.cwd(),stamp=Date.now().toString();
const executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
if(executable)assert.ok(existsSync(executable),'Packaged executable must exist');
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v045');
const reportName=process.env.RECLIMB_TEST_REPORT_NAME?.trim()||'desktop-verification-v045.json';
const dataDirectory=resolve('.test-data/desktop-v045-'+stamp);
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
const results=[],calls=[],externalRequests=[],stderr=[],rendererErrors=[];
let app,page,failHelp=false;
const record=name=>{results.push(name);console.log('PASS '+name)};
const rows=Array.from({length:28},(_,i)=>`| 观测 ${String(i+1).padStart(2,'0')} | ${i*2+1} | 同一次实验的独立观测 |`).join('\n');
const originalTask='以下是本地原创观测资料。请从数值列找出最大值，并说明如何检查所有行。\n\n| 编号 | 数值 | 记录说明 |\n| --- | --- | --- |\n'+rows;
assert.ok(originalTask.length>500&&originalTask.length<2400);
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),payload=JSON.parse(body.messages.find(message=>message.role==='user').content);
  const input=payload.original??payload,sourceIds=(input.sources??[]).slice(0,1).map(source=>source.id);
  calls.push(input);
  if(input.kind==='confused'&&failHelp){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'local support test failure'}}));return;}
  let result;
  if(input.operation==='review_teaching'){
   result={status:'ready',summary:'本地可控审查：只验证帮助流程与记录归属。',issues:[],privateSolution:'遍历给定列表并比较数值。',branches:[{id:'given-list',condition:'题中列表已经给出',applicability:'applies',criterionIndexes:input.teaching.activity.rubric.map((_,i)=>i),expectedBehavior:'能解释比较数值的方法'}],sourceChecks:[],mathChecks:[],exposureRelations:(input.exposures??[]).map(exposure=>({exposureId:exposure.id,relation:'different_task',reason:'本地模拟核验关系，用于验证接线'})),assessmentFindings:[]};
  }else if(input.kind==='confused'){
   assert.ok(input.currentStep,'Support must receive the actual current step');
   assert.ok(input.confusionCount>=1,'Support must receive the successful same-step repetition count');
   result={text:input.confusionKind==='overload'?'本地节奏调整：先停在题目的第一句。可以稍后再读数据，原任务和草稿会继续保留。':input.confusionKind==='reason'?'本地换一种解释：比较像逐个挑战当前候选；先说明你不确定的是比较规则还是检查遗漏。':'本地术语解释：最大值是给定集合里不小于任何其他值的成员。这里只解释含义，没有替本题选出结果。',sourceIds,scope:input.confusionKind==='overload'?'navigation':'concept'};
  }else if(input.instruction?.includes('capabilities')){
   const titles=['理解观测与数值','比较候选值','说明比较依据'];
   result={summary:'本地原创列表材料：先理解对象，再比较数值与解释依据。',coreQuestion:'怎样从给定观测中形成可检查的比较？',mapNodes:[{key:'observe',title:'看清比较对象',question:'比较哪一列？',role:'建立对象',sourceIds,connectsTo:[]}],capabilities:titles.map((title,i)=>({title,description:'围绕原创列表完成一项比较操作。',sourceIds,prerequisites:i?[titles[i-1]]:[]})),units:[{capabilityTitle:titles[0],title:'从列表开始比较',coreQuestion:'如何避免遗漏观测？',purpose:'将比较操作讲清楚',expectedOutcome:'能说明如何逐项检查列表',phase:'survey',sourceIds,locators:['原创列表材料'],unresolvedGaps:[],prerequisiteTitles:[]},{capabilityTitle:titles[1],title:'检查比较方法',coreQuestion:'怎样说明方法的适用范围？',purpose:'将局部动作连接成方法',expectedOutcome:'能说明比较需要的前提',phase:'expand',sourceIds,locators:['原创列表材料'],unresolvedGaps:[],prerequisiteTitles:['从列表开始比较']}]};
  }else if(input.instruction?.includes('steps共')){
   const smaller=input.intent==='smaller';
   const activity={title:smaller?'用完整资料做一个局部比较':'检查列表中的比较对象',instruction:smaller?'局部练习：只比较以下资料中的前两行，其他行仅保留作上下文。\n\n'+originalTask:originalTask,kind:'selection',rubric:[smaller?'指出前两项的比较方法':'说明如何检查列表而不遗漏数值'],sourceIds,assessmentBasis:'source',demand:{kind:'compare',complexity:1,novelty:1,scaffolding:'guided',concepts:['观测列表','数值比较']},workSize:'short',milestones:[]};
   result={steps:[{action:'explain',title:smaller?'只做一个比较动作':'先看清比较对象',content:'一行代表一次观测，数值列是本次要比较的对象。',sourceIds},{action:'attempt',title:activity.title,content:'先留下你准备怎样比较的想法。',sourceIds,activity}]};
  }else throw new Error('Unexpected operation in focused support test');
  res.writeHead(200,{'Content-Type':'application/json','x-request-id':'local-v045-'+calls.length});
  res.end(JSON.stringify({model:'local-support-mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:80,completion_tokens:90}}));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snapshot=()=>api('workspace.snapshot');
const settle=async()=>{await page.locator('.working').waitFor({state:'hidden'});await page.waitForTimeout(80);await openDeskDetails(page)};
async function launch(){
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:dataDirectory,RECLIMB_DEV_URL:''},timeout:45000});
 app.process().stderr.on('data',data=>{if(/error/i.test(data.toString()))stderr.push(data.toString().slice(0,1600));});
 page=await app.firstWindow();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>rendererErrors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(baseUrl))externalRequests.push(request.url());});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
async function close(){if(app){await app.close();app=undefined;}}
async function enterDesk(){await page.getByRole('button',{name:'继续上次学习',exact:true}).first().click();await page.mouse.move(900,100);await settle();}
async function confused(label){await openDeskTools(page,'求助与追问');await page.getByRole('button',{name:'这里没跟上',exact:true}).click();await page.getByRole('button',{name:label,exact:false}).click();await settle();}
const target=session=>({taskId:session.activity.id,stepId:session.teaching.current.id,version:session.teachingVersionId,upcoming:session.teaching.upcoming,draft:session.draft,checkpoint:session.checkpoint});
try{
 await launch();let s=await snapshot();assert.equal(s.projects.length,0);assert.equal(s.settings.hasApiKey,false);record('隔离档案从空项目启动，未读取个人资料或真实密钥');
 const profile=s.settings.modelProfiles.find(item=>item.id===s.settings.activeModelProfileId),{hasApiKey:_,...editable}=profile;
 await api('settings.modelProfile.save',{profile:{...editable,providerName:'本地帮助回归',baseUrl,model:'local-support-mock',maxOutputTokens:6000,inputPriceCnyPerMillion:.1,outputPriceCnyPerMillion:.1,priceUpdatedAt:'本地模拟'},apiKey:'local-v045-only'});
 await api('settings.save',{settings:{monthlyBudgetCny:100}});
 s=await api('project.create',{title:'原创卡点帮助测试',goal:'理解并说明列表比较',startingPoint:{familiarity:'some',background:'理解自然数，只需明确比较过程'}});
 const projectId=s.projects.find(project=>project.title==='原创卡点帮助测试').id;
 await api('material.importText',{projectId,title:'原创观测列表',text:'# 比较资料\n\n'+originalTask});
 await api('route.generate',{projectId});s=await api('lesson.start',{projectId});const sessionId=s.sessions.find(session=>session.projectId===projectId).id;
 await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await enterDesk();
 await page.getByRole('button',{name:'继续下一步',exact:true}).click();await settle();
 const session=async()=> (await snapshot()).sessions.find(item=>item.id===sessionId);
 assert.ok((await session()).activity.instruction.length>500);assert.equal((await api('session.verification',{sessionId})).canAssess,true);record('用完整原创长题建立已核验活动，复现超过500字的输入场景');
 const draft='我想逐行检查数值，但还没弄懂“最大值”的确切含义。';
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(draft);
 const original=await session(),expected={...target(original),draft};const beforeHelpCalls=calls.length;
 await confused('这个术语是什么意思');let active=await session();assert.deepEqual(target(active),expected);assert.equal(calls.length,beforeHelpCalls+1);assert.equal(calls.at(-1).kind,'confused');assert.equal(calls.at(-1).learnerDraft,draft);assert.equal(calls.at(-1).confusionCount,1);assert.equal(active.helpEvents.at(-1).level,0);assert.equal(active.helpEvents.at(-1).scope,'concept');assert.ok(active.messages.some(message=>message.kind==='confused'&&message.text.includes('本地术语解释')));assert.equal((await snapshot()).evidence.length,0);record('第一次卡壳先保存草稿，只补原题术语，不生成新题或能力证据');
 const beforeNavigation=(await snapshot()).answerExposures.length;
 await confused('信息有点多，慢一点');active=await session();assert.deepEqual(target(active),expected);assert.equal(calls.at(-1).confusionKind,'overload');assert.equal(calls.at(-1).confusionCount,2);assert.equal(active.teaching.confusionCount,2);assert.equal(active.helpEvents.at(-1).scope,'navigation');assert.equal((await snapshot()).answerExposures.length,beforeNavigation);record('再次卡壳改为节奏支持，次数持续保存且导航不冒充答案帮助');
 failHelp=true;const beforeFailure=await session();await confused('我不明白为什么成立');active=await session();assert.deepEqual(target(active),expected);assert.equal(active.helpEvents.length,beforeFailure.helpEvents.length);assert.equal(active.teaching.confusionCount,2);assert.equal(await page.locator('.confusion-choices').count(),1);assert.ok(await page.getByRole('button',{name:'我不明白为什么成立',exact:false}).isEnabled());record('帮助调用失败保留原任务、草稿和成功计数，选择器保留重试入口');
 failHelp=false;await page.getByRole('button',{name:'我不明白为什么成立',exact:false}).click();await settle();active=await session();assert.deepEqual(target(active),expected);assert.equal(active.teaching.confusionCount,3);assert.equal(calls.at(-1).confusionCount,3);assert.equal(active.helpEvents.length,beforeFailure.helpEvents.length+1);assert.equal((await snapshot()).evidence.length,0);assert.equal(await page.locator('.confusion-choices').count(),0);record('原入口可以重试并获得不同解释，失败不重复写帮助或产生评价');
 await openDeskTools(page,'调整学习安排');await openDeskDetails(page);await page.getByRole('button',{name:'换一个更小的入口',exact:true}).click();await settle();active=await session();assert.notEqual(active.activity.id,expected.taskId);assert.ok(active.activity.instruction.length>500);assert.equal(active.teaching.returnStep.id,expected.stepId);assert.equal((await api('session.verification',{sessionId})).canAssess,true);const smaller=calls.findLast(input=>input.intent==='smaller');assert.equal(smaller.smallerLimits.maxInstruction,2400);record('主动换小任务仍保留完整长资料，减少操作负荷并经过核验');
 const beforeReturn=calls.length;await closeDeskTools(page);await page.getByRole('button',{name:'回到原来这一步',exact:true}).click();await settle();active=await session();assert.equal(active.activity.id,expected.taskId);assert.equal(active.teaching.current.id,expected.stepId);assert.equal(active.teachingVersionId,expected.version);assert.equal(active.draft,draft);assert.equal(calls.length,beforeReturn);assert.ok(await page.getByRole('button',{name:'提交这次尝试',exact:true}).isEnabled());record('可返回原学习任务和完整草稿，返回本身不调用模型');
 await close();await launch();await enterDesk();active=await session();assert.equal(active.activity.id,expected.taskId);assert.equal(active.teaching.current.id,expected.stepId);assert.equal(active.draft,draft);assert.equal(active.messages.filter(message=>message.role==='assistant'&&message.kind==='confused').length,3);assert.equal((await snapshot()).evidence.length,0);record('重启后原学习位置、草稿和三次成功帮助保持完整');
 await page.screenshot({path:join(artifacts,'stuck-support.png'),fullPage:true});await close();assert.deepEqual(rendererErrors,[]);assert.deepEqual(externalRequests,[]);record('桌面无渲染异常，全部模型请求只访问本机模拟服务');
 const report={at:new Date().toISOString(),executable:executable||'development-electron',passed:results.length,results,localMockRequests:calls.length,externalRequests,stderr,network:'仅127.0.0.1模拟服务，无真实AI调用或个人数据',limitations:['仅针对本次帮助流程和相邻缩步行为，不是全量功能验收。','模拟响应验证软件行为，不证明真实教学有效性或数学正确性。'],artifacts};
 writeFileSync(join(artifacts,reportName),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:results.length,localMockRequests:calls.length,artifacts},null,2));
}catch(error){
 writeFileSync(join(artifacts,'failure-report.json'),JSON.stringify({at:new Date().toISOString(),passed:results,externalRequests,stderr,error:String(error)},null,2));
 if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
 if(app)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});app=undefined;throw error;
}finally{await close().catch(()=>{});await new Promise(done=>server.close(done));}
