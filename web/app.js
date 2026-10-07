// Main screen: game, Calculate, players, board. Editing happens in sheets.
import { Calculator } from './poker.js';
import { holdemShorthand, omahaSummary, rangePercent } from './model.js';
import { $, h, cardFace, sheet, segmented, formatCount, pct, glyph } from './ui.js';
import { renderDeck, renderSlots } from './deck.js';
import { openEditor } from './editor.js';
import {
  load, save, defaultState, makePlayer, nextName, family, handSize, playerView, expressionFor,
  MAX_PLAYERS, SEAT_COLORS, GAME_NAMES,
} from './state.js';

let state = load();
let run;          // { calculator, result, partial, error } for the current/last calculation
let rows = [];    // per-player DOM handles for in-place live updates

const persist = () => save(state);

/** Any change to inputs makes old numbers meaningless. */
function invalidate() {
  stopCalculation({ keep: false });
  run = undefined;
  persist(); render();
}

// ——— Rendering ———
function render() {
  setGame(state.game);
  renderPlayers(); renderBoard(); renderRun();
}

function summaryOf(player) {
  const view = playerView(player, state.game);
  if (view.mode === 'cards') {
    return h('span.player-summary.cards', {}, view.cards.map(c => cardFace(c, { mini: true, placeholder: '?' })));
  }
  let text;
  if (state.game === 'holdem') {
    const size = player.holdem.size;
    text = !size ? 'No hands selected' : size === 1326 ? 'Any two cards'
      : `${holdemShorthand(player.holdem)} · ${rangePercent(player.holdem).toFixed(1)}%`;
  } else {
    text = omahaSummary(player.omaha).replace(/\bwith (.+)$/, (_, cards) => 'with ' + cards.replace(/([cdhs])/g, s => glyph(s)));
  }
  return h('span.player-summary', { text });
}

function renderPlayers() {
  const list = $('players');
  const count = state.players.length;
  list.classList.toggle('medium', count >= 5 && count <= 6);
  list.classList.toggle('dense', count >= 7);
  rows = state.players.map((player, i) => playerRow(player, i));
  const add = count < MAX_PLAYERS
    ? h('button.add-player', { onclick: addPlayer, id: 'add-player' }, '+ Add player')
    : null;
  list.replaceChildren(...rows.map(r => r.element), add);
  updateResults();
}

function playerRow(player, index) {
  const view = playerView(player, state.game);
  const equity = h('span.equity.empty', { text: '—' });
  const breakdown = h('span.breakdown');
  const bar = h('span.equity-bar', { style: { transform: 'scaleX(0)' }, 'aria-hidden': 'true' });
  const main = h('button.player-main', { dataset: { player: index }, 'aria-description': 'Opens the editor' },
  h('span.seat', { text: index === 0 ? 'H' : String(index + 1), 'aria-hidden': 'true' }),
  h('span.player-copy', {},
    h('span.player-name', {}, player.name, h('small', { text: view.mode === 'cards' ? 'Hand' : 'Range' })),
    summaryOf(player)),
  h('span.player-result', { 'aria-live': 'off' }, equity, breakdown),
  bar);
  const element = h('div.player', { style: { '--seat': SEAT_COLORS[index] } });
  if (state.players.length > 2) {
    element.append(h('button.player-delete', { tabindex: '-1', 'aria-hidden': 'true', onclick: () => removePlayer(index) }, 'Delete'));
  }
  element.append(main);
  attachSwipe(element, main, index);
  main.addEventListener('click', () => { if (!element.classList.contains('swiped')) edit(index); });
  return { element, main, equity, breakdown, bar };
}

