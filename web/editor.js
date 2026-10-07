// Range / exact-hand editor. Works on a draft copy: Cancel discards, Done commits.
import {
  RANKS, SUITS, SUIT_NAMES, HAND_CLASSES, CLASS_BY_TEXT, classCombos, suitPatterns, classState, addClasses, removeClasses,
  withPattern, holdemPreset, topPercent, holdemShorthand, rangePercent, classPreset, GRID_LAYOUTS,
  OMAHA_FAMILIES, TEXTURES, CONNECTIONS, rundownHands, omahaSummary,
} from './model.js';
import { HOLDEM_ORDER } from './holdem-order.js';
import { $, h, sheet, segmented, cardFace, suitGlyphs, glyph, rankLabel } from './ui.js';
import { createMatrix } from './matrix.js';
import { ALL_CARDS, renderDeck, renderSlots } from './deck.js';
import { clonePlayer, family, handSize, expressionFor, GAME_NAMES } from './state.js';

const editorSheet = sheet($('editor'), { onDismiss: cancel });
const preview = new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' });
let ctx;        // { player (draft), index, game, unavailable, blocked, onDone, onRemove, canRemove }
let previewId = 0, previewTimer;

const setMode = segmented($('editor-mode'), mode => {
  ctx.player.mode[family(ctx.game)] = mode; build();
}, 'mode');

export function openEditor(options) {
  ctx = { ...options, player: clonePlayer(options.player), cardSlot: 0 };
  $('editor-title').textContent = ctx.player.name;
  $('remove-player').hidden = !ctx.canRemove;
  armRemove(false);
  build();
  editorSheet.open();
  $('editor-body').scrollTop = 0;
}

function cancel() { editorSheet.close(); ctx = undefined; }
$('editor-cancel').onclick = cancel;
$('editor-done').onclick = () => { const { onDone, player } = ctx; editorSheet.close(); ctx = undefined; onDone(player); };

function armRemove(armed) {
  const button = $('remove-player');
  button.dataset.armed = armed ? 'true' : '';
  button.setAttribute('aria-label', armed ? `Tap again to remove ${ctx.player.name}` : `Remove ${ctx.player.name}`);
}
$('remove-player').onclick = () => {
  if ($('remove-player').dataset.armed !== 'true') { armRemove(true); return; }
  const { onRemove } = ctx; editorSheet.close(); ctx = undefined; onRemove();
};

const mode = () => ctx.player.mode[family(ctx.game)];

function build() {
  const body = $('editor-body');
  setMode(mode());
  $('editor').setAttribute('aria-description', `${GAME_NAMES[ctx.game]} ${mode() === 'cards' ? 'exact hand' : 'range'}`);
  body.classList.toggle('fixed', mode() !== 'range' || ctx.game === 'holdem');
  if (mode() === 'cards') buildCards(body);
  else if (ctx.game === 'holdem') buildHoldem(body);
  else buildOmaha(body);
}

// ——— Summary card (live count) ———
function summaryCard() {
  const text = h('div.summary-text'), stat = h('div.summary-stat', {}, h('strong'), h('small'));
  const examples = h('div.summary-examples', { 'aria-label': 'Example hands' });
  const card = h('div.summary', { role: 'status', 'aria-live': 'polite' }, text, stat, examples);
  return { card, text, stat, examples };
}

function setSummary(summary, { label, combos, percent, error }) {
  summary.card.classList.toggle('error', Boolean(error));
  summary.text.classList.toggle('placeholder', !label && !error);
  summary.text.textContent = error ?? (label || 'No hands selected');
  const [strong, small] = summary.stat.children;
  strong.textContent = error || combos == null ? '' : `${percent.toFixed(percent < 1 && percent > 0 ? 2 : 1)}%`;
  small.textContent = error ? '' : combos == null ? 'Counting…' : `${combos.toLocaleString()} combo${combos === 1 ? '' : 's'}`;
}

