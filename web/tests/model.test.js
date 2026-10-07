import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../ranges.js';
import * as m from '../model.js';

const RANK_STR = '23456789TJQKA', SUIT_STR = 'cdhs';
const cardId = (r, s) => RANK_STR.indexOf(r) * 4 + SUIT_STR.indexOf(s);
const comboMask = c => (1n << BigInt(cardId(c[0], c[1]))) | (1n << BigInt(cardId(c[2], c[3])));
const maskSet = set => new Set([...set].map(c => Number(comboMask(c))));
const parsedMasks = text => new Set(parseRange(text).entries.map(([mask]) => mask));
const omahaSize = text => parseRange(text, { game: 'omaha' }).size;

function assertRoundTrip(range) {
  const text = m.holdemShorthand(range);
  if (!range.size) return assert.equal(text, '');
  assert.deepEqual(parsedMasks(text), maskSet(range), text);
}

function prng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('class table', () => {
  assert.equal(m.HAND_CLASSES.length, 169);
  assert.equal(m.HAND_CLASSES.reduce((n, h) => n + h.combos, 0), 1326);
  assert.equal(m.CLASS_BY_TEXT.get('AKs').row, 0);
  assert.equal(m.CLASS_BY_TEXT.get('AKo').row, 1);
});

test('classCombos order, canonical form and sizes', () => {
  assert.deepEqual(m.classCombos('QQ'), ['QcQd', 'QcQh', 'QcQs', 'QdQh', 'QdQs', 'QhQs']);
  assert.deepEqual(m.classCombos('AKs'), ['AcKc', 'AdKd', 'AhKh', 'AsKs']);
  const offsuit = m.classCombos('AKo');
  assert.equal(offsuit.length, 12);
  assert.equal(offsuit[0], 'AcKd');
  assert.equal(offsuit[11], 'AsKh');
  assert.deepEqual(m.comboSuits('AcKd'), ['c', 'd']);
  assert.deepEqual(m.suitPatterns('suited').length, 4);
});

test('withPattern and classState', () => {
  let range = m.fromClasses(['AKs', 'AKo', 'QQ']);
  range = m.withPattern(range, ['AKs', 'AKo', 'QQ'], ['h', 'h'], false);
  assert.deepEqual(m.classState(range, 'AKs'), { count: 3, total: 4 });
  assert.deepEqual(m.classState(range, 'AKo'), { count: 12, total: 12 });
  assert.deepEqual(m.classState(range, 'QQ'), { count: 6, total: 6 });
  range = m.withPattern(range, ['AKo', 'AKs', 'QQ'], ['s', 'c'], false);
  assert.deepEqual(m.classState(range, 'AKo').count, 11);
  assert.deepEqual(m.classState(range, 'QQ').count, 5);
  const back = m.withPattern(range, ['AKo'], ['s', 'c'], true);
  assert.equal(m.classState(back, 'AKo').count, 12);
  assert.equal(m.removeClasses(range, ['QQ']).size, range.size - 5);
  assert.equal(m.addClasses(new Set(), ['AA']).size, 6);
});

test('presets', () => {
  assert.equal(m.holdemPreset('pairs').size, 78);
  assert.equal(m.holdemPreset('suited').size, 312);
  assert.equal(m.holdemPreset('broadway').size, 5 * 6 + 10 * 4 + 10 * 12 + 0);
  assert.equal(m.holdemPreset('all').size, 1326);
  assert.equal(m.holdemPreset('clear').size, 0);
});

test('shorthand spot checks', () => {
  const s = (...t) => m.holdemShorthand(m.fromClasses(t));
  assert.equal(s('AA', 'KK', 'QQ'), 'QQ+');
  assert.equal(s('77', '88', '99'), '77-99');
  assert.equal(s('55'), '55');
  assert.equal(s('AKs', 'AQs', 'AJs', 'ATs'), 'ATs+');
  assert.equal(s('A2s', 'A3s', 'A4s', 'A5s'), 'A2s-A5s');
  assert.equal(s('KQo'), 'KQo');
  assert.equal(s('AA', 'KK', '77', 'AKs', 'KQo'), 'KK+, 77, AKs, KQo');
  assert.equal(m.holdemShorthand(m.holdemPreset('all')), 'random');
  assert.equal(m.holdemShorthand(new Set()), '');
  assert.equal(m.holdemShorthand(new Set(['AhKh', 'QcQs'])), 'AhKh, QcQs');
  assert.throws(() => m.holdemExpression(new Set()), /Choose at least one hand/);
});

