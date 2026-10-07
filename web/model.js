// Pure model for the redesigned UI. Everything here turns UI choices into
// range expressions accepted by ranges.js; nothing touches the DOM.
export const RANKS = 'AKQJT98765432';
export const SUITS = ['c', 'd', 'h', 's'];
export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const SUIT_NAMES = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

// Rank value: 2 -> 0 ... A -> 12 (the reverse of the display order).
const rankValue = ch => 12 - RANKS.indexOf(ch);
const rankChar = value => RANKS[12 - value];

export const HAND_CLASSES = [...RANKS].flatMap((a, row) => [...RANKS].map((b, col) => ({
  text: row === col ? a + a : row < col ? a + b + 's' : b + a + 'o',
  row, col, pair: row === col, suited: row < col,
  high: 12 - Math.min(row, col), low: 12 - Math.max(row, col),
  combos: row === col ? 6 : row < col ? 4 : 12,
})));
export const CLASS_BY_TEXT = new Map(HAND_CLASSES.map(h => [h.text, h]));

// ---------------------------------------------------------------------------
// Hold'em combo-level ranges.
// A range is a Set of canonical combo strings such as 'AhKh'. Canonical form:
// the higher rank comes first; a pair lists the suit that comes earlier in
// SUITS (c,d,h,s) first, so 'QcQs' is canonical and 'QsQc' is not.
// ---------------------------------------------------------------------------
const kindOf = h => (h.pair ? 'pair' : h.suited ? 'suited' : 'offsuit');

export function suitPatterns(kind) {
  if (!['pair', 'suited', 'offsuit'].includes(kind)) throw new Error('Unknown hand kind');
  const out = [];
  SUITS.forEach((s1, i) => SUITS.forEach((s2, j) => {
    const wanted = kind === 'pair' ? i < j : kind === 'suited' ? i === j : i !== j;
    if (wanted) out.push([s1, s2]);
  }));
  return out;
}

const comboOf = (text, [s1, s2]) => text[0] + s1 + text[1] + s2;

export function classCombos(text) {
  const h = CLASS_BY_TEXT.get(text);
  if (!h) throw new Error(`Unknown hand class ${text}`);
  return suitPatterns(kindOf(h)).map(pattern => comboOf(text, pattern));
}

export function comboSuits(combo) { return [combo[1], combo[3]]; }

export function classState(range, text) {
  const combos = classCombos(text);
  return { count: combos.filter(c => range.has(c)).length, total: combos.length };
}

export function fromClasses(texts) { return addClasses(new Set(), texts); }

export function addClasses(range, texts) {
  const next = new Set(range);
  for (const text of texts) classCombos(text).forEach(c => next.add(c));
  return next;
}

export function removeClasses(range, texts) {
  const next = new Set(range);
  for (const text of texts) classCombos(text).forEach(c => next.delete(c));
  return next;
}

// Add or remove one suit pattern (e.g. ['h','s']) from each class of that kind.
export function withPattern(range, classTexts, [s1, s2], on) {
  const next = new Set(range);
  for (const text of classTexts) {
    const h = CLASS_BY_TEXT.get(text);
    if (!h) continue;
    const pattern = suitPatterns(kindOf(h)).find(p => p.join('') === s1 + s2)
      ?? (h.pair ? suitPatterns('pair').find(p => p.join('') === s2 + s1) : null);
    if (!pattern) continue;
    const combo = comboOf(text, pattern);
    if (on) next.add(combo); else next.delete(combo);
  }
  return next;
}

const PRESET_TESTS = {
  pairs: h => h.pair,
  suited: h => h.suited,
  broadway: h => h.low >= 8,
  all: () => true,
  clear: () => false,
};
export function holdemPreset(name) {
  if (!(name in PRESET_TESTS)) throw new Error('Unknown Hold’em preset');
  return fromClasses(HAND_CLASSES.filter(PRESET_TESTS[name]).map(h => h.text));
}