/** Swipe left on a row to reveal Delete (only with 3+ players). */
function attachSwipe(element, main, index) {
  let start, dx = 0, swiping = false;
  main.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || state.players.length <= 2) return;
    start = { x: e.clientX, y: e.clientY, open: element.classList.contains('swiped') }; dx = 0; swiping = false;
  });
  main.addEventListener('pointermove', e => {
    if (!start) return;
    const x = e.clientX - start.x, y = e.clientY - start.y;
    if (!swiping && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.5) { swiping = true; main.setPointerCapture(e.pointerId); }
    if (!swiping) return;
    dx = Math.max(-120, Math.min(0, x + (start.open ? -96 : 0)));
    main.style.transition = 'none'; main.style.transform = `translateX(${dx}px)`;
  });
  const finish = e => {
    if (!start) return;
    main.style.transition = '';
    if (swiping) {
      const open = dx < -48;
      element.classList.toggle('swiped', open);
      main.style.transform = open ? 'translateX(-96px)' : '';
      e.preventDefault();
      // Swallow the click that follows a swipe.
      main.addEventListener('click', ev => ev.stopImmediatePropagation(), { once: true, capture: true });
    } else if (start.open) {
      element.classList.remove('swiped'); main.style.transform = '';
      main.addEventListener('click', ev => ev.stopImmediatePropagation(), { once: true, capture: true });
    }
    start = undefined;
  };
  main.addEventListener('pointerup', finish);
  main.addEventListener('pointercancel', finish);
}

function updateResults() {
  const result = run?.result;
  const live = run?.calculator && !run.done;
  rows.forEach((row, i) => {
    const p = result?.players?.[i];
    row.equity.className = 'equity' + (!p ? ' empty' : live ? ' live' : '');
    row.equity.textContent = p ? pct(p.equity, live ? 1 : 2) : '—';
    row.breakdown.textContent = !p ? '' : state.game === 'omaha8'
      ? `Scoop ${pct(p.win)} · Hi ${pct(p.high_win)} · Lo ${pct(p.low_win)}`
      : `Win ${pct(p.win)} · Tie ${pct(p.tie)}`;
    row.bar.style.transform = `scaleX(${p ? p.equity : 0})`;
  });
}

function renderRun() {
  const button = $('calculate'), status = $('run-status');
  const running = Boolean(run?.calculator && !run.done);
  const progress = run?.progress;
  button.classList.toggle('running', running);
  button.classList.toggle('indeterminate', running && progress == null);
  button.querySelector('.calculate-fill').style.transform = running && progress != null ? `scaleX(${progress})` : '';
  $('calculate-label').textContent = running ? 'Stop' : run?.result ? 'Recalculate' : 'Calculate';
  $('calculate-value').textContent = running ? (progress == null ? 'Enumerating…' : `${Math.floor(progress * 100)}%`) : '';
  button.setAttribute('aria-label', running ? 'Stop calculation' : 'Calculate equity');
  status.classList.toggle('error', Boolean(run?.error));
  status.replaceChildren(...statusContent(running));
}

function statusContent(running) {
  if (run?.error) return [run.error];
  const r = run?.result;
  if (!run) return [boardStage()];
  if (running && !r) return [h('span.tag.live', { text: 'Live' }), 'Preparing ranges…'];
  if (running) {
    return [h('span.tag.live', { text: 'Live' }), `${formatCount(r.outcomes)} of ${formatCount(run.target)} samples`];
  }
  if (run.partial) {
    return [h('span.tag.partial', { text: 'Partial' }), `Stopped after ${formatCount(r.outcomes)} of ${formatCount(run.target)} samples`];
  }
  if (r.method === 'exact') {
    return [h('span.tag', { text: 'Exact' }), `${formatCount(r.outcomes)} outcomes · ${r.elapsed.toFixed(2)}s`];
  }
  const err = Math.max(...r.players.map(p => p.stderr));
  return [h('span.tag', { text: 'Monte Carlo' }), `${formatCount(r.outcomes)} samples · ±${(100 * 1.96 * err).toFixed(2)}% · ${r.elapsed.toFixed(1)}s`];
}

function boardStage() {
  const n = state.board.filter(Boolean).length;
  const street = { 0: 'Preflop', 3: 'Flop', 4: 'Turn', 5: 'River' }[n] ?? `Board needs ${3 - n} more card${3 - n === 1 ? '' : 's'}`;
  return `${GAME_NAMES[state.game]} · ${street} · ${state.players.length} players`;
}

