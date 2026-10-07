// Real Chromium integration check; no browser automation dependencies required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(new URL('..', import.meta.url).pathname);
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const file = path.endsWith('/') ? path + 'index.html' : path;
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm'})[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'poker-browser-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],
  {stdio:['ignore','ignore','pipe']});
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
    let output = '';
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    chrome.on('error', reject);
  });
  const pages = await (await fetch(endpoint.replace(/^ws:/,'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0; const pending = new Map();
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data), waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve,reject) => {
    const id = ++next; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.navigate',{url:origin+'/advanced.html'});
  for (let i=0; i<100 && !await evaluate("!!document.getElementById('form')?.onsubmit"); i++) await delay(50);
  for (const width of [320,375,390,768]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:2,mobile:true});
    assert.deepEqual(await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,
      smallTargets:[...document.querySelectorAll('input,select,textarea,button')].some(e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height<44)})`),
      {overflow:false,smallTargets:false});
  }
  for (const [game,ranges,board,equities] of [
    ['holdem','AsAh\nKsKh','2c3d4h8s9c',[100,0]],
    ['omaha','As2cJhJd\nAh2dKsKh','3d4h8sJcQd',[100,0]],
    ['omaha8','As2cJhJd\nAh2dKsKh','3d4h8sJcQd',[75,25]],
  ]) {
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:2,mobile:true});
    const result = await evaluate(`(async()=>{
      document.getElementById('game').value=${JSON.stringify(game)};
      document.getElementById('ranges').value=${JSON.stringify(ranges)};
      document.getElementById('board').value=${JSON.stringify(board)};
      document.getElementById('method').value='exact';
      document.getElementById('form').requestSubmit();
      for(let i=0;i<400 && document.getElementById('run').disabled;i++) await new Promise(r=>setTimeout(r,25));
      return {status:document.getElementById('status').textContent,
        equities:[...document.querySelectorAll('tbody tr')].map(r=>parseFloat(r.children[1].textContent)),
        overflow:document.documentElement.scrollWidth>innerWidth,
        mobileCards:getComputedStyle(document.querySelector('tbody tr')).display==='grid'};
    })()`);
    assert.deepEqual(result.equities,equities,JSON.stringify(result)); assert.equal(result.overflow,false); assert.equal(result.mobileCards,true);
  }
  const cancelled = await evaluate(`(async()=>{
    document.getElementById('game').value='holdem';document.getElementById('ranges').value='AA\\nKK';
    document.getElementById('board').value='';document.getElementById('method').value='monte_carlo';
    document.getElementById('samples').value='1000000000';document.getElementById('form').requestSubmit();
    await new Promise(r=>setTimeout(r,100));document.getElementById('cancel').click();
    await new Promise(r=>setTimeout(r,25));return {status:document.getElementById('status').textContent,enabled:!document.getElementById('run').disabled};
  })()`);
  assert.deepEqual(cancelled,{status:'Calculation cancelled',enabled:true});
  console.log('Browser: mobile layouts, all three games, worker execution and responsive cancellation passed.');
} finally {
  socket?.close(); chrome.kill(); server.close();
  await new Promise(r => chrome.exitCode !== null ? r() : chrome.once('exit',r));
  await rm(profile,{recursive:true,force:true});
}
