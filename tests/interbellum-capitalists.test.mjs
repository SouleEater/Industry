import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, bidError, activeEffect } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { ABILITIES, variableBonus, stacksManagers } from '../packages/domain/capitalists.mjs';
import { basePack } from '../packages/content/base-pack.mjs';
import { interbellumCapitalists, playableInterbellumCapitalists } from '../packages/content/interbellum.mjs';

const defs = basePack.definitions;
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);

function game(options = {}) {
  return createGame({ names: ['Аня', 'Борис', 'Вика'], seed: 14, ...options }, basePack);
}
function withAbility(ability, options = {}) {
  const s = game(options);
  s.players[0].ability = ability;
  return s;
}

/* ---------- состав ---------- */
test('в дополнении четыре новых промышленника, три из них реализованы', () => {
  assert.equal(interbellumCapitalists.length, 4, 'пятая карта — обновлённый Артур, он заменяет базовую');
  assert.equal(playableInterbellumCapitalists.length, 3);
  const pending = interbellumCapitalists.filter(c => c.needs);
  assert.deepEqual(pending.map(c => c.ability), ['use-neighbour-card']);
  assert.ok(pending[0].notes.join(' ').length > 10, 'отложенный промышленник должен объяснять, почему');
});

test('все реализованные способности известны движку', () => {
  for (const c of playableInterbellumCapitalists)
    assert.ok(ABILITIES.includes(c.ability), c.ability);
  assert.equal(ABILITIES.length, 8);
});

test('с дополнением в раздачу входят промышленники дополнения', () => {
  const seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const s = createGame({
      names: ['А', 'Б', 'В', 'Г'], seed, capitalists: true,
      expansion: true, universities: true, variableCapital: true,
    }, basePack);
    s.players.forEach(p => seen.add(p.ability));
  }
  for (const c of playableInterbellumCapitalists)
    assert.ok(seen.has(c.ability), `${c.ability} ни разу не раздался`);
});

test('обновлённый Артур приходит вместе с дополнением', () => {
  assert.equal(game({ expansion: true }).config.pairedExtraDisc, true);
  assert.equal(game({ expansion: false }).config.pairedExtraDisc, false);
});

test('промышленники выключенных модулей в раздачу не попадают', () => {
  for (let seed = 0; seed < 30; seed++) {
    // Правила дополнения, «Отдельные модули», стр. 9.
    const noDiscs = createGame({ names: ['А', 'Б', 'В', 'Г'], seed, capitalists: true, expansion: true, universities: true }, basePack);
    assert.equal(noDiscs.players.some(p => p.ability === 'variable-plus-two'), false,
      'без переменных дисков этот промышленник не используется');
    const noManagers = createGame({ names: ['А', 'Б', 'В', 'Г'], seed, capitalists: true, expansion: true, variableCapital: true }, basePack);
    assert.equal(noManagers.players.some(p => p.ability === 'personal-manager'), false,
      'без жетонов управляющих этот промышленник не используется');
  }
});

/* ---------- Капиталист: +2 к переменному диску ---------- */
test('значение переменного диска на 2 больше потраченного угля', () => {
  assert.equal(variableBonus({ ability: 'variable-plus-two' }), 2);
  assert.equal(variableBonus({ ability: null }), 0);

  let s = withAbility('variable-plus-two', { variableCapital: true });
  s.players[0].wallet.coal = 6;
  const before = s.players[0].wallet.coal;
  s = as(s, 'p0', 'Bid', { discId: 'variable', lotId: s.lots[0].id, value: 3 });
  const bid = s.lots[0].bids[0];
  assert.equal(bid.value, 5, 'потрачено 3 угля, номинал 5');
  assert.equal(s.players[0].wallet.coal, before - 3, 'списан только потраченный уголь');
});

