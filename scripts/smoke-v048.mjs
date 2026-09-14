// Focused settings-card spacing check; isolated local data, no AI or private materials.
import {_electron as electron} from 'playwright';
import {applyDesktopTestWindow,navigateDesktop} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url), root=process.cwd();
const executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v048');
const dataDirectory=resolve('.test-data/settings-v048-'+Date.now());
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
const results=[],measurements=[],externalRequests=[],rendererErrors=[];
let app,page;
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
async function settings(){await navigateDesktop(page,'设置');await page.getByRole('heading',{name:'让空间，适合你',exact:true}).waitFor();}
async function checkLayout(name){
 await page.locator('.diagnostics-card').scrollIntoViewIfNeeded();
 await page.mouse.move(950,100);
 await page.locator('.sidebar.is-collapsed').waitFor();
 const layout=await page.locator('.settings-main').evaluate(main=>{
  const cards=[...main.querySelectorAll(':scope > .settings-card')];
  const bounds=cards.map(card=>{const r=card.getBoundingClientRect();return {title:card.querySelector('h2')?.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,marginBottom:getComputedStyle(card).marginBottom};});
  const trash=main.querySelector('.project-trash-card').getBoundingClientRect();
  const diagnostics=main.querySelector('.diagnostics-card').getBoundingClientRect();
  return {bounds,gaps:bounds.slice(1).map((card,i)=>card.top-bounds[i].bottom),trashGap:diagnostics.top-trash.bottom,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth};
 });
 measurements.push({name,...layout});
 await page.screenshot({path:join(artifacts,name+'.png'),scale:'css'});
 assert.equal(layout.bounds.length,8,'All seven original settings cards plus the new sync card must remain accessible');
 assert.ok(layout.gaps.every(gap=>gap>=16),name+': card separation must remain visible: '+JSON.stringify(layout.gaps));
 assert.ok(layout.bounds.every(card=>card.left>=0&&card.right<=layout.viewport+1),name+': cards must stay inside the window');
 assert.ok(layout.scrollWidth<=layout.viewport+1,name+': no page-wide horizontal overflow');
 console.log('PASS '+name);results.push(name);
}
try{
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:dataDirectory,RECLIMB_DEV_URL:''},timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(20000);
 await applyDesktopTestWindow(app,page);
 page.on('pageerror',error=>rendererErrors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url()))externalRequests.push(request.url());});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
 await settings();
 await page.getByRole('button',{name:'浅色',exact:true}).click();
 await page.getByLabel('长期想成为怎样的自己').fill('布局验证：保留尚未保存的输入。');
 await checkLayout('light-settings-spacing');
 await page.getByRole('button',{name:'深色',exact:true}).click();
 await checkLayout('dark-settings-spacing');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,800));
 await page.waitForFunction(()=>innerWidth<=1040);
 await checkLayout('narrow-settings-spacing');
 assert.equal(await page.getByLabel('长期想成为怎样的自己').inputValue(),'布局验证：保留尚未保存的输入。');
 const fixture=await api('project.create',{title:'原创布局检查项目',goal:'仅检查删除卡片展开后的布局'});
 await api('project.trash',{id:fixture.projects.find(project=>project.title==='原创布局检查项目').id});
 await page.reload();await settings();
 await page.locator('.project-trash-card').getByRole('button',{name:'永久删除',exact:true}).click();
 await page.getByRole('button',{name:'预览本机诊断',exact:true}).click();
 await page.getByText('当前没有可预览的诊断记录。',{exact:true}).waitFor();
 await checkLayout('expanded-settings-spacing');
 await page.locator('.project-trash-card').getByRole('button',{name:'取消',exact:true}).click();
 assert.equal((await api('workspace.snapshot')).usage.length,0,'Layout checks must never invoke a model');
 assert.deepEqual(externalRequests,[]);assert.deepEqual(rendererErrors,[]);
}finally{
 writeFileSync(join(artifacts,'desktop-verification-v048.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-electron',passed:results.length,results,measurements,localMockRequests:0,externalRequests,rendererErrors,limitations:['Only settings layout was exercised; no broad teaching regression or fresh Windows installation.']},null,2));
 if(app)await app.close();
}