// ——— Hold'em range ———
function buildHoldem(body) {
  const p = ctx.player, summary = summaryCard();
  summary.examples.remove();
  const presets = h('div.chips.scroll', { role: 'group', 'aria-label': 'Quick ranges' },
    ...[['pairs', 'Pairs'], ['suited', 'Suited'], ['broadway', 'Broadway'], ['all', 'Any two'], ['clear', 'Clear']].map(([key, label]) =>
      h('button.chip', { dataset: { preset: key }, onclick: () => { p.holdem = holdemPreset(key); refresh(); } }, label)));

  const matrix = createMatrix({
    label: 'Hold’em hand classes',
    fill: text => { const { count, total } = classState(p.holdem, text); return count / total; },
    onStage: () => renderStage(),
  });
  const slider = strengthSlider(matrix, () => renderStage());
  const stage = h('div.stage-bar');
  let suitsOpen = null; // null = automatic: open for small selections

  function renderStage() {
    const staged = HAND_CLASSES.filter(c => matrix.staged.has(c.text));
    if (!staged.length) suitsOpen = null;
    const showSuits = suitsOpen ?? staged.length <= 3;
    const stagedCombos = staged.reduce((n, c) => n + c.combos, 0);
    slider.sync();
    if (!staged.length) {
      stage.className = 'stage-bar empty';
      stage.replaceChildren('Tap or drag across hands, then Add or Remove.');
      return;
    }
    stage.className = 'stage-bar';
    const names = staged.map(c => c.text);
    stage.replaceChildren(
      h('div.stage-info', {}, h('strong', { text: `${staged.length} hand${staged.length === 1 ? '' : 's'}` }),
        h('small', { text: `${stagedCombos} combos · ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}` })),
      h('div.stage-actions', {},
        h('button.dismiss', { 'aria-label': 'Clear selection', onclick: () => matrix.clearStage() }, '✕'),
        h('button.suits-toggle', { id: 'toggle-suits', 'aria-expanded': String(showSuits), onclick: () => { suitsOpen = !showSuits; renderStage(); } }, 'Suits'),
        h('button.remove', { id: 'remove-selection', onclick: () => commit(false) }, 'Remove'),
        h('button.add', { id: 'add-selection', onclick: () => commit(true) }, 'Add')),
      ...(showSuits ? [suitChips(staged)] : []));
  }

  /** Per-suit toggles for the selected classes, e.g. only ♥♥ of AKs. */
  function suitChips(staged) {
    const rows = [];
    for (const [kind, label] of [['pair', 'Pairs'], ['suited', 'Suited'], ['offsuit', 'Offsuit']]) {
      const classes = staged.filter(c => (c.pair ? 'pair' : c.suited ? 'suited' : 'offsuit') === kind).map(c => c.text);
      if (!classes.length) continue;
      const chips = suitPatterns(kind).map(pattern => {
        const inRange = classes.filter(text => p.holdem.has(comboFor(text, pattern))).length;
        const state = inRange === classes.length ? 'true' : inRange ? 'mixed' : 'false';
        const name = `${SUIT_NAMES[pattern[0]]} and ${SUIT_NAMES[pattern[1]]}`;
        return h('button.suit-chip', {
          'aria-pressed': state, 'aria-label': `${label} ${name}`,
          onclick: () => { p.holdem = withPattern(p.holdem, classes, pattern, state !== 'true'); refresh(); },
        }, suitGlyphs(pattern));
      });
      rows.push(h('div', {}, h('small', { text: `${label} · first suit is the higher card` }), ...chips));
    }
    return h('div.stage-suits', {}, rows);
  }

  function commit(add) {
    const texts = [...matrix.staged];
    p.holdem = add ? addClasses(p.holdem, texts) : removeClasses(p.holdem, texts);
    matrix.staged.clear(); refresh();
  }

  function refresh() {
    matrix.refresh(); renderStage();
    const percent = rangePercent(p.holdem);
    setSummary(summary, { label: p.holdem.size === 1326 ? 'Any two cards' : holdemShorthand(p.holdem), combos: p.holdem.size, percent });
  }

  body.replaceChildren(summary.card,
    slider.row,
    presets, matrix.element, stage);
  refresh();
}

/** "Top X%" slider that stages the strongest hand classes, like a drag; Add/Remove applies them. */
function strengthSlider(matrix, onChange) {
  const slider = h('input', { type: 'range', min: '0', max: '100', step: '0.5', value: '0', id: 'top-percent', 'aria-label': 'Select the strongest percent of hands' });
  const output = h('output', { for: 'top-percent' });
  slider.oninput = () => {
    const combos = topPercent(Number(slider.value), HOLDEM_ORDER);
    matrix.staged.clear();
    for (const text of HOLDEM_ORDER) if (combos.has(classCombos(text)[0])) matrix.staged.add(text);
    matrix.refresh(); onChange();
  };
  const sync = () => {
    const combos = [...matrix.staged].reduce((n, text) => n + CLASS_BY_TEXT.get(text).combos, 0);
    if (!combos) slider.value = '0';
    output.textContent = `${(combos / 13.26).toFixed(1)}%`;
  };
  return { row: h('div.slider-row', {}, h('label', { for: 'top-percent', text: 'Top' }), slider, output), sync };
}

