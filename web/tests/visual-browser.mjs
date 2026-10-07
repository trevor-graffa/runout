import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.tools/browsers');
const {webkit,chromium}=await import('../../.tools/browser/node_modules/playwright/index.mjs');
const root=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css'})[extname(path)]||'text/plain');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
try{
for(const [name,type,launch] of [['chrome',chromium,{channel:'chrome'}],['webkit',webkit,{}]]){
  if(process.argv.includes('--webkit-only')&&name!=='webkit')continue;
  const browser=await type.launch({headless:true,...launch});
  try{
    const page=await browser.newPage({isMobile:true,hasTouch:true,viewport:{width:390,height:844},deviceScaleFactor:2});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const open=async()=>{await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.querySelectorAll('#matrix button').length===169);};
    await open();
    for(const width of [320,375,390,768,1100]){
      await page.setViewportSize({width,height:844});
      const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>!e.closest('.matrix')&&e.getBoundingClientRect().right>innerWidth+.5).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,15)}));
      assert.ok(layout.width<=layout.viewport,`${name} overflow at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button,input,select')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height<44;})),false);
    }
    for(const [width,height] of [[320,568],[375,667],[390,844]]){
      await page.setViewportSize({width,height});
      const clipped=await page.evaluate(()=>[...document.querySelectorAll('.shell button,.shell a')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.bottom>innerHeight+.5||r.top<0);}).map(e=>e.id||e.textContent));
      assert.deepEqual(clipped,[],`${name}: clipped controls at ${width}×${height}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-edit="0"]').tap();
    await page.locator('[data-preset="balanced"]').tap();assert.ok((await page.locator('#range-count').textContent()).startsWith('104'));
    await page.locator('[data-hand="AA"]').tap();assert.ok((await page.locator('#range-count').textContent()).startsWith('104'));await page.locator('#remove-selection').tap();assert.ok((await page.locator('#range-count').textContent()).startsWith('98'));
    assert.equal(await page.locator('#holdem-editor .matrix-scroll').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    // Drag stages the entire visited path; committing is a separate action.
    await page.locator('[data-preset="clear"]').tap();
    const boxes=await Promise.all(['AA','AKs','AQs'].map(h=>page.locator(`[data-hand="${h}"]`).boundingBox()));
    if(name==='chrome'){
      const cdp=await page.context().newCDPSession(page);
      const touch=async(type,b)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:b?[{x:b.x+b.width/2,y:b.y+b.height/2}]:[]});
      await touch('touchStart',boxes[0]);await touch('touchMove',boxes[1]);await touch('touchMove',boxes[2]);await touch('touchEnd');await cdp.detach();
    }else{
      // WebKit's Playwright API has taps; exercise the same pointer path with mouse.
      await page.mouse.move(boxes[0].x+boxes[0].width/2,boxes[0].y+boxes[0].height/2);await page.mouse.down();
      for(const b of boxes.slice(1))await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();
    }
    assert.equal(await page.locator('#matrix .staged').count(),3);
    assert.ok((await page.locator('#range-count').textContent()).includes('Choose a range'));
    await page.locator('#add-selection').tap();assert.ok((await page.locator('#range-count').textContent()).startsWith('14'));
    await page.locator('#show-filters').tap();await page.getByLabel('Required suit 1',{exact:true}).selectOption('h');await page.getByLabel('Required suit 2',{exact:true}).selectOption('s');
    await page.waitForFunction(()=>document.getElementById('range-count').textContent==='1 combinations');
    await page.locator('#cancel-range').tap();
    await page.locator('[data-player="0"]').dblclick();
    assert.ok(await page.locator('#range-editor').evaluate(e=>e.open));
    assert.ok((await page.locator('#range-count').textContent()).startsWith('6'));
    await page.screenshot({path:`/tmp/poker-visual-${name}-holdem-editor.png`,fullPage:true});
    await page.locator('#done-range').tap();
    await page.locator('#add-player').tap();assert.equal(await page.locator('.player-select').count(),3);
    await page.getByLabel('Remove Player 3').tap();assert.equal(await page.locator('.player-select').count(),2);
    await page.locator('[data-game="omaha"]').tap();await page.locator('[data-edit="0"]').tap();await page.locator('[data-texture="connected"]').tap();await page.locator('#show-filters').tap();await page.locator('[data-suitedness="double"]').tap();
    await page.waitForFunction(()=>document.getElementById('range-count').textContent==='360 combinations');
    assert.ok((await page.locator('#advanced-link').getAttribute('href')).includes('game=omaha'));
    assert.ok((await page.locator('#advanced-link').getAttribute('href')).includes('#'));
    await page.locator('#show-hands').tap();await page.locator('[data-build="pairs"]').tap();await page.locator('[data-pair-preset="highonly"]').tap();await page.locator('#show-filters').tap();await page.locator('[data-suitedness="any"]').tap();await page.locator('#show-hands').tap();
    await page.waitForFunction(()=>document.getElementById('range-count').textContent==='135,565 combinations');
    await page.locator('[data-group="1"]').tap();assert.equal(await page.locator('[data-pair-panel="1"]').isVisible(),true);assert.equal(await page.locator('[data-pair-panel="0"]').isVisible(),false);
    await page.locator('#show-filters').tap();await page.locator('[data-connection="high"]').tap();
    await page.waitForFunction(()=>!document.getElementById('range-count').textContent.includes('Counting'));
    await page.screenshot({path:`/tmp/poker-visual-${name}-mobile.png`,fullPage:true});
    await page.locator('#done-range').tap();
    // Exercise the card picker through actual touch events, then compare known equities.
    const pick=async(selector,index,card)=>{
      await page.locator(selector+' button').nth(index).tap();await page.locator(`[data-rank="${card[0]}"]`).tap();await page.locator(`[data-suit="${card[1]}"]`).tap();
    };
    for(const [game,hands,cards,equities] of [
      ['holdem',['AsAh','KsKh'],'2c3d4h8s9c',[100,0]],
      ['omaha',['As2cJhJd','Ah2dKsKh'],'3d4h8sJcQd',[100,0]],
      ['omaha8',['As2cJhJd','Ah2dKsKh'],'3d4h8sJcQd',[75,25]],
    ]){
      await open();await page.locator(`[data-game="${game}"]`).tap();
      for(let p=0;p<2;p++){
        await page.locator(`[data-edit="${p}"]`).tap();await page.locator('[data-mode="cards"]').tap();
        for(let i=0;i<hands[p].length/2;i++)await pick('#hole-cards',i,hands[p].slice(2*i,2*i+2));
        await page.locator('#done-range').tap();
      }
      for(let i=0;i<5;i++)await pick('#board-cards',i,cards.slice(2*i,2*i+2));
      await page.locator('#calculate').tap();await page.waitForFunction(()=>!document.getElementById('calculate').disabled);
      assert.deepEqual(await page.locator('.equity').evaluateAll(rows=>rows.map(r=>parseFloat(r.textContent))),equities,await page.locator('#status').textContent());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.locator('[data-suit="c"]').evaluate(e=>getComputedStyle(e).color),'rgb(25, 134, 82)');
      assert.equal(await page.locator('[data-suit="d"]').evaluate(e=>getComputedStyle(e).color),'rgb(52, 93, 204)');
    }
    await page.screenshot({path:`/tmp/poker-visual-${name}-results.png`,fullPage:true});
    await page.setViewportSize({width:1100,height:900});await open();await page.screenshot({path:`/tmp/poker-visual-${name}-desktop.png`,fullPage:true});
    const progress=await page.evaluate(async()=>{
      const {Calculator}=await import('./poker.js');const c=new Calculator(['AA','KK']);const updates=[];
      try {const final=await c.simulate({samples:100000,seed:42n,onProgress:p=>updates.push({n:String(p.outcomes),done:p.done,equity:p.players.map(v=>v.equity)})});return {updates,n:String(final.outcomes),equity:final.players.map(v=>v.equity)};}finally{c.dispose();}
    });
    assert.ok(progress.updates.length>=3);assert.equal(progress.n,'100000');assert.ok(progress.updates.some(p=>Number(p.n)>0&&Number(p.n)<100000));assert.deepEqual(progress.updates.at(-1).equity,progress.equity);
    assert.deepEqual(errors,[]);console.log(name+': visual presets, Omaha builder, mobile layouts, touch card picking and all game equities passed.');
  }finally{await browser.close();}
}
}finally{server.close();}
