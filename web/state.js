// App state, defaults and local persistence.
import { fromClasses, topPercent, playerExpression } from './model.js';
import { HOLDEM_ORDER } from './holdem-order.js';

const STORAGE_KEY = 'pocket-equity:v1';
export const MAX_PLAYERS = 10;
export const SEAT_COLORS = ['#2f7bf6', '#e5484d', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#65a30d', '#f97316', '#0891b2', '#a16207'];

export const family = game => game === 'holdem' ? 'holdem' : 'omaha';
export const handSize = game => game === 'holdem' ? 2 : 4;
export const GAME_NAMES = { holdem: 'Hold’em', omaha: 'Omaha', omaha8: 'Omaha Hi-Lo' };

export function defaultOmaha(hero) {
  return {
    builder: 'family', family: hero ? 'aces' : 'any', slots: ['A', 'A', '*', '*'],
    rundown: { highMin: '9', highMax: 'A', gaps: [[1, 1], [1, 1], [1, 1]] },
    gridLayout: 'topbottom', groups: [new Set(), new Set()], activeGroup: 0,
    textures: hero ? ['double'] : [], connection: 'any',
    required: [0, 1, 2, 3].map(() => ({ rank: '*', suit: '*' })),
  };
}

export function makePlayer(name, seat) {
  const hero = seat === 0;
  return {
    name,
    mode: { holdem: hero ? 'cards' : 'range', omaha: 'range' },
    cards: { holdem: hero ? ['As', 'Ks'] : [null, null], omaha: [null, null, null, null] },
    holdem: hero ? fromClasses(['AA']) : seat === 1 ? topPercent(20, HOLDEM_ORDER) : fromClasses(HOLDEM_ORDER),
    omaha: defaultOmaha(hero),
  };
}

export function defaultState() {
  return {
    game: 'holdem', players: [makePlayer('Hero', 0), makePlayer('Villain', 1)],
    board: [null, null, null, null, null], dead: [], method: 'auto', samples: 1000000,
  };
}

export function clonePlayer(p) {
  return {
    name: p.name, mode: { ...p.mode },
    cards: { holdem: [...p.cards.holdem], omaha: [...p.cards.omaha] },
    holdem: new Set(p.holdem),
    omaha: {
      ...p.omaha, slots: [...p.omaha.slots], textures: [...p.omaha.textures],
      rundown: { ...p.omaha.rundown, gaps: p.omaha.rundown.gaps.map(g => [...g]) },
      groups: p.omaha.groups.map(g => new Set(g)), required: p.omaha.required.map(r => ({ ...r })),
    },
  };
}

/** The player as seen by one game: flattens per-family mode and cards. */
export function playerView(p, game) {
  const f = family(game);
  return { ...p, mode: p.mode[f], cards: p.cards[f].slice(0, handSize(game)) };
}
export const expressionFor = (p, game) => playerExpression(playerView(p, game), game);

export function nextName(players) {
  let n = players.length + 1;
  while (players.some(p => p.name === `Player ${n}`)) n++;
  return `Player ${n}`;
}

export function save(state) {
  const plain = {
    ...state,
    players: state.players.map(p => ({ ...p, holdem: [...p.holdem], omaha: { ...p.omaha, groups: p.omaha.groups.map(g => [...g]) } })),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plain)); } catch { /* private mode */ }
}

export function load() {
  try {
    const plain = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!plain?.players?.length) return defaultState();
    const base = defaultState();
    return {
      ...base, ...plain,
      players: plain.players.slice(0, MAX_PLAYERS).map((p, i) => {
        const fresh = makePlayer(p.name ?? `Player ${i + 1}`, i);
        return {
          ...fresh, ...p,
          mode: { ...fresh.mode, ...p.mode }, cards: { ...fresh.cards, ...p.cards },
          holdem: new Set(p.holdem ?? fresh.holdem),
          omaha: migrateOmaha({ ...fresh.omaha, ...p.omaha, groups: (p.omaha?.groups ?? []).length === 2 ? p.omaha.groups.map(g => new Set(g)) : fresh.omaha.groups }),
        };
      }),
    };
  } catch {
    return defaultState();
  }
}

/** Saved "Ace suited" equals "Top card suited" with a required ace. */
function migrateOmaha(omaha) {
  if (omaha.connection !== 'ace') return omaha;
  const required = omaha.required.map(r => ({ ...r }));
  const free = required.findIndex(r => r.rank === '*' && r.suit === '*');
  if (!required.some(r => r.rank === 'A') && free >= 0) required[free].rank = 'A';
  return { ...omaha, connection: 'high', required };
}
