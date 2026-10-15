// Nutstore wire behavior, redirected exclusively to a loopback fixture in this test.
import {_electron as electron} from 'playwright';
import {navigateDesktop,applyDesktopTestWindow} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd(),executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v052'),data=resolve('.test-data/dav-v052-'+Date.now());mkdirSync(artifacts,{recursive:true});
const folders=new Set(['/dav/']),files=new Map(),requests=[],results=[],rendererErrors=[],externalRequests=[];let unsafeMove=false,app,page;
const hash=bytes=>createHash('sha256').update(bytes).digest('base64url').slice(0,22);
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://127.0.0.1').pathname,method=req.method;requests.push({path,method});
 if(req.headers.authorization!=='Basic '+Buffer.from('fixture:local-password').toString('base64')){res.writeHead(401);res.end();return;}
 const parent=new URL('./','http://127.0.0.1'+(path.endsWith('/')?path.slice(0,-1):path)).pathname,current=files.get(path);
 if(method==='MKCOL'){if(!folders.has(parent)){res.writeHead(409);res.end();return;}const exists=folders.has(path);folders.add(path);res.writeHead(exists?405:201);res.end();return;}
 if(!folders.has(parent)){res.writeHead(409);res.end();return;}
 if(method==='GET'){res.writeHead(current?200:404,current?{ETag:hash(current),'Content-Length':current.length}:{});res.end(current);return;}
 if(method==='HEAD'){res.writeHead(current?200:404);res.end();return;}
 if(method==='PUT'){
  if(req.headers['if-match']&&req.headers['if-match']!==(current&&hash(current))){res.writeHead(412);res.end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);files.set(path,bytes);res.writeHead(current?204:201);res.end();return;
 }
 if(method==='MOVE'){const dest=new URL(req.headers.destination).pathname;if(!current){res.writeHead(404);res.end();return;}if(req.headers.overwrite==='F'&&files.has(dest)&&!unsafeMove){res.writeHead(409);res.end();return;}files.set(dest,current);files.delete(path);res.writeHead(201);res.end();return;}
 if(method==='DELETE'){files.delete(path);res.writeHead(204);res.end();return;}res.writeHead(405);res.end();
}catch{res.writeHead(500);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const localOrigin='http://127.0.0.1:'+server.address().port;
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const record=name=>{results.push(name);console.log('PASS '+name)};
const panel=()=>page.getByRole('region',{name:'WebDAV 备份与多电脑接续',exact:true});
async function settings(){await navigateDesktop(page,'设置',{expandSettings:false,settingsTab:'数据与同步'});await panel().getByRole('button',{name:'WebDAV 备份与多电脑接续',exact:true}).click();}
async function launch(){
 if(app)await app.close();app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:data,RECLIMB_DEV_URL:''},timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);await applyDesktopTestWindow(app,page);
 await app.evaluate((_electron,origin)=>{const real=globalThis.fetch;globalThis.fetch=(input,options)=>{const url=new URL(String(input));if(url.origin!=='https://dav.jianguoyun.com')throw new Error('Test blocked nonfixture network');return real(origin+url.pathname,options);};},localOrigin);
 page.on('pageerror',e=>rendererErrors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(new URL(r.url()).origin)});
 await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
