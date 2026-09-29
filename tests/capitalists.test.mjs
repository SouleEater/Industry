import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, bidError } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { compensationUnits, upgradeCost, extraDisc, pickWinner, ABILITIES } from '../packages/domain/capitalists.mjs';
import { trainingPack as pack } from '../packages/content/training.mjs';

const defs = pack.definitions;
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);
const game = (options = {}) => createGame({ planning: false, ...options }, pack);

function withAbility(ability, seat = 0, options = {}) {
  const s = game(options);
  s.players[seat].ability = ability;
  const extra = extraDisc(s.players[seat]);
  if (extra) s.players[seat].discs.push({ ...extra });
  return s;
}

test('каждая способность каталога известна движку', () => {
  for (const a of ['repeat-card', 'compensation-plus-one', 'unrestricted-bids', 'paired-extra-disc', 'metal-for-upgrade'])
    assert.ok(ABILITIES.includes(a));
  assert.equal(ABILITIES.length, 8, 'пять базовых и три из дополнения');
});

test('промышленники по умолчанию выключены и партия остаётся прежней', () => {
  const s = game();
  assert.equal(s.config.capitalists, false);
  assert.ok(s.players.every(p => p.ability === null));
  assert.ok(s.players.every(p => p.discs.length === 4));
});

/* ---------- Генри ---------- */
test('Генри: компенсация считается на 1 больше, ноль перестаёт быть пустым', () => {
  const henry = { ability: 'compensation-plus-one', wallet: emptyWallet() };
  assert.equal(compensationUnits(henry, 2), 3);
  assert.equal(compensationUnits(henry, 0), 1);
  assert.equal(compensationUnits({ ability: null }, 2), 2);
});

test('Генри получает на одну единицу компенсации больше в настоящей партии', () => {
  let s = withAbility('compensation-plus-one', 1);
  const lot = s.lots.find(l => defs[l.card.definitionId].compensation.kind === 'gain');
  const effect = defs[lot.card.definitionId].compensation;
  const kind = Object.keys(effect.gain)[0];
  const before = s.players[1].wallet[kind];

  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: lot.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: lot.id });
  while (s.phase === 'auction') {
    const p = s.players.find(x => x.id === currentActor(s));
    const free = p.discs.find(d => !d.used);
    const target = s.lots.find(l => !l.bids.some(b => b.playerId === p.id || b.value === free.value));
    if (!free || !target) break;
    s = as(s, p.id, 'Bid', { discId: free.id, lotId: target.id });
  }
  while (s.phase === 'settlement' && !s.lots.find(l => l.id === lot.id).resolved) {
    s = s.settlement.pending
      ? as(s, s.settlement.pending.playerId, 'Compensate', { times: 0 })
      : act(s, 'ResolveLot');
  }
  const paid = s.events.find(e => e.type === 'Compensation' && e.playerId === 'p1');
  assert.equal(paid.times, 2, 'диск 1 должен дать две единицы');
  assert.equal(s.players[1].wallet[kind], before + effect.gain[kind] * 2);
});

