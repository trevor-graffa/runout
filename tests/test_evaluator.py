import random
import pytest

from poker_engine import evaluate_cards, evaluate_hand, parse_cards
from reference import high, omaha


@pytest.mark.parametrize("cards,category", [("AsKd9c7h3s", "high card"),
    ("AsAd9c7h3s", "pair"), ("AsAd9c9h3s", "two pair"), ("AsAdAc7h3s", "three of a kind"),
    ("As2d3c4h5s", "straight"), ("AsJs9s7s3s", "flush"), ("AsAdAc7h7s", "full house"),
    ("AsAdAcAh3s", "four of a kind"), ("AsKsQsJsTs", "straight flush")])
def test_categories(cards, category):
    assert evaluate_cards(cards).category == category
    assert evaluate_cards(cards).high == high(parse_cards(cards))


def test_independent_reference_random_hands():
    rng = random.Random(91231)
    for n in (5, 6, 7):
        for _ in range(1200):
            cards = rng.sample(range(52), n)
            assert evaluate_cards(cards).high == high(cards)


def test_seven_card_edge_cases():
    for text in ["AsAhAdKsKhKd2c", "AsAhKsKhQsQh2c", "AsKsQsJsTs9s8s",
                 "As2s3s4s5sKdKh", "AsAhAdAcKsKhKd", "2c3d4s5h6c7d8s"]:
        assert evaluate_cards(text).high == high(parse_cards(text))


def test_independent_omaha_reference():
    rng = random.Random(52311)
    for board_size in (3, 4, 5):
        for _ in range(400):
            cards = rng.sample(range(52), 4 + board_size)
            expected_high, expected_low = omaha(cards[:4], cards[4:])
            result = evaluate_hand(cards[:4], cards[4:], game="omaha8")
            assert (result.high, result.low) == (expected_high, expected_low)
            assert evaluate_hand(cards[:4], cards[4:], game="omaha").high == expected_high


def test_omaha_cannot_play_board_or_one_hole_card():
    assert evaluate_hand("As2c3d4h", "KsQsJsTs9s", game="omaha").category != "straight flush"
    assert evaluate_hand("2c3d4h5c", "AsKsQsJsTs", game="omaha").category != "straight flush"
    assert evaluate_hand("AsKs3d4h", "QsJsTs2c2d", game="omaha").category == "straight flush"


def test_low_qualification_and_wheel():
    assert evaluate_hand("As2cKdKh", "3d4h5sQcQd", game="omaha8").low_ranks == (5, 4, 3, 2, 1)
    assert evaluate_hand("As2cKdKh", "3d4h9sQcQd", game="omaha8").low == 0
    assert evaluate_hand("AsAcKdKh", "2d3h4sQcQd", game="omaha8").low == 0


def test_evaluation_validation():
    with pytest.raises(ValueError):
        evaluate_cards("AsKsQsJs")
    with pytest.raises(ValueError):
        evaluate_hand("AsKs", "AsQhJd")
    with pytest.raises(ValueError):
        evaluate_hand("AsKs", "QhJdTc", game="omaha")