test('прибавка учитывается при проверке занятых значений', () => {
  let s = withAbility('variable-plus-two', { variableCapital: true });
  s.players[0].wallet.coal = 6;
  // Четвёрку на нужный лот кладёт соперник, чтобы у Капиталиста там своего диска не было.
  s = as(s, 'p0', 'Bid', { discId: 'fixed1', lotId: s.lots[5].id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed4', lotId: s.lots[0].id });
  s = as(s, 'p2', 'Bid', { discId: 'fixed1', lotId: s.lots[1].id });
  // 2 угля дадут номинал 4 — такое значение на лоте уже стоит.
  assert.ok(bidError(s, 'p0', 'variable', s.lots[0].id, 2), 'занятое значение должно отвергаться');
  assert.equal(bidError(s, 'p0', 'variable', s.lots[0].id, 3), null, '3 угля дают 5 — свободно');
});

test('нулевая ставка у Капиталиста даёт номинал 2', () => {
  let s = withAbility('variable-plus-two', { variableCapital: true });
  s = as(s, 'p0', 'Bid', { discId: 'variable', lotId: s.lots[0].id, value: 0 });
  assert.equal(s.lots[0].bids[0].value, 2);
});

/* ---------- Распорядитель: несколько управляющих ---------- */
test('несколько жетонов на одной карте разрешены только Распорядителю', () => {
  assert.equal(stacksManagers({ ability: 'personal-manager' }), true);
  assert.equal(stacksManagers({ ability: null }), false);

  let s = game({ universities: true });
  s.phase = 'planning'; s.turn = 0;
  const p = s.players[0];
  p.managers = ['money-per-sale', 'coal-per-sale'];
  const card = p.cards[0].id;
  const both = [{ cardId: card, token: 'money-per-sale' }, { cardId: card, token: 'coal-per-sale' }];

  assert.throws(() => act(s, 'PlaceManagers', { assignments: both }), e => e.code === 'INVALID_ASSIGNMENT');
  s.players[0].ability = 'personal-manager';
  s = act(s, 'PlaceManagers', { assignments: both });
  assert.deepEqual(s.players[0].cards[0].managers, ['money-per-sale', 'coal-per-sale']);
});

test('эффекты нескольких жетонов на одной карте складываются', () => {
  let s = game({ universities: true });
  const p = s.players[0];
  p.ability = 'personal-manager';
  const id = basePack.deck.find(x => defs[x].effects.some(e => e.kind === 'convert' && e.gain.money));
  p.cards.push({
    id: 'multi', definitionId: id, upgraded: false, usedRound: 0,
    managers: ['money-per-sale', 'coal-per-sale'], local: null,
  });
  p.wallet = { ...emptyWallet(), coal: 20, metal: 20, oil: 20, upgrade: 20 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };

  s = act(s, 'UseCard', { cardId: 'multi' });
  let guard = 0;
  while (s.production.active && guard++ < 12) {
    const e = activeEffect(s, defs);
    if (!e) break;
    if (e.kind === 'convert' && e.gain.money) {
      const before = { money: s.players[0].wallet.money, coal: s.players[0].wallet.coal };
      s = act(s, 'Convert', { times: 1 });
      const after = s.players[0].wallet;
      assert.equal(after.money - before.money, (e.gain.money ?? 0) + 1, 'надбавка деньгами');
      assert.equal(after.coal - before.coal, (e.gain.coal ?? 0) - (e.cost.coal ?? 0) + 1, 'надбавка углём');
      return;
    }
    s = act(s, 'NextEffect');
  }
  assert.fail('не нашлось строки продажи');
});

/* ---------- Компенсатор ---------- */
test('компенсация своей немодернизированной карты разыгрывается до обычных строк', () => {
  let s = withAbility('compensation-before-normal');
  const p = s.players[0];
  const id = basePack.deck.find(x => defs[x].compensation.kind === 'gain');
  p.cards.push({ id: 'own', definitionId: id, upgraded: false, usedRound: 0, managers: [], local: null });
  p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };

  s = act(s, 'UseCard', { cardId: 'own' });
  assert.equal(s.production.active.compensationLeft, true, 'движок должен ждать решения');
  assert.equal(s.production.active.index, 0, 'обычные строки ещё не тронуты');

  const comp = defs[id].compensation;
  const before = { ...s.players[0].wallet };
  s = act(s, 'UseOwnCompensation', { times: 1 });
  for (const [k, v] of Object.entries(comp.gain))
    assert.ok(s.players[0].wallet[k] >= before[k] + v, `компенсация не выдала ${k}`);
  assert.equal(s.production.active?.compensationLeft ?? false, false);
});

test('от своей компенсации можно отказаться', () => {
  let s = withAbility('compensation-before-normal');
  const p = s.players[0];
  const id = basePack.deck.find(x => defs[x].compensation.kind === 'gain');
  p.cards.push({ id: 'own', definitionId: id, upgraded: false, usedRound: 0, managers: [], local: null });
  p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s = act(s, 'UseCard', { cardId: 'own' });
  s = act(s, 'UseOwnCompensation', { times: 0 });
  // Сравнивать кошелёк целиком нельзя: после отказа карта сразу разыгрывает свои строки.
  assert.ok(s.events.some(e => e.type === 'OwnCompensationUsed' && e.times === 0));
  assert.equal(s.events.some(e => e.type === 'ConversionPerformed' && e.context === 'own-compensation'), false);
  assert.equal(s.production.active?.compensationLeft ?? false, false);
});

test('у модернизированной карты своей компенсации нет', () => {
  let s = withAbility('compensation-before-normal');
  const p = s.players[0];
  const id = basePack.deck.find(x => defs[x].advanced.length > 0);
  p.cards.push({ id: 'own', definitionId: id, upgraded: true, usedRound: 0, managers: [], local: null });
  p.wallet = { ...emptyWallet(), coal: 10, metal: 10, oil: 10, upgrade: 10 };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s = act(s, 'UseCard', { cardId: 'own' });
  assert.equal(s.production.active?.compensationLeft ?? false, false);
  assert.throws(() => act(s, 'UseOwnCompensation', { times: 1 }), e => e.code === 'NO_COMPENSATION');
});

test('без способности своя компенсация недоступна', () => {
  let s = game();
  const p = s.players[0];
  const id = basePack.deck[0];
  p.cards.push({ id: 'own', definitionId: id, upgraded: false, usedRound: 0, managers: [], local: null });
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s = act(s, 'UseCard', { cardId: 'own' });
  assert.throws(() => act(s, 'UseOwnCompensation', { times: 1 }), e => e.code === 'NO_COMPENSATION');
});
