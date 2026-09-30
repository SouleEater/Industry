// Число лотов и университетов по числу игроков и игра впятером.
// Источники: правила базы, стр. 4 (2 — 6 карт, 3 — 7, 4 — 8); правила «Интербеллума»,
// стр. 6 (университеты: на 1–3 игроков две карты, на 4–5 — три), стр. 9 (без управляющих,
// но с переменным капиталом — на одну карту больше), стр. 10 (впятером — 9 карт и 3 жетона,
// пятый игрок выбирает из 2 стартовых предприятий и 2 промышленников).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor } from '../packages/domain/engine.mjs';
import { basePack } from '../packages/content/base-pack.mjs';

const defs = basePack.definitions;
const names = n => Array.from({ length: n }, (_, i) => `И${i + 1}`);
const count = (s, kind) => s.lots.filter(l => l.kind === kind).length;
function start(n, options = {}) {
  let s = createGame({ names: names(n), seed: 11, ...options }, basePack);
  if (s.phase === 'choosing')
    s = dispatch(s, { type: 'ChooseStart', actorId: 'p4', startupId: s.choice.startups?.[0], capitalistId: s.choice.capitalists?.[0] }, defs);
  return s;
}

test('карт в ряду: игроков + 4', () => {
  for (const [n, lots] of [[2, 6], [3, 7], [4, 8], [5, 9]]) {
    assert.equal(count(start(n), 'company'), lots, `${n} игроков`);
    assert.equal(count(start(n, { expansion: true }), 'company'), lots, `${n} игроков с «Интербеллумом»`);
  }
});

test('университетов: 2 на 2–3 игроков, 3 на 4–5', () => {
  for (const [n, unis] of [[2, 2], [3, 2], [4, 3], [5, 3]]) {
    const s = start(n, { universities: true });
    assert.equal(count(s, 'university'), unis, `${n} игроков`);
    assert.ok(s.lots.slice(-unis).every(l => l.kind === 'university'), 'университеты в конце ряда');
    assert.ok(s.lots.filter(l => l.kind === 'university').every(l => l.token), 'на каждом жетон управляющего');
  }
});

test('переменный капитал добавляет карту только без управляющих', () => {
  for (const n of [2, 3, 4, 5]) {
    assert.equal(count(start(n, { variableCapital: true }), 'company'), n + 5);
    assert.equal(count(start(n, { variableCapital: true, universities: true }), 'company'), n + 4);
  }
});

test('шесть игроков не поддерживаются', () => {
  assert.throws(() => createGame({ names: names(6) }, basePack), /от 2 до 5/);
});

test('впятером пятый игрок выбирает стартовое предприятие и промышленника', () => {
  let s = createGame({ names: names(5), seed: 5, expansion: true, capitalists: true, universities: true }, basePack);
  assert.equal(s.phase, 'choosing');
  assert.equal(currentActor(s), 'p4', 'выбирает тот, кто ходит пятым');
  assert.equal(s.choice.startups.length, 2);
  assert.equal(s.choice.capitalists.length, 2);
  const others = s.players.slice(0, 4);
  for (const id of s.choice.startups) assert.ok(!others.some(p => p.cards[0].definitionId === id), 'варианты не заняты другими');
  for (const id of s.choice.capitalists) assert.ok(!others.some(p => p.capitalistId === id));
  assert.throws(() => dispatch(s, { type: 'ChooseStart', actorId: 'p0', startupId: s.choice.startups[0], capitalistId: s.choice.capitalists[0] }, defs));
  assert.throws(() => dispatch(s, { type: 'ChooseStart', actorId: 'p4', startupId: 'user-start-99', capitalistId: s.choice.capitalists[0] }, defs), /одно из двух/);
  const [st, cap] = [s.choice.startups[1], s.choice.capitalists[1]];
  s = dispatch(s, { type: 'ChooseStart', actorId: 'p4', startupId: st, capitalistId: cap }, defs);
  const p = s.players[4];
  assert.equal(s.phase, 'auction');
  assert.equal(p.cards[0].definitionId, st);
  assert.equal(p.capitalistId, cap);
  assert.deepEqual(Object.entries(defs[st].starting).filter(([k]) => k !== 'coal'),
    Object.entries(p.wallet).filter(([k, v]) => v > 0 && k !== 'coal'), 'ресурсы выбранного стартового предприятия');
  assert.equal(count(s, 'company'), 9);
  assert.equal(count(s, 'university'), 3);
  assert.equal(currentActor(s), 'p0', 'аукцион начинает первый игрок');
});

test('без лишних карт пятому выбирать не из чего: партия начинается сразу', () => {
  const s = createGame({ names: names(5), seed: 5, capitalists: true }, basePack);
  assert.equal(s.phase, 'auction');
  assert.equal(new Set(s.players.map(p => p.capitalistId)).size, 5);
});

