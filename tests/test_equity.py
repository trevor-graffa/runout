from itertools import combinations, product
import math
import random
import pytest

from poker_engine import Range, cards_mask, equity, mask_cards, parse_cards, parse_range
from reference import high, omaha


def reference_equity(ranges, board, dead=(), game="holdem"):
    total = 0.0; shares = [0.0] * len(ranges); outcomes = 0
    for deal in product(*(r.entries for r in ranges)):
        used = cards_mask(board + dead); holes = []; weight = 1.0
        for mask, w in deal:
            if used & mask:
                break
            used |= mask; holes.append(mask_cards(mask)); weight *= w
        else:
            remaining = [c for c in range(52) if not used & (1 << c)]
            for extra in combinations(remaining, 5 - len(board)):
                complete = board + extra
                if game == "holdem":
                    values = [(high(h + complete), 0) for h in holes]
                else:
                    values = [omaha(h, complete) for h in holes]
                    if game == "omaha":
                        values = [(h, 0) for h, _ in values]
                best_high = max(v[0] for v in values)
                best_low = min((v[1] for v in values if v[1]), default=0)
                nh = sum(v[0] == best_high for v in values)
                nl = sum(best_low and v[1] == best_low for v in values)
                for i, (h, l) in enumerate(values):
                    shares[i] += weight * ((0.5 if best_low else 1) / nh if h == best_high else 0)
                    if best_low and l == best_low:
                        shares[i] += weight * .5 / nl
                total += weight; outcomes += 1
    return [s / total for s in shares], outcomes


def test_exact_known_preflop_equity():
    result = equity(["AsAh", "KsKh"], method="exact")
    assert result.outcomes == math.comb(48, 5)
    assert result.players[0].equity == pytest.approx(0.826366, abs=1e-6)
    assert result.players[0].stderr == 0
    assert sum(p.equity for p in result.players) == pytest.approx(1)


@pytest.mark.parametrize("game", ["holdem", "omaha", "omaha8"])
def test_exact_against_independent_reference(game):
    rng = random.Random(333)
    for _ in range(8):
        n = 2 if game == "holdem" else 4
        deal = rng.sample(range(52), 2 * n + 4)
        ranges = [Range.from_hands([deal[:n]], game=game),
                  Range.from_hands([deal[n:2 * n]], game=game)]
        board = tuple(deal[2 * n:])
        expected, count = reference_equity(ranges, board, game=game)
        result = equity(ranges, board=board, game=game, method="exact")
        assert result.outcomes == count
        assert [p.equity for p in result.players] == pytest.approx(expected)


def test_weighted_joint_conditioning_and_monte_carlo():
    ranges = [Range.from_hands({"AsAh": 2, "KsKh": 1}),
              Range.from_hands({"AsAd": 3, "QsQd": 1})]
    board = "2c3d4h8s9c"
    exact = equity(ranges, board=board, method="exact")
    assert exact.outcomes == 3
    assert exact.players[0].equity == pytest.approx(.5)
    simulated = equity(ranges, board=board, method="monte_carlo", samples=50000, seed=159)
    assert abs(simulated.players[0].equity - .5) < 5 * simulated.players[0].stderr
    assert simulated.attempts > simulated.outcomes
    assert simulated.players[0].stderr == pytest.approx(
        math.sqrt(simulated.players[0].equity * (1 - simulated.players[0].equity) / 49999))


def test_weighted_flop_ranges_and_dead_cards():
    ranges = [parse_range("AA@.3,KK"), parse_range("AsKd,QcQd")]
    board, dead = parse_cards("2c3d4h"), parse_cards("5c6c")
    expected, count = reference_equity(ranges, board, dead)
    result = equity(ranges, board=board, dead=dead, method="exact")
    assert result.outcomes == count
    assert [p.equity for p in result.players] == pytest.approx(expected)


