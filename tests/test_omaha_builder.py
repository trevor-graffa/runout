import pytest
from poker_engine import parse_range


@pytest.mark.parametrize("text,count", [("{AA|AA}",1),("{AA|AKs}",12),("{AKs|A2o}",36),
    ("{AK|AK}",36),("{AKs|A2o}:$ds",0),("{AA|KK}$ds",6),("{random|random}",270725)])
def test_two_card_groups_use_distinct_cards_and_deduplicate(text,count):
    r=parse_range(text,game="omaha")
    assert len(r)==count
    assert all(mask.bit_count()==4 and weight==1 for mask,weight in r.entries)


def test_weighting_and_blocking_composed_groups():
    r=parse_range("{AA|AA}@.5",game="omaha")
    assert list(r.hands())==[("AcAdAhAs",.5)]
    assert len(parse_range("{AA|AA}",game="omaha",blocked="As"))==0
    for text in ("{AA}","{AA|}","{AA|KK|QQ}","{AA|KK","{AA@2|KK}","{{AA|KK}|QQ}"):
        with pytest.raises(ValueError):parse_range(text,game="omaha")
    with pytest.raises(ValueError):parse_range("{AA|KK}")


def test_all_five_suit_textures_partition_four_distinct_ranks():
    ranges=[parse_range("AKQJ:"+macro,game="omaha") for macro in ("$ds","$ss","$r","$ts","$ms")]
    assert [len(r) for r in ranges]==[36,144,24,48,4]
    masks=[m for r in ranges for m,_ in r.entries]
    assert len(set(masks))==len(masks)==256


def test_high_card_suit_relationships_and_tied_rank_assignments():
    assert len(parse_range("AKQJ$hs",game="omaha"))==148
    assert len(parse_range("AKQJ$as",game="omaha"))==148
    assert len(parse_range("AKQJ$bs",game="omaha"))==24
    assert len(parse_range("KQJT:$as",game="omaha"))==0
    for text in ("AsKsKh3h:$bs","AsKsQhJh:$hs","AsKsQhJh:$as"):
        assert len(parse_range(text,game="omaha"))==1
    for text in ("AsKsQhJh:$bs","AsKdQdJd:$hs","AKQJ:$r:$hs"):
        assert len(parse_range(text,game="omaha"))==0
