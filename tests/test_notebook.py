import pytest
from poker_engine import Calculator, Range, equity
from poker_engine import _native


def test_rust_backend_is_actually_loaded():
    assert _native.BACKEND == "rust"


def test_named_players_and_notebook_display():
    calc = Calculator({"Hero <script>": "As2cJhJd", "Villain": "Ah2dKsKh"},
                      game="omaha8", board="3d4h8sJcQd")
    result = calc.exact()
    assert result.labels == ("Hero <script>", "Villain")
    assert [p.equity for p in result.players] == [.75, .25]
    assert result.rows()[0]["player"] == "Hero <script>"
    assert "&lt;script&gt;" in result._repr_html_()
    assert "<script>" not in result._repr_html_()
    assert result.to_dict()["labels"] == ("Hero <script>", "Villain")
    assert "omaha8" in repr(calc)


def test_class_reuses_ranges_and_supports_contexts():
    calc = Calculator(["AA", "KK"])
    flop = calc.with_board("2c3d4h")
    assert calc.board == ()
    assert flop.ranges[0] is calc.ranges[0]
    result = flop.equity()
    expected = equity(["AA", "KK"], board="2c3d4h")
    assert result.players == expected.players
    assert calc.simulate(samples=1000, seed=1, threads=2).outcomes == 1000
    assert len(repr(Range.parse("random", game="omaha"))) < 80


def test_optional_dataframe():
    pytest.importorskip("pandas")
    frame = Calculator({"Hero": "AsAh", "Villain": "KsKh"}, board="2c3d4h8s9c").exact().to_frame()
    assert frame.loc["Hero", "equity"] == 1


@pytest.mark.parametrize("kwargs", [{"ranges": "AA"}, {"ranges": ["AA"]},
    {"ranges": ["AA", "KK"], "board": "AsKs"},
    {"ranges": ["AA", "KK"], "board": "AsKsQs", "dead": "As"},
    {"ranges": [Range.parse("AA"), "KK"], "game": "omaha"}])
def test_calculator_validates_context(kwargs):
    with pytest.raises(ValueError):
        Calculator(**kwargs)
