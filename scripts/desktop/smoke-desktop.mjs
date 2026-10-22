import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const root=process.cwd(),stamp=Date.now().toString();
const artifactDir=resolve('output/playwright'),dataDir=resolve('.test-data/desktop-'+stamp);
mkdirSync(artifactDir,{recursive:true});mkdirSync(dataDir,{recursive:true});
const results=[];let app,page,requests=0,failModel=false;
const record=(name)=>{results.push(name);console.log('PASS '+name)};
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 requests++;
 if(failModel){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return;}
 const body=JSON.parse(raw),u=JSON.parse(body.messages.find(m=>m.role==='user').content);
 let value;
 if(u.instruction.includes('只返回JSON'))value={ok:true};
 else if(u.instruction.includes('capabilities:'))value={summary:'本地接口验证使用的路线，不作为教学效果证据。',capabilities:[{title:'比较条件并解释依据',description:'根据材料独立识别条件并提出可检验的结论',prerequisites:[],sourceIds:u.sources.slice(0,1).map(f=>f.id)}]};
 else if(u.instruction.includes('rubric每一条'))value={outcome:'met',feedback:'本地验证反馈：记录与作答关联完整。',criteria:u.activity.rubric.map(criterion=>({criterion,result:'met',reason:'测试接口按约定返回，非真实能力判断。'})),limitations:['本地自动化接口模拟，不代表真实模型评价或学习效果。'],sourceIds:u.sources.slice(0,1).map(f=>f.id)};
 else if(u.instruction.includes('只生成一个可执行'))value={title:'验证活动 '+requests,instruction:'请比较条件变化并说明你的理由；情境编号 '+requests,kind:u.capability.title.includes('论')?'argument':'application',rubric:['说明条件','给出理由'],sourceIds:u.sources.slice(0,1).map(f=>f.id),referenceAnswer:'这是本地接口模拟的完整示范，用于验证帮助条件的记录。',assessmentBasis:u.sources.length?'source':'ai'};
 else value={text:'本地验证帮助：先比较已知条件，保留你的原任务。',sourceIds:(u.sources||[]).slice(0,1).map(f=>f.id)};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:60}}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
