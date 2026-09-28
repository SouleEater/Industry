import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, activeEffect, productionRows, bidError } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { interbellumCompanies, companyNeeds } from '../packages/content/interbellum-companies.mjs';

/* Отдельный пакет: карты дополнения в игровую колоду пока не подмешаны,
   поэтому поставки проверяются на собственном наборе. */
const startup = {
  name: 'Штаб', kind: 'startup', starting: { coal: 2 },
  effects: [{ kind: 'gain', gain: { upgrade: 1 } }, { kind: 'upgrade' }], advanced: [],
};
const supplyGain = {
  name: 'Промысел', kind: 'company',
  compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'supply', of: { kind: 'gain', gain: { coal: 3 } } }, { kind: 'gain', gain: { metal: 1 } }],
  advanced: [{ kind: 'supply', of: { kind: 'gain', gain: { oil: 2 } } }],
};
const supplyConvert = {
  name: 'Завод', kind: 'company',
  compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { metal: 1 } }],
  advanced: [{ kind: 'supply', of: { kind: 'convert', cost: { metal: 1 }, gain: { money: 2 }, limit: 3 } }],
};
const plain = {
  name: 'Шахта', kind: 'company',
  compensation: { kind: 'gain', gain: { coal: 1 } },
  effects: [{ kind: 'gain', gain: { coal: 1 } }], advanced: [{ kind: 'gain', gain: { coal: 2 } }],
};
const definitions = { startup, 'supply-gain': supplyGain, 'supply-convert': supplyConvert, plain };
const deck = Array.from({ length: 40 }, (_, i) => ['supply-gain', 'supply-convert', 'plain'][i % 3]);
const pack = { version: 'supply-test', startupId: 'startup', definitions, deck };

const defs = pack.definitions;
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);

/** Партия, доведённая до производства, с нужной картой в линии первого игрока. */
function staged(definitionId, { upgraded = false, wallet = {} } = {}) {
  const s = createGame({ names: ['А', 'Б', 'В'], seed: 3 }, pack);
  const p = s.players[0];
  p.cards.push({ id: 'x', definitionId, upgraded, usedRound: 0, manager: null, local: null });
  p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10, ...wallet };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  return s;
}

test('строка поставки не попадает в очередь производства', () => {
  const card = { definitionId: 'supply-gain', upgraded: false };
  assert.deepEqual(productionRows(card, supplyGain), [{ kind: 'gain', gain: { metal: 1 } }]);
  const up = { definitionId: 'supply-gain', upgraded: true };
  assert.deepEqual(productionRows(up, supplyGain), [{ kind: 'gain', gain: { metal: 1 } }],
    'поставка модернизированной стороны тоже вне очереди');
});

test('поставка обычной стороны срабатывает сразу при получении карты', () => {
  let s = createGame({ names: ['А', 'Б', 'В'], seed: 3 }, pack);
  const lot = s.lots.find(l => l.card.definitionId === 'supply-gain');
  assert.ok(lot, 'в раскладе нет карты с поставкой');
  const before = s.players[0].wallet.coal;

  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: lot.id });
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 200) {
    const me = s.players.find(p => p.id === currentActor(s));
    let placed = false;
    outer: for (const d of me.discs) {
      if (d.used) continue;
      for (const l of s.lots) if (!bidError(s, me.id, d.id, l.id, d.value)) {
        s = as(s, me.id, 'Bid', { discId: d.id, lotId: l.id }); placed = true; break outer;
      }
    }
    if (!placed) break;
  }
  guard = 0;
  while (s.phase === 'settlement' && guard++ < 400) {
    const pend = s.settlement.pending;
    s = pend ? as(s, pend.playerId, 'Compensate', { picks: pend.options.map(() => 0) }) : act(s, 'ResolveLot');
  }
  // За аукцион игрок мог взять несколько таких карт, а компенсации тоже приносят уголь,
  // поэтому сверяем не итог кошелька, а число сработавших поставок.
  const won = s.players[0].cards.filter(c => c.definitionId === 'supply-gain').length;
  assert.ok(won >= 1, 'карта с поставкой не выиграна');
  const fired = s.events.filter(e => e.type === 'SupplyTaken' && e.side === 'basic' && e.playerId === 'p0');
  assert.equal(fired.length, won, 'поставка должна сработать на каждой выигранной карте');
  for (const e of fired) assert.deepEqual(e.gain, { coal: 3 });
  assert.ok(s.players[0].wallet.coal >= before + 3 * won, 'уголь поставок начислен');
  assert.deepEqual(s.supplies, [], 'добыча-поставка ничего не спрашивает');
});

