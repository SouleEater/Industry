import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, activeEffect } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { interbellumCompanies, companyNeeds } from '../packages/content/interbellum-companies.mjs';

const startup = {
  name: 'Штаб', kind: 'startup', starting: { coal: 2 },
  effects: [{ kind: 'gain', gain: { upgrade: 1 } }, { kind: 'upgrade' }], advanced: [],
};
/** ib-04: копит металл, когда вашу верхнюю ставку перебивают, и отдаёт всё разом. */
const vault = {
  name: 'Хранилище', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [
    { kind: 'permanent', rule: 'store-on-outbid', resource: 'metal', text: 'копим металл' },
    { kind: 'take-stored', resource: 'metal', text: 'заберите весь металл' },
  ],
  advanced: [{ kind: 'gain', gain: { upgrade: 1 } }],
};
/** То же, но постоянный эффект спрятан на модернизированной стороне. */
const lateVault = {
  name: 'Поздний', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { coal: 1 } }],
  advanced: [{ kind: 'permanent', rule: 'store-on-outbid', resource: 'metal', text: 'копим металл' }],
};
/** ib-14: каждая добыча угля приносит ещё уголь. */
const mineBoost = {
  name: 'Надбавка', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'permanent', rule: 'bonus-on-gain', resource: 'coal', text: 'плюс уголь' }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
const digger = {
  name: 'Шахта', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { coal: 2 } }, { kind: 'gain', gain: { metal: 1 } }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
/** ib-18: продажи одного вида ресурса применяются на раз больше. */
const guild = {
  name: 'Гильдия', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'permanent', rule: 'extra-single-resource-sale', amount: 1, text: 'ещё раз' }],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
const shop = {
  name: 'Лавка', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [
    { kind: 'convert', cost: { coal: 1 }, gain: { money: 2 }, limit: 1 },
    { kind: 'convert', cost: { coal: 1, metal: 1 }, gain: { money: 5 }, limit: 1 },
  ],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
/** ib-22: уголь модернизации ложится на карту и тратится только ею. */
const foundry = {
  name: 'Литейная', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [
    { kind: 'permanent', rule: 'store-upgrade-cost', resource: 'coal', text: 'копим уголь модернизаций' },
    { kind: 'convert', cost: { coal: 2 }, gain: { upgrade: 1 }, limit: 2, from: 'card', text: 'уголь с этой карты' },
  ],
  advanced: [{ kind: 'gain', gain: { coal: 1 } }],
};
const plain = {
  name: 'Простая', kind: 'company', compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { coal: 1 } }], advanced: [{ kind: 'gain', gain: { coal: 2 } }],
};

const definitions = { startup, vault, lateVault, mineBoost, digger, guild, shop, foundry, plain };
const pack = { version: 'permanent-test', startupId: 'startup', definitions, deck: Array.from({ length: 40 }, () => 'plain') };
const defs = pack.definitions;
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);

function withCards(spec) {
  const s = createGame({ names: ['А', 'Б', 'В'], seed: 6 }, pack);
  spec.forEach(({ player = 0, definitionId, upgraded = false, stored }, i) => {
    s.players[player].cards.push({
      id: `c${i}`, definitionId, upgraded, usedRound: 0, manager: null, local: null,
      ...(stored ? { stored } : {}),
    });
  });
  s.players.forEach(p => { p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10 }; });
  return s;
}
function toProduction(s) {
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  return s;
}
function drain(s, cardId) {
  s = act(s, 'UseCard', { cardId });
  let guard = 0;
  while (s.production.active && guard++ < 20) s = act(s, 'NextEffect');
  return s;
}