test('shorthand round trips for presets and top percent', () => {
  for (const name of ['pairs', 'suited', 'broadway', 'all', 'clear']) assertRoundTrip(m.holdemPreset(name));
  const order = m.HAND_CLASSES.map(h => h.text);
  for (const p of [0, 1, 5, 12.5, 25, 40, 66, 99, 100]) assertRoundTrip(m.topPercent(p, order));
});

test('shorthand round trips for 200 random sets', () => {
  const rand = prng(12345);
  for (let n = 0; n < 200; n++) {
    const density = rand();
    const range = new Set();
    for (const h of m.HAND_CLASSES) {
      const roll = rand();
      if (roll < density * 0.6) m.classCombos(h.text).forEach(c => range.add(c));
      else if (roll < density) m.classCombos(h.text).forEach(c => rand() < 0.5 && range.add(c));
    }
    assertRoundTrip(range);
  }
});

test('topPercent is monotonic and near target', () => {
  const order = m.HAND_CLASSES.map(h => h.text);
  let previous = 0;
  for (let p = 0; p <= 100; p += 2.5) {
    const size = m.topPercent(p, order).size;
    assert.ok(size >= previous, `p=${p}`);
    assert.ok(Math.abs(m.rangePercent(m.topPercent(p, order)) - p) <= 100 * 12 / 1326 + 1e-9);
    previous = size;
  }
  assert.equal(m.topPercent(0, order).size, 0);
  assert.equal(m.topPercent(0.1, order).size, 6);
  assert.equal(m.topPercent(100, order).size, 1326);
  assert.equal(m.rangeCombos(m.topPercent(10, order)), m.topPercent(10, order).size);
});

test('groupPreset', () => {
  const [a, b] = m.groupPreset('any');
  assert.equal(a.size, 169);
  assert.equal(b.size, 169);
  assert.throws(() => m.groupPreset('nope'));
});

test('textures partition all Omaha hands', () => {
  const seen = new Set();
  let total = 0;
  for (const t of m.TEXTURES) {
    const entries = parseRange(t.pattern, { game: 'omaha' }).entries;
    total += entries.length;
    entries.forEach(([mask]) => seen.add(mask));
  }
  assert.equal(total, 270725);
  assert.equal(seen.size, 270725);
});

test('known Omaha counts', () => {
  const count = o => omahaSize(m.omahaExpression(o));
  assert.equal(count({ family: 'aces' }), 6961);
  assert.equal(count({ family: 'aces', textures: ['double'] }), 864);
  assert.equal(count({ family: 'aces', textures: ['single'] }), 4392);
  assert.equal(count({ family: 'aces', textures: ['rainbow'] }), 913);
  assert.equal(count({ family: 'any' }), 270725);
  assert.equal(m.omahaExpression({ family: 'any' }), 'random');
  assert.equal(count({ family: 'any', textures: m.TEXTURES.map(t => t.key) }), 270725);
  assert.equal(count({ family: 'any', textures: ['double', 'single'] }),
    omahaSize('xxyy') + omahaSize('xxyz'));
});

test('connection filters parse', () => {
  for (const c of m.CONNECTIONS) {
    const size = omahaSize(m.omahaExpression({ family: 'bigpairs', connection: c.key, textures: ['double'] }));
    assert.ok(size > 0, c.key);
  }
  const ace = omahaSize(m.omahaExpression({ family: 'any', connection: 'ace' }));
  assert.ok(ace > 0 && ace < 270725);
});

test('required cards', () => {
  const count = required => omahaSize(m.omahaExpression({ family: 'any', required }));
  assert.equal(count([{ rank: 'A', suit: 's' }]), 20825);
  assert.equal(count([{ rank: '*', suit: '*' }]), 270725);
  assert.equal(count([{ rank: 'A', suit: '*' }, { rank: 'A', suit: '*' }]), 6961);
  assert.equal(count([{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }]), 1225);
  assert.equal(count([{ rank: '*', suit: 's' }, { rank: '*', suit: 's' }]), omahaSize('ss'));
  assert.equal(count([{ rank: 'A', suit: '*' }, { rank: '*', suit: 's' }]) > 0, true);
  assert.equal(m.omahaExpression({ family: 'aces', required: [{ rank: 'K', suit: 'h' }] }), 'AA:Kh');
});

