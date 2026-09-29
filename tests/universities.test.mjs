import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, currentActor, bidError } from '../packages/domain/engine.mjs';
import { canPay } from '../packages/domain/rules.mjs';
import { basePack } from '../packages/content/base-pack.mjs';
import { universityCards, auctionManagers, managerTokens, personalManager } from '../packages/content/interbellum.mjs';

const defs = basePack.definitions;
const game = (o = {}) => createGame({ names: ['Аня', 'Борис', 'Вика'], seed: 31, universities: true, ...o }, basePack);
const as = (s, id, type, payload = {}) => dispatch(s, { type, actorId: id, ...payload }, defs);
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const unis = s => s.lots.filter(l => l.kind === 'university');
const DEFS_KINDS = ['company', 'startup'];

/** Доводит аукцион до конца, раскладывая диски по первым легальным местам. */
function fillAuction(s, { avoid = [] } = {}) {
  let guard = 0, offset = 0;
  while (s.phase === 'auction' && guard++ < 400) {
    const me = s.players.find(p => p.id === currentActor(s));
    let placed = false;
    // Сдвиг обязателен: иначе диски всегда ложатся на левые лоты и до университетов,
    // стоящих в конце ряда, ставки просто не доходят.
    outer: for (const d of me.discs) {
      if (d.used) continue;
      for (let i = 0; i < s.lots.length; i++) {
        const l = s.lots[(i + offset) % s.lots.length];
        if (avoid.includes(l.id)) continue;
        if (!bidError(s, me.id, d.id, l.id, d.value)) {
          s = as(s, me.id, 'Bid', { discId: d.id, lotId: l.id }); placed = true; offset++; break outer;
        }
      }
    }
    if (!placed) break;
  }
  return s;
}
/** Разбирает лоты, отказываясь от всех компенсаций. */
function settle(s) {
  let guard = 0;
  while (s.phase === 'settlement' && guard++ < 400) {
    const pend = s.settlement.pending;
    s = pend ? as(s, pend.playerId, 'Compensate', { picks: pend.options.map(() => 0) }) : act(s, 'ResolveLot');
  }
  return s;
}

/* ---------- состав и раскладка ---------- */
test('в дополнении три карты университетов, у каждой две стороны', () => {
  assert.equal(universityCards.length, 3);
  for (const card of universityCards) {
    assert.equal(card.sides.length, 2);
    for (const side of card.sides) assert.equal(side.options.length, 2, 'на стороне ровно два варианта компенсации');
  }
});

test('жетонов управляющих 15: 14 в стопке и один личный', () => {
  assert.equal(managerTokens.length, 14, '14 обычных жетонов');
  assert.equal(personalManager.personal, true, 'плюс личный жетон промышленника');
  assert.equal(auctionManagers.length, 14, 'все обычные жетоны разыгрываются на аукционе');
  assert.equal(new Set(auctionManagers.map(t => t.id)).size, 14, 'идентификаторы уникальны');
  assert.equal(auctionManagers.includes(personalManager), false, 'личный жетон в стопку не входит');
});

test('на 1–3 игроков выкладывают две карты, на 4–5 — три', () => {
  for (const [count, expected] of [[2, 2], [3, 2], [4, 3]]) {
    const s = game({ names: Array.from({ length: count }, (_, i) => `И${i + 1}`) });
    assert.equal(s.tables.length, expected, `${count} игрока`);
    assert.equal(unis(s).length, expected);
  }
});

test('университеты стоят в самом конце ряда', () => {
  const s = game();
  const kinds = s.lots.map(l => l.kind);
  assert.deepEqual(kinds, [...Array(7).fill('company'), 'university', 'university'],
    'втроём: семь предприятий, затем два университета на 8-й и 9-й позициях');
});

test('на каждый университет кладётся жетон из стопки лицом вверх', () => {
  const s = game();
  const tokens = unis(s).map(l => l.token);
  assert.equal(tokens.every(t => typeof t === 'string'), true);
  assert.equal(new Set(tokens).size, tokens.length, 'жетоны разные');
  assert.equal(s.managerDeck.length, auctionManagers.length - tokens.length, 'взяты из стопки');
});

test('без университетов ничего лишнего не появляется', () => {
  const s = game({ universities: false });
  assert.equal(s.tables.length, 0);
  assert.equal(unis(s).length, 0);
  assert.equal(s.lots.length, 7);
});

