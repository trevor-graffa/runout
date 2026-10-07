Build an equity calculator with Python owning all card/range text and C++17 owning
numeric hand evaluation, legal deals, exact enumeration, and Monte Carlo. Deliver
a local library and CLI, not a desktop UI. Support Hold'em, four-card Omaha high,
and Omaha eight-or-better. Omit top-percent rankings because authentic Omaha
rankings require a chosen ranking dataset; reject unsupported syntax explicitly.

Verification: independent five-card reference evaluator; exhaustive five-card
category frequencies; seven-card and Omaha comparison against reference
combinations; known exact equities, weighted/card-removal regressions, split pots,
range syntax/counts, impossible deals, seeded and multithread simulations; CLI
and packaging smoke tests. Record local benchmarks without promising parity with
PokerStove's specialized evaluator. Document syntax and statistical semantics.

Milestones: numeric core and binding; Python cards/ranges/API/CLI; correctness and
sampling verification; performance measurements and user documentation.

Completed implementation: all three games, documented syntax subset, exact and
seeded threaded Monte Carlo, numeric compiled range caches, API and CLI. The
production evaluator now uses OMPEval for Hold'em, an independently generated
direct Omaha rank matrix inspired by PH Evaluator, and a direct Omaha8 low table.
Original simple evaluators remain as native correctness references.

Verification completed: 106 Python tests; exhaustive five-card strengths and
frequencies; 100,000 random seven-card/Omaha high-low comparisons; native weighted
and threaded simulation under AddressSanitizer/UndefinedBehaviorSanitizer; local
table regeneration reproduces the checksum; wheel installation/API/CLI smoke.
CMake is optional and unavailable in the current environment, so native checks
were compiled directly. Performance details are recorded in docs/performance.md.

Active rewrite objective (2026-10-07): implement the numeric core in Rust while
preserving Python functions/ranges and adding a notebook-friendly Calculator.
Compile the same core to WebAssembly with a JavaScript range layer and a worker
integration for a static browser app. Preserve Hold'em/Omaha/Omaha8, exact and
weighted Monte Carlo, card removal, uncertainty, limits, and native threads.
Keep C++ buildable until a measured same-machine comparison has been reviewed.
The original implementation is captured in baseline Git commit 485160c.

Evidence required: existing Python oracle suite with Rust loaded, Rust exhaustive
and sampling tests, native and WASM parity on numeric inputs, browser worker
integration, Python wheel smoke, class API/examples, and matched C++/Rust
evaluation/simulation benchmarks. Document source/LOC simplifications, WASM
payload and limitations, and static hosting versus optional future backends.

Mobile requirement (2026-10-07): make the browser calculator comfortable on a
phone across Hold'em, Omaha high, and Omaha8. Use touch-sized controls, 16px input
text, viewport/safe-area support, mobile result cards, and cancellable background
worker calculations. Verify narrow portrait/landscape layouts in a real browser,
including no page overflow and successful multi-player calculations.

Visual UI requirement (2026-10-07): preserve the text interface as advanced.html
and add clear Visual/Advanced navigation. Build a polished mobile-first visual
calculator: standard 13x13 Hold'em matrix, Omaha rank/texture/suitedness selectors,
exact card picking, board picking, multiple players, and readable equity results.
Verify both views and the generated Omaha expressions against the shared parser.

Latest UI requirements: compact main calculator with per-player equity, a
separate Cancel/Done range editor reached by double-tap or Edit, and a fitted
13x13 grid (optional larger targets). Four-color suits throughout. Calculate
belongs at the top of the calculator, not in a fixed bottom bar. Extend Omaha
with two disjoint two-card group grids (high only, high/low, middle/middle),
combined with separate suit-texture and high-card/ace suit-connection filters.
Monte Carlo must report real sample progress and running percentages while
preserving its random stream and final statistical results.

Mobile app interaction requirements: fixed main viewport with reachable player
pages and separate options/editing screens; finger-drag stages grid cells, then
Add/Remove commits to the range. Specific named suit constraints must intersect
rank ranges. Rundown controls need a high-card interval and three independent
minimum/maximum adjacent rank distances. Verify touch gestures, small-height
layouts, screen navigation, suit combo counts, and impossible constraints.
