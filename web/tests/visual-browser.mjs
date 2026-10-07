// Mobile browser tests for the redesigned UI (index.html, app.js, editor.js ...).
// Usage: node web/tests/visual-browser.mjs [--webkit-only]
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
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'})[extname(path)]||'text/plain');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;

const RANK_WORDS={A:'ace',K:'king',Q:'queen',J:'jack',T:'ten'};
const SUIT_WORDS={c:'clubs',d:'diamonds',h:'hearts',s:'spades'};
const cardLabel=c=>`${RANK_WORDS[c[0]]??c[0]} of ${SUIT_WORDS[c[1]]}`;

async function suite(name,type,launch){
  const isChrome=name==='chrome';
  const browser=await type.launch({headless:true,...launch});
  const errors=[];
  const context=await browser.newContext({isMobile:true,hasTouch:true,viewport:{width:390,height:844},deviceScaleFactor:2});
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  const step=async(label,fn)=>{
    const t=Date.now();
    try{await fn();}catch(e){e.message=`[${name}] ${label}: ${e.message}`;throw e;}
    if(process.env.VERBOSE)console.log(`  ${name} ${label} ${Date.now()-t}ms`);
  };

  // ——— helpers ———
  const ready=()=>page.waitForFunction(()=>document.querySelectorAll('.player').length>=2&&document.getElementById('board-cards').children.length>0);
  const open=async({clear=true}={})=>{
    await page.goto(origin+'/index.html');
    if(clear){await page.evaluate(()=>localStorage.clear());await page.reload();}
    await ready();
  };
  const closed=id=>page.waitForFunction(i=>!document.getElementById(i).open,id);
  const text=sel=>page.locator(sel).first().innerText();
  const summaryOf=i=>page.locator(`[data-player="${i}"] .player-summary`).innerText();
  const combos=async()=>{
    await page.waitForFunction(()=>{const s=document.querySelector('#editor-body .summary-stat small');return s&&/combos?$/.test(s.textContent)&&!/Counting/.test(s.textContent);});
    return Number((await text('#editor-body .summary-stat small')).replace(/[^\d]/g,''));
  };
  // Sheet has the .shown class and has stopped sliding.
  const settled=id=>page.waitForFunction(i=>{
    const d=document.getElementById(i);if(!d.classList.contains('shown'))return false;
    const top=d.getBoundingClientRect().top;const stable=d.__top===top;d.__top=top;return stable;
  },id,{polling:'raf'});
  const openEditor=async i=>{await page.locator(`[data-player="${i}"]`).tap();await page.locator('#editor').waitFor({state:'visible'});await settled('editor');};
  const doneEditor=async()=>{await page.locator('#editor-done').tap();await closed('editor');};
  const cancelEditor=async()=>{await page.locator('#editor-cancel').tap();await closed('editor');};
  const openSettings=async()=>{await page.locator('#open-settings').tap();await settled('settings');};
  const closeSettings=async()=>{await page.locator('#settings-done').tap();await closed('settings');};
  const setSamples=async v=>{await openSettings();await page.locator(`#samples [data-value="${v}"]`).tap();await closeSettings();};
  const openBoard=async()=>{await page.locator('#open-board').tap();await settled('board-sheet');};
  const closeBoard=async()=>{await page.locator('#board-done').tap();await closed('board-sheet');};
  const dealBoard=async cards=>{
    await openBoard();
    for(const c of cards)await page.locator(`#board-deck button[aria-label^="${cardLabel(c)}"]`).tap();
    await closeBoard();
  };
  const equities=()=>page.locator('.equity').evaluateAll(els=>els.map(e=>parseFloat(e.textContent)));
  const waitTag=(tag,timeout=90000)=>page.waitForFunction(t=>[...document.querySelectorAll('#run-status .tag')].some(e=>e.textContent===t),tag,{timeout});
  const center=async sel=>{const b=await page.locator(sel).first().boundingBox();assert.ok(b,sel+' has no box');return {x:b.x+b.width/2,y:b.y+b.height/2};};
  // Touch drag through points. Chrome: real touch events via CDP. WebKit: mouse path (pointer events still fire).
  const drag=async points=>{
    if(isChrome){
      const cdp=await context.newCDPSession(page);
      const send=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y}]:[]});
      await send('touchStart',points[0]);
      for(const p of points.slice(1))await send('touchMove',p);
      await send('touchEnd');await cdp.detach();
    }else{
      await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
      for(const p of points.slice(1))await page.mouse.move(p.x,p.y,{steps:6});
      await page.mouse.up();
    }
  };
  const interpolate=(a,b,n=3)=>Array.from({length:n+1},(_,i)=>({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n}));

  // ——— layout ———
  await step('layout',async()=>{
    await open();
    for(const width of [320,375,390,430])for(const height of [568,667,844]){
      await page.setViewportSize({width,height});
      const tag=`${width}x${height}`;
      const m=await page.evaluate(()=>{
        const vw=innerWidth,vh=innerHeight,root=document.documentElement;
        const inside=sel=>{const r=document.querySelector(sel).getBoundingClientRect();return r.left>=-.5&&r.top>=-.5&&r.right<=vw+.5&&r.bottom<=vh+.5&&r.width>0;};
        const small=[...document.querySelectorAll('.app button,.app a,.app select,.app input')].filter(e=>{
          if(e.closest('.matrix,.deck,.slot,.chip,.suit-chip,.player-delete,.card'))return false;
          const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43.5;
        }).map(e=>`${e.id||e.className||e.tagName}:${e.getBoundingClientRect().height}`);
        return {sw:root.scrollWidth,sh:root.scrollHeight,bw:document.body.scrollWidth,vw,vh,
          fits:['#calculate','.game-picker','#open-settings','#open-board'].map(s=>[s,inside(s)]),small,
          overflowing:[...document.querySelectorAll('.app *')].filter(e=>e.getBoundingClientRect().right>vw+.5).map(e=>e.className||e.tagName).slice(0,5)};
      });
      assert.ok(m.sw<=m.vw&&m.bw<=m.vw,`${tag} horizontal overflow ${JSON.stringify(m)}`);
      assert.ok(m.sh<=m.vh,`${tag} document scrolls: ${m.sh}>${m.vh}`);
      for(const [s,ok] of m.fits)assert.ok(ok,`${tag} ${s} not inside viewport`);
      assert.deepEqual(m.small,[],`${tag} small touch targets`);
      // Editor sheet fits too.
      await openEditor(1);
      const e=await page.evaluate(()=>{
        const vw=innerWidth,body=document.getElementById('editor-body'),d=document.getElementById('editor').getBoundingClientRect();
        const matrix=document.querySelector('#editor .matrix'),mr=matrix.getBoundingClientRect(),cell=matrix.firstChild.getBoundingClientRect();
        const nav=[...document.querySelectorAll('#editor .sheet-nav button')].map(b=>b.getBoundingClientRect().height);
        const small=[...document.querySelectorAll('#editor button,#editor input,#editor select')].filter(x=>{
          if(x.closest('.matrix,.deck,.slot,.chip,.suit-chip,.card,.segmented,.stage-actions,.pick'))return false;
          const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<31.5;}).map(x=>x.id||x.className);
        return {doc:document.documentElement.scrollWidth<=vw,body:body.scrollWidth<=body.clientWidth+1,dialogRight:d.right<=vw+.5,dialogBottom:d.bottom<=innerHeight+.5,
          matrixIn:mr.left>=-.5&&mr.right<=vw+.5,cell:cell.width,nav,small,
          seg:[...document.querySelectorAll('#editor .segmented button,#editor .stage-actions button')].filter(b=>b.getBoundingClientRect().height>0&&b.getBoundingClientRect().height<39.5).length};
      });
      assert.ok(e.doc&&e.body&&e.dialogRight&&e.dialogBottom&&e.matrixIn,`${tag} editor overflow ${JSON.stringify(e)}`);
      assert.ok(e.cell>=18,`${tag} matrix cell too small ${e.cell}`);
      assert.ok(e.nav.every(h=>h>=43.5),`${tag} editor nav buttons ${e.nav}`);
      assert.equal(e.seg,0,`${tag} editor segmented/stage buttons under 40px`);
      assert.deepEqual(e.small,[],`${tag} editor small targets`);
      await cancelEditor();
    }
    await page.setViewportSize({width:390,height:844});
  });

  // ——— calculation ———
  await step('calculate monte carlo',async()=>{
    await open();
    await page.evaluate(()=>{
      window.__seen={stop:false,pct:false};
      const b=document.getElementById('calculate');
      new MutationObserver(()=>{
        const l=document.getElementById('calculate-label').textContent,v=document.getElementById('calculate-value').textContent;
        if(l==='Stop')window.__seen.stop=true;
        if(l==='Stop'&&/^\d+%$/.test(v))window.__seen.pct=true;
      }).observe(b,{subtree:true,childList:true,characterData:true});
    });
    assert.equal(await text('#calculate-label'),'Calculate');
    await page.locator('#calculate').tap();
    await page.waitForFunction(()=>document.getElementById('calculate-label').textContent==='Stop'||document.getElementById('run-status').querySelector('.tag:not(.live)'),null,{timeout:20000}).catch(()=>{});
    await waitTag('Monte Carlo');
    const seen=await page.evaluate(()=>window.__seen);
    assert.ok(seen.stop,'button never showed Stop while running');
    assert.ok(seen.pct,'button never showed a percentage while running');
    assert.equal(await text('#calculate-label'),'Recalculate');
    const eq=await equities();
    assert.equal(eq.length,2);
    assert.ok(Math.abs(eq[0]+eq[1]-100)<0.2,`equities sum ${eq}`);
    assert.ok(eq[0]>0&&eq[1]>0);
    assert.ok((await text('#run-status')).includes('samples'));
  });
  await step('stop partial',async()=>{
    await open();
    await setSamples(20000000);
    await page.locator('#calculate').tap();
    await page.waitForFunction(()=>document.getElementById('calculate-label').textContent==='Stop'&&/^\d+%$/.test(document.getElementById('calculate-value').textContent));
    await page.waitForFunction(()=>/\bof\b/.test(document.getElementById('run-status').textContent)&&document.querySelector('.equity:not(.empty)'));
    await page.locator('#calculate').tap();
    await waitTag('Partial',10000);
    const eq=await equities();
    assert.ok(eq.every(x=>x>0)&&Math.abs(eq[0]+eq[1]-100)<1,`partial numbers kept ${eq}`);
    assert.equal(await text('#calculate-label'),'Recalculate');
  });
  await step('exact board',async()=>{
    await open();
    await dealBoard(['2c','7d','9h','Jc','Qd']);
    assert.ok((await text('#board-caption')).includes('River'));
    await page.locator('#calculate').tap();
    await waitTag('Exact',60000);
    const shown=await equities();
    const expected=await page.evaluate(async()=>{
      const {Calculator}=await import('./poker.js');const {load,expressionFor}=await import('./state.js');
      const s=load();
      const ranges=Object.fromEntries(s.players.map(p=>[p.name,expressionFor(p,s.game)]));
      const c=new Calculator(ranges,{game:s.game,board:s.board.filter(Boolean).join(''),dead:''});
      try{const r=await c.equity({method:'exact'});return r.players.map(p=>p.equity*100);}finally{c.dispose();}
    });
    assert.equal(shown.length,expected.length);
    shown.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=0.011,`exact ${v} vs ${expected[i]}`));
    assert.ok(Math.abs(shown[0]+shown[1]-100)<0.02);
  });

  // ——— editor ———
  await step('editor cancel/done/escape',async()=>{
    await open();
    const before=await summaryOf(1);
    await openEditor(1);
    await page.locator('[data-preset="pairs"]').tap();
    assert.ok((await text('#editor-body .summary-text')).includes('22+'));
    await cancelEditor();
    assert.equal(await summaryOf(1),before,'cancel keeps the range');
    await openEditor(1);
    await page.locator('[data-preset="pairs"]').tap();
    await page.keyboard.press('Escape');
    await closed('editor');
    assert.equal(await summaryOf(1),before,'escape cancels');
    await openEditor(1);
    await page.locator('[data-preset="pairs"]').tap();
    await doneEditor();
    const after=await summaryOf(1);
    assert.notEqual(after,before);assert.ok(after.includes('22+'),after);
  });
  await step('matrix drag staging',async()=>{
    await open();
    await openEditor(1);
    await page.locator('[data-preset="clear"]').tap();
    assert.ok((await text('#editor-body .summary-text')).includes('No hands selected'));
    const a=await center('#editor [data-hand="A5s"]'),b=await center('#editor [data-hand="A2s"]');
    await drag(interpolate(a,b,3));
    const staged=await page.locator('#editor .matrix .staged').evaluateAll(e=>e.map(x=>x.dataset.hand));
    assert.deepEqual(staged.sort(),['A2s','A3s','A4s','A5s']);
    assert.ok((await text('#editor-body .summary-text')).includes('No hands selected'),'range unchanged until Add');
    assert.equal(await page.locator('#editor .matrix .full').count(),0);
    assert.ok((await text('.stage-info')).includes('4 selected'));
    await page.locator('#add-selection').tap();
    assert.equal(await combos(),16);
    assert.equal(await page.locator('#editor .matrix .staged').count(),0);
    const full=await page.locator('#editor .matrix .full').evaluateAll(e=>e.map(x=>x.dataset.hand));
    assert.deepEqual(full.sort(),['A2s','A3s','A4s','A5s']);
    // Staged vs range membership are distinct visual states.
    await page.locator('#editor [data-hand="A5s"]').tap();
    assert.equal(await page.locator('#editor [data-hand="A5s"]').evaluate(e=>[e.classList.contains('staged'),e.classList.contains('full')]+''),'true,true');
    const styles=await page.evaluate(()=>{const g=h=>{const e=document.querySelector(`#editor [data-hand="${h}"]`);const s=getComputedStyle(e);return [s.boxShadow,s.outlineStyle,s.backgroundColor,s.borderColor].join('|');};return [g('A5s'),g('A4s'),g('KQs')];});
    assert.notEqual(styles[0],styles[1],'staged cell looks like a range cell');
    await page.locator('#remove-selection').tap();
    assert.equal(await combos(),12);
    await cancelEditor();
  });
  await step('suit chips',async()=>{
    await open();
    await openEditor(1);
    await page.locator('[data-preset="clear"]').tap();
    await page.locator('#editor [data-hand="AKs"]').tap();
    await page.locator('.suit-chip[aria-label="Suited hearts and hearts"]').tap();
    assert.ok((await text('#editor-body .summary-text')).includes('AhKh'),await text('#editor-body .summary-text'));
    assert.equal(await combos(),1);
    assert.equal(await page.locator('.suit-chip[aria-label="Suited hearts and hearts"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.suit-chip[aria-label="Suited clubs and clubs"]').getAttribute('aria-pressed'),'false');
    await page.locator('.suit-chip[aria-label="Suited spades and spades"]').tap();
    assert.equal(await combos(),2);
    await cancelEditor();
  });
  await step('keyboard',async()=>{
    await open();
    await openEditor(1);
    await page.locator('[data-preset="clear"]').tap();
    await page.locator('#editor [data-hand="AA"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#editor .matrix .staged').count(),1);
    assert.equal(await page.locator('#editor [data-hand="AA"]').getAttribute('class').then(c=>c.includes('staged')),true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.hand),'AKs');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.hand),'KK');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#editor .matrix .staged').count(),2);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#editor .matrix .staged').count(),1,'Enter toggles');
    await cancelEditor();
  });
  await step('top percent slider',async()=>{
    await open();
    await openEditor(1);
    await page.locator('#top-percent').fill('50');
    const pct=parseFloat(await text('#editor-body .summary-stat strong'));
    assert.ok(Math.abs(pct-50)<4,`top 50% gave ${pct}`);
    assert.ok((await text('#editor-body .slider-row output')).startsWith('50'));
    await page.locator('#top-percent').fill('10');
    assert.ok(parseFloat(await text('#editor-body .summary-stat strong'))<14);
    await cancelEditor();
  });
  await step('exact hand mode',async()=>{
    await open();
    await dealBoard(['2c','7d','9h']);
    await openEditor(1);
    await page.locator('[data-mode="cards"]').tap();
    assert.equal(await page.locator('#editor-body .deck button').count(),52);
    for(const c of ['2c','7d','9h'])assert.equal(await page.locator(`#editor-body .deck button[aria-label^="${cardLabel(c)}"]`).isDisabled(),true,c+' should be disabled');
    // Hero's As/Ks are held by another player.
    assert.equal(await page.locator(`#editor-body .deck button[aria-label^="${cardLabel('As')}"]`).isDisabled(),true);
    assert.equal(await page.locator(`#editor-body .deck button[aria-label^="${cardLabel('Qh')}"]`).isDisabled(),false);
    await page.locator(`#editor-body .deck button[aria-label^="${cardLabel('Qh')}"]`).tap();
    await page.locator(`#editor-body .deck button[aria-label^="${cardLabel('Qd')}"]`).tap();
    await doneEditor();
    assert.equal(await page.locator('[data-player="1"] .player-summary .card.mini').count(),2);
    assert.equal(await page.locator('[data-player="1"] .player-summary .card.mini.empty').count(),0);
    // Calculating with two known hands still works.
    await page.locator('#calculate').tap();
    await waitTag('Exact',60000);
  });
  await step('board sheet',async()=>{
    await open();
    await openBoard();
    for(const c of ['Ah','Kd','Qs'])await page.locator(`#board-deck button[aria-label^="${cardLabel(c)}"]`).tap();
    assert.ok((await text('#board-caption')).includes('Flop'));
    assert.ok((await text('#board-hint')).length>0);
    // The hero holds As, so it is unavailable.
    assert.equal(await page.locator(`#board-deck button[aria-label^="${cardLabel('As')}"]`).isDisabled(),true);
    await page.locator('#board-mode [data-target="dead"]').tap();
    await page.locator(`#board-deck button[aria-label^="${cardLabel('3c')}"]`).tap();
    await closeBoard();
    const caption=await text('#board-caption');
    assert.ok(caption.includes('Flop')&&caption.includes('Dead'),caption);
    assert.equal(await page.locator('#board-caption .card.mini').count(),1);
    assert.equal(await page.locator('#board-cards .card:not(.empty)').count(),3);
    // Clear on the board tab empties only the board.
    await openBoard();
    await page.locator('#board-clear').tap();
    assert.equal(await page.locator('#board-cards .card:not(.empty)').count(),0);
    assert.equal(await page.locator('#board-caption .card.mini').count(),1);
    await closeBoard();
  });

  // ——— Omaha ———
  await step('omaha editor',async()=>{
    await open();
    await page.locator('[data-game="omaha"]').tap();
    assert.equal(await page.locator('[data-game="omaha"]').getAttribute('aria-checked'),'true');
    await openEditor(0);
    assert.equal(await page.locator('#editor-body .deck,#editor-body .matrix').count(),0,'hero Omaha defaults to range builder');
    assert.equal(await combos(),864);
    assert.ok((await text('#editor-body .summary-text')).includes('Aces'));
    // Rundown with contradictory highest-card limits.
    await page.locator('[data-family="rundown"]').tap();
    await page.getByLabel('Lowest allowed top card',{exact:true}).selectOption('A',{force:true});
    await page.getByLabel('Highest allowed top card',{exact:true}).selectOption('K',{force:true});
    await page.waitForFunction(()=>document.querySelector('#editor-body .summary.error'));
    const err=await text('#editor-body .summary-text');
    assert.ok(/above|No hands|fit/i.test(err),err);
    assert.ok(await page.locator('#editor-body .section-note.error').count()>0);
    // Fix it: double-suited rundowns exist.
    await page.getByLabel('Highest allowed top card',{exact:true}).selectOption('A',{force:true});
    assert.ok(await combos()>0);
    // Two-card grids builder.
    await page.locator('#editor-body button[data-value="grids"]').tap();
    await page.locator('[data-pair-preset="highlow"]').tap();
    assert.ok(await combos()>0);
    assert.ok((await text('#editor-body .summary-text')).includes('grids'));
    // Custom slots: AKQJ double suited = 36.
    await page.locator('#editor-body button[data-value="family"]').tap();
    await page.locator('[data-family="custom"]').tap();
    for(const [i,r] of ['A','K','Q','J'].entries())await page.getByLabel(`Rank of card ${i+1}`,{exact:true}).selectOption(r,{force:true});
    assert.equal(await combos(),36);
    await page.locator('[data-texture="double"]').tap();
    assert.equal(await combos(),256);
    await cancelEditor();
  });
  await step('hi-lo',async()=>{
    await open();
    await setSamples(100000);
    await page.locator('[data-game="omaha8"]').tap();
    await page.locator('#calculate').tap();
    await waitTag('Monte Carlo',90000);
    const rows=await page.locator('.breakdown').allInnerTexts();
    assert.equal(rows.length,2);
    rows.forEach(r=>assert.ok(r.includes('Scoop')&&r.includes('Lo'),r));
    const eq=await equities();
    assert.ok(Math.abs(eq[0]+eq[1]-100)<0.5,`hi-lo equities ${eq}`);
  });

  // ——— rows, persistence ———
  await step('swipe delete',async()=>{
    await open();
    await page.locator('#add-player').tap();
    assert.equal(await page.locator('.player').count(),3);
    if(isChrome){
      const b=await page.locator('[data-player="2"]').boundingBox();
      const y=b.y+b.height/2,x0=b.x+b.width-40;
      await drag(Array.from({length:8},(_,i)=>({x:x0-i*14,y})));
      await page.waitForFunction(()=>document.querySelector('.player.swiped'));
      assert.equal(await page.locator('.player.swiped').count(),1);
      assert.equal(await page.locator('.player.swiped .player-delete').isVisible(),true);
      assert.equal(await page.locator('#editor').evaluate(e=>e.open),false,'swipe must not open the editor');
      await page.locator('.player.swiped .player-delete').tap();
      await page.waitForFunction(()=>document.querySelectorAll('.player').length===2);
      assert.equal(await page.locator('.player-delete').count(),0,'no delete with 2 players');
    }else{
      console.log('  webkit: swipe-delete skipped (no touch-move API); using editor remove instead');
      await openEditor(2);
      await page.locator('#remove-player').tap();            // arms
      assert.equal(await page.locator('#remove-player').getAttribute('data-armed'),'true');
      await page.locator('#remove-player').tap();            // confirms
      await closed('editor');
      await page.waitForFunction(()=>document.querySelectorAll('.player').length===2);
    }
  });
  await step('persistence',async()=>{
    await open();
    await page.locator('#add-player').tap();
    await dealBoard(['Ah','Kd','Qs','4c']);
    await openEditor(1);await page.locator('[data-preset="suited"]').tap();await doneEditor();
    const summary=await summaryOf(1);
    await page.locator('[data-game="omaha"]').tap();
    await page.locator('[data-game="holdem"]').tap();
    await page.reload();await ready();
    assert.equal(await page.locator('.player').count(),3);
    assert.equal(await summaryOf(1),summary);
    assert.equal(await page.locator('#board-cards .card:not(.empty)').count(),4);
    assert.ok((await text('#board-caption')).includes('Turn'));
    assert.equal(await page.locator('[data-game="holdem"]').getAttribute('aria-checked'),'true');
  });
  await step('reset',async()=>{
    await openSettings();
    await page.locator('#reset-all').tap();await closed('settings');
    assert.equal(await page.locator('.player').count(),2);
    assert.equal(await page.locator('#board-cards .card:not(.empty)').count(),0);
  });

  assert.deepEqual(errors,[],`page errors: ${errors}`);
  await browser.close();
  console.log(`${name}: layout, calculation, exact, editor, matrix, suit chips, keyboard, board, Omaha, Hi-Lo, rows and persistence passed.`);
}

try{
  for(const [name,type,launch] of [['chrome',chromium,{channel:'chrome'}],['webkit',webkit,{}]]){
    if(process.argv.includes('--webkit-only')&&name!=='webkit')continue;
    await suite(name,type,launch);
  }
}finally{server.close();}
