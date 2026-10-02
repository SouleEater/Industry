// Регрессии по итогам аудита механики (01–02.10.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGame, dispatch, currentActor, convertCapacity, supplyCapacity, bidOutcome } from '../packages/domain/engine.mjs';
import { emptyWallet } from '../packages/domain/rules.mjs';
import { basePack } from '../packages/content/base-pack.mjs';

const defs = basePack.definitions;
const act = (s, type, payload = {}) => dispatch(s, { type, actorId: currentActor(s), ...payload }, defs);
const game = (o = {}) => createGame({ names: ['А', 'Б', 'В'], seed: 9, ...o }, basePack);
function production(s, cards, wallet = {}) {
  const p = s.players[0];
  p.cards = cards.map((c, i) => ({ id: c.id ?? `c${i}`, definitionId: c.def, upgraded: !!c.upgraded, usedRound: 0, managers: c.managers ?? [], local: null }));
  p.wallet = { ...emptyWallet(), ...wallet };
  s.phase = 'production'; s.turn = 0; s.production = { active: null };
  s.players.forEach(x => { x.done = false; });
  return s;
}
const firstConvert = basePack.deck.find(id => defs[id].effects[0].kind === 'convert' && defs[id].compensation.kind === 'gain');

test('Компенсатор: пока своя компенсация не решена, строки карты недоступны', () => {
  let s = production(game(), [{ id: 'x', def: firstConvert }], { coal: 9, metal: 9, oil: 9, upgrade: 9 });
  s.players[0].ability = 'compensation-before-normal';
  s = act(s, 'UseCard', { cardId: 'x' });
  assert.equal(s.production.active.compensationLeft, true);
  for (const type of ['NextEffect', 'Convert']) assert.throws(() => act(s, type, { times: 1 }), e => e.code === 'COMPENSATION_FIRST', type);
  s = act(s, 'UseOwnCompensation', { times: 0 });
  s = act(s, 'Convert', { times: 1 });
});

test('модернизация по строке оплачивается и ресурсами управляющего на карте', () => {
  let s = production(game({ universities: true }), [{ id: 'st', def: 'user-start-1' }, { id: 't', def: basePack.deck[0] }], { coal: 5 });
  s = act(s, 'UseCard', { cardId: 'st' });          // строка 1 даёт жетон модернизации
  s.players[0].wallet.upgrade = 0;
  s.players[0].cards[0].local = { upgrade: 1 };        // жетон лежит на карте (личный управляющий)
  let guard = 0;
  while (s.production.active.index < 2 && guard++ < 5) s = act(s, 'NextEffect');
  s = act(s, 'Upgrade', { cardId: 't' });
  assert.equal(s.players[0].cards.find(c => c.id === 't').upgraded, true);
  assert.equal(s.players[0].cards[0].local.upgrade, 0, 'жетон взят с карты');
});

test('поставка-продажа получает надбавку «всякий раз, когда продаёте» и прибавку «ещё раз»', () => {
  const s = production(game({ expansion: true }), [{ id: 'k', def: 'ib-18' }], { oil: 9 });
  const e = { kind: 'convert', cost: { oil: 1 }, gain: { money: 4 }, limit: 4 };
  assert.equal(supplyCapacity(s, defs, 'p0', e), 5, 'постоянный эффект ib-18 даёт ещё одно применение');
});

test('нефть за компенсацию 3 или 4 — по номиналу диска, не по диску переменного капитала', () => {
  let s = game({ variableCapital: true });
  s.players[0].cards = [{ id: 'st', definitionId: 'ib-start-3', upgraded: false, usedRound: 0, managers: [], local: null }];
  const lot = s.lots.find(l => defs[l.card.definitionId].compensation.kind === 'gain');
  lot.bids = [{ playerId: 'p0', discId: 'variable', kind: 'variable', value: 3 }, { playerId: 'p1', discId: 'fixed4', kind: 'fixed', value: 4 }];
  s.lots = [lot]; s.phase = 'settlement'; s.settlement = { index: 0, cursor: 0, queue: null, pending: null };
  s = act(s, 'ResolveLot');
  assert.equal(s.players[0].cards[0].stored?.oil ?? 0, 0);
});

test('агент базы не получает диска переменного капитала', () => {
  const s = createGame({ names: ['А', 'Б'], seed: 3, variableCapital: true }, basePack);
  const agent = s.players.find(p => p.agent);
  assert.ok(!agent.discs.some(d => d.kind === 'variable'));
  assert.ok(s.players.filter(p => !p.agent).every(p => p.discs.some(d => d.kind === 'variable')));
});