// Whole classes from `order` (strongest first) up to percent of 1326 combos.
// The class that crosses the target is kept only if that lands nearer to it.
export function topPercent(percent, order) {
  const target = Math.min(Math.max(percent, 0), 100) / 100 * 1326;
  const texts = [];
  let total = 0;
  if (target > 0) {
    for (const text of order) {
      const next = total + CLASS_BY_TEXT.get(text).combos;
      const keep = next <= target || !total || next - target < target - total;
      if (keep) { texts.push(text); total = next; }
      if (next > target) break;
    }
  }
  return fromClasses(texts);
}

export function rangeCombos(range) { return range.size; }
export function rangePercent(range) { return range.size / 1326 * 100; }

// Compress runs of rank values into text via `single(v)`, `plus(lo)`, `span(lo, hi)`.
// A run is "open" when it reaches `top`, the highest rank the family can reach.
function compressRuns(values, top, { single, plus, span }) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (sorted[j + 1] === sorted[j] + 1) j++;
    const lo = sorted[i], hi = sorted[j];
    out.push(i === j ? single(lo) : hi === top ? plus(lo) : span(lo, hi));
    i = j + 1;
  }
  return out;
}

function pairTerms(fullPairs) {
  const c = rankChar;
  return compressRuns(fullPairs, 12, {
    single: v => c(v) + c(v),
    plus: lo => c(lo) + c(lo) + '+',
    span: (lo, hi) => `${c(lo)}${c(lo)}-${c(hi)}${c(hi)}`,
  }).reverse();
}

// Terms for suited ('s') or offsuit ('o') classes, grouped by the fixed high rank.
function nonPairTerms(full, suffix) {
  const out = [];
  for (let high = 12; high >= 1; high--) {
    const lows = HAND_CLASSES.filter(h => !h.pair && h.high === high && full.has(h.text)
      && h.suited === (suffix === 's')).map(h => h.low);
    const H = rankChar(high);
    out.push(...compressRuns(lows, high - 1, {
      single: v => H + rankChar(v) + suffix,
      plus: lo => H + rankChar(lo) + suffix + '+',
      span: (lo, hi) => `${H}${rankChar(lo)}${suffix}-${H}${rankChar(hi)}${suffix}`,
    }).reverse());
  }
  return out;
}

// Concise expression that parses to exactly the set of combos in `range`.
export function holdemShorthand(range) {
  if (!range.size) return '';
  const full = new Set(), partial = [];
  for (const h of HAND_CLASSES) {
    const { count, total } = classState(range, h.text);
    if (count === total) full.add(h.text);
    else if (count) partial.push(h.text);
  }
  if (full.size === 169) return 'random';
  const fullPairs = HAND_CLASSES.filter(h => h.pair && full.has(h.text)).map(h => h.high);
  const terms = [
    ...pairTerms(fullPairs),
    ...nonPairTerms(full, 's'),
    ...nonPairTerms(full, 'o'),
    ...partial.flatMap(text => classCombos(text).filter(c => range.has(c))),
  ];
  return terms.join(', ');
}

export function holdemExpression(range) {
  if (!range.size) throw new Error('Choose at least one hand');
  return holdemShorthand(range);
}

// ---------------------------------------------------------------------------
// Omaha
// ---------------------------------------------------------------------------
export function groupPreset(name) {
  const high = r => r >= 8, low = r => r <= 6 || r === 12, middle = r => r >= 4 && r <= 8;
  const choices = {
    highonly: [high, () => true], highlow: [high, low],
    middlemiddle: [middle, middle], any: [() => true, () => true],
  };
  if (!(name in choices)) throw new Error('Unknown two-card group preset');
  return choices[name].map(accept => new Set(
    HAND_CLASSES.filter(h => accept(h.high) && accept(h.low)).map(h => h.text)));
}