test('поставка модернизированной стороны срабатывает при модернизации', () => {
  let s = staged('supply-gain');
  const before = s.players[0].wallet.oil;
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });
  assert.equal(s.players[0].cards.find(c => c.id === 'x').upgraded, true);
  assert.equal(s.players[0].wallet.oil, before + 2, 'поставка улучшенной стороны выдана сразу');
  assert.ok(s.events.some(e => e.type === 'SupplyTaken' && e.side === 'advanced'));
});

test('поставка работает даже если карта уже отработала в этом раунде', () => {
  let s = staged('supply-gain');
  s = act(s, 'UseCard', { cardId: 'x' });
  let guard = 0;
  while (s.production.active && guard++ < 10) s = act(s, 'NextEffect');
  assert.equal(s.players[0].cards.find(c => c.id === 'x').usedRound, s.round, 'карта отработала');
  const before = s.players[0].wallet.oil;
  s = act(s, 'UseCard', { cardId: 'start0' });
  guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });
  assert.equal(s.players[0].wallet.oil, before + 2);
});

test('поставка-переработка предлагается игроку и разыгрывается им', () => {
  let s = staged('supply-convert');
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });

  assert.equal(s.supplies.length, 1, 'переработка должна ждать решения');
  assert.equal(s.supplies[0].playerId, 'p0');
  assert.ok(s.events.some(e => e.type === 'SupplyOffered'));

  const before = { ...s.players[0].wallet };
  assert.throws(() => act(s, 'TakeSupply', { times: 4 }), e => e.code === 'INVALID_COUNT');
  s = act(s, 'TakeSupply', { times: 2 });
  assert.equal(s.players[0].wallet.metal, before.metal - 2);
  assert.equal(s.players[0].wallet.money, before.money + 4);
  assert.deepEqual(s.supplies, []);
});

test('от поставки-переработки можно отказаться', () => {
  let s = staged('supply-convert');
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });
  const before = { ...s.players[0].wallet };
  s = act(s, 'TakeSupply', { times: 0 });
  assert.deepEqual(s.players[0].wallet, before, 'отказ ничего не меняет');
  assert.deepEqual(s.supplies, []);
});

test('производство нельзя завершить, пока поставка не разыграна', () => {
  let s = staged('supply-convert');
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });
  guard = 0;
  while (s.production.active && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'UseCard', { cardId: 'x' });
  guard = 0;
  while (s.production.active && guard++ < 10) s = act(s, 'NextEffect');
  assert.throws(() => act(s, 'FinishProduction'), e => e.code === 'SUPPLY_PENDING');
  s = act(s, 'TakeSupply', { times: 0 });
  s = act(s, 'FinishProduction');
  assert.equal(s.players[0].done, true);
});

test('чужую поставку разыграть нельзя', () => {
  let s = staged('supply-convert');
  s = act(s, 'UseCard', { cardId: 'start0' });
  let guard = 0;
  while (activeEffect(s, defs)?.kind !== 'upgrade' && guard++ < 10) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'x' });
  assert.throws(() => as(s, 'p1', 'TakeSupply', { times: 1 }), e => e.code === 'NOT_YOUR_TURN');
});

test('поставка не может быть компенсацией', () => {
  const bad = {
    ...pack,
    definitions: { ...definitions, plain: { ...plain, compensation: { kind: 'supply', of: { kind: 'gain', gain: { coal: 1 } } } } },
  };
  assert.throws(() => createGame({ names: ['А', 'Б', 'В'] }, bad), e => e.code === 'UNSUPPORTED_EFFECT');
});

test('карты дополнения с одними поставками теперь описываются движком', () => {
  const ready = interbellumCompanies.filter(c => {
    const needs = companyNeeds(c);
    return needs.length === 0 || (needs.length === 1 && needs[0] === 'supply');
  });
  assert.equal(ready.length, 13, 'три готовых плюс десять с поставками');
  // Все их строки — то, что движок уже умеет.
  for (const c of ready) {
    for (const row of [c.compensation, ...c.basic, ...c.advanced]) {
      const e = row.kind === 'supply' ? row.of : row;
      assert.ok(['gain', 'convert'].includes(e.kind), `${c.id}: строка вида ${e.kind}`);
    }
  }
});
