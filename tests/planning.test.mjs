import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor } from '../packages/domain/engine.mjs';
import { trainingPack as pack } from '../packages/content/training.mjs';
import { DecisionClock, decisionKey } from '../packages/application/decision-clock.mjs';
import { GameSession } from '../packages/application/session.mjs';
const act=(s,type,more={})=>dispatch(s,{type,actorId:currentActor(s),...more},pack.definitions);
function plan(chain=true) {
  const s=createGame({productionChain:chain},pack);s.phase='planning';s.production={active:null};
  const p=s.players[0];
  p.cards.push({id:'old',definitionId:'mine',upgraded:false,usedRound:0},{id:'new-a',definitionId:'foundry',upgraded:false,usedRound:0},{id:'new-b',definitionId:'depot',upgraded:false,usedRound:0});
  p.lockedOrder=['start0','old'];return s;
}
test('chain accepts insertion at any position but rejects old-card reversal without mutation',()=>{
  const s=plan(),before=structuredClone(s);
  const next=act(s,'ArrangeCards',{cardIds:['new-b','start0','new-a','old']});
  assert.deepEqual(next.players[0].cards.map(c=>c.id),['new-b','start0','new-a','old']);
  assert.throws(()=>act(next,'ArrangeCards',{cardIds:['new-b','old','new-a','start0']}),e=>e.code==='LOCKED_ORDER');
  assert.deepEqual(s,before);
});
test('planning rejects missing, duplicate and foreign cards; cannot produce before all plans',()=>{
  let s=plan();
  for(const ids of [['old'],['start0','old','new-a','new-a'],['start0','old','new-a','start1']])
    assert.throws(()=>act(s,'ArrangeCards',{cardIds:ids}),e=>e.code==='INVALID_ORDER');
  assert.throws(()=>act(s,'UseCard',{cardId:'start0'}),e=>e.code==='WRONG_PHASE');
  s=act(s,'ConfirmPlan');assert.equal(currentActor(s),'p1');assert.equal(s.phase,'planning');
  s=act(s,'ConfirmPlan');s=act(s,'ConfirmPlan');assert.equal(s.phase,'production');assert.equal(currentActor(s),'p0');
  assert.throws(()=>act(s,'UseCard',{cardId:'old'}),e=>e.code==='CHAIN_ORDER');
});
test('free planning can reorder old cards and production remains free',()=>{
  let s=plan(false);s=act(s,'ArrangeCards',{cardIds:['old','start0','new-b','new-a']});
  for(let i=0;i<3;i++)s=act(s,'ConfirmPlan');
  s=act(s,'UseCard',{cardId:'new-a'});assert.equal(s.production.active.cardId,'new-a');
});
test('timer configuration is explicit and invalid values are rejected',()=>{
  assert.equal(createGame({},pack).config.turnSeconds,0);
  for(const turnSeconds of [-1,0.5,3601,NaN,'30'])assert.throws(()=>createGame({turnSeconds},pack),e=>e.code==='INVALID_CONFIG');
});
test('new cards become fixed relative to the whole line in the following round',()=>{
  let s=plan();s=act(s,'ArrangeCards',{cardIds:['new-b','start0','new-a','old']});
  for(let i=0;i<3;i++)s=act(s,'ConfirmPlan');
  for(const p of s.players){p.done=p.id!=='p0';for(const c of p.cards)c.usedRound=1;}
  s=act(s,'FinishProduction');assert.equal(s.round,2);
  assert.deepEqual(s.players[0].lockedOrder,['new-b','start0','new-a','old']);
  s.phase='planning';s.turn=0;
  assert.throws(()=>act(s,'ArrangeCards',{cardIds:['new-a','start0','new-b','old']}),e=>e.code==='LOCKED_ORDER');
});
test('clock survives reload, expires in background and does not reset within production',()=>{
  let now=1000;const clock=new DecisionClock(()=>now),s=plan();s.config.turnSeconds=10;
  const value=clock.sync(decisionKey(s),10);now=6000;
  const reload=new DecisionClock(()=>now);reload.sync(decisionKey(s),10,value);assert.equal(reload.remaining(),5);
  const moved=act(s,'ArrangeCards',{cardIds:['new-a','start0','old','new-b']});
  reload.sync(decisionKey(moved),10,value);assert.equal(reload.remaining(),5);
  now=15000;assert.equal(reload.remaining(),0);assert.equal(moved.phase,'planning');
  const next=act(moved,'ConfirmPlan');reload.sync(decisionKey(next),10);assert.equal(reload.remaining(),10);
  reload.sync(null,0);assert.equal(reload.remaining(),null);
});
test('production effects share one deadline; each auction bid gets a new decision',()=>{
  let s=createGame({turnSeconds:30},pack),key=decisionKey(s);
  s=act(s,'Bid',{discId:'fixed1',lotId:s.lots[0].id});assert.notEqual(decisionKey(s),key);
  s.phase='production';s.production={active:null};key=decisionKey(s);
  s=act(s,'UseCard',{cardId:s.players[s.turn].cards[0].id});assert.equal(decisionKey(s),key);
  s=act(s,'Convert',{times:1});assert.equal(decisionKey(s),key);
});
test('legacy save continues without injecting planning midway through replay',()=>{
  const record={schemaVersion:1,rulesVersion:'prototype-0.1',contentVersion:pack.version,options:{seed:1},commands:[]};
  let saved;const session=new GameSession(pack,{load:()=>record,save:r=>{saved=structuredClone(r)}});
  session.load();assert.equal(session.state.config.planning,false);
  session.send({type:'Bid',actorId:'p0',discId:'fixed1',lotId:session.state.lots[0].id});
  const reloaded=new GameSession(pack,{load:()=>saved,save:()=>{}});reloaded.load();
  assert.deepEqual(reloaded.state,session.state);
});
