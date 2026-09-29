import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, activeEffect } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { interbellumCompanies } from '../packages/content/interbellum-companies.mjs';

/* Собственный пакет: карты дополнения в игровую колоду ещё не подмешаны. */
const startup = {
  name: 'Штаб', kind: 'startup', starting: { coal: 2 },
  effects: [{ kind: 'gain', gain: { upgrade: 1 } }, { kind: 'upgrade' }], advanced: [],
};
/** Карта, где уголь продаётся (справа деньги). */
const sellsCoal = {
  name: 'Сбыт', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'convert', cost: { coal: 1 }, gain: { money: 2 }, limit: 2 }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
/** Карта, где уголь обменивается (справа ресурс) — для продажи не считается. */
const swapsCoal = {
  name: 'Обмен', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'convert', cost: { coal: 1 }, gain: { metal: 1 }, limit: 2 }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
/** Продажа угля спрятана на модернизированной стороне: пока карта не улучшена, не считается. */
const hiddenSale = {
  name: 'Резерв', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { metal: 1 } }],
  advanced: [{ kind: 'convert', cost: { coal: 1 }, gain: { money: 3 }, limit: 1 }],
};
const counter = {
  name: 'Контора', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'count-cards', gain: { coal: 1 }, on: 'sale', resource: 'coal', text: 'счёт' }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
const bonusCard = {
  name: 'Биржа', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [
    { kind: 'operation-bonus', on: 'sale', resource: 'coal', gain: { money: 1 }, text: 'надбавка' },
    { kind: 'convert', cost: { coal: 1 }, gain: { money: 2 }, limit: 3 },
  ],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
const neighbour = {
  name: 'Проект', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { coal: 1 } }],
  advanced: [{ kind: 'upgrade-next', text: 'модернизируйте следующее' }],
};

const definitions = { startup, sellsCoal, swapsCoal, hiddenSale, counter, bonusCard, neighbour, plain: sellsCoal };
const pack = {
  version: 'text-test', startupId: 'startup', definitions,
  deck: Array.from({ length: 40 }, () => 'sellsCoal'),
};
const defs = pack.definitions;
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);

/** Производство у первого игрока с заданной линией (стартовое остаётся первым). */
function line(ids, { upgraded = [] } = {}) {
  const s = createGame({ names: ['А', 'Б', 'В'], seed: 2 }, pack);
  const p = s.players[0];
  ids.forEach((definitionId, i) => p.cards.push({
    id: `c${i}`, definitionId, upgraded: upgraded.includes(i), usedRound: 0, manager: null, local: null,
  }));
  p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  return s;
}
/** Прогоняет карту до конца. */
function runCard(s, cardId) {
  s = act(s, 'UseCard', { cardId });
  let guard = 0;
  while (s.production.active && guard++ < 20) {
    const e = activeEffect(s, defs);
    if (!e) { s = act(s, 'NextEffect'); continue; }
    if (e.kind === 'upgrade-next') { s = act(s, 'UpgradeNext'); continue; }
    s = act(s, 'NextEffect');
  }
  return s;
}

/* ---------- «за каждую вашу карту, где можете продать X» ---------- */
test('считаются только карты с активной продажей нужного ресурса', () => {
  let s = line(['counter', 'sellsCoal', 'sellsCoal', 'swapsCoal', 'hiddenSale']);
  const before = s.players[0].wallet.coal;
  s = runCard(s, 'c0');
  const counted = s.events.find(e => e.type === 'CountedCards');
  assert.ok(counted, 'эффект счёта не сработал');
  // Считаются две карты «Сбыт». «Обмен» продажей не является, продажа «Резерва» неактивна,
  // сама «Контора» продажи не имеет.
  assert.equal(counted.cards, 2);
  assert.equal(s.players[0].wallet.coal, before + 2);
});

test('модернизация делает скрытую продажу активной и она начинает считаться', () => {
  let s = line(['counter', 'hiddenSale'], { upgraded: [1] });
  s = runCard(s, 'c0');
  assert.equal(s.events.find(e => e.type === 'CountedCards').cards, 1);
});

test('карта считает и саму себя, если у неё есть подходящая продажа', () => {
  const selfCounting = {
    ...counter,
    effects: [
      { kind: 'convert', cost: { coal: 1 }, gain: { money: 2 }, limit: 1 },
      { kind: 'count-cards', gain: { coal: 1 }, on: 'sale', resource: 'coal', text: 'счёт' },
    ],
  };
  const p2 = { ...pack, definitions: { ...definitions, selfCounting } };
  const s0 = createGame({ names: ['А', 'Б', 'В'], seed: 2 }, p2);
  const p = s0.players[0];
  p.cards.push({ id: 'c0', definitionId: 'selfCounting', upgraded: false, usedRound: 0, manager: null, local: null });
  p.wallet = { ...emptyWallet(), coal: 10 };
  s0.phase = 'production'; s0.turn = 0; s0.production = { active: null };
  let s = dispatch(s0, { type: 'UseCard', cardId: 'c0', actorId: 'p0' }, p2.definitions);
  let guard = 0;
  while (s.production.active && guard++ < 10) s = dispatch(s, { type: 'NextEffect', actorId: 'p0' }, p2.definitions);
  assert.equal(s.events.find(e => e.type === 'CountedCards').cards, 1);
});

test('ноль подходящих карт не ломает эффект', () => {
  let s = line(['counter', 'swapsCoal']);
  const before = s.players[0].wallet.coal;
  s = runCard(s, 'c0');
  assert.equal(s.events.find(e => e.type === 'CountedCards').cards, 0);
  assert.equal(s.players[0].wallet.coal, before, 'ничего не начислено');
});