function comboFor(text, [s1, s2]) {
  const c = CLASS_BY_TEXT.get(text);
  const [a, b] = [text[0], text[1]];
  if (c.pair && SUITS.indexOf(s1) > SUITS.indexOf(s2)) [s1, s2] = [s2, s1];
  return a + s1 + b + s2;
}

// ——— Omaha range ———
function buildOmaha(body) {
  const o = ctx.player.omaha, summary = summaryCard();
  const sections = h('div.section');
  const update = () => { renderRanks(); renderSuits(); count(summary); };

  const builder = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Rank builder' },
    h('button', { role: 'radio', dataset: { value: 'family' } }, 'Hand families'),
    h('button', { role: 'radio', dataset: { value: 'grids' } }, 'Two-card grids'));
  const setBuilder = segmented(builder, value => { o.builder = value; update(); });
  const ranks = h('div.section');

  function renderRanks() {
    setBuilder(o.builder);
    ranks.replaceChildren(...(o.builder === 'family' ? familyControls() : gridControls()));
  }

  function familyControls() {
    const chips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Hand family' },
      ...Object.entries(OMAHA_FAMILIES).map(([key, f]) => h('button.chip', {
        role: 'radio', 'aria-checked': String(o.family === key), dataset: { family: key },
        onclick: () => { o.family = key; update(); },
      }, f.label)));
    const out = [chips, h('p.section-note', { text: OMAHA_FAMILIES[o.family].detail })];
    if (o.family === 'rundown') out.push(rundownControls());
    if (o.family === 'custom') out.push(rankSlots());
    return out;
  }

  function rundownControls() {
    const r = o.rundown;
    const rankPick = (value, label, onChange) => pick(value, RANKS.split('').map(x => [x, rankLabel(x)]), label, onChange);
    const distancePick = (value, label, onChange) => pick(String(value), Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)]), label, v => onChange(Number(v)));
    let hands = [], error;
    try { hands = rundownHands(r); if (!hands.length) throw new Error('No hands fit these limits'); } catch (e) { error = e.message; }
    const rows = [
      h('div.stepper-row', {}, h('span', {}, 'Highest card', h('small', { text: 'from … to' })),
        h('div.range-pick', {}, rankPick(r.highMin, 'Lowest allowed top card', v => { r.highMin = v; update(); }), h('span', { text: 'to' }),
          rankPick(r.highMax, 'Highest allowed top card', v => { r.highMax = v; update(); }))),
      ...['1st → 2nd card', '2nd → 3rd card', '3rd → 4th card'].map((label, i) =>
        h('div.stepper-row', {}, h('span', {}, `Gap ${label}`, h('small', { text: gapWords(r.gaps[i]) })),
          h('div.range-pick', {},
            distancePick(r.gaps[i][0], `Minimum distance ${label}`, v => { r.gaps[i][0] = v; update(); }), h('span', { text: 'to' }),
            distancePick(r.gaps[i][1], `Maximum distance ${label}`, v => { r.gaps[i][1] = v; update(); })))),
    ];
    const note = error
      ? h('p.section-note.error', { text: error })
      : h('p.section-note', { text: `${hands.length} rank pattern${hands.length === 1 ? '' : 's'}: ${hands.slice(0, 6).join(', ')}${hands.length > 6 ? '…' : ''}. Distance 1 = consecutive ranks (9-8); 2 = one rank skipped (9-7). Aces are high only.` });
    return h('div', { style: { display: 'grid', gap: '8px' } }, h('div.card-group', {}, rows), note);
  }

  function rankSlots() {
    return h('div.required', { 'aria-label': 'Four rank slots' }, ...o.slots.map((rank, i) =>
      h('div.need' + (rank !== '*' ? '.set' : ''), {},
        pick(rank, [['*', 'Any'], ...RANKS.split('').map(x => [x, rankLabel(x)])], `Rank of card ${i + 1}`, v => { o.slots[i] = v; update(); }),
        h('small', { text: `Card ${i + 1}` }))));
  }

  function gridControls() {
    const layout = GRID_LAYOUTS[o.gridLayout] ?? GRID_LAYOUTS.topbottom;
    const layoutPicker = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Which cards each grid describes' },
      ...Object.entries(GRID_LAYOUTS).map(([key, l]) => h('button', { role: 'radio', dataset: { value: key } }, l.label)));
    segmented(layoutPicker, v => { o.gridLayout = v; update(); })(o.gridLayout ?? 'topbottom');
    const active = o.activeGroup ?? 0;
    const tabs = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Grid' },
      ...o.groups.map((g, i) => h('button', { role: 'radio', dataset: { value: String(i), grid: String(i) } },
        `${layout.names[i]} · ${!g.size || g.size === HAND_CLASSES.length ? 'any' : g.size}`)));
    segmented(tabs, v => { o.activeGroup = Number(v); update(); })(String(active));
    const group = o.groups[active];
    const matrix = createMatrix({
      label: layout.names[active],
      fill: text => group.has(text) ? 1 : 0,
      onStage: () => renderStage(),
    });
    const slider = strengthSlider(matrix, () => renderStage());
    const presets = h('div.chips.scroll', { role: 'group', 'aria-label': 'Grid presets' },
      ...[['pairs', 'Pairs'], ['suited', 'Suited'], ['broadway', 'Broadway'], ['clear', 'Clear (any)']].map(([key, label]) =>
        h('button.chip', { dataset: { gridPreset: key }, onclick: () => { o.groups[active] = classPreset(key); update(); } }, label)));
    const stage = h('div.stage-bar');
    function renderStage() {
      slider.sync();
      const n = matrix.staged.size;
      if (!n) {
        stage.className = 'stage-bar empty';
        stage.replaceChildren(group.size ? 'Tap or drag across hands, then Add or Remove.' : 'Empty grid = any two cards. Select hands and Add to narrow it.');
        return;
      }
      stage.className = 'stage-bar';
      stage.replaceChildren(h('div.stage-info', {}, h('strong', { text: `${n} hand${n === 1 ? '' : 's'}` }), h('small', { text: [...matrix.staged].slice(0, 6).join(', ') })),
        h('div.stage-actions', {},
          h('button.dismiss', { 'aria-label': 'Clear selection', onclick: () => matrix.clearStage() }, '✕'),
          h('button.remove', { id: 'remove-selection', onclick: () => apply(false) }, 'Remove'),
          h('button.add', { id: 'add-selection', onclick: () => apply(true) }, 'Add')));
    }
    function apply(add) {
      for (const text of matrix.staged) add ? group.add(text) : group.delete(text);
      matrix.staged.clear(); update();
    }
    renderStage();
    return [layoutPicker, h('p.section-note', { text: layout.detail }), tabs, slider.row, presets, matrix.element, stage,
      h('p.section-note', { text: 'Suits have no rank: with two kings either one can be the higher card, and a hand counts if any such split fits. Grid suited/offsuit (AKs) is about those two cards; the filters below look at all four.' })];
  }

  // Suits
  const suits = h('div.section');
  function renderSuits() {
    const any = !o.textures.length;
    const textureChips = h('div.chips', { role: 'group', 'aria-label': 'Suit textures (choose any number)' },
      h('button.chip.texture-chip', { 'aria-pressed': String(any), onclick: () => { o.textures = []; update(); } }, 'Any', h('small', { text: 'no filter' })),
      ...TEXTURES.map(t => h('button.chip.texture-chip', {
        'aria-pressed': String(o.textures.includes(t.key)), dataset: { texture: t.key }, 'aria-label': `${t.name} (${t.label})`,
        onclick: () => { o.textures = o.textures.includes(t.key) ? o.textures.filter(k => k !== t.key) : [...o.textures, t.key]; update(); },
      }, dots(t.label), h('small', { text: t.name }))));
    const connection = CONNECTIONS.find(c => c.key === o.connection) ?? CONNECTIONS[0];
    const connectionChips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Which cards are suited' },
      ...CONNECTIONS.map(c => h('button.chip', { role: 'radio', 'aria-checked': String(c.key === o.connection), dataset: { connection: c.key }, onclick: () => { o.connection = c.key; update(); } }, c.label)));
    const required = h('div.required', { 'aria-label': 'Required cards' }, ...o.required.map((slot, i) => requiredSlot(slot, i)));
    suits.replaceChildren(
      title('Suit texture', any ? 'Any' : 'Pick one or more'), textureChips,
      h('p.section-note', { text: 'Counts how the four suits split: 2+2 is double suited, 2+1+1 single suited.' }),
      title('Suited cards'), connectionChips, h('p.section-note', { text: connection.detail }),
      title('Must include', 'Each box is a different card'), required,
      h('p.section-note', { text: 'Set a rank, a suit, or both. A♠ means the hand holds the ace of spades; two boxes of ♥ mean at least two hearts.' }));
  }

  function requiredSlot(slot, i) {
    const set = slot.rank !== '*' || slot.suit !== '*';
    return h('div.need' + (set ? '.set' : ''), { role: 'group', 'aria-label': `Required card ${i + 1}` },
      pick(slot.rank, [['*', 'Rank'], ...RANKS.split('').map(x => [x, rankLabel(x)])], `Required card ${i + 1} rank`, v => { slot.rank = v; update(); }),
      pick(slot.suit, [['*', 'Suit'], ...SUITS.map(s => [s, glyph(s)])], `Required card ${i + 1} suit`, v => { slot.suit = v; update(); }, slot.suit === '*' ? '' : `g-${slot.suit}`));
  }

  sections.append(title('Ranks'), builder, ranks);
  body.replaceChildren(summary.card, sections, suits);
  update();
}

