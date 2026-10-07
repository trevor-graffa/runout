// A one-tap 52-card picker: one row per suit, aces first.
import { RANKS } from './model.js';
import { h, cardFace, cardName } from './ui.js';

const ROW_SUITS = ['s', 'h', 'd', 'c'];
export const ALL_CARDS = ROW_SUITS.flatMap(s => [...RANKS].map(r => r + s));

/**
 * selected: cards chosen for the current target (tap to remove).
 * unavailable: Map card → reason, for cards used elsewhere.
 */
export function renderDeck(container, { selected, unavailable, onPick }) {
  container.replaceChildren(...ALL_CARDS.map(card => {
    const chosen = selected.includes(card), reason = unavailable.get(card);
    const button = cardFace(card, { tag: 'button' });
    button.setAttribute('aria-pressed', String(chosen));
    button.setAttribute('aria-label', cardName(card) + (reason ? `, ${reason}` : ''));
    button.disabled = Boolean(reason) && !chosen;
    button.onclick = () => onPick(card, chosen);
    return button;
  }));
}

/** Row of card slots; the active slot is outlined. */
export function renderSlots(container, cards, { active, labels = [], onSelect, gapsAfter = [] }) {
  const items = [];
  cards.forEach((card, i) => {
    const slot = h('button.slot', { 'aria-current': String(i === active), 'aria-label': `${labels[i] ?? `Card ${i + 1}`}${card ? `: ${cardName(card)}` : ', empty'}`, onclick: () => onSelect(i) },
      cardFace(card, { placeholder: '+' }), labels[i] ? h('span.slot-label', { text: labels[i] }) : null);
    items.push(slot);
    if (gapsAfter.includes(i)) items.push(h('span.slot-spacer'));
  });
  container.replaceChildren(...items);
}