export const OMAHA_FAMILIES = {
  any: { label: 'Any hand', expression: 'random', detail: 'Every four-card hand, before any suit filters.' },
  aces: { label: 'Aces', expression: 'AA', detail: 'Contains at least two aces. Side cards are unrestricted.' },
  bigpairs: { label: 'Big pairs', expression: '(AA,KK,QQ,JJ)', detail: 'Contains a pair of jacks or higher. Side cards are unrestricted.' },
  broadway: { label: 'Broadway', expression: '[AKQJT][AKQJT][AKQJT][AKQJT]', detail: 'All four cards are ten or higher, including paired ranks.' },
  rundown: { label: 'Rundowns', detail: 'Four distinct ranks with limits on the highest card and the distance between neighbours.' },
  acedeuce: { label: 'Ace–deuce', expression: 'A2', detail: 'Contains an ace and a deuce. Side cards are unrestricted.' },
  low: { label: 'Low starters', expression: '(A2,A3,23)', detail: 'Contains A2, A3, or 23. This describes ranks, not a strength percentile.' },
  custom: { label: 'Pick ranks', detail: 'Choose four rank slots. Any rank is a wildcard; card order does not matter.' },
};

const DEFAULT_GAPS = [[1, 1], [1, 1], [1, 1]];
const validRank = r => typeof r === 'string' && r.length === 1 && RANKS.includes(r);

// Distance 1 means consecutive ranks; 2 means one missing rank in between.
export function rundownHands({ highMin = '5', highMax = 'A', gaps = DEFAULT_GAPS } = {}) {
  if (!validRank(highMin) || !validRank(highMax)) throw new Error('Choose valid high-card limits');
  const min = rankValue(highMin), max = rankValue(highMax);
  if (min > max) throw new Error(`Lowest top card ${highMin} is above highest top card ${highMax}`);
  if (gaps.length !== 3) throw new Error('Choose three rank-distance intervals');
  gaps.forEach(([lo, hi], i) => {
    if (![lo, hi].every(n => Number.isInteger(n) && n >= 1 && n <= 12)) {
      throw new Error(`Distance ${i + 1} must be between 1 and 12`);
    }
    if (lo > hi) throw new Error(`Distance ${i + 1}: minimum ${lo} is above maximum ${hi}`);
  });
  const hands = [];
  for (let a = max; a >= min; a--) {
    for (let b = a - 1; b >= 0; b--) for (let c = b - 1; c >= 0; c--) for (let d = c - 1; d >= 0; d--) {
      const distances = [a - b, b - c, c - d];
      if (distances.every((n, i) => n >= gaps[i][0] && n <= gaps[i][1])) {
        hands.push([a, b, c, d].map(rankChar).join(''));
      }
    }
  }
  if (!hands.length) {
    const ds = gaps.map(([lo, hi]) => (lo === hi ? lo : `${lo}–${hi}`)).join(', ');
    throw new Error(`No four distinct ranks fit: highest card ${highMin}–${highMax} with distances ${ds}`);
  }
  return hands;
}

export function rundownExpression(opts = {}) {
  return '(' + rundownHands(opts).join(',') + ')';
}

// Patterns verified against ranges.md: each is exactly that suit texture.
export const TEXTURES = [
  { key: 'double', label: '2+2', name: 'Double suited', pattern: 'xxyy' },
  { key: 'single', label: '2+1+1', name: 'Single suited', pattern: 'xxyz' },
  { key: 'rainbow', label: '1+1+1+1', name: 'Rainbow', pattern: 'xyzw' },
  { key: 'triple', label: '3+1', name: 'Three of a suit', pattern: 'xxxy' },
  { key: 'monotone', label: '4', name: 'Four of a suit', pattern: 'xxxx' },
];

export const CONNECTIONS = [
  { key: 'any', label: 'Any', detail: 'No extra suit connection is required.' },
  { key: 'ace', label: 'Ace suited', filter: '$as', detail: 'An ace shares its suit with another card in the hand.' },
  { key: 'high', label: 'Top card suited', filter: '$hs', detail: 'A highest-ranked card shares its suit with another card.' },
  { key: 'both', label: 'Top two suited', filter: '$bs', detail: 'The two highest-ranked cards each pair up with another card in two different suits.' },
];

function familyBase({ family = 'aces', slots = ['A', 'A', '*', '*'], rundown }) {
  const info = OMAHA_FAMILIES[family];
  if (!info) throw new Error('Unknown Omaha hand family');
  if (family === 'rundown') return rundownExpression(rundown);
  if (family !== 'custom') return info.expression;
  if (slots.length !== 4 || slots.some(r => r !== '*' && !validRank(r))) throw new Error('Choose four valid ranks');
  return slots.every(r => r === '*') ? 'random' : slots.join('');
}

