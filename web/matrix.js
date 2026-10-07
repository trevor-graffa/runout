// 13×13 hand-class grid. Dragging stages cells; the caller commits with Add/Remove.
import { HAND_CLASSES } from './model.js';
import { h } from './ui.js';

export function createMatrix({ label, fill, onStage }) {
  const staged = new Set();
  const cells = new Map();
  const grid = h('div.matrix', { role: 'group', 'aria-label': label });
  for (const hand of HAND_CLASSES) {
    const kind = hand.pair ? 'pair' : hand.suited ? 'suited' : 'offsuit';
    const cell = h(`button.${kind}`, { dataset: { hand: hand.text }, tabindex: '-1' }, h('span', { text: hand.text }));
    cells.set(hand.text, cell); grid.append(cell);
  }
  cells.get('AA').tabIndex = 0;

  let gesture;
  const toggle = (text, on) => {
    if (on) staged.add(text); else staged.delete(text);
    paintStage(text);
  };
  const visit = cell => {
    const text = cell?.dataset.hand;
    if (!text || cell.parentElement !== grid || gesture.visited.has(text)) return;
    gesture.visited.add(text); toggle(text, gesture.adding); onStage?.();
  };
  grid.addEventListener('pointerdown', e => {
    const cell = e.target.closest('button');
    if (!cell || e.button > 0) return;
    e.preventDefault();
    grid.setPointerCapture(e.pointerId);
    gesture = { adding: !staged.has(cell.dataset.hand), visited: new Set(), last: { x: e.clientX, y: e.clientY } };
    visit(cell);
  });
  grid.addEventListener('pointermove', e => {
    if (!gesture) return;
    // Interpolate between samples so a fast swipe can't skip a cell.
    const from = gesture.last ?? { x: e.clientX, y: e.clientY };
    const step = grid.firstChild.getBoundingClientRect().width / 3;
    const n = Math.max(1, Math.ceil(Math.hypot(e.clientX - from.x, e.clientY - from.y) / step));
    for (let i = 1; i <= n; i++) {
      const x = from.x + (e.clientX - from.x) * i / n, y = from.y + (e.clientY - from.y) * i / n;
      visit(document.elementFromPoint(x, y)?.closest('.matrix button'));
    }
    gesture.last = { x: e.clientX, y: e.clientY };
  });
  const end = () => { gesture = undefined; };
  grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
  grid.addEventListener('lostpointercapture', end);
  // Keyboard: Enter/Space stage, arrows move (roving tabindex).
  grid.addEventListener('click', e => {
    const cell = e.target.closest('button');
    if (!cell || e.detail !== 0) return;
    toggle(cell.dataset.hand, !staged.has(cell.dataset.hand)); onStage?.();
  });
  grid.addEventListener('keydown', e => {
    const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    const cell = e.target.closest('button');
    if (!step || !cell) return;
    e.preventDefault();
    const hand = HAND_CLASSES.find(c => c.text === cell.dataset.hand);
    const row = Math.min(12, Math.max(0, hand.row + step[0])), col = Math.min(12, Math.max(0, hand.col + step[1]));
    const next = cells.get(HAND_CLASSES[row * 13 + col].text);
    cell.tabIndex = -1; next.tabIndex = 0; next.focus();
  });

  function paintStage(text) {
    cells.get(text).classList.toggle('staged', staged.has(text));
    describe(text);
  }
  function describe(text) {
    const cell = cells.get(text), amount = fill(text);
    const membership = amount >= 1 ? 'in range' : amount > 0 ? `${Math.round(amount * 100)}% of combos in range` : 'not in range';
    cell.setAttribute('aria-label', `${text}, ${membership}${staged.has(text) ? ', selected' : ''}`);
  }
  function refresh() {
    for (const [text, cell] of cells) {
      const amount = fill(text);
      cell.style.setProperty('--fill', amount);
      cell.classList.toggle('full', amount >= 1);
      cell.classList.toggle('partial', amount > 0 && amount < 1);
      cell.classList.toggle('staged', staged.has(text));
      describe(text);
    }
  }
  function clearStage() { staged.clear(); refresh(); onStage?.(); }
  refresh();
  return { element: grid, staged, refresh, clearStage };
}

