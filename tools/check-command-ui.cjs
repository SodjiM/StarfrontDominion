// Run against a disposable seeded server: UI_TEST_URL=http://127.0.0.1:3107 node tools/check-command-ui.cjs
const assert=require('node:assert/strict');
const path=require('node:path');
const { chromium }=require(process.env.PLAYWRIGHT_PATH || '/Users/jared/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.UI_TEST_URL || 'http://127.0.0.1:3107';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const response=await context.request.post(base+'/auth/login',{data:{username:'family-alice',password:'family-test'}});
  assert(response.ok(),'Fixture login failed'); const user=await response.json();
  await context.addInitScript(u=>{localStorage.setItem('userId',String(u.userId));localStorage.setItem('username',u.username);localStorage.setItem('music.enabled','false');},user);
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('browser error:',m.text());});
  page.on('requestfailed',r=>console.log('failed:',r.url(),r.failure()?.errorText));
  await page.goto(base+'/game.html?id=1');
  await page.waitForFunction(()=>window.gameClient?.gameState?.sector).catch(async e=>{console.log({url:page.url(),errors,state:await page.evaluate(()=>({client:!!window.gameClient,state:window.gameClient?.gameState,session:!!window.Session})),body:(await page.locator('body').innerText()).slice(0,1200)});throw e;});
  await page.waitForTimeout(700);
  await page.locator('#centerActiveShipHeaderBtn').click();
  assert(await page.evaluate(()=>window.gameClient.miniCanvas!==window.gameClient.canvas),'Main canvas bound as minimap');
  const dock=await page.locator('.mobile-command-dock > button').allTextContents();
  assert.deepEqual(dock.map(t=>t.trim()),['Fleet','Details','Comms','Command']);
  await page.locator('#menuBtn').click();
  const menu=page.locator('#utilityMenu'); await menu.waitFor({state:'visible'});
  assert(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+20));}),'Menu is covered by another layer');
  await page.screenshot({path:'/tmp/starfront-desktop.png'});
  await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
  assert.equal(await page.locator('#menuBtn').evaluate(el=>el===document.activeElement),true);
  await page.locator('#turnCounter').click();await page.locator('#turnActivityDialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.activity-list')?.getAttribute('aria-busy')==='false');
  await page.screenshot({path:'/tmp/starfront-activity.png'});await page.keyboard.press('Escape');
  for(const name of ['fleet','details','comms','command']) {
   await page.locator(`[data-open-panel="${name}"]`).last().click();
   assert(await page.locator(`[data-mobile-panel="${name}"]`).isVisible(),name+' panel did not open');
   await page.keyboard.press('Escape');
  }
  await page.locator('[data-open-panel="comms"]').last().click();
  await page.locator('[data-comms-tab="players"]').click();
  await page.waitForFunction(()=>document.getElementById('commsPlayers')?.textContent.includes('family-alice'));
  await page.keyboard.press('Escape');
  for(const width of [768,390,320]) {
   await page.setViewportSize({width,height:844});
   await page.waitForTimeout(100);
   assert(await page.locator('#centerActiveShipBtn').isVisible(),'Mobile focus missing');
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) console.log('overflow',width,await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(e=>({tag:e.tagName,id:e.id,cls:e.className,r:e.getBoundingClientRect()})).filter(e=>e.r.right>innerWidth+1||e.r.left< -1).map(e=>({id:e.id,cls:e.cls,left:e.r.left,right:e.r.right})).slice(0,25)));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Horizontal overflow at '+width);
   await page.locator('#menuBtn').click();assert(await menu.isVisible());
   assert(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+20));}));
   await page.screenshot({path:'/tmp/starfront-mobile-'+width+'.png'});await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);console.log('PASS desktop/mobile shell, menu layering/focus, activity dialog, panels, Players, overflow');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
