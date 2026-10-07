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
