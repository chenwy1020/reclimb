import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),AdmZip=require('adm-zip');
const root=process.cwd(),stamp=Date.now().toString();
const packagedExecutable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
if(packagedExecutable)assert.ok(existsSync(packagedExecutable),'RECLIMB_TEST_EXECUTABLE must point to an existing packaged application');
const artifactDir=resolve('output/playwright/v02'),dataDir=resolve('.test-data/desktop-v02-'+stamp);
const realPdf=process.env.RECLIMB_TEST_PDF?.trim();
if(!realPdf||!existsSync(realPdf))throw new Error('请将 RECLIMB_TEST_PDF 设为一份经授权的本机 Rabinowitz PDF 完整路径（至少 13 页）。测试不会使用私人默认路径。');
mkdirSync(artifactDir,{recursive:true});mkdirSync(dataDir,{recursive:true});
const results=[],errors=[],externalRequests=[],calls=[];let app,page,requests=0,malformedRemaining=0,failTransport=false;
const record=name=>{results.push(name);console.log('PASS '+name)};
const server=createServer(async(req,res)=>{
 try{
 let raw='';for await(const chunk of req)raw+=chunk;
 requests++;const body=JSON.parse(raw),message=body.messages.find(m=>m.role==='user').content;
 const parsed=JSON.parse(Array.isArray(message)?message.find(x=>x.type==='text').text:message),u=parsed.original||parsed;
 const sourceIds=(u.sources||[]).slice(0,1).map(x=>x.id);
 calls.push({number:requests,intent:u.intent,kind:u.kind,repair:!!parsed.original,vision:Array.isArray(message),model:body.model});
 if(failTransport){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return}
 if(malformedRemaining>0){malformedRemaining--;res.writeHead(200,{'Content-Type':'application/json','x-request-id':'local-broken-'+requests});res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"steps":['}}],usage:{prompt_tokens:90,completion_tokens:40}}));return}
 let value;
 const activity=(small=false,independent=false)=>({title:small?'辨认泛函的输入':independent?'新情境中的局部比较':'比较两条路径的最高能量',instruction:small?'本地自动化样例 '+requests+'：泛函 $J:E\\to\\mathbb{R}$ 的输入是什么？只说清这个对象即可。':independent?'本地自动化新题 '+requests+'：两条新路径的最高能量分别为 $7$ 和 $9$。选择给出更小上界的路径并解释比较对象。':'本地自动化样例 '+requests+'：两条路径上的最高能量分别为 $3$ 和 $5$。哪条提供较小上界？请说明比较的是哪个量。',kind:'selection',rubric:small?['指出输入是函数或状态']:['识别每条路径的最高能量','比较两个最高值并说明理由'],sourceIds,assessmentBasis:sourceIds.length?'source':'ai'});
 if(Array.isArray(message)){
  assert.ok(message.some(x=>x.type==='image_url'&&x.image_url.url.startsWith('data:image/png;base64,')));
  value={text:'# 本地模拟转录（用于自动化验证）\n\n原页识别的版本流程：\n\n$$\nc=\\inf_{g\\in\\Gamma}\\max_{t\\in[0,1]}I(g(t)).\n$$\n\n这里是本地测试服务返回的候选文字，并非对真实原页的可靠识别。',uncertainties:['模拟结果必须与原页核对；本次不验证 OCR 准确性。']};
 }else if(u.instruction?.includes('只返回JSON'))value={ok:true};
 else if(u.instruction?.includes('capabilities')){
  const cap='理解路径上的最高能量';
  value={summary:'本地自动化样例：长期方向仍是临界点理论，先建立泛函与路径能量的直观。',capabilities:[{title:cap,description:'比较 $\\max_t I(g(t))$ 与路径之间的选择。',prerequisites:[],sourceIds},{title:'理解路径连接的两个状态',description:'说清路径输入、输出与端点条件。',prerequisites:[],sourceIds},{title:'区分假设与待证明的结论',description:'依据材料指出已经给定的条件与仍需论证的结论。',prerequisites:[],sourceIds}],nearSteps:[{capabilityTitle:cap,title:'先分清泛函的输入和输出',objective:'用一句话说明 $J:E\\to\\mathbb{R}$ 将什么对应到什么。',completion:'指出输入是状态、输出是实数即可继续。',prerequisites:[],reason:'先看清讨论的对象，再进入路径比较。',sourceIds},{capabilityTitle:cap,title:'沿一条路径看最高能量',objective:'从一组能量数值中指出最高值。',completion:'能指出比较对象，而不是猜符号意义。',prerequisites:['知道泛函输出是实数'],reason:'这是理解路径比较所需要的局部动作。',sourceIds}],scopeProposal:{suggestedFocus:'先把泛函与路径的能量对应说清楚',reason:'从陌生起点进入，不直接要求证明临界点存在。'}};
 }else if(u.instruction?.includes('steps共')){
  const independent=u.intent==='independent'||['delayed','transfer'].includes(u.mode),small=u.intent==='smaller';
  const task=activity(small,independent);
  value={steps:independent?[{action:'check',title:'独立处理一个新局部',content:'这次先用自己的理解判断。',sourceIds,activity:task}]:[{action:'explain',title:small?'先把这一小处放慢':'从泛函到一个实数',content:small?'本地自动化缩小示例 '+requests+'：暂时只看一个状态及其能量。**输入**是状态，**输出**是一个数。\n\n$$J:E\\to\\mathbb{R}$$':'本地自动化教学示例。泛函把一个函数或状态对应到一个实数。\\n\\n这里验证模型的字面换行，数学符号 $\\nu+\\nabla u$ 保留。\n\n$$J:E\\to\\mathbb{R}$$\n\n| 对象 | 在这里的意思 |\n| --- | --- |\n| $u\\in E$ | 一个状态 |\n| $J(u)$ | 这个状态的能量 |\n\n代码里的符号应保留：\n'+String.fromCharCode(96).repeat(3)+'text\n'+String.raw`\(\text{code stays literal}\)`+'\n'+String.fromCharCode(96).repeat(3),sourceIds},...(small?[]:[{action:'demonstrate',title:'先看另一个例子如何比较',content:'本地自动化示范：两条示例路径的最高能量分别为 $2$ 和 $4$。先看每条路径的高点，再比较两个高点。这里没有提供稍后那道任务的答案。',sourceIds}]),{action:'attempt',title:small?'只辨认这一个对应':'现在试一个自己的判断',content:'只处理眼前这一个局部。',sourceIds,activity:task}]};
 }else if('answer' in u){
  value={outcome:'met',feedback:'本地自动化评价：这次明确比较了两个最高值。$\\max_t J(g(t))$ 是比较对象。此响应仅用于验证接口和证据归因。',criteria:u.activity.rubric.map(criterion=>({criterion,result:'met',reason:'本地模拟按标准返回；不证明真实学习效果。'})),limitations:['自动化模拟评价，不是实际模型的教学效果验收。'],sourceIds};
 }else if(u.instruction?.includes('核对新旧任务'))value={changedSituation:'模拟中的具体情境变化',sharedPrinciple:'比较同一能量原理',requiredAdaptation:'重建新情境的输入',verdict:'valid',reason:'仅用于自动化测试迁移核对接口'};
 else value={text:u.kind==='explore'?'本地探索回应：先核对“路径”的含义，再回到原来的判断。\n\n$g:[0,1]\\to E$\n\n这个解释只提供背景，不替当前题作答。':u.kind==='answer'?'本地完整示范：先分别求每条路径的最高能量，再比较这些值。这段支持需要归到当前任务。':'本地提示：先指出每条路径对应的最高能量。',sourceIds,scope:u.kind==='explore'?'concept':u.kind==='example'?'other_example':'current_task'};
 res.writeHead(200,{'Content-Type':'application/json','x-request-id':'local-v02-'+requests});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:80}}));
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e)}))}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
const fakeKey='local-test-only-'+stamp;
async function launch(directory=dataDir){
 app=await electron.launch({executablePath:packagedExecutable||require('electron'),args:packagedExecutable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:directory,RECLIMB_DEV_URL:''},timeout:45000});
 app.process().stderr.on('data',data=>{const text=data.toString();if(/Error|error/i.test(text))errors.push(text.slice(0,1600))});
 page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(baseUrl))externalRequests.push(req.url())});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snap=()=>api('workspace.snapshot');