/* ---------- «всякий раз, когда продаёте X, получайте ещё» ---------- */
test('надбавка платится за каждую отдельную продажу нужного ресурса', () => {
  let s = line(['bonusCard']);
  s = act(s, 'UseCard', { cardId: 'c0' });
  assert.ok(s.players[0].bonuses.length === 1, 'надбавка должна включиться в свою очередь');
  const before = s.players[0].wallet.money;
  s = act(s, 'Convert', { times: 3 });
  assert.equal(s.players[0].wallet.money, before + 3 * 2 + 3, 'по 2 за продажу и по 1 надбавки');
  assert.equal(s.events.filter(e => e.type === 'OperationBonus').length, 3);
});

test('надбавка не платится за операции с другим ресурсом', () => {
  const other = {
    name: 'Нефтесбыт', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
    effects: [{ kind: 'convert', cost: { oil: 1 }, gain: { money: 4 }, limit: 1 }],
    advanced: [{ kind: 'gain', gain: { coal: 1 } }],
  };
  const p2 = { ...pack, definitions: { ...definitions, other } };
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 2 }, p2);
  const p = s.players[0];
  p.cards.push({ id: 'c0', definitionId: 'bonusCard', upgraded: false, usedRound: 0, manager: null, local: null });
  p.cards.push({ id: 'c1', definitionId: 'other', upgraded: false, usedRound: 0, manager: null, local: null });
  p.wallet = { ...emptyWallet(), coal: 10, oil: 10 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  const go = (type, payload = {}) => { s = dispatch(s, { type, actorId: 'p0', ...payload }, p2.definitions); };
  go('UseCard', { cardId: 'c0' });
  go('Convert', { times: 1 });
  let guard = 0;
  while (s.production.active && guard++ < 10) go('NextEffect');
  const before = s.players[0].wallet.money;
  go('UseCard', { cardId: 'c1' });
  go('Convert', { times: 1 });
  assert.equal(s.players[0].wallet.money, before + 4, 'за нефть надбавки нет');
});

test('надбавка живёт одну фазу производства', () => {
  let s = line(['bonusCard']);
  s = act(s, 'UseCard', { cardId: 'c0' });
  assert.equal(s.players[0].bonuses.length, 1);
  let guard = 0;
  while (s.production.active && guard++ < 10) s = act(s, 'NextEffect');
  s.players.forEach(x => { x.cards.forEach(c => { c.usedRound = s.round; }); x.done = true; });
  s.players[0].done = false;
  s = act(s, 'FinishProduction');
  assert.equal(s.round, 2);
  assert.deepEqual(s.players[0].bonuses, [], 'в новом раунде надбавок нет');
});

/* ---------- «модернизируйте следующее предприятие» ---------- */
test('модернизируется именно следующая карта в линии', () => {
  let s = line(['neighbour', 'sellsCoal', 'sellsCoal'], { upgraded: [0] });
  s = runCard(s, 'c0');
  assert.equal(s.players[0].cards.find(c => c.id === 'c1').upgraded, true, 'улучшена соседняя');
  assert.equal(s.players[0].cards.find(c => c.id === 'c2').upgraded, false, 'дальше не идёт');
  assert.ok(s.events.some(e => e.type === 'CardUpgraded' && e.byNeighbour));
});

test('от модернизации соседа можно отказаться', () => {
  let s = line(['neighbour', 'sellsCoal'], { upgraded: [0] });
  s = act(s, 'UseCard', { cardId: 'c0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade-next' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'NextEffect');
  assert.equal(s.players[0].cards.find(c => c.id === 'c1').upgraded, false);
});

test('последней карте в линии модернизировать некого', () => {
  let s = line(['sellsCoal', 'neighbour'], { upgraded: [1] });
  s = act(s, 'UseCard', { cardId: 'c1' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade-next' && guard++ < 10) s = act(s, 'NextEffect');
  assert.throws(() => act(s, 'UpgradeNext'), e => e.code === 'NO_NEXT_CARD');
});

test('уже улучшенного соседа улучшить нельзя', () => {
  let s = line(['neighbour', 'sellsCoal'], { upgraded: [0, 1] });
  s = act(s, 'UseCard', { cardId: 'c0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade-next' && guard++ < 10) s = act(s, 'NextEffect');
  assert.throws(() => act(s, 'UpgradeNext'), e => e.code === 'CANNOT_UPGRADE');
});

test('эти эффекты не бывают компенсацией', () => {
  for (const compensation of [
    { kind: 'count-cards', gain: { coal: 1 }, on: 'sale', resource: 'coal' },
    { kind: 'operation-bonus', on: 'sale', resource: 'coal', gain: { money: 1 } },
    { kind: 'upgrade-next' },
  ]) {
    const bad = { ...pack, definitions: { ...definitions, sellsCoal: { ...sellsCoal, compensation } } };
    assert.throws(() => createGame({ names: ['А', 'Б', 'В'] }, bad), e => e.code === 'UNSUPPORTED_EFFECT');
  }
});

test('каталог дополнения использует только описанные виды строк', () => {
  const known = ['gain', 'convert', 'supply', 'count-cards', 'operation-bonus', 'upgrade-next', 'permanent', 'take-stored'];
  for (const c of interbellumCompanies)
    for (const row of [c.compensation, ...c.basic, ...c.advanced])
      assert.ok(known.includes(row.kind), `${c.id}: неизвестный вид строки ${row.kind}`);
});
