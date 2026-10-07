"""Public Python API. Only numeric data crosses into the compiled core."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import secrets
import time
import gzip
from importlib.resources import files
from collections.abc import Iterable

from .cards import cards_mask, parse_cards
from .ranges import GAME_IDS, Range, hole_size, normalize_game, parse_range

try:
    from . import _native
except ImportError as exc:
    raise ImportError("Build the C++ extension first: python setup.py build_ext --inplace "
                      "(or install with python -m pip install .)") from exc

CATEGORIES = ("high card", "pair", "two pair", "three of a kind", "straight",
              "flush", "full house", "four of a kind", "straight flush")

_omaha_initialized = False


def _ensure_omaha() -> None:
    global _omaha_initialized
    if not _omaha_initialized:
        blob = files("poker_engine").joinpath("data/omaha.bin.gz").read_bytes()
        _native.initialize_omaha(gzip.decompress(blob))
        _omaha_initialized = True


@dataclass(frozen=True)
class HandValue:
    high: int
    low: int = 0

    @property
    def category(self) -> str:
        return CATEGORIES[self.high >> 20]

    @property
    def low_ranks(self) -> tuple[int, ...] | None:
        return tuple((self.low >> shift) & 15 for shift in (16, 12, 8, 4, 0)) if self.low else None


@dataclass(frozen=True)
class PlayerEquity:
    equity: float
    stderr: float
    win: float
    tie: float
    loss: float
    high_win: float
    high_tie: float
    low_win: float
    low_tie: float

    @property
    def confidence_interval(self) -> tuple[float, float]:
        """Approximate 95% normal interval (Monte Carlo); exact results collapse."""
        if math.isnan(self.stderr):
            return (float("nan"), float("nan"))
        return max(0.0, self.equity - 1.96 * self.stderr), min(1.0, self.equity + 1.96 * self.stderr)


@dataclass(frozen=True)
class EquityResult:
    game: str
    method: str
    players: tuple[PlayerEquity, ...]
    outcomes: int
    attempts: int
    seed: int | None
    threads: int
    elapsed: float
    range_sizes: tuple[int, ...]

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate_cards(cards: str | Iterable[int | str]) -> HandValue:
    """Best high hand from 5..7 cards, with no Omaha hole/board restriction."""
    return HandValue(_native.evaluate_high(parse_cards(cards)))


def evaluate_hand(hole: str | Iterable[int | str], board: str | Iterable[int | str],
                  *, game: str = "holdem") -> HandValue:
    game = normalize_game(game)
    if game != "holdem":
        _ensure_omaha()
    high, low = _native.evaluate(GAME_IDS[game], parse_cards(hole), parse_cards(board))
    return HandValue(high, low)


def _uint(name: str, value: int, minimum: int = 0, maximum: int = (1 << 64) - 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer in {minimum}..{maximum}")
    return value


def equity(ranges: Iterable[str | Range], *, game: str = "holdem",
           board: str | Iterable[int | str] = "", dead: str | Iterable[int | str] = "",
           method: str = "auto", samples: int = 100000, seed: int | None = None,
           threads: int = 1, max_exact: int = 2000000, max_attempts: int = 0) -> EquityResult:
    """Equity conditioned on all hole cards being mutually compatible.

    auto chooses exact if a conservative outcome bound fits max_exact, otherwise
    Monte Carlo. Weights are relative combo probabilities; board completions are
    uniform. All simulations run with the GIL released.
    """
    started = time.perf_counter()
    game = normalize_game(game)
    if method not in ("auto", "exact", "monte_carlo"):
        raise ValueError("method must be auto, exact, or monte_carlo")
    _uint("samples", samples, 1); _uint("threads", threads, 1, 256)
    _uint("max_exact", max_exact, 1); _uint("max_attempts", max_attempts)
    if seed is not None:
        _uint("seed", seed)
    board_cards, dead_cards = parse_cards(board), parse_cards(dead)
    if len(board_cards) not in (0, 3, 4, 5):
        raise ValueError("Board must contain 0, 3, 4, or 5 cards")
    blocked = board_cards + dead_cards
    cards_mask(blocked)  # Reject overlap between board and dead cards.
    if isinstance(ranges, (str, Range)):
        raise ValueError("Pass a sequence of player ranges, e.g. ['AA', 'KK']")
    expanded: list[Range] = []
    for r in ranges:
        if isinstance(r, str):
            parsed = parse_range(r, game=game, blocked=blocked)
        elif isinstance(r, Range):
            if r.hand_size != hole_size(game):
                raise ValueError("Range hand size does not match game")
            parsed = r.without(blocked)
        else:
            raise ValueError("Player ranges must be strings or Range objects")
        if not len(parsed):
            raise ValueError("A player range is empty after card removal")
        expanded.append(parsed)
    if not 2 <= len(expanded) <= 10:
        raise ValueError("Use 2 to 10 players")
    available = 52 - len(blocked) - hole_size(game) * len(expanded)
    missing = 5 - len(board_cards)
    if available < missing:
        raise ValueError("Not enough cards to complete the deal")
    if method == "auto":
        bound = math.comb(available, missing) * math.prod(len(r) for r in expanded)
        method = "exact" if bound <= max_exact else "monte_carlo"
    native_seed = seed if seed is not None else secrets.randbits(64)
    if game != "holdem":
        _ensure_omaha()
    compiled = []
    for r in expanded:
        if game not in r._native_cache:
            r._native_cache[game] = _native.compile_range(GAME_IDS[game], r.entries)
        compiled.append(r._native_cache[game])
    raw = _native.simulate(compiled, board_cards, dead_cards, GAME_IDS[game],
                           method == "exact", samples, native_seed, max_exact, max_attempts, threads)
    return EquityResult(game, method, tuple(PlayerEquity(**p) for p in raw["players"]),
                        raw["outcomes"], raw["attempts"], native_seed if method != "exact" else None,
                        threads if method != "exact" else 1, time.perf_counter() - started,
                        tuple(len(r) for r in expanded))
