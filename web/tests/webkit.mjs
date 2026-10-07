// Optional Safari-engine check. Install Playwright locally as documented in README.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.tools/browsers');
const { webkit } = await import('../../.tools/browser/node_modules/playwright/index.mjs');
const root=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')) {res.writeHead(403).end();return;}
  try {
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]||'text/plain');
    res.end(await readFile(path));
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await webkit.launch({headless:true});
  const context=await browser.newContext({isMobile:true,hasTouch:true,viewport:{width:390,height:844},deviceScaleFactor:3});
  const page=await context.newPage();const errors=[];const requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(origin+'/advanced.html');
  for(const width of [320,375,390,768]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('input,select,textarea,button')].some(e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height<44)),false);
  }
  await page.setViewportSize({width:390,height:844});
  for(const [game,ranges,equities] of [
    ['holdem','AsAh\nKsKh',[100,0]],['omaha','As2cJhJd\nAh2dKsKh',[100,0]],['omaha8','As2cJhJd\nAh2dKsKh',[75,25]],
  ]){
    await page.locator('#game').selectOption(game);await page.locator('#ranges').fill(ranges);
    await page.locator('#board').fill(game==='holdem'?'2c3d4h8s9c':'3d4h8sJcQd');
    await page.locator('#method').selectOption('exact');await page.locator('#run').tap();
    await page.waitForFunction(()=>!document.getElementById('run').disabled);
    assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows=>rows.map(r=>parseFloat(r.children[1].textContent))),equities);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.screenshot({path:'/tmp/poker-mobile-webkit.png',fullPage:true});
  // Actual asynchronous browser API: three players, seeded worker reuse, and errors.
  const api=await page.evaluate(async()=>{
    const {Calculator}=await import('./poker.js');
    const calc=new Calculator({Hero:'AA',Villain:'KK',Third:'QQ'});
    try {
      const a=await calc.simulate({samples:10000,seed:42n});
      const b=await calc.simulate({samples:10000,seed:42n});
      let error='';try{await calc.equity({samples:0});}catch(e){error=e.message;}
      return {same:JSON.stringify(a.players)===JSON.stringify(b.players),sum:a.players.reduce((s,p)=>s+p.equity,0),labels:a.labels,error};
    }finally{calc.dispose();}
  });
  assert.equal(api.same,true);assert.ok(Math.abs(api.sum-1)<1e-12);assert.deepEqual(api.labels,['Hero','Villain','Third']);assert.ok(api.error.includes('samples'));
  await page.locator('#game').selectOption('holdem');await page.locator('#ranges').fill('AA\nKK');await page.locator('#board').fill('');
  await page.locator('#method').selectOption('monte_carlo');await page.locator('#samples').fill('1000000000');
  await page.locator('#run').tap();await page.locator('#cancel').tap();
  await page.waitForFunction(()=>!document.getElementById('run').disabled);
  assert.equal(await page.locator('#status').textContent(),'Calculation cancelled');
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(origin+'/')));
  console.log('WebKit: mobile layouts, touch calculation, all games, reusable seeded workers, validation, and cancellation passed.');
}finally{await browser?.close();server.close();}
