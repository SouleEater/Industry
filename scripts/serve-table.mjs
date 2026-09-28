// Локальный сервер цифрового стола.
//
//   npm run table          собирает dist/table.html
//   npm run table:serve    отдаёт его на http://127.0.0.1:4174
//
// Файл самодостаточен, его можно открыть и двойным щелчком. Сервер нужен там,
// где file:// мешает: сохранение партии в localStorage и игра с телефона в одной сети.
//
// По умолчанию сервер слушает только этот компьютер. Чтобы пустить друзей из
// локальной сети, задайте INDUSTRY_TABLE_HOST=0.0.0.0. Это открывает стол всем,
// кто находится в той же сети: делайте так только в доверенной сети.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = resolve(root, 'dist/table.html');

const port = Number(process.env.INDUSTRY_TABLE_PORT || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INDUSTRY_TABLE_PORT: 1024–65535');
const host = process.env.INDUSTRY_TABLE_HOST || '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0', '::1'].includes(host)) throw new Error('INDUSTRY_TABLE_HOST: 127.0.0.1 или 0.0.0.0');

try {
  await stat(file);
} catch {
  process.stderr.write('Нет dist/table.html. Сначала выполните:\n'
    + '  python scripts/pack-table-images.py   (один раз, нужен Pillow)\n'
    + '  node scripts/build-table.mjs\n');
  process.exit(1);
}

// Столу нужны встроенные скрипт и стили и шрифты Google. Больше ничего не разрешается.
const csp = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  try {
    const data = await readFile(file);   // читаем каждый раз: пересобрали — хватит обновить вкладку
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': csp,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(500).end('Не удалось прочитать dist/table.html');
  }
});

server.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

server.listen(port, host, () => {
  process.stdout.write(`Цифровой стол: http://127.0.0.1:${port}\n`);
  if (host !== '0.0.0.0') {
    process.stdout.write('Открыт только на этом компьютере. Для телефона и друзей в той же сети:\n');
    process.stdout.write(`  INDUSTRY_TABLE_HOST=0.0.0.0 npm run table:serve\n`);
    process.stdout.write(`  PowerShell: $env:INDUSTRY_TABLE_HOST='0.0.0.0'; npm.cmd run table:serve\n`);
    return;
  }
  process.stdout.write('Стол открыт для локальной сети. Адреса для других устройств:\n');
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const item of list ?? [])
      if (item.family === 'IPv4' && !item.internal)
        process.stdout.write(`  http://${item.address}:${port}   (${name})\n`);
  process.stdout.write('Останавливайте сервер, когда закончите: он доступен всем в этой сети.\n');
});
