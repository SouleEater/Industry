import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, bidError, activeEffect } from '../packages/domain/engine.mjs';
import { canPay } from '../packages/domain/rules.mjs';
import { basePack } from '../packages/content/base-pack.mjs';
import { userBaseCatalog } from '../packages/content/user-base-catalog.mjs';

const defs = basePack.definitions;

test('пакет выведен из каталога и ничего не придумывает', () => {
  assert.equal(basePack.officialVerified, false);
  assert.equal(basePack.provenance, 'user-supplied-layouts');
  assert.equal(basePack.deck.length, userBaseCatalog.entries.filter(e => e.kind === 'company').length);
  assert.equal(basePack.startupIds.length, 5);
  assert.equal(basePack.capitalists.length, 5);
  assert.equal(basePack.observedCompanies, 31);
  assert.equal(basePack.missingCompanies, 5, 'до полной базы не хватает пяти предприятий');
});

test('улучшенная сторона — это обычные строки плюс добавленные', () => {
  for (const entry of userBaseCatalog.entries.filter(e => e.kind === 'company')) {
    const d = defs[entry.id];
    assert.equal(d.effects.length + d.advanced.length, entry.upgraded.length, entry.id);
    assert.ok(d.effects.length > 0, entry.id);
  }
});

test('ненапечатанная кратность превращается в ×1 и помечается', () => {
  const flagged = basePack.deck.filter(id => defs[id].unknownLimit);
  assert.equal(flagged.length, 2, 'в каталоге ровно две такие карты');
  assert.equal(basePack.unknownLimitCards, 2);
  for (const id of flagged) {
    const rows = [...defs[id].effects, ...defs[id].advanced].filter(e => e.limitUnknown);
    assert.ok(rows.length > 0);
    for (const r of rows) assert.equal(r.limit, 1);
  }
});

test('у каждой карты есть картинки обеих сторон', () => {
  for (const id of basePack.deck) assert.equal(defs[id].images.length, 2, id);
  for (const id of basePack.startupIds) assert.equal(defs[id].images.length, 1, id);
});

test('игроки получают разные стартовые предприятия', () => {
  const s = createGame({ names: ['А', 'Б', 'В', 'Г'], seed: 5 }, basePack);
  const ids = s.players.map(p => p.cards[0].definitionId);
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.equal(defs[id].kind, 'startup');
});

test('каждый промышленник достаётся только одному игроку', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = createGame({ names: ['А', 'Б', 'В', 'Г'], seed, capitalists: true }, basePack);
    const ids = s.players.map(p => p.capitalistId);
    assert.equal(new Set(ids).size, 4, `seed ${seed}`);
    assert.ok(s.players.every(p => p.ability));
  }
});

test('короткого каталога хватает на партию за счёт возврата невыкупленных лотов', () => {
  const s = createGame({ names: ['А', 'Б', 'В', 'Г'], seed: 11 }, basePack);
  assert.equal(s.config.deckCoversGame, false, 'вчетвером 31 карты на четыре раунда не хватает');
  assert.equal(s.lots.length, 8);
});

test('совсем короткая колода по-прежнему отвергается', () => {
  const tiny = { ...basePack, deck: basePack.deck.slice(0, 3) };
  assert.throws(() => createGame({ names: ['А', 'Б', 'В'] }, tiny), e => e.code === 'SHORT_DECK');
});

