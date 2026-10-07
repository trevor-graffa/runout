"""PokerStove Hold'em and a documented subset of PPT generic Omaha syntax."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from itertools import combinations
import math
import re
from collections.abc import Iterable, Mapping

from .cards import RANKS, SUITS, cards_mask, format_cards, mask_cards, parse_cards

GAME_IDS = {"holdem": 0, "omaha": 1, "omaha8": 2}
GAME_ALIASES = {"he": "holdem", "nlhe": "holdem", "plo": "omaha",
                "omahahi": "omaha", "plo8": "omaha8", "omaha-hi-lo": "omaha8"}


def normalize_game(game: str) -> str:
    if not isinstance(game, str):
        raise ValueError("game must be holdem, omaha, or omaha8")
    name = GAME_ALIASES.get(game.lower(), game.lower())
    if name not in GAME_IDS:
        raise ValueError(f"Unsupported game {game!r}; choose holdem, omaha, or omaha8")
    return name


def hole_size(game: str) -> int:
    return 2 if normalize_game(game) == "holdem" else 4


@dataclass(frozen=True, slots=True, repr=False)
class Range:
    """Concrete masks and positive relative weights. Each physical hand occurs once."""
    entries: tuple[tuple[int, float], ...]
    hand_size: int = 2
    _native_cache: dict = field(default_factory=dict, init=False, repr=False, compare=False, hash=False)
    _filtered_cache: dict = field(default_factory=dict, init=False, repr=False, compare=False, hash=False)

    def __post_init__(self) -> None:
        if self.hand_size not in (2, 4):
            raise ValueError("hand_size must be 2 or 4")
        entries = tuple((mask, float(weight)) for mask, weight in self.entries)
        seen: set[int] = set()
        for mask, weight in entries:
            if isinstance(mask, bool) or not isinstance(mask, int) or not 0 <= mask < 1 << 52:
                raise ValueError("Invalid combo mask")
            if mask.bit_count() != self.hand_size:
                raise ValueError(f"Each hand needs {self.hand_size} cards")
            if not math.isfinite(weight) or weight <= 0:
                raise ValueError("Weights must be finite and positive")
            if mask in seen:
                raise ValueError("Duplicate combo; merge its weight before creating a Range")
            seen.add(mask)
        object.__setattr__(self, "entries", entries)

    def __len__(self) -> int:
        return len(self.entries)

    def __repr__(self) -> str:
        return f"Range({len(self):,} combos, {self.hand_size} cards)"

    @classmethod
    def parse(cls, text: str, *, game: str = "holdem", blocked="") -> Range:
        return parse_range(text, game=game, blocked=blocked)

    def __reduce__(self):
        # Numeric contents remain serializable after a native capsule has been cached.
        return Range, (self.entries, self.hand_size)

    @classmethod
    def from_hands(cls, hands: Iterable[str | Iterable[int | str]] |
                   Mapping[str, float], *, game: str = "holdem") -> Range:
        items = hands.items() if isinstance(hands, Mapping) else ((h, 1.0) for h in hands)
        entries = tuple((cards_mask(parse_cards(h)), w) for h, w in items)
        return cls(entries, hole_size(game))

    def without(self, blocked: str | Iterable[int | str]) -> Range:
        mask = cards_mask(parse_cards(blocked))
        if not mask:
            return self
        if mask not in self._filtered_cache:
            if len(self._filtered_cache) >= 8:
                self._filtered_cache.clear()
            self._filtered_cache[mask] = Range(tuple((m, w) for m, w in self.entries if not m & mask), self.hand_size)
        return self._filtered_cache[mask]

    def hands(self) -> Iterable[tuple[str, float]]:
        for mask, weight in self.entries:
            yield format_cards(mask_cards(mask)), weight


@lru_cache(maxsize=2)
def _universe(size: int) -> frozenset[int]:
    return frozenset(sum(1 << c for c in hand) for hand in combinations(range(52), size))


def _holdem_class(high: str, low: str, suited: str) -> set[int]:
    a, b = RANKS.index(high), RANKS.index(low)
    if a < b:
        raise ValueError("Hold'em classes must put the higher rank first, e.g. AKs")
    if a == b:
        if suited:
            raise ValueError("Pairs cannot have a suited/offsuit suffix")
        return {(1 << (a * 4 + s)) | (1 << (a * 4 + t)) for s, t in combinations(range(4), 2)}
    return {(1 << (a * 4 + s)) | (1 << (b * 4 + t))
            for s in range(4) for t in range(4)
            if not suited or (s == t if suited == "s" else s != t)}


_CLASS = r"([2-9TJQKA])([2-9TJQKA])([so]?)"


def _holdem_atom(text: str) -> set[int] | None:
    match = re.fullmatch(_CLASS + r"(\+)?", text)
    if match:
        high, low, suited, plus = match.groups()
        a, b = RANKS.index(high), RANKS.index(low)
        if a < b:
            raise ValueError("Put the higher rank first in Hold'em shorthand")
        if not plus:
            return _holdem_class(high, low, suited)
        classes = ((RANKS[r], RANKS[r]) for r in range(a, 13)) if a == b else (
            (high, RANKS[r]) for r in range(b, a))
        result: set[int] = set()
        for h, l in classes:
            result.update(_holdem_class(h, l, suited))
        return result
    span = re.fullmatch(_CLASS + "-" + _CLASS, text)
    if span:
        h1, l1, s1, h2, l2, s2 = span.groups()
        if s1 != s2:
            raise ValueError("Range endpoints must have matching suited/offsuit suffixes")
        a, b, c, d = (RANKS.index(x) for x in (h1, l1, h2, l2))
        if a < b or c < d:
            raise ValueError("Range endpoints must have higher rank first")
        da, db = c - a, d - b
        if da and db and da != db:
            raise ValueError("Use pair, fixed-rank, or equal-gap diagonal intervals")
        steps = max(abs(da), abs(db))
        result = set()
        for k in range(steps + 1):
            h = a + (0 if not da else (1 if da > 0 else -1) * k)
            l = b + (0 if not db else (1 if db > 0 else -1) * k)
            result.update(_holdem_class(RANKS[h], RANKS[l], s1))
        return result
    return None


def _rank_set(text: str) -> tuple[int, ...]:
    text = text.replace(",", "")
    if re.fullmatch(r"[2-9TJQKA]-[2-9TJQKA]", text):
        a, b = RANKS.index(text[0]), RANKS.index(text[2])
        return tuple(range(min(a, b), max(a, b) + 1))
    if not text or any(c not in RANKS for c in text):
        raise ValueError("Bracket sets support ranks, e.g. [AKQ] or [K-T]")
    return tuple(sorted({RANKS.index(c) for c in text}))


def _pattern(text: str, size: int) -> set[int]:
    # A token has permitted ranks, and an optional literal suit or suit variable.
    tokens: list[tuple[tuple[int, ...], str | None]] = []
    i = 0
    while i < len(text):
        c = text[i]
        if c == "[":
            end = text.find("]", i + 1)
            if end < 0:
                raise ValueError("Unclosed rank bracket")
            ranks = _rank_set(text[i + 1:end]); i = end + 1
        elif c in RANKS:
            ranks = (RANKS.index(c),); i += 1
        elif c == "*":
            ranks = tuple(range(13)); i += 1
        elif c in SUITS + "xyzw":
            ranks = tuple(range(13))  # suit-only token, e.g. xxyy or hh
        else:
            raise ValueError(f"Unsupported range token {c!r} in {text!r}")
        suit = None
        if i < len(text) and text[i] in SUITS + "xyzw":
            suit = text[i]; i += 1
        tokens.append((ranks, suit))
    if not tokens or len(tokens) > size:
        raise ValueError(f"Pattern must describe at most {size} cards")
    tokens.extend([(tuple(range(13)), None)] * (size - len(tokens)))
    # Unconstrained tail is generated as combinations instead of permutations.
    tail = 0
    while tokens and tokens[-1] == (tuple(range(13)), None):
        tail += 1; tokens.pop()
    if not tokens:
        return set(_universe(size))
    result: set[int] = set()
    variables: dict[str, int] = {}

    def generate(slot: int, used: int) -> None:
        if slot == len(tokens):
            if tail:
                available = [c for c in range(52) if not used & (1 << c)]
                for extra in combinations(available, tail):
                    result.add(used | sum(1 << c for c in extra))
            else:
                result.add(used)
            return
        ranks, suit = tokens[slot]
        if suit is not None and suit in SUITS:
            allowed = (SUITS.index(suit),)
        elif suit in variables:
            allowed = (variables[suit],)
        elif suit is not None:
            allowed = tuple(s for s in range(4) if s not in variables.values())
        else:
            allowed = tuple(range(4))
        new_variable = suit is not None and suit in "xyzw" and suit not in variables
        for s in allowed:
            if new_variable:
                variables[suit] = s
            for rank in ranks:
                bit = 1 << (rank * 4 + s)
                if not used & bit:
                    generate(slot + 1, used | bit)
            if new_variable:
                del variables[suit]

    generate(0, 0)
    return result


@lru_cache(maxsize=32)
def _atom(text: str, size: int) -> frozenset[int]:
    if "%" in text:
        raise ValueError("Top-N% ranges are not supported; supply explicit classes or weighted hands")
    if text.lower() == "random" or text == "*":
        return _universe(size)
    if text in ("$hs", "$as", "$bs"):
        if size != 4:
            raise ValueError("Rank-dependent suit filters require Omaha")
        return frozenset(m for m in _universe(4) if _suit_property(m, text))
    if size == 2:
        value = _holdem_atom(text)
        if value is not None:
            return frozenset(value)
    return frozenset(_pattern(text, size))


def _suit_property(mask: int, name: str) -> bool:
    cards = []
    while mask:
        bit = mask & -mask; cards.append(bit.bit_length() - 1); mask ^= bit
    counts = [0] * 4
    for c in cards:
        counts[c % 4] += 1
    high, second = cards[-1] // 4, cards[-2] // 4
    if name == "$hs":
        return any(c // 4 == high and counts[c % 4] >= 2 for c in cards)
    if name == "$as":
        return any(c // 4 == 12 and counts[c % 4] >= 2 for c in cards)
    return any(a // 4 == high and b // 4 >= second and a % 4 != b % 4
               and counts[a % 4] >= 2 and counts[b % 4] >= 2
               for a in cards for b in cards)


@lru_cache(maxsize=32)
def _paired(text: str) -> frozenset[int]:
    parts = text.split("|")
    if len(parts) != 2 or not all(parts) or any(c in text for c in "{}@"):
        raise ValueError("Use {first Hold'em range|second Hold'em range}; weights go outside")
    a, b = (_parse_cached(part, 2) for part in parts)
    if len(a) == len(b) == 1326:
        return _universe(4)
    # Each physical hand appears once, regardless of how many pair partitions fit.
    return frozenset(x | y for x, _ in a.entries for y, _ in b.entries if not x & y)


class _Parser:
    def __init__(self, text: str, size: int):
        self.text = text
        self.size = size
        self.pos = 0
        self.depth = 0

    def accept(self, char: str) -> bool:
        if self.pos < len(self.text) and self.text[self.pos] == char:
            self.pos += 1
            return True
        return False

    def union(self) -> dict[int, float]:
        left = self.difference()
        while self.accept(","):
            for m, w in self.difference().items():
                left[m] = max(w, left.get(m, 0))
        return left

    def difference(self) -> dict[int, float]:
        left = self.intersection()
        while self.accept("!"):
            right = self.intersection()
            left = {m: w for m, w in left.items() if m not in right}
        return left

    def intersection(self) -> dict[int, float]:
        left = self.primary()
        while self.accept(":"):
            right = self.primary()
            left = {m: min(w, right[m]) for m, w in left.items() if m in right}
        return left

    def primary(self) -> dict[int, float]:
        self.depth += 1
        if self.depth > 64:
            raise ValueError("Range expression nesting exceeds 64")
        if self.accept("!"):
            excluded = self.primary()
            result = {m: 1.0 for m in _universe(self.size) if m not in excluded}
        elif self.accept("("):
            result = self.union()
            if not self.accept(")"):
                raise ValueError(f"Expected ')' at position {self.pos}")
        elif self.accept("{"):
            if self.size != 4:
                raise ValueError("Two-card group composition requires Omaha")
            end = self.text.find("}", self.pos)
            if end < 0:
                raise ValueError("Unclosed two-card group")
            result = dict.fromkeys(_paired(self.text[self.pos:end]), 1.0)
            self.pos = end + 1
        else:
            start = self.pos; brackets = 0
            while self.pos < len(self.text):
                c = self.text[self.pos]
                if c == "[":
                    brackets += 1
                elif c == "]":
                    brackets -= 1
                    if brackets < 0:
                        raise ValueError("Unexpected closing bracket")
                elif not brackets and c in ",!:()@":
                    break
                self.pos += 1
            if brackets:
                raise ValueError("Unclosed bracket")
            atom = self.text[start:self.pos]
            if not atom:
                raise ValueError(f"Expected range at position {self.pos}")
            result = dict.fromkeys(_atom(atom, self.size), 1.0)
        if self.accept("@"):
            match = re.match(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?", self.text[self.pos:])
            if not match:
                raise ValueError("Expected positive weight after '@'")
            token = match.group(); self.pos += len(token)
            scale = float(token.rstrip("%")) / (100 if token.endswith("%") else 1)
            if not math.isfinite(scale) or scale <= 0:
                raise ValueError("Weights must be finite and positive")
            result = {m: w * scale for m, w in result.items()}
        self.depth -= 1
        return result


@lru_cache(maxsize=16)
def _parse_cached(text: str, size: int) -> Range:
    parser = _Parser(text, size)
    entries = parser.union()
    if parser.pos != len(text):
        raise ValueError(f"Unexpected token at position {parser.pos}: {text[parser.pos:]!r}")
    return Range(tuple(sorted(entries.items())), size)


def parse_range(text: str, *, game: str = "holdem",
                blocked: str | Iterable[int | str] = "") -> Range:
    """Expand a range in Python. Blocked cards remove physical combos immediately."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Range text must be nonempty")
    compact = re.sub(r"\s+", "", text)
    if len(compact) > 4096:
        raise ValueError("Range expression exceeds 4096 characters")
    # PPT's familiar suit macros. Appending a macro intersects the preceding atom.
    compact = re.sub(r"(?<=[A-Za-z0-9*\])}])\$(ds|ss|r|ts|ms|hs|as|bs)\b", r":$\1", compact)
    for macro, pattern in (("$ds", "xxyy"), ("$ss", "xxyz"), ("$r", "xyzw"), ("$ts", "xxxy"), ("$ms", "xxxx")):
        compact = compact.replace(macro, pattern)
    result = _parse_cached(compact, hole_size(game))
    return result.without(blocked) if blocked else result
