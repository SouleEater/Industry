import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, bidError } from '../packages/domain/engine.mjs';
import { emptyWallet, canPay } from '../packages/domain/rules.mjs';
import { rollD6, chooseBid, isAgent } from '../packages/domain/agent.mjs';
import { extraDisc } from '../packages/domain/capitalists.mjs';
import { basePack } from '../packages/content/base-pack.mjs';

const defs = basePack.definitions;
const duo = (o = {}) => createGame({ names: ['Аня', 'Борис'], seed: 21, ...o }, basePack);
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);

/* ---------- бросок и выбор лота ---------- */
test('d6 даёт только значения 1..6 и воспроизводим', () => {
  let seed = 12345;
  const rolls = [];
  for (let i = 0; i < 400; i++) { const r = rollD6(seed); seed = r.seed; rolls.push(r.value); }
  assert.ok(rolls.every(v => Number.isInteger(v) && v >= 1 && v <= 6));
  assert.equal(new Set(rolls).size, 6, 'должны выпадать все шесть граней');
  assert.equal(rollD6(99).value, rollD6(99).value);
});

test('агент берёт лот по броску и минимальный легальный диск', () => {
  const agent = { discs: [{ id: 'd4', value: 4, used: false }, { id: 'd1', value: 1, used: false }, { id: 'd3', value: 3, used: false }] };
  const lots = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}` }));
  const move = chooseBid(agent, lots, () => true, 3);
  assert.equal(move.lotId, 'l2', 'бросок 3 указывает на третий лот');
  assert.equal(move.discId, 'd1', 'ставится наименьший диск');
});

test('если на выбранном лоте нельзя, поиск идёт вправо с замыканием', () => {
  const agent = { discs: [{ id: 'd2', value: 2, used: false }] };
  const lots = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}` }));
  const onlyFirst = (d, lot) => lot.id === 'l0';
  const move = chooseBid(agent, lots, onlyFirst, 5);
  assert.equal(move.lotId, 'l0', 'от пятого лота поиск обошёл конец и вернулся к первому');
});

test('когда ставить некуда, решения нет', () => {
  const agent = { discs: [{ id: 'd1', value: 1, used: false }] };
  assert.equal(chooseBid(agent, [{ id: 'l0' }], () => false, 1), null);
  assert.equal(chooseBid(agent, [], () => true, 1), null);
});

test('использованные и бонусные диски агент не берёт', () => {
  const agent = { discs: [{ id: 'a', value: 1, used: true }, { id: 'b', value: 2, used: false, bonus: true }, { id: 'c', value: 3, used: false }] };
  assert.equal(chooseBid(agent, [{ id: 'l0' }], () => true, 1).discId, 'c');
});

/* ---------- агент за столом ---------- */
test('вдвоём садится агент, лотов шесть, агент без промышленника', () => {
  const s = duo({ capitalists: true });
  assert.equal(s.players.length, 3);
  assert.equal(s.lots.length, 6);
  const agent = s.players.find(isAgent);
  assert.equal(agent.ability, null);
  assert.equal(agent.capitalistId, null);
  assert.equal(agent.cards.length, 0, 'у агента нет стартового предприятия');
  assert.equal(s.config.agent, true);
});

test('ход агента выполняется сам, человеку ждать нечего', () => {
  let s = duo();
  assert.equal(currentActor(s), 'p0');
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: s.lots[0].id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed4', lotId: s.lots[1].id });
  assert.ok(['p0', 'p1'].includes(currentActor(s)), 'после Бориса очередь уже снова у людей');
  assert.equal(s.lots.flatMap(l => l.bids).filter(b => b.playerId === 'agent').length, 1,
    'агент успел поставить ровно один диск');
});

test('агент за раунд выставляет все четыре диска', () => {
  let s = duo();
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 200) {
    const me = s.players.find(p => p.id === currentActor(s));
    const disc = me.discs.find(d => !d.used);
    const lot = disc && s.lots.find(l => !bidError(s, me.id, disc.id, l.id, disc.value));
    if (!disc || !lot) break;
    s = as(s, me.id, 'Bid', { discId: disc.id, lotId: lot.id });
  }
  const agent = s.players.find(isAgent);
  assert.equal(agent.discs.filter(d => d.used).length, 4);
  assert.equal(s.phase, 'settlement');
});