/* ---------- фаззинг целых партий ---------- */
function autoplay(options, seed) {
  let rs = seed >>> 0;
  const rnd = n => { rs = (Math.imul(1664525, rs) + 1013904223) >>> 0; return Math.floor(rs / 4294967296 * n); };
  let s = createGame({ ...options, seed }, basePack);
  const go = c => { s = dispatch(s, { ...c, actorId: currentActor(s), expectedRevision: s.revision }, defs); };
  let guard = 0;

  while (s.phase !== 'finished') {
    assert.ok(++guard < 20000, `партия зациклилась на фазе ${s.phase}`);
    const me = s.players.find(p => p.id === currentActor(s));

    if (s.phase === 'auction') {
      const moves = [];
      for (const d of me.discs) {
        if (d.used) continue;
        const values = d.kind === 'variable'
          ? Array.from({ length: Math.min(me.wallet.coal, 5) + 1 }, (_, i) => i)
          : [d.value];
        for (const l of s.lots) for (const v of values)
          if (!bidError(s, me.id, d.id, l.id, v)) moves.push({ type: 'Bid', discId: d.id, lotId: l.id, value: v });
      }
      if (moves.length) go(moves[rnd(moves.length)]);
      else if (s.pendingPair?.playerId === me.id) go({ type: 'SkipPair' });
      else assert.fail('ставить некуда, но аукцион не закрылся');
      continue;
    }
    if (s.phase === 'settlement') {
      const pend = s.settlement.pending;
      if (!pend) { go({ type: 'ResolveLot' }); continue; }
      let max = 0;
      for (let t = pend.limit; t >= 1; t--) if (canPay(me.wallet, pend.effect.cost, t)) { max = t; break; }
      go({ type: 'Compensate', times: rnd(max + 1) });
      continue;
    }
    if (s.phase === 'planning') { go({ type: 'ConfirmPlan' }); continue; }

    const active = s.production.active;
    if (!active) {
      if (me.ability === 'repeat-card' && !me.repeated && me.wallet.coal >= 2 && rnd(3) === 0) {
        const done = me.cards.filter(c => c.usedRound === s.round);
        if (done.length) { go({ type: 'RepeatCard', cardId: done[rnd(done.length)].id }); continue; }
      }
      const free = me.cards.filter(c => c.usedRound !== s.round);
      if (!free.length) { go({ type: 'FinishProduction' }); continue; }
      go({ type: 'UseCard', cardId: (s.config.productionChain ? free[0] : free[rnd(free.length)]).id });
      continue;
    }
    const e = activeEffect(s, defs);
    assert.ok(e, 'активная карта без эффекта');
    if (e.kind === 'upgrade') {
      const targets = me.cards.filter(c => !c.upgraded && defs[c.definitionId].kind === 'company');
      const cost = me.wallet.upgrade > 0 || me.ability !== 'metal-for-upgrade'
        ? { coal: 1, upgrade: 1 } : { coal: 1, metal: 1 };
      if (targets.length && canPay(me.wallet, cost) && rnd(2)) go({ type: 'Upgrade', cardId: targets[rnd(targets.length)].id });
      else go({ type: 'NextEffect' });
      continue;
    }
    let max = 0;
    for (let t = e.limit - active.used; t >= 1; t--) if (canPay(me.wallet, e.cost, t)) { max = t; break; }
    if (max && rnd(4)) go({ type: 'Convert', times: 1 + rnd(max) });
    else go({ type: 'NextEffect' });
  }
  return s;
}

const combos = [];
for (const players of [3, 4])
  for (const productionChain of [false, true])
    for (const variableCapital of [false, true])
      for (const capitalists of [false, true])
        combos.push({ names: Array.from({ length: players }, (_, i) => `И${i + 1}`), productionChain, variableCapital, capitalists });

for (const options of combos) {
  const label = `${options.names.length} игрока, цепочка ${options.productionChain ? 'да' : 'нет'},`
    + ` переменный капитал ${options.variableCapital ? 'да' : 'нет'}, промышленники ${options.capitalists ? 'да' : 'нет'}`;
  test(`партия доигрывается до конца: ${label}`, () => {
    for (let run = 0; run < 6; run++) {
      const s = autoplay(options, 7000 + run * 131 + combos.indexOf(options) * 17);
      assert.equal(s.round, 4);
      assert.equal(s.result.length, options.names.length);
      assert.ok(s.result.some(r => r.winner));
      for (const p of s.players)
        for (const [k, v] of Object.entries(p.wallet))
          assert.ok(Number.isSafeInteger(v) && v >= 0, `${p.name}: ${k} = ${v}`);
    }
  });
}

test('за фаззингом все пять способностей действительно срабатывают', () => {
  const seen = new Set();
  for (let run = 0; run < 24; run++) {
    const s = autoplay({ names: ['А', 'Б', 'В', 'Г'], capitalists: true }, 4100 + run * 53);
    for (const e of s.events) if (['CardRepeated', 'PairRequired'].includes(e.type)) seen.add(e.type);
    for (const p of s.players) seen.add(p.ability);
  }
  for (const a of ['repeat-card', 'compensation-plus-one', 'unrestricted-bids', 'paired-extra-disc', 'metal-for-upgrade'])
    assert.ok(seen.has(a), `способность ${a} ни разу не раздалась`);
  assert.ok(seen.has('CardRepeated'), 'повтор Эвариста ни разу не сработал');
  assert.ok(seen.has('PairRequired'), 'парная ставка Артура ни разу не потребовалась');
});
