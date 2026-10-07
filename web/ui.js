// Small DOM helpers shared by the main screen and the sheets.
import { SUITS, SUIT_GLYPHS, SUIT_NAMES } from './model.js';

export const $ = id => document.getElementById(id);

/** h('button.chip', {onclick, 'aria-pressed': true}, 'Text', childNode) */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (name === 'button') el.type = 'button';
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el[key] = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? el.style.setProperty(prop, v) : (el.style[prop] = v);
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'className') el.className += ' ' + value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter(c => c !== undefined && c !== null && c !== false));
  return el;
}

const RANK_WORDS = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten' };
export const cardName = card => `${RANK_WORDS[card[0]] ?? card[0]} of ${SUIT_NAMES[card[1]]}`;
export const rankLabel = rank => rank === 'T' ? '10' : rank;
export const glyph = suit => SUIT_GLYPHS[SUITS.indexOf(suit)];

/** A four-colour card face. Pass null for an empty slot. */
export function cardFace(card, { tag = 'span', mini = false, placeholder = '' } = {}) {
  if (!card) return h(`${tag}.card.empty${mini ? '.mini' : ''}`, {}, h('b', { text: placeholder }));
  return h(`${tag}.card.${card[1]}${mini ? '.mini' : ''}`, { 'aria-label': cardName(card), role: tag === 'span' ? 'img' : undefined },
    h('b', { text: rankLabel(card[0]) }), h('i', { text: glyph(card[1]), 'aria-hidden': 'true' }));
}

/** Coloured suit glyphs, e.g. suitGlyphs(['h','h']) for a ♥♥ chip. */
export const suitGlyphs = suits => suits.map(s => h(`span.g-${s}`, { text: glyph(s) }));

/** Wire a role=radiogroup of buttons; returns a setter. */
export function segmented(group, onChange, key = 'value') {
  const buttons = [...group.querySelectorAll('[role="radio"]')];
  const set = value => buttons.forEach(b => b.setAttribute('aria-checked', String(b.dataset[key] === String(value))));
  buttons.forEach(b => { b.onclick = () => { set(b.dataset[key]); onChange(b.dataset[key]); }; });
  group.onkeydown = e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const i = buttons.findIndex(b => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(i + step + buttons.length) % buttons.length];
    e.preventDefault(); next.focus(); next.click();
  };
  return set;
}

/** Slide-up sheet built on <dialog>, so focus trapping and Escape come for free. */
export function sheet(dialog, { onDismiss } = {}) {
  let closing;
  const api = {
    open() {
      if (dialog.open) return;
      clearTimeout(closing); dialog.showModal();
      requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('shown')));
    },
    close() {
      if (!dialog.open) return;
      dialog.classList.remove('shown');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      closing = setTimeout(() => dialog.close(), reduced ? 0 : 330);
    },
    get isOpen() { return dialog.open && dialog.classList.contains('shown'); },
  };
  dialog.addEventListener('cancel', e => { e.preventDefault(); (onDismiss ?? api.close)(); });
  // Tapping the dimmed backdrop dismisses, like an iOS sheet.
  dialog.addEventListener('click', e => { if (e.target === dialog) (onDismiss ?? api.close)(); });
  return api;
}

export function formatCount(n) {
  n = Number(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  return n.toLocaleString();
}
export const pct = (x, digits = 1) => `${(100 * x).toFixed(digits)}%`;
