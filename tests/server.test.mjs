// Серверная часть: авторизация, защита запросов, столы, ходы и обновления в реальном времени.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.mjs';
import { hashPassword, verifyPassword, checkPassword, checkUsername } from '../server/auth.mjs';
import { cleanOptions, publicState } from '../server/games.mjs';

async function boot(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'industry-'));
  const app = await startServer({ PORT: '0', DATA_DIR: dir, ...overrides });
  return { app, dir, done: async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** Браузер в миниатюре: хранит cookie и CSRF-токен, шлёт Origin как настоящий браузер. */
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async call(method, url, body, { headers = {}, csrf = true, origin = this.base } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    if (origin) h.Origin = origin;
    if (csrf && this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    const res = await fetch(this.base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ }
    if (json?.csrf) this.csrf = json.csrf;
    return { status: res.status, json, headers: res.headers, text };
  }
  get(url, opts) { return this.call('GET', url, undefined, opts); }
  post(url, body = {}, opts) { return this.call('POST', url, body, opts); }
}

const PASSWORD = 'correct horse 42';
async function signup(base, name) {
  const c = new Client(base);
  const r = await c.post('/api/register', { username: name, password: PASSWORD });
  assert.equal(r.status, 201, r.text);
  return c;
}

/* ---------- чистые функции ---------- */
test('пароль хранится как scrypt-хэш и проверяется', async () => {
  const hash = await hashPassword(PASSWORD);
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.ok(!hash.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.notEqual(hash, await hashPassword(PASSWORD), 'соль у каждого хэша своя');
});

test('правила для логина и пароля', () => {
  assert.equal(checkUsername('Аня_07'), null);
  assert.ok(checkUsername('ab'));
  assert.ok(checkUsername('a b c'));
  assert.ok(checkUsername('<script>'));
  assert.equal(checkPassword('correct horse 42', 'user'), null);
  assert.ok(checkPassword('short'));
  assert.ok(checkPassword('password'));
  assert.ok(checkPassword('aaaaaaaaaa'));
  assert.ok(checkPassword('UserName99', 'username99'));
  assert.ok(checkPassword('x'.repeat(129)));
});

test('настройки стола — только булевы значения из белого списка', () => {
  assert.deepEqual(cleanOptions({ expansion: true, chain: 'yes', admin: true, universities: 1 }),
    { expansion: true, universities: false, chain: false, variable: false, capitalists: false });
});

test('клиенту не отдаются колода и состояние генератора', () => {
  const view = publicState({ deck: [1, 2, 3], rng: 12345, managerDeck: ['a'], events: [], players: [] });
  assert.equal(view.deck, undefined);
  assert.equal(view.rng, undefined);
  assert.equal(view.managerDeck, undefined);
  assert.equal(view.deckSize, 3);
});

/* ---------- регистрация и вход ---------- */
test('регистрация выдаёт HttpOnly-cookie, вход и выход работают', async () => {
  const { app, done } = await boot();
  try {
    const c = new Client(app.url);
    const reg = await c.post('/api/register', { username: 'Аня', password: PASSWORD });
    assert.equal(reg.status, 201);
    const cookie = reg.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/, 'по http Secure не ставится');

    let me = await c.get('/api/me');
    assert.equal(me.json.user.username, 'Аня');
    assert.ok(me.json.csrf.length >= 32);

    const out = await c.post('/api/logout');
    assert.equal(out.status, 200);
    me = await c.get('/api/me');
    assert.equal(me.json.user, null, 'после выхода сессии нет');

    const login = await c.post('/api/login', { username: 'аня', password: PASSWORD });
    assert.equal(login.status, 200, 'логин не зависит от регистра');
    assert.equal(login.json.user.username, 'Аня');
  } finally { await done(); }
});

test('пароль в базе не лежит открытым текстом', async () => {
  const { app, dir, done } = await boot();
  try {
    await signup(app.url, 'Борис');
    await app.close();
    const raw = fs.readFileSync(path.join(dir, 'industry.db')).toString('latin1')
      + (fs.existsSync(path.join(dir, 'industry.db-wal')) ? fs.readFileSync(path.join(dir, 'industry.db-wal')).toString('latin1') : '');
    assert.ok(!raw.includes(PASSWORD));
    assert.ok(raw.includes('scrypt$'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('логин занят, слабый пароль отклоняется, ответы на неверный вход одинаковы', async () => {
  const { app, done } = await boot();
  try {
    await signup(app.url, 'Вика');
    const c = new Client(app.url);
    assert.equal((await c.post('/api/register', { username: 'вика', password: PASSWORD })).status, 409);
    assert.equal((await c.post('/api/register', { username: 'Гена', password: 'short' })).status, 400);
    assert.equal((await c.post('/api/register', { username: 'a', password: PASSWORD })).status, 400);
    const wrong = await c.post('/api/login', { username: 'Вика', password: 'bad password 1' });
    const ghost = await c.post('/api/login', { username: 'Нетакого', password: 'bad password 1' });
    assert.equal(wrong.status, 401);
    assert.equal(ghost.status, 401);
    assert.equal(wrong.json.error, ghost.json.error, 'по тексту ошибки нельзя понять, есть ли такой логин');
  } finally { await done(); }
});

test('после серии неверных паролей вход блокируется', async () => {
  const { app, done } = await boot();
  try {
    await signup(app.url, 'Даша');
    const c = new Client(app.url);
    let last;
    for (let i = 0; i < 9; i++) last = await c.post('/api/login', { username: 'Даша', password: `wrong password ${i}` });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    const good = await c.post('/api/login', { username: 'Даша', password: PASSWORD });
    assert.equal(good.status, 429, 'даже верный пароль не пускает, пока блокировка не кончится');
  } finally { await done(); }
});

test('режимы регистрации: по приглашению и закрытая', async () => {
  const inv = await boot({ REGISTRATION: 'invite', INVITE_CODE: 'secret-code-1' });
  try {
    const c = new Client(inv.app.url);
    assert.equal((await c.get('/api/config')).json.registration, 'invite');
    assert.equal((await c.post('/api/register', { username: 'Егор', password: PASSWORD })).status, 403);
    assert.equal((await c.post('/api/register', { username: 'Егор', password: PASSWORD, invite: 'wrong' })).status, 403);
    assert.equal((await c.post('/api/register', { username: 'Егор', password: PASSWORD, invite: 'secret-code-1' })).status, 201);
  } finally { await inv.done(); }
  const closed = await boot({ REGISTRATION: 'closed' });
  try {
    assert.equal((await new Client(closed.app.url).post('/api/register', { username: 'Жанна', password: PASSWORD })).status, 403);
  } finally { await closed.done(); }
});

test('смена пароля закрывает остальные сессии', async () => {
  const { app, done } = await boot();
  try {
    const a = await signup(app.url, 'Зоя');
    const b = new Client(app.url);
    assert.equal((await b.post('/api/login', { username: 'Зоя', password: PASSWORD })).status, 200);
    const bad = await a.post('/api/password', { current: 'nope nope nope', next: 'brand new pass 77' });
    assert.equal(bad.status, 401);
    const ok = await a.post('/api/password', { current: PASSWORD, next: 'brand new pass 77' });
    assert.equal(ok.status, 200);
    assert.equal((await a.get('/api/me')).json.user.username, 'Зоя', 'текущая сессия осталась');
    assert.equal((await b.get('/api/me')).json.user, null, 'вторая сессия закрыта');
    const again = new Client(app.url);
    assert.equal((await again.post('/api/login', { username: 'Зоя', password: PASSWORD })).status, 401);
    assert.equal((await again.post('/api/login', { username: 'Зоя', password: 'brand new pass 77' })).status, 200);
  } finally { await done(); }
});

/* ---------- защита запросов ---------- */
test('изменяющие запросы требуют CSRF-токен и свой Origin', async () => {
  const { app, done } = await boot();
  try {
    const c = await signup(app.url, 'Илья');
    assert.equal((await c.post('/api/tables', {}, { csrf: false })).status, 403, 'без токена');
    assert.equal((await c.post('/api/tables', {}, { headers: { 'X-CSRF-Token': 'a'.repeat(64) }, csrf: false })).status, 403, 'с чужим токеном');
    assert.equal((await c.post('/api/tables', {}, { origin: 'https://evil.example' })).status, 403, 'с чужого сайта');
    assert.equal((await c.post('/api/login', { username: 'Илья', password: PASSWORD }, { origin: 'https://evil.example' })).status, 403, 'вход с чужого сайта');
    assert.equal((await c.post('/api/tables', {})).status, 201);
  } finally { await done(); }
});

test('запрос без Origin принимается только если браузер сообщил, что он свой', async () => {
  const { app, done } = await boot();
  try {
    const c = await signup(app.url, 'Клим');
    assert.equal((await c.post('/api/tables', {}, { origin: null })).status, 403);
    assert.equal((await c.post('/api/tables', {}, { origin: null, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await c.post('/api/tables', {}, { origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 201);
  } finally { await done(); }
});

test('без входа столы недоступны, а тело запроса ограничено', async () => {
  const { app, done } = await boot();
  try {
    const anon = new Client(app.url);
    assert.equal((await anon.get('/api/tables')).status, 401);
    assert.equal((await anon.get('/api/tables/ABCDEF')).status, 401);
    const c = await signup(app.url, 'Лена');
    const big = await fetch(app.url + '/api/tables', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, Cookie: c.cookie, 'X-CSRF-Token': c.csrf },
      body: JSON.stringify({ junk: 'x'.repeat(40000) }),
    });
    assert.equal(big.status, 413);
    const wrongType = await fetch(app.url + '/api/tables', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: app.url, Cookie: c.cookie, 'X-CSRF-Token': c.csrf }, body: '{}',
    });
    assert.equal(wrongType.status, 415);
  } finally { await done(); }
});

test('страница отдаётся с политикой безопасности без unsafe-inline для скриптов', async () => {
  const { app, done } = await boot();
  try {
    const res = await fetch(app.url + '/');
    if (res.status === 503) return;   // стол не собран на этой машине
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'sha256-/);
    assert.doesNotMatch(csp.split(';').find(x => x.trim().startsWith('script-src')), /unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const health = await fetch(app.url + '/healthz');
    assert.equal(health.status, 200);
  } finally { await done(); }
});

test('за HTTPS-прокси cookie получает Secure и префикс __Host-', async () => {
  const { app, done } = await boot({ TRUST_PROXY: '1', PUBLIC_ORIGIN: 'https://industry.example.com' });
  try {
    const res = await fetch(app.url + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://industry.example.com', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ username: 'Мила', password: PASSWORD }),
    });
    assert.equal(res.status, 201);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^__Host-sid=/);
    assert.match(cookie, /; Secure/);
    assert.match(res.headers.get('strict-transport-security'), /max-age=/);
  } finally { await done(); }
});

/* ---------- столы и ходы ---------- */
async function twoPlayers(app, options = {}) {
  const host = await signup(app.url, 'Хозяин');
  const guest = await signup(app.url, 'Гость');
  const table = (await host.post('/api/tables', { options })).json;
  assert.equal((await guest.post(`/api/tables/${table.code}/join`)).status, 200);
  return { host, guest, code: table.code };
}

test('стол: создание, вход по коду, старт только хозяином', async () => {
  const { app, done } = await boot();
  try {
    const host = await signup(app.url, 'Хозяин');
    const guest = await signup(app.url, 'Гость');
    const outsider = await signup(app.url, 'Чужой');
    const created = await host.post('/api/tables', { options: { expansion: true, hack: true } });
    assert.equal(created.status, 201);
    const code = created.json.code;
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.deepEqual(created.json.options, { expansion: true, universities: false, chain: false, variable: false, capitalists: false });

    assert.equal((await host.post(`/api/tables/${code}/start`)).status, 409, 'одному играть нельзя');
    assert.equal((await guest.post(`/api/tables/${code.toLowerCase()}/join`)).status, 200, 'код без учёта регистра');
    assert.equal((await guest.post(`/api/tables/${code}/start`)).status, 403, 'гость начать не может');
    const view = (await guest.get(`/api/tables/${code}`)).json;
    assert.deepEqual(view.seats.map(s => s.username), ['Хозяин', 'Гость']);
    assert.equal(view.mySeat, 1);

    assert.equal((await host.post(`/api/tables/${code}/start`)).status, 200);
    assert.equal((await outsider.post(`/api/tables/${code}/join`)).status, 409, 'после старта присоединиться нельзя');
    assert.equal((await outsider.get(`/api/tables/${code}`)).status, 403, 'чужая партия не видна');
    assert.equal((await outsider.get('/api/tables/ZZZZZZ')).status, 404);
  } finally { await done(); }
});

test('список: свои столы и открытые комнаты', async () => {
  const { app, done } = await boot();
  try {
    const a = await signup(app.url, 'Алла');
    const b = await signup(app.url, 'Боря');
    const pub = (await a.post('/api/tables', { isPublic: true })).json.code;
    const priv = (await a.post('/api/tables', {})).json.code;
    const seen = (await b.get('/api/tables')).json;
    assert.deepEqual(seen.open.map(t => t.code), [pub], 'закрытые комнаты в списке не видны');
    assert.equal(seen.mine.length, 0);
    await b.post(`/api/tables/${priv}/join`);
    const after = (await b.get('/api/tables')).json;
    assert.equal(after.mine.length, 1);
    assert.equal(after.mine[0].code, priv);
  } finally { await done(); }
});

test('выход из комнаты: хозяин передаётся, пустая комната исчезает', async () => {
  const { app, done } = await boot();
  try {
    const { host, guest, code } = await twoPlayers(app);
    assert.equal((await host.post(`/api/tables/${code}/leave`)).status, 200);
    assert.equal((await guest.get(`/api/tables/${code}`)).json.host, 'Гость');
    assert.equal((await guest.post(`/api/tables/${code}/leave`)).status, 200);
    assert.equal((await guest.get(`/api/tables/${code}`)).status, 404);
  } finally { await done(); }
});

test('ход: только за своё место, состояние без колоды, устаревшая ревизия отклоняется', async () => {
  const { app, done } = await boot();
  try {
    const { host, guest, code } = await twoPlayers(app);
    await host.post(`/api/tables/${code}/start`);
    const view = (await host.get(`/api/tables/${code}`)).json;
    const state = view.state;
    assert.equal(view.status, 'playing');
    assert.equal(state.deck, undefined, 'колода скрыта');
    assert.equal(state.rng, undefined, 'генератор скрыт');
    assert.equal(state.players.length, 3, 'двое людей и агент');
    assert.equal(state.phase, 'auction');

    const turn = state.players[state.turn].id;          // p0 или p1
    const mover = turn === 'p0' ? host : guest, other = turn === 'p0' ? guest : host;
    const lot = state.lots[0].id;
    const bid = { type: 'Bid', discId: 'fixed1', lotId: lot, value: 1, expectedRevision: state.revision };

    const wrongTurn = await other.post(`/api/tables/${code}/command`, { command: bid });
    assert.equal(wrongTurn.status, 422, 'чужой ход отклонён ядром');
    const noRev = await mover.post(`/api/tables/${code}/command`, { command: { ...bid, expectedRevision: undefined } });
    assert.equal(noRev.status, 400);
    const forged = await other.post(`/api/tables/${code}/command`, { command: { ...bid, actorId: turn } });
    assert.equal(forged.status, 422, 'подмена actorId не работает: игрок определяется по месту');

    const ok = await mover.post(`/api/tables/${code}/command`, { command: bid });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.state.deck, undefined);
    assert.equal(ok.json.revision, state.revision + 1);
    const stale = await mover.post(`/api/tables/${code}/command`, { command: bid });
    assert.ok([409, 422].includes(stale.status), 'повтор той же команды отклонён');

    const outsider = await signup(app.url, 'Посторонний');
    assert.equal((await outsider.post(`/api/tables/${code}/command`, { command: bid })).status, 403);
  } finally { await done(); }
});

test('подписка получает новое состояние сразу после хода соперника', async () => {
  const { app, done } = await boot();
  try {
    const { host, guest, code } = await twoPlayers(app);
    await host.post(`/api/tables/${code}/start`);
    const controller = new AbortController();
    const res = await fetch(`${app.url}/api/tables/${code}/events`, { headers: { Cookie: guest.cookie }, signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async () => {
      while (!/\n\n/.test(buffer)) buffer += decoder.decode((await reader.read()).value);
      const at = buffer.indexOf('\n\n'); const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      return JSON.parse(chunk.split('\n').find(l => l.startsWith('data: ')).slice(6));
    };
    const first = await next();
    assert.equal(first.status, 'playing');
    const state = (await host.get(`/api/tables/${code}`)).json.state;
    const turn = state.players[state.turn].id;
    const mover = turn === 'p0' ? host : guest;
    await mover.post(`/api/tables/${code}/command`, { command: { type: 'Bid', discId: 'fixed1', lotId: state.lots[0].id, value: 1, expectedRevision: state.revision } });
    const update = await next();
    assert.equal(update.revision, state.revision + 1);
    assert.equal(update.state.deck, undefined);
    controller.abort();
    const anonymous = await fetch(`${app.url}/api/tables/${code}/events`);
    assert.equal(anonymous.status, 401);
  } finally { await done(); }
});

test('партию можно дожить до конца через сервер', async () => {
  const { app, done } = await boot();
  try {
    const { host, guest, code } = await twoPlayers(app);
    await host.post(`/api/tables/${code}/start`);
    const clients = { p0: host, p1: guest };
    for (let step = 0; step < 1500; step++) {
      const view = (await host.get(`/api/tables/${code}`)).json;
      const s = view.state;
      if (s.phase === 'finished') break;
      const actor = s.phase === 'settlement'
        ? (s.settlement.pending?.playerId ?? s.players[s.firstPlayer].id) : s.players[s.turn].id;
      const client = clients[actor] ?? host;
      const p = s.players.find(x => x.id === actor);
      let command;
      if (s.phase === 'auction') {
        for (const d of p.discs.filter(d => !d.used)) {
          const lot = s.lots.find(l => !l.bids.some(b => b.value === d.value) && !l.bids.some(b => b.playerId === p.id));
          if (lot && d.kind === 'fixed') { command = { type: 'Bid', discId: d.id, lotId: lot.id, value: d.value }; break; }
        }
        command ??= { type: 'SkipPair' };
      } else if (s.phase === 'settlement') {
        command = s.settlement.pending ? { type: 'Compensate', picks: s.settlement.pending.options.map(() => 0) } : { type: 'ResolveLot' };
      } else if (s.phase === 'planning') command = { type: 'ConfirmPlan' };
      else if (s.production.active) command = { type: 'NextEffect' };
      else {
        const left = p.cards.find(c => c.usedRound !== s.round);
        command = left ? { type: 'UseCard', cardId: left.id } : { type: 'FinishProduction' };
      }
      const r = await client.post(`/api/tables/${code}/command`, { command: { ...command, expectedRevision: s.revision } });
      if (r.status !== 200) {
        // ставка могла оказаться нелегальной: пробуем пропустить парную двойку, иначе — пас невозможен
        if (s.phase === 'auction') { await client.post(`/api/tables/${code}/command`, { command: { type: 'SkipPair', expectedRevision: s.revision } }); continue; }
        assert.fail(`${JSON.stringify(command)} -> ${r.status} ${r.text}`);
      }
    }
    const final = (await host.get(`/api/tables/${code}`)).json;
    assert.equal(final.state.phase, 'finished');
    assert.equal(final.status, 'finished');
    assert.ok(final.state.result.length >= 2);
    assert.equal((await host.post(`/api/tables/${code}/command`, { command: { type: 'ResolveLot', expectedRevision: final.state.revision } })).status, 409);
  } finally { await done(); }
});

/* ---------- политика безопасности и администрирование ---------- */
test('хэши в политике безопасности совпадают с тем, что увидит браузер', async () => {
  const { app, done } = await boot();
  try {
    const res = await fetch(app.url + '/', { headers: { 'Accept-Encoding': 'identity' } });
    if (res.status === 503) return;   // стол не собран на этой машине
    const html = await res.text();
    const csp = res.headers.get('content-security-policy');
    const crypto = await import('node:crypto');
    let count = 0;
    for (const m of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)) {
      // браузер считает хэш по тексту с переводами строк LF
      assert.ok(!m[2].includes('\r'), 'в отданной странице не должно быть CR');
      const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
      assert.ok(csp.includes(hash), `нет хэша для <${m[1]}>`);
      count++;
    }
    assert.ok(count >= 5);
    const gz = await fetch(app.url + '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    const again = await fetch(app.url + '/', { headers: { 'If-None-Match': res.headers.get('etag') } });
    assert.equal(again.status, 304);
  } finally { await done(); }
});

test('администратор: список, сброс пароля и удаление пользователя', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'industry-adm-'));
  const app = await startServer({ PORT: '0', DATA_DIR: dir });
  try {
    const c = await signup(app.url, 'Никита');
    const { openStore } = await import('../server/store.mjs');
    const admin = await import('../server/admin.mjs');
    const store = openStore(dir);
    assert.deepEqual(admin.listUsers(store).map(u => u.username), ['Никита']);
    const temp = await admin.resetPassword(store, 'никита');
    assert.ok(temp.length >= 12);
    store.close();
    assert.equal((await c.get('/api/me')).json.user, null, 'сброс закрывает сессии');
    const again = new Client(app.url);
    assert.equal((await again.post('/api/login', { username: 'Никита', password: PASSWORD })).status, 401);
    assert.equal((await again.post('/api/login', { username: 'Никита', password: temp })).status, 200);
    const store2 = openStore(dir);
    admin.deleteUser(store2, 'Никита');
    assert.deepEqual(admin.listUsers(store2), []);
    await assert.rejects(admin.resetPassword(store2, 'Никита'), /Нет пользователя/);
    store2.close();
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
