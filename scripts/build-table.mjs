// Сборка цифрового стола в один самодостаточный HTML-файл.
//
// Важно: правила НЕ копируются. Скрипт читает настоящие модули из packages/
// и снимает с них синтаксис модулей, поэтому источник истины остаётся один.
// Внешних зависимостей нет, запуск: node scripts/build-table.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// Порядок важен: каждый модуль видит объявления предыдущих.
const MODULES = [
  'packages/domain/rules.mjs',
  'packages/domain/capitalists.mjs',
  'packages/domain/agent.mjs',
  'packages/domain/engine.mjs',
  'packages/content/user-base-catalog.mjs',
  'packages/content/interbellum.mjs',
  'packages/content/base-pack.mjs',
];

/** Снимает import/export, оставляя объявления в общей области классического скрипта. */
function flatten(source, file) {
  const withoutImports = source.replace(/^\s*import\s[^;]*?;\s*$/gm, '');
  if (/^\s*import\s/m.test(withoutImports)) throw new Error(`Не разобран import в ${file}`);
  const flat = withoutImports
    .replace(/^export\s+default\s+/gm, 'const __default__ = ')
    .replace(/^export\s+(?=(const|let|var|function|class|async)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  if (/^\s*export\s/m.test(flat)) throw new Error(`Не разобран export в ${file}`);
  return `/* ===== ${file} ===== */\n${flat.trim()}\n`;
}

function collideCheck(chunks) {
  // Одинаковые имена верхнего уровня в классическом скрипте — это SyntaxError при загрузке.
  const seen = new Map();
  for (const { file, code } of chunks) {
    for (const m of code.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      if (seen.has(name)) throw new Error(`Имя «${name}» объявлено дважды: ${seen.get(name)} и ${file}`);
      seen.set(name, file);
    }
  }
  return seen.size;
}

const chunks = MODULES.map(file => ({ file, code: flatten(read(file), file) }));
const names = collideCheck(chunks);

const images = path.join(root, 'apps/table/card-images.js');
if (!fs.existsSync(images)) {
  throw new Error('Нет apps/table/card-images.js. Сначала выполните: python scripts/pack-table-images.py');
}

const html = read('apps/table/shell.html')
  .replace('/*STYLE*/', () => read('apps/table/style.css'))
  .replace('/*DATA*/', () => fs.readFileSync(images, 'utf8'))
  .replace('/*ENGINE*/', () => chunks.map(c => c.code).join('\n'))
  .replace('/*UIA*/', () => read('apps/table/ui.js'))
  .replace('/*UIB*/', () => '');

const out = path.join(root, 'dist', 'table.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);

console.log(`dist/table.html — ${(html.length / 1048576).toFixed(2)} МБ`);
console.log(`встроено модулей: ${MODULES.length}, объявлений верхнего уровня: ${names}`);