/* ---------- перебитая ставка ---------- */
test('металл ложится на карту, когда вашу верхнюю ставку перебивают', () => {
  let s = withCards([{ player: 0, definitionId: 'vault' }]);
  const lot = s.lots[0].id;
  s = as(s, 'p0', 'Bid', { discId: 'fixed2', lotId: lot });
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored ?? null, null, 'пока никто не перебил');
  s = as(s, 'p1', 'Bid', { discId: 'fixed3', lotId: lot });
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored.metal, 1);
  assert.ok(s.events.some(e => e.type === 'StoredOnCard' && e.reason === 'outbid' && e.playerId === 'p0'));
});

test('ставка ниже верхней ничего не кладёт', () => {
  let s = withCards([{ player: 0, definitionId: 'vault' }]);
  const lot = s.lots[0].id;
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: lot });
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: lot });
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored ?? null, null);
});

test('перебивать собственную ставку смысла нет', () => {
  let s = withCards([{ player: 0, definitionId: 'vault' }]);
  s.players[0].ability = 'unrestricted-bids';   // Моника может положить второй диск
  const lot = s.lots[0].id;
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: lot });
  s = as(s, 'p1', 'Bid', { discId: 'fixed2', lotId: s.lots[1].id });
  s = as(s, 'p2', 'Bid', { discId: 'fixed2', lotId: s.lots[2].id });
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: lot });
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored ?? null, null, 'сам себя не перебивает');
});

test('постоянный эффект модернизированной стороны не работает до модернизации', () => {
  let s = withCards([{ player: 0, definitionId: 'lateVault' }]);
  const lot = s.lots[0].id;
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: lot });
  s = as(s, 'p1', 'Bid', { discId: 'fixed4', lotId: lot });
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored ?? null, null);

  let t = withCards([{ player: 0, definitionId: 'lateVault', upgraded: true }]);
  const lot2 = t.lots[0].id;
  t = as(t, 'p0', 'Bid', { discId: 'fixed1', lotId: lot2 });
  t = as(t, 'p1', 'Bid', { discId: 'fixed4', lotId: lot2 });
  assert.equal(t.players[0].cards.find(c => c.id === 'c0').stored.metal, 1);
});

test('накопленное забирается одной строкой и переживает раунд', () => {
  let s = withCards([{ player: 0, definitionId: 'vault', stored: { metal: 3 } }]);
  s = toProduction(s);
  const before = s.players[0].wallet.metal;
  s = drain(s, 'c0');
  assert.equal(s.players[0].wallet.metal, before + 3);
  assert.equal(s.players[0].cards.find(c => c.id === 'c0').stored.metal, 0, 'карта опустела');
  assert.ok(s.events.some(e => e.type === 'TookFromCard' && e.amount === 3));
});

test('пустая карта отдаёт ноль и не ломается', () => {
  let s = toProduction(withCards([{ player: 0, definitionId: 'vault' }]));
  const before = s.players[0].wallet.metal;
  s = drain(s, 'c0');
  assert.equal(s.players[0].wallet.metal, before);
  assert.equal(s.events.find(e => e.type === 'TookFromCard').amount, 0);
});

/* ---------- надбавка к добыче ---------- */
test('каждая добыча угля приносит дополнительный уголь', () => {
  let s = toProduction(withCards([
    { player: 0, definitionId: 'mineBoost' },
    { player: 0, definitionId: 'digger' },
  ]));
  const before = s.players[0].wallet.coal, beforeMetal = s.players[0].wallet.metal;
  s = drain(s, 'c1');
  // Две строки добычи: уголь 2 + 1 надбавка, металл без изменений.
  assert.equal(s.players[0].wallet.coal, before + 3);
  assert.equal(s.players[0].wallet.metal, beforeMetal + 1, 'надбавка только к своему ресурсу');
});

test('без карты с надбавкой добыча обычная', () => {
  let s = toProduction(withCards([{ player: 0, definitionId: 'digger' }]));
  const before = s.players[0].wallet.coal;
  s = drain(s, 'c0');
  assert.equal(s.players[0].wallet.coal, before + 2);
});