test('случайный первый игрок: по желанию, детерминированно от зерна', () => {
  const firsts = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const s = createGame({ names: ['А', 'Б', 'В', 'Г'], seed, randomFirst: true }, basePack);
    assert.equal(currentActor(s), s.players[s.firstPlayer].id);
    firsts.add(s.firstPlayer);
  }
  assert.ok(firsts.size > 1, 'первым ходит не всегда один и тот же');
  assert.equal(createGame({ names: ['А', 'Б', 'В'], seed: 5 }, basePack).firstPlayer, 0, 'без флага — как раньше');
});

test('впятером выбирает тот, кто ходит пятым в первом раунде', () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = createGame({ names: ['А', 'Б', 'В', 'Г', 'Д'], seed, randomFirst: true, expansion: true, capitalists: true }, basePack);
    if (s.phase !== 'choosing') continue;
    assert.equal(s.choice.playerId, s.players[(s.firstPlayer + 4) % 5].id);
    const others = s.players.filter(p => p.id !== s.choice.playerId);
    for (const id of s.choice.startups) assert.ok(!others.some(p => p.cards[0].definitionId === id));
  }
});

test('прогноз ставки учитывает уголь, ушедший на переменный диск', () => {
  const s = game({ variableCapital: true });
  const lot = s.lots.find(l => defs[l.card.definitionId].compensation.kind === 'convert'
    && (defs[l.card.definitionId].compensation.cost.coal ?? 0) > 0);
  if (!lot) return;
  const cost = defs[lot.card.definitionId].compensation.cost.coal;
  s.players[0].wallet.coal = cost;
  assert.equal(bidOutcome(s, defs, 'p0', lot.id, 2, 0).max >= 1, true);
  assert.equal(bidOutcome(s, defs, 'p0', lot.id, 2, cost).max, 0, 'если весь уголь ушёл на ставку, обменивать нечего');
});

test('convertCapacity учитывает ресурсы на карте и бесплатную операцию', () => {
  let s = production(game({ universities: true }), [{ id: 'x', def: firstConvert }], {});
  s = act(s, 'UseCard', { cardId: 'x' });
  const e = defs[firstConvert].effects[0];
  assert.equal(convertCapacity(s, defs), 0, 'без ресурсов — ничего');
  s.players[0].cards[0].local = Object.fromEntries(Object.entries(e.cost).map(([k, v]) => [k, v]));
  assert.equal(convertCapacity(s, defs), 1, 'ресурсы управляющего на карте позволяют одну операцию');
});

test('онлайн: места после выхода из комнаты сдвигаются, и партия идёт за своё место', async () => {
  const { startServer } = await import('../server/index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'industry-seat-'));
  const app = await startServer({ PORT: '0', DATA_DIR: dir });
  try {
    const mk = async name => {
      const c = { cookie: '', csrf: '' };
      c.call = async (method, url, body) => {
        const headers = { Origin: app.url };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (c.cookie) headers.Cookie = c.cookie;
        if (c.csrf && method !== 'GET') headers['X-CSRF-Token'] = c.csrf;
        const r = await fetch(app.url + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const set = r.headers.get('set-cookie'); if (set) c.cookie = set.split(';')[0];
        const json = await r.json().catch(() => null); if (json?.csrf) c.csrf = json.csrf;
        return { status: r.status, json };
      };
      await c.call('POST', '/api/register', { username: name, password: 'correct horse 42' });
      return c;
    };
    const a = await mk('Первый'), b = await mk('Второй'), c = await mk('Третий');
    const code = (await a.call('POST', '/api/tables', {})).json.code;
    await b.call('POST', `/api/tables/${code}/join`);
    await c.call('POST', `/api/tables/${code}/join`);
    await b.call('POST', `/api/tables/${code}/leave`);          // места 0 и 2
    assert.equal((await a.call('POST', `/api/tables/${code}/start`)).status, 200);
    const view = (await c.call('GET', `/api/tables/${code}`)).json;
    assert.deepEqual(view.seats.map(s => s.seat), [0, 1], 'места идут подряд');
    assert.equal(view.mySeat, 1);
    assert.equal(view.state.players[1].name, 'Третий', 'место совпадает с игроком в партии');
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
