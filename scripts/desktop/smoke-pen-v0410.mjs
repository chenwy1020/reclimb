// Browser pen regression: self-authored local data only; no AI or private files.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {extractFile,listPackage} from '@electron/asar';
import assert from 'node:assert/strict';

const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||process.env.RECLIMB_PEN_ARTIFACT_DIR?.trim()||'output/playwright/v0410-pen');mkdirSync(artifacts,{recursive:true});
const executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
let staticRoot=resolve(process.env.RECLIMB_COMPANION_DIRECTORY||'dist/companion'),companionSource={kind:'development-directory',path:staticRoot};
if(executable){
 const archive=join(dirname(resolve(executable)),'resources','app.asar');assert.ok(existsSync(executable),'packaged test executable is missing');assert.ok(existsSync(archive),'packaged app.asar is missing');
 staticRoot=join(artifacts,'companion');mkdirSync(staticRoot,{recursive:true});
 for(const name of ['index.html','app.js','style.css'])writeFileSync(join(staticRoot,name),extractFile(archive,join('dist','companion',name)));
 for(const entry of listPackage(archive)){const path=entry.replaceAll('\\','/').replace(/^\//,'');if(!/^dist\/companion\/(?:app\.css|assets\/KaTeX_[A-Za-z0-9_-]+\.(?:woff2?|ttf))$/.test(path))continue;const destination=join(staticRoot,path.slice('dist/companion/'.length));mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,extractFile(archive,join(...path.split('/'))));}
 companionSource={kind:'packaged-asar',path:archive};
}
const target={id:'pen-task',projectId:'pen-project',projectTitle:'原创笔迹验证',sessionId:'pen-session',taskId:'pen-original',title:'连接这些点，写下自己的理由',instruction:'笔迹只保存在本次隔离测试中。',sourceIds:[],helpLevel:0,mode:'practice',createdAt:'2026-09-14T00:00:00.000Z'};
const key=JSON.stringify(['pen-workspace',target.id]);const draft={key,workspaceId:'pen-workspace',target,pages:[{id:'first-page',width:768,height:1024,strokes:[]}],note:'',pageId:'first-page',revision:0,updatedAt:'2026-09-14T00:00:00.000Z',receipts:[]};
const submissions=[],results=[],errors=[],externalRequests=[];let penDiagnostics;
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspaceId:'pen-workspace',target:null}));return;}
 if(path==='/api/submit'){let body='';req.on('data',part=>body+=part);req.on('end',()=>{const data=JSON.parse(body);submissions.push(data);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'saved-'+submissions.length,requestId:data.requestId,targetId:data.targetId,savedAt:new Date().toISOString(),status:'saved_unassessed'}));});return;}
 if(path==='/seed'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>isolated fixture</body></html>');return;}
 const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/app.css':['app.css','text/css']};const file=files[path]??(/^\/assets\/KaTeX_[A-Za-z0-9_-]+\.(?:woff2?|ttf)$/.test(path)?[path.slice(1),path.endsWith('.woff2')?'font/woff2':path.endsWith('.woff')?'font/woff':'font/ttf']:undefined);if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file[1]);res.end(readFileSync(join(staticRoot,file[0])));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser,page;const record=name=>{results.push(name);console.log('PASS '+name);};
try{
 browser=await chromium.launch({...(process.env.RECLIMB_BROWSER_EXECUTABLE?{executablePath:process.env.RECLIMB_BROWSER_EXECUTABLE}:{channel:'msedge'}),headless:true});
 const context=await browser.newContext({viewport:{width:820,height:1180},deviceScaleFactor:1,acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(origin+'/'))externalRequests.push(req.url());});
 await page.goto(origin+'/seed');await page.evaluate(({key,draft})=>new Promise((resolve,reject)=>{const open=indexedDB.open('reclimb-handwriting',1);open.onupgradeneeded=()=>{open.result.createObjectStore('drafts',{keyPath:'key'});open.result.createObjectStore('connection');};open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','connection'],'readwrite');tx.objectStore('drafts').put(draft);tx.objectStore('connection').put({token:'isolated-fixture',workspaceId:'pen-workspace'},'credentials');tx.objectStore('connection').put(key,'selection');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};open.onerror=()=>reject(open.error);}),{key,draft});
 await page.goto(origin);await page.locator('#workbench').waitFor();
 const saved=()=>page.locator('#save-status').filter({hasText:'✓ 已保存在本机'}).waitFor();await saved();
 const readDraft=()=>page.evaluate(key=>new Promise((resolve,reject)=>{const open=indexedDB.open('reclimb-handwriting',1);open.onsuccess=()=>{const db=open.result,req=db.transaction('drafts','readonly').objectStore('drafts').get(key);req.onsuccess=()=>{db.close();resolve(req.result);};req.onerror=()=>reject(req.error);};}),key);
 const canvas=page.locator('#ink-canvas');await canvas.scrollIntoViewIfNeeded();
 await page.evaluate(()=>document.getElementById('ink-canvas').addEventListener('pointerdown',event=>{window.testPenPointer=event.pointerId;window.testPointerType=event.pointerType;},{capture:true}));
 const cdp=await context.newCDPSession(page);const box=await canvas.boundingBox();
 // CDP emits actual browser pointer events with pointerType pen (not mouse).
 for(let stroke=0;stroke<12;stroke++){const x=box.x+50,y=box.y+120+stroke*15;await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,pointerType:'pen',force:.001});
  for(let point=1;point<=8;point++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+point*28,y:y+point*1.5,button:'left',buttons:1,pointerType:'pen',force:point%2?.002:.06});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+224,y:y+12,button:'left',buttons:0,pointerType:'pen',force:0});}
 await saved();let restored=await readDraft();assert.equal(await page.evaluate(()=>window.testPointerType),'pen');assert.equal(restored.pages[0].strokes.length,12);assert.ok(restored.pages[0].strokes.every(s=>s.points.length>=9));
 assert.ok(restored.pages[0].strokes.some(s=>s.points.some(p=>p.pressure<.01)));const pixels=await canvas.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let colored=0;for(let i=0;i<d.length;i+=4)if(d[i]<180&&d[i+1]<180&&d[i+2]<180)colored++;return colored;});assert.ok(pixels>1800,'low-pressure segments must be visible lines');record('真实浏览器 pen 事件快速连续 12 笔，低压力笔迹保存并显示为完整线段');

 // Reproduce Safari's delayed capture-loss ordering and unavailable capture.
 await page.evaluate(()=>{const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();canvas.setPointerCapture=()=>{throw new DOMException('capture unavailable','NotFoundError');};
  const emit=(type,pointerId=42,extra={})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId,pointerType:'pen',button:0,buttons:type==='pointerup'?0:1,pressure:.001,clientX:r.x+70,clientY:r.y+360,...extra}));
  const selection=getSelection(),range=document.createRange();range.selectNodeContents(document.getElementById('task-title'));selection.removeAllRanges();selection.addRange(range);
  for(let s=0;s<40;s++){emit('pointerdown');emit('lostpointercapture');for(let i=1;i<=12;i++)emit('pointermove',42,{clientX:r.x+70+i*18,clientY:r.y+360+s*3});emit('pointerup',42,{clientX:r.x+286,clientY:r.y+360+s*3,pressure:0});}
 });await saved();restored=await readDraft();assert.equal(restored.pages[0].strokes.length,52);assert.ok(restored.pages[0].strokes.slice(12).every(s=>s.points.length>=13));assert.equal(await page.evaluate(()=>getSelection()?.toString()),'');assert.deepEqual(errors,[]);record('捕获失败与旧笔 lostpointercapture 后无间隔再写 40 笔，均完整且不选中界面文字');

 const count=restored.pages[0].strokes.length;await page.evaluate(()=>{const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();for(const type of ['pointerdown','pointermove','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:99,button:0,clientX:r.x+100,clientY:r.y+100,pressure:.5}));});assert.equal((await readDraft()).pages[0].strokes.length,count);
 await page.locator('#finger-mode').check();await page.evaluate(()=>{const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();for(const [i,type] of ['pointerdown','pointermove','pointerup'].entries())canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:99,button:0,clientX:r.x+100+i*20,clientY:r.y+100+i*20,pressure:.5}));});await saved();assert.equal((await readDraft()).pages[0].strokes.length,count+1);await page.locator('#finger-mode').uncheck();record('防误触仍拒绝手掌，主动启用手指书写后才记录触摸');

 // Keep a stroke down across a checkpoint and deliver its points outside the
 // canvas after capture loss; the editor must persist without requiring pen-up.
 await canvas.scrollIntoViewIfNeeded();await page.evaluate(async()=>{const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();const emit=(target,type,i)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'pen',pointerId:57,button:0,pressure:.005,clientX:r.x+80+i*3,clientY:r.y+550}));emit(canvas,'pointerdown',0);emit(canvas,'lostpointercapture',0);for(let i=1;i<=75;i++){emit(window,'pointermove',i);await new Promise(r=>setTimeout(r,20));}});
 const during=await readDraft();assert.equal(during.pages[0].strokes.length,count+2);assert.ok(during.pages[0].strokes.at(-1).points.length>20);await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,cancelable:true,pointerType:'pen',pointerId:57})));await saved();record('失去捕获后窗口继续收笔，长笔画在抬笔前保存检查点，取消事件保留原稿');

 const beforeUndo=(await readDraft()).pages[0].strokes.length;await page.getByRole('button',{name:'撤销笔画',exact:true}).click();await saved();assert.equal((await readDraft()).pages[0].strokes.length,beforeUndo-1);await page.getByRole('button',{name:'重做笔画',exact:true}).click();await saved();assert.equal((await readDraft()).pages[0].strokes.length,beforeUndo);
 await page.getByLabel('补充说明或疑问（选填）').fill('我的文字输入仍可编辑');await saved();assert.equal(await page.locator('#draft-note').evaluate(e=>getComputedStyle(e).userSelect),'text');assert.equal(await canvas.evaluate(e=>getComputedStyle(e).userSelect),'none');
 await page.getByText('书写问题诊断',{exact:true}).click();const diagnosticDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载书写诊断',exact:true}).click();const diagnosticFile=join(artifacts,'pen-event-counts.json');await(await diagnosticDownload).saveAs(diagnosticFile);penDiagnostics=JSON.parse(readFileSync(diagnosticFile,'utf8'));assert.equal(penDiagnostics.events.starts,beforeUndo);assert.ok(penDiagnostics.events.captureFallbacks>=40);assert.ok(penDiagnostics.render.fullRepaints<10);assert.ok(penDiagnostics.render.frames>penDiagnostics.render.fullRepaints);assert.deepEqual(Object.keys(penDiagnostics).sort(),['at','events','format','render','screen','version']);assert.ok(!JSON.stringify(penDiagnostics).includes(target.id));assert.ok(!JSON.stringify(penDiagnostics).includes('isolated-fixture'));
 await context.setOffline(true);await page.getByLabel('补充说明或疑问（选填）').fill('离线后保留的推导');await saved();await context.setOffline(false);await page.reload();await page.locator('#workbench').waitFor();await saved();assert.equal(await page.locator('#draft-note').inputValue(),'离线后保留的推导');assert.equal((await readDraft()).pages[0].strokes.length,beforeUndo);assert.equal(submissions.length,0);record('撤销重做、文字编辑、离线和重载保留原稿；诊断仅计数且连续书写没有逐点全页重绘');

 await canvas.scrollIntoViewIfNeeded();await canvas.screenshot({path:join(artifacts,'continuous-pen.png')});
 await page.getByRole('button',{name:'提交这份作答',exact:true}).click();await page.locator('#submission-status').filter({hasText:'电脑已保存原稿'}).waitFor();assert.equal(submissions.length,1);assert.equal(submissions[0].pages[0].strokes.length,beforeUndo);assert.equal(submissions[0].targetId,target.id);assert.deepEqual(externalRequests,[]);assert.deepEqual(errors,[]);record('手写原稿仍主动提交到冻结原任务，无外部网络、模型调用或脚本错误');
}catch(error){if(page)await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});console.error('PEN SMOKE FAILURE',error,errors);throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(join(artifacts,'desktop-pen-v0410.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-companion',companionSource,passed:results.length,results,errors,rendererErrors:errors,externalRequests,penDiagnostics,limitations:['Chromium/CDP pen events and controlled capture failures are not physical Apple Pencil or Safari device certification.','Actual iPad continuous writing and Pencil smoothness require user retest.']},null,2));}