/** Случайная, но легальная партия со всеми модулями дополнения. */
function autoplayFull(options, seed) {
  let rs = seed >>> 0;
  const rnd = n => { rs = (Math.imul(1664525, rs) + 1013904223) >>> 0; return Math.floor(rs / 4294967296 * n); };
  let s = createGame({ ...options, seed }, basePack);
  const go = c => { s = dispatch(s, { ...c, actorId: currentActor(s), expectedRevision: s.revision }, defs); };
  const tryGo = c => { try { go(c); return true; } catch { return false; } };
  for (let guard = 0; s.phase !== 'finished'; guard++) {
    assert.ok(guard < 30000, `зацикливание на фазе ${s.phase}`);
    const me = s.players.find(p => p.id === currentActor(s));
    if (s.phase === 'choosing') { go({ type: 'ChooseStart', startupId: s.choice.startups?.[rnd(2)], capitalistId: s.choice.capitalists?.[rnd(2)] }); continue; }
    if (s.phase === 'auction') {
      const moves = [];
      for (const d of me.discs.filter(d => !d.used)) {
        const values = d.kind === 'variable' ? [0, 1, 2].filter(v => v <= me.wallet.coal) : [d.value];
        for (const l of s.lots) for (const v of values) moves.push({ type: 'Bid', discId: d.id, lotId: l.id, value: v });
      }
      const legal = moves.filter(m => { try { dispatch(s, { ...m, actorId: me.id }, defs); return true; } catch { return false; } });
      if (legal.length && !(s.pendingPair?.playerId === me.id && rnd(3) === 0)) go(legal[rnd(legal.length)]);
      else go({ type: 'SkipPair' });
      continue;
    }
    if (s.phase === 'settlement') {
      const pend = s.settlement.pending;
      if (!pend) { go({ type: 'ResolveLot' }); continue; }
      const picks = pend.options.map(() => 0);
      if (rnd(2)) picks[0] = 1;
      if (!tryGo({ type: 'Compensate', picks })) go({ type: 'Compensate', picks: pend.options.map(() => 0) });
      continue;
    }
    if (s.phase === 'planning') {
      if (me.managers.length && rnd(2)) {
        const cards = me.cards.map(c => c.id);
        tryGo({ type: 'PlaceManagers', assignments: me.managers.slice(0, cards.length).map((token, i) => ({ token, cardId: cards[i] })) });
      }
      go({ type: 'ConfirmPlan' }); continue;
    }
    // производство
    if (s.supplies?.some(x => x.playerId === me.id)) { if (!tryGo({ type: 'TakeSupply', times: 1 })) go({ type: 'TakeSupply', times: 0 }); continue; }
    const a = s.production.active;
    if (a?.compensationLeft) { if (!(rnd(2) && tryGo({ type: 'UseOwnCompensation', times: 1 }))) go({ type: 'UseOwnCompensation', times: 0 }); continue; }
    if (a) {
      const d = defs[me.cards.find(c => c.id === a.cardId).definitionId];
      void d;
      if (rnd(2) && tryGo({ type: 'Convert', times: 1 })) continue;
      const target = me.cards.find(c => !c.upgraded && defs[c.definitionId].kind === 'company' && !c.borrowed);
      if (target && rnd(2) && tryGo({ type: 'Upgrade', cardId: target.id })) continue;
      go({ type: 'NextEffect' }); continue;
    }
    const next = me.cards.find(c => c.usedRound !== s.round);
    if (next) { go({ type: 'UseCard', cardId: next.id }); continue; }
    if (me.ability === 'use-neighbour-card' && !me.neighbourUsed && me.wallet.metal > 0 && rnd(2)) {
      const humans = s.players.filter(x => !x.agent);
      const right = humans[(humans.indexOf(me) - 1 + humans.length) % humans.length];
      const card = right.cards.find(c => defs[c.definitionId].kind === 'company');
      if (card && tryGo({ type: 'UseNeighbourCard', cardId: card.id })) continue;
    }
    go({ type: 'FinishProduction' });
  }
  return s;
}

for (const n of [2, 3, 4, 5]) {
  test(`полная партия с «Интербеллумом» и всеми модулями: ${n} игроков`, () => {
    for (let run = 0; run < 4; run++) {
      const s = autoplayFull({ names: names(n), expansion: true, universities: true, capitalists: true, variableCapital: true, productionChain: run % 2 === 1 }, 900 + n * 37 + run * 101);
      assert.equal(s.round, 4);
      assert.equal(s.result.length, n);
      for (const p of s.players) for (const [k, v] of Object.entries(p.wallet)) assert.ok(Number.isSafeInteger(v) && v >= 0, `${p.name}: ${k}=${v}`);
    }
  });
}
