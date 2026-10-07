# Runout

Runout is a poker equity calculator: a phone app that runs in the browser, plus
the `poker_engine` Python package behind it, a PokerStove-style equity library and
command-line calculator for **Hold'em, four-card Omaha high, and Omaha
eight-or-better**. Python handles all text,
range expansion, and presentation. A Rust core handles numeric hands, weighted
sampling, exact enumeration, and evaluation. The same core compiles to WebAssembly
for a phone-friendly browser calculator, with JavaScript handling browser text
parsing. Python has no mandatory runtime dependencies.

The Hold'em evaluator uses compact OMPEval tables and cached partial hands.
Omaha high uses a direct board/hole rank lookup inspired by PH Evaluator, with
separate legal flush selection. Eight-or-better low uses a direct 256 × 256
rank-mask lookup. Both Omaha high and low always use **exactly two hole cards
and exactly three board cards**. Attribution is in [THIRD_PARTY.md](THIRD_PARTY.md).

## Build and run

Requires Python 3.10+ and Rust/Cargo 1.88+. Installation uses maturin. The original
C++ implementation remains buildable for comparison; production builds use Rust.

```sh
# Work directly from this checkout, without installing into the environment:
python tools/build_python.py
python -m poker_engine 'AsAh' 'KsKh'

# Or install the package and console command:
python -m pip install .
poker-engine 'TT+,AQs+,AKo' 'random' --samples 1000000 --seed 42 --threads 4
```

Omaha examples (quote ranges so the shell does not expand `$`, `*`, or `!`):

```sh
python -m poker_engine 'AA$ds' 'AKQJ$ds' --game omaha --samples 1000000 --seed 42 --threads 4
python -m poker_engine 'As2cJhJd' 'Ah2dKsKh' --game omaha8 --board '3d4h8sJcQd'
python -m poker_engine 'AA:($ds,$ss)!As' --game omaha --count
python -m poker_engine 'AA' 'KK' --board '2c3d4h' --dead '5c' --method exact --json
```

The first fixed-hand example automatically enumerates all 1,712,304 boards:
AsAh has approximately 82.637% equity against KsKh. The Omaha8 example gives
75% / 25% because one player wins high and both tie low.

## Python API

For notebooks, use named players and reusable analysis contexts. Results display
an HTML table automatically, or convert to pandas with the optional
`pip install '.[notebook]'` extra. See [examples/notebook.ipynb](examples/notebook.ipynb).

```python
from poker_engine import Calculator

calc = Calculator({'Hero': 'AA$ds', 'Villain': 'random'}, game='omaha')
result = calc.simulate(samples=1_000_000, seed=42, threads=4)
result                         # notebook HTML table
result.to_frame()               # optional pandas DataFrame
calc.with_board('2c3d4h').simulate(seed=42)

split = Calculator({'Hero': 'As2cJhJd', 'Villain': 'Ah2dKsKh'},
                   game='omaha8', board='3d4h8sJcQd')
split.exact()                  # 75% / 25%; quartered low
```

The original functional API is preserved:

```python
from poker_engine import Range, equity, evaluate_hand, parse_range

result = equity(
    ['TT+,AQs+,AKo', 'random'],
    board='2c3d4h', dead='5c',
    method='monte_carlo', samples=1_000_000, seed=42, threads=4,
)
for player in result.players:
    print(player.equity, player.stderr, player.confidence_interval)

# Relative per-combo weights; a Range can also be constructed from numeric masks.
weighted = Range.from_hands({'AsAh': 2.0, 'KsKh': 1.0})
print(equity([weighted, 'QQ'], board='2c3d4h8s9c').players)

aces_ds = parse_range('AA$ds', game='omaha')
print(len(aces_ds))  # 864 physical hands; includes three-ace hands when suited legally
print(equity([aces_ds, 'random'], game='omaha', samples=100_000, seed=7))

value = evaluate_hand('As2cKdKh', '3d4h5sQcQd', game='omaha8')
print(value.category, value.low_ranks)  # straight; (5, 4, 3, 2, 1)
```

Reusable parsed Range objects cache immutable compiled native data and weighted
sampling tables. Card removal is automatic, including before auto chooses a
method. Numeric card IDs are `rank * 4 + suit`: ranks `23456789TJQKA`, suits
`cdhs`; `2c=0`, `As=51`. `Range.entries` contains `(52-bit mask, positive weight)`
pairs. All simulations release the Python GIL.

## Supported range syntax

