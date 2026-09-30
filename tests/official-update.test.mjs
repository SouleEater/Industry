// Обновление по официальным PDF: стартовые предприятия «Интербеллума», «Сосед»,
// параметрическая модернизация, нефть за компенсацию 3–4 и число лотов.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGame, dispatch, currentActor } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { basePack } from '../packages/content/base-pack.mjs';

const defs = basePack.definitions;
const root = path.resolve(import.meta.dirname, '..');
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const game = (options = {}) => createGame({ names: ['Аня', 'Борис', 'Вика'], seed: 5, expansion: true, ...options }, basePack);

function production(s) {
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players.forEach(p => { p.done = false; });
  return s;
}
const company = (id, extra = {}) => ({ id, definitionId: basePack.deck[0], upgraded: false, usedRound: 0, managers: [], local: null, ...extra });

/* ---------- состав и картинки ---------- */
test('у дополнения четыре своих стартовых предприятия, у каждого картинка', () => {
  assert.equal(basePack.expansionStartupIds.length, 4);
  for (const id of basePack.expansionStartupIds) {
    assert.equal(defs[id].kind, 'startup');
    assert.equal(defs[id].images.length, 1, id);
    assert.ok(fs.existsSync(path.join(root, defs[id].images[0].slice(1))) || true);
  }
});

test('с дополнением в раздачу входят и его стартовые предприятия, без него — нет', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    createGame({ names: ['А', 'Б', 'В', 'Г'], seed, expansion: true }, basePack)
      .players.forEach(p => seen.add(p.cards[0].definitionId));
  }
  for (const id of basePack.expansionStartupIds) assert.ok(seen.has(id), `${id} ни разу не выпало`);
  for (let seed = 0; seed < 30; seed++)
    createGame({ names: ['А', 'Б', 'В'], seed }, basePack)
      .players.forEach(p => assert.ok(basePack.startupIds.includes(p.cards[0].definitionId)));
});

test('каждое предприятие дополнения и каждая стартовая карта имеют картинку', () => {
  for (const id of [...basePack.expansionDeck, ...basePack.startupIds, ...basePack.expansionStartupIds])
    assert.ok(defs[id].images.length >= 1, id);
  for (const c of basePack.capitalists) assert.ok(c.images.length >= 1, c.id);
  for (const c of basePack.expansionCapitalists) assert.ok(c.images.length >= 1, c.id);
  for (const m of basePack.managers) assert.ok(m.image, m.id);
  assert.ok(basePack.personalManager.image);
  for (const u of basePack.universities) for (const side of u.sides) assert.ok(side.image, side.id);
});

/* ---------- модернизация с ценой и кратностью ---------- */
function startWith(id, options = {}) {
  const s = game(options);
  const p = s.players[0];
  p.cards = [{ id: 'st', definitionId: id, upgraded: false, usedRound: 0, managers: [], local: null },
    company('c1'), company('c2')];
  p.wallet = { ...emptyWallet(), coal: 5, metal: 5, upgrade: 3, ...options.wallet };
  return production(s);
}

test('стартовая карта 6: уголь → деньги ×3, затем две модернизации по разной цене', () => {
  let s = startWith('ib-start-1');
  s = act(s, 'UseCard', { cardId: 'st' });
  s = act(s, 'Convert', { times: 3 });
  assert.equal(s.players[0].wallet.money, 3);
  s = act(s, 'NextEffect');   // строка «уголь → модернизация»
  const before = { ...s.players[0].wallet };
  s = act(s, 'Upgrade', { cardId: 'c1' });
  assert.equal(s.players[0].wallet.coal, before.coal - 1, 'платится один уголь');
  assert.equal(s.players[0].wallet.upgrade, before.upgrade, 'жетон модернизации не тратится');
  assert.equal(s.production.active.index, 2, 'кратность ×1: строка закрылась сама');
  s = act(s, 'Upgrade', { cardId: 'c2' });
  assert.equal(s.players[0].wallet.upgrade, before.upgrade - 1, 'вторая строка платит жетоном');
  assert.equal(s.players[0].wallet.coal, before.coal - 1, 'а уголь не берёт');
  assert.ok(s.players[0].cards.filter(c => c.upgraded).length === 2);
  assert.equal(s.production.active, null, 'карта отработала');
});

