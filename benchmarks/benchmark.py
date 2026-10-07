"""End-to-end benchmarks: parsing/preparation are included in reported latency."""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import time

from poker_engine import equity, parse_range


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=200000)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--output")
    args = parser.parse_args()
    cases = [
        ("holdem_fixed_exact", ["AsAh", "KsKh"], dict(method="exact")),
        ("holdem_ranges_mc", ["TT+,AQs+,AKo", "random"], dict(method="monte_carlo")),
        ("omaha_fixed_mc", ["AsKsQcJd", "AhKhQdJc"], dict(game="omaha", method="monte_carlo")),
        ("omaha_ranges_mc", ["AA$ds", "random"], dict(game="omaha", method="monte_carlo")),
        ("omaha8_ranges_mc", ["A2", "random"], dict(game="omaha8", method="monte_carlo")),
        ("omaha_flop_exact", ["AsKsQcJd", "AhKhQdJc"], dict(game="omaha", board="2c3d4h", method="exact")),
    ]
    rows = []
    for name, ranges, kwargs in cases:
        game = kwargs.get("game", "holdem")
        for r in ranges:
            parse_range(r, game=game)  # warm parser cache; C++ preparation still timed
        for threads in ((1,) if kwargs["method"] == "exact" else (1, min(4, os.cpu_count() or 1))):
            first = equity(ranges, samples=args.samples, seed=1234, threads=threads, **kwargs)
            runs = [equity(ranges, samples=args.samples, seed=1234, threads=threads, **kwargs)
                    for _ in range(args.repeats)]
            seconds = statistics.median(r.elapsed for r in runs)
            row = dict(case=name, threads=threads, outcomes=runs[0].outcomes,
                       seconds=seconds, first_seconds=first.elapsed,
                       outcomes_per_second=runs[0].outcomes / seconds)
            rows.append(row)
            print(f"{name:24s} threads={threads} {row['outcomes_per_second']:12,.0f} outcomes/s ({seconds:.4f}s)")
    report = dict(platform=platform.platform(), python=platform.python_version(),
                  cpu_count=os.cpu_count(), samples=args.samples, repeats=args.repeats, results=rows)
    if args.output:
        with open(args.output, "w") as out:
            json.dump(report, out, indent=2)


if __name__ == "__main__":
    main()