/* ---------- ставки и разбор ---------- */
test('на университет ставят по обычным правилам', () => {
  let s = game();
  const uni = unis(s)[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed3', lotId: uni.id });
  assert.equal(s.lots.find(l => l.id === uni.id).bids.length, 1);
  assert.throws(() => as(s, 'p1', 'Bid', { discId: 'fixed3', lotId: uni.id }), e => e.code === 'ILLEGAL_BID');
  s = as(s, 'p1', 'Bid', { discId: 'fixed2', lotId: uni.id });
  assert.throws(() => as(s, 'p2', 'Bid', { discId: 'fixed3', lotId: uni.id }), e => e.code === 'ILLEGAL_BID');
  s = as(s, 'p2', 'Bid', { discId: 'fixed1', lotId: uni.id });
  assert.equal(s.lots.find(l => l.id === uni.id).bids.length, 3, 'три разных значения уживаются');
});

test('победитель забирает жетон, а карта остаётся в ряду', () => {
  let s = game();
  const uni = unis(s)[0];
  const token = uni.token;
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: uni.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: uni.id });
  s = fillAuction(s);
  s = settle(s);

  assert.deepEqual(s.players[0].managers, [token], 'жетон ушёл владельцу старшего диска');
  for (const p of s.players) {
    const won = s.events.filter(e => e.type === 'CardWon' && e.playerId === p.id).length;
    assert.equal(p.cards.length, 1 + won, `${p.name}: в линии только стартовое и выигранные предприятия`);
    assert.equal(p.cards.some(c => !DEFS_KINDS.includes(defs[c.definitionId].kind)), false,
      'в линии нет ничего, кроме предприятий');
  }
  assert.equal(s.lots.find(l => l.id === uni.id).token, null, 'жетон снят с карты');
  assert.ok(s.events.some(e => e.type === 'ManagerWon' && e.playerId === 'p0' && e.token === token));
});

test('если на университете нет дисков, жетон сбрасывается', () => {
  let s = game();
  const uni = unis(s)[0];
  s = fillAuction(s, { avoid: [uni.id] });
  s = settle(s);
  assert.equal(s.players.every(p => p.managers.length === 0 || !p.managers.includes(uni.token)), true);
  assert.ok(s.events.some(e => e.type === 'ManagerDiscarded'));
  assert.ok(s.managerDiscard.includes(uni.token));
});

test('университеты разбираются после всех предприятий', () => {
  let s = game();
  s = fillAuction(s);
  const order = [];
  let guard = 0;
  while (s.phase === 'settlement' && guard++ < 400) {
    const pend = s.settlement.pending;
    if (!pend) order.push(s.lots[s.settlement.index].kind);
    s = pend ? as(s, pend.playerId, 'Compensate', { picks: pend.options.map(() => 0) }) : act(s, 'ResolveLot');
  }
  const firstUni = order.indexOf('university');
  assert.ok(firstUni > 0, 'университеты были разобраны');
  assert.equal(order.slice(firstUni).every(k => k === 'university'), true,
    'после первого университета предприятий уже не разбирают');
});