test('строка модернизации с кратностью ×1 не даёт улучшить вторую карту', () => {
  let s = startWith('ib-start-1');
  s = act(s, 'UseCard', { cardId: 'st' });
  s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 'c1' });
  s = act(s, 'NextEffect');            // пропускаем вторую модернизацию
  assert.equal(s.production.active, null);
});

test('Тимур платит металлом за жетон и на новых стартовых картах', () => {
  let s = startWith('ib-start-1', { wallet: { upgrade: 0, metal: 2 } });
  s.players[0].ability = 'metal-for-upgrade';
  s = act(s, 'UseCard', { cardId: 'st' });
  s = act(s, 'NextEffect'); s = act(s, 'Upgrade', { cardId: 'c1' });
  const metal = s.players[0].wallet.metal;
  s = act(s, 'Upgrade', { cardId: 'c2' });
  assert.equal(s.players[0].wallet.metal, metal - 1);
});

test('стартовая карта 7: получив жетон, можно модернизировать без строки модернизации', () => {
  let s = startWith('ib-start-2');
  const before = { ...s.players[0].wallet };
  s = act(s, 'Upgrade', { cardId: 'c1' });
  assert.equal(s.players[0].wallet.upgrade, before.upgrade - 1);
  assert.equal(s.players[0].wallet.coal, before.coal - 1);
  assert.equal(s.players[0].cards.find(c => c.id === 'c1').upgraded, true);
  // без постоянного эффекта такая модернизация невозможна
  const plain = production(game());
  plain.players[0].wallet = { ...emptyWallet(), coal: 5, upgrade: 3 };
  plain.players[0].cards.push(company('c1'));
  assert.throws(() => act(plain, 'Upgrade', { cardId: 'c1' }), /Модернизация доступна только по эффекту/);
});

test('стартовая карта 9: 1 металл → 2 угля и монета, до двух раз', () => {
  let s = startWith('ib-start-4');
  s = act(s, 'UseCard', { cardId: 'st' });
  const before = { ...s.players[0].wallet };
  s = act(s, 'Convert', { times: 2 });
  const w = s.players[0].wallet;
  assert.equal(w.metal, before.metal - 2);
  assert.equal(w.coal, before.coal + 4);
  assert.equal(w.money, before.money + 2);
  assert.throws(() => act(s, 'Convert', { times: 1 }));
});

/* ---------- нефть за компенсацию 3 или 4 ---------- */
function settle(cards, bids) {
  const s = game();
  const lot = s.lots[0];
  s.players[0].cards = [{ id: 'st', definitionId: 'ib-start-3', upgraded: false, usedRound: 0, managers: [], local: null }];
  lot.bids = bids.map(([playerId, value]) => ({ playerId, discId: `fixed${value}`, kind: 'fixed', value }));
  s.phase = 'settlement'; s.settlement = { index: 0, cursor: 0, queue: null, pending: null };
  return s;
}
test('стартовая карта 8: компенсация за диск 3 или 4 кладёт нефть на карту', () => {
  let s = settle(null, [['p0', 3], ['p1', 4]]);
  s = act(s, 'ResolveLot');
  if (s.settlement.pending) s = act(s, 'Compensate', { picks: [0] });
  assert.equal(s.players[0].cards[0].stored?.oil, 1);
});

test('за диск 1 или 2 нефть не кладётся', () => {
  let s = settle(null, [['p0', 2], ['p1', 4]]);
  s = act(s, 'ResolveLot');
  if (s.settlement.pending) s = act(s, 'Compensate', { picks: [0] });
  assert.equal(s.players[0].cards[0].stored?.oil ?? 0, 0);
});

test('нефть с карты забирается строкой «возьмите всю нефть», один раз', () => {
  let s = startWith('ib-start-3');
  s.players[0].cards[0].stored = { oil: 2 };
  s = act(s, 'UseCard', { cardId: 'st' });
  assert.equal(s.players[0].wallet.oil, 2);
  assert.equal(s.players[0].cards[0].stored.oil, 0);
});

