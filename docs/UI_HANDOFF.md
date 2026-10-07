Work in /Users/trevorgraffa/Documents/projects/poker-engine. Take ownership of the web UI and application experience and improve it freely. I want a beautiful, intuitive poker equity calculator that feels like a native iPhone app. Prioritize coherent interaction design over preserving the current layout. Inspect the implementation and run it before deciding what to keep.

The numeric engine is already rewritten in Rust, with Python bindings for notebooks and the same core compiled to WASM. Browser parsing, evaluation, and simulations run in Web Workers. The app is static HTML/CSS/JavaScript; there is no computation backend and none is needed. You have unrestricted latitude to change the UI, features, architecture, dependencies, Python API, Rust implementation, or any other part of the project. Nothing in the current implementation is sacred. Use your judgment to produce the best poker calculator. The existing correctness tests and performance measurements are useful evidence; revisit them as appropriate when making changes.

My previous preferences and feature ideas, offered as context rather than constraints:
- Phone portrait is the priority; landscape support is not required. The primary calculator should feel like a fixed app screen, not a scrolling form or dashboard. Keep controls reachable, including with more players. Use separate focused editors and navigation when needed.
- Use PokerCruncher on iPhone as an interaction reference. Double-tapping a player's range opens a separate range editor with Cancel/Done. Keep an accessible Edit action too. Cancel must restore the prior state.
- Calculate belongs near the top, never in a sticky bottom quotation-style bar. While Monte Carlo runs, show real progress and live per-player percentages. Provide cancellation and clearly distinguish partial from completed results.
- The current app supports Hold'em, four-card Omaha high, and Omaha eight-or-better; 2–10 players; board/dead cards; automatic, exact, and Monte Carlo methods; and the advanced text interface.
- Hold'em needs a familiar 13×13 matrix. Finger dragging selects/deselects cells; Add/Remove then applies the selection to the range. Make staged selection visibly distinct from range membership. Preserve keyboard access.
- Suits need four colors: hearts red, diamonds blue, clubs green, spades dark. Let users select precise physical suits in ranges, not only generic suited/offsuit. Improve the current required-suit selectors if there is a better interaction; explain which card/rank a suit constraint applies to.
- Omaha range construction should be intuitive. Explore two Hold'em-style pair grids for high/low and middle/middle. High only should constrain one pair with the other pair unrestricted. All four cards must be distinct; deduplicate hands that match multiple partitions. The existing Broadway family handles four high cards.
- Omaha suits have more textures than single/double suited: 2+2, 2+1+1, rainbow, 3+1, and 4. Connections such as highest card suited, ace suited, and top two separately suited matter. Allow named suit constraints alongside these.
- Rundowns need a high-card X–Y interval and independent minimum/maximum distances between first/second, second/third, and third/fourth ranks. Be explicit that distance 1 means consecutive ranks; distance 2 means one missing rank. Contradictory constraints must not silently broaden the range.
- Keep a link to the existing advanced text UI, which exposes the complete supported syntax. The current architecture keeps high-level parsing in Python/JavaScript and gives Rust numeric cards/ranges; you may revisit that design.

Read README.md, docs/architecture.md, docs/ranges.md, and docs/performance.md. Current app files are web/index.html, visual.css, visual.js, visual-model.js, poker.js, worker.js, preview-worker.js, ranges.js, and advanced.html. There is no frontend framework or mandatory npm runtime dependency. Current UI has accumulated CSS overrides and long JavaScript statements; simplifying these is welcome.

Reference screenshots are available at:
/Users/trevorgraffa/Downloads/Screenshot 2026-10-07 at 1.02.56 PM.png
/Users/trevorgraffa/Downloads/Screenshot 2026-10-07 at 1.02.30 PM.png
They show the PokerCruncher range editor and calculator. Use them as interaction references, not a requirement to reproduce their styling.

Run locally:
python -m http.server 8000 --directory web --bind 0.0.0.0
Use http://localhost:8000 or the Mac's LAN IP from an iPhone on the same Wi-Fi. Existing web/pkg assets are built locally and ignored by Git. If rebuilding WASM, run python tools/build_wasm.py; Rust/Cargo and matching wasm-bindgen CLI are installed.

Validation available:
node --test web/tests/engine.test.js web/tests/visual-model.test.js
node web/tests/visual-browser.mjs
node web/tests/browser.mjs
node web/tests/webkit.mjs
/opt/homebrew/anaconda3/envs/ai/bin/python -m pytest -q
cargo test --locked --test rust_core --release

Chrome and Playwright/WebKit are installed under .tools. Browser tests and other safe tests/package installations are already authorized. Do not ask me to approve routine design decisions. Respect any actual tool-level permission requirements. Update tests as appropriate for your design and verify poker correctness and useful new behavior. Use rendered screenshots and real touch events to verify, not just code inspection. Be candid about physical-device testing you have not performed.

Please implement the improvements, review the complete app experience, validate it, and commit your work locally. Give me a concise account of what changed and how to run it. You can change anything you want. Treat the notes above as background on what I have asked for so far, not a list of rules that prevents a better design.