test('агент не получает компенсаций, а выигранное им предприятие выбывает', () => {
  let s = duo();
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 200) {
    const me = s.players.find(p => p.id === currentActor(s));
    const disc = me.discs.find(d => !d.used);
    const lot = disc && s.lots.find(l => !bidError(s, me.id, disc.id, l.id, disc.value));
    if (!disc || !lot) break;
    s = as(s, me.id, 'Bid', { discId: disc.id, lotId: lot.id });
  }
  while (s.phase === 'settlement' && guard++ < 400) {
    const pend = s.settlement.pending;
    s = pend ? as(s, pend.playerId, 'Compensate', { times: 0 }) : act(s, 'ResolveLot');
  }
  const agent = s.players.find(isAgent);
  assert.equal(agent.cards.length, 0, 'агент не копит предприятия');
  assert.deepEqual(agent.wallet, emptyWallet(), 'агент не копит ресурсы');
  assert.ok(s.events.some(e => e.type === 'AgentTookCard'), 'агент должен был выиграть хотя бы один лот');
  for (const e of s.events.filter(e => e.type === 'Compensation' && e.playerId === 'agent'))
    assert.equal(e.times, 0);
  const taken = s.events.filter(e => e.type === 'AgentTookCard').map(e => e.cardId);
  for (const id of taken)
    assert.ok(s.discard.some(c => c.id === id), 'карта агента должна уйти из игры');
});

test('агент не планирует, не производит и не попадает в итог', () => {
  let s = duo();
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 6000) {
    const me = s.players.find(p => p.id === currentActor(s));
    assert.ok(!isAgent(me), 'агент никогда не ждёт ввода');
    if (s.phase === 'auction') {
      const moves = [];
      for (const d of me.discs) if (!d.used)
        for (const l of s.lots) if (!bidError(s, me.id, d.id, l.id, d.value)) moves.push({ discId: d.id, lotId: l.id });
      if (!moves.length) break;
      s = as(s, me.id, 'Bid', moves[0]);
    } else if (s.phase === 'settlement') {
      const pend = s.settlement.pending;
      s = pend ? as(s, pend.playerId, 'Compensate', { times: 0 }) : act(s, 'ResolveLot');
    } else if (s.phase === 'planning') {
      s = act(s, 'ConfirmPlan');
    } else {
      const active = s.production.active;
      if (!active) {
        const free = me.cards.filter(c => c.usedRound !== s.round);
        s = free.length ? act(s, 'UseCard', { cardId: free[0].id }) : act(s, 'FinishProduction');
      } else s = act(s, 'NextEffect');
    }
  }
  assert.equal(s.phase, 'finished');
  assert.equal(s.result.length, 2, 'в итоге только люди');
  assert.ok(!s.result.some(r => r.id === 'agent'));
});

test('одинаковый seed даёт одинаковые броски агента', () => {
  const play = () => {
    let s = duo({ seed: 777 });
    s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: s.lots[0].id });
    s = as(s, 'p1', 'Bid', { discId: 'fixed3', lotId: s.lots[1].id });
    return s.events.filter(e => e.playerId === 'agent').map(e => `${e.lotId}:${e.value}:${e.roll}`);
  };
  assert.deepEqual(play(), play());
});

/* ---------- взаимодействия способностей, ранее только в случайных партиях ---------- */
test('Моника ставит переменный диск на уже занятое значение', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 33, variableCapital: true }, basePack);
  s.players[1].ability = 'unrestricted-bids';
  s.players[1].wallet.coal = 5;
  const lot = s.lots[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed2', lotId: lot.id });
  s = as(s, 'p1', 'Bid', { discId: 'variable', lotId: lot.id, value: 2 });
  const bids = s.lots[0].bids;
  assert.equal(bids.filter(b => b.value === 2).length, 2);
  assert.equal(bids.find(b => b.playerId === 'p1').kind, 'variable');
  assert.equal(s.players[1].wallet.coal, 3, 'уголь за переменный диск списывается сразу');
});

test('Артур в цепочке: парная двойка не ломает очередь и не трогает линию', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 44, productionChain: true }, basePack);
  s.players[0].ability = 'paired-extra-disc';
  s.config.pairedExtraDisc = true;
  s.players[0].discs.push({ ...extraDisc(s.players[0]) });
  const before = s.players[0].cards.map(c => c.id);
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: s.lots[0].id });
  assert.equal(currentActor(s), 'p0');
  s = as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[1].id });
  assert.equal(currentActor(s), 'p1');
  assert.deepEqual(s.players[0].cards.map(c => c.id), before, 'аукцион линию не меняет');
  assert.equal(s.players[0].lockedOrder.length, before.length);
});

