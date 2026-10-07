import { parseRange, RANKS, SUITS } from './ranges.js';
// Counts a range off the main thread and returns a few random example hands.
self.onmessage = ({ data: { id, expression, game, blocked } }) => {
  try {
    const range = parseRange(expression, { game, blocked });
    const picks = new Set();
    while (picks.size < Math.min(3, range.size)) picks.add(Math.floor(Math.random() * range.size));
    const examples = [...picks].map(i => {
      const cards = [], bits = BigInt(range.entries[i][0]);
      for (let c = 51; c >= 0; c--) if (bits & 1n << BigInt(c)) cards.push(RANKS[c >> 2] + SUITS[c & 3]);
      return cards;
    });
    self.postMessage({ id, count: range.size, examples });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
