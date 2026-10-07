import { parseRange, RANKS, SUITS } from './ranges.js';
self.onmessage = ({data:{id,expression,game,blocked}}) => {
  try {
    const range=parseRange(expression,{game,blocked});
    const examples=range.entries.slice(0,3).map(([mask])=>{
      const cards=[]; const bits=BigInt(mask);
      for(let i=0;i<52;i++)if(bits & 1n<<BigInt(i))cards.push(RANKS[Math.floor(i/4)]+SUITS[i%4]);
      return cards;
    });
    self.postMessage({id,count:range.size,examples});
  }catch(error){self.postMessage({id,error:error.message});}
};