/* ---------- делимая компенсация ---------- */
test('единицы компенсации делятся между двумя вариантами', () => {
  let s = game();
  const uni = unis(s)[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: uni.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed3', lotId: uni.id });
  s = fillAuction(s);
  let guard = 0;
  while (s.phase === 'settlement' && !s.settlement.pending?.lotId?.includes('u') && guard++ < 400) {
    const pend = s.settlement.pending;
    s = pend ? as(s, pend.playerId, 'Compensate', { picks: pend.options.map(() => 0) }) : act(s, 'ResolveLot');
  }
  const pend = s.settlement.pending;
  assert.ok(pend, 'проигравший на университете должен получить выбор');
  assert.equal(pend.options.length, 2, 'вариантов два');
  assert.equal(pend.playerId, 'p1');
  assert.equal(pend.limit, 3, 'диск 3 даёт три единицы');

  const p = s.players.find(x => x.id === 'p1');
  const before = { ...p.wallet };
  const [a, b] = pend.options;
  // Берём два раза первый вариант и, если хватает сырья, один раз второй.
  const second = b.kind === 'gain' || canPay(p.wallet, b.cost) ? 1 : 0;
  s = as(s, 'p1', 'Compensate', { picks: [2, second] });
  const after = s.players.find(x => x.id === 'p1').wallet;

  for (const [k, v] of Object.entries(a.gain ?? {})) {
    const fromB = second && b.kind === 'gain' ? (b.gain[k] ?? 0) : 0;
    const spent = second && b.kind === 'convert' ? (b.cost[k] ?? 0) : 0;
    const gotB = second && b.kind === 'convert' ? (b.gain[k] ?? 0) : 0;
    assert.equal(after[k], before[k] + v * 2 + fromB - spent + gotB, `ресурс ${k}`);
  }
});

test('распределить больше, чем есть единиц, нельзя', () => {
  let s = game();
  const uni = unis(s)[0];
  s = as(s, 'p0', 'Bid', { discId: 'fixed4', lotId: uni.id });
  s = as(s, 'p1', 'Bid', { discId: 'fixed1', lotId: uni.id });
  s = fillAuction(s);
  let guard = 0;
  while (s.phase === 'settlement' && !s.settlement.pending && guard++ < 400) s = act(s, 'ResolveLot');
  while (s.phase === 'settlement' && s.settlement.pending && !s.settlement.pending.lotId.includes('u') && guard++ < 400) {
    const pend = s.settlement.pending;
    s = as(s, pend.playerId, 'Compensate', { picks: pend.options.map(() => 0) });
    while (s.phase === 'settlement' && !s.settlement.pending && guard++ < 400) s = act(s, 'ResolveLot');
  }
  const pend = s.settlement.pending;
  assert.ok(pend && pend.options.length === 2);
  assert.throws(() => as(s, pend.playerId, 'Compensate', { picks: [pend.limit + 1, 0] }), e => e.code === 'INVALID_COUNT');
  assert.throws(() => as(s, pend.playerId, 'Compensate', { picks: [1, 1, 1] }), e => e.code === 'INVALID_COUNT');
});

/* ---------- жетоны живут дальше ---------- */
test('жетоны остаются у игрока и стопки хватает на четыре раунда', () => {
  let s = createGame({ names: ['А', 'Б', 'В', 'Г'], seed: 12, universities: true }, basePack);
  assert.equal(s.tables.length, 3);
  let guard = 0;
  const wonByRound = [];
  while (s.phase !== 'finished' && guard++ < 9000) {
    const me = s.players.find(p => p.id === currentActor(s));
    if (s.phase === 'auction') {
      const before = s.round;
      s = fillAuction(s);
      if (s.phase === 'auction' && s.round === before) break;
    } else if (s.phase === 'settlement') {
      s = settle(s);
      wonByRound.push(s.players.map(p => p.managers.length));
    } else if (s.phase === 'planning') {
      s = act(s, 'ConfirmPlan');
    } else {
      if (s.production.active) s = act(s, 'NextEffect');
      else {
        const free = me.cards.filter(c => c.usedRound !== s.round);
        s = free.length ? act(s, 'UseCard', { cardId: free[0].id }) : act(s, 'FinishProduction');
      }
    }
  }
  assert.equal(s.phase, 'finished');
  const total = s.players.reduce((n, p) => n + p.managers.length, 0);
  assert.ok(total > 0, 'хотя бы один жетон должен был уйти игрокам');
  assert.ok(s.managerDeck.length >= 0);
  // Жетоны не теряются: у игроков плюс сброс равно розданным с университетов.
  const handed = s.events.filter(e => ['ManagerWon', 'ManagerDiscarded', 'AgentTookManager'].includes(e.type)).length;
  assert.equal(total + s.managerDiscard.length, handed, 'жетоны не появляются и не исчезают');
  // Ни один раунд не мог остаться без жетонов на столах.
  assert.equal(handed, 3 * 4, 'три университета за четыре раунда');
});

test('на итог университеты не влияют', () => {
  let s = game();
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 9000) {
    const me = s.players.find(p => p.id === currentActor(s));
    if (s.phase === 'auction') { const r = s.round; s = fillAuction(s); if (s.phase === 'auction' && s.round === r) break; }
    else if (s.phase === 'settlement') s = settle(s);
    else if (s.phase === 'planning') s = act(s, 'ConfirmPlan');
    else if (s.production.active) s = act(s, 'NextEffect');
    else {
      const free = me.cards.filter(c => c.usedRound !== s.round);
      s = free.length ? act(s, 'UseCard', { cardId: free[0].id }) : act(s, 'FinishProduction');
    }
  }
  assert.equal(s.phase, 'finished');
  for (const row of s.result) {
    const p = s.players.find(x => x.name === row.name);
    assert.equal(row.companies, p.cards.length, 'считаются только предприятия, жетоны в счёт не идут');
  }
});

test('агент не копит жетоны управляющих', () => {
  let s = createGame({ names: ['А', 'Б'], seed: 77, universities: true }, basePack);
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 400) {
    const before = s.revision;
    s = fillAuction(s);
    if (s.revision === before) break;
  }
  s = settle(s);
  const agent = s.players.find(p => p.agent);
  assert.deepEqual(agent.managers, []);
  for (const e of s.events.filter(e => e.type === 'AgentTookManager'))
    assert.ok(s.managerDiscard.includes(e.token), 'жетон агента выбывает из игры');
});
