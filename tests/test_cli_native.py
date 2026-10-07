import json
import pytest

from poker_engine import _native
from poker_engine.cli import main


def test_cli_json(capsys):
    assert main(["AsAh", "KsKh", "--board", "2c3d4h8s9c", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["outcomes"] == 1
    assert data["players"][0]["equity"] == 1


def test_cli_count_and_errors(capsys):
    assert main(["AA$ds", "--game", "omaha", "--count", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["range_sizes"] == [864]
    assert main(["20%", "KK"]) == 2
    assert "not supported" in capsys.readouterr().err
    assert main(["AA", "KK", "--method", "monte_carlo", "--samples", "1", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["players"][0]["stderr"] is None


def test_native_rejects_invalid_data():
    for cards in ([52, 1, 2, 3, 4], [1, 1, 2, 3, 4], [-1, 1, 2, 3, 4]):
        with pytest.raises((ValueError, OverflowError)):
            _native.evaluate_high(cards)
    with pytest.raises(ValueError):
        _native.evaluate(9, [1, 2], [3, 4, 5])
    for entries in [[(3, 0)], [(3, float("nan"))], [(3, 1), (3, 2)], [(1 << 52, 1)]]:
        with pytest.raises(ValueError):
            _native.simulate([entries, [(12, 1)]], [], [], 0, False, 10, 0, 100, 100, 1)


def test_compiled_range_card_removal_and_game_validation():
    from poker_engine import parse_range
    compiled = [_native.compile_range(0, parse_range(r).entries) for r in ["AA", "KK"]]
    result = _native.simulate(compiled, [51, 0, 5, 10, 15], [], 0, True, 10, 0, 100, 100, 1)
    assert result["outcomes"] == 18  # Three ace pairs after removing As; six king pairs.
    with pytest.raises(ValueError, match="game"):
        _native.simulate(compiled, [], [], 1, False, 10, 0, 100, 100, 1)
    with pytest.raises(ValueError, match="byte count"):
        _native.initialize_omaha(b"bad")
