from __future__ import annotations

import argparse
import json
import math
import sys

from .api import equity
from .ranges import parse_range


def _json_safe(value):
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_safe(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hold'em and Omaha equity calculator")
    parser.add_argument("ranges", nargs="+", help="One quoted range per player")
    parser.add_argument("--game", default="holdem", help="holdem, omaha, or omaha8")
    parser.add_argument("--board", default="", help="0, 3, 4, or 5 cards, e.g. 'Ah Kd 2c'")
    parser.add_argument("--dead", default="", help="Known dead cards")
    parser.add_argument("--method", choices=["auto", "exact", "monte_carlo"], default="auto")
    parser.add_argument("--samples", type=int, default=100000)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--max-exact", type=int, default=2000000)
    parser.add_argument("--max-attempts", type=int, default=0)
    parser.add_argument("--json", action="store_true", help="Print machine-readable results")
    parser.add_argument("--count", action="store_true", help="Count range combos after board/dead removal")
    args = parser.parse_args(argv)
    try:
        if args.count:
            from .cards import parse_cards
            blocked = parse_cards(args.board) + parse_cards(args.dead)
            counts = [len(parse_range(r, game=args.game, blocked=blocked)) for r in args.ranges]
            if args.json:
                print(json.dumps({"range_sizes": counts}))
            else:
                for r, n in zip(args.ranges, counts):
                    print(f"{r}: {n:,} combos")
            return 0
        result = equity(args.ranges, game=args.game, board=args.board, dead=args.dead,
                        method=args.method, samples=args.samples, seed=args.seed,
                        threads=args.threads, max_exact=args.max_exact, max_attempts=args.max_attempts)
        if args.json:
            print(json.dumps(_json_safe(result.to_dict()), indent=2, allow_nan=False))
            return 0
        print(f"{result.game} | {result.method} | {result.outcomes:,} outcomes | {result.elapsed:.3f}s")
        if result.seed is not None:
            print(f"seed={result.seed} threads={result.threads} attempts={result.attempts:,}")
        print(f"{'Player':<8} {'Equity':>9} {'StdErr':>9} {'Win/Scoop':>10} {'Tie/Share':>10} {'Combos':>9}")
        for i, p in enumerate(result.players):
            print(f"{i + 1:<8} {p.equity:>8.3%} {p.stderr:>8.3%} {p.win:>9.3%} {p.tie:>9.3%} {result.range_sizes[i]:>9,}")
        return 0
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
