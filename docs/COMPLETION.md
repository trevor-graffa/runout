# Rust rewrite completion audit

Completed pass, 2026-10-07. Implementation checkpoints: `3671dd9` and `6f34d71`.
C++ baseline remains at `485160c` and in the working tree.

| Requirement | Current implementation and evidence |
| --- | --- |
| Rust production numeric engine; no high-level range parsing in Rust | `src/evaluator.rs`, `simulation.rs`, `python.rs`, `wasm.rs`; Python tests assert `_native.BACKEND == 'rust'`; 125 Python tests pass with the rebuilt extension. |
| Preserve Python API and improve notebook use | Functional API retained; `Calculator`, named players, reusable contexts, HTML results, rows, optional pandas frames, `Range.parse`; notebook tests and all example notebook cells execute successfully. |
| Same Rust core in browser | WASM evaluator and numeric simulator use the same modules as Python. Shared independent hand fixtures and seeded cumulative Monte Carlo results pass native/WASM parity tests. |
| Static app; computation stays in browser | `poker.js`, `worker.js`, and `preview-worker.js` perform parsing and WASM computation in workers. Chrome/WebKit integration checks exercise static serving, all three games, reuse, errors, and cancellation. No computation service or Python browser runtime. |
| Hold’em, Omaha, Omaha8; exact/weighted MC, blockers, limits, threads | Python oracle suite, exhaustive Rust five-card strengths/frequencies, weighted conditioning, quartering, native threads, and WASM result/limit tests pass. |
| Performance comparison, C++ preserved | `benchmarks/comparison.json` records five-run matched medians, shared-input checksums and statistical comparisons. `docs/performance.md` describes advantages and slower cases. C++ reference builder remains available. |
| Mobile visual app and advanced interface | Separate visual/text pages; top Calculate, live cumulative statistics/progress, four-color cards, exact picking, Cancel/Done editor, player pages, fixed portrait main viewport. Chrome/WebKit test widths 320–1100 and phone heights 568–844. Phone landscape was explicitly removed from scope. |
| Range interactions and Omaha constraints | Chrome touch drag stages cells then Add/Remove commits; WebKit pointer-path and touch taps checked. Suit constraints produce independently known combo counts. Dual pair grids, suit textures/connections, high-card interval and three gap intervals have model/parser and browser checks. |
| Packaging and reproducibility | abi3 wheel installs and API/CLI smoke passes on Python 3.12/3.14; source package rebuild succeeds offline; source archive contents compared with current implementation. Numeric table regeneration previously reproduced recorded SHA256. |
| Simplicity review | One numeric core, no unsafe Rust, no frontend framework or mandatory npm runtime dependencies, no database/backend. Removed unused dependency and obsolete fixed-bottom/results CSS. Compact embedded tables replace generated source; bindings share simulation logic. Details in `docs/architecture.md`. |
| Handoff | `docs/UI_HANDOFF.md` provides project context and unrestricted permission for Opus to change any part of the application. |

Verification also includes Rust formatting and warning-free Clippy for native
Python/all targets and wasm32. The latest JavaScript engine/model suite has nine
passing tests. Documentation gives build, local/phone serving, syntax, statistical
semantics, payload/memory cost, and limitations.

Physical iPhone testing has not been performed. WebKit testing runs the Safari
engine with mobile viewport and touch emulation on the Mac. Exact enumeration
shows indeterminate progress until it finishes; cumulative sample progress is
available for Monte Carlo. Very short or accessibility-expanded editor layouts
retain local overflow as a fallback; fitted Hold’em editing is verified without
scrolling on the tested portrait phones. UI design can be substantially revisited
by the next agent, as authorized by the user.
