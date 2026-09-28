import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
async function copyTree(relative) {
  const entries = await readdir(new URL(relative, root), { withFileTypes: true });
  await mkdir(new URL('dist/' + relative, root), { recursive: true });
  for (const entry of entries) {
    const file = join(relative, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await copyTree(file + '/');
    else if (/\.(mjs|css|html|svg|jpg)$/.test(entry.name)) await copyFile(new URL(file, root), new URL('dist/' + file, root));
  }
}
await copyTree('apps/web/'); await copyTree('packages/');
await copyFile(new URL('apps/web/index.html', root), new URL('dist/index.html', root));
process.stdout.write('Static build written to dist/. Research sources and scans excluded.\n');