const settle=()=>page.locator('.working').waitFor({state:'hidden'});
async function screenshot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(artifactDir,name+'.png'),fullPage:!(await page.getByRole('dialog').count())})}
async function reload(){await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor()}
async function nav(name){await page.locator('.nav-item').filter({hasText:name}).click();await settle()}
async function close(){if(app){await app.close();app=undefined}}
async function waitSnapshot(predicate,label){for(let i=0;i<100;i++){const s=await snap();if(predicate(s))return s;await page.waitForTimeout(100)}throw new Error('Timed out: '+label)}
function makePdf(){const text='BT /F1 14 Tf 20 220 Td (Printed page 4: original vector content) Tj ET';const parts=['<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St 4 >>] >> >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>','<< /Length '+text.length+' >>\nstream\n'+text+'\nendstream'];let doc='%PDF-1.4\n';const offsets=[0];parts.forEach((b,i)=>{offsets.push(Buffer.byteLength(doc));doc+=(i+1)+' 0 obj\n'+b+'\nendobj\n'});const xref=Buffer.byteLength(doc);doc+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer << /Size 5 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(doc)}
try{
 await launch();assert.equal((await snap()).projects.length,0);assert.equal((await snap()).settings.hasApiKey,false);record('独立测试目录从空档案启动，不读取用户密钥');
 await page.getByRole('button',{name:'先体验内置练习示例'}).click();await settle();let s=await snap();assert.equal(s.projects.length,2);assert.equal(s.evidence.length,0);record('旧格式内置项目仍可载入，无虚构能力记录');
 const legacyArchive=join(dataDir,'legacy-v1.reclimb');
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},legacyArchive);await api('backup.create');
 {const zip=new AdmZip(legacyArchive),manifest=JSON.parse(zip.readAsText('manifest.json'));manifest.version=1;delete manifest.records.sourceTranscriptions;delete manifest.records.settings.vision;zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));zip.writeZip(legacyArchive)}
 await page.getByRole('button',{name:'开启一段学习',exact:true}).click();
 await page.getByLabel('给这段学习起个名字',{exact:false}).fill('Rabinowitz 临界点理论 · 桌面验证');
 await page.getByLabel('我希望自己能独立做到…',{exact:false}).fill('理解泛函与路径最高能量，逐步进入山路定理；这是自动化本地测试项目。');
 await page.getByRole('radio',{name:'从未接触',exact:false}).check();
 await page.getByLabel('补充已有基础或当前困惑',{exact:false}).fill('从未学过这部分内容，希望先弄清对象和符号。');
 await page.getByRole('button',{name:'建立学习项目',exact:true}).click();await settle();
 s=await snap();const project=s.projects.find(p=>p.title.includes('Rabinowitz'));assert.equal(project.startingPoint.familiarity,'new');assert.ok(project.startingPoint.background.includes('从未学过'));record('通过真实表单原子保存长期目标与陌生起点');
 await page.getByRole('button',{name:'粘贴文字',exact:true}).click();
 await page.getByLabel('材料标题',{exact:true}).fill('路径与泛函的本地练习材料');
 await page.getByLabel('正文',{exact:true}).fill('# 本地测试材料\n\n泛函 $J:E\\to\\mathbb{R}$ 将状态映为实数。比较一条路径上的最高能量，再比较不同路径。\n\n$$c=\\inf_{g\\in\\Gamma}\\max_{t\\in[0,1]}J(g(t))$$');
 await page.getByRole('button',{name:'导入材料',exact:true}).click();await settle();record('Markdown 数学材料通过真实导入表单保存');
 await nav('设置');
 await page.getByLabel('服务名称',{exact:true}).fill('本地自动化模拟服务');
 await page.getByLabel('模型名称',{exact:true}).fill('local-teaching-mock');
 await page.getByLabel('接口地址',{exact:true}).fill(baseUrl);
 await page.getByLabel(/^API 密钥/).fill(fakeKey);
 await page.getByLabel('本机每月预算（元）',{exact:true}).fill('100');
 await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();await settle();
 await page.getByText('连接成功，模型已返回可验证的内容。',{exact:false}).waitFor();
 s=await snap();assert.equal(s.settings.hasApiKey,true);assert.ok(!JSON.stringify(s).includes(fakeKey));record('真实设置界面连接本地模拟服务，公开快照不暴露密钥');
 await page.locator('.project-nav').filter({hasText:'Rabinowitz'}).click();
 await page.getByRole('button',{name:'准备学习路线',exact:true}).click();await settle();
 await page.locator('.near-step').first().waitFor();s=await snap();let p=s.projects.find(p=>p.id===project.id);assert.equal(p.nearSteps.length,2);assert.equal(p.learningScope.status,'proposed');assert.equal(p.goal,project.goal);assert.ok(await page.locator('.near-step .katex').count());assert.ok((await page.locator('.near-step-completion').first().innerText()).includes('完成一个小尝试，说明依据；根据反馈决定继续或补一步。'));assert.ok(!(await page.locator('.near-steps').innerText()).includes('指出输入是状态、输出是实数即可继续。'));record('近期2步与长期地图分层呈现，数学公式正确排版');
 await page.getByRole('button',{name:'先从这里开始',exact:true}).click();await settle();assert.equal((await snap()).projects.find(p=>p.id===project.id).goal,project.goal);record('确认近期范围不改写长期目标');
 await screenshot('route-near-steps');
 await page.getByRole('button',{name:'开始这一小步',exact:true}).click();await settle();await page.getByRole('heading',{name:'从泛函到一个实数',exact:true}).first().waitFor();
 assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).count(),0);assert.ok(await page.locator('.guided-activity .katex').count());assert.ok(await page.locator('.guided-activity .markdown-table table').count());assert.ok((await page.locator('.guided-activity pre').innerText()).includes('\\('));const teachingText=await page.locator('.guided-activity').innerText();assert.ok(!teachingText.includes('\\n\\n'));assert.ok(await page.locator('.guided-activity .katex').filter({hasText:'ν'}).count());
 s=await snap();const sessionId=s.sessions.find(x=>x.projectId===project.id).id;const session=()=>snap().then(x=>x.sessions.find(y=>y.id===sessionId));assert.equal((await session()).teaching.current.action,'explain');record('陌生起点先解释，呈现公式和表格，不显示大作答框');
 await screenshot('guided-explanation');
 await page.getByRole('button',{name:'继续下一小步',exact:true}).click();await settle();assert.equal((await session()).teaching.current.action,'demonstrate');assert.equal((await snap()).evidence.length,0);record('讲解到示范只推进理解，不产生能力证据');
 await page.getByRole('button',{name:'继续下一小步',exact:true}).click();await settle();
 let active=await session(),originalTask=active.teaching.current.taskId,originalStep=active.teaching.current.id;
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill('我的原任务草稿：先分别找出最高能量，再比较 $3<5$。');
 await page.getByText('已保存到本机',{exact:true}).waitFor();record('进入一个小尝试，草稿绑定当前任务');
 await page.getByRole('button',{name:'这里没跟上',exact:true}).click();await page.getByRole('button',{name:'这个术语是什么意思',exact:false}).click();await settle();
 active=await session();assert.equal(active.teaching.current.action,'explain');assert.equal(active.teaching.lastConfusion,'term');assert.equal(active.taskDrafts[originalTask].includes('原任务草稿'),true);
 await page.getByRole('button',{name:'这里没跟上',exact:true}).click();await page.getByRole('button',{name:'信息有点多，慢一点',exact:false}).click();await settle();
 active=await session();assert.equal(active.teaching.confusionCount,2);assert.equal(active.teaching.lastConfusion,'overload');assert.ok(active.teaching.returnStep);assert.equal(active.teaching.upcoming.find(x=>x.activity)?.activity.rubric.length,1);record('连续两次卡点实际缩小教学，保留返回位置与原稿');
 await page.getByRole('button',{name:'回到原来这一步',exact:true}).click();await settle();active=await session();assert.equal(active.teaching.current.taskId,originalTask);assert.ok((await page.getByRole('textbox',{name:'我的尝试',exact:true}).inputValue()).includes('原任务草稿'));
 await page.getByRole('button',{name:'我还想探究一个问题',exact:false}).click();await page.getByRole('textbox',{name:'探索问题',exact:true}).fill('路径 g 的输入和输出为什么这样定义？');await page.getByRole('button',{name:'一起探究',exact:true}).click();await settle();
 assert.ok((await session()).teaching.returnStep);await page.getByRole('button',{name:'回到原来这一步',exact:true}).click();await settle();assert.equal((await session()).teaching.current.taskId,originalTask);assert.ok((await session()).draft.includes('原任务草稿'));record('探索形成持久支线，返回同一任务与草稿');
 await page.getByRole('button',{name:'给一点提示',exact:true}).click();await settle();await page.getByRole('button',{name:'提交这次尝试',exact:true}).click();await settle();
 active=await session();s=await snap();const firstEvidence=s.evidence.find(e=>e.sessionId===sessionId);assert.equal(firstEvidence.status,'assisted');assert.equal(firstEvidence.taskId,originalTask);assert.equal(active.teaching.current.action,'feedback');assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).count(),1);record('提示归于当前题，提交后显示具体反馈与冻结任务证据');
 await screenshot('feedback-evidence');
 await page.getByRole('button',{name:'我想自己试一次',exact:true}).click();await settle();active=await session();const secondTask=active.teaching.current.taskId;assert.notEqual(secondTask,originalTask);assert.equal(active.helpLevel,0);assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).inputValue(),'');
 await api('session.saveDraft',{id:sessionId,taskId:originalTask,stepId:originalStep,draft:'旧题迟到保存，不应覆盖新题'});assert.equal((await session()).draft,'');record('独立新任务有独立草稿，迟到的旧题保存不覆盖当前任务');
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill('新题我自己比较两个最高能量，选择 $7$ 所在的路径。');await page.getByRole('button',{name:'提交这次尝试',exact:true}).click();await settle();s=await snap();assert.equal(s.evidence.filter(e=>e.sessionId===sessionId).at(-1).status,'independent');assert.equal(s.evidence.find(e=>e.id===firstEvidence.id).taskId,originalTask);record('新任务的独立表现与旧任务受助证据并存，不污染归因');
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill('我根据反馈补充说明：比较的是每条路径的最高能量，选择其中较小的 7。');await page.getByRole('button',{name:'提交这次修订',exact:true}).click();await settle();s=await snap();const revised=s.evidence.filter(e=>e.sessionId===sessionId).at(-1);assert.equal(revised.status,'assisted');assert.equal(revised.taskId,secondTask);assert.equal(s.evidence.find(e=>e.id===firstEvidence.id).status,'assisted');record('反馈后可直接修订原题，评价支持使修订诚实记为受助表现');
 await page.getByRole('button',{name:'我想自己试一次',exact:true}).click();await settle();active=await session();const failedTask=active.teaching.current.taskId;
 failTransport=true;await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill('这份旧任务作答将在断网模拟后重试评价。');await page.getByRole('button',{name:'提交这次尝试',exact:true}).click();await settle();failTransport=false;await page.getByRole('alert').waitFor();const failedAttempt=(await snap()).attempts.find(a=>a.taskId===failedTask);assert.ok(failedAttempt&&!failedAttempt.assessment);await page.getByRole('button',{name:'关闭错误提示',exact:true}).click();
 await page.getByRole('button',{name:'我想自己试一次',exact:true}).click();await settle();active=await session();const retryCurrentTask=active.teaching.current.taskId;
 await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill('当前新题草稿，重试旧题不得改写。');await page.getByRole('button',{name:'重试这次评价',exact:true}).click();await settle();s=await snap();active=await session();assert.ok(s.attempts.find(a=>a.id===failedAttempt.id).assessment);assert.equal(s.evidence.filter(e=>e.attemptId===failedAttempt.id).length,1);assert.equal(active.teaching.current.taskId,retryCurrentTask);assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).inputValue(),'当前新题草稿，重试旧题不得改写。');record('历史失败评价可跨任务重试，冻结原题证据且保留当前草稿');
 malformedRemaining=2;const beforeFailure=await session();const evidenceCount=s.evidence.length;
 await page.getByRole('button',{name:'我想自己试一次',exact:true}).click();await settle();await page.getByRole('alert').waitFor();active=await session();assert.equal(active.teaching.current.id,beforeFailure.teaching.current.id);assert.equal((await snap()).evidence.length,evidenceCount);assert.equal(malformedRemaining,0);record('截断回复仅进行一次格式恢复，仍失败则保留当前步骤和证据');
 await page.getByRole('button',{name:'关闭错误提示',exact:true}).click();
 await nav('设置');await page.getByRole('button',{name:'预览本机诊断',exact:true}).click();await page.locator('.diagnostics-preview').waitFor();assert.ok((await api('diagnostics.preview')).entries.some(e=>e.status==='invalid'));
 const diagnosticPath=join(artifactDir,'local-diagnostics.json');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},diagnosticPath);await page.getByRole('button',{name:'导出诊断文件',exact:true}).click();await settle();assert.ok(existsSync(diagnosticPath));assert.ok(!readFileSync(diagnosticPath,'utf8').includes(fakeKey));record('诊断经真实UI预览后导出，包含失败线索且排除密钥');
 await screenshot('diagnostics-preview');


 await page.locator('.vision-settings .toggle-label input').check();
 await page.getByLabel('识别服务名称',{exact:true}).fill('本地图像模拟服务');await page.getByLabel('支持图像的模型',{exact:true}).fill('local-vision-mock');await page.getByLabel('识别服务接口地址',{exact:true}).fill(baseUrl);
 await page.getByLabel(/^独立的识别 API 密钥/).fill('local-vision-key-'+stamp);
 await page.locator('.vision-settings').getByLabel('输入价格（元 / 百万 token）',{exact:true}).fill('0.1');await page.locator('.vision-settings').getByLabel('输出价格（元 / 百万 token）',{exact:true}).fill('0.1');
 await page.getByLabel('价格依据与核对日期',{exact:true}).fill('本地模拟服务，零实际费用，仅验证预算计量。');
 await page.getByRole('button',{name:'保存所有设置',exact:true}).click();await settle();assert.equal((await snap()).settings.vision.hasApiKey,true);record('视觉服务通过独立设置保存，不复用教学密钥');
 assert.ok(existsSync(realPdf),'Missing authorized local Rabinowitz PDF');
 const labelledPdf=join(dataDir,'printed-page-label.pdf');writeFileSync(labelledPdf,makePdf());
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths})},[realPdf,labelledPdf]);
 await api('material.importFiles',{projectId:project.id});s=await snap();const pdf=s.materials.find(m=>m.projectId===project.id&&m.originalName===basename(realPdf));assert.ok(pdf?.pdfMetadata?.pageCount>=13);const page13=s.fragments.find(f=>f.materialId===pdf.id&&f.pageNumber===13);assert.ok(page13);const originalPageText=page13.text;record('从指定用户PDF只读导入隔离副本，真实物理页13可定位');
 await reload();await page.locator('.project-nav').filter({hasText:'Rabinowitz'}).click();
 await page.locator('.material-title').filter({hasText:pdf.title}).click();await page.getByRole('dialog',{name:'原文定位'}).waitFor();
 const pageInput=page.getByRole('spinbutton',{name:'PDF 实际页码'});await pageInput.fill('13');
 await page.waitForFunction(()=>{const input=document.querySelector('input[aria-label="PDF 实际页码"]');const canvas=document.querySelector('.source-modal canvas');return input?.value==='13'&&canvas?.dataset.renderedPage==='13'&&canvas?.width>0&&!document.querySelector('.source-modal .pdf-rendering')});
 const renderedCanvas=await page.locator('.source-modal canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let min=255,max=0;for(let i=0;i<d.length;i+=128){min=Math.min(min,d[i]);max=Math.max(max,d[i])}return{width:c.width,height:c.height,min,max}});
 assert.ok(renderedCanvas.max-renderedCanvas.min>40);assert.ok((await page.locator('.source-modal .pdf-page-label').innerText()).includes('实际页 13'));if(page13.printedPageLabel)assert.ok((await page.locator('.source-modal .pdf-page-label').innerText()).includes(page13.printedPageLabel));
 await page.locator('.source-modal .pdf-controls').scrollIntoViewIfNeeded();await screenshot('rabinowitz-actual-page13');
 const originalPageImage=await page.locator('.source-modal canvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]);writeFileSync(join(artifactDir,'rabinowitz-original-page13-full.png'),Buffer.from(originalPageImage,'base64'));
 await page.locator('.source-modal').evaluate(el=>{const v=el.querySelector('.pdf-viewer');el.scrollTop+=v.getBoundingClientRect().top-el.getBoundingClientRect().top-24});await page.locator('.source-modal .pdf-canvas-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight*.28});await screenshot('rabinowitz-page13-formula');
 await page.getByRole('button',{name:'放大原页',exact:true}).click();await page.locator('.pdf-zoom').getByText('125%',{exact:true}).waitFor();await page.getByRole('button',{name:'适合宽度',exact:true}).click();record('真实PDF canvas有可见原始内容，页码与缩放正常');
 await page.getByRole('button',{name:'重建这一页的可读原文',exact:true}).click();await page.getByRole('dialog',{name:'确认原文识别'}).waitFor();assert.ok(await page.locator('.transcribe-preview img').getAttribute('src'));const beforeVision=requests;
 await page.getByRole('button',{name:'发送图像并识别',exact:true}).click();await settle();await page.locator('.transcribe-preview').waitFor({state:'hidden'});s=await snap();let machine=s.sourceTranscriptions.find(t=>t.fragmentId===page13.id&&t.status==='machine');assert.ok(machine);assert.equal(requests,beforeVision+1);assert.ok(calls.at(-1).vision);assert.equal(s.fragments.find(f=>f.id===page13.id).text,originalPageText);record('识别前预览真实页面，规范本地图像只发往视觉模拟服务，原提取不覆盖');
 await page.getByRole('button',{name:'对照原页，修订并确认',exact:true}).click();
 await page.getByRole('textbox',{name:'修订转录文字',exact:true}).fill(machine.text+'\n\n人工确认流程自动化标记：仅验证保存与版本关联。');
 await page.locator('.transcription-panel input[type="checkbox"]').check();await page.getByRole('button',{name:'保存人工确认版本',exact:true}).click();await settle();
 s=await snap();assert.equal(s.sourceTranscriptions.filter(t=>t.fragmentId===page13.id).length,2);assert.ok(s.sourceTranscriptions.some(t=>t.fragmentId===page13.id&&t.status==='confirmed'));assert.equal(s.fragments.find(f=>f.id===page13.id).text,originalPageText);
 await page.getByRole('tab',{name:'原页与转录对照',exact:true}).click();assert.ok(await page.locator('.transcription-text .katex').count());await screenshot('source-transcription-compare');record('机器转录与人工确认版本并存，Markdown公式预览及原页对照可用');
 await page.getByRole('button',{name:'关闭原文',exact:true}).click();
 const labelMaterial=s.materials.find(m=>m.originalName==='printed-page-label.pdf');await page.locator('.material-title').filter({hasText:labelMaterial.title}).click();await page.getByRole('dialog',{name:'原文定位'}).waitFor();await page.locator('.pdf-page-label').getByText('印刷页 4',{exact:true}).waitFor();assert.ok((await page.locator('.pdf-page-label').innerText()).includes('实际页 1'));record('PDF PageLabels真实元数据与物理页码分别展示');await page.getByRole('button',{name:'关闭原文',exact:true}).click();
 await api('material.importText',{projectId:project.id,title:'安全排版测试',text:'# 安全排版\n\n<script>window.__rendererAttack=1</script>\n\n![自动远程图](https://example.invalid/never-load.png)\n\n[执行链接](javascript:alert(1))\n\n$$\\invalidcommand{x}$$\n\n普通文本仍应保留。'});
 await reload();await page.locator('.project-nav').filter({hasText:'Rabinowitz'}).click();await page.locator('.material-title').filter({hasText:'安全排版测试'}).click();await page.getByRole('dialog',{name:'原文定位'}).waitFor();
 for(let i=0;i<await page.locator('.source-modal .fragment-tabs button').count();i++){await page.locator('.source-modal .fragment-tabs button').nth(i).click();assert.equal(await page.evaluate(()=>window.__rendererAttack),undefined);assert.equal(await page.locator('.source-modal img[src^="http"]').count(),0)}assert.ok((await page.locator('.source-text').innerText()).includes('普通文本仍应保留'));assert.equal(externalRequests.length,0);record('统一Markdown禁用HTML执行与远程图片，坏公式保留可读回退');await page.getByRole('button',{name:'关闭原文',exact:true}).click();
 const beforeBudget=requests;await api('settings.save',{settings:{monthlyBudgetCny:0}});await assert.rejects(api('settings.test'));assert.equal(requests,beforeBudget);await api('settings.save',{settings:{monthlyBudgetCny:100}});record('预算检查在向本地服务发请求前阻止超额调用');
 await api('session.nextStep',{sessionId,intent:'independent'});active=await session();const closeTask=active.teaching.current.taskId;await api('session.saveDraft',{id:sessionId,taskId:closeTask,stepId:active.teaching.current.id,draft:'等待重启的当前任务草稿'});
 const fullArchive=join(dataDir,'complete-v02.reclimb');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},fullArchive);await api('backup.create');assert.ok(existsSync(fullArchive));
 const savedSnapshot=await snap();await api('project.update',{id:project.id,goal:'此临时目标将在恢复时替换'});
 await reload();await nav('设置');
 await app.evaluate(({dialog},path)=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},fullArchive);
 await page.getByRole('button',{name:'从备份恢复',exact:true}).click();await page.locator('.modal input[type="checkbox"]').check();await page.getByRole('button',{name:'选择备份并恢复',exact:true}).click();await settle();
 s=await snap();assert.equal(s.projects.find(p=>p.id===project.id).goal,project.goal);assert.equal(s.evidence.length,savedSnapshot.evidence.length);assert.equal(s.sourceTranscriptions.length,2);assert.equal(s.sessions.find(x=>x.id===sessionId).teaching.current.id,savedSnapshot.sessions.find(x=>x.id===sessionId).teaching.current.id);assert.equal(s.settings.hasApiKey,false);assert.equal(s.settings.vision?.hasApiKey,false);assert.ok(s.materials.every(m=>existsSync(m.storedPath)));record('真实恢复界面保留新旧任务、转录版本、材料与证据关联，双服务密钥不恢复');
 await close();await launch();s=await snap();assert.ok(s.sessions.find(x=>x.id===sessionId).draft.includes('等待重启'));assert.equal(s.sessions.find(x=>x.id===sessionId).teaching.current.taskId,closeTask);record('重启保持当前微步与对应草稿');
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();const immediate='立即关闭窗口的最后草稿 '+stamp;await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(immediate);
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{});await closed;app=undefined;await launch();s=await snap();assert.equal(s.sessions.find(x=>x.id===sessionId).taskDrafts[closeTask],immediate);record('输入后立即关窗仍等待当前微步草稿保存');
 await close();await launch(resolve('.test-data/desktop-v02-legacy-'+stamp));
 await app.evaluate(({dialog},path)=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},legacyArchive);await api('backup.restore');s=await snap();assert.equal(s.projects.length,2);assert.equal(s.sourceTranscriptions.length,0);assert.equal(s.settings.hasApiKey,false);assert.ok(s.sessions.every(x=>!x.teaching));record('v1旧备份恢复后保留旧会话，新增转录集合安全为空');
 await close();await launch(resolve('.test-data/desktop-v02-isolated-'+stamp));s=await snap();assert.equal(s.projects.length,0);assert.equal(s.settings.hasApiKey,false);record('另一个安装档案目录不混入项目、密钥与新转录');
 await close();assert.equal(externalRequests.length,0);
 const report={at:new Date().toISOString(),executable:packagedExecutable||'development-electron',passed:results.length,results,localMockRequests:requests,network:'仅127.0.0.1可控模拟教学与视觉服务；未读取真实密钥；无付费模型调用',realPdf:'仅使用明确授权的Rabinowitz本机PDF，复制进独立测试目录',limitations:['模拟内容只验证软件流程，不证明真实AI教学或图像转录质量。'],artifacts:artifactDir,stderr:errors,externalRequests};
 writeFileSync(join(artifactDir,'desktop-verification-v02.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:results.length,artifacts:artifactDir,localRequests:requests},null,2));
}catch(error){
 writeFileSync(join(artifactDir,'failure-report.json'),JSON.stringify({at:new Date().toISOString(),passed:results,stderr:errors,externalRequests,error:String(error)},null,2));
 if(page&&!page.isClosed())await page.screenshot({path:join(artifactDir,'failure.png'),fullPage:true}).catch(()=>{});
 if(app)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});app=undefined;throw error;
}finally{await close().catch(()=>{});await new Promise(r=>server.close(r))}