const title = (text, aside) => h('div.section-title', {}, h('h3', { text }), aside ? h('small', { text: aside }) : null);
const dots = label => h('span.dots', { 'aria-hidden': 'true' }, ...label.split('+').flatMap((n, g) =>
  Array.from({ length: Number(n) }, () => h('i', { style: { '--d': ['var(--suit-h)', 'var(--suit-d)', 'var(--suit-c)', 'var(--suit-s)'][g] } }))));
const gapWords = ([min, max]) => {
  const word = n => n === 1 ? 'consecutive' : `${n - 1} skipped`;
  return min === max ? word(min) : `${word(min)} to ${word(max)}`;
};

/** A large tappable value backed by a native <select> (iOS shows its wheel picker). */
function pick(value, options, label, onChange, tone = '') {
  const shown = options.find(([v]) => v === value)?.[1] ?? value;
  return h('span.pick', { className: value === '*' ? 'unset' : undefined }, h('span', { text: shown, className: tone || undefined }), select(value, options, label, onChange));
}
function select(value, options, label, onChange) {
  const el = h('select', { 'aria-label': label }, ...options.map(([v, text]) => h('option', { value: v, text })));
  el.value = value; el.onchange = () => onChange(el.value);
  return el;
}

function count(summary) {
  clearTimeout(previewTimer);
  const id = ++previewId;
  let expression;
  try { expression = expressionFor(ctx.player, ctx.game); } catch (e) {
    setSummary(summary, { error: e.message }); summary.examples.replaceChildren(); return;
  }
  const label = omahaSummary(ctx.player.omaha).replace(/\bwith (.+)$/, (_, c) => 'with ' + c.replace(/([cdhs])/g, s => glyph(s)));
  setSummary(summary, { label });
  previewTimer = setTimeout(() => {
    preview.onmessage = ({ data }) => {
      if (data.id !== previewId) return;
      if (data.error) { setSummary(summary, { error: data.error }); return; }
      if (!data.count) { setSummary(summary, { error: 'No hands match. Loosen a constraint.' }); summary.examples.replaceChildren(); return; }
      setSummary(summary, { label, combos: data.count, percent: data.count / 270725 * 100 });
      summary.examples.replaceChildren(...data.examples.map(cards => h('span', { 'aria-label': cards.join(' ') }, cards.map(c => cardFace(c, { mini: true })))));
    };
    preview.postMessage({ id, expression, game: ctx.game, blocked: ctx.blocked.join('') });
  }, 120);
}

