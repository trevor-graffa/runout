import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import init, { NumericCalculator, evaluate, evaluate_high } from '../pkg/poker_engine.js';
import { parseRange, parseCards, GAME_IDS, Range } from '../ranges.js';

await init({ module_or_path: await readFile(new URL('../pkg/poker_engine_bg.wasm', import.meta.url)) });
test('range subset counts and weights match Python conventions', () => {
  for (const [text,n] of [['AA',6],['AKs',4],['AKo',12],['TT+',30],['ATs+',16],['76s-T9s',16],['random',1326],['AA!As',3],['!AA',1320]]) assert.equal(parseRange(text).size,n);
  for (const [text,n] of [['AA',6961],['AA$ds',864],['AA$ss',4392],['AA$r',913],['AxAyxy',864],['random',270725],['(AA,KK)$ds',1722]]) assert.equal(parseRange(text,{game:'omaha'}).size,n);
  assert.deepEqual([...new Set(parseRange('AA@50%,KK').entries.map(([,w]) => w))].sort(),[.5,1]);
  assert.equal(parseRange('AA',{blocked:'As'}).size,3);
  for (const text of ['', 'AA,','(AA','AA@0','20%','AAo','KAs','[AK']) assert.throws(()=>parseRange(text));
  assert.throws(()=>parseCards(['AsAh'])); assert.throws(()=>parseCards('AsAs'));
});
test('WASM evaluates numeric hands with legal Omaha high and low', () => {
  assert.equal(evaluate_high(parseCards('AsKsQsJsTs')) >> 20,8);
  const v = evaluate(2,parseCards('As2cKdKh'),parseCards('3d4h5sQcQd'));
  assert.equal(v[0] >> 20,4); assert.equal(v[1],0x54321);
  assert.throws(()=>evaluate_high(Uint8Array.of(52,1,2,3,4)));
});
function run(ranges,{game='holdem',board='',dead='',exact=true,samples=1000n,seed=123n}={}) {
  const numeric = new NumericCalculator(GAME_IDS[game], ranges.map(r=>parseRange(r,{game}).entries));
  try { return numeric.equity(parseCards(board),parseCards(dead),exact,samples,seed,2000000n,100000n); }
  finally { numeric.free(); }
}
test('WASM computes quartering, card removal, weighted conditional deals and limits', () => {
  let r=run(['As2cJhJd','Ah2dKsKh'],{game:'omaha8',board:'3d4h8sJcQd'});
  assert.deepEqual(r.players.map(p=>p.equity),[.75,.25]); assert.equal(r.outcomes,1n);
  r=run(['AsAh@2,KsKh','AsAd@3,QsQd'],{board:'2c3d4h8s9c'});
  assert.ok(Math.abs(r.players[0].equity-.5)<1e-12); assert.equal(r.outcomes,3n);
  assert.equal(run(['AA','KK'],{board:'As2c3d4h5s'}).outcomes,18n);
  assert.throws(()=>run(['AsAh','AsKh'],{exact:false}));
  assert.deepEqual(run(['AA','KK'],{exact:false}),run(['AA','KK'],{exact:false}));
  assert.ok(Number.isNaN(run(['AA','KK'],{exact:false,samples:1n}).players[0].stderr));
});
test('WASM matches independent Python hand oracles and native Rust random streams', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/parity.json',import.meta.url),'utf8'));
  for(const entry of fixture.ranges){
    const r=parseRange(entry.text,{game:'omaha'});assert.equal(r.size,entry.count);
    assert.equal(createHash('sha256').update(r.entries.map(([m])=>String(m)).join(',')).digest('hex'),entry.sha256);
  }
  for (const hand of fixture.hands) assert.equal(evaluate_high(Uint8Array.from(hand.cards)),hand.high);
  for (const hand of fixture.omaha) {
    const result=evaluate(2,Uint8Array.from(hand.hole),Uint8Array.from(hand.board));
    assert.deepEqual([...result],[hand.high,hand.low]);
  }
  for (const simulation of fixture.simulations) {
    const result=run(simulation.ranges,{game:simulation.game,exact:false,samples:BigInt(simulation.samples),seed:BigInt(simulation.seed)});
    assert.equal(result.outcomes,BigInt(simulation.result.outcomes));
    assert.equal(result.attempts,BigInt(simulation.result.attempts));
    assert.deepEqual(result.players,simulation.result.players);
    const calc=new NumericCalculator(GAME_IDS[simulation.game],simulation.ranges.map(r=>parseRange(r,{game:simulation.game}).entries));
    const session=calc.start(new Uint8Array(),new Uint8Array(),BigInt(simulation.samples),BigInt(simulation.seed),1000000n);
    try {
      assert.throws(()=>session.step(0));let previous=0n,partial;
      while(!session.done){partial=session.step(137);assert.ok(partial.outcomes>previous);assert.ok(partial.outcomes<=BigInt(simulation.samples));previous=partial.outcomes;}
      assert.deepEqual(partial.players,simulation.result.players);assert.equal(partial.attempts,BigInt(simulation.result.attempts));
    }finally{session.free();calc.free();}
  }
});
