import { Calculator, parseCards } from './poker.js';
import { RANKS, SUITS, SUIT_GLYPHS, HAND_CLASSES, holdemPreset, holdemCount, groupPreset, OMAHA_PRESETS, playerExpression } from './visual-model.js';

const $ = id => document.getElementById(id);
const create = (tag, text, className = '') => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; e.className=className; return e; };
const makePlayer = (name, hero = false) => ({name,mode:'range',rangeSuits:['*','*','*','*'],classes:hero?new Set(['AA']):holdemPreset('all'),cards:[null,null,null,null],omaha:{preset:hero?'aces':'any',suitedness:hero?'double':'any',slots:['A','A','*','*'],builder:'family',connection:'any',groups:groupPreset('highlow'),activeGroup:0,rundown:{highMin:'5',highMax:'A',gaps:[[1,1],[1,1],[1,1]]}}});
let playerPage=0;
let game='holdem', players=[makePlayer('Hero',true),makePlayer('Villain')], active=0, board=[null,null,null,null,null];
let calculator, lastResult, editSnapshot, lastTouch, revision=0, previewId=0, previewTimer, pickerTarget, pickerRank='A';
const preview=new Worker(new URL('./preview-worker.js',import.meta.url),{type:'module'});
const handSize=()=>game==='holdem'?2:4;
const gameName=()=>({holdem:'Hold’em',omaha:'Omaha high',omaha8:'Omaha Hi-Lo'})[game];
function status(text, error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function stop(){calculator?.dispose();calculator=undefined;$('calculate').disabled=false;$('cancel').hidden=true;}
function invalidate(){revision++;lastResult=undefined;stop();$('progress-panel').hidden=true;status('');$('result-tag').textContent='Ready to calculate';$('results').replaceChildren();renderPlayers();updateAdvancedLink();}
function updateAdvancedLink(){
  try {const ranges=players.map(p=>playerExpression(p,game)).join('\n');$('advanced-link').href='./advanced.html#'+new URLSearchParams({game,ranges,board:board.filter(Boolean).join(''),dead:$('dead').value});}
  catch{$('advanced-link').href='./advanced.html#game='+game;}
}
function description(player){
  if(player.mode==='cards')return player.cards.slice(0,handSize()).map(c=>c||'□').join(' ');
  if(game!=='holdem')return `${player.omaha.builder==='pairs'?'Two-card groups':OMAHA_PRESETS[player.omaha.preset].label} · ${{any:'any suits',double:'double suited',single:'single suited',rainbow:'rainbow',triple:'three suited',monotone:'four suited'}[player.omaha.suitedness]}`;
  if(player.classes.size===169)return 'Any hand';
  const chosen=HAND_CLASSES.filter(h=>player.classes.has(h.text)).map(h=>h.text);
  return chosen.length?chosen.slice(0,4).join(', ')+(chosen.length>4?'…':''):'No hands selected';
}
function coloredCard(card){return create('span',card[0]+SUIT_GLYPHS[SUITS.indexOf(card[1])],`suit-${card[1]} inline-card`);}
function beginEdit(index){
  if($('range-editor').open)return;
  revision++;stop();status('');active=index;
  const p=players[index];editSnapshot={index,player:{...p,rangeSuits:[...p.rangeSuits],classes:new Set(p.classes),cards:[...p.cards],omaha:{...p.omaha,slots:[...p.omaha.slots],rundown:{...p.omaha.rundown,gaps:p.omaha.rundown.gaps.map(g=>[...g])},groups:p.omaha.groups.map(g=>new Set(g))}},result:lastResult};
  showFilters(false);gridSelections.clear();renderSelection();renderPlayers();renderEditor();$('range-editor').showModal();
}
function cancelEdit(){
  if(editSnapshot){players[editSnapshot.index]=editSnapshot.player;lastResult=editSnapshot.result;revision++;if(lastResult)renderResults(lastResult);else{$('results').replaceChildren();$('result-tag').textContent='Ready to calculate';}renderPlayers();renderEditor();updateAdvancedLink();status('');}
  editSnapshot=undefined;$('range-editor').close();
}
function renderPlayers(){
  $('players').replaceChildren();
  playerPage=Math.min(playerPage,Math.floor((players.length-1)/2));
  players.forEach((player,i)=>{
    const row=create('div',undefined,'player-row'),button=create('button',undefined,'player-select');button.type='button';button.dataset.player=i;button.setAttribute('aria-pressed',i===active);
    button.append(create('span',i===0?'H':String(i+1),'avatar'));
    const copy=create('span',undefined,'player-copy'),summary=create('span',description(player));
    if(player.mode==='cards'){summary.replaceChildren(...player.cards.slice(0,handSize()).map(c=>c?coloredCard(c):create('span','□')));summary.classList.add('cards-inline');}
    copy.append(create('strong',player.name),summary);button.append(copy);
    const equity=create('span',undefined,'player-equity'),result=lastResult?.players[i];equity.append(create('strong',result?`${(100*result.equity).toFixed(2)}%`:'—','equity'));
    if(result)equity.append(create('small',`${(100*result.win).toFixed(1)}% ${game==='omaha8'?'scoop':'win'} · ${(100*result.tie).toFixed(1)}% tie`));button.append(equity);
    button.onclick=e=>{active=i;if(e.detail>=2)beginEdit(i);else{document.querySelectorAll('[data-player]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.player)===active));renderEditor();}};
    button.ondblclick=()=>beginEdit(i);
    button.onpointerup=e=>{if(e.pointerType==='touch'){const now=performance.now();if(lastTouch?.index===i&&now-lastTouch.time<400){lastTouch=undefined;beginEdit(i);}else lastTouch={index:i,time:now};}};
    const edit=create('button','Edit','edit-player');edit.type='button';edit.dataset.edit=i;edit.setAttribute('aria-label',`Edit ${player.name} range`);edit.onclick=()=>beginEdit(i);row.append(button,edit);row.dataset.page=Math.floor(i/2);row.classList.toggle('other-page',Math.floor(i/2)!==playerPage);
    if(players.length>2){const remove=create('button','×','remove-player');remove.type='button';remove.setAttribute('aria-label',`Remove ${player.name}`);remove.onclick=()=>{players.splice(i,1);active=Math.min(active,players.length-1);invalidate();renderPlayers();renderEditor();};row.append(remove);}
    $('players').append(row);
  });
  $('player-pages').hidden=players.length<=2;$('player-page').textContent=`${playerPage+1} / ${Math.ceil(players.length/2)}`;$('previous-players').disabled=playerPage===0;$('next-players').disabled=(playerPage+1)*2>=players.length;
  $('player-count').textContent=`${players.length} players`;$('add-player').disabled=players.length>=10;
}
function cardButton(card, label, action){
  const button=create('button',undefined,'playing-card'+(card?'':' empty'));button.type='button';button.setAttribute('aria-label',label+(card?`: ${card}`:''));
  if(card){button.append(create('strong',card[0]),create('span',SUIT_GLYPHS[SUITS.indexOf(card[1])]));button.classList.add(`suit-${card[1]}`);}else button.textContent='＋';
  button.onclick=action;return button;
}
function renderBoard(){
  $('board-cards').replaceChildren(...board.map((card,i)=>cardButton(card,`Board card ${i+1}`,()=>openPicker({type:'board',index:i}))));
  const n=board.filter(Boolean).length;
  $('board-note').textContent=n===0?'Leave empty to calculate preflop.':n<3?'Choose three board cards for the flop.':`${{3:'Flop',4:'Turn',5:'River'}[n]} selected · ${n} community cards`;
}
function renderEditor(){
  const player=players[active];$('range-suits').hidden=player.mode!=='range';
  $('range-suit-slots').querySelectorAll('select').forEach((s,i)=>{s.parentElement.hidden=i>=handSize();s.value=player.rangeSuits[i];});
  $('editor-title').textContent=`${player.name}’s ${player.mode==='cards'?'hand':'range'}`;$('editor-badge').textContent=gameName();
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===player.mode));
  $('exact-editor').hidden=player.mode!=='cards';$('holdem-editor').hidden=player.mode!=='range'||game!=='holdem';$('omaha-editor').hidden=player.mode!=='range'||game==='holdem';
  $('hole-cards').replaceChildren(...player.cards.slice(0,handSize()).map((card,i)=>cardButton(card,`${player.name} card ${i+1}`,()=>openPicker({type:'hole',player:active,index:i}))));
  document.querySelectorAll('[data-hand]').forEach(b=>b.setAttribute('aria-pressed',player.classes.has(b.dataset.hand)));
  document.querySelectorAll('[data-texture]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.texture===player.omaha.preset));
  document.querySelectorAll('[data-suitedness]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.suitedness===player.omaha.suitedness));
  const rundown=game!=='holdem'&&player.mode==='range'&&player.omaha.builder==='family'&&player.omaha.preset==='connected';
  $('show-constraints').hidden=!rundown;$('rundown-controls').hidden=!rundown;
  $('rundown-controls').querySelectorAll('select').forEach(s=>{s.value=s.dataset.high?player.omaha.rundown[s.dataset.high]:player.omaha.rundown.gaps[Number(s.dataset.gap)][Number(s.dataset.bound)];});
  $('rank-slots').hidden=player.omaha.preset!=='custom';$('rank-slots').querySelectorAll('select').forEach((s,i)=>s.value=player.omaha.slots[i]);
  $('texture-detail').textContent=OMAHA_PRESETS[player.omaha.preset].detail;
  $('suit-detail').textContent={any:'No suit restrictions.',double:'Exactly two cards in each of two suits (2 + 2).',single:'One suited pair, plus two different suits (2 + 1 + 1).',rainbow:'Four different suits (1 + 1 + 1 + 1).',triple:'Three cards share a suit, one has another suit (3 + 1).',monotone:'All four cards share a suit (4).'}[player.omaha.suitedness];
  $('omaha-families').hidden=player.omaha.builder!=='family';$('omaha-pairs').hidden=player.omaha.builder!=='pairs';
  document.querySelectorAll('[data-build]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.build===player.omaha.builder));
  document.querySelectorAll('[data-group]').forEach(b=>{const i=Number(b.dataset.group);b.setAttribute('aria-pressed',i===player.omaha.activeGroup);b.textContent=`Group ${i+1} · ${player.omaha.groups[i].size} classes`;});
  document.querySelectorAll('[data-pair-panel]').forEach(e=>e.classList.toggle('inactive',Number(e.dataset.pairPanel)!==player.omaha.activeGroup));
  document.querySelectorAll('[data-group-hand]').forEach(b=>b.setAttribute('aria-pressed',player.omaha.groups[Number(b.dataset.pairGroup)].has(b.dataset.groupHand)));
  document.querySelectorAll('[data-connection]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.connection===player.omaha.connection));
  $('connection-detail').textContent={any:'No extra rank-to-suit restriction.',high:'At least one highest-rank card shares its suit with another card.',ace:'At least one ace shares its suit with another card.',both:'The two highest-rank cards can each be suited in different suits. Tied ranks can use any matching assignment.'}[player.omaha.connection];
  updatePreview();
}
function edited(){invalidate();renderPlayers();renderEditor();}
function updatePreview(){
  clearTimeout(previewTimer);const id=++previewId;$('range-examples').replaceChildren();
  try{
    const expression=playerExpression(players[active],game);$('range-expression').textContent=expression;
    if(game==='holdem'&&players[active].mode==='range'&&!board.some(Boolean)&&!$('dead').value&&!players[active].rangeSuits.some(s=>s!=='*')){const n=holdemCount(players[active].classes);$('range-count').textContent=`${n.toLocaleString()} combinations`;$('range-percent').textContent=` · ${(100*n/1326).toFixed(1)}% of hands`;return;}
    $('range-count').textContent='Counting combinations…';$('range-percent').textContent='';
    const blocked=board.filter(Boolean).join('')+$('dead').value;
    previewTimer=setTimeout(()=>preview.postMessage({id,expression,game,blocked}),180);
  }catch(e){$('range-count').textContent=e.message;$('range-percent').textContent='';$('range-expression').textContent='';}
}
preview.onmessage=({data})=>{
  if(data.id!==previewId)return;
  if(data.error){$('range-count').textContent=data.error;return;}
  $('range-count').textContent=`${data.count.toLocaleString()} combinations`;$('range-percent').textContent=` · ${(100*data.count/(game==='holdem'?1326:270725)).toFixed(2)}% of starting hands`;
  for(const cards of data.examples){const e=create('span',undefined,'example-hand');e.append(...cards.map(coloredCard));e.setAttribute('aria-label',cards.join(' '));$('range-examples').append(e);}
};
function openPicker(target){pickerTarget=target;const value=target.type==='board'?board[target.index]:players[target.player].cards[target.index];pickerRank=value?.[0]||'A';$('picker-title').textContent=target.type==='board'?`Board card ${target.index+1}`:`${players[target.player].name} · card ${target.index+1}`;renderPicker();$('card-picker').showModal();}
function usedCards(){
  const used=new Set(board.filter(Boolean));for(const p of players)if(p.mode==='cards')for(const c of p.cards.slice(0,handSize()))if(c)used.add(c);
  try{for(const id of parseCards($('dead').value))used.add('23456789TJQKA'[Math.floor(id/4)]+SUITS[id%4]);}catch{}
  const current=pickerTarget.type==='board'?board[pickerTarget.index]:players[pickerTarget.player].cards[pickerTarget.index];used.delete(current);return used;
}
function renderPicker(){
  document.querySelectorAll('[data-rank]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.rank===pickerRank));
  const used=usedCards();document.querySelectorAll('[data-suit]').forEach(b=>{b.disabled=used.has(pickerRank+b.dataset.suit);b.setAttribute('aria-label',`Choose ${pickerRank}${b.dataset.suit}`);});
}
function chooseCard(value){if(pickerTarget.type==='board')board[pickerTarget.index]=value;else players[pickerTarget.player].cards[pickerTarget.index]=value;$('card-picker').close();invalidate();renderPlayers();renderBoard();renderEditor();}
function renderResults(result){
  lastResult=result;renderPlayers();
  $('results').replaceChildren();$('result-tag').textContent=result.method==='exact'?'Exact':'Monte Carlo';
  const uncertainty=result.method==='exact'?'All legal outcomes enumerated.':`Largest standard error: ${(100*Math.max(...result.players.map(p=>p.stderr))).toFixed(3)} percentage points.`;
  $('results').append(create('p',`${result.outcomes.toLocaleString()} outcomes · ${result.elapsed.toFixed(2)}s\n${uncertainty}`,'result-meta'));
}
$('calculate').onclick=async()=>{
  invalidate();const version=revision;let instance;
  try{
    const boardText=board.filter(Boolean).join('');if(![0,3,4,5].includes(board.filter(Boolean).length))throw new Error('Choose 0, 3, 4, or 5 board cards.');
    const ranges=Object.fromEntries(players.map(p=>[p.name,playerExpression(p,game)]));
    instance=calculator=new Calculator(ranges,{game,board:boardText,dead:$('dead').value});$('calculate').disabled=true;$('cancel').hidden=false;status('Preparing ranges…');
    $('progress-panel').hidden=false;$('calc-progress').removeAttribute('value');$('progress-label').textContent='Preparing ranges…';
    const result=await instance.equity({method:$('method').value,samples:Number($('samples').value),onProgress:p=>{
      if(revision!==version||calculator!==instance)return;
      if(p.players.length)renderResults(p);
      $('result-tag').textContent=p.target?'Live':'Exact';
      if(p.target){$('calc-progress').value=Number(p.outcomes)/Number(p.target)*100;$('progress-label').textContent=`${p.outcomes.toLocaleString()} / ${p.target.toLocaleString()} samples`;status('Calculating…');}
      else{$('progress-label').textContent='Enumerating exact outcomes…';status('Enumerating…');}
    }});
    if(revision!==version||calculator!==instance)return;renderResults(result);$('calc-progress').value=100;$('progress-label').textContent='Complete';status('');
  }catch(e){if(revision===version){$('progress-panel').hidden=true;$('result-tag').textContent=lastResult?'Incomplete':'Ready to calculate';status(e.message,true);}}
  finally{instance?.dispose();if(calculator===instance)stop();}
};
$('cancel').onclick=()=>{revision++;stop();$('result-tag').textContent=lastResult?'Stopped':'Ready to calculate';$('progress-label').textContent=lastResult?`Stopped after ${lastResult.outcomes.toLocaleString()} samples`:'Stopped';status('Calculation cancelled.');};
$('previous-players').onclick=()=>{playerPage--;renderPlayers();};
$('next-players').onclick=()=>{playerPage++;renderPlayers();};
$('open-options').onclick=()=>$('options-dialog').showModal();$('close-options').onclick=()=>$('options-dialog').close();
function showFilters(filters){
  $('range-editor').classList.remove('show-constraints');$('show-constraints').setAttribute('aria-pressed',false);
  $('range-editor').classList.toggle('show-filters',filters);
  $('show-hands').setAttribute('aria-pressed',!filters);$('show-filters').setAttribute('aria-pressed',filters);
}
$('show-constraints').onclick=()=>{showFilters(false);$('range-editor').classList.add('show-constraints');$('show-hands').setAttribute('aria-pressed',false);$('show-constraints').setAttribute('aria-pressed',true);};
$('show-hands').onclick=()=>showFilters(false);$('show-filters').onclick=()=>showFilters(true);
$('add-player').onclick=()=>{let n=players.length+1;while(players.some(p=>p.name===`Player ${n}`))n++;players.push(makePlayer(`Player ${n}`));active=players.length-1;playerPage=Math.floor(active/2);edited();};
$('clear-board').onclick=()=>{board.fill(null);invalidate();renderBoard();renderEditor();};
$('dead').oninput=()=>{invalidate();updatePreview();};
for(const id of ['method','samples'])$(id).onchange=invalidate;
document.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>{game=b.dataset.game;document.querySelectorAll('[data-game]').forEach(e=>e.setAttribute('aria-pressed',e===b));if(game==='omaha8'&&players[0].omaha.preset==='aces')players[0].omaha.preset='wheel';edited();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{players[active].mode=b.dataset.mode;edited();});
for(const [name,label] of [['premium','Premium'],['balanced','Balanced'],['wide','Wide'],['pairs','Pairs'],['all','All hands'],['clear','Clear']]){const b=create('button',label);b.type='button';b.dataset.preset=name;b.onclick=()=>{players[active].classes=holdemPreset(name);edited();};$('holdem-presets').append(b);}
const gridSelections=new Map();
let gesture;
function selectedCells(grid){if(!gridSelections.has(grid))gridSelections.set(grid,new Set());return gridSelections.get(grid);}
function renderSelection(){
  let total=0;
  for(const grid of document.querySelectorAll('.matrix')){
    const selected=selectedCells(grid);total+=selected.size;
    for(const cell of grid.children)cell.classList.toggle('staged',selected.has(cell));
  }
  $('selection-count').textContent=total?`${total} cells selected`:'Drag or tap to select cells';
  $('add-selection').disabled=$('remove-selection').disabled=!total;
}
function installGrid(grid){
  grid.onpointerdown=e=>{
    const cell=e.target.closest('button');if(!cell||e.button!==0)return;
    e.preventDefault();grid.setPointerCapture(e.pointerId);
    gesture={grid,add:!selectedCells(grid).has(cell),visited:new Set()};visitCell(cell);
  };
  grid.onpointermove=e=>{
    if(!gesture||gesture.grid!==grid)return;
    const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('.matrix button');
    if(cell?.parentElement===grid)visitCell(cell);
  };
  const finish=()=>{gesture=undefined;};grid.onpointerup=finish;grid.onpointercancel=finish;grid.onlostpointercapture=finish;
  // Keyboard activation stages a cell, just like a tap.
  grid.onclick=e=>{if(e.detail!==0)return;const cell=e.target.closest('button');if(!cell)return;const set=selectedCells(grid);set.has(cell)?set.delete(cell):set.add(cell);renderSelection();};
}
function visitCell(cell){
  if(gesture.visited.has(cell))return;gesture.visited.add(cell);
  const set=selectedCells(gesture.grid);gesture.add?set.add(cell):set.delete(cell);renderSelection();
}
function applySelection(add){
  for(const [grid,cells] of gridSelections){
    const target=grid.id==='matrix'?players[active].classes:players[active].omaha.groups[Number(grid.id.slice(-1))];
    for(const cell of cells){const hand=cell.dataset.hand||cell.dataset.groupHand;add?target.add(hand):target.delete(hand);}
    cells.clear();
  }
  edited();renderSelection();
}
$('add-selection').onclick=()=>applySelection(true);$('remove-selection').onclick=()=>applySelection(false);
$('clear-selection').onclick=()=>{gridSelections.clear();renderSelection();};
for(const h of HAND_CLASSES){
  const b=create('button',h.text,h.pair?'pair':h.suited?'suited':'offsuit');b.type='button';b.dataset.hand=h.text;b.setAttribute('aria-label',`${h.text}, ${h.combos} combinations`);$('matrix').append(b);
}
for(const [key,preset] of Object.entries(OMAHA_PRESETS)){const b=create('button',preset.label);b.type='button';b.dataset.texture=key;b.onclick=()=>{players[active].omaha.preset=key;edited();};$('omaha-presets').append(b);}
for(const [key,labelText] of [['highMin','Lowest high card'],['highMax','Highest high card']]){
  const label=create('label',labelText),select=create('select');select.dataset.high=key;select.setAttribute('aria-label',labelText);
  for(const rank of RANKS){const o=create('option',rank);o.value=rank;select.append(o);}
  select.onchange=()=>{players[active].omaha.rundown[key]=select.value;edited();};label.append(select);$('rundown-controls').append(label);
}
for(let gap=0;gap<3;gap++)for(let bound=0;bound<2;bound++){
  const text=`Rank distance ${gap+1} ${bound?'maximum':'minimum'}`,label=create('label',text),select=create('select');select.dataset.gap=gap;select.dataset.bound=bound;select.setAttribute('aria-label',text);
  for(let n=1;n<=12;n++){const o=create('option',String(n));o.value=n;select.append(o);}
  select.onchange=()=>{players[active].omaha.rundown.gaps[gap][bound]=Number(select.value);edited();};label.append(select);$('rundown-controls').append(label);
}
$('rundown-controls').append(create('p','Distance 1 = consecutive ranks; distance 2 = one missing rank. Aces are high.','small muted'));
for(let i=0;i<4;i++){const label=create('label',`Card ${i+1}`),select=create('select');select.setAttribute('aria-label',`Omaha rank slot ${i+1}`);for(const rank of ['*',...RANKS]){const o=create('option',rank==='*'?'Any':rank);o.value=rank;select.append(o);}select.onchange=()=>{players[active].omaha.slots[i]=select.value;edited();};label.append(select);$('rank-slots').append(label);}
for(const [key,label] of [['any','Any suits'],['double','Double suited'],['single','Single suited'],['rainbow','Rainbow'],['triple','Three suited'],['monotone','Four suited']]){const b=create('button',label);b.type='button';b.dataset.suitedness=key;b.onclick=()=>{players[active].omaha.suitedness=key;edited();};$('suitedness').append(b);}
document.querySelectorAll('[data-build]').forEach(b=>b.onclick=()=>{players[active].omaha.builder=b.dataset.build;edited();});
document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{players[active].omaha.activeGroup=Number(b.dataset.group);renderEditor();});
for(const [name,label] of [['highonly','High only'],['highlow','High + low'],['middlemiddle','Middle + middle'],['any','Any hand']]){const b=create('button',label);b.type='button';b.dataset.pairPreset=name;b.onclick=()=>{players[active].omaha.groups=groupPreset(name);edited();};$('pair-presets').append(b);}
for(let group=0;group<2;group++)for(const h of HAND_CLASSES){const b=create('button',h.text,h.pair?'pair':h.suited?'suited':'offsuit');b.type='button';b.dataset.groupHand=h.text;b.dataset.pairGroup=group;b.setAttribute('aria-label',`${h.text} in group ${group+1}`);$(`pair-grid-${group}`).append(b);}
for(const [key,label] of [['any','Any card'],['high','Highest card suited'],['ace','Ace suited'],['both','Top two separately suited']]){const b=create('button',label);b.type='button';b.dataset.connection=key;b.onclick=()=>{players[active].omaha.connection=key;edited();};$('suit-connection').append(b);}
$('pair-grid-size').onclick=()=>{const large=$('range-editor').classList.toggle('large-grid');$('pair-grid-size').textContent=large?'Fit full grids':'Larger targets';};
for(let i=0;i<4;i++){
  const label=create('label',`Suit ${i+1}`),select=create('select');select.setAttribute('aria-label',`Required suit ${i+1}`);
  for(const suit of ['*',...SUITS]){const o=create('option',suit==='*'?'Any':SUIT_GLYPHS[SUITS.indexOf(suit)]+' '+({c:'Clubs',d:'Diamonds',h:'Hearts',s:'Spades'}[suit]));o.value=suit;select.append(o);}
  select.onchange=()=>{players[active].rangeSuits[i]=select.value;edited();};label.append(select);$('range-suit-slots').append(label);
}
for(const rank of RANKS){const b=create('button',rank);b.type='button';b.dataset.rank=rank;b.onclick=()=>{pickerRank=rank;renderPicker();};$('rank-picker').append(b);}
SUITS.forEach((s,i)=>{const b=create('button',SUIT_GLYPHS[i],`suit-${s}`);b.type='button';b.dataset.suit=s;b.onclick=()=>chooseCard(pickerRank+s);$('suit-picker').append(b);});
$('cancel-range').onclick=cancelEdit;$('range-editor').oncancel=e=>{e.preventDefault();cancelEdit();};
$('done-range').onclick=()=>{editSnapshot=undefined;$('range-editor').close();};
$('grid-size').onclick=()=>{const large=$('range-editor').classList.toggle('large-grid');$('grid-size').setAttribute('aria-pressed',large);$('grid-size').textContent=large?'Fit full grid':'Larger targets';};
$('close-picker').onclick=()=>$('card-picker').close();$('clear-card').onclick=()=>chooseCard(null);
window.addEventListener('pagehide',()=>{stop();preview.terminate();});
document.querySelectorAll('.matrix').forEach(installGrid);renderSelection();
renderPlayers();renderBoard();renderEditor();updateAdvancedLink();