function gridBase(groups) {
  if (!groups || groups.length !== 2 || groups.some(g => !g.size)) {
    throw new Error('Select hands in both two-card groups');
  }
  const side = g => HAND_CLASSES.filter(h => g.has(h.text)).map(h => h.text).join(',');
  return `{${groups.map(side).join('|')}}`;
}

function textureFilter(keys = []) {
  const picked = TEXTURES.filter(t => keys.includes(t.key));
  if (keys.some(k => !TEXTURES.some(t => t.key === k))) throw new Error('Unknown suit texture');
  if (!picked.length || picked.length === TEXTURES.length) return null;
  const patterns = picked.map(t => t.pattern);
  return patterns.length === 1 ? patterns[0] : `(${patterns.join(',')})`;
}

function connectionFilter(key = 'any') {
  const found = CONNECTIONS.find(c => c.key === key);
  if (!found) throw new Error('Unknown suit connection');
  return found.filter ?? null;
}

// Each required slot is a different card: 'As', 'A' (any suit) or '*s' (any rank).
function requiredFilter(required = []) {
  const parts = [];
  for (const { rank = '*', suit = '*' } of required.slice(0, 4)) {
    if (rank !== '*' && !validRank(rank)) throw new Error('Choose a valid required rank');
    if (suit !== '*' && !SUITS.includes(suit)) throw new Error('Choose a valid required suit');
    if (rank === '*' && suit === '*') continue;
    parts.push(rank === '*' ? '*' + suit : rank + (suit === '*' ? '' : suit));
  }
  return parts.length ? parts.join('') : null;
}

export function omahaExpression(omaha = {}) {
  const { builder = 'family', textures, connection, required } = omaha;
  if (builder !== 'family' && builder !== 'grids') throw new Error('Unknown Omaha builder');
  const base = builder === 'grids' ? gridBase(omaha.groups) : familyBase(omaha);
  const parts = [
    base === 'random' ? null : base,
    textureFilter(textures),
    connectionFilter(connection),
    requiredFilter(required),
  ].filter(Boolean);
  return parts.length ? parts.join(':') : 'random';
}

export function omahaSummary(omaha = {}) {
  const { builder = 'family', family = 'aces', textures = [], connection = 'any', required = [] } = omaha;
  const parts = [];
  if (builder === 'grids') parts.push('Two-card grids');
  else if (family === 'rundown') {
    const { highMin = '5', highMax = 'A' } = omaha.rundown ?? {};
    parts.push(`Rundowns ${highMin}–${highMax}`);
  } else if (family === 'custom') parts.push('Ranks ' + (omaha.slots ?? []).join(''));
  else parts.push(OMAHA_FAMILIES[family]?.label ?? 'Omaha hand');
  const picked = TEXTURES.filter(t => textures.includes(t.key));
  if (picked.length === 1) parts.push(picked[0].name.toLowerCase());
  else if (picked.length > 1 && picked.length < TEXTURES.length) parts.push(picked.map(t => t.label).join(' or '));
  const link = CONNECTIONS.find(c => c.key === connection);
  if (link?.filter) parts.push(link.label.toLowerCase());
  const cards = required.filter(r => (r.rank ?? '*') !== '*' || (r.suit ?? '*') !== '*')
    .map(r => (r.rank ?? '*') === '*' ? r.suit : (r.rank ?? '') + (r.suit && r.suit !== '*' ? r.suit : ''));
  if (cards.length) parts.push('with ' + cards.join(' '));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export function playerExpression(player, game) {
  if (player.mode === 'cards') {
    const cards = player.cards.slice(0, game === 'holdem' ? 2 : 4);
    if (cards.length < (game === 'holdem' ? 2 : 4) || cards.some(c => !c)) {
      throw new Error(`Choose all ${game === 'holdem' ? 2 : 4} cards for ${player.name}`);
    }
    return cards.join('');
  }
  if (game !== 'holdem') return omahaExpression(player.omaha);
  if (!player.holdem.size) throw new Error(`Choose at least one hand for ${player.name}`);
  return holdemExpression(player.holdem);
}
