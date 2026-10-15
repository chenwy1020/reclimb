import {openDeskTools,closeDeskTools} from './desktop-navigation.mjs';
// Focused desktop handwriting layout regression. Only built-in fixtures and loopback transport.
import {_electron as electron} from 'playwright';
import {applyDesktopTestWindow,navigateDesktop} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=process.cwd(),executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v0410-layout');
const dataDirectory=resolve('.test-data/handwriting-layout-v0410-'+Date.now());
const baseline=process.env.RECLIMB_LAYOUT_BASELINE==='1';
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
const results=[],measurements=[],externalRequests=[],rendererErrors=[];
let app,page,origin='';
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
async function json(path,payload,token){
 const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
}
async function openPanel(){await openDeskTools(page,'手写与已保存记录');const toggle=page.getByRole('button',{name:'iPad 手写',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.getByAltText('iPad 配对二维码').waitFor();}
async function checkLayout(name){
 const panel=page.getByRole('region',{name:'iPad 手写原稿'});await panel.scrollIntoViewIfNeeded();await page.mouse.move(880,80);
 const metrics=await panel.evaluate(el=>{
  const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const parent=el.closest('.desk-tool-section'),p=box(parent),card=box(el);
  const actionAreas=[...el.querySelectorAll('.handwriting-heading,.handwriting-history article')].map(row=>{
   const children=[...row.children].map(box);const overlaps=children.some((a,i)=>children.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
   return {children,overlaps};
  });
  return {parent:p,card,leftGap:card.left-p.left,rightGap:p.right-card.right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,panelScrollWidth:el.scrollWidth,panelClientWidth:el.clientWidth,actionAreas,theme:document.documentElement.dataset.theme};
 });
 measurements.push({name,...metrics});await panel.screenshot({path:join(artifacts,name+'.png')});await page.screenshot({path:join(artifacts,name+'-window.png')});
 if(!baseline){
  assert.ok(metrics.leftGap>=16&&metrics.rightGap>=16,name+': handwriting borders need visible separation from parent: '+JSON.stringify({left:metrics.leftGap,right:metrics.rightGap}));
  assert.ok(metrics.panelScrollWidth<=metrics.panelClientWidth+1,name+': handwriting content must fit its card');
  assert.ok(metrics.card.left>=0&&metrics.card.right<=metrics.viewport+1,name+': handwriting card must stay inside the window');
  assert.ok(metrics.scrollWidth<=metrics.viewport+1,name+': no horizontal page overflow');
  assert.ok(metrics.actionAreas.every(row=>!row.overlaps),name+': headings/history and their buttons must not overlap');
 }
 results.push(name);console.log((baseline?'BASELINE ':'PASS ')+name+' '+JSON.stringify({leftGap:metrics.leftGap,rightGap:metrics.rightGap,width:metrics.card.width}));
}
try{
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:dataDirectory,RECLIMB_DEV_URL:''},timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>rendererErrors.push(error.message));
 await applyDesktopTestWindow(app,page);
 page.on('request',request=>{if(/^https?:/.test(request.url()))externalRequests.push(new URL(request.url()).origin);});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await api('sample.seed');await page.reload();
 await page.getByRole('button',{name:'继续上次学习',exact:true}).click();await page.getByLabel('当前学习项目').selectOption('sample-reasoning');
 const draft='布局检查：电脑正在写的推导不随平板连接或主题调整丢失。';await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(draft);
 await page.waitForFunction(async value=>(await window.learning.request('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session')?.draft===value,draft);
 const started=await api('handwriting.start',{host:'127.0.0.1'});const link=new URL(started.urls[0]);origin=link.origin;
 const pairing=await json('/api/pair',{ticket:new URLSearchParams(link.hash.slice(1)).get('ticket'),name:'原创布局测试平板'});
 await api('handwriting.approve',{id:pairing.requestId});const approved=await json('/api/pair/status',{requestId:pairing.requestId,pollToken:pairing.pollToken});
 await openPanel();await page.getByRole('button',{name:'发送当前任务到 iPad',exact:true}).click();const target=(await api('handwriting.status')).target;
 for(let i=0;i<3;i++)await json('/api/submit',{requestId:'layout-ink-'+i,targetId:target.id,pages:[{id:'layout-page-'+i,width:768,height:1024,strokes:[{id:'layout-stroke-'+i,color:'#253e31',width:3,points:[{x:.2,y:.2,pressure:.6},{x:.3,y:.4,pressure:.7}]}]}],note:'原创手写布局检查 '+i},approved.token);
 await page.getByRole('button',{name:'查看原稿',exact:true}).nth(2).waitFor();
 for(const mode of ['浅色','深色']){
  await closeDeskTools(page);await navigateDesktop(page,'设置');await page.getByRole('button',{name:mode,exact:true}).click();
  await navigateDesktop(page,'学习桌');await openPanel();
  for(const width of [1540,1180,1040]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);await page.waitForFunction(width=>innerWidth<=width,width);await checkLayout((mode==='浅色'?'light':'dark')+'-'+width);}
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1180,900));
 await closeDeskTools(page);await navigateDesktop(page,'设置');await page.getByLabel('材料区比例',{exact:true}).focus();await page.keyboard.press('End');
 assert.equal(await page.getByLabel('材料区比例',{exact:true}).inputValue(),'65');
 await navigateDesktop(page,'学习桌');await openPanel();await checkLayout('dark-narrow-learning-column');
 // The previous screenshot's second button border was a keyboard-focus indicator; keep it.
 const focusButton=page.getByRole('button',{name:'查看原稿',exact:true}).first();await focusButton.scrollIntoViewIfNeeded();await page.keyboard.press('Tab');await focusButton.focus();
 const focus=await focusButton.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),p=el.closest('.handwriting-panel').getBoundingClientRect();return {focused:el===document.activeElement,visible:el.matches(':focus-visible'),outline:parseFloat(s.outlineWidth),outlineOffset:parseFloat(s.outlineOffset),inset:Math.min(r.left-p.left,p.right-r.right,r.top-p.top,p.bottom-r.bottom)};});
 if(!baseline){assert.ok(focus.focused&&focus.visible&&focus.outline>=2,'Keyboard focus must remain visible');assert.ok(focus.inset>focus.outline+focus.outlineOffset,'Focus outline must not touch/clip the handwriting border');}
 await page.getByRole('region',{name:'iPad 手写原稿'}).screenshot({path:join(artifacts,'keyboard-focus.png')});
 await focusButton.click();await page.getByRole('dialog',{name:'手写原稿',exact:true}).waitFor();
 const original=await page.locator('.handwriting-original').getAttribute('src');assert.ok(decodeURIComponent(original).includes('fill="white"'));
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'手写原稿',exact:true}).waitFor({state:'hidden'});
 assert.equal(await focusButton.evaluate(el=>el===document.activeElement),true,'Closing the original returns focus to its trigger');
 assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,draft);
 assert.equal((await api('workspace.snapshot')).usage.length,0);assert.deepEqual(rendererErrors,[]);assert.deepEqual(externalRequests,[]);
 results.push('键盘焦点可见且有留白，主草稿保留，零模型调用');await api('handwriting.stop');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 writeFileSync(join(artifacts,'desktop-layout-v0410.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-electron',baseline,passed:results.length,results,measurements,externalRequests,rendererErrors,limitations:['Desktop layout only; this check does not validate Apple Pencil behaviour or handwriting recognition.']},null,2));
 if(app)await app.close();
}
