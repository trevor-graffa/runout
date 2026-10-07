# Python, Rust, and the browser

Python remains the notebook and CLI interface. `Calculator` holds reusable ranges
and named players; `EquityResult` displays as a notebook HTML table and offers
ordinary dictionaries or an optional pandas DataFrame. Existing `equity`,
`evaluate_cards`, `evaluate_hand`, and `Range` interfaces remain available.

Rust owns numeric cards, prepared hands, rank tables, compiled numeric ranges,
sampling, exact enumeration, and pot-share accumulation. It accepts numeric card
IDs and `(mask, weight)` pairs. It never parses range text. PyO3 exports the native
Python extension; wasm-bindgen exports the same evaluator/simulator to JavaScript.
Production Python and WASM builds do not compile or link C++.

The web app uses HTML and JavaScript. `web/poker.js` provides an asynchronous
Calculator, `web/ranges.js` expands high-level text ranges, and `web/worker.js`
owns a Rust/WASM calculator. `web/preview-worker.js` counts ranges and samples
example hands off the UI thread. Worker messages carry requests/results; evaluation
and parsing happen outside the UI thread. The page only fetches static assets.

The phone app is `index.html` with `app.css`, `app.js` (main screen, board sheet,
settings, calculation), `editor.js` (range/hand editor), `matrix.js` (13×13 grid),
`deck.js` (52-card picker), `ui.js` (DOM helpers and sheets), `state.js` (state,
defaults, and localStorage key `runout:v1`), and `model.js`, a pure model that
turns Omaha and Hold'em editor choices into range expressions and checks that they
round-trip through `ranges.js`. `holdem-order.js` ranks the 169 Hold'em classes for
the Top % slider; `tools/holdem_order.py` generates it with Monte Carlo sampling
(25M samples per class, seed 42). The manifest and icons allow standalone
home-screen use.
There is no equity service, account requirement, or Python browser runtime.

```js
import { Calculator } from './poker.js';

const calc = new Calculator({Hero: 'AA$ds', Villain: 'random'},
                            {game: 'omaha', board: '2c3d4h'});
try {
  const result = await calc.simulate({
    samples: 100000, seed: 42n,
    onProgress: partial => console.log(partial.outcomes, partial.players),
  });
  console.log(result.players, result.rangeSizes);
} finally {
  calc.dispose();
}
```

`calc.exact({maxExact: 2000000})` and `calc.equity({method: 'auto'})` are also
available. One Calculator reuses its compiled ranges across calls. Make another
Calculator for a different board/game. `dispose()` cancels pending work and
terminates its worker. Seeds/outcome counts are BigInt in JavaScript; use a
string conversion when serializing them to JSON. Card masks remain exact Numbers
because they use at most 52 bits. Use HTTPS on a static host; development works
over localhost HTTP. Opening HTML directly with `file://` does not work.

Monte Carlo progress reports cumulative statistics from the same random stream
as the final result, including actual accepted outcomes. Exact calculations
show an indeterminate progress indicator and deliver results when enumeration
finishes. Calculate becomes Stop, which cancels the job and terminates its worker;
the partial Monte Carlo result is kept and labelled PARTIAL.

The status line labels a result LIVE, PARTIAL, EXACT, or MONTE CARLO. Monte Carlo
results show the sample count, a ±95% interval (1.96 × the largest stderr), and time.

## Mobile and browser limits

The app has touch-sized primary controls, 16px input text, viewport/safe-area
support, and per-player equity results. The 13×13 range matrix is fitted to the
phone width; there is no scrolling grid mode. Chrome tests (`visual-browser.mjs`,
`browser.mjs`) cover phone-width layouts from 320 to 1100px and heights 568–844px,
using CDP touch events in mobile emulation. They also check drag-staging, calculations
in all three games, and cancellation during a long simulation. WebKit tests
(Playwright, touch emulation) cover touch interaction, worker reuse, errors, and
seeded multiway results with a mobile viewport. Physical
iPhone testing has not been performed; no performance claims for a phone are
inferred from the M1 measurements.

