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
owns a Rust/WASM calculator. Worker messages carry requests/results; evaluation
and parsing happen outside the UI thread. The page only fetches static assets.
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
finishes. The top Calculate button starts the job; Cancel stops its worker.

## Mobile and browser limits

The app has touch-sized primary controls, 16px input text, viewport/safe-area
support, and per-player equity results. The fitted 13×13 range matrix has smaller
cells to display every hand on a phone; Larger targets offers a scrollable grid. Chrome integration tests exercise 320, 375, 390, and
768px widths, calculations in all three games, and cancellation during a long
simulation. WebKit tests also verify touch interaction, worker reuse, errors,
and seeded multiway results with a mobile viewport. Physical iPhone testing
remains outstanding; no performance
claims for a phone are inferred from the M1 measurements.

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

## Visual range editing

The phone calculator uses a fixed viewport, two-player pages for longer tables,
and separate dialogs for ranges and calculation options. Double-tap a range or
use Edit. Cancel restores the range; Done commits it. Hands, Suits, and (for
rundowns) Rundown tabs separate the controls.

Grid taps and drags stage cells with a gold outline. Add and Remove apply those
cells to the range, then clear the selection. This works for the Hold’em matrix
and each Omaha two-card matrix. A touch gesture never scrolls the grid. Larger
targets deliberately enables local grid scrolling when preferred over a fitted
matrix. Small editor panels retain overflow as a fallback for accessibility and
unusually short viewports.

Specific suits selects required physical suits in any card order, intersecting
the existing range. For AA, Hearts plus Spades selects AhAs; Hearts twice is
empty. These suit slots do not assign suits to rank order. Omaha suit texture
and highest-card/ace connections remain additional independent constraints.

Rundown controls specify lowest/highest high card and three adjacent rank-distance
intervals. Distance 1 means consecutive ranks; 2 means one missing rank. Ranks
are distinct and aces are high. Invalid intervals raise a clear error; valid
intervals with no matching four-rank pattern produce an empty range.