function renderBoard() {
  const cards = state.board.map(c => cardFace(c, { placeholder: '' }));
  const items = [...cards.slice(0, 3), h('span.gap'), cards[3], h('span.gap'), cards[4]];
  $('board-cards').replaceChildren(...items);
  const n = state.board.filter(Boolean).length;
  const street = { 0: 'Preflop', 1: 'Add 2 more for the flop', 2: 'Add 1 more for the flop', 3: 'Flop', 4: 'Turn', 5: 'River' }[n];
  const dead = state.dead.length
    ? h('span', {}, 'Dead ', ...state.dead.map(c => cardFace(c, { mini: true })))
    : h('span', { text: 'Edit board & dead ›' });
  $('board-caption').replaceChildren(h('strong', { text: street }), dead);
  $('open-board').setAttribute('aria-label', `Board: ${street}. ${state.dead.length} dead cards. Edit`);
}

// ——— Game & players ———
const setGame = segmented(document.querySelector('.game-picker'), game => {
  if (game === state.game) return;
  state.game = game; invalidate();
}, 'game');

function addPlayer() {
  state.players.push(makePlayer(nextName(state.players), state.players.length));
  invalidate();
  $('players').scrollTo({ top: $('players').scrollHeight, behavior: 'smooth' });
}
function removePlayer(index) {
  if (state.players.length <= 2) return;
  state.players.splice(index, 1);
  invalidate();
}

function usedCards(exceptPlayer) {
  const used = new Map();
  state.board.forEach(c => c && used.set(c, 'on the board'));
  state.dead.forEach(c => used.set(c, 'dead'));
  state.players.forEach((p, i) => {
    if (i === exceptPlayer) return;
    const view = playerView(p, state.game);
    if (view.mode === 'cards') view.cards.forEach(c => c && used.set(c, `held by ${p.name}`));
  });
  return used;
}

function edit(index) {
  stopCalculation({ keep: true });
  openEditor({
    player: state.players[index], index, game: state.game,
    canRemove: state.players.length > 2,
    unavailable: usedCards(index),
    blocked: [...state.board.filter(Boolean), ...state.dead],
    onDone: player => { state.players[index] = player; invalidate(); },
    onRemove: () => removePlayer(index),
  });
}

// ——— Board sheet ———
const boardSheet = sheet($('board-sheet'));
let boardTarget = 'board', boardActive = 0;
const setBoardMode = segmented($('board-mode'), target => { boardTarget = target; boardActive = firstEmpty(); renderBoardSheet(); }, 'target');
const firstEmpty = () => {
  if (boardTarget === 'dead') return state.dead.length;
  const i = state.board.indexOf(null);
  return i < 0 ? 4 : i;
};

function renderBoardSheet() {
  setBoardMode(boardTarget);
  const isBoard = boardTarget === 'board';
  const cards = isBoard ? state.board : [...state.dead, null];
  renderSlots($('board-slots'), cards, {
    active: boardActive, gapsAfter: isBoard ? [2, 3] : [],
    labels: isBoard ? ['Flop', 'Flop', 'Flop', 'Turn', 'River'] : cards.map(() => ''),
    onSelect: i => { boardActive = i; renderBoardSheet(); },
  });
  const used = usedCards(-1);
  for (const c of isBoard ? state.board : state.dead) used.delete(c);
  renderDeck($('board-deck'), {
    selected: isBoard ? state.board.filter(Boolean) : state.dead,
    unavailable: used,
    onPick: (card, chosen) => {
      if (isBoard) {
        if (chosen) { const i = state.board.indexOf(card); state.board[i] = null; boardActive = i; }
        else { state.board[boardActive] = card; boardActive = firstEmpty(); }
      } else if (chosen) state.dead.splice(state.dead.indexOf(card), 1);
      else state.dead.push(card);
      if (!isBoard) boardActive = state.dead.length;
      invalidate(); renderBoardSheet();
    },
  });
  const n = state.board.filter(Boolean).length;
  $('board-hint').textContent = isBoard
    ? (n === 5 ? 'River dealt. Tap a card to remove it.' : `Tap cards to deal the ${['flop', 'flop', 'flop', 'turn', 'river'][boardActive] ?? 'board'}.`)
    : 'Dead cards are removed from the deck, e.g. folded or exposed cards.';
}

