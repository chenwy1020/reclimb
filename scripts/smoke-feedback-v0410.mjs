// Handwriting feedback integration: original fixtures, real local persistence, controlled loopback model responses.
import {_electron as electron} from 'playwright';
import {applyDesktopTestWindow,navigateDesktop} from './desktop-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';

const require=createRequire(import.meta.url),root=process.cwd(),executable=process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v0410-feedback');
const dataDirectory=resolve('.test-data/handwriting-feedback-v0410-'+Date.now());
mkdirSync(artifacts,{recursive:true});mkdirSync(dataDirectory,{recursive:true});
const results=[],calls=[],externalRequests=[],rendererErrors=[];let app,page,origin='',failFeedback=false;
const note='我的原稿写了 $f(x)=2x+1$，但图上一个符号仍不清楚。';
const recognized='原稿中的式子：$g(x)=x^2$。\n\n[无法辨认：末尾符号]';
const feedback='原创模拟反馈：可以先核对这一个符号，再说明你如何从两个观测点判断关系。';
const record=name=>{results.push(name);console.log('PASS '+name)};
function payload(body){for(const message of body.messages??[]){if(message.role!=='user')continue;for(const part of typeof message.content==='string'?[message.content]:(message.content??[]).filter(x=>x.type==='text').map(x=>x.text)){try{const data=JSON.parse(part);if(data.operation)return data}catch{}}}throw new Error('Mock did not find a supported operation');}
const server=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),input=payload(body),images=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url');
 for(const image of images)assert.match(image.image_url?.url??'',/^data:image\/png;base64,iVBOR/,'Original vectors must be rendered into real PNG pixels before sending');
 calls.push({operation:input.operation,imageCount:images.length});
 const discussion=['discuss_input','discuss_legacy_handwriting'].includes(input.operation);
 if(discussion&&failFeedback){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'原创模拟服务临时断开，输入应已保存'}}));return;}
 let value;if(discussion)value={text:feedback,sourceIds:(input.sources??[]).slice(0,1).map(s=>s.id),scope:'current_task'};
 else if(input.operation==='handwriting_transcription')value={text:recognized,uncertainties:['末尾符号需要对照原稿'],unresolved:true};
 else throw new Error('Unexpected mocked operation '+input.operation);
 res.writeHead(200,{'Content-Type':'application/json','x-request-id':'local-handwriting-feedback-'+calls.length});res.end(JSON.stringify({model:'local-ink-mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:50,completion_tokens:50}}));
}catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e)}));}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
const api=(action,payload={})=>page.evaluate(({action,payload})=>window.learning.request(action,payload),{action,payload});
const snapshot=()=>api('workspace.snapshot');
const session=async()=>(await snapshot()).sessions.find(s=>s.id==='sample-reasoning-session');
async function launch(){
 app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')),RECLIMB_DATA_DIR:dataDirectory,RECLIMB_DEV_URL:''},timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(22000);await applyDesktopTestWindow(app,page);page.on('pageerror',error=>rendererErrors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))externalRequests.push(new URL(request.url()).origin);});await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();
}
async function desk(){await page.getByRole('button',{name:'继续上次学习',exact:true}).click();await page.getByLabel('当前学习项目').selectOption('sample-reasoning');await page.getByRole('region',{name:'iPad 手写原稿'}).waitFor();}
async function view(n=0){await page.getByRole('button',{name:'查看原稿',exact:true}).nth(n).click();await page.getByRole('dialog',{name:'手写原稿',exact:true}).waitFor();await page.getByLabel('手写核对文本',{exact:true}).waitFor();}
const region=()=>page.getByRole('region',{name:'手写识别与反馈'});
const editor=()=>page.getByLabel('手写核对文本',{exact:true});
const confirmButton=()=>page.getByRole('button',{name:'保存确认文本并获取反馈',exact:true});
const checked=()=>page.getByRole('checkbox',{name:'我已对照原稿核对这份文字；尚不确定的地方已保留并说明',exact:true});
async function json(path,payload,token){const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
try{
 await launch();await api('sample.seed');await api('settings.save',{settings:{monthlyBudgetCny:0}});await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await desk();
 const mainDraft='电脑主任务推导：还没有写完，不能被手写核对文字覆盖。';await page.getByRole('textbox',{name:'我的尝试',exact:true}).fill(mainDraft);await page.waitForFunction(async value=>(await window.learning.request('workspace.snapshot')).sessions.find(s=>s.id==='sample-reasoning-session')?.draft===value,mainDraft);
 const started=await api('handwriting.start',{host:'127.0.0.1'}),link=new URL(started.urls[0]);origin=link.origin;
 const pairing=await json('/api/pair',{ticket:new URLSearchParams(link.hash.slice(1)).get('ticket'),name:'原创反馈验证平板'});await api('handwriting.approve',{id:pairing.requestId});const authorized=await json('/api/pair/status',{requestId:pairing.requestId,pollToken:pairing.pollToken});
 await page.getByRole('button',{name:'iPad 手写',exact:true}).click();await page.getByRole('button',{name:'发送当前任务到 iPad',exact:true}).click();const target=(await api('handwriting.status')).target;
 for(let i=0;i<2;i++)await json('/api/submit',{requestId:'feedback-ink-'+i,targetId:target.id,pages:[{id:'page-'+i,width:768,height:1024,strokes:[{id:'stroke-'+i,color:'#253e31',width:3,points:[{x:.2,y:.2,pressure:.6},{x:.3,y:.4,pressure:.7}]}]}],note:'原创推导原稿 '+i},authorized.token);
 await page.getByRole('button',{name:'查看原稿',exact:true}).nth(1).waitFor();const ink=(await api('handwriting.list',{sessionId:'sample-reasoning-session'})).at(-1).record;
 await view();assert.equal(await page.getByRole('button',{name:'识别这份原稿（计费）',exact:true}).isDisabled(),true);assert.equal(await editor().isEditable(),true);assert.equal(calls.length,0);record('无视觉配置和模型密钥仍可手工核对，原稿保存不产生模型调用');

 await editor().fill(note);await region().getByText('预览文字与公式',{exact:true}).click();await region().locator('.katex').first().waitFor();
 await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();await view();assert.equal(await editor().inputValue(),note,'Unconfirmed local transcription draft must survive closing the original');
 await checked().check();assert.equal(await confirmButton().isEnabled(),true);await confirmButton().click();await region().getByText('记录已保存 · 等待回应',{exact:true}).waitFor();
 let inputs=(await api('handwriting.responses',{handwritingId:ink.id})).filter(m=>m.role==='user');assert.equal(inputs.length,1);assert.equal(inputs[0].text,note);assert.equal(inputs[0].responseMode,'discussion');assert.equal(inputs[0].responseState,'pending');assert.equal((await snapshot()).evidence.length,0);assert.equal((await snapshot()).usage.length,0);record('数学预览和未确认草稿保留，核对文字先保存，默认歧义只进入讨论');

 const alreadySaved=()=>page.getByRole('button',{name:'这份文字已保存，可在下方获取回应',exact:true});assert.equal(await alreadySaved().isDisabled(),true);
 await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();await view();await checked().check();assert.equal(await alreadySaved().isDisabled(),true);assert.equal((await api('handwriting.responses',{handwritingId:ink.id})).filter(m=>m.role==='user').length,1,'Reopening unchanged text must preserve its existing expression without offering a duplicate confirmation');record('保存后和重开原稿不再提供重复确认，原表达及待回应保留');

 await app.close();app=undefined;await launch();await desk();await view();assert.equal(await editor().inputValue(),note);await region().getByText('记录已保存 · 等待回应',{exact:true}).waitFor();assert.equal((await session()).draft,mainDraft);await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();assert.equal(await page.locator('.input-records [data-input-id="'+inputs[0].inputId+'"]').count(),0);record('桌面重启恢复核对文本与待回应，主任务草稿完整，记录不重复出现在顶部');

 let s=await snapshot();const profile=s.settings.modelProfiles.find(p=>p.id===s.settings.activeModelProfileId),{hasApiKey:_,...editable}=profile;
 await api('settings.modelProfile.save',{profile:{...editable,providerName:'原创手写本机模拟',baseUrl,model:'local-ink-mock',maxOutputTokens:6000,inputPriceCnyPerMillion:.1,outputPriceCnyPerMillion:.1,priceUpdatedAt:'本地模拟'},apiKey:'local-v0410-only'});
 await api('settings.save',{settings:{monthlyBudgetCny:100}});await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await desk();await view();failFeedback=true;
 await region().getByRole('button',{name:'获取这条记录的回应',exact:true}).click();await region().getByRole('button',{name:'重试这次回应',exact:true}).waitFor();assert.equal(await editor().inputValue(),note);
 const failedCalls=calls.length;await region().getByRole('button',{name:'重新读取已保存记录（不计费）',exact:true}).click();await editor().waitFor();assert.equal(await editor().inputValue(),note);assert.equal(calls.length,failedCalls);record('读取失败状态的恢复入口只读本机记录，不重发模型、不丢核对文字');failFeedback=false;
 await region().getByRole('button',{name:'重试这次回应',exact:true}).click();await region().getByText(feedback,{exact:true}).waitFor();inputs=(await api('handwriting.responses',{handwritingId:ink.id})).filter(m=>m.role==='user');assert.equal(inputs.length,1);assert.equal(inputs[0].responseState,'completed');assert.equal((await api('handwriting.responses',{handwritingId:ink.id})).filter(m=>m.role==='assistant').length,1);assert.equal((await snapshot()).evidence.length,0);assert.equal((await session()).draft,mainDraft);record('可控模型失败后原记录重试，回应紧跟原表达，未增加能力证据');

 await region().getByText(feedback,{exact:true}).scrollIntoViewIfNeeded();await page.getByRole('dialog',{name:'手写原稿',exact:true}).screenshot({path:join(artifacts,'confirmed-feedback.png')});await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();
 await api('settings.save',{settings:{vision:{enabled:true,providerName:'本机图像模拟',baseUrl,model:'local-ink-mock',inputPriceCnyPerMillion:.1,outputPriceCnyPerMillion:.1,priceUpdatedAt:'本机模拟，不代表服务商价格'}},visionApiKey:'local-v0410-vision-only'});
 await page.reload();await page.getByRole('heading',{name:'你好，今天想往前走哪一步？'}).waitFor();await desk();await view(1);
 await page.getByRole('button',{name:'识别这份原稿（计费）',exact:true}).click();await page.waitForFunction(text=>document.querySelector('[aria-label="手写核对文本"]')?.value===text,recognized);
 assert.equal(await checked().isChecked(),false);assert.equal(await confirmButton().isDisabled(),true);const imageCall=calls.find(c=>c.operation==='handwriting_transcription');assert.equal(imageCall.imageCount,1);
 const other=(await api('handwriting.list',{sessionId:'sample-reasoning-session'}))[0].record;assert.equal((await api('handwriting.responses',{handwritingId:other.id})).length,0);assert.equal((await api('handwriting.transcriptions',{handwritingId:other.id})).filter(v=>v.status==='machine').length,1);record('保存的笔迹经过真实本机PNG生成送入模拟视觉接口，机器文字待核对不自动评价');

 await region().getByText('已保存的机器识别结果',{exact:true}).click();await region().getByText('末尾符号需要对照原稿',{exact:true}).waitFor();await editor().fill('我仍在核对 $g(x)=x^2$，尚未确认。');
 await page.getByRole('button',{name:'关闭手写原稿',exact:true}).click();await navigateDesktop(page,'设置');await page.getByRole('button',{name:'深色',exact:true}).click();await navigateDesktop(page,'学习桌');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1040,800));await view(1);
 assert.equal(await editor().inputValue(),'我仍在核对 $g(x)=x^2$，尚未确认。');await editor().scrollIntoViewIfNeeded();assert.ok(await region().evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.getByRole('dialog',{name:'手写原稿',exact:true}).screenshot({path:join(artifacts,'recognition-dark-narrow.png')});
 assert.ok((await page.locator('.handwriting-original').getAttribute('src')).includes('data:image/svg'));assert.deepEqual(externalRequests,[]);assert.deepEqual(rendererErrors,[]);record('深色窄窗口下核对区与原稿可用，修改未确认文字可恢复，全部模型流量仅回环模拟');
 const tail='我仍在核对 $g(x)=x^2$，尚未确认。最后补写：立即关窗的尾字。',beforeCloseCalls=calls.length;
 await editor().fill(tail);const closed=app.waitForEvent('close',{timeout:20000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=undefined;
 await launch();await desk();await view(1);assert.equal(await editor().inputValue(),tail,'Immediate window close must await the pending transcription draft');assert.equal((await session()).draft,mainDraft);assert.equal(calls.length,beforeCloseCalls);assert.equal(await checked().isChecked(),false);record('尾字输入后立即按真实关窗流程退出，重启恢复完整核对草稿且不自动确认或计费');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(app)await app.close();await new Promise(done=>server.close(done));writeFileSync(join(artifacts,'desktop-feedback-v0410.json'),JSON.stringify({at:new Date().toISOString(),executable:executable||'development-electron',passed:results.length,results,localMockRequests:calls.length,calls,externalRequests,rendererErrors,limitations:['Uses self-authored vectors and controlled loopback model responses; no claim of real OCR accuracy or real model teaching quality.','No private教材, credentials or paid external model requests.']},null,2));}
