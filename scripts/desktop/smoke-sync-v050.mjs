// Two independent installations, self-authored data, loopback WebDAV; no model calls.
import {_electron as electron} from 'playwright';
import {applyDesktopTestWindow,navigateDesktop,selectSettingsTab} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd(),executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v050-sync');mkdirSync(artifacts,{recursive:true});
const stamp=Date.now(),devices=['A','B'].map(name=>({name,directory:resolve('.test-data/sync-v050-'+stamp+'-'+name)}));
const files=new Map(),results=[],rendererErrors=[],externalRequests=[];let app,page,networkRequests=0;
const hash=bytes=>'"'+createHash('sha256').update(bytes).digest('hex')+'"';
const server=createServer(async(req,res)=>{
 try{
  networkRequests++;if(req.headers.authorization!=='Basic '+Buffer.from('local:local-sync-test').toString('base64')){res.writeHead(401);res.end();return;}
  const path=new URL(req.url,'http://127.0.0.1').pathname,current=files.get(path);
  if(req.method==='MKCOL'){res.writeHead(201);res.end();return;}
  if(req.method==='GET'){if(!current){res.writeHead(404);res.end();return;}res.writeHead(200,{ETag:hash(current),'Content-Length':current.length});res.end(current);return;}
  if(req.method==='PUT'){
   if(req.headers['if-none-match']==='*'&&current||req.headers['if-match']&&(!current||req.headers['if-match']!==hash(current))){res.writeHead(412);res.end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);files.set(path,bytes);res.writeHead(current?204:201,{ETag:hash(bytes)});res.end();return;
  }
  if(req.method==='DELETE'){files.delete(path);res.writeHead(204);res.end();return;}res.writeHead(405);res.end();
 }catch{res.writeHead(500);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const endpoint='http://127.0.0.1:'+server.address().port+'/dav/';
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const record=name=>{results.push(name);console.log('PASS '+name)};
async function launch(device){
 if(app)await app.close();mkdirSync(device.directory,{recursive:true});
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:device.directory,RECLIMB_DEV_URL:''},timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(22000);await applyDesktopTestWindow(app,page);page.on('pageerror',e=>rendererErrors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(new URL(r.url()).origin)});await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
async function configure(device){await api('sync.configure',{endpoint,username:'local',password:'local-sync-test',vaultId:'original-fixture',deviceName:device.name,allowInsecureHTTP:true});}
const original='电脑 A 原创推导：$f(x)=2x+1$。草稿尚未写完。';
try{
 await launch(devices[0]);await api('sample.seed');await api('session.saveDraft',{id:'sample-reasoning-session',draft:original});await configure(devices[0]);
 const board=await api('handwriting.start',{host:'127.0.0.1'}),pairUrl=new URL(board.urls[0]);
 const tablet=async(path,body,token)=>{const response=await fetch(pairUrl.origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:pairUrl.origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const pairing=await tablet('/api/pair',{ticket:new URLSearchParams(pairUrl.hash.slice(1)).get('ticket'),name:'原创同步平板'});await api('handwriting.approve',{id:pairing.requestId});const permission=await tablet('/api/pair/status',{requestId:pairing.requestId,pollToken:pairing.pollToken});
 const target=(await api('handwriting.target',{sessionId:'sample-reasoning-session'})).target;
 await tablet('/api/submit',{requestId:'sync-ink-original',targetId:target.id,pages:[{id:'sync-page',width:768,height:1024,strokes:[{id:'sync-stroke',color:'#253e31',width:3,points:[{x:.1,y:.2,pressure:.5},{x:.3,y:.4,pressure:.7}]}]}],note:'跨电脑保留的原创手写'},permission.token);
 const ink=(await api('handwriting.list',{sessionId:'sample-reasoning-session'}))[0].record;await api('handwriting.saveDraft',{handwritingId:ink.id,text:'尚未确认的核对稿',unresolved:true});
 let status=await api('sync.check');assert.equal(status.state,'remote_empty');status=await api('sync.upload',{requestId:'upload-a-1',expectedRemoteSnapshotId:null});assert.equal(status.state,'up_to_date');const firstHead=status.remote.snapshotId;
 const count=files.size;await api('sync.upload',{requestId:'upload-a-1',expectedRemoteSnapshotId:null});assert.equal(files.size,count);record('完整档案显式上传，条件写入发布，重复请求复用同一快照');
 await launch(devices[1]);await configure(devices[1]);let local=await api('workspace.snapshot');const editable={...local.settings.modelProfiles[0],baseUrl:'https://b-device.invalid/v1',name:'B 本机模型',model:'b-local'};delete editable.hasApiKey;
 await api('settings.modelProfile.save',{profile:editable,apiKey:'b-device-only-key'});await api('settings.save',{settings:{monthlyBudgetCny:2}});
 status=await api('sync.check');assert.equal(status.state,'unlinked');let preview=await api('sync.preview',{snapshotId:firstHead});assert.ok(preview.summary.projects>=2);assert.equal(preview.requiresReplaceConfirmation,true);
 await api('sync.adopt',{previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:firstHead,allowReplaceLocal:true});
 local=await api('workspace.snapshot');assert.equal(local.sessions.find(s=>s.id==='sample-reasoning-session').draft,original);assert.equal(local.settings.baseUrl,'https://b-device.invalid/v1');assert.equal(local.settings.hasApiKey,true);assert.equal(local.settings.monthlyBudgetCny,2);assert.equal((await api('handwriting.read',{id:ink.id})).pages[0].strokes[0].points.length,2);assert.equal((await api('handwriting.draft',{handwritingId:ink.id})).text,'尚未确认的核对稿');record('另一独立安装预览接续完整学习档案，保留本机模型密钥、预算和原草稿');
 await api('session.saveDraft',{id:'sample-reasoning-session',draft:original+' B 补写'});status=await api('sync.check');assert.equal(status.state,'local_ahead');status=await api('sync.upload',{requestId:'upload-b-1',expectedRemoteSnapshotId:firstHead});const secondHead=status.remote.snapshotId;
 await launch(devices[0]);status=await api('sync.check');assert.equal(status.state,'remote_ahead');preview=await api('sync.preview',{snapshotId:secondHead});assert.equal(preview.requiresReplaceConfirmation,false);
 await navigateDesktop(page,'设置',{settingsTab:'数据与同步'});const panel=page.getByRole('region',{name:'WebDAV 备份与多电脑接续'});await panel.getByRole('button',{name:'检查远端更新'}).click();await panel.getByText(/远端有新版本/).waitFor();await panel.getByRole('button',{name:'预览远端档案'}).click();await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('learning:request');let failReads=0;ipcMain.removeHandler('learning:request');ipcMain.handle('learning:request',async(event,action,payload)=>{if(action==='workspace.snapshot'&&failReads>0){failReads--;throw new Error('模拟已接续后的读取失败');}const result=await original(event,action,payload);if(action==='sync.adopt'&&result.restored)failReads=2;return result;});});
 await panel.getByRole('button',{name:'采用这份档案继续学习'}).click();await page.getByRole('button',{name:'重新连接',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).count(),0);await page.getByRole('button',{name:'重新连接',exact:true}).click();await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
 await navigateDesktop(page,'学习桌');assert.equal(await page.getByRole('textbox',{name:'我的尝试',exact:true}).inputValue(),original+' B 补写');
 local=await api('workspace.snapshot');assert.equal(local.sessions.find(s=>s.id==='sample-reasoning-session').draft,original+' B 补写');assert.notEqual(local.settings.baseUrl,'https://b-device.invalid/v1');assert.ok(readdirSync(devices[0].directory).some(name=>name.startsWith('previous-')));record('实际界面采用后读取失败先清旧草稿，重新连接恢复远端新稿且不引入远端端点');
 await api('session.saveDraft',{id:'sample-reasoning-session',draft:'A 分叉稿'});await launch(devices[1]);await api('session.saveDraft',{id:'sample-reasoning-session',draft:'B 分叉稿'});status=await api('sync.check');await api('sync.upload',{requestId:'upload-b-2',expectedRemoteSnapshotId:status.remote.snapshotId});
 await launch(devices[0]);status=await api('sync.check');assert.equal(status.state,'conflict');await assert.rejects(()=>api('sync.upload',{requestId:'conflict-upload',expectedRemoteSnapshotId:status.remote.snapshotId}));assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'A 分叉稿');
 preview=await api('sync.preview',{snapshotId:status.remote.snapshotId});await api('session.saveDraft',{id:'sample-reasoning-session',draft:'A 预览后又补写'});await assert.rejects(()=>api('sync.adopt',{previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId,allowReplaceLocal:true}));assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'A 预览后又补写');record('两端同时修改进入冲突，上传及过期预览均不能覆盖新作答');
 await navigateDesktop(page,'设置');await page.getByRole('button',{name:'深色',exact:true}).click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,820));await selectSettingsTab(page,'数据与同步');const narrowPanel=page.getByRole('region',{name:'WebDAV 备份与多电脑接续'});await narrowPanel.scrollIntoViewIfNeeded();assert.ok(await narrowPanel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await narrowPanel.screenshot({path:join(artifacts,'webdav-dark-narrow.png')});
 await launch(devices[0]);assert.equal((await api('sync.status')).configured,true);assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'A 预览后又补写');assert.deepEqual(rendererErrors,[]);assert.deepEqual(externalRequests,[]);record('同步连接和冲突草稿重启保持，深色窄窗可操作，无外部模型或私人数据请求');
 await app.close();app=undefined;writeFileSync(join(devices[0].directory,'webdav-sync/webdav-state.json'),'{damaged local config');await launch(devices[0]);assert.equal((await api('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session').draft,'A 预览后又补写');await assert.rejects(()=>api('sync.status'));record('本机同步设置损坏时仍能打开完整学习档案，错误仅影响同步入口');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(app)await app.close();await new Promise(done=>server.close(done));writeFileSync(join(artifacts,'desktop-sync-v050.json'),JSON.stringify({at:new Date().toISOString(),passed:results.length,results,localMockRequests:0,webdavRequests:networkRequests,externalRequests,rendererErrors,limitations:['Loopback WebDAV server and two isolated installations; a real configured WebDAV service remains untested.']},null,2));}
