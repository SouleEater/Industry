import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.INDUSTRY_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid INDUSTRY_PORT');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const publicPath = pathname === '/' ? '/apps/web/index.html' : pathname;
    if (!publicPath.startsWith('/apps/web/') && !publicPath.startsWith('/packages/')) throw new Error('Private');
    const path = resolve(root, '.' + publicPath), rel = relative(root, path);
    if (rel.startsWith('..') || !types[extname(path)]) throw new Error('Private');
    // Only the two public source trees. PDF rules, scans, docs, and tests are never served.
    if (!rel.replaceAll('\\', '/').startsWith('apps/web/') && !rel.replaceAll('\\', '/').startsWith('packages/')) throw new Error('Private');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Industry prototype: http://127.0.0.1:${port}\n`));
server.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
