import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, activeEffect } from '../packages/domain/engine.mjs';
import { emptyWallet, classifyConversion } from '../packages/domain/rules.mjs';
import { basePack } from '../packages/content/base-pack.mjs';
import { auctionManagers } from '../packages/content/interbellum.mjs';

const defs = basePack.definitions;
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const byId = id => auctionManagers.find(t => t.id === id) ?? auctionManagers.find(t => t.family === id);

/** Партия, доведённая до производства, с жетоном на нужной карте первого игрока. */
function staged({ token, definitionId, upgraded = false, wallet = {} } = {}) {
  const s = createGame({ names: ['Аня', 'Борис', 'Вика'], seed: 5, universities: true }, basePack);
  const p = s.players[0];
  const card = { id: 'test-card', definitionId, upgraded, usedRound: 0, managers: [], local: null };
  p.cards.push(card);
  if (token) { p.managers.push(token); card.managers = [token]; }
  p.wallet = { ...emptyWallet(), coal: 20, metal: 20, oil: 20, upgrade: 20, money: 0, ...wallet };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  return s;
}
/** Первое предприятие, у которого есть строка продажи с указанной кратностью. */
function firstWith(predicate) {
  const id = basePack.deck.find(x => defs[x].effects.some(predicate));
  assert.ok(id, 'в каталоге нет подходящей карты');
  return id;
}
const rowsOf = (id, upgraded) => {
  const d = defs[id];
  return [...d.effects, ...(upgraded ? d.advanced : [])];
};

/* ---------- размещение ---------- */
test('управляющих размещают в фазе планирования, по одному на карту', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 8, universities: true }, basePack);
  s.players[0].managers = ['upgrade-for-metal', 'money-per-sale'];
  s.phase = 'planning'; s.turn = 0;
  const [a, b] = s.players[0].cards.length > 1 ? s.players[0].cards : [s.players[0].cards[0], null];

  // на одну карту двух жетонов класть нельзя
  assert.throws(() => act(s, 'PlaceManagers', {
    assignments: [{ cardId: a.id, token: 'upgrade-for-metal' }, { cardId: a.id, token: 'money-per-sale' }],
  }), e => e.code === 'INVALID_ASSIGNMENT');
  // чужой жетон положить нельзя
  assert.throws(() => act(s, 'PlaceManagers', {
    assignments: [{ cardId: a.id, token: 'coal-per-sale' }],
  }), e => e.code === 'INVALID_ASSIGNMENT');
  // один и тот же жетон дважды нельзя
  assert.throws(() => act(s, 'PlaceManagers', {
    assignments: [{ cardId: a.id, token: 'money-per-sale' }, { cardId: a.id, token: 'money-per-sale' }],
  }), e => e.code === 'INVALID_ASSIGNMENT');

  s = act(s, 'PlaceManagers', { assignments: [{ cardId: a.id, token: 'upgrade-for-metal' }] });
  assert.equal(s.players[0].cards.find(c => c.id === a.id).managers[0], 'upgrade-for-metal');
  // повторный вызов заменяет расстановку целиком
  s = act(s, 'PlaceManagers', { assignments: [] });
  assert.equal(s.players[0].cards.every(c => !(c.managers ?? []).length), true);
});

test('в конце раунда жетоны возвращаются игроку и остаются у него', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 9, universities: true }, basePack);
  s.players.forEach(p => { p.managers = ['money-per-sale']; p.cards[0].managers = ['money-per-sale']; p.done = true; });
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players.forEach(p => p.cards.forEach(c => { c.usedRound = s.round; }));
  s.players[0].done = false;
  s = act(s, 'FinishProduction');
  assert.equal(s.round, 2, 'начался следующий раунд');
  for (const p of s.players) {
    assert.deepEqual(p.managers, ['money-per-sale'], 'жетон остался у игрока');
    assert.equal(p.cards.every(c => !(c.managers ?? []).length), true, 'с карт жетоны сняты');
  }
});