// ——— Exact hand ———
function buildCards(body) {
  const cards = ctx.player.cards[family(ctx.game)], n = handSize(ctx.game);
  const slots = h('div.hand-slots'), deck = h('div.deck', { role: 'group', 'aria-label': 'Deck' });
  const hint = h('p.hint');
  const nextEmpty = () => { const i = cards.slice(0, n).indexOf(null); return i < 0 ? ctx.cardSlot : i; };
  function render() {
    renderSlots(slots, cards.slice(0, n), { active: ctx.cardSlot, onSelect: i => { ctx.cardSlot = i; render(); } });
    renderDeck(deck, {
      selected: cards.slice(0, n).filter(Boolean), unavailable: ctx.unavailable,
      onPick: (card, chosen) => {
        if (chosen) { const i = cards.indexOf(card); cards[i] = null; ctx.cardSlot = i; }
        else { cards[ctx.cardSlot] = card; ctx.cardSlot = nextEmpty(); }
        render();
      },
    });
    const missing = cards.slice(0, n).filter(c => !c).length;
    hint.textContent = missing ? `Tap ${missing} more card${missing === 1 ? '' : 's'}. Dimmed cards are on the board, dead, or held by another player.` : 'Tap a chosen card to swap it out.';
  }
  const random = h('button.chip', { onclick: () => {
    const free = ALL_CARDS.filter(c => !ctx.unavailable.has(c));
    for (let i = 0; i < n; i++) cards[i] = free.splice(Math.floor(Math.random() * free.length), 1)[0];
    ctx.cardSlot = 0; render();
  } }, 'Deal random');
  ctx.cardSlot = nextEmpty();
  body.replaceChildren(slots, h('div.chips', { style: { justifyContent: 'center' } }, random), hint, deck);
  render();
}
