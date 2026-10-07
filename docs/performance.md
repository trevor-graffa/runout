# Performance and evaluator choices

The original implementation established a simple reference baseline. Hold'em
used rank counts and bit masks directly; Omaha evaluated all 60 legal five-card
selections. The production paths replace that baseline with compact lookup
tables and immutable partial-hand caches. The baseline remains available inside
the native checks, not as a user-selectable slow backend.

The choices were informed by the primary source documentation for
[OMPEval](https://github.com/zekyll/OMPEval) and
[PH Evaluator](https://github.com/HenryRLee/PokerHandEvaluator). OMPEval's published
comparison with Two Plus Two illustrates that sequential and random access can
produce very different rankings. PH Evaluator shows the value of evaluating
Omaha directly rather than repeatedly calling a five-card evaluator. We do not
claim a universal fastest evaluator or a same-machine victory over either
upstream project: their published CPU, datasets, interfaces, and benchmarks differ.

## What is optimized

* Hold'em caches each physical hole hand's OMPEval aggregate and builds the board
  aggregate once per outcome, sharing it between players.
* Omaha high indexes a 6,175 × 1,820 matrix of board/hole rank multisets. Every
  entry already maximizes the legal 3+2 selections. The matrix uses 16-bit
  scores, occupies 22,477,000 bytes, and is compressed to about 3 MiB on disk.
* Four- and five-card no-flush ranks are unique at their respective cardinality.
  That lets us remap OMPEval's compact additive hash to the matrix indices,
  avoiding a loop over all 13 rank counts. Initialization verifies injectivity.
* Omaha flushes are checked separately using suit masks, preserving the legal
  2+3 split. Rare flush-capable deals enumerate only the suited selections.
* Omaha8 low indexes a 256 × 256 hole/board low-rank-mask table. Table generation
  checks that the five distinct ranks can be assigned as exactly two hole and
  three board ranks. Aces are low; flushes/straights do not disqualify low.
* Range objects cache compiled numeric data and sampling tables. Uniform weights
  use a direct uniform index; nonuniform weights use O(1) alias sampling.
* Monte Carlo draws board cards directly with rejection of used card IDs, rather
  than scanning the entire deck on every outcome. Whole-hole-tuple rejection
  retains the intended weighted joint distribution.
* Immutable data is shared across workers; each worker has its own RNG and
  accumulators. Python's GIL is released while native simulation runs.

## Historical C++ measurements

Measured on the provided macOS arm64 workstation, Python 3.12.11 in the `ai`
conda environment, Apple Clang 17, `-O3`, C++17. End-to-end runs used 1,000,000
accepted MC outcomes, seed 1234, and the median of five runs after one warmup.
Parsing and native preparation are cached for these steady-state measurements.
The benchmark also records the first timed invocation so setup cost remains
visible; that invocation starts after the parser cache has been warmed and may
share initialization with earlier cases. Normal Python `equity().elapsed`
always includes whatever parsing/preparation that call actually performs.

| End-to-end workload | 1 thread, outcomes/s | 4 threads, outcomes/s |
| --- | ---: | ---: |
| Fixed AsAh vs KsKh, exact preflop | 38.9 million | exact is single-threaded |
| Hold'em `TT+,AQs+,AKo` vs random | 9.9 million | 25.6 million |
| Fixed Omaha high preflop | 9.2 million | 29.7 million |
| Omaha `AA$ds` vs random | 3.3 million | 13.8 million |
| Omaha8 `A2` vs random | 3.0 million | 12.0 million |

The original fixed-hand Omaha baseline measured about 0.23 million outcomes/s
per thread, so the final fixed-hand workload improved about 40×. Exact fixed
Hold'em improved from about 11.5 to 38.9 million outcomes/s. These are local
measurements with ordinary clock/cache variability, not guaranteed rates.
Broad random Omaha has 270,725 physical combos; its first expansion and native
preparation can matter more than simulation for small sample counts.

Evaluation-only benchmarks are separate from complete equity simulation. The
benchmark generates unique cards before timing, visits 100,000 pregenerated
hands repeatedly, and keeps checksums to prevent dead-code elimination. It also
accepts `100` as a sample-count argument to show the much smaller, cache-resident
working set used by PH Evaluator's published random benchmark. A prepared
evaluation excludes card aggregation and hashing; it measures the path used
after partial hands have already been cached. Comparing those figures directly
with an upstream evaluator that starts from raw card IDs would be misleading.

| Evaluation-only path | 100,000-hand working set | 100-hand working set |
| --- | ---: | ---: |
| Hold'em, seven raw card IDs | 121 million hands/s | 126 million hands/s |
| Omaha, nine raw card IDs | 22.2 million hands/s | 59.7 million hands/s |
| Omaha, prepared hole/board | 62.9 million hands/s | 178 million hands/s |
| Omaha8, nine raw card IDs | 21.9 million hands/s | 50.7 million hands/s |

These evaluation-only figures exclude parsing, random dealing, initialization,
and result accumulation. Checksums match the reference evaluator. The large
change between sample sizes is why a cache-resident published benchmark should
not be mistaken for full simulation throughput.

## Reproduce

```sh
python tools/build_cpp_reference.py --lto
PYTHONPATH=. python benchmarks/benchmark.py --samples 1000000 --output benchmarks/results.json
c++ -std=c++17 -O3 -pthread -Icpp benchmarks/evaluator.cpp cpp/engine.cpp cpp/fast_eval.cpp cpp/vendor/ompeval/HandEvaluator.cpp -o /tmp/poker-evaluator-benchmark
/tmp/poker-evaluator-benchmark
/tmp/poker-evaluator-benchmark 100
```

Exact flop benchmarks with fixed Omaha hands have only 820 runouts, so their
very short latency is noisy and should not drive performance conclusions.

Full suit-isomorphism enumeration, preflop equity caches, joint-range
preconditioning for pathological collisions, direct flush matrices, and
implicit/lazy random ranges are possible future optimizations. This version
keeps explicit physical ranges and independent accepted samples for transparent
weighting and uncertainty estimates. No Markov-chain samples or fabricated
top-percent ordering are used.

## Matched Rust and C++ comparison

The preserved C++ and Rust builds were measured on the same M1 workstation,
with thin LTO, identical pregenerated distinct-card inputs, matched checksums,
and five-run medians. The full report is [comparison.json](../benchmarks/comparison.json).
These measurements include the cumulative Monte Carlo implementation used by
browser progress updates. Rates below are millions per second.

| Evaluation, 100,000-hand working set | C++ | Rust |
| --- | ---: | ---: |
| Hold’em, seven checked card IDs | 134.9 | 138.2 |
| Hold’em, prepared hole/board | 241.4 | 283.2 |
| Omaha, nine checked card IDs | 20.2 | 20.8 |
| Omaha, prepared hole/board | 63.5 | 59.1 |
| Omaha8, nine checked card IDs | 16.7 | 19.8 |

| Complete equity workload | C++ 1 thread | Rust 1 thread | C++ 4 threads | Rust 4 threads |
| --- | ---: | ---: | ---: | ---: |
| Fixed Hold’em, exact | 38.8 | 36.0 | — | — |
| Hold’em ranges, MC | 9.8 | 18.6 | 29.6 | 70.2 |
| Fixed Omaha, MC | 9.6 | 17.0 | 27.7 | 65.6 |
| Omaha ranges, MC | 3.5 | 5.9 | 14.6 | 24.7 |
| Omaha8 ranges, MC | 3.2 | 5.4 | 12.7 | 22.2 |

Rust is faster on these Monte Carlo workloads, but slower on prepared Omaha
with a large working set and exact Hold’em. This does not isolate language
speed: RNGs, representations, compilers, and scheduling differ. Both implementations
remain in the repository. Exact results match; independently seeded MC results
are checked within six combined standard errors.

The 100-hand working set gives Rust 151.9M checked Hold’em and 192.9M prepared
Omaha evaluations/s. C++ OMPEval scoring of fully precombined seven-card
aggregates reaches 802.5M/s with 100,000 hands and 1,229.4M/s with 100. That path
omits card validation, aggregation, and board/hole merging. It explains why
upstream OMP figures cannot be directly compared with checked API rates or full
equity simulations. These M1 rates do not establish an M1 versus i7-3770K result.

Reproduce the matched comparison:

```sh
python tools/build_python.py
python tools/build_cpp_reference.py --lto
c++ -std=c++17 -O3 -flto=thin -pthread -Icpp benchmarks/matched.cpp cpp/engine.cpp cpp/fast_eval.cpp cpp/vendor/ompeval/HandEvaluator.cpp -o /tmp/poker-matched-cpp
cargo build --locked --release --bin benchmark
PYTHONPATH=. python benchmarks/compare.py --cpp /tmp/poker-matched-cpp
```

On non-Apple compilers, replace `-flto=thin` with the supported LTO flag.