const errors=[];
async function launch(directory=dataDir){
 const executablePath=process.env.RECLIMB_TEST_EXECUTABLE||require('electron');
 app=await electron.launch({executablePath,args:process.env.RECLIMB_TEST_EXECUTABLE?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:directory,RECLIMB_DEV_URL:''},timeout:45000});
 app.process().stderr.on('data',data=>{const t=data.toString();if(/Error|error/i.test(t))errors.push(t.slice(0,1500));});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor({timeout:30000});
}
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snap=()=>api('workspace.snapshot');
async function close(){if(app){await app.close();app=undefined;}}
try{
 await launch();assert.equal((await snap()).projects.length,0);record('全新本机档案启动，无他人资料');
 await page.getByRole('button',{name:'先体验内置练习示例'}).click();
 await page.getByRole('heading',{name:'从现象到函数'}).waitFor();
 let s=await snap();assert.equal(s.projects.length,2);assert.equal(s.evidence.length,0);record('两类原创示例通过界面加入，无虚构能力记录');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:join(artifactDir,'home.png'),fullPage:true});
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();
 const answer=page.getByRole('textbox',{name:'我的尝试'});
 await answer.fill('桌面验证：我先写下自己的理解，这段草稿需要在重启后继续。');
 await page.getByText('已保存到本机',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'提交这次尝试',exact:true}).click();
 await page.getByRole('alert').waitFor();
 s=await snap();assert.equal(s.attempts.length,1);assert.equal(s.evidence.length,0);const firstSession=s.attempts[0].sessionId;record('未配置AI时作答先保存，失败不产生能力证据');
 await page.getByRole('button',{name:'关闭错误提示'}).click();
 await page.getByRole('button',{name:'看完整示范',exact:true}).click();
 await page.getByText('完整示范（用于对照，不计为你的独立完成）',{exact:false}).waitFor();
 s=await snap();assert.equal(s.sessions.find(x=>x.id===firstSession).helpLevel,4);record('离线完整示范按4级帮助记录');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:join(artifactDir,'learning-desk.png'),fullPage:true});
 await page.getByRole('button',{name:'先休息一下',exact:true}).click();
 await page.getByRole('heading',{name:'先歇一会儿，路还在。'}).waitFor();
 await page.getByRole('button',{name:'回到这一步',exact:true}).click();record('暂停与恢复保留当前任务');
 // A fresh project is created through the actual form.
 await page.getByRole('button',{name:'新建项目',exact:true}).click();
 await page.getByLabel('给这段学习起个名字',{exact:false}).fill('桌面验证新项目');
 await page.getByLabel('我希望自己能独立做到…',{exact:false}).fill('能比较论证的前提和结论，并独立指出缺失的证据。');
 await page.getByRole('button',{name:'建立学习项目',exact:true}).click();
 await page.getByRole('button',{name:'粘贴文字',exact:true}).click();
 await page.getByLabel('材料标题',{exact:true}).fill('测试论证材料');
 await page.getByLabel('正文',{exact:true}).fill('# 判断证据\n\n相关并不直接意味着因果。需要比较其他解释与干扰条件。');
 await page.getByRole('button',{name:'导入材料',exact:true}).click();
 s=await snap();const custom=s.projects.find(p=>p.title==='桌面验证新项目');assert.ok(custom);assert.ok(s.fragments.some(f=>f.projectId===custom.id&&f.text.includes('因果')));record('新项目与新材料无需改程序即可导入');
 // Exercise production importers through the main-process file dialog boundary.
 const AdmZip=require('adm-zip');const fileList=[];
 function fixture(name,text){const file=join(dataDir,name);writeFileSync(file,text);fileList.push(file);return file;}
 function zipFixture(name,entries){const zip=new AdmZip();for(const [key,value] of Object.entries(entries))zip.addFile(key,Buffer.from(value));fixture(name,zip.toBuffer());}
 const commands='BT /F1 14 Tf 40 240 Td <69827387> Tj ET';
 fixture('中文.pdf','%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n4 0 obj << /Length '+commands.length+' >> stream\n'+commands+'\nendstream\nendobj\n5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >> endobj\n6 0 obj << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >> >> endobj\ntrailer << /Root 1 0 R /Size 7 >>\n%%EOF');
 zipFixture('论证.docx',{'word/document.xml':'<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>前提必须支持结论。</w:t></w:r></w:p></w:body></w:document>'});
 zipFixture('课程.epub',{'mimetype':'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':'<package><metadata><dc:title xmlns:dc="urn:dc">概念课程</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>','a.xhtml':'<html><body><h1>独立解释</h1><p>比较条件和例子。</p></body></html>'});
 fixture('摘录.txt','条件不同，结论也可能不同。');
 fixture('课程.srt','1\n00:00:01,000 --> 00:00:03,000\n先核对条件。');
 fixture('课程.vtt','WEBVTT\n\n00:01.000 --> 00:03.000\n再检查结论。');
 fixture('文章.html','<article><h1>比较解释</h1><p>先排除其他原因。</p></article>');
 await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths})},fileList);
 await api('material.importFiles',{projectId:custom.id});
 s=await snap();assert.equal(s.materials.filter(m=>m.projectId===custom.id).length,8);
 assert.ok(s.fragments.some(f=>f.projectId===custom.id&&f.text.includes('概率')&&f.locator==='第 1 页'));
 assert.ok(s.fragments.some(f=>f.locator.includes('00:00:01.000')));assert.ok(s.materials.every(m=>existsSync(m.storedPath)));record('正式运行时解析中文PDF及DOCX/EPUB/TXT/HTML/SRT/VTT，保留实际来源定位');

 // Configure an isolated local compatible service, never a paid or external endpoint.
 s=await snap();const {hasApiKey:_hasKey,...defaultProfile}=s.settings.modelProfiles.find(profile=>profile.id===s.settings.activeModelProfileId);
 await api('settings.modelProfile.save',{profile:{...defaultProfile,providerName:'本地自动化验证接口',baseUrl,model:'test-local-model'},apiKey:'local-test-key-never-valid-external'});
 await api('settings.save',{settings:{monthlyBudgetCny:100}});
 assert.ok((await snap()).settings.hasApiKey);
 const keyFile=readFileSync(join(dataDir,'credentials.json'),'utf8');assert.ok(!keyFile.includes('local-test-key'));record('真实Windows保护保存密钥，页面及密文文件无明文');
 await api('settings.test');
 await api('route.generate',{projectId:custom.id});
 s=await snap();const cap=s.capabilities.find(c=>c.projectId===custom.id&&!c.archived);assert.ok(cap?.sourceIds.length);
 await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
 await page.getByRole('button',{name:'桌面验证新项目',exact:true}).click();
 await page.locator('.route-node .source-links button').first().click();
 await page.getByRole('dialog',{name:'原文定位'}).waitFor();
 const linkedSource=(await snap()).fragments.find(f=>f.id===cap.sourceIds[0]);
 assert.ok((await page.locator('.source-modal .source-text').innerText()).includes(linkedSource.text));record('能力来源点击后返回对应原文片段');
 await page.getByRole('button',{name:'关闭原文',exact:true}).click();

 await api('lesson.start',{projectId:custom.id,capabilityId:cap.id});
 s=await snap();const fresh=s.sessions.filter(x=>x.projectId===custom.id).at(-1);assert.ok(fresh);assert.equal(fresh.activity.referenceAnswer,undefined);
 await api('session.submit',{sessionId:fresh.id,text:'我会区分相关与因果，并检查第三个影响条件。',requestId:'desktop-first-'+stamp});
 s=await snap();const evidence=s.evidence.find(e=>e.sessionId===fresh.id);assert.equal(evidence.status,'independent');assert.equal(s.reviews.filter(r=>r.capabilityId===cap.id).length,1);
 const callsBeforeDuplicate=requests;
 await api('session.submit',{sessionId:fresh.id,text:'我会区分相关与因果，并检查第三个影响条件。',requestId:'desktop-first-'+stamp});
 assert.equal(requests,callsBeforeDuplicate);assert.equal((await snap()).evidence.length,s.evidence.length);record('完整IPC学习流程与重复提交防重，成功后产生两次回访');
 await api('session.help',{sessionId:fresh.id,kind:'explore',text:'如果条件无法控制，可以怎样继续比较？'});
 await api('session.submit',{sessionId:fresh.id,text:'按照帮助补充比较条件。',requestId:'desktop-revision-'+stamp});
 s=await snap();assert.equal(s.evidence.filter(e=>e.sessionId===fresh.id).at(-1).status,'assisted');assert.ok(s.sessions.find(x=>x.id===fresh.id).messages.some(m=>m.kind==='explore'));record('支线保留，帮助后修订标为得到帮助');
 failModel=true;
 await assert.rejects(api('session.submit',{sessionId:fresh.id,text:'断网测试作答仍应保存。',requestId:'desktop-failure-'+stamp}));
 failModel=false;s=await snap();assert.ok(s.attempts.find(a=>a.requestId==='desktop-failure-'+stamp));assert.equal(s.evidence.length,2);record('模型故障不丢作答，也不重复新增证据');
 const beforeBudget=requests;await api('settings.save',{settings:{monthlyBudgetCny:0.00001}});
 await assert.rejects(api('settings.test'));assert.equal(requests,beforeBudget);await api('settings.save',{settings:{monthlyBudgetCny:100}});record('预算接近上限在联网前阻止新请求');
 // Native dialogs are stubbed only by the test runner to pick deterministic local paths.
 const backupPath=join(dataDir,'validated.reclimb');
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},backupPath);
 await api('backup.create');assert.ok(existsSync(backupPath));
 await api('project.update',{id:custom.id,goal:'此变更将在恢复时被替换'});
 await app.evaluate(({dialog},path)=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},backupPath);
 await api('backup.restore');s=await snap();assert.ok(s.projects.find(p=>p.id===custom.id).goal.includes('前提和结论'));assert.equal(s.settings.hasApiKey,false);assert.equal(s.evidence.length,2);assert.ok(s.materials.every(m=>existsSync(m.storedPath)));record('完整备份恢复保留材料作答证据关联，密钥不恢复');
 await close();await launch();s=await snap();assert.equal(s.projects.length,3);assert.equal(s.evidence.length,2);assert.ok(s.sessions.find(x=>x.id===firstSession).draft.includes('桌面验证'));record('进程重启后长期记录仍完整');
 // Verify a close immediately after typing waits for the renderer's final draft flush.
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();
 const immediate='关闭窗口前最后输入的草稿 '+stamp;
 await page.getByRole('textbox',{name:'我的尝试'}).fill(immediate);
 const closed=app.waitForEvent('close');
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close()}).catch(()=>{});
 await closed;app=undefined;
 await launch();s=await snap();assert.ok(s.sessions.some(x=>x.draft===immediate));record('输入后立即关窗会先完成草稿保存');
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();
 const quitDraft='整个应用退出前的最后草稿 '+stamp;await page.getByRole('textbox',{name:'我的尝试'}).fill(quitDraft);
 const quitClosed=app.waitForEvent('close',{timeout:10000});
 await app.evaluate(({app})=>{app.quit()}).catch(()=>{});
 await quitClosed;app=undefined;await launch();s=await snap();assert.ok(s.sessions.some(x=>x.draft===quitDraft));record('退出整个应用同样先保存草稿再关闭数据库');
 await close();await launch(resolve('.test-data/isolated-'+stamp));s=await snap();assert.equal(s.projects.length,0);assert.equal(s.settings.hasApiKey,false);record('另一个独立资料目录不会混入学习档案或密钥');
 await close();
 writeFileSync(join(artifactDir,'desktop-verification.json'),JSON.stringify({at:new Date().toISOString(),executable:process.env.RECLIMB_TEST_EXECUTABLE||'development-electron',results,network:'仅本地可控兼容接口；未调用真实付费模型',stderr:errors},null,2));
 console.log(JSON.stringify({passed:results.length,artifacts:artifactDir},null,2));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(artifactDir,'failure.png'),fullPage:true}).catch(()=>{});if(app)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});app=undefined;throw error;}
finally{await close().catch(()=>{});await new Promise(r=>server.close(r));}
