// Сервер «Индустрии»: отдаёт стол, регистрирует и авторизует игроков, ведёт онлайн-партии.
// Запуск:  node server/index.mjs   (настройки — переменные окружения, см. docs/07-deployment.md)
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createAuth, AuthError, parseCookies } from './auth.mjs';
import { createGames, GameError } from './games.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY_LIMIT = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function startServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = openStore(config.dataDir);
  const auth = createAuth({ store, config });
  const games = createGames({ store, config });
  const pagePath = path.join(root, 'dist', 'table.html');

  /* ---------- страница стола ---------- */
  // Скрипты и стили встроены в один файл, поэтому политика безопасности разрешает их по
  // хэшу содержимого, а не через 'unsafe-inline'. Ответ сжимается один раз и кэшируется.
  let page = null;
  function loadPage() {
    const stat = fs.statSync(pagePath, { throwIfNoEntry: false });
    if (!stat) return null;
    if (page && page.mtime === stat.mtimeMs) return page;
    // Браузер приводит переводы строк в скриптах к LF до подсчёта хэша, поэтому и мы отдаём LF.
    const html = fs.readFileSync(pagePath, 'utf8').replace(/\r\n?/g, '\n');
    const scripts = [], styles = [];
    for (const m of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g))
      (m[1] === 'script' ? scripts : styles).push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
    const csp = [
      "default-src 'none'",
      `script-src ${scripts.join(' ')}`,
      `style-src ${styles.join(' ')} https://fonts.googleapis.com`,
      "style-src-attr 'unsafe-inline'",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
    const raw = Buffer.from(html);
    page = {
      mtime: stat.mtimeMs, csp, raw,
      gzip: zlib.gzipSync(raw, { level: 9 }),
      etag: `"${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}"`,
    };
    return page;
  }

  /* ---------- вспомогательное ---------- */
  const isSecure = req => config.publicOrigin.startsWith('https:')
    || Boolean(req.socket?.encrypted)
    || (config.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https');
  const cookieName = req => (isSecure(req) ? '__Host-sid' : 'sid');
  const clientIp = req => {
    if (config.trustProxy) {
      const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (chain.length) return chain[chain.length - 1];   // последний адрес добавил наш прокси
    }
    return req.socket?.remoteAddress ?? 'unknown';
  };
  const expectedOrigin = req => {
    if (config.publicOrigin) return config.publicOrigin;
    const proto = isSecure(req) ? 'https' : 'http';
    return `${proto}://${req.headers.host}`;
  };

  function baseHeaders(req, extra = {}) {
    const h = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      ...extra,
    };
    if (isSecure(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    return h;
  }
  function sendJson(req, res, status, body, extra = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, baseHeaders(req, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...extra,
    }));
    res.end(data);
  }
  function sessionCookie(req, token, maxAge) {
    return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
  }
  const clearCookie = req => sessionCookie(req, '', 0);

  async function readJson(req) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Нужен Content-Type: application/json.');
    const chunks = []; let size = 0, tooBig = false;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) { req.destroy(); throw new HttpError(413, 'Слишком большой запрос.'); }   // не читаем бесконечно
      if (size <= BODY_LIMIT) chunks.push(chunk); else tooBig = true;                                   // дочитываем и отвечаем
    }
    if (tooBig) throw new HttpError(413, 'Слишком большой запрос.');
    if (!size) return {};
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
      return value;
    } catch { throw new HttpError(400, 'Некорректный JSON.'); }
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (origin) {
      if (origin !== expectedOrigin(req)) throw new HttpError(403, 'Запрос с чужого сайта отклонён.');
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Не удалось подтвердить источник запроса.');
  }

  /* ---------- маршрутизация ---------- */
  const CODE = '([A-Za-z2-9]{6})';
  async function route(req, res, url) {
    const method = req.method;
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается.');
      const p = loadPage();
      if (!p) throw new HttpError(503, 'Стол не собран. Выполните: npm run table');
      const headers = baseHeaders(req, {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': p.csp, ETag: p.etag,
        'Cache-Control': 'no-cache', Vary: 'Accept-Encoding',
      });
      if (req.headers['if-none-match'] === p.etag) { res.writeHead(304, headers); res.end(); return; }
      const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      const body = gz ? p.gzip : p.raw;
      if (gz) headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(method === 'HEAD' ? undefined : body);
      return;
    }
    if (pathname === '/healthz') return sendJson(req, res, 200, { ok: true });
    if (pathname === '/favicon.ico') { res.writeHead(204, baseHeaders(req)).end(); return; }
    if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Не найдено.');

    // ---- API ----
    const token = parseCookies(req.headers.cookie)[cookieName(req)];
    const user = auth.authenticate(token);
    const mutating = !['GET', 'HEAD'].includes(method);
    if (mutating) checkOrigin(req);

    if (pathname === '/api/config' && method === 'GET')
      return sendJson(req, res, 200, { registration: config.registration });

    if (pathname === '/api/me' && method === 'GET')
      return sendJson(req, res, 200, user ? { user: { username: user.username }, csrf: user.csrf } : { user: null });

    if (pathname === '/api/register' && method === 'POST') {
      const body = await readJson(req);
      const { user: created, session } = await auth.register(body, clientIp(req));
      const csrf = auth.authenticate(session.token).csrf;
      return sendJson(req, res, 201, { user: { username: created.username }, csrf },
        { 'Set-Cookie': sessionCookie(req, session.token, session.maxAge) });
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(req);
      const { user: found, session } = await auth.login(body, clientIp(req));
      const csrf = auth.authenticate(session.token).csrf;
      return sendJson(req, res, 200, { user: { username: found.username }, csrf },
        { 'Set-Cookie': sessionCookie(req, session.token, session.maxAge) });
    }

    // Всё ниже требует входа; изменяющие запросы — ещё и CSRF-токена.
    if (!user) throw new AuthError(401, 'Нужно войти.');
    if (mutating && !auth.checkCsrf(user, req.headers['x-csrf-token'])) throw new HttpError(403, 'Устаревшая страница: обновите её и повторите.');

    if (pathname === '/api/logout' && method === 'POST') {
      auth.logout(token);
      return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
    }
    if (pathname === '/api/password' && method === 'POST') {
      const body = await readJson(req);
      const { user: changed, session } = await auth.changePassword(user, { current: body.current, next: body.next });
      const csrf = auth.authenticate(session.token).csrf;
      return sendJson(req, res, 200, { user: { username: changed.username }, csrf },
        { 'Set-Cookie': sessionCookie(req, session.token, session.maxAge) });
    }

    if (pathname === '/api/tables') {
      if (method === 'GET') return sendJson(req, res, 200, games.list(user));
      if (method === 'POST') return sendJson(req, res, 201, games.create(user, await readJson(req)));
      throw new HttpError(405, 'Метод не поддерживается.');
    }
    const t = new RegExp(`^/api/tables/${CODE}(?:/(join|leave|start|command|events))?$`).exec(pathname);
    if (t) {
      const code = t[1].toUpperCase(), action = t[2];
      if (!action && method === 'GET') return sendJson(req, res, 200, games.get(user, code));
      if (action === 'events' && method === 'GET') {
        res.writeHead(200, baseHeaders(req, {
          'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
        }));
        games.subscribe(user, code, res);
        return;
      }
      if (method === 'POST' && action === 'join') return sendJson(req, res, 200, games.join(user, code));
      if (method === 'POST' && action === 'leave') return sendJson(req, res, 200, games.leave(user, code));
      if (method === 'POST' && action === 'start') return sendJson(req, res, 200, games.start(user, code));
      if (method === 'POST' && action === 'command') return sendJson(req, res, 200, games.command(user, code, await readJson(req)));
      throw new HttpError(405, 'Метод не поддерживается.');
    }
    throw new HttpError(404, 'Не найдено.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, new URL(req.url, 'http://local'));
    } catch (error) {
      if (res.headersSent || res.destroyed || !req.socket) { res.end?.(); return; }
      const known = error instanceof HttpError || error instanceof AuthError || error instanceof GameError;
      if (!known) console.error(new Date().toISOString(), req.method, req.url, error);
      const status = known ? error.status : 500;
      const extra = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
      sendJson(req, res, status, { error: known ? error.message : 'Внутренняя ошибка сервера.', ...(error.code ? { code: error.code } : {}) }, extra);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  const timer = setInterval(() => { try { auth.housekeeping(); games.housekeeping(); } catch (e) { console.error(e); } }, 3600 * 1000);
  timer.unref();
  auth.housekeeping(); games.housekeeping();

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  const port = server.address().port;
  return {
    config, port, url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`,
    async close() {
      clearInterval(timer); games.closeAll();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
      store.close();
    },
  };
}

// Запуск напрямую: node server/index.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const app = await startServer();
    console.log(`Индустрия: ${app.url}  (данные: ${app.config.dataDir}, регистрация: ${app.config.registration})`);
    if (!app.config.publicOrigin && app.config.host !== '127.0.0.1')
      console.log('Внимание: PUBLIC_ORIGIN не задан. Для публичного хостинга задайте его и включите HTTPS.');
    const stop = async () => { await app.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) {
    console.error('Не удалось запустить сервер:', error.message);
    process.exit(1);
  }
}