This is a deliberate syntax subset, not a complete PokerStove/PPT emulation.
See [docs/ranges.md](docs/ranges.md) for precise grammar, weighting, and caveats.

| Input | Meaning |
| --- | --- |
| `AA`, `AKs`, `AKo`, `AK` | Hold'em pair, suited, offsuit, or either |
| `TT+`, `ATs+` | Higher pairs; fixed high rank with higher kickers |
| `99-JJ`, `A2s-A5s`, `76s-T9s` | Pair, fixed-rank, or equal-gap diagonal interval |
| `AsKd` / `AsKsQcJd` | Specific physical hand |
| `*`, `random` | All physical hands |
| `AA`, `AA**`, `A2` in Omaha | Contains those ranks, other cards unrestricted |
| `AsKs**` | Contains those two specific cards |
| `[AKQ]JT9`, `[K-T]QJT` | Rank set or inclusive rank span |
| `xxyy`, `$ds` | Omaha double suited (2+2) |
| `xxyz`, `$ss` | Omaha exactly single suited (2+1+1) |
| `xyzw`, `$r` | Omaha rainbow |
| `$ts`, `$ms` | Exactly three / four cards of one suit |
| `$hs`, `$as`, `$bs` | Highest card / ace suited; top two separately suited |
| `{AKs|A2o}` | Two disjoint Hold’em selections forming an Omaha hand |
| `AxAyxy`, `AA$ds` | Double-suited aces |
| `AA,KK` / `AA:$ds` / `AA!As` | Union / intersection / exclusion |
| `(AA,KK):$ds` | Group expressions |
| `AA@0.5,KK@1` | Relative combo weights; `@50%` is also accepted |

Rank symbols in ranges are uppercase and suits are lowercase. Exact card parsing
also accepts mixed case. Top-N% ranges, PPT rank variables and unlisted macros, classic parenthesized suit groups, and Omaha rundown `+/-` shorthand
are intentionally unsupported. Supply explicit rank patterns instead. Betting,
side-pot modeling, five/six-card Omaha, and PQL query language are not included.

## Browser and mobile app

```sh
rustup target add wasm32-unknown-unknown
# Match the wasm-bindgen CLI version to Cargo.lock (currently 0.2.129).
cargo install wasm-bindgen-cli --version 0.2.129 --locked
python tools/build_wasm.py
python -m http.server 8000 --directory web
# Open http://localhost:8000
```

The app is a single phone-sized screen. It supports 2–10 players, Hold'em, Omaha
high, and Omaha Hi-Lo (Omaha8), board and dead cards, and automatic/exact/Monte
Carlo calculation. Each player row shows its range summary, equity, and win/tie
(Hi-Lo: scoop/high/low). Tap a row to edit its range; swipe left to delete it (3+ players).
The status line reports whether a result is live, partial, exact, or Monte Carlo,
with sample count, a ±95% interval, and elapsed time. Calculate changes to Stop
while running; stopping keeps the partial result and terminates the worker.
Settings includes a link to the text-mode page (`advanced.html`), which carries
the current game, ranges, board, and dead cards. The app can be added to an iPhone
home screen as a standalone web app.

Calculations and range expansion run inside dedicated Web Workers, and range
counting and example hands run in a separate preview worker. Stopping a
calculation terminates its worker.

**No Python server or computation backend is needed.** Any static HTTPS host can
serve `web/`, including the generated `web/pkg/` assets. Python remains useful for
notebooks and CLI analysis. A backend would only be needed for future account,
saved-analysis, or sharing features. See [docs/architecture.md](docs/architecture.md)
for payload, memory, browser limits, and the JavaScript API.

### Deploying to GitHub Pages

`.github/workflows/pages.yml` builds the WASM engine (`web/pkg/` is not committed),
runs the JavaScript tests, and publishes `web/` on every push to `main`. One-time
setup: push the repository to GitHub, then choose **Settings → Pages → Source:
GitHub Actions**. The app uses only relative paths, so it works at a project URL
such as `https://<user>.github.io/<repo>/`. When upgrading the `wasm-bindgen`
crate, update the version pinned in the workflow to match `Cargo.lock`.

## Exact and Monte Carlo behavior

`method='auto'` selects exact if a conservative upper bound fits `max_exact`
(default 2,000,000 outcomes), otherwise Monte Carlo. Force either `exact` or
`monte_carlo`. Exact raises on an outcome/traversal limit; it never returns a
partial result as exact. Exact currently uses one thread. Monte Carlo defaults
to 100,000 **accepted** outcomes and one thread; request more with `samples` and
`threads` (1..256).

