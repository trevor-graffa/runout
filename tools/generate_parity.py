"""Create shared oracle and native/WASM reproducibility fixtures."""
import json
import hashlib
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'tests')]
from reference import high, omaha
from poker_engine import _native, parse_range, parse_cards

rng = random.Random(19231)
hands=[]
for n in (5,6,7):
    for _ in range(20):
        cards=rng.sample(range(52),n)
        hands.append(dict(cards=cards,high=high(cards)))
omaha_hands=[]
for n in (3,4,5):
    for _ in range(20):
        cards=rng.sample(range(52),n+4)
        h,l=omaha(cards[:4],cards[4:])
        omaha_hands.append(dict(hole=cards[:4],board=cards[4:],high=h,low=l))
simulations=[]
for game,texts in [('holdem',['AA@2,KK','QQ,JJ']),('omaha',['AsKsQcJd,AhKhQdJc','2c3d4h5s,2d3h4s5c']),
                   ('omaha8',['As2cJhJd,Ah2dKsKh','Ac3cQhQd,Ad3dQsQc'])]:
    game_id=['holdem','omaha','omaha8'].index(game)
    entries=[parse_range(r,game=game).entries for r in texts]
    result=_native.simulate(entries,[],[],game_id,False,10000,0xffffffffffffffff,2000000,0,1)
    simulations.append(dict(game=game,ranges=texts,samples=10000,seed=str(0xffffffffffffffff),result=result))
path=ROOT/'tests/fixtures/parity.json';path.parent.mkdir(exist_ok=True)
patterns=['{AA|AA}','{AA|AKs}','{AKs|A2o}','{AK|AK}','{AKs|A2o}:$ds','{AA|KK}$ds',
    'AKQJ$ts','AKQJ$ms','AKQJ$hs','AKQJ$as','AKQJ$bs','KQJT:$as','AsKsKh3h:$bs']
ranges=[]
for text in patterns:
    r=parse_range(text,game='omaha')
    digest=hashlib.sha256(','.join(str(m) for m,_ in r.entries).encode()).hexdigest()
    ranges.append(dict(text=text,count=len(r),sha256=digest))
path.write_text(json.dumps(dict(hands=hands,omaha=omaha_hands,simulations=simulations,ranges=ranges),indent=2)+'\n')
print(path)
