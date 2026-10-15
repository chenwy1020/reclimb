import {openDeskTools,closeDeskTools} from './desktop-navigation.mjs';
// Focused handwriting delivery checks. Only built-in original fixtures and loopback traffic.
import {_electron as electron,chromium} from 'playwright';
import {applyDesktopTestWindow,navigateDesktop} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=process.cwd(),executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v049');
const dataDirectory=resolve('.test-data/desktop-v049-'+Date.now());
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
if(executable)assert.ok(existsSync(executable));
const results=[],externalRequests=[],rendererErrors=[],submitRequests=[],consoleErrors=[];
let app,page,browser,context,pad,origin='',originalDraftKey='',originalTargetId='',loseReceipt=false,delayReceipt=false,releaseReceipt;
const record=name=>{results.push(name);console.log('PASS '+name);};
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snapshot=()=>api('workspace.snapshot');
const originalSession='sample-reasoning-session',otherSession='sample-argument-session';
async function launch(){
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:dataDirectory,RECLIMB_DEV_URL:''},timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',error=>rendererErrors.push(error.message));
 await applyDesktopTestWindow(app,page);
 page.on('console',entry=>{if(entry.type()==='error')consoleErrors.push({surface:'desktop',text:entry.text().slice(0,1500)});});
 page.on('request',request=>{if(/^https?:/.test(request.url()))externalRequests.push(new URL(request.url()).origin);});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