/* ---------- лишнее применение продаж ---------- */
test('продажа одного вида ресурса применяется на раз больше', () => {
  let s = toProduction(withCards([
    { player: 0, definitionId: 'guild' },
    { player: 0, definitionId: 'shop' },
  ]));
  s = act(s, 'UseCard', { cardId: 'c1' });
  // Первая строка продаёт только уголь: кратность 1 превращается в 2.
  s = act(s, 'Convert', { times: 2 });
  s = act(s, 'NextEffect');
  // Вторая строка продаёт уголь И металл — прибавки нет.
  assert.throws(() => act(s, 'Convert', { times: 2 }), e => e.code === 'INVALID_COUNT');
  s = act(s, 'Convert', { times: 1 });
});

test('без гильдии кратность прежняя', () => {
  let s = toProduction(withCards([{ player: 0, definitionId: 'shop' }]));
  s = act(s, 'UseCard', { cardId: 'c0' });
  assert.throws(() => act(s, 'Convert', { times: 2 }), e => e.code === 'INVALID_COUNT');
});

/* ---------- уголь модернизации на карте ---------- */
test('уголь, потраченный на модернизацию, ложится на карту и тратится только ею', () => {
  let s = toProduction(withCards([
    { player: 0, definitionId: 'foundry' },
    { player: 0, definitionId: 'plain' },
  ]));
  const p = () => s.players[0];
  p().wallet = { ...emptyWallet(), coal: 5, upgrade: 3 };

  // модернизируем соседнюю карту по эффекту стартового предприятия
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'c1' });
  const foundryCard = () => s.players[0].cards.find(c => c.id === 'c0');
  assert.equal(foundryCard().stored.coal, 1, 'уголь модернизации лёг на литейную');
  assert.ok(s.events.some(e => e.type === 'StoredOnCard' && e.reason === 'upgrade'));

  guard = 0;
  while (s.production.active && guard++ < 10) s = act(s, 'NextEffect');

  // на карте лежит 1 уголь, строке нужно 2 — применить нельзя
  s = act(s, 'UseCard', { cardId: 'c0' });
  assert.throws(() => act(s, 'Convert', { times: 1 }), e => e.code === 'INSUFFICIENT_RESOURCES');
  // докладываем уголь на карту и пробуем снова
  s.players[0].cards.find(c => c.id === 'c0').stored = { coal: 4 };
  const walletBefore = { ...s.players[0].wallet };
  s = act(s, 'Convert', { times: 2 });
  assert.equal(s.players[0].wallet.upgrade, walletBefore.upgrade + 2);
  assert.equal(s.players[0].wallet.coal, walletBefore.coal, 'общий запас угля не тронут');
  assert.equal(foundryCard().stored.coal, 0, 'потрачен уголь с карты');
});

/* ---------- каталог ---------- */
test('все 24 карты дополнения описываются движком', () => {
  const unfinished = interbellumCompanies.filter(c => companyNeeds(c).length);
  assert.deepEqual(unfinished.map(c => c.id), [], 'остались нереализованные карты');
});

test('постоянный эффект и «возьмите всё с карты» не бывают компенсацией', () => {
  for (const compensation of [
    { kind: 'permanent', rule: 'bonus-on-gain', resource: 'coal' },
    { kind: 'take-stored', resource: 'metal' },
  ]) {
    const bad = { ...pack, definitions: { ...definitions, plain: { ...plain, compensation } } };
    assert.throws(() => createGame({ names: ['А', 'Б', 'В'] }, bad), e => e.code === 'UNSUPPORTED_EFFECT');
  }
});

test('неизвестное правило постоянного эффекта отвергается', () => {
  const bad = {
    ...pack,
    definitions: { ...definitions, plain: { ...plain, effects: [{ kind: 'permanent', rule: 'выдумка', text: 'что-то' }] } },
  };
  assert.throws(() => createGame({ names: ['А', 'Б', 'В'] }, bad), e => e.code === 'UNSUPPORTED_EFFECT');
});
