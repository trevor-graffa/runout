from itertools import combinations
import pytest

from poker_engine import (Range, card_id, card_text, cards_mask, format_cards,
                          mask_cards, parse_cards, parse_range)


def test_card_roundtrip():
    for c in range(52):
        assert card_id(card_text(c)) == c
    assert parse_cards("as, KD\n2c") == (51, 45, 0)
    cards = parse_cards("AsKd2c")
    assert mask_cards(cards_mask(cards)) == tuple(sorted(cards))
    assert format_cards(cards) == "AsKd2c"


@pytest.mark.parametrize("text", ["AsAs", "10h", "Xc", "AsK", "Ahzz"])
def test_bad_cards(text):
    with pytest.raises(ValueError):
        parse_cards(text)


@pytest.mark.parametrize("value", [[True], [-1], [52], [1.5]])
def test_bad_ids(value):
    with pytest.raises(ValueError):
        parse_cards(value)


@pytest.mark.parametrize("text,count", [("AA", 6), ("AKs", 4), ("AKo", 12), ("AK", 16),
    ("22+", 78), ("TT+", 30), ("ATs+", 16), ("KTo+", 36), ("A2s-A5s", 16),
    ("99-JJ", 18), ("76s-T9s", 16), ("*", 1326), ("random", 1326), ("AsKs", 1),
    ("AA,AA", 6), ("(AA,KK):AA", 6), ("AA!As", 3), ("!AA", 1320), ("AA:KK", 0)])
def test_holdem_counts(text, count):
    assert len(parse_range(text)) == count


def test_blockers_weights_and_range_objects():
    assert len(parse_range("AA", blocked="As")) == 3
    r = parse_range("AA@50%,KK@1,AA@0.2")
    assert {w for _, w in r.entries} == {0.5, 1.0}
    assert all(w == 0.2 for _, w in parse_range("(AA,KK)@.2").entries)
    assert all(w == 0.2 for _, w in parse_range("AA@.5:AA@.2").entries)
    assert len(r.without("As")) == 9
    assert len(Range.from_hands({"AsAh": 0.5, "KsKh": 1})) == 2
    assert dict(r.hands())
    with pytest.raises(ValueError, match="Duplicate"):
        Range.from_hands(["AsAh", "AhAs"])


@pytest.mark.parametrize("text,count", [("*", 270725), ("AA", 6961), ("AA**", 6961),
    ("AKQJ", 256), ("AAAA", 1), ("AsKsQsJs", 1), ("xxyy", 36504),
    ("xxyz", 158184), ("xyzw", 28561), ("AA$ds", 864), ("AA:xxyy", 864),
    ("AxAyxy", 864), ("AA$ss", 4392), ("AA$r", 913)])
def test_omaha_counts(text, count):
    assert len(parse_range(text, game="omaha")) == count


def test_omaha_pattern_matching():
    aa = parse_range("AA", game="omaha")
    for mask, _ in aa.entries:
        assert sum(c // 4 == 12 for c in mask_cards(mask)) >= 2
    ds = parse_range("AA$ds", game="omaha")
    for mask, _ in ds.entries:
        suits = [c % 4 for c in mask_cards(mask)]
        assert sorted(suits.count(s) for s in set(suits)) == [2, 2]
    assert parse_range("[K-T]QJT", game="omaha").entries == parse_range("KQJT,QQJT,JQJT,TQJT", game="omaha").entries
    assert parse_range("[AK,Q]JT9", game="omaha").entries == parse_range("AJT9,KJT9,QJT9", game="omaha").entries
    assert len(parse_range("AsKs", game="omaha", blocked="As")) == 0


@pytest.mark.parametrize("text", ["", "AA,", "(AA", "AA)", "[AK", "AA@0", "AA@nan",
    "AA@1e999", "20%", "garbage", "AKs-KQo", "AAo", "KAs", "AKQJT", "$unknown"])
def test_rejected_syntax(text):
    with pytest.raises(ValueError):
        parse_range(text)


def test_numeric_range_validation():
    for entries in [((1, 1),), (((1 << 52) | 1, 1),), ((3, -1),), ((3, float("nan")),)]:
        with pytest.raises(ValueError):
            Range(entries)


def test_group_macro_and_cached_range_pickle():
    import pickle
    from poker_engine import equity
    assert parse_range("(AA,KK)$ds", game="omaha") == parse_range("(AA,KK):$ds", game="omaha")
    r = parse_range("AA")
    equity([r, "KK"], board="2c3d4h8s9c")
    assert pickle.loads(pickle.dumps(r)) == r
