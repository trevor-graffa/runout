// UI choices generate the same high-level expressions accepted in Advanced mode.
export const RANKS = 'AKQJT98765432';
export const SUITS = ['c', 'd', 'h', 's'];
export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const HAND_CLASSES = [...RANKS].flatMap((a, row) => [...RANKS].map((b, col) => ({
  text: row === col ? a + a : row < col ? a + b + 's' : b + a + 'o',
  row, col, pair: row === col, suited: row < col,
  high: 12 - Math.min(row, col), low: 12 - Math.max(row, col),
  combos: row === col ? 6 : row < col ? 4 : 12,
})));
const predicates = {
  premium: h => h.pair && h.high >= 8 || !h.pair && h.high === 12 && (h.suited ? h.low >= 10 : h.low === 11),
  balanced: h => h.pair && h.high >= 5 || !h.pair && (h.high === 12 && h.low >= (h.suited ? 8 : 9) || h.suited && h.high === 11 && h.low === 10),
  wide: h => h.pair || h.suited && (h.high === 12 || h.high >= 9 && h.low >= 8 || h.high === 8 && h.low === 7) || !h.suited && (h.high === 12 && h.low >= 8 || h.high === 11 && h.low >= 9),
  pairs: h => h.pair, all: () => true, clear: () => false,
};
export function holdemPreset(name) {
  if (!(name in predicates)) throw new Error('Unknown Hold’em preset');
  return new Set(HAND_CLASSES.filter(predicates[name]).map(h => h.text));
}
export function holdemCount(classes) { return HAND_CLASSES.reduce((n, h) => n + (classes.has(h.text) ? h.combos : 0), 0); }
export function groupPreset(name) {
  const high=r=>r>=8,low=r=>r<=6||r===12,middle=r=>r>=4&&r<=8;
  const choices={highonly:[high,()=>true],highlow:[high,low],middlemiddle:[middle,middle],any:[()=>true,()=>true]};
  if(!(name in choices))throw new Error('Unknown two-card group preset');
  return choices[name].map(accept=>new Set(HAND_CLASSES.filter(h=>accept(h.high)&&accept(h.low)).map(h=>h.text)));
}
export const OMAHA_PRESETS = {
  aces: { label: 'Aces', expression: 'AA', detail: 'Contains at least two aces. Side cards are unrestricted.' },
  bigpairs: { label: 'Big pairs', expression: '(AA,KK,QQ,JJ)', detail: 'Contains a pair of jacks or higher. Side cards are unrestricted.' },
  broadway: { label: 'Broadway', expression: '[AKQJT][AKQJT][AKQJT][AKQJT]', detail: 'All four cards are ten or higher, including paired ranks.' },
  connected: { label: 'Rundowns', expression: '(AKQJ,KQJT,QJT9,JT98,T987,9876,8765,7654,6543,5432)', detail: 'Four consecutive, distinct ranks. No gaps; no wraparound.' },
  wheel: { label: 'Ace–deuce', expression: 'A2', detail: 'Contains an ace and a deuce. Useful for exploring low potential; side cards are unrestricted.' },
  low: { label: 'Low starters', expression: '(A2,A3,23)', detail: 'Contains A2, A3, or 23. This describes ranks, not a strength percentile.' },
  any: { label: 'Any hand', expression: 'random', detail: 'All four-card hands, before the suitedness filter.' },
  custom: { label: 'Pick ranks', detail: 'Choose four rank slots. Any rank is a wildcard; card order does not matter.' },
};
// Rank distance 1 means consecutive cards; 2 means one missing rank.
export function rundownExpression({highMin='5',highMax='A',gaps=[[1,1],[1,1],[1,1]]}={}) {
  const rank=r=>12-RANKS.indexOf(r);
  if(!RANKS.includes(highMin)||highMin.length!==1||!RANKS.includes(highMax)||highMax.length!==1)
    throw new Error('Choose valid high-card limits');
  const min=rank(highMin),max=rank(highMax);
  if(min>max)throw new Error('High-card minimum exceeds maximum');
  if(gaps.length!==3||gaps.some(g=>g.length!==2||g.some(n=>!Number.isInteger(n)||n<1||n>12)||g[0]>g[1]))
    throw new Error('Choose three valid rank-distance intervals');
  const hands=[];
  for(let a=max;a>=min;a--)for(let b=a-1;b>=0;b--)for(let c=b-1;c>=0;c--)for(let d=c-1;d>=0;d--){
    const distances=[a-b,b-c,c-d];
    if(distances.every((n,i)=>n>=gaps[i][0]&&n<=gaps[i][1]))hands.push([a,b,c,d].map(r=>RANKS[12-r]).join(''));
  }
  // AA excluding AA is an empty range in the existing grammar.
  return hands.length?'('+hands.join(',')+')':'(AA!AA)';
}
export function omahaExpression({ preset = 'aces', suitedness = 'any', slots = ['A','A','*','*'], builder='family',groups=groupPreset('highlow'),connection='any',rundown } = {}) {
  if (!(preset in OMAHA_PRESETS)) throw new Error('Unknown Omaha preset');
  if (slots.length !== 4 || slots.some(r => r !== '*' && (r.length !== 1 || !RANKS.includes(r)))) throw new Error('Choose four valid ranks');
  const macros = { any: '', double: '$ds', single: '$ss', rainbow: '$r',triple:'$ts',monotone:'$ms' };
  if (!(suitedness in macros)) throw new Error('Unknown suitedness');
  const connections={any:'',high:'$hs',ace:'$as',both:'$bs'};
  if(!(connection in connections))throw new Error('Unknown suit connection');
  let base=preset==='custom'?slots.join(''):preset==='connected'?rundownExpression(rundown):OMAHA_PRESETS[preset].expression;
  if(builder==='pairs'){
    if(groups.length!==2||groups.some(g=>!g.size))throw new Error('Select hands in both two-card groups');
    base='{'+groups.map(g=>HAND_CLASSES.filter(h=>g.has(h.text)).map(h=>h.text).join(',')).join('|')+'}';
  }else if(builder!=='family')throw new Error('Unknown Omaha builder');
  const filters=[macros[suitedness],connections[connection]].filter(Boolean);
  return filters.length?`(${base}):${filters.join(':')}`:base;
}
function basePlayerExpression(player, game) {
  if (player.mode === 'cards') {
    const cards = player.cards.slice(0, game === 'holdem' ? 2 : 4);
    if (cards.some(c => !c)) throw new Error(`Choose all ${cards.length} cards for ${player.name}`);
    return cards.join('');
  }
  if (game !== 'holdem') return omahaExpression(player.omaha);
  if (!player.classes.size) throw new Error(`Choose a range for ${player.name}`);
  return HAND_CLASSES.filter(h => player.classes.has(h.text)).map(h => h.text).join(',');
}

export function playerExpression(player,game){
  const base=basePlayerExpression(player,game);
  if(player.mode==='cards')return base;
  const suits=(player.rangeSuits||[]).slice(0,game==='holdem'?2:4);
  if(suits.some(s=>s!=='*'&&!SUITS.includes(s)))throw new Error('Choose valid suit constraints');
  return suits.some(s=>s!=='*')?`(${base}):${suits.map(s=>s==='*'?'*':'*'+s).join('')}`:base;
}
