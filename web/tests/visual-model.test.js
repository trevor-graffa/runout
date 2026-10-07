import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HAND_CLASSES,rundownExpression,groupPreset,holdemCount,holdemPreset,omahaExpression,playerExpression} from '../visual-model.js';
import {parseRange} from '../ranges.js';

test('standard Hold’em grid covers all hands with correct classes and presets',()=>{
  assert.equal(HAND_CLASSES.length,169);assert.equal(new Set(HAND_CLASSES.map(h=>h.text)).size,169);
  assert.equal(holdemCount(holdemPreset('all')),1326);assert.equal(holdemCount(holdemPreset('pairs')),78);
  for(const [name,text] of [['premium','TT+,AQs+,AKo'],['balanced','77+,ATs+,KQs,AJo+'],['wide','22+,A2s+,KTs+,QTs+,JTs,T9s,ATo+,KJo+']]){
    const p={name:'Hero',mode:'range',classes:holdemPreset(name)};
    assert.deepEqual(parseRange(playerExpression(p,'holdem')).entries,parseRange(text).entries);
  }
});
test('Omaha visual rank families and suit choices obey PPT-compatible physical ranges',()=>{
  assert.equal(parseRange(omahaExpression({preset:'aces',suitedness:'double'}),{game:'omaha'}).size,864);
  assert.equal(parseRange(omahaExpression({preset:'connected',suitedness:'double'}),{game:'omaha'}).size,360);
  for(const [suit,count] of [['any',256],['double',36],['single',144],['rainbow',24]]){
    const expression=omahaExpression({preset:'custom',suitedness:suit,slots:['A','K','Q','J']});
    assert.equal(parseRange(expression,{game:'omaha'}).size,count);
  }
  assert.equal(parseRange(omahaExpression({preset:'custom',suitedness:'double',slots:['A','A','A','A']}),{game:'omaha'}).size,0);
  assert.throws(()=>omahaExpression({preset:'custom',slots:['AK','K','Q','J']}));
  assert.throws(()=>playerExpression({name:'Hero',mode:'cards',cards:['As',null,null,null]},'holdem'));
});

test('High only restricts one pair and leaves side cards unrestricted',()=>{
  const groups=groupPreset('highonly');
  assert.equal(groups[0].size,25);assert.equal(groups[1].size,169);
  const range=parseRange(omahaExpression({builder:'pairs',groups,suitedness:'any'}),{game:'omaha'});
  // At least two of the 20 broadway cards, with 32 unrestricted low cards.
  assert.equal(range.size,190*496+1140*32+4845);
});

test('rundown limits apply each adjacent rank distance independently',()=>{
  assert.equal(rundownExpression({highMin:'J',highMax:'Q'}),'(QJT9,JT98)');
  assert.equal(rundownExpression({highMin:'A',highMax:'A',gaps:[[2,2],[1,1],[1,1]]}),'(AQJT)');
  assert.equal(parseRange(rundownExpression({highMin:'2',highMax:'2'}),{game:'omaha'}).size,0);
  assert.throws(()=>rundownExpression({highMin:'A',highMax:'K'}));
  assert.throws(()=>rundownExpression({gaps:[[2,1],[1,1],[1,1]]}));
});

test('named suit constraints intersect the rank range',()=>{
  const player={name:'Hero',mode:'range',classes:new Set(['AA']),rangeSuits:['h','s','*','*']};
  assert.equal(parseRange(playerExpression(player,'holdem')).size,1);
  player.rangeSuits=['h','h','*','*'];assert.equal(parseRange(playerExpression(player,'holdem')).size,0);
});