/* ---------- эффекты ---------- */
test('«модернизировать за металл» переворачивает именно эту карту', () => {
  const id = basePack.deck.find(x => defs[x].advanced.length > 0);
  let s = staged({ token: 'upgrade-for-metal', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  // запас считаем ПОСЛЕ запуска карты: её автоматические строки тоже приносят ресурсы
  const before = s.players[0].wallet.metal;
  s = act(s, 'UseManager');
  const card = s.players[0].cards.find(c => c.id === 'test-card');
  assert.equal(card.upgraded, true);
  assert.equal(s.players[0].wallet.metal, before - 1, 'списан ровно один металл');
  assert.throws(() => act(s, 'UseManager'), e => e.code === 'MANAGER_USED');
});

test('«сбросить за 4 денег» убирает предприятие из линии', () => {
  const id = basePack.deck[0];
  let s = staged({ token: 'discard-for-money-1', definitionId: id });
  const cardsBefore = s.players[0].cards.length;
  s = act(s, 'UseCard', { cardId: 'test-card' });
  s = act(s, 'UseManager');
  const p = s.players[0];
  assert.equal(p.wallet.money, 4);
  assert.equal(p.cards.length, cardsBefore - 1);
  assert.equal(p.cards.some(c => c.id === 'test-card'), false);
  assert.equal(s.production.active, null, 'использование закончилось вместе с картой');
  assert.ok(s.discard.some(c => c.id === 'test-card'));
  assert.ok(s.events.some(e => e.type === 'CardScrapped'));
});

test('«деньга за продажу» платит за каждую отдельную операцию', () => {
  const id = firstWith(r => r.kind === 'convert' && classifyConversion(r).sale && r.limit >= 2);
  let s = staged({ token: 'money-per-sale', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  let guard = 0, paid = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    if (e.kind === 'convert' && classifyConversion(e).sale) {
      const before = s.players[0].wallet.money;
      const gained = e.gain.money * 2;
      s = act(s, 'Convert', { times: 2 });
      paid = s.players[0].wallet.money - before - gained;
      break;
    }
    s = act(s, 'NextEffect');
  }
  assert.equal(paid, 2, 'две операции — две деньги сверху');
  assert.equal(s.events.filter(e => e.type === 'ManagerBonus' && e.reason === 'sale').length, 2);
});

test('«уголь за продажу» и «деньга за обмен» различают тип операции', () => {
  const saleId = firstWith(r => r.kind === 'convert' && classifyConversion(r).sale);
  let s = staged({ token: 'money-per-exchange', definitionId: saleId });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  let guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    const kinds = e.kind === 'convert' ? classifyConversion(e) : {};
    if (e.kind === 'convert' && kinds.sale && !kinds.exchange) {
      s = act(s, 'Convert', { times: 1 });
      assert.equal(s.events.some(x => x.type === 'ManagerBonus'), false,
        'жетон за обмен не платит за чистую продажу');
      return;
    }
    s = act(s, 'NextEffect');
  }
  assert.fail('не нашлось строки чистой продажи');
});

test('«каждый обмен ещё раз» поднимает кратность на единицу', () => {
  const id = firstWith(r => r.kind === 'convert' && classifyConversion(r).exchange && !classifyConversion(r).sale);
  let s = staged({ token: 'repeat-each-exchange', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  let guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    const kinds = e.kind === 'convert' ? classifyConversion(e) : {};
    if (e.kind === 'convert' && kinds.exchange && !kinds.sale) {
      assert.throws(() => act(s, 'Convert', { times: e.limit + 2 }), x => x.code === 'INVALID_COUNT');
      s = act(s, 'Convert', { times: e.limit + 1 });
      assert.ok(true, 'на один раз больше напечатанного');
      return;
    }
    s = act(s, 'NextEffect');
  }
  assert.fail('не нашлось строки чистого обмена');
});

test('«один обмен бесплатно» не тратит ресурсы ровно один раз', () => {
  const id = firstWith(r => r.kind === 'convert' && classifyConversion(r).exchange && r.limit >= 2);
  let s = staged({ token: 'free-exchange-once', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  let guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    if (e.kind === 'convert' && classifyConversion(e).exchange && e.limit >= 2) {
      const before = { ...s.players[0].wallet };
      s = act(s, 'Convert', { times: 2 });
      const after = s.players[0].wallet;
      for (const [k, v] of Object.entries(e.cost))
        assert.equal(before[k] - after[k] + (e.gain[k] ?? 0) * 2, v, `${k}: оплачена только одна операция`);
      assert.equal(s.events.filter(x => x.type === 'ConversionPerformed' && x.free).length, 1);
      return;
    }
    s = act(s, 'NextEffect');
  }
  assert.fail('не нашлось подходящей строки обмена');
});

test('«3 денег за полностью применённые продажи» проверяет каждую строку', () => {
  const id = firstWith(r => r.kind === 'convert' && classifyConversion(r).sale);
  const rows = rowsOf(id, false);
  const sales = rows.filter(r => r.kind === 'convert' && classifyConversion(r).sale);

  // сначала не применяем ничего — премии быть не должно
  let s = staged({ token: 'money-if-all-sales', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  let guard = 0;
  while (s.production.active && guard++ < 12) s = act(s, 'NextEffect');
  assert.equal(s.events.some(e => e.type === 'ManagerBonus' && e.reason === 'all-sales'), false,
    'без продаж премии нет');

  // теперь применяем все строки продажи полностью
  s = staged({ token: 'money-if-all-sales', definitionId: id });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    if (e.kind === 'convert' && classifyConversion(e).sale) s = act(s, 'Convert', { times: e.limit });
    s = act(s, 'NextEffect');
  }
  assert.ok(sales.length > 0);
  assert.equal(s.events.filter(e => e.type === 'ManagerBonus' && e.reason === 'all-sales').length, 1,
    'премия выдаётся один раз в конце карты');
});

test('ресурсы жетона лежат на карте, тратятся первыми и сгорают', () => {
  const id = firstWith(r => r.kind === 'convert' && (r.cost.coal ?? 0) > 0);
  let s = staged({ token: 'local-four-coal', definitionId: id, wallet: { coal: 0 } });
  s = act(s, 'UseCard', { cardId: 'test-card' });
  s = act(s, 'UseManager');
  const card = () => s.players[0].cards.find(c => c.id === 'test-card');
  assert.equal(card().local.coal, 4, 'четыре угля легли на карту, а не в общий запас');
  assert.equal(s.players[0].wallet.coal, 0);

  let guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    if (e.kind === 'convert' && (e.cost.coal ?? 0) > 0) {
      s = act(s, 'Convert', { times: 1 });
      assert.equal(s.players[0].wallet.coal, 0, 'общий запас не тронут, платила карта');
      assert.ok(card().local.coal < 4, 'уголь списан с карты');
      break;
    }
    s = act(s, 'NextEffect');
  }
  guard = 0;
  while (s.production.active && guard++ < 12) s = act(s, 'NextEffect');
  const finished = s.players[0].cards.find(c => c.id === 'test-card');
  assert.equal(finished.local, null, 'непотраченное сгорело');
  assert.equal(s.players[0].wallet.coal, 0, 'остаток не утёк в общий запас');
});

test('жетон с выбором даёт ровно один из вариантов', () => {
  const id = basePack.deck[0];
  for (const option of [0, 1]) {
    let s = staged({ token: 'local-coal-metal-or-oil', definitionId: id, wallet: { coal: 0, metal: 0, oil: 0 } });
    s = act(s, 'UseCard', { cardId: 'test-card' });
    s = act(s, 'UseManager', { option });
    const local = s.players[0].cards.find(c => c.id === 'test-card').local;
    const expected = byId('local-coal-metal-or-oil').effect.options[option];
    assert.deepEqual(local, expected, `вариант ${option}`);
  }
});

test('управляющий не действует без активной карты и без жетона', () => {
  let s = staged({ definitionId: basePack.deck[0] });
  assert.throws(() => act(s, 'UseManager'), e => e.code === 'NO_ACTIVE_CARD');
  s = act(s, 'UseCard', { cardId: 'test-card' });
  assert.throws(() => act(s, 'UseManager'),
    e => ['NO_MANAGER', 'NO_ACTIVE_CARD'].includes(e.code), 'без жетона применять нечего');
});

test('пассивные жетоны применять вручную нельзя', () => {
  for (const token of ['money-per-sale', 'repeat-each-exchange', 'free-exchange-once', 'money-if-all-sales']) {
    let s = staged({ token, definitionId: basePack.deck[0] });
    s = act(s, 'UseCard', { cardId: 'test-card' });
    assert.throws(() => act(s, 'UseManager'),
      e => ['NO_MANAGER', 'NO_ACTIVE_CARD'].includes(e.code), token);
  }
});

test('каждый жетон стопки имеет реализованный эффект', () => {
  const kinds = new Set(auctionManagers.map(t => t.effect.kind));
  assert.deepEqual([...kinds].sort(), [
    'discard-self', 'extra-limit', 'free-operation', 'if-all-sales',
    'local-choice', 'local-gain', 'per-operation', 'repeat-supply', 'upgrade-self',
  ]);
  assert.equal(auctionManagers.length, 14, 'все жетоны коробки в стопке');
  assert.equal(auctionManagers.every(t => t.playable), true);
});
