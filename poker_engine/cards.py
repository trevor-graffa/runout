"""Card text conversion. Native code sees only IDs and masks."""
from __future__ import annotations

import re
from collections.abc import Iterable

RANKS = "23456789TJQKA"
SUITS = "cdhs"


def card_id(text: str) -> int:
    if not isinstance(text, str) or len(text) != 2:
        raise ValueError(f"Expected a card such as As or Td, got {text!r}")
    rank, suit = text[0].upper(), text[1].lower()
    if rank not in RANKS or suit not in SUITS:
        raise ValueError(f"Invalid card: {text!r}; use ranks 2..9,T,J,Q,K,A and suits c,d,h,s")
    return RANKS.index(rank) * 4 + SUITS.index(suit)


def card_text(card: int) -> str:
    if isinstance(card, bool) or not isinstance(card, int) or not 0 <= card < 52:
        raise ValueError(f"Card ID must be an integer in 0..51, got {card!r}")
    return RANKS[card // 4] + SUITS[card % 4]


def parse_cards(value: str | Iterable[int | str]) -> tuple[int, ...]:
    if isinstance(value, str):
        compact = re.sub(r"[\s,]+", "", value)
        if len(compact) % 2:
            raise ValueError(f"Cards must be rank/suit pairs: {value!r}")
        cards = tuple(card_id(compact[i:i + 2]) for i in range(0, len(compact), 2))
    else:
        cards = tuple(card_id(c) if isinstance(c, str) else c for c in value)
        for c in cards:
            card_text(c)  # Validate integer IDs, including rejecting bool.
    if len(set(cards)) != len(cards):
        raise ValueError("Duplicate card")
    return cards


def cards_mask(cards: Iterable[int]) -> int:
    mask = 0
    for c in cards:
        card_text(c)
        if mask & (1 << c):
            raise ValueError("Duplicate card")
        mask |= 1 << c
    return mask


def mask_cards(mask: int) -> tuple[int, ...]:
    if isinstance(mask, bool) or not isinstance(mask, int) or not 0 <= mask < 1 << 52:
        raise ValueError("Invalid card mask")
    return tuple(c for c in range(52) if mask & (1 << c))


def format_cards(cards: Iterable[int]) -> str:
    return "".join(card_text(c) for c in cards)