test('rundowns', () => {
  const hands = m.rundownHands();
  assert.equal(hands.length, 10);
  assert.deepEqual([hands[0], hands[9]], ['AKQJ', '5432']);
  assert.equal(m.rundownExpression({ highMin: 'T', highMax: 'J' }), '(JT98,T987)');
  assert.ok(m.rundownHands({ gaps: [[1, 2], [1, 2], [1, 2]] }).includes('AQT8'));
  assert.ok(omahaSize(m.omahaExpression({ family: 'rundown' })) > 0);
  assert.throws(() => m.rundownExpression({ highMin: 'A', highMax: 'K' }), /Lowest top card A is above highest top card K/);
  assert.throws(() => m.rundownExpression({ gaps: [[3, 2], [1, 1], [1, 1]] }), /Distance 1: minimum 3 is above maximum 2/);
  assert.throws(() => m.rundownExpression({ highMin: '3', highMax: '4', gaps: [[1, 1], [1, 1], [1, 1]] }),
    /No four distinct ranks fit: highest card 3–4 with distances 1, 1, 1/);
});

test('grid expressions', () => {
  const groups = [new Set(['AA', 'KK']), new Set(['AKs', '72o'])];
  const expr = m.omahaExpression({ builder: 'grids', groups, textures: ['double'] });
  assert.equal(expr, '{AA,KK|AKs,72o}:xxyy');
  assert.ok(omahaSize(expr) > 0);
  assert.throws(() => m.omahaExpression({ builder: 'grids', groups: [new Set(), new Set(['AA'])] }));
  assert.ok(omahaSize(m.omahaExpression({ builder: 'grids', groups: m.groupPreset('highlow') })) > 0);
});

test('custom slots and summaries', () => {
  assert.equal(m.omahaExpression({ family: 'custom', slots: ['A', 'K', '*', '*'] }), 'AK**');
  assert.equal(omahaSize('AK**'), omahaSize(m.omahaExpression({ family: 'custom', slots: ['K', '*', 'A', '*'] })));
  assert.equal(m.omahaSummary({ family: 'aces', textures: ['double'] }), 'Aces · double suited');
  assert.equal(m.omahaSummary({ family: 'rundown', rundown: { highMin: '5', highMax: 'A' }, textures: ['double', 'single'] }),
    'Rundowns 5–A · 2+2 or 2+1+1');
  assert.equal(m.omahaSummary({ builder: 'grids' }), 'Two-card grids');
  assert.equal(m.omahaSummary({ family: 'any' }), 'Any hand');
});

test('player expressions', () => {
  const player = { name: 'Hero', mode: 'cards', cards: ['As', 'Kd', null, null], holdem: new Set(), omaha: {} };
  assert.equal(m.playerExpression(player, 'holdem'), 'AsKd');
  assert.throws(() => m.playerExpression(player, 'omaha'), /Choose all 4 cards for Hero/);
  assert.throws(() => m.playerExpression({ ...player, cards: ['As', null] }, 'holdem'), /Choose all 2 cards for Hero/);
  const range = { name: 'Villain', mode: 'range', holdem: m.fromClasses(['AA', 'KK']), omaha: { family: 'aces' }, cards: [] };
  assert.equal(m.playerExpression(range, 'holdem'), 'KK+');
  assert.equal(m.playerExpression(range, 'omaha'), 'AA');
  assert.throws(() => m.playerExpression({ ...range, holdem: new Set() }, 'holdem'), /Choose at least one hand/);
});

test('ported visual-model coverage', () => {
  const count = o => omahaSize(m.omahaExpression(o));
  // Custom AKQJ slots by suit texture.
  for (const [texture, n] of [['any', 256], ['double', 36], ['single', 144], ['rainbow', 24]]) {
    assert.equal(count({ family: 'custom', slots: ['A', 'K', 'Q', 'J'], textures: texture === 'any' ? [] : [texture] }), n, texture);
  }
  assert.equal(count({ family: 'custom', slots: ['A', 'A', 'A', 'A'], textures: ['double'] }), 0);
  // Rundowns, double suited, and independent gap limits.
  assert.ok(count({ family: 'rundown', textures: ['double'] }) > 0);
  assert.ok(count({ family: 'rundown', textures: ['double'] }) < count({ family: 'rundown' }));
  assert.equal(m.rundownExpression({ highMin: 'J', highMax: 'Q' }), '(QJT9,JT98)');
  assert.equal(m.rundownExpression({ highMin: 'A', highMax: 'A', gaps: [[2, 2], [1, 1], [1, 1]] }), '(AQJT)');
  assert.throws(() => m.rundownExpression({ highMin: '2', highMax: '2' }), /No four distinct ranks/);
  // "High only" restricts one pair; the other stays unrestricted.
  const groups = m.groupPreset('highonly');
  assert.equal(groups[0].size, 25);
  assert.equal(groups[1].size, 169);
  assert.equal(count({ builder: 'grids', groups }), 190 * 496 + 1140 * 32 + 4845);
});