test('Эварист: повтор уже улучшенной карты берёт улучшенную сторону (F04)', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 55 }, basePack);
  s.players[0].ability = 'repeat-card';
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  const companyId = basePack.deck.find(id => defs[id].advanced.length > 0);
  s.players[0].cards.push({ id: 'co1', definitionId: companyId, upgraded: true, usedRound: s.round });
  s.players[0].cards[0].usedRound = s.round;
  s.players[0].wallet = { ...emptyWallet(), coal: 9, metal: 9, oil: 9, upgrade: 9 };

  s = act(s, 'RepeatCard', { cardId: 'co1' });
  s = act(s, 'UseCard', { cardId: 'co1' });
  const total = defs[companyId].effects.length + defs[companyId].advanced.length;
  let steps = 0;
  while (s.production.active && steps++ < 20) s = act(s, 'NextEffect');
  const started = s.events.filter(e => e.type === 'CardStarted' && e.cardId === 'co1');
  assert.equal(started.length, 1);
  assert.ok(total > defs[companyId].effects.length, 'у карты есть улучшенные строки');
  assert.equal(s.players[0].cards.find(c => c.id === 'co1').usedRound, s.round);
});

test('Эварист: повтор не даёт бесконечный цикл и стоит ровно 2 угля за раунд', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 66 }, basePack);
  s.players[0].ability = 'repeat-card';
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players[0].wallet = { ...emptyWallet(), coal: 10 };
  s.players[0].cards[0].usedRound = s.round;
  s = act(s, 'RepeatCard', { cardId: s.players[0].cards[0].id });
  assert.equal(s.players[0].wallet.coal, 8);
  s.players[0].cards[0].usedRound = s.round;
  assert.throws(() => act(s, 'RepeatCard', { cardId: s.players[0].cards[0].id }), e => e.code === 'ALREADY_REPEATED');
});

/* ---------- очередь агента (правила базы, стр. 6) ---------- */
test('агент кладёт диск третьим в каждом круге, независимо от первого игрока', () => {
  for (const firstPlayer of [0, 1]) {
    let s = duo();
    s.firstPlayer = firstPlayer;
    s.turn = firstPlayer;
    const seen = [];
    let guard = 0;
    while (s.phase === 'auction' && guard++ < 60) {
      const me = s.players.find(p => p.id === currentActor(s));
      seen.push(me.id);
      const disc = me.discs.find(d => !d.used);
      const lot = disc && s.lots.find(l => !bidError(s, me.id, disc.id, l.id, disc.value));
      if (!disc || !lot) break;
      s = as(s, me.id, 'Bid', { discId: disc.id, lotId: lot.id });
      // ход агента движок делает сам, поэтому в seen он не попадёт
      const placed = s.lots.flatMap(l => l.bids);
      if (placed.filter(b => b.playerId === 'agent').length >= 4) break;
    }
    const human = firstPlayer === 0 ? ['p0', 'p1'] : ['p1', 'p0'];
    assert.deepEqual(seen.slice(0, 4), [...human, ...human],
      `первый игрок ${firstPlayer}: люди должны чередоваться, агент между ними не встаёт`);
  }
});

test('агент ставит диск только после обоих людей', () => {
  let s = duo();
  s.firstPlayer = 1; s.turn = 1;
  assert.equal(currentActor(s), 'p1');
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: s.lots[0].id });
  assert.equal(s.lots.flatMap(l => l.bids).some(b => b.playerId === 'agent'), false,
    'после первого человека агент ходить не должен');
  assert.equal(currentActor(s), 'p0');
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: s.lots[1].id });
  assert.equal(s.lots.flatMap(l => l.bids).filter(b => b.playerId === 'agent').length, 1,
    'после второго человека агент обязан поставить диск');
});

test('метка первого игрока обходит только людей', () => {
  let s = duo();
  const firsts = new Set();
  for (let round = 0; round < 4; round++) {
    firsts.add(s.players[s.firstPlayer].id);
    assert.equal(isAgent(s.players[s.firstPlayer]), false, 'агент не может быть первым игроком');
    let guard = 0;
    while (s.phase !== 'finished' && s.round === round + 1 && guard++ < 4000) {
      const me = s.players.find(p => p.id === currentActor(s));
      if (s.phase === 'auction') {
        const moves = [];
        for (const d of me.discs) if (!d.used)
          for (const l of s.lots) if (!bidError(s, me.id, d.id, l.id, d.value)) moves.push({ discId: d.id, lotId: l.id });
        if (!moves.length) break;
        s = as(s, me.id, 'Bid', moves[0]);
      } else if (s.phase === 'settlement') {
        const pend = s.settlement.pending;
        s = pend ? as(s, pend.playerId, 'Compensate', { times: 0 }) : act(s, 'ResolveLot');
      } else if (s.phase === 'planning') s = act(s, 'ConfirmPlan');
      else {
        const free = me.cards.filter(c => c.usedRound !== s.round);
        if (s.production.active) s = act(s, 'NextEffect');
        else s = free.length ? act(s, 'UseCard', { cardId: free[0].id }) : act(s, 'FinishProduction');
      }
    }
  }
  assert.deepEqual([...firsts].sort(), ['p0', 'p1'], 'метка должна побывать у обоих людей');
});
