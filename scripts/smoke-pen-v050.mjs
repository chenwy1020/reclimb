// Browser pen regression: self-authored local data only; no AI or private files.
import {chromium,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {extractFile,listPackage} from '@electron/asar';
import assert from 'node:assert/strict';

const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||process.env.RECLIMB_PEN_ARTIFACT_DIR?.trim()||'output/playwright/v050-pen');mkdirSync(artifacts,{recursive:true});
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
let browser,page,webkitBrowser;let webkitCheck={status:'not-run',reason:'Set RECLIMB_WEBKIT_EXECUTABLE to a local Playwright WebKit executable.'};const record=name=>{results.push(name);console.log('PASS '+name);};
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
 await page.getByRole('button',{name:'提交这份手写',exact:true}).click();await page.locator('#submission-status').filter({hasText:'电脑已保存原稿'}).waitFor();assert.equal(submissions.length,1);assert.equal(submissions[0].pages[0].strokes.length,beforeUndo);assert.equal(submissions[0].targetId,target.id);assert.deepEqual(externalRequests,[]);assert.deepEqual(errors,[]);record('手写原稿仍主动提交到冻结原任务，无外部网络、模型调用或脚本错误');

 const beforeNative=(await readDraft()).pages[0].strokes.length;
 for(const mode of ['touch-only','pointer-first','touch-first']){
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(mode=>{
   const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();
   const pointer=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:72,pointerType:'pen',button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,pressure:.003}));
   const native=(type,id,x,y,force=.005,touchType='stylus')=>{
    const touch=new Touch({identifier:id,target:canvas,clientX:x,clientY:y,force});Object.defineProperty(touch,'touchType',{value:touchType});
    canvas.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:[touch],touches:type==='touchend'||type==='touchcancel'?[]:[touch],targetTouches:type==='touchend'||type==='touchcancel'?[]:[touch]}));
   };
   for(let s=0;s<20;s++){
    const x=r.x+50,y=r.y+180+s*4;
    if(mode==='pointer-first')pointer('pointerdown',x,y);
    native('touchstart',101,x,y);
    if(mode==='touch-first')pointer('pointerdown',x,y);
    pointer('pointercancel',x,y); // Scribble can cancel only the pointer stream.
    for(let i=1;i<=10;i++){pointer('pointermove',r.x+r.width-10,r.y+r.height-10);native('touchmove',101,x+i*20,y+i*2,.001+i*.003);}
    pointer('pointerup',x+200,y+20);
    native('touchend',101,x+201,y+21,0);
    pointer('pointerup',x+201,y+21);
   }
  },mode);
  await saved();
 }
 restored=await readDraft();assert.equal(restored.pages[0].strokes.length,beforeNative+60);assert.ok(restored.pages[0].strokes.slice(beforeNative).every(stroke=>stroke.points.length>=11&&stroke.points.length<=12));assert.ok(restored.pages[0].strokes.slice(beforeNative).every(stroke=>stroke.points.every(point=>point.x<.8&&point.y<.8)));assert.equal(await page.evaluate(()=>getSelection()?.toString()),'');assert.deepEqual(errors,[]);
 record('合成Safari stylus触控：缺少pointerdown、Pointer先与Touch先三种顺序连续60笔；取消旁路指针不截断、不重画、不混入旁路坐标');
 await page.locator('#finger-mode').check();await canvas.scrollIntoViewIfNeeded();const fingerBox=await canvas.boundingBox(),fingerBefore=(await readDraft()).pages[0].strokes.length;
 for(let stroke=0;stroke<6;stroke++){const point={id:0,x:fingerBox.x+80,y:fingerBox.y+150+stroke*15,force:.5};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x+i*20,y:point.y+i}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 await saved();assert.equal((await readDraft()).pages[0].strokes.length,fingerBefore+6);await page.locator('#finger-mode').uncheck();record('真实浏览器手指触控对照：开启手指书写后连续6笔保持单条记录，不因新增stylus路径重复');
 await page.getByLabel('补充说明或疑问（选填）').fill('进入专注前的文字说明');await saved();const noteBefore=await page.locator('#draft-note').inputValue();
 await page.getByRole('button',{name:'专注书写',exact:true}).click();await page.getByRole('button',{name:'退出专注',exact:true}).waitFor();assert.equal(await page.locator('#draft-note').isVisible(),false);assert.equal(await page.locator('.task-card').isVisible(),false);assert.equal(await page.locator('#focus-save-status').isVisible(),true);assert.equal(await canvas.isVisible(),true);
 await page.evaluate(()=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(document.querySelector('.ink-guide'));selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});assert.equal(await page.evaluate(()=>getSelection()?.toString()),'');
 await page.getByRole('button',{name:'退出专注',exact:true}).click();await page.locator('.task-card').waitFor();assert.equal(await page.locator('#draft-note').inputValue(),noteBefore);assert.equal((await readDraft()).pages[0].strokes.length,fingerBefore+6);
 await page.getByText('书写问题诊断',{exact:true}).click();const diagnosticsDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载书写诊断',exact:true}).click();const diagnosticsPath=join(artifacts,'stylus-event-counts.json');await(await diagnosticsDownload).saveAs(diagnosticsPath);const nativeDiagnostics=JSON.parse(readFileSync(diagnosticsPath,'utf8'));assert.equal(nativeDiagnostics.events.stylusTouchDowns,60);assert.equal(nativeDiagnostics.events.nativeStrokes,60);assert.equal(nativeDiagnostics.events.streamHandovers,20);assert.ok(nativeDiagnostics.events.trace.length<=96);assert.ok(nativeDiagnostics.events.trace.every(event=>Object.keys(event).sort().join(',')==='cancelable,contact,event,source'));penDiagnostics=nativeDiagnostics;
 await page.reload();await page.locator('#workbench').waitFor();await saved();assert.equal(await page.locator('#draft-note').inputValue(),noteBefore);assert.equal((await readDraft()).pages[0].strokes.length,fingerBefore+6);
 record('专注模式明确隐藏编辑区并阻止笔间选区，退出/重载保留稿件；本机诊断区分事件流且不记坐标');

 // The desktop WebKit port exercises its event/DOM implementation, but does not
 // reproduce iPadOS Scribble, digitizer sampling or Pencil hardware latency.
 const webkitExecutable=process.env.RECLIMB_WEBKIT_EXECUTABLE?.trim();
 if(webkitExecutable){
  assert.ok(existsSync(webkitExecutable),'configured WebKit executable is missing');
  webkitBrowser=await webkit.launch({executablePath:webkitExecutable,headless:true});
  const wkContext=await webkitBrowser.newContext({viewport:{width:820,height:1180},hasTouch:true,deviceScaleFactor:1});
  const wkPage=await wkContext.newPage();page=wkPage;wkPage.setDefaultTimeout(15000);
  wkPage.on('pageerror',error=>errors.push('WebKit: '+error.message));wkPage.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(origin+'/'))externalRequests.push(req.url());});
  await wkPage.goto(origin+'/seed');await wkPage.evaluate(({key,draft})=>new Promise((resolve,reject)=>{const open=indexedDB.open('reclimb-handwriting',1);open.onupgradeneeded=()=>{open.result.createObjectStore('drafts',{keyPath:'key'});open.result.createObjectStore('connection');};open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','connection'],'readwrite');tx.objectStore('drafts').put(draft);tx.objectStore('connection').put({token:'isolated-fixture',workspaceId:'pen-workspace'},'credentials');tx.objectStore('connection').put(key,'selection');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};open.onerror=()=>reject(open.error);}),{key,draft});
  await wkPage.goto(origin);await wkPage.locator('#workbench').waitFor();
  const wkSaved=()=>wkPage.locator('#save-status').filter({hasText:'✓ 已保存在本机'}).waitFor();await wkSaved();
  const wkRead=()=>wkPage.evaluate(key=>new Promise((resolve,reject)=>{const open=indexedDB.open('reclimb-handwriting',1);open.onsuccess=()=>{const db=open.result,req=db.transaction('drafts','readonly').objectStore('drafts').get(key);req.onsuccess=()=>{db.close();resolve(req.result);};req.onerror=()=>reject(req.error);};}),key);
  await wkPage.locator('#ink-canvas').scrollIntoViewIfNeeded();
  await wkPage.evaluate(()=>{
   const canvas=document.getElementById('ink-canvas'),r=canvas.getBoundingClientRect();
   const pointer=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:81,pointerType:'pen',button:0,clientX:x,clientY:y,pressure:.004}));
   // Desktop WebKit disallows constructing Touch; dispatch a controlled event
   // payload through the same listeners, explicitly not a hardware input claim.
   const native=(type,x,y,force)=>{const touch={identifier:91,target:canvas,clientX:x,clientY:y,force,touchType:'stylus'},event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{changedTouches:{value:[touch]},touches:{value:type==='touchend'?[]:[touch]},targetTouches:{value:type==='touchend'?[]:[touch]}});canvas.dispatchEvent(event);};
   for(const mode of ['touch-only','pointer-first','touch-first'])for(let stroke=0;stroke<16;stroke++){
    const x=r.x+40,y=r.y+130+stroke*7;
    if(mode==='pointer-first')pointer('pointerdown',x,y);native('touchstart',x,y,.001);if(mode==='touch-first')pointer('pointerdown',x,y);pointer('pointercancel',x,y);
    for(let point=1;point<=10;point++){pointer('pointermove',r.x+r.width-2,r.y+r.height-2);native('touchmove',x+point*18,y+point,.003);}
    pointer('pointerup',x+180,y+10);native('touchend',x+181,y+11,0);
   }
  });await wkSaved();let wkDraft=await wkRead();assert.equal(wkDraft.pages[0].strokes.length,48);assert.ok(wkDraft.pages[0].strokes.every(stroke=>stroke.points.length>=11&&stroke.points.length<=12));assert.ok(wkDraft.pages[0].strokes.every(stroke=>stroke.points.every(point=>point.x<.8&&point.y<.8)));assert.ok(wkDraft.pages[0].strokes.every(stroke=>stroke.points.at(-1).pressure===0));
  await wkPage.getByLabel('补充说明或疑问（选填）').fill('WebKit 原始说明');await wkSaved();await wkPage.getByRole('button',{name:'专注书写',exact:true}).click();assert.equal(await wkPage.locator('#draft-note').isVisible(),false);assert.equal(await wkPage.locator('#ink-canvas').isVisible(),true);
  await wkPage.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.ink-guide'));getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});assert.equal(await wkPage.evaluate(()=>getSelection().toString()),'');
  await wkPage.screenshot({path:join(artifacts,'webkit-focused-writing.png')});await wkPage.getByRole('button',{name:'退出专注',exact:true}).click();assert.equal(await wkPage.locator('#draft-note').inputValue(),'WebKit 原始说明');await wkPage.reload();await wkPage.locator('#workbench').waitFor();await wkSaved();wkDraft=await wkRead();assert.equal(wkDraft.pages[0].strokes.length,48);assert.equal(await wkPage.locator('#draft-note').inputValue(),'WebKit 原始说明');
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);webkitCheck={status:'passed',version:webkitBrowser.version(),platform:process.platform,physicalIPad:false,eventSource:'Synthetic Event with explicit stylus Touch payload; WebKit Touch constructor is unavailable.',strokes:48};
  record('Windows WebKit 原生触控合成对照48笔：三种事件顺序、零压力保存、专注选区与重载恢复通过（非iPad真机）');
 }

}catch(error){if(page)await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});console.error('PEN SMOKE FAILURE',error,errors);throw error;}
finally{if(webkitBrowser)await webkitBrowser.close();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(join(artifacts,'desktop-pen-v050.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-companion',companionSource,passed:results.length,results,errors,rendererErrors:errors,externalRequests,penDiagnostics,webkitCheck,limitations:['Chromium/CDP pen events and desktop WebKit controlled events are not physical Apple Pencil or Safari device certification.','Actual iPad continuous writing with Scribble enabled and Pencil smoothness require user retest.']},null,2));}