WASM runs one computation thread in one Web Worker. This avoids requiring
SharedArrayBuffer, cross-origin isolation headers, or special hosting. Native
Python supports up to 256 requested Monte Carlo threads. Exact enumeration is
single-threaded in both builds. Running several browser Calculators creates
separate WASM memories, so dispose them when finished.

The WASM binary is approximately 3.4 MiB before HTTP compression and includes
compressed tables. Hold'em/core tables inflate to about 1 MiB; Omaha adds about
21.4 MiB. Broad Omaha ranges expand to 270,725 hands and use additional memory
for JavaScript parsing and Rust compiled combos. The first Omaha calculation
therefore has visible setup cost. The UI defaults to 100,000 samples and supports
Cancel. Very large exact jobs respect outcome/traversal limits; incompatible
ranges respect an attempt limit and raise an error instead of producing biased
results. The supported syntax is documented in [ranges.md](ranges.md).

## Simplicity review

There is one production numeric core for both runtimes. Python/JavaScript own
host-specific parsing and presentation; shared fixtures protect their syntax
conventions and native/WASM result parity. Keeping browser parsing in JavaScript
avoids shipping a Python runtime. The Rust core contains no unsafe blocks.

Rust embeds verified numeric assets rather than vendoring a second evaluator
implementation or generating tables at runtime. It uses the standard library's
threads, OnceLock, and Arc, a small local portable RNG, and one simulation
implementation. Uniform ranges skip alias tables; cached ranges skip repeated
preparation. No database, framework, npm runtime dependencies, or web backend is
needed. An unused serde_json dependency was removed during review.

The formatted production Rust files contain about 1,314 lines including both
bindings, versus about 2,735 C++/header lines in the prior production core and
vendored evaluator (including 1,031 generated offset-table lines). Excluding
generated table source, the reduction is more modest. The entire repository is
larger because the original C++ is deliberately preserved, along with new web
code and verification tools. Smaller source is not used as a reason to remove
correctness checks, weighting, low-hand rules, or useful API features.

The old `setup.py`/CMake files belong to the preserved C++ baseline. Use
`tools/build_cpp_reference.py` to build it alongside Rust as `_cpp_reference`.
Do not run the old `setup.py build_ext --inplace` in a Rust checkout: it would
overwrite the production extension. The original baseline is also retained in
Git commit `485160c`. Matched benchmark results are in [performance.md](performance.md).

## Range and board editing

The main screen lists players in one fixed portrait view; rows compact for 5+ and
7+ players. Tap a row (or double-tap) to open the editor sheet, which works on a
draft copy: Cancel discards it and Done commits it. The trash button in the editor
removes the player. The board strip opens a sheet with Board and Dead cards tabs
and a 4-row deck; each card is a single tap.

The Hold’em editor has Range and Exact hand modes. Range shows a live summary
(shorthand, percentage, and combo count), a Top % slider, quick chips (Pairs,
Suited, Broadway, Any two, Clear), and the 13×13 matrix. Taps and drags stage cells
with an amber outline; Add and Remove commit them, and in-range cells show green,
with partial fill for partial combos. Staged suited, pair, and offsuit cells show
suit chips that include or exclude exact suit combinations (the first suit is the
higher-ranked card). Exact hand mode uses the card picker; cards already on the
board, dead, or held are disabled. Deal random fills a random hand.

The Omaha editor offers hand families (Any, Aces, Big pairs, Broadway, Rundowns,
Ace–deuce, Low starters, Pick ranks) or positional pair grids
(Top + bottom: the two highest and two lowest cards; Outer + middle: highest and
lowest vs the middle two; an empty grid is unrestricted). Rundowns take a
highest-card interval and a min/max distance for each neighbour gap; distance 1
means consecutive ranks. Impossible constraints show an error rather than widening
the range. Suit texture is a multi-select (2+2, 2+1+1, rainbow, 3+1, 4), and suited
cards can be Any, Top card suited, or Top two suited (an ace suited is Top card suited plus a required ace; `$as` remains in the text syntax). Must include takes
four slots, each a distinct card with an optional rank and suit. The editor shows a
live count and three random example hands.

`web/model.js` generates the shorthand and range expressions for editor choices.
Its tests check that they round-trip through `web/ranges.js`, so the summary shown
for a player parses back to the same range the engine uses.
