// High-level text parsing. Rust/WASM receives numeric masks and weights only.
export const RANKS = "23456789TJQKA", SUITS = "cdhs";
export const GAME_IDS = { holdem: 0, omaha: 1, omaha8: 2 };
export function normalizeGame(game = "holdem") {
  const aliases = { he: "holdem", nlhe: "holdem", plo: "omaha", omahahi: "omaha", plo8: "omaha8", "omaha-hi-lo": "omaha8" };
  const name = String(game).toLowerCase(), normalized = aliases[name] ?? name;
  if (!(normalized in GAME_IDS)) throw new Error("Choose holdem, omaha, or omaha8");
  return normalized;
}
export function parseCards(value = "") {
  let cards;
  if (typeof value === "string") {
    const text = value.replace(/[\s,]+/g, "");
    if (text.length % 2) throw new Error("Cards must be rank/suit pairs");
    cards = [];
    for (let i = 0; i < text.length; i += 2) {
      const r = RANKS.indexOf(text[i].toUpperCase()), s = SUITS.indexOf(text[i + 1].toLowerCase());
      if (r < 0 || s < 0) throw new Error(`Invalid card ${text.slice(i, i + 2)}`);
      cards.push(r * 4 + s);
    }
  } else {
    if (value == null || typeof value[Symbol.iterator] !== "function") throw new Error("Cards must be text or an iterable");
    cards = Array.from(value, c => {
      if (typeof c !== "string") return c;
      if (c.length !== 2) throw new Error("Expected one rank/suit pair per card");
      return parseCards(c)[0];
    });
  }
  if (cards.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw new Error("Card IDs must be integers in 0..51");
  if (new Set(cards).size !== cards.length) throw new Error("Duplicate card");
  return cards;
}
export function cardsMask(cards) { return cards.reduce((m, c) => m | (1n << BigInt(c)), 0n); }
const allRanks = Array.from({ length: 13 }, (_, i) => i);
const bits = Array.from({ length: 52 }, (_, c) => 1n << BigInt(c));
function combinations(values, n, visit, start = 0, mask = 0n) {
  if (!n) { visit(mask); return; }
  for (let i = start; i <= values.length - n; i++) combinations(values, n - 1, visit, i + 1, mask | bits[values[i]]);
}
const universes = new Map(), atomCache = new Map(), rangeCache = new Map();
const pairCache = new Map();
function cached(cache, key, size, create) {
  if (!cache.has(key)) { if (cache.size >= size) cache.delete(cache.keys().next().value); cache.set(key, create()); }
  return cache.get(key);
}
function universe(size) {
  return cached(universes, size, 2, () => {
    const set = new Set(); combinations(Array.from({ length: 52 }, (_, c) => c), size, m => set.add(Number(m))); return set;
  });
}
function holdemClass(a, b, suffix) {
  if (a < b) throw new Error("Put the higher rank first in Hold'em shorthand");
  if (a === b && suffix) throw new Error("Pairs cannot have suited/offsuit suffixes");
  const set = new Set();
  for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) {
    if (a === b && s >= t) continue;
    if (suffix && (suffix === "s" ? s !== t : s === t)) continue;
    set.add(Number(bits[a * 4 + s] | bits[b * 4 + t]));
  }
  return set;
}
function holdemAtom(text) {
  const klass = "([2-9TJQKA])([2-9TJQKA])([so]?)";
  const single = text.match(new RegExp(`^${klass}(\\+)?$`));
  if (single) {
    const [, high, low, suffix, plus] = single, a = RANKS.indexOf(high), b = RANKS.indexOf(low);
    if (a < b) throw new Error("Put the higher rank first");
    if (!plus) return holdemClass(a, b, suffix);
    const set = new Set();
    for (let r = a === b ? a : b; r < (a === b ? 13 : a); r++) {
      for (const m of holdemClass(a === b ? r : a, r, suffix)) set.add(m);
    }
    return set;
  }
  const span = text.match(new RegExp(`^${klass}-${klass}$`));
  if (!span) return null;
  const [, h1, l1, s1, h2, l2, s2] = span, [a, b, c, d] = [h1, l1, h2, l2].map(r => RANKS.indexOf(r));
  const da = c - a, db = d - b;
  if (s1 !== s2 || a < b || c < d || (da && db && da !== db)) throw new Error("Use matching pair, fixed-rank, or diagonal endpoints");
  const set = new Set();
  for (let k = 0; k <= Math.max(Math.abs(da), Math.abs(db)); k++) {
    for (const m of holdemClass(a + Math.sign(da) * k, b + Math.sign(db) * k, s1)) set.add(m);
  }
  return set;
}
function rankSet(text) {
  text = text.replaceAll(",", "");
  if (/^[2-9TJQKA]-[2-9TJQKA]$/.test(text)) {
    const a = RANKS.indexOf(text[0]), b = RANKS.indexOf(text[2]);
    return allRanks.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  if (!text || [...text].some(c => !RANKS.includes(c))) throw new Error("Bracket sets support ranks, e.g. [AKQ] or [K-T]");
  return [...new Set([...text].map(c => RANKS.indexOf(c)))];
}
function pattern(text, size) {
  const tokens = []; let i = 0;
  while (i < text.length) {
    let ranks, suit = null;
    if (text[i] === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) throw new Error("Unclosed bracket");
      ranks = rankSet(text.slice(i + 1, end)); i = end + 1;
    } else if (RANKS.includes(text[i])) { ranks = [RANKS.indexOf(text[i++])]; }
    else if (text[i] === "*") { ranks = allRanks; i++; }
    else if ((SUITS + "xyzw").includes(text[i])) { ranks = allRanks; }
    else throw new Error(`Unsupported range token ${text[i]}`);
    if (i < text.length && (SUITS + "xyzw").includes(text[i])) suit = text[i++];
    tokens.push({ ranks, suit });
  }
  if (!tokens.length || tokens.length > size) throw new Error(`Pattern must describe at most ${size} cards`);
  while (tokens.length < size) tokens.push({ ranks: allRanks, suit: null });
  let tail = 0;
  while (tokens.length && tokens.at(-1).ranks === allRanks && tokens.at(-1).suit === null) { tail++; tokens.pop(); }
  if (!tokens.length) return universe(size);
  const set = new Set(), variables = new Map();
  function generate(slot, used) {
    if (slot === tokens.length) {
      if (!tail) set.add(Number(used));
      else {
        const available = bits.map((bit, c) => used & bit ? -1 : c).filter(c => c >= 0);
        combinations(available, tail, extra => set.add(Number(used | extra)));
      }
      return;
    }
    const { ranks, suit } = tokens[slot];
    const newVariable = suit !== null && "xyzw".includes(suit) && !variables.has(suit);
    const suits = suit !== null && SUITS.includes(suit) ? [SUITS.indexOf(suit)] : variables.has(suit) ? [variables.get(suit)] :
      newVariable ? [0, 1, 2, 3].filter(s => ![...variables.values()].includes(s)) : [0, 1, 2, 3];
    for (const s of suits) {
      if (newVariable) variables.set(suit, s);
      for (const r of ranks) if (!(used & bits[r * 4 + s])) generate(slot + 1, used | bits[r * 4 + s]);
      if (newVariable) variables.delete(suit);
    }
  }
  generate(0, 0n); return set;
}
function atom(text, size) {
  return cached(atomCache, `${size}:${text}`, 32, () => {
    if (text.includes("%")) throw new Error("Top-N% ranges are not supported");
    if (text.toLowerCase() === "random" || text === "*") return universe(size);
    if (["$hs","$as","$bs"].includes(text)) {
      if(size!==4)throw new Error('Rank-dependent suit filters require Omaha');
      return new Set([...universe(4)].filter(m=>suitProperty(m,text)));
    }
    return (size === 2 ? holdemAtom(text) : null) ?? pattern(text, size);
  });
}
function suitProperty(mask,name){
  const cards=[],counts=[0,0,0,0];let value=BigInt(mask);
  for(let c=0;value;c++){if(value&1n){cards.push(c);counts[c%4]++;}value>>=1n;}
  const high=Math.floor(cards[3]/4),second=Math.floor(cards[2]/4);
  if(name==='$hs')return cards.some(c=>Math.floor(c/4)===high&&counts[c%4]>=2);
  if(name==='$as')return cards.some(c=>Math.floor(c/4)===12&&counts[c%4]>=2);
  return cards.some(a=>Math.floor(a/4)===high&&cards.some(b=>Math.floor(b/4)>=second&&a%4!==b%4&&counts[a%4]>=2&&counts[b%4]>=2));
}
function paired(text){
  return cached(pairCache,text,4,()=>{
    const parts=text.split('|');
    if(parts.length!==2||parts.some(p=>!p)||/[{}@]/.test(text))throw new Error("Use {first Hold'em range|second Hold'em range}; weights go outside");
    const [a,b]=parts.map(p=>parseRange(p));
    if(a.size===1326&&b.size===1326)return universe(4);
    const left=a.entries.map(([m])=>BigInt(m)),right=b.entries.map(([m])=>BigInt(m)),set=new Set();
    for(const x of left)for(const y of right)if(!(x&y))set.add(Number(x|y));
    return set;
  });
}
class Parser {
  constructor(text, size) { this.text = text; this.size = size; this.pos = 0; this.depth = 0; }
  accept(c) { if (this.text[this.pos] !== c) return false; this.pos++; return true; }
  union() {
    const left = this.difference();
    while (this.accept(",")) for (const [m, w] of this.difference()) left.set(m, Math.max(w, left.get(m) ?? 0));
    return left;
  }
  difference() {
    const left = this.intersection();
    while (this.accept("!")) for (const m of this.intersection().keys()) left.delete(m);
    return left;
  }
  intersection() {
    let left = this.primary();
    while (this.accept(":")) {
      const right = this.primary();
      left = new Map([...left].filter(([m]) => right.has(m)).map(([m, w]) => [m, Math.min(w, right.get(m))]));
    }
    return left;
  }
  primary() {
    if (++this.depth > 64) throw new Error("Range expression nesting exceeds 64");
    let result;
    if (this.accept("!")) {
      const excluded = this.primary(); result = new Map([...universe(this.size)].filter(m => !excluded.has(m)).map(m => [m, 1]));
    } else if (this.accept("(")) {
      result = this.union(); if (!this.accept(")")) throw new Error("Expected closing parenthesis");
    } else if(this.accept('{')) {
      if(this.size!==4)throw new Error('Two-card group composition requires Omaha');
      const end=this.text.indexOf('}',this.pos);if(end<0)throw new Error('Unclosed two-card group');
      result=new Map([...paired(this.text.slice(this.pos,end))].map(m=>[m,1]));this.pos=end+1;
    } else {
      const start = this.pos; let brackets = 0;
      while (this.pos < this.text.length) {
        const c = this.text[this.pos];
        if (c === "[") brackets++;
        else if (c === "]") { if (--brackets < 0) throw new Error("Unexpected closing bracket"); }
        else if (!brackets && ",!:()@".includes(c)) break;
        this.pos++;
      }
      if (brackets) throw new Error("Unclosed bracket");
      if (this.pos === start) throw new Error("Expected a range");
      result = new Map([...atom(this.text.slice(start, this.pos), this.size)].map(m => [m, 1]));
    }
    if (this.accept("@")) {
      const match = this.text.slice(this.pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?/);
      if (!match) throw new Error("Expected positive weight after '@'");
      const token = match[0]; this.pos += token.length;
      const scale = Number(token.replace("%", "")) / (token.endsWith("%") ? 100 : 1);
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("Weights must be finite and positive");
      result = new Map([...result].map(([m, w]) => [m, w * scale]));
    }
    this.depth--; return result;
  }
}
export class Range {
  constructor(entries, handSize = 2) {
    if (![2, 4].includes(handSize)) throw new Error("handSize must be 2 or 4");
    const seen = new Set();
    this.entries = entries.map(([m, w]) => {
      if (!Number.isSafeInteger(m) || m < 0 || m >= 2 ** 52 || BigInt(m).toString(2).replaceAll("0", "").length !== handSize) throw new Error("Invalid combo mask");
      if (!Number.isFinite(w) || w <= 0) throw new Error("Weights must be finite and positive");
      if (seen.has(m)) throw new Error("Duplicate combo"); seen.add(m);
      return Object.freeze([m, w]);
    });
    this.handSize = handSize; Object.freeze(this.entries); Object.freeze(this);
  }
  get size() { return this.entries.length; }
  without(blocked) {
    const mask = cardsMask(parseCards(blocked));
    return mask ? new Range(this.entries.filter(([m]) => !(BigInt(m) & mask)), this.handSize) : this;
  }
  static parse(text, options) { return parseRange(text, options); }
}
export function parseRange(text, { game = "holdem", blocked = "" } = {}) {
  const size = normalizeGame(game) === "holdem" ? 2 : 4;
  if (typeof text !== "string" || !text.trim()) throw new Error("Range text must be nonempty");
  let compact = text.replace(/\s+/g, "");
  if (compact.length > 4096) throw new Error("Range expression exceeds 4096 characters");
  compact = compact.replace(/([A-Za-z0-9*\])}])\$(ds|ss|r|ts|ms|hs|as|bs)\b/g, "$1:$$$2");
  for (const [macro, pattern] of [["$ds", "xxyy"], ["$ss", "xxyz"], ["$r", "xyzw"], ["$ts","xxxy"], ["$ms","xxxx"]]) compact = compact.replaceAll(macro, pattern);
  const range = cached(rangeCache, `${size}:${compact}`, 4, () => {
    const parser = new Parser(compact, size), entries = parser.union();
    if (parser.pos !== compact.length) throw new Error(`Unexpected token at position ${parser.pos}`);
    return new Range([...entries].sort(([a], [b]) => a - b), size);
  });
  return range.without(blocked);
}