/* ---------- Моника ---------- */
test('Моника ставит на занятое значение, остальные — нет', () => {
  let s = withAbility('unrestricted-bids', 1);
  const lot = s.lots[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: lot.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed3', lotId: lot.id });
  assert.equal(s.lots[0].bids.filter(b => b.value === 3).length, 2);
  assert.throws(() => as(s, 'p2', 'Bid', { discId: 'fixed3', lotId: lot.id }), e => e.code === 'ILLEGAL_BID');
});

test('Моника может положить второй свой диск на то же предприятие, но не тот же самый', () => {
  let s = withAbility('unrestricted-bids', 0);
  const lot = s.lots[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: lot.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed4', lotId: s.lots[1].id });
  s = as(s, 'p2', 'Bid', { discId: 'fixed4', lotId: s.lots[2].id });
  s = as(s, 'p0', 'Bid', { discId: 'fixed2', lotId: lot.id });
  assert.equal(s.lots[0].bids.filter(b => b.playerId === 'p0').length, 2);
});

test('при равенстве на максимуме предприятие уходит сопернику, а не Монике', () => {
  const players = { monica: { ability: 'unrestricted-bids' }, rival: { ability: null } };
  const bids = [{ playerId: 'monica', value: 4 }, { playerId: 'rival', value: 4 }, { playerId: 'third', value: 1 }];
  const win = pickWinner(bids, id => players[id] ?? { ability: null });
  assert.equal(win.playerId, 'rival');
});

test('одна Моника на максимуме выигрывает лот', () => {
  const bids = [{ playerId: 'monica', value: 4 }, { playerId: 'rival', value: 2 }];
  assert.equal(pickWinner(bids, () => ({ ability: 'unrestricted-bids' })).playerId, 'monica');
});

test('пустой лот не имеет победителя', () => {
  assert.equal(pickWinner([], () => null), null);
});

/* ---------- Артур ---------- */
test('Артур получает пятый диск, остальные — нет', () => {
  assert.equal(extraDisc({ ability: 'paired-extra-disc' }).value, 2);
  assert.equal(extraDisc({ ability: null }), null);
});

test('в базе дополнительная двойка ставится как любой другой диск', () => {
  let s = withAbility('paired-extra-disc', 0);
  s = as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[0].id });
  assert.equal(s.lots[0].bids[0].value, 2);
  assert.equal(s.pendingPair, null, 'база не требует парной ставки');
  assert.equal(currentActor(s), 'p1', 'очередь сразу уходит дальше');
});

test('в базе двойка подчиняется обычным ограничениям ставки', () => {
  let s = withAbility('paired-extra-disc', 0);
  s = as(s, 'p0', 'Bid', { discId: 'fixed2', lotId: s.lots[0].id });
  assert.throws(() => as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[0].id }),
    e => e.code === 'NOT_YOUR_TURN', 'ход уже ушёл');
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: s.lots[1].id });
  s = as(s, 'p2', 'Bid', { discId: 'fixed1', lotId: s.lots[2].id });
  assert.throws(() => as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[0].id }),
    e => e.code === 'ILLEGAL_BID', 'значение 2 на этом лоте уже занято');
  s = as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[1].id });
  assert.equal(s.lots[1].bids.some(b => b.value === 2), true);
});

test('обновлённая двойка «Интербеллума» требует парной ставки', () => {
  let s = withAbility('paired-extra-disc', 0, { pairedExtraDisc: true });
  assert.throws(() => as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[0].id }), e => e.code === 'ILLEGAL_BID');
});

test('после обычной ставки Артур обязан доставить двойку на другое предприятие', () => {
  let s = withAbility('paired-extra-disc', 0, { pairedExtraDisc: true });
  s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: s.lots[0].id });
  assert.equal(s.pendingPair?.playerId, 'p0');
  assert.equal(currentActor(s), 'p0', 'очередь не уходит до парной ставки');
  assert.throws(() => as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: s.lots[1].id }), e => e.code === 'NOT_YOUR_TURN');
  assert.throws(() => as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[0].id }), e => e.code === 'ILLEGAL_BID');

  s = as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[1].id });
  assert.equal(s.pendingPair, null);
  assert.equal(currentActor(s), 'p1');
  assert.equal(s.lots[1].bids[0].bonus, true);
});

test('дополнительная двойка необязательна: от неё можно отказаться', () => {
  let s = withAbility('paired-extra-disc', 0, { pairedExtraDisc: true });
  s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: s.lots[0].id });
  assert.equal(s.pendingPair?.playerId, 'p0', 'двойка именно предлагается');
  s = as(s, 'p0', 'SkipPair');
  assert.equal(s.pendingPair, null);
  assert.equal(currentActor(s), 'p1', 'очередь уходит дальше');
  assert.equal(s.players[0].discs.find(d => d.bonus).used, false, 'отказ не расходует диск');
});

test('после отказа двойку предлагают снова на следующей ставке', () => {
  let s = withAbility('paired-extra-disc', 0, { pairedExtraDisc: true });
  s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: s.lots[0].id });
  s = as(s, 'p0', 'SkipPair');
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: s.lots[1].id });
  s = as(s, 'p2', 'Bid', { discId: 'fixed1', lotId: s.lots[2].id });
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: s.lots[1].id });
  assert.equal(s.pendingPair?.playerId, 'p0', 'предложение повторяется');
  s = as(s, 'p0', 'Bid', { discId: 'bonus2', lotId: s.lots[3].id });
  assert.equal(s.lots[3].bids[0].bonus, true);
});

