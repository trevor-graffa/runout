import init, { NumericCalculator, evaluate, evaluate_high } from "./pkg/poker_engine.js";
import { GAME_IDS, Range, normalizeGame, parseCards, parseRange, cardsMask } from "./ranges.js";

const ready = init();
let state;
function integer(name, value, min = 0n) {
  if (typeof value !== "bigint" && !Number.isSafeInteger(value)) throw new Error(`${name} must be an integer (use BigInt for large values)`);
  const n = BigInt(value);
  if (n < min || n >= 1n << 64n) throw new Error(`${name} outside unsigned 64-bit range`);
  return n;
}
function boardContext(board, dead) {
  board = parseCards(board); dead = parseCards(dead);
  if (![0, 3, 4, 5].includes(board.length)) throw new Error("Board must have 0, 3, 4, or 5 cards");
  parseCards([...board, ...dead]); return { board, dead };
}
function configure({ ranges, game = "holdem", board = "", dead = "" }) {
  game = normalizeGame(game);
  const labels = Array.isArray(ranges) ? ranges.map((_, i) => `Player ${i + 1}`) : Object.keys(ranges);
  const values = Array.isArray(ranges) ? ranges : Object.values(ranges);
  if (values.length < 2 || values.length > 10) throw new Error("Use 2 to 10 players");
  const context = boardContext(board, dead), blocked = [...context.board, ...context.dead];
  const parsed = values.map(r => typeof r === "string" ? parseRange(r, { game, blocked }) : new Range(r.entries, r.handSize).without(blocked));
  if (parsed.some(r => r.handSize !== (game === "holdem" ? 2 : 4) || !r.size)) throw new Error("Empty range or wrong hand size");
  state?.numeric.free();
  state = { ...context, game, labels, sizes: parsed.map(r => r.size),
    numeric: new NumericCalculator(GAME_IDS[game], parsed.map(r => r.entries)) };
  return { game, labels, rangeSizes: state.sizes };
}
async function equity({ method = "auto", samples = 100000, seed, maxExact = 2000000, maxAttempts = 0 } = {}, id) {
  if (!state) throw new Error("Configure the calculator first");
  if (!["auto", "exact", "monte_carlo"].includes(method)) throw new Error("Invalid equity method");
  samples = integer("samples", samples, 1n); maxExact = integer("maxExact", maxExact, 1n);
  maxAttempts = integer("maxAttempts", maxAttempts);
  if (seed === undefined) { const words = crypto.getRandomValues(new Uint32Array(2)); seed = BigInt(words[0]) << 32n | BigInt(words[1]); }
  seed = integer("seed", seed);
  const started = performance.now();
  if (method === "auto") {
    let bound = state.sizes.reduce((a, n) => a * n, 1);
    const missing = 5 - state.board.length;
    const available = 52 - state.board.length - state.dead.length - state.sizes.length * (state.game === "holdem" ? 2 : 4);
    for (let i = 0; i < missing; i++) bound *= (available - i) / (i + 1);
    method = bound <= Number(maxExact) ? "exact" : "monte_carlo";
  }
  const decorate = result => ({ ...result, game: state.game, method, seed: method === "exact" ? null : seed, threads: 1,
    elapsed: (performance.now() - started) / 1000, rangeSizes: state.sizes, labels: state.labels });
  self.postMessage({id,progress:{...decorate({players:[],outcomes:0n,attempts:0n}),target:method==='exact'?null:samples,done:false}});
  if(method==='exact')return decorate(state.numeric.equity(state.board,state.dead,true,samples,seed,maxExact,maxAttempts));
  const simulation=state.numeric.start(state.board,state.dead,samples,seed,maxAttempts);
  try{
    let batch=10000,result;
    while(!simulation.done){
      const start=performance.now();result=decorate(simulation.step(batch));
      self.postMessage({id,progress:{...result,target:samples,done:simulation.done}});
      if(!simulation.done){batch=Math.min(250000,Math.max(1000,Math.floor(batch*30/Math.max(.1,performance.now()-start))));await new Promise(resolve=>setTimeout(resolve,0));}
    }
    return result;
  }finally{simulation.free();}
}
async function handle({ data: { id, operation, payload } }) {
  try {
    await ready;
    let result;
    if (operation === "configure") result = configure(payload);
    else if (operation === "equity") result = await equity(payload,id);
    else if (operation === "evaluateCards") result = { high: evaluate_high(parseCards(payload.cards)), low: 0 };
    else if (operation === "evaluateHand") {
      const [high, low] = evaluate(GAME_IDS[state.game], parseCards(payload.hole), parseCards(payload.board)); result = { high, low };
    } else throw new Error("Unknown operation");
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: String(error.message ?? error) }); }
}
// Progressive chunks yield to the worker event loop; queue requests so a later
// configure cannot mutate the context of a running simulation.
let queue=Promise.resolve();
self.onmessage=event=>{queue=queue.then(()=>handle(event));};