def test_multiway_board_tie():
    result = equity(["2c3c", "4d5d", "6h7h"], board="AsKsQsJsTs")
    for p in result.players:
        assert p.equity == pytest.approx(1 / 3)
        assert p.win == 0 and p.tie == 1 and p.loss == 0


def test_quartered_low_and_scoop():
    r = equity(["As2cJhJd", "Ah2dKsKh"], game="omaha8", board="3d4h8sJcQd")
    assert [p.equity for p in r.players] == [.75, .25]
    assert all(p.low_tie == 1 and p.tie == 1 and p.win == 0 for p in r.players)
    assert r.players[0].high_win == 1
    r = equity(["As2cJhJd", "TcTdKsKh"], game="omaha8", board="3d4h5sKcQd")
    assert [p.equity for p in r.players] == [1, 0]
    assert r.players[0].win == r.players[0].low_win == 1


@pytest.mark.parametrize("game,ranges,board", [
    ("holdem", ["AA", "KK"], "2c3d4h"),
    ("omaha", ["AsKsQcJd", "AhKhQdJc"], "2c3d4h"),
    ("omaha8", ["As2cQcJd", "Ah3hQdJc"], "2h3d4h")])
def test_monte_carlo_converges_to_exact(game, ranges, board):
    exact = equity(ranges, game=game, board=board, method="exact")
    mc = equity(ranges, game=game, board=board, method="monte_carlo", samples=30000, seed=871)
    for a, b in zip(exact.players, mc.players):
        assert abs(a.equity - b.equity) < max(5 * b.stderr, 0.001)
        assert b.win + b.tie + b.loss == pytest.approx(1)


def test_reproducibility_and_threads():
    for threads in (1, 3):
        kwargs = dict(method="monte_carlo", samples=12003, seed=2**64 - 1, threads=threads)
        a = equity(["AA", "random"], **kwargs)
        b = equity(["AA", "random"], **kwargs)
        assert a.players == b.players
        assert a.outcomes == b.outcomes == 12003
        assert a.attempts == b.attempts
        assert a.threads == threads
        assert sum(p.equity for p in a.players) == pytest.approx(1)


def test_auto_and_limits():
    assert equity(["AsAh", "KsKh"], board="2c3d4h").method == "exact"
    assert equity(["AA", "KK"], samples=10, seed=1).method == "monte_carlo"
    with pytest.raises(RuntimeError, match="outcome limit"):
        equity(["AsAh", "KsKh"], method="exact", max_exact=3)
    with pytest.raises(ValueError, match="compatible"):
        equity(["AsAh", "AsKh"], board="2c3d4h8s9c", method="exact")
    with pytest.raises(RuntimeError, match="attempt limit"):
        equity(["AsAh", "AsKh"], method="monte_carlo", samples=10, max_attempts=20)
    with pytest.raises(ValueError, match="max_attempts"):
        equity(["AA", "KK"], method="monte_carlo", samples=100, max_attempts=10)


@pytest.mark.parametrize("kwargs", [{"samples": 0}, {"seed": -1}, {"threads": 0},
    {"threads": 257}, {"max_exact": 0}, {"method": "bad"}, {"board": "AsKs"},
    {"board": "AsKsQs", "dead": "As"}, {"game": "bad"}, {"samples": True}])
def test_bad_options(kwargs):
    with pytest.raises(ValueError):
        equity(["AA", "KK"], **kwargs)


def test_bad_player_ranges():
    for ranges in ["AA", ["AA"], ["AA", "AA:KK"], ["AsAh", "KK"]]:
        with pytest.raises(ValueError):
            equity(ranges, board="As2c3d")
    with pytest.raises(ValueError):
        equity([parse_range("AA"), parse_range("KK")], game="omaha")


def test_single_sample_has_unknown_stderr():
    result = equity(["AA", "KK"], method="monte_carlo", samples=1, seed=0)
    assert math.isnan(result.players[0].stderr)
    assert all(math.isnan(v) for v in result.players[0].confidence_interval)