test('отказ от двойки не мешает закрыть аукцион', () => {
  let s = withAbility('paired-extra-disc', 0, { pairedExtraDisc: true });
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 200) {
    const me = s.players.find(p => p.id === currentActor(s));
    if (s.pendingPair?.playerId === me.id) { s = as(s, me.id, 'SkipPair'); continue; }
    const moves = [];
    for (const d of me.discs) if (!d.used && !d.bonus)
      for (const l of s.lots) if (!bidError(s, me.id, d.id, l.id, d.value)) moves.push({ discId: d.id, lotId: l.id });
    if (!moves.length) break;
    s = as(s, me.id, 'Bid', moves[0]);
  }
  assert.equal(s.phase, 'settlement');
  assert.equal(s.players[0].discs.find(d => d.bonus).used, false, 'неиспользованная двойка просто остаётся лежать');
  assert.equal(s.lots.flatMap(l => l.bids).some(b => b.bonus), false);
});

/* ---------- Тимур ---------- */
test('Тимур платит металлом только при нулевом запасе жетонов', () => {
  const timur = ability => ({ ability, wallet: { ...emptyWallet(), upgrade: 0, metal: 3 } });
  assert.deepEqual(upgradeCost(timur('metal-for-upgrade')), { coal: 1, metal: 1 });
  assert.deepEqual(upgradeCost({ ability: 'metal-for-upgrade', wallet: { ...emptyWallet(), upgrade: 1 } }), { coal: 1, upgrade: 1 });
  assert.deepEqual(upgradeCost(timur(null)), { coal: 1, upgrade: 1 });
});

test('Тимур модернизирует за металл в производстве', () => {
  let s = game();
  s.players[0].ability = 'metal-for-upgrade';
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players[0].cards.push({ id: 'mine-1', definitionId: 'mine', upgraded: false, usedRound: 0 });
  s.players[0].wallet = { ...emptyWallet(), coal: 5, metal: 4, upgrade: 0 };
  s = act(s, 'UseCard', { cardId: 'start0' });
  while (s.production.active && s.production.active.index < 2) s = act(s, 'NextEffect');
  // первая строка стартовой карты сама выдаёт жетон, поэтому обнуляем запас перед проверкой
  s.players[0].wallet.upgrade = 0;
  s = act(s, 'Upgrade', { cardId: 'mine-1' });
  assert.equal(s.players[0].cards.find(c => c.id === 'mine-1').upgraded, true);
  assert.equal(s.players[0].wallet.metal, 3);
  assert.equal(s.players[0].wallet.coal, 4);
});

/* ---------- Эварист ---------- */
test('Эварист повторяет карту за 2 угля один раз за фазу', () => {
  let s = game();
  s.players[0].ability = 'repeat-card';
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players[0].wallet = { ...emptyWallet(), coal: 6 };
  s.players[0].cards[0].usedRound = s.round;

  s = act(s, 'RepeatCard', { cardId: 'start0' });
  assert.equal(s.players[0].wallet.coal, 4);
  assert.equal(s.players[0].cards[0].usedRound, 0);
  assert.equal(s.players[0].repeated, true);

  s.players[0].cards[0].usedRound = s.round;
  assert.throws(() => act(s, 'RepeatCard', { cardId: 'start0' }), e => e.code === 'ALREADY_REPEATED');
});

test('повтор недоступен без способности и без отработавшей карты', () => {
  let s = game();
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players[0].wallet = { ...emptyWallet(), coal: 6 };
  assert.throws(() => act(s, 'RepeatCard', { cardId: 'start0' }), e => e.code === 'NO_ABILITY');
  s.players[0].ability = 'repeat-card';
  assert.throws(() => act(s, 'RepeatCard', { cardId: 'start0' }), e => e.code === 'NOT_USED');
});

test('на повтор нужно ровно 2 угля', () => {
  let s = game();
  s.players[0].ability = 'repeat-card';
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players[0].wallet = { ...emptyWallet(), coal: 1 };
  s.players[0].cards[0].usedRound = s.round;
  assert.throws(() => act(s, 'RepeatCard', { cardId: 'start0' }), e => e.code === 'INSUFFICIENT_RESOURCES');
});