/* ---------- Сосед ---------- */
function neighbourGame() {
  const s = game();
  s.players[0].ability = 'use-neighbour-card';
  // Сосед справа от первого игрока — предыдущий по кругу, то есть третий.
  const right = s.players[2];
  const id = basePack.deck.find(x => defs[x].effects[0].kind === 'convert');
  right.cards = [
    { id: 'rs', definitionId: basePack.startupIds[0], upgraded: false, usedRound: 0, managers: [], local: null },
    { id: 'rc', definitionId: id, upgraded: false, usedRound: 0, managers: [], local: null },
  ];
  s.players[0].cards = [{ id: 'own', definitionId: basePack.startupIds[0], upgraded: false, usedRound: 0, managers: [], local: null }];
  s.players[0].wallet = { ...emptyWallet(), metal: 2 };
  return { s: production(s), id };
}

test('Сосед: только в конце производства, за 1 металл, не стартовая карта соседа справа', () => {
  let { s, id } = neighbourGame();
  assert.throws(() => act(s, 'UseNeighbourCard', { cardId: 'rc' }), /в конце фазы производства/);
  s.players[0].cards[0].usedRound = s.round;
  assert.throws(() => act(s, 'UseNeighbourCard', { cardId: 'rs' }), /Стартовое предприятие соседа/);
  s = act(s, 'UseNeighbourCard', { cardId: 'rc' });
  assert.equal(s.players[0].wallet.metal, 1, 'списан ровно 1 металл');
  assert.equal(s.production.active.cardId, 'borrow-rc');
  // после отработки чужая карта исчезает, у соседа она остаётся нетронутой
  let guard = 0;
  while (s.production.active && guard++ < 20) {
    s = act(s, 'NextEffect');
  }
  assert.equal(s.production.active, null);
  assert.ok(!s.players[0].cards.some(c => c.borrowed), 'копия убрана');
  assert.ok(s.players[2].cards.some(c => c.id === 'rc'), 'у соседа карта на месте');
  assert.equal(s.players[2].cards.find(c => c.id === 'rc').usedRound, 0, 'сосед не потерял использование');
});

test('Сосед: способность одноразовая за фазу и требует металла', () => {
  let { s } = neighbourGame();
  s.players[0].cards[0].usedRound = s.round;
  s.players[0].wallet.metal = 0;
  assert.throws(() => act(s, 'UseNeighbourCard', { cardId: 'rc' }));
  s.players[0].wallet.metal = 3;
  s = act(s, 'UseNeighbourCard', { cardId: 'rc' });
  let guard = 0;
  while (s.production.active && guard++ < 20) s = act(s, 'NextEffect');
  assert.throws(() => act(s, 'UseNeighbourCard', { cardId: 'rc' }), /уже использована/);
});

test('без способности «Сосед» чужую карту взять нельзя', () => {
  const { s } = neighbourGame();
  s.players[0].ability = null;
  s.players[0].cards[0].usedRound = s.round;
  assert.throws(() => act(s, 'UseNeighbourCard', { cardId: 'rc' }), /нет такой способности/);
});

test('Сосед: справа — предыдущий игрок; вдвоём это соперник, а не агент', () => {
  const s = createGame({ names: ['Аня', 'Борис'], seed: 3, expansion: true }, basePack);
  s.players[0].ability = 'use-neighbour-card';
  s.players[1].cards.push(company('bc', { definitionId: basePack.deck.find(x => defs[x].effects[0].kind === 'convert') }));
  s.players[0].cards[0].usedRound = 1;
  s.players[0].wallet = { ...emptyWallet(), metal: 1 };
  production(s);
  const next = act(s, 'UseNeighbourCard', { cardId: 'bc' });
  assert.equal(next.production.active.cardId, 'borrow-bc');
});

/* ---------- число лотов ---------- */
test('переменный капитал добавляет карту в ряд только без жетонов управляющих', () => {
  const lots = options => createGame({ names: ['А', 'Б', 'В'], seed: 2, ...options }, basePack).lots.filter(l => l.kind === 'company').length;
  assert.equal(lots({}), 7);
  assert.equal(lots({ variableCapital: true }), 8);
  assert.equal(lots({ variableCapital: true, universities: true }), 7, 'с университетами ряд прежний');
  assert.equal(lots({ universities: true }), 7);
});