async function desk(project='sample-reasoning'){
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();
 await page.getByLabel('当前学习项目').selectOption(project);await page.locator('#current-task-title').waitFor();
}
async function openPanel(){await openDeskTools(page,'手写与已保存记录');const button=page.getByRole('button',{name:'iPad 手写',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
async function pair(link){
 await pad.goto(link);await pad.locator('#pair-status').filter({hasText:'配对确认码'}).waitFor();
 await page.waitForFunction(async()=>!!(await window.learning.request('handwriting.status')).pending);
 const pending=(await api('handwriting.status')).pending;await pad.locator('#pair-status').filter({hasText:pending.code}).waitFor();assert.ok((await pad.locator('#pair-status').textContent()).includes(pending.code));
 await page.getByRole('button',{name:'允许这台 iPad',exact:true}).click();await pad.locator('#connection-status').filter({hasText:'已连接电脑'}).waitFor();assert.equal(new URL(pad.url()).hash,'');
}
async function saved(){await pad.locator('#save-status').filter({hasText:'✓ 已保存在本机'}).waitFor();}
async function draw(){const canvas=pad.getByRole('img',{name:'手写草稿画布'});await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();const y=Math.max(170,Math.min(700,r.y+r.height*.4));await pad.mouse.move(r.x+100,y);await pad.mouse.down();await pad.mouse.move(r.x+260,y+100,{steps:18});await pad.mouse.up();await saved();}
async function chooseOriginalDraft(){
 assert.ok(originalDraftKey&&originalTargetId,'Capture the immutable original before selecting another task');
 await pad.getByLabel('切换本机草稿').selectOption(originalDraftKey);await pad.locator('#task-title').filter({hasText:'识别线性关系及其边界'}).waitFor();await saved();
 const restored=await pad.evaluate(key=>new Promise((resolve,reject)=>{const open=indexedDB.open('reclimb-handwriting',1);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts','readonly').objectStore('drafts').get(key);read.onsuccess=()=>{db.close();resolve(read.result)};read.onerror=()=>reject(read.error)}}),originalDraftKey);
 assert.equal(restored.key,originalDraftKey);assert.equal(restored.target.id,originalTargetId);assert.equal(restored.target.sessionId,originalSession);assert.equal(restored.conflict,undefined,'Selecting the original must not silently choose a conflict copy');assert.ok(restored.receipts.length>=2,'Both confirmed submissions must remain attached to the original');
}
try{
 await launch();let s=await snapshot();assert.equal(s.projects.length,0);assert.equal(s.settings.hasApiKey,false);assert.equal(s.usage.length,0);
 await api('sample.seed');await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await desk();
 const desktopDraft='电脑上的原有文字推导，连接手写板后仍应完整保留。';await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(desktopDraft);
 await page.waitForFunction(async({id,draft})=>(await window.learning.request('workspace.snapshot')).sessions.find(session=>session.id===id)?.draft===draft,{id:originalSession,draft:desktopDraft});
 record('隔离档案和原创示例启动，无密钥、零预算仍可准备手写');

 const started=await api('handwriting.start',{host:'127.0.0.1'});origin=new URL(started.urls[0]).origin;await openPanel();await page.getByAltText('iPad 配对二维码').waitFor();
 browser=await chromium.launch({...(process.env.RECLIMB_BROWSER_EXECUTABLE?{executablePath:process.env.RECLIMB_BROWSER_EXECUTABLE}:{channel:'msedge'}),headless:true});
 context=await browser.newContext({viewport:{width:820,height:1180},deviceScaleFactor:1,acceptDownloads:true});
 await context.route('**/api/submit',async route=>{submitRequests.push(JSON.parse(route.request().postData()));const response=await route.fetch();if(loseReceipt){loseReceipt=false;await route.abort('connectionreset');return;}if(delayReceipt){delayReceipt=false;await new Promise(resolve=>{releaseReceipt=resolve;});}await route.fulfill({response});});
 pad=await context.newPage();pad.setDefaultTimeout(25000);pad.on('pageerror',error=>rendererErrors.push(error.message));pad.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)externalRequests.push(new URL(request.url()).origin);});
 pad.on('console',entry=>{if(entry.type()==='error')consoleErrors.push({surface:'companion',text:entry.text().slice(0,1500)});});
 await pad.goto(started.urls[0]);await pad.locator('#pair-status').filter({hasText:'配对确认码'}).waitFor();const replacement=await api('handwriting.renew');await pair(replacement.urls[0]);record('真实服务二维码配对、短码核对和电脑批准，新票据接替旧轮询且离开地址栏');

 await page.getByRole('button',{name:'发送当前任务到 iPad',exact:true}).click();await pad.getByRole('button',{name:'重新查看电脑任务',exact:true}).click();
 await pad.getByRole('button',{name:'采用这个任务',exact:true}).waitFor();assert.equal(await pad.locator('#workbench').isVisible(),false);await pad.getByRole('button',{name:'采用这个任务',exact:true}).click();await saved();
 originalDraftKey=await pad.getByLabel('切换本机草稿').inputValue();originalTargetId=(await api('handwriting.status')).target.id;assert.equal(JSON.parse(originalDraftKey)[1],originalTargetId);assert.equal(await pad.locator('#task-title').textContent(),'识别线性关系及其边界');record('任务来自电脑原版本，学习者明确采用后才打开草稿');

 await draw();await pad.getByRole('button',{name:'撤销笔画',exact:true}).click();await pad.getByRole('button',{name:'重做笔画',exact:true}).click();await pad.getByRole('button',{name:'加一页',exact:true}).click();await draw();
 const note=pad.getByLabel('补充说明或疑问（选填）');await note.fill('两页原创手写推导');await saved();await pad.reload();await pad.locator('#workbench').waitFor();await saved();assert.equal(await note.inputValue(),'两页原创手写推导');assert.equal(await pad.locator('#page-label').textContent(),'2 / 2 页');
 // Restored drafts can be saved before the two scheduled animation frames paint the canvas.
 await pad.waitForFunction(()=>{const canvas=document.getElementById('ink-canvas');return canvas&&Array.from(canvas.getContext('2d').getImageData(1,1,1,1).data).every(value=>value===255);});
 const localWhite=await pad.locator('#ink-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(1,1,1,1).data));assert.deepEqual(localWhite,[255,255,255,255]);record('笔迹、撤销重做、多页和补充说明经过 IndexedDB 保存及页面重载');

 loseReceipt=true;await pad.getByRole('button',{name:'提交这份作答',exact:true}).click();await pad.waitForFunction(()=>!document.getElementById('submit-ink').disabled&&document.getElementById('submit-ink').textContent.includes('重试'));
 assert.equal((await api('handwriting.list',{sessionId:originalSession})).length,1);await context.setOffline(true);await note.fill('断线后继续补充的原稿');await saved();assert.equal(submitRequests.length,1);await context.setOffline(false);await pad.reload();await pad.locator('#workbench').waitFor();await saved();assert.equal(await note.inputValue(),'断线后继续补充的原稿');
 await pad.getByRole('button',{name:'重试发送已保存的原稿',exact:true}).click();await pad.locator('#submission-status').filter({hasText:'电脑已保存原稿'}).waitFor();assert.deepEqual(submitRequests[0],submitRequests[1]);assert.equal((await api('handwriting.list',{sessionId:originalSession})).length,1);record('电脑回执丢失后断线续写，重启页面主动原编号重试，不重复保存');

 await note.fill('等待回应时仍保留原任务');await saved();delayReceipt=true;await pad.getByRole('button',{name:'提交这份作答',exact:true}).click();await pad.locator('#submission-status').filter({hasText:'正在发送到电脑'}).waitFor();
 await closeDeskTools(page);await page.getByLabel('当前学习项目').selectOption('sample-argument');await openPanel();await page.getByRole('button',{name:'发送当前任务到 iPad',exact:true}).click();await pad.getByRole('button',{name:'重新连接电脑',exact:true}).click();await pad.getByRole('button',{name:'采用这个任务',exact:true}).waitFor();assert.equal(await note.inputValue(),'等待回应时仍保留原任务');
 await pad.getByRole('button',{name:'采用这个任务',exact:true}).click();await pad.locator('#task-title').filter({hasText:'辨认论证的缺口并修订'}).waitFor();await note.fill('另一题的未提交草稿');await saved();assert.ok(releaseReceipt);releaseReceipt();releaseReceipt=undefined;await pad.waitForTimeout(400);assert.equal(await note.inputValue(),'另一题的未提交草稿');assert.equal((await api('handwriting.list',{sessionId:otherSession})).length,0);
 assert.equal((await snapshot()).sessions.find(session=>session.id===originalSession).draft,desktopDraft);await chooseOriginalDraft();assert.equal(await note.inputValue(),'等待回应时仍保留原任务');record('新任务不自动换稿，迟到回执不覆盖新题，电脑主任务草稿不变');

 await page.getByLabel('当前学习项目').selectOption('sample-reasoning');await page.getByRole('button',{name:'查看原稿',exact:true}).first().click();await page.getByRole('dialog',{name:'手写原稿',exact:true}).waitFor();await page.locator('.handwriting-original').waitFor();
 const svg=await page.locator('.handwriting-original').getAttribute('src');assert.ok(decodeURIComponent(svg).includes('fill="white"'));await page.getByRole('dialog',{name:'手写原稿',exact:true}).screenshot({path:join(artifacts,'desktop-ink-light.png')});await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();
 await closeDeskTools(page);await navigateDesktop(page,'设置');await page.getByRole('button',{name:'深色',exact:true}).click();await navigateDesktop(page,'学习桌');await openDeskTools(page,'手写与已保存记录');await page.getByRole('button',{name:'查看原稿',exact:true}).first().click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,800));assert.equal(await page.locator('.handwriting-original').evaluate(img=>getComputedStyle(img).filter),'none');await page.getByRole('dialog',{name:'手写原稿',exact:true}).screenshot({path:join(artifacts,'desktop-ink-dark-narrow.png')});await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();
 await pad.locator('#ink-canvas').scrollIntoViewIfNeeded();await pad.screenshot({path:join(artifacts,'companion-tablet.png'),fullPage:true});await pad.setViewportSize({width:390,height:844});assert.ok(await pad.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await pad.screenshot({path:join(artifacts,'companion-narrow.png'),fullPage:true});record('桌面原稿可查看，深浅与窄窗口保留白纸，平板页面无横向溢出');

 const downloadPromise=pad.waitForEvent('download');await pad.getByRole('button',{name:'下载原稿备份',exact:true}).click();const download=await downloadPromise;const backupPath=join(artifacts,'original-test-draft.json');await download.saveAs(backupPath);const exported=JSON.parse(readFileSync(backupPath,'utf8'));assert.equal(exported.draft.target.sessionId,originalSession);assert.ok(!JSON.stringify(exported).includes('Bearer '));
 await app.close();app=undefined;await launch();await desk();const restarted=await api('handwriting.start',{host:'127.0.0.1'});assert.equal(new URL(restarted.urls[0]).origin,origin);await openPanel();await pair(restarted.urls[0]);await pad.locator('#workbench').waitFor();await saved();assert.equal(await note.inputValue(),'等待回应时仍保留原任务');
 await pad.getByLabel('导入原稿备份').setInputFiles(backupPath);await pad.locator('#global-error').filter({hasText:'本机已经有这份任务的草稿'}).waitFor();assert.equal(await note.inputValue(),'等待回应时仍保留原任务');
 s=await snapshot();assert.equal(s.evidence.length,0);assert.equal(s.attempts.length,0);assert.equal(s.usage.length,0);assert.equal(s.settings.hasApiKey,false);assert.equal((await api('handwriting.list',{sessionId:originalSession})).length,2);assert.deepEqual(externalRequests,[]);assert.deepEqual(rendererErrors,[]);record('桌面重启撤销旧授权并重新配对，旧稿恢复、重复导入拒覆盖、零模型费用和能力证据');
 await api('handwriting.stop');
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure-desktop.png'),fullPage:true}).catch(()=>{});
 if(pad&&!pad.isClosed())await pad.screenshot({path:join(artifacts,'failure-companion.png'),fullPage:true}).catch(()=>{});
 console.error('HANDWRITING SMOKE FAILURE',error);console.error(JSON.stringify({rendererErrors,consoleErrors},null,2));throw error;
}finally{
 releaseReceipt?.();if(browser)await browser.close();if(app)await app.close();
 writeFileSync(join(artifacts,'desktop-verification-v049.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-electron',passed:results.length,results,externalRequests,localMockRequests:0,handwritingSubmitRequests:submitRequests.length,rendererErrors,consoleErrors,limitations:['Desktop Edge simulates browser behavior; real iPad Safari, Apple Pencil, palm rejection, lock-screen recovery and real LAN/firewall remain user-device acceptance items.','No real model calls; handwriting remains saved and unassessed.']},null,2));
}
