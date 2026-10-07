The Hold'em evaluator uses the evaluator-only subset of
[OMPEval](https://github.com/zekyll/OMPEval), copyright 2016 Timo A., under ISC.
Its source and license are in `cpp/vendor/ompeval/`; the pinned revision and
included files are documented there. The upstream parser and equity simulator
are not included.

The Rust Hold'em implementation adapts OMPEval's additive perfect-hash lookup
and flush detection and embeds its generated numeric tables. The ISC attribution
and license apply to that adaptation as well. Rust does not link the C++ library.
`tools/regenerate_core.py` reproduces the embedded core data from the pinned
source. Uncompressed size: 1,008,730 bytes; SHA256:
`3c3b852de59b1227bbdf2d2d2622d58a345cef1ff60f2ae19556dfd187c52b7a`.

The direct Omaha evaluator is an independent implementation of the separate
board/hole rank-multiset lookup approach described by Henry Lee's
[PH Evaluator](https://github.com/HenryRLee/PokerHandEvaluator) and its
[algorithm documentation](https://github.com/HenryRLee/PokerHandEvaluator/blob/master/Documentation/Algorithm.md).
Its numeric rank tables are generated locally by our generator using OMPEval
scores. No PH Evaluator source code or table files are redistributed.

The compressed Omaha asset contains generated numeric data, not an external
hand-ranking dataset. It is 22,477,000 bytes uncompressed (11,238,500 little-endian
uint16 entries). Uncompressed SHA256:
`4ea249aa4d115bfff3425229fea7c80840edce4a534c4fc712fc2002ee50d233`.