$('open-board').onclick = () => {
  stopCalculation({ keep: true });
  boardTarget = 'board'; boardActive = firstEmpty(); renderBoardSheet(); boardSheet.open();
};
$('board-done').onclick = () => boardSheet.close();
$('board-clear').onclick = () => {
  if (boardTarget === 'board') state.board.fill(null); else state.dead = [];
  boardActive = 0; invalidate(); renderBoardSheet();
};

// ——— Settings ———
const settingsSheet = sheet($('settings'));
const METHOD_NOTES = {
  auto: 'Enumerates every outcome when that is quick, otherwise samples.',
  exact: 'Every legal deal is counted. Can be slow for wide ranges or multiway pots.',
  monte_carlo: 'Random deals; the error shrinks as samples grow.',
};
const setMethod = segmented($('method'), value => { state.method = value; $('method-note').textContent = METHOD_NOTES[value]; invalidate(); });
const setSamples = segmented($('samples'), value => { state.samples = Number(value); invalidate(); });
$('open-settings').onclick = () => {
  setMethod(state.method); setSamples(state.samples); $('method-note').textContent = METHOD_NOTES[state.method];
  $('advanced-link').href = advancedHref(); settingsSheet.open();
};
$('settings-done').onclick = () => settingsSheet.close();
$('reset-all').onclick = () => { state = defaultState(); invalidate(); settingsSheet.close(); };

function advancedHref() {
  const params = new URLSearchParams({ game: state.game, board: state.board.filter(Boolean).join(''), dead: state.dead.join('') });
  try { params.set('ranges', state.players.map(p => expressionFor(p, state.game)).join('\n')); } catch { /* incomplete hand */ }
  return './advanced.html#' + params;
}

// ——— Calculation ———
function stopCalculation({ keep }) {
  if (!run?.calculator) return;
  run.calculator.dispose(); run.calculator = undefined;
  if (!run.done) {
    run.done = true;
    if (keep && run.result?.players?.length) run.partial = true;
    else if (!keep || !run.result) run = undefined;
  }
  renderRun(); updateResults();
}

async function calculate() {
  if (run?.calculator && !run.done) { stopCalculation({ keep: true }); return; }
  let ranges;
  try {
    const n = state.board.filter(Boolean).length;
    if (n === 1 || n === 2) throw new Error('Deal at least three board cards, or clear the board.');
    ranges = Object.fromEntries(state.players.map(p => [p.name, expressionFor(p, state.game)]));
  } catch (error) {
    run = { error: error.message, done: true }; renderRun(); updateResults(); return;
  }
  const calculator = new Calculator(ranges, {
    game: state.game, board: state.board.filter(Boolean).join(''), dead: state.dead.join(''),
  });
  const current = run = { calculator, target: state.samples, done: false, progress: 0 };
  renderRun(); updateResults();
  try {
    const result = await calculator.equity({
      method: state.method, samples: state.samples,
      // Heavily overlapping multiway ranges reject most draws; keep sampling (the user can Stop).
      maxAttempts: BigInt(state.samples) * 100000n,
      onProgress: p => {
        if (run !== current || current.done) return;
        current.progress = p.target ? Number(p.outcomes) / Number(p.target) : null;
        if (p.players.length) current.result = p;
        renderRun(); updateResults();
      },
    });
    if (run !== current) return;
    Object.assign(current, { result, done: true, progress: 1 });
  } catch (error) {
    if (run !== current || current.done) return;
    run = { error: friendlyError(error.message), done: true };
  } finally {
    calculator.dispose();
    if (run === current) current.calculator = undefined;
  }
  renderRun(); updateResults();
}

function friendlyError(message) {
  if (/Empty range/.test(message)) return 'A range has no hands left after removing the board and dead cards.';
  if (/Duplicate card/.test(message)) return 'The same card is used twice.';
  return message;
}

$('calculate').onclick = calculate;
window.addEventListener('pagehide', () => stopCalculation({ keep: true }));
render();
