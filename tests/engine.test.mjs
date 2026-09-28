import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, activeEffect, bidError } from '../packages/domain/engine.mjs';
import { rankPlayers, emptyWallet, classifyConversion } from '../packages/domain/rules.mjs';
import { trainingPack as pack } from '../packages/content/training.mjs';
import { GameSession, restore } from '../packages/application/session.mjs';
import { localStorageAdapter } from '../packages/adapters/local-storage.mjs';
const defs=pack.definitions;
const game=(options={})=>createGame({planning:false,...options},pack);
const act=(s,type,payload={})=>dispatch(s,{type,actorId:currentActor(s),...payload},defs);
const fails=(s,type,payload,code)=>{
  const before=JSON.stringify(s);
  assert.throws(()=>act(s,type,payload),e=>e.code===code);
  assert.equal(JSON.stringify(s),before,'Rejected command must not mutate the input');
};
function productionState() {
  const s=game(); s.phase='production'; s.turn=0; s.production={active:null};
  s.players[0].cards.push({id:'test-mine',definitionId:'mine',upgraded:false,usedRound:0});
  s.players[0].wallet={...emptyWallet(),coal:10,metal:5,upgrade:2}; return s;
}
function settlementState() {
  const s=game(); s.phase='settlement'; s.settlement={index:0,cursor:0,queue:null,pending:null};
  s.lots=[
    {id:'l0',card:{id:'m1',definitionId:'mine',upgraded:false,usedRound:0},bids:[{playerId:'p0',value:2},{playerId:'p1',value:4}],resolved:false},
    {id:'l1',card:{id:'r1',definitionId:'refinery',upgraded:false,usedRound:0},bids:[{playerId:'p0',value:3},{playerId:'p1',value:4}],resolved:false},
  ]; return s;
}
test('setup deals 7 lots, independent instances, starts only once',()=>{
  const s=game(); assert.equal(s.lots.length,7); assert.equal(s.players[0].wallet.coal,3);
  assert.equal(new Set(s.players.map(p=>p.cards[0].id)).size,3);
  assert.deepEqual(s.players[0].discs.map(d=>d.value),[1,2,3,4]);
});
test('deterministic seed produces exactly the same state',()=>assert.deepEqual(game({seed:97}),game({seed:97})));
test('unsupported two player mode is rejected rather than silently omitting agent',()=>assert.throws(()=>game({names:['A','B']}),e=>e.code==='UNSUPPORTED_CONFIG'));
test('unknown effect is not ignored',()=>{
  const bad=structuredClone(pack); bad.definitions.mine.effects=[{kind:'supply'}];
  assert.throws(()=>createGame({},bad),e=>e.code==='UNSUPPORTED_EFFECT');
});
test('wrong player and stale revision leave state untouched',()=>{
  const s=game(); fails(s,'Bid',{actorId:'p1',discId:'fixed1',lotId:s.lots[0].id},'NOT_YOUR_TURN');
  fails(s,'Bid',{expectedRevision:20,discId:'fixed1',lotId:s.lots[0].id},'STALE_REVISION');
});
test('same value forbidden; lower bids allowed; same owner forbidden',()=>{
  let s=game(); const id=s.lots[0].id;
  s=act(s,'Bid',{discId:'fixed3',lotId:id});
  fails(s,'Bid',{discId:'fixed3',lotId:id},'ILLEGAL_BID');
  s=act(s,'Bid',{discId:'fixed1',lotId:id});
  s=act(s,'Bid',{discId:'fixed2',lotId:s.lots[1].id});
  fails(s,'Bid',{discId:'fixed4',lotId:id},'ILLEGAL_BID');
});
test('used disc and unknown target are rejected',()=>{
  let s=game(); const id=s.lots[0].id;
  s=act(s,'Bid',{discId:'fixed1',lotId:id});
  s=act(s,'Bid',{discId:'fixed2',lotId:id}); s=act(s,'Bid',{discId:'fixed3',lotId:id});
  fails(s,'Bid',{discId:'fixed1',lotId:s.lots[1].id},'ILLEGAL_BID');
  fails(s,'Bid',{discId:'fixed4',lotId:'missing'},'ILLEGAL_BID');
});
test('variable module adds coal, disc and one lot; bid zero is legal',()=>{
  let s=game({variableCapital:true}); assert.equal(s.lots.length,8); assert.equal(s.players[0].wallet.coal,4);
  s=act(s,'Bid',{discId:'variable',lotId:s.lots[0].id,value:0}); assert.equal(s.lots[0].bids[0].value,0); assert.equal(s.players[0].wallet.coal,4);
});
test('variable value above 9 pays coal immediately and remains variable',()=>{
  let s=game({variableCapital:true}); s.players[0].wallet.coal=12;
  s=act(s,'Bid',{discId:'variable',lotId:s.lots[0].id,value:11});
  assert.equal(s.players[0].wallet.coal,1); assert.equal(s.lots[0].bids[0].kind,'variable');
});
test('invalid variable values cannot spend resources',()=>{
  const s=game({variableCapital:true});
  for(const value of [-1,1.5,NaN,Infinity,5]) fails(s,'Bid',{discId:'variable',lotId:s.lots[0].id,value},'ILLEGAL_BID');
});
test('lot resolves compensation before award, winner gets no compensation',()=>{
  let s=settlementState(); const before=s.players.map(p=>p.wallet.coal);
  s=act(s,'ResolveLot'); assert.equal(s.players[0].wallet.coal,before[0]+4); assert.equal(s.players[1].wallet.coal,before[1]);
  assert.equal(s.players[1].cards.at(-1).id,'m1');
  assert.deepEqual(s.events.slice(-2).map(e=>e.type),['Compensation','CardWon']); assert.equal(s.settlement.index,1);
});
test('left lot gain funds right lot conversion; settlement blocks for choice',()=>{
  let s=settlementState(); s.lots[0].card.definitionId='works'; // one coal compensation
  s.lots[1].card.definitionId='refinery'; s.players[0].wallet.metal=2;
  s=act(s,'ResolveLot'); s=act(s,'ResolveLot'); assert.equal(currentActor(s),'p0');
  assert.equal(s.settlement.pending.limit,3); assert.equal(s.players[1].cards.length,2);
  fails(s,'ResolveLot',{},'CHOICE_REQUIRED');
  fails(s,'Compensate',{times:3},'INSUFFICIENT_RESOURCES');
  s=act(s,'Compensate',{times:2}); assert.equal(s.players[0].wallet.oil,2); assert.equal(s.phase,'production');
});
test('resources from earlier lots may be used by later compensation',()=>{
  let s=settlementState(); s.players[0].wallet.metal=0; s.lots[0].card.definitionId='foundry';
  s=act(s,'ResolveLot'); assert.equal(s.players[0].wallet.metal,2);
  s=act(s,'ResolveLot'); s=act(s,'Compensate',{times:2}); assert.equal(s.players[0].wallet.oil,2);
});
test('zero losing bid gains nothing; sole zero bid wins',()=>{
  let s=settlementState(); s.lots[0].bids[0].value=0; s=act(s,'ResolveLot'); assert.equal(s.players[0].wallet.coal,3);
  s=settlementState(); s.lots[0].bids=[{playerId:'p0',value:0}]; s=act(s,'ResolveLot'); assert.equal(s.players[0].cards.at(-1).id,'m1');
});
test('empty lot is discarded',()=>{let s=settlementState();s.lots[0].bids=[];s=act(s,'ResolveLot');assert.equal(s.discard[0].id,'m1');});
test('compensation may be declined',()=>{
  let s=settlementState();s=act(s,'ResolveLot');s=act(s,'ResolveLot');s=act(s,'Compensate',{times:0});assert.equal(s.players[0].wallet.oil,0);
});
test('mandatory gain happens once and unupgraded advanced effect stays inactive',()=>{
  let s=productionState();s=act(s,'UseCard',{cardId:'test-mine'});assert.equal(s.players[0].wallet.coal,13);
  assert.equal(s.production.active,null);fails(s,'UseCard',{cardId:'test-mine'},'CARD_USED');
});
test('card effects cannot interleave and startup cannot upgrade before previous row',()=>{
  let s=productionState();s=act(s,'UseCard',{cardId:'start0'});
  assert.equal(s.players[0].wallet.upgrade,3);assert.equal(activeEffect(s,defs).kind,'convert');
  fails(s,'UseCard',{cardId:'test-mine'},'CARD_ACTIVE');fails(s,'Upgrade',{cardId:'test-mine'},'WRONG_EFFECT');
});
test('conversion is optional, each operation logged, limit enforced',()=>{
  let s=productionState();s=act(s,'UseCard',{cardId:'start0'});s=act(s,'Convert',{times:2});
  assert.equal(s.players[0].wallet.money,4);assert.equal(s.events.filter(e=>e.type==='ConversionPerformed').length,2);
  fails(s,'Convert',{times:1},'INVALID_COUNT');
  s=act(s,'NextEffect');assert.equal(activeEffect(s,defs).kind,'upgrade');
});
test('upgrade costs one coal and token, startup cannot upgrade',()=>{
  let s=productionState();s=act(s,'UseCard',{cardId:'start0'});s=act(s,'NextEffect');
  fails(s,'Upgrade',{cardId:'start0'},'CANNOT_UPGRADE');
  s=act(s,'Upgrade',{cardId:'test-mine'});assert.equal(s.players[0].wallet.coal,9);assert.equal(s.players[0].wallet.upgrade,2);
  fails(s,'Upgrade',{cardId:'test-mine'},'CANNOT_UPGRADE');
  s=act(s,'NextEffect');s=act(s,'UseCard',{cardId:'test-mine'});assert.equal(activeEffect(s,defs).kind,'convert');
});
test('upgrading used company does not allow reuse',()=>{
  let s=productionState();s=act(s,'UseCard',{cardId:'test-mine'});s=act(s,'UseCard',{cardId:'start0'});s=act(s,'NextEffect');
  s=act(s,'Upgrade',{cardId:'test-mine'});s=act(s,'NextEffect');fails(s,'UseCard',{cardId:'test-mine'},'CARD_USED');
});
test('production cannot end while unused cards remain',()=>fails(productionState(),'FinishProduction',{},'CARDS_REMAIN'));
test('conversion classifications can include sale and exchange simultaneously',()=>assert.deepEqual(classifyConversion({gain:{money:1,coal:1}}),{sale:true,exchange:true}));
test('ranking compares money, companies, resources including upgrade tokens; exact ties shared',()=>{
  const p=(id,money,cards,upgrade)=>({id,name:id,wallet:{...emptyWallet(),money,upgrade},cards:Array(cards).fill({})});
  let result=rankPlayers([p('a',9,5,8),p('b',10,2,0),p('c',10,3,1),p('d',10,3,2)]);assert.equal(result[0].id,'d');
  result=rankPlayers([p('a',5,1,1),p('b',5,1,1)]);assert.ok(result.every(r=>r.winner));
});
function runFull(options) {
  let s=game(options), steps=0; const commands=[];
  while(s.phase!=='finished' && steps++<3000) {
    const p=s.players.find(p=>p.id===currentActor(s));let command;
    if(s.phase==='auction') {
      outer:for(const d of p.discs.filter(d=>!d.used)) for(const lot of s.lots) {
        const values=d.kind==='variable'?Array.from({length:p.wallet.coal+1},(_,i)=>i):[d.value];
        for(const value of values) if(!bidError(s,p.id,d.id,lot.id,value)){command={type:'Bid',discId:d.id,lotId:lot.id,value};break outer;}
      }
      assert.ok(command,'There must be a legal bid for the current actor');
    } else if(s.phase==='settlement') command=s.settlement.pending?{type:'Compensate',times:0}:{type:'ResolveLot'};
    else if(s.phase==='planning') command={type:'ConfirmPlan'};
    else if(s.production.active) command={type:'NextEffect'};
    else {const card=p.cards.find(c=>c.usedRound!==s.round);command=card?{type:'UseCard',cardId:card.id}:{type:'FinishProduction'};}
    command.actorId=p.id; commands.push(command); s=dispatch(s,command,defs);
    for(const p of s.players) for(const v of Object.values(p.wallet)) assert.ok(v>=0&&Number.isSafeInteger(v));
  }
  assert.equal(s.phase,'finished');assert.equal(s.round,4);assert.equal(s.events.filter(e=>e.type==='AuctionStarted').length,4);
  assert.equal(s.firstPlayer,3%s.players.length);assert.equal(new Set(s.players.flatMap(p=>p.cards.map(c=>c.id))).size,s.players.reduce((n,p)=>n+p.cards.length,0));
  return {s,commands};
}
for(const n of [3,4]) for(const variableCapital of [false,true]) test(`full four-round run: ${n} players, variable=${variableCapital}`,()=>{
  const options={names:Array.from({length:n},(_,i)=>`P${i}`),variableCapital,seed:9,planning:false};const {s,commands}=runFull(options);
  assert.deepEqual(restore({schemaVersion:1,rulesVersion:s.rulesVersion,contentVersion:pack.version,options,commands},pack),s);
});
for(const productionChain of [false,true]) test(`full planned game and replay, chain=${productionChain}`,()=>{
  const options={planning:true,productionChain,turnSeconds:30,seed:12};const {s,commands}=runFull(options);
  assert.equal(s.events.filter(e=>e.type==='PlanningStarted').length,4);
  assert.deepEqual(restore({schemaVersion:1,rulesVersion:s.rulesVersion,contentVersion:pack.version,options,commands},pack),s);
});
test('session roundtrip and invalid commands do not enter history',()=>{
  let data=null;const storage={load:()=>data,save:value=>{data=structuredClone(value)}};
  const a=new GameSession(pack,storage);a.start({seed:18});
  a.send({type:'Bid',actorId:'p0',discId:'fixed1',lotId:a.state.lots[0].id});
  assert.throws(()=>a.send({type:'Unknown',actorId:'p1'}));assert.equal(data.commands.length,1);
  const b=new GameSession(pack,storage);b.load();assert.deepEqual(b.state,a.state);
});
test('unknown save version and corrupt JSON are rejected without overwriting',()=>{
  assert.throws(()=>restore({schemaVersion:2},pack));
  let saved=false;const adapter=localStorageAdapter({getItem:()=>'{broken',setItem:()=>{saved=true}});
  assert.throws(()=>adapter.load());assert.equal(saved,false);
});
test('storage quota failure is visible but does not discard live game',()=>{
  const s=new GameSession(pack,{load:()=>null,save:()=>{throw new Error('quota')}});s.start({});assert.ok(s.state);assert.ok(s.storageError);
});
