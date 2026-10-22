import assert from 'node:assert/strict';

// Keep CI's smaller desktop reproducible without adding production test hooks.
export async function applyDesktopTestWindow(app,page){
 const width=process.env.RECLIMB_TEST_WINDOW_WIDTH?Number(process.env.RECLIMB_TEST_WINDOW_WIDTH):undefined,height=process.env.RECLIMB_TEST_WINDOW_HEIGHT?Number(process.env.RECLIMB_TEST_WINDOW_HEIGHT):undefined;
 if(width!==undefined)assert.ok(Number.isInteger(width)&&width>=1040&&width<=3840,'Test window width must be an integer between 1040 and 3840');
 if(height!==undefined)assert.ok(Number.isInteger(height)&&height>=720&&height<=2160,'Test window height must be an integer between 720 and 2160');
 if(width||height){const contentSize=await app.evaluate(({BrowserWindow},{width,height})=>{const window=BrowserWindow.getAllWindows()[0],[w,h]=window.getSize();window.setSize(width??w,height??h);return window.getContentSize()},{width,height});await page.waitForFunction(([width,height])=>Math.abs(innerWidth-width)<=1&&Math.abs(innerHeight-height)<=1,contentSize);}
}

export async function leaveDesktopNavigation(page){
 assert.equal(await page.getByRole('dialog').count(),0,'Do not dismiss navigation through another open dialog');
 const sidebar=page.locator('.sidebar');
 const point=await page.evaluate(()=>({x:innerWidth-24,y:24}));await page.mouse.move(point.x,point.y);
 if(await sidebar.evaluate(el=>el.classList.contains('is-pinned')))return;
 // Moving the pointer alone deliberately does not release keyboard focus.
 // Use the supported Escape interaction if navigation still holds that focus.
 if(await sidebar.evaluate(el=>el.classList.contains('is-expanded')&&el.contains(document.activeElement)))await page.keyboard.press('Escape');
 await page.locator('.sidebar.is-collapsed').waitFor();
 await page.waitForFunction(()=>Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-64)<.05);
 assert.equal(await page.getByRole('dialog').count(),0,'Navigation must not open or dismiss a dialog');
}

// Earlier workflow suites exercise the controls after explicitly opening their cards.
export async function openSettingsCards(page){for(const card of await page.locator('.settings-card-toggle:visible').all())if(await card.getAttribute('aria-expanded')==='false')await card.click();}
export async function selectSettingsTab(page,name,{expandSettings=true}={}){
 await page.getByRole('tab',{name,exact:true}).click();
 if(expandSettings)await openSettingsCards(page);
}
export async function navigateDesktop(page,name,{expandSettings=true,settingsTab='学习'}={}){
 assert.equal(await page.getByRole('dialog').count(),0,'Close the current dialog through its real UI before navigating');
 await page.getByRole('button',{name,exact:true}).click();
 await leaveDesktopNavigation(page);
 if(name==='设置')await selectSettingsTab(page,settingsTab,{expandSettings});
}

// 0.6 keeps secondary desk actions available behind native disclosures.
// Workflow suites explicitly open these through their visible summaries.
export async function openDeskDetails(page){
 for(const selector of ['.verification-overview','.next-options','.desk-more','.attempts-history']){
  for(const detail of await page.locator(selector).all())if(await detail.isVisible()&&!(await detail.evaluate(el=>el.open)))await detail.locator(':scope > summary').click();
 }
}


// Open the actual drawer and its requested section through supported user controls.
export async function openDeskTools(page,section){
 const focus=page.getByRole('button',{name:'退出专注作答',exact:true});
 if(await focus.isVisible())await focus.click();
 const drawer=page.getByRole('dialog',{name:'学习工具',exact:true});
 if(!await drawer.isVisible())await page.getByRole('button',{name:/^学习工具/}).click();
 await drawer.waitFor();
 if(section){const details=drawer.locator('details').filter({has:page.locator(':scope > summary').filter({hasText:section})}).first();
  if(!await details.evaluate(element=>element.open))await details.locator(':scope > summary').click();
 }
 return drawer;
}
export async function closeDeskTools(page){
 const drawer=page.getByRole('dialog',{name:'学习工具',exact:true});
 if(await drawer.isVisible())await drawer.getByRole('button',{name:'关闭学习工具',exact:true}).click();
 await drawer.waitFor({state:'hidden'});
}