Each player's physical hand has probability proportional to its combo weight.
The joint deal is conditioned on no overlap with board/dead cards or other
players. Monte Carlo rejects the **whole independently sampled tuple** on a
collision, preserving that distribution. Players whose range is the full uniform
universe (`random`) are instead dealt directly from the cards left over, which is
exact for that case and avoids stalls when such players are combined with narrow
ranges. Board completions are uniform without replacement. Dense collisions can exhaust `max_attempts` (default
`max(100000, 100 * samples)`); narrow ranges, use exact, or raise the limit.
It raises rather than silently changing the distribution.

Equity is expected **pot share**, including ties, half pots, and quartering.
`win` means winning the entire pot (scooping in Omaha8), `tie` means receiving a
positive share below the whole pot, and `loss` means receiving nothing. Separate
`high_win`, `high_tie`, `low_win`, and `low_tie` probabilities describe each half.
If no low qualifies, high receives the whole pot. `win + tie + loss = 1`.

`stderr` estimates Monte Carlo uncertainty from the variance of actual pot
shares, not a win/loss approximation. Exact has stderr 0; a single MC outcome has
unknown stderr (NaN, or JSON null). The 95% normal interval is approximate and
less reliable for tiny samples or rare outcomes. Increasing samples reduces
random error; it does not correct an inaccurately specified range.

The returned seed can reproduce a run with the same parameters, thread count,
binary/toolchain, and platform. Changing thread count changes the random stream;
native and WASM one-thread streams are checked for equality. The Rust RNG differs
from the preserved C++ version, so an old C++ seed does not recreate the same
samples. Without a seed a new one is generated and returned. `elapsed` includes
parsing, preparation, and simulation.

## Verification and benchmarks

```sh
python -m pytest -q
cargo test --release --no-default-features
node --test web/tests/engine.test.js web/tests/model.test.js
node web/tests/browser.mjs          # real Chrome, including narrow phone layouts
node web/tests/visual-browser.mjs   # Chrome touch tests for the phone app
python tools/build_cpp_reference.py --lto
c++ -std=c++17 -O3 -flto=thin -pthread -Icpp benchmarks/matched.cpp cpp/engine.cpp cpp/fast_eval.cpp cpp/vendor/ompeval/HandEvaluator.cpp -o /tmp/poker-matched-cpp
cargo build --release --bin benchmark
PYTHONPATH=. python benchmarks/compare.py --cpp /tmp/poker-matched-cpp
```

Optional WebKit (Safari engine) mobile/touch verification:

```sh
npm install --prefix .tools/browser playwright@1.63.0 --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/browsers" .tools/browser/node_modules/.bin/playwright install webkit
node web/tests/webkit.mjs
```

The Python tests include independent evaluators, weighted joint conditioning,
card removal, exact reference equities, quartered lows, multiway ties, range
counts, seeded multithread simulation, notebook display, and CLI/native validation.
Rust checks all
2,598,960 five-card hands against the reference, known category frequencies and
7,462 strengths. Shared WASM fixtures use an independent Python hand oracle and
check native/WASM numeric results and seeded streams. Preserved C++ checks also
stress 100,000 random seven-card and Omaha high/low hands.

Measured performance and its comparison methodology are in
[docs/performance.md](docs/performance.md). Regenerate the compressed, portable
Omaha table with `python tools/regenerate_tables.py`; no network access is needed.
On first Omaha use it loads about 21.4 MiB of immutable data. Rust embeds compressed
tables in its binary, including the 1 MiB Hold'em/translation/low tables. Regenerate
the latter using `python tools/regenerate_core.py`. C++ callers can
generate that table in memory automatically, or supply the numeric table via
`initialize_omaha_table`. Python packages include the pre-generated compressed
asset so normal installation does not regenerate it.

Without CMake, compile the native checks directly:

```sh
c++ -std=c++17 -O3 -pthread -Icpp tests/exhaustive.cpp cpp/engine.cpp cpp/fast_eval.cpp cpp/vendor/ompeval/HandEvaluator.cpp -o /tmp/poker-exhaustive
/tmp/poker-exhaustive
c++ -std=c++17 -O3 -pthread -Icpp tests/stress.cpp cpp/engine.cpp cpp/fast_eval.cpp cpp/vendor/ompeval/HandEvaluator.cpp -o /tmp/poker-stress
/tmp/poker-stress
```