try{
 await launch();await api('sample.seed');await api('session.saveDraft',{id:'sample-reasoning-session',draft:'合成主任务草稿'});await settings();
 await panel().getByLabel('WebDAV 目录地址').fill('https://dav.jianguoyun.com/dav/');
 await panel().getByLabel('WebDAV 用户名').fill('fixture');await panel().getByLabel('WebDAV 密码').fill('local-password');await panel().getByRole('button',{name:'保存本机同步连接'}).click();await panel().getByRole('button',{name:'修改连接',exact:true}).waitFor();
 await panel().getByRole('button',{name:'检查远端更新'}).click();await panel().getByText('远端空间没有快照，可以主动上传当前档案。',{exact:true}).waitFor();assert.equal(requests.some(r=>r.method==='PUT'),false);record('配置与检查只准备目录，不提前上传学习档案');
 await panel().getByRole('button',{name:'上传当前完整档案'}).click();await panel().getByText('本机与上次同步版本一致。',{exact:true}).waitFor();assert.equal(files.has('/dav/reclimb-sync/v1/reclimb/head.json'),true);
 assert.equal(requests.some(r=>r.method==='PUT'&&r.path.endsWith('/head.json')),false);assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'合成主任务草稿');record('原样版本标记与禁止覆盖发布成功，主任务草稿完整');
 await api('session.saveDraft',{id:'sample-reasoning-session',draft:'新的合成推导'});await panel().getByRole('button',{name:'检查远端更新'}).click();await panel().getByText('本机有尚未上传的修改。',{exact:true}).waitFor();await panel().getByRole('button',{name:'上传当前完整档案'}).click();await panel().getByText('本机与上次同步版本一致。',{exact:true}).waitFor();assert.equal([...files.keys()].filter(p=>p.endsWith('.reclimb')).length,2);record('后续更新使用条件写入，历史完整备份保留');
 await launch();await settings();await api('session.saveDraft',{id:'sample-reasoning-session',draft:'待重试的合成草稿'});await panel().getByRole('button',{name:'检查远端更新'}).click();await panel().getByText('本机有尚未上传的修改。',{exact:true}).waitFor();unsafeMove=true;await panel().getByRole('button',{name:'上传当前完整档案'}).click();await panel().getByRole('alert').filter({hasText:'防覆盖'}).waitFor();await page.waitForFunction(()=>document.querySelector('.webdav-sync-card .sync-status')?.textContent.includes('防覆盖'));
 const failed=await api('sync.status');assert.equal(failed.state,'unsupported');assert.ok(failed.pendingUploadRequestId);assert.equal(await panel().getByRole('button',{name:'重试上传同一快照'}).isDisabled(),true);assert.equal([...files.keys()].filter(p=>p.endsWith('.reclimb')).length,2);record('防覆盖核对失败显示具体原因，状态同步暂停，保留待上传快照');
 unsafeMove=false;await launch();await settings();await panel().getByRole('button',{name:'检查远端更新'}).click();await panel().getByText('本机有尚未上传的修改。',{exact:true}).waitFor();assert.equal((await api('sync.status')).pendingUploadRequestId,failed.pendingUploadRequestId);
 await api('session.saveDraft',{id:'sample-reasoning-session',draft:'上传失败后继续写的草稿'});await panel().getByRole('button',{name:'重试上传同一快照'}).click();await panel().getByText('本机有尚未上传的修改。',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.webdav-sync-card .sync-actions')?.textContent.includes('上传当前完整档案'));
 assert.equal((await api('sync.status')).pendingUploadRequestId,undefined);assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'上传失败后继续写的草稿');assert.equal([...files.keys()].filter(p=>p.endsWith('.reclimb')).length,3);record('重启后重试原快照不重复记录，后写的草稿不会被覆盖');
 const diagnostics=await api('diagnostics.preview'),dav=diagnostics.entries.filter(e=>e.kind==='webdav');assert.ok(dav.length>0);assert.ok(dav.some(e=>e.status==='transport_error'));assert.ok(dav.filter(e=>!JSON.parse(e.response).error).every(e=>e.status==='valid'));
 for(const forbidden of ['local-password','合成主任务草稿','Authorization'])assert.equal(JSON.stringify(dav).includes(forbidden),false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,800));await panel().scrollIntoViewIfNeeded();await panel().screenshot({path:join(artifacts,'webdav.png')});
 assert.deepEqual(rendererErrors,[]);assert.deepEqual(externalRequests,[]);assert.equal((await api('workspace.snapshot')).usage.length,0);record('诊断区分预期拒绝与真实失败，无学习正文或凭据，无模型费用');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(app)await app.close();await new Promise(done=>server.close(done));}
assert.equal(results.length,6);writeFileSync(join(artifacts,'desktop-verification-v052.json'),JSON.stringify({at:new Date().toISOString(),passed:results.length,results,localMockRequests:requests.length,externalRequests,rendererErrors,executable:executable||'development-electron'},null,2));
