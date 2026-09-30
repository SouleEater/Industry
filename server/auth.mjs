// Авторизация: логин и пароль, пароли хранятся только в виде scrypt-хэша, сессии — случайные
// токены (в базе лежит только их SHA-256), токен приходит в HttpOnly-cookie. Запросы,
// меняющие данные, защищены проверкой Origin и CSRF-токеном.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KDF = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEY_LENGTH = 64;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, KDF);
  return ['scrypt', KDF.N, KDF.r, KDF.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: KDF.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123',
  '11111111', '00000000', 'iloveyou', 'abcd1234', 'йцукенгш', 'пароль123', 'индустрия']);

/** Ключ для сравнения логинов без учёта регистра (SQLite сворачивает регистр только у латиницы). */
export const usernameKey = name => String(name).normalize('NFKC').toLowerCase();

export function checkUsername(name) {
  if (typeof name !== 'string') return 'Укажите логин.';
  if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(name)) return 'Логин: от 3 до 24 символов, буквы, цифры, «_», «.» и «-».';
  return null;
}
export function checkPassword(password, username = '') {
  if (typeof password !== 'string') return 'Укажите пароль.';
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов.';
  if (password.length > 128) return 'Пароль не длиннее 128 символов.';
  if (COMMON.has(password.toLowerCase())) return 'Этот пароль слишком простой. Придумайте другой.';
  if (username && password.toLowerCase() === String(username).toLowerCase()) return 'Пароль не должен совпадать с логином.';
  if (/^(.)\1+$/u.test(password)) return 'Пароль не может состоять из одного повторяющегося символа.';
  return null;
}

/** Счётчик попыток за окно времени. Живёт в памяти: после перезапуска обнуляется. */
export class Limiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  entry(key) {
    const now = Date.now();
    let e = this.map.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + this.windowMs }; this.map.set(key, e); }
    return e;
  }
  /** Регистрирует попытку; false — лимит превышен. */
  hit(key) { const e = this.entry(key); e.count++; return e.count <= this.max; }
  blocked(key) { return this.entry(key).count >= this.max; }
  retryAfter(key) { return Math.max(1, Math.ceil((this.entry(key).reset - Date.now()) / 1000)); }
  clear(key) { this.map.delete(key); }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if (e.reset <= now) this.map.delete(k); }
}

export class AuthError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Ключ для CSRF-токенов: из окружения или один раз созданный файл в каталоге данных. */
function loadSecret(config) {
  if (config.sessionSecret) {
    if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET: не короче 32 символов');
    return config.sessionSecret;
  }
  const file = path.join(config.dataDir, 'secret.key');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* создаём */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function createAuth({ store, config }) {
  const { q, tx } = store;
  const secret = loadSecret(config);
  const ttl = config.sessionDays * 24 * 3600 * 1000;
  const loginByIp = new Limiter(40, 15 * 60 * 1000);
  const loginByName = new Limiter(8, 15 * 60 * 1000);
  const registerByIp = new Limiter(6, 60 * 60 * 1000);
  let dummyHash = null;

  const csrfFor = tokenHash => crypto.createHmac('sha256', secret).update(tokenHash).digest('hex');

  function startSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    q.addSession.run(sha256(token), userId, now, now + ttl);
    return { token, maxAge: Math.floor(ttl / 1000) };
  }

  return {
    ttlSeconds: Math.floor(ttl / 1000),

    async register({ username, password, invite }, ip) {
      if (config.registration === 'closed') throw new AuthError(403, 'Регистрация закрыта.');
      if (!registerByIp.hit(ip)) throw new AuthError(429, 'Слишком много регистраций. Попробуйте позже.', { retryAfter: registerByIp.retryAfter(ip) });
      if (config.registration === 'invite') {
        const a = Buffer.from(String(invite ?? '')), b = Buffer.from(config.inviteCode);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AuthError(403, 'Неверный код приглашения.');
      }
      const problem = checkUsername(username) || checkPassword(password, username);
      if (problem) throw new AuthError(400, problem);
      if (q.userCount.get().n >= config.maxUsers) throw new AuthError(403, 'Достигнут предел числа пользователей.');
      const hash = await hashPassword(password);
      try {
        const info = q.addUser.run(username, usernameKey(username), hash, Date.now());
        const user = { id: Number(info.lastInsertRowid), username };
        return { user, session: startSession(user.id) };
      } catch (error) {
        if (/UNIQUE/i.test(String(error.message))) throw new AuthError(409, 'Этот логин уже занят.');
        throw error;
      }
    },

    async login({ username, password }, ip) {
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256)
        throw new AuthError(400, 'Укажите логин и пароль.');
      const key = usernameKey(username);
      if (loginByName.blocked(key) || !loginByIp.hit(ip))
        throw new AuthError(429, 'Слишком много попыток входа. Подождите и повторите.', { retryAfter: Math.max(loginByName.retryAfter(key), loginByIp.retryAfter(ip)) });
      const row = q.userByName.get(key);
      // Для несуществующего логина считаем хэш тоже, чтобы по времени ответа нельзя было угадать логины.
      dummyHash ??= await hashPassword('dummy-password-for-timing');
      const ok = await verifyPassword(password, row ? row.pass_hash : dummyHash);
      if (!row || !ok) { loginByName.hit(key); throw new AuthError(401, 'Неверный логин или пароль.'); }
      loginByName.clear(key);
      return { user: { id: row.id, username: row.username }, session: startSession(row.id) };
    },

    logout(token) { if (token) q.delSession.run(sha256(token)); },

    /** Возвращает пользователя по токену из cookie либо null. Продлевает сессию, если прошла половина срока. */
    authenticate(token) {
      if (!token || token.length > 128) return null;
      const hash = sha256(token);
      const row = q.session.get(hash);
      if (!row) return null;
      const now = Date.now();
      if (row.expires_at < now) { q.delSession.run(hash); return null; }
      if (row.expires_at - now < ttl / 2) q.touchSession.run(now + ttl, hash);
      return { id: row.user_id, username: row.username, csrf: csrfFor(hash), tokenHash: hash };
    },

    checkCsrf(user, header) {
      if (!user || typeof header !== 'string') return false;
      const a = Buffer.from(header), b = Buffer.from(user.csrf);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    /** Смена пароля: старые сессии закрываются, кроме текущей. */
    async changePassword(user, { current, next }) {
      const row = q.userByName.get(usernameKey(user.username));
      if (!(await verifyPassword(String(current ?? ''), row.pass_hash))) throw new AuthError(401, 'Текущий пароль указан неверно.');
      const problem = checkPassword(next, user.username);
      if (problem) throw new AuthError(400, problem);
      const hash = await hashPassword(next);
      tx(() => { q.delUserSessions.run(user.id); q.setHash.run(hash, user.id); });
      return { user: { id: user.id, username: user.username }, session: startSession(user.id) };
    },

    housekeeping() {
      q.purgeSessions.run(Date.now());
      loginByIp.sweep(); loginByName.sweep(); registerByIp.sweep();
    },
  };
}
