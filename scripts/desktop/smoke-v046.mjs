// Focused 0.4.6 desktop regression. No private data, real model, or broad PDF suite.
import {_electron as electron} from 'playwright';
import {navigateDesktop,openDeskTools,closeDeskTools,selectSettingsTab} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=process.cwd(),stamp=Date.now().toString();
const executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
if(executable)assert.ok(existsSync(executable),'Packaged executable must exist');
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v046');
const reportName=process.env.RECLIMB_TEST_REPORT_NAME?.trim()||'desktop-verification-v046.json';
const dataDirectory=resolve('.test-data/desktop-v046-'+stamp);
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
const results=[],calls=[],externalRequests=[],stderr=[],rendererErrors=[];
let app,page,failHelp=false,failFollowup=false,releaseFollowup;
const record=name=>{results.push(name);console.log('PASS '+name)};
const rows=Array.from({length:28},(_,i)=>`| 观测 ${String(i+1).padStart(2,'0')} | ${i*2+1} | 同一次实验的独立观测 |`).join('\n');
const originalTask='以下是本地原创观测资料。请从数值列找出最大值，并说明如何检查所有行。\n\n| 编号 | 数值 | 记录说明 |\n| --- | --- | --- |\n'+rows;
assert.ok(originalTask.length>500&&originalTask.length<2400);
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),payload=JSON.parse(body.messages.find(message=>message.role==='user').content);
  const input={...(payload.original??payload)};for(const message of body.messages.filter(m=>m.role==='user').slice(1)){const part=JSON.parse(message.content);if(part.anchor){input.anchor=part.anchor;input.question=part.question;}}if(input.operation==='discuss_followup'&&!input.thread)input.thread=body.messages.slice(2,-1);const sourceIds=(input.sources??[]).slice(0,1).map(source=>source.id);
  calls.push(input);
  if(input.kind==='confused'&&failHelp){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'local support test failure'}}));return;}
  let result;
  if(input.operation==='review_teaching'){
   result={status:'ready',summary:'本地可控审查：只验证帮助流程与记录归属。',issues:[],privateSolution:'遍历给定列表并比较数值。',branches:[{id:'given-list',condition:'题中列表已经给出',applicability:'applies',criterionIndexes:input.teaching.activity.rubric.map((_,i)=>i),expectedBehavior:'能解释比较数值的方法'}],sourceChecks:[],mathChecks:[],exposureRelations:(input.exposures??[]).map(exposure=>({exposureId:exposure.id,relation:'different_task',reason:'本地模拟核验关系，用于验证接线'})),assessmentFindings:[]};
  }else if(input.operation==='discuss_followup'){
   assert.ok(input.anchor&&input.rootAnchor,'Follow-up must send its server-resolved target');
   if(input.question.includes('请等一下'))await new Promise(resolve=>{releaseFollowup=resolve;});
   if(failFollowup){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'local follow-up retry test'}}));return;}
   result={text:input.anchor.intent==='example'?'原创示范：比较三次记录 2、5、4，逐一保留较大值。你可以自己试试另一个列表。':'继续原内容：'+input.question+'。请说明这一步比较依据是什么，再返回教材核对。',sourceIds,scope:input.anchor.intent==='example'?'other_example':'concept'};
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
  res.writeHead(200,{'Content-Type':'application/json','x-request-id':'local-v046-'+calls.length});
  res.end(JSON.stringify({model:'local-support-mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:80,completion_tokens:90,...(input.operation==='discuss_followup'?{prompt_cache_hit_tokens:60,prompt_cache_miss_tokens:20}:{})}}));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snapshot=()=>api('workspace.snapshot');
const settle=async()=>{await page.waitForFunction(()=>!document.querySelector('[aria-label="下一次请求使用的模型配置"]')?.disabled);await page.waitForTimeout(80)};
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
async function saveQuestion(box,state='completed'){
 const existing=(await snapshot()).sessions.flatMap(session=>session.messages).filter(message=>message.role==='user').map(message=>message.id);
 await box.getByRole('button',{name:'保存并继续讨论',exact:true}).click();
 await page.waitForFunction(async({existing,state})=>{const s=await window.learning.request('workspace.snapshot');return s.sessions.flatMap(session=>session.messages).some(message=>message.role==='user'&&!existing.includes(message.id)&&message.responseState===state);},{existing,state});
 if(state==='completed')await settle();
}
const target=session=>({taskId:session.activity.id,stepId:session.teaching.current.id,version:session.teachingVersionId,upcoming:session.teaching.upcoming,draft:session.draft,checkpoint:session.checkpoint});
try{
 await launch();let s=await snapshot();assert.equal(s.projects.length,0);assert.equal(s.settings.hasApiKey,false);record('隔离空档案启动，未读取个人教材与密钥');
 const profile=s.settings.modelProfiles.find(item=>item.id===s.settings.activeModelProfileId),{hasApiKey:_,...editable}=profile;
 await api('settings.modelProfile.save',{profile:{...editable,providerName:'本地追问回归',baseUrl,model:'local-followup-mock',maxOutputTokens:6000,inputPriceCnyPerMillion:.1,outputPriceCnyPerMillion:.1,priceUpdatedAt:'本地模拟'},apiKey:'local-v046-only'});
 await api('settings.save',{settings:{monthlyBudgetCny:100}});
 s=await api('project.create',{title:'原创追问测试',goal:'理解并说明列表比较',startingPoint:{familiarity:'some',background:'理解自然数，希望对具体示范继续提问'}});
 const projectId=s.projects.find(project=>project.title==='原创追问测试').id;
 await api('material.importText',{projectId,title:'原创观测列表',text:'# 比较资料\n\n'+originalTask});
 await api('route.generate',{projectId});s=await api('lesson.start',{projectId});const sessionId=s.sessions.find(session=>session.projectId===projectId).id;
 await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await enterDesk();
 await page.getByRole('button',{name:'继续下一步',exact:true}).click();await settle();
 const session=async()=> (await snapshot()).sessions.find(item=>item.id===sessionId);
 const original=await session(),stepId=original.teaching.history[0].id;
 const draft='这是我仍在完成的主线推导，不应被历史追问覆盖。';
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(draft);
 const expected={...target(original),draft};
 await openDeskTools(page,'手写与已保存记录');await page.locator('.teaching-history > summary').click();
 const oldStep=page.locator('.teaching-history .followup-box[data-followup-id="'+stepId+'"]');
 assert.equal(await oldStep.getByRole('button',{name:'为这段举例',exact:true}).count(),1);record('已走过的解释提供举例和追问入口，当前主线仍可作答');
 await oldStep.getByRole('button',{name:'为这段举例',exact:true}).click();
 await saveQuestion(oldStep);
 let active=await session();let saved=active.messages.findLast(message=>message.role==='user'&&message.followup);
 assert.equal(saved.followup.id,stepId);assert.equal(saved.followup.intent,'example');assert.equal(saved.responseState,'completed');assert.deepEqual(target(active),expected);assert.equal((await snapshot()).evidence.length,0);
 const sameQuestion=saved.text,previousId=saved.inputId;
 await oldStep.getByRole('textbox',{name:'针对这段的追问'}).fill(sameQuestion);await saveQuestion(oldStep);
 active=await session();saved=active.messages.findLast(message=>message.role==='user'&&message.followup);assert.notEqual(saved.inputId,previousId);assert.equal(saved.text,sameQuestion);
 let response=active.messages.findLast(message=>message.role==='assistant'&&message.inputId===saved.inputId),firstInput=saved;
 assert.equal(calls.at(-1).operation,'discuss_followup');record('历史示范先保存再回应，绑定原步骤且不覆盖当前任务或草稿');
 const replyBox=page.locator('.input-record[data-input-id="'+saved.inputId+'"] .followup-box[data-followup-id="'+response.id+'"]');
 await replyBox.getByRole('button',{name:'继续追问',exact:true}).click();await replyBox.getByRole('textbox',{name:'针对这段的追问'}).fill('刚才示范为什么能保留较大值？');await saveQuestion(replyBox);
 active=await session();saved=active.messages.findLast(message=>message.role==='user'&&message.followup);assert.equal(saved.followup.parentMessageId,response.id);assert.equal(saved.followup.rootInputId,firstInput.inputId);assert.ok(JSON.stringify(calls.at(-1).thread).includes(firstInput.text));assert.deepEqual(target(active),expected);record('对已收到回应继续追问，带上父回应及同一支线的原问题');
 const fragment=(await snapshot()).fragments.find(item=>item.projectId===projectId),sourceBox=page.locator('.reader-panel .followup-box[data-followup-id="'+fragment.id+'"]');
 await sourceBox.getByRole('button',{name:'从这段原文提问',exact:true}).click();await sourceBox.getByRole('textbox',{name:'针对这段的追问'}).fill('教材这一段在解决什么问题？');await saveQuestion(sourceBox);
 active=await session();saved=active.messages.findLast(message=>message.role==='user'&&message.followup);assert.equal(saved.followup.kind,'source');assert.equal(saved.followup.id,fragment.id);assert.ok(calls.at(-1).sources.some(source=>source.id===fragment.id));assert.deepEqual(target(active),expected);record('从当前材料段落提问，服务端绑定真实原文与来源');
 await sourceBox.getByRole('textbox',{name:'针对这段的追问'}).fill('请等一下，我想先讨论这个原文概念');await saveQuestion(sourceBox,'running');
 for(let i=0;i<100&&!releaseFollowup;i++)await page.waitForTimeout(20);
 assert.ok(releaseFollowup);const beforePending=calls.length;
 await sourceBox.getByRole('textbox',{name:'针对这段的追问'}).fill('AI 忙时也留下这条原文问题');await saveQuestion(sourceBox,'pending');
 active=await session();const pending=active.messages.findLast(message=>message.role==='user'&&message.text==='AI 忙时也留下这条原文问题');assert.ok(pending);assert.equal(pending.responseState,'pending');assert.equal(calls.length,beforePending);releaseFollowup();releaseFollowup=undefined;await settle();assert.equal(calls.length,beforePending);record('AI 忙时追问仍可保存，待回应记录不会自动排队计费');
 failFollowup=true;const pendingCard=page.locator('.input-record[data-input-id="'+pending.inputId+'"]');await pendingCard.getByRole('button',{name:'获取这条记录的回应',exact:true}).click();await settle();assert.equal((await session()).messages.find(message=>message.inputId===pending.inputId&&message.role==='user').responseState,'failed');
 failFollowup=false;await pendingCard.getByRole('button',{name:'重试这次回应',exact:true}).click();await settle();active=await session();assert.equal(active.messages.filter(message=>message.inputId===pending.inputId&&message.role==='user').length,1);assert.equal(active.messages.filter(message=>message.inputId===pending.inputId&&message.role==='assistant').length,1);record('失败回应可原记录重试，不重复问题或能力证据');
 await close();await launch();await enterDesk();active=await session();assert.deepEqual(target(active),expected);assert.ok(active.messages.some(message=>message.followup?.parentMessageId===response.id));
 await openDeskTools(page);const resumed=page.locator('.input-record[data-input-id="'+pending.inputId+'"] .followup-box');await resumed.getByRole('button',{name:'继续追问',exact:true}).click();await resumed.getByRole('textbox',{name:'针对这段的追问'}).fill('重新打开后继续刚才的原文问题');await saveQuestion(resumed);assert.equal(calls.at(-1).rootAnchor.kind,'source');record('重启保留追问关联，并能沿教材支线继续对话');
 await page.locator('.textbook-guide > summary').click();assert.ok(await page.getByText('先读一小段原文。',{exact:true}).isVisible());assert.ok(await page.getByText('合上解释再试。',{exact:true}).isVisible());record('教材旁可查看阅读、尝试、求助和独立回访的使用方法');
 await page.locator('.input-record').first().screenshot({path:join(artifacts,'followup-record.png')});await page.locator('.reader-panel').screenshot({path:join(artifacts,'textbook-reading.png')});
 s=await snapshot();const measured=s.usage.filter(item=>item.cacheHitTokens!==undefined);assert.ok(measured.length>=5);assert.ok(measured.every(item=>item.cacheHitTokens===60&&item.cacheMissTokens===20&&item.durationMs>=0));assert.ok(s.usage.some(item=>item.status==='completed'&&item.cacheHitTokens===undefined));
 await closeDeskTools(page);await navigateDesktop(page,'设置',{settingsTab:'AI 与费用'});await settle();assert.ok(await page.locator('.cache-usage').isVisible());assert.ok((await page.locator('.cache-usage').innerText()).includes('75'));record('设置展示服务商报告的缓存样本和耗时，未知历史不当成零命中');
 assert.deepEqual(target(await session()),expected);assert.equal((await snapshot()).evidence.length,0);record('整个追问流程保留主线位置和长草稿，不生成掌握记录');
 await page.screenshot({path:join(artifacts,'context-followups.png'),fullPage:true});await close();assert.deepEqual(rendererErrors,[]);assert.deepEqual(externalRequests,[]);record('桌面无渲染异常，全部模型请求仅访问本机模拟服务');
 const report={at:new Date().toISOString(),executable:executable||'development-electron',passed:results.length,results,localMockRequests:calls.length,externalRequests,stderr,network:'仅127.0.0.1模拟服务，无真实AI调用或个人数据',limitations:['仅验证本次锚定追问与缓存报告及相邻保存流程，不是全量验收。','模拟缓存数据只检验统计接线，不证明真实命中率或教学有效性。'],artifacts};
 writeFileSync(join(artifacts,reportName),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:results.length,localMockRequests:calls.length,artifacts},null,2));
}catch(error){
 writeFileSync(join(artifacts,'failure-report.json'),JSON.stringify({at:new Date().toISOString(),passed:results,externalRequests,stderr,error:String(error)},null,2));
 if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
 if(app)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});app=undefined;throw error;
}finally{releaseFollowup?.();await close().catch(()=>{});await new Promise(done=>server.close(done));}
