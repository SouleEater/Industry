import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist', 'table.html');
const images = path.join(root, 'apps', 'table', 'card-images.js');
const packed = fs.existsSync(images);

// card-images.js создаётся скриптом на Python и в git не обязателен на чистой машине.
const build = { skip: packed ? false : 'нет apps/table/card-images.js — выполните python scripts/pack-table-images.py' };

test('сборка стола проходит без ошибок', build, () => {
  execFileSync(process.execPath, ['scripts/build-table.mjs'], { cwd: root, stdio: 'pipe' });
  assert.ok(fs.existsSync(out));
});

test('собранный файл самодостаточен', build, () => {
  const html = fs.readFileSync(out, 'utf8');
  // Ничего не грузится со стороны, кроме шрифтов Google.
  const external = [...html.matchAll(/\b(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  for (const url of external)
    assert.ok(/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(url), `посторонняя ссылка: ${url}`);
  assert.equal(html.includes('<script src='), false, 'не должно быть внешних скриптов');
  // шаблонные строки интерфейса содержат src="${...}" — их пропускаем
  assert.equal(/<img[^>]+src="(?!data:|\$\{)/.test(html), false, 'все картинки должны быть встроены');
  assert.equal(html.includes('/*STYLE*/') || html.includes('/*ENGINE*/') || html.includes('/*UIA*/'),
    false, 'остались незаполненные метки сборки');
});

test('правила в сборке те же, что в packages/', build, () => {
  const html = fs.readFileSync(out, 'utf8');
  const engine = fs.readFileSync(path.join(root, 'packages/domain/engine.mjs'), 'utf8');
  // Берём несколько характерных строк ядра: они должны попасть в сборку дословно.
  for (const marker of [
    "case 'RepeatCard': {",
    "case 'SkipPair': {",
    'function bidLegality(s, p, d, lot, value) {',
    "event(s, 'DeckRefilled');",
  ]) {
    assert.ok(engine.includes(marker), `в ядре нет строки: ${marker}`);
    assert.ok(html.includes(marker), `в сборку не попала строка: ${marker}`);
  }
  assert.equal(html.includes("from './rules.mjs'"), false, 'импорты должны быть сняты');
  assert.equal(/^export\s/m.test(html.split('<script>')[2] ?? ''), false, 'экспорты должны быть сняты');
});

test('в сборке нет объявлений с одинаковым именем', build, () => {
  const html = fs.readFileSync(out, 'utf8');
  const engineBlock = html.slice(html.indexOf('/* ===== packages/domain/rules.mjs ====='));
  const seen = new Map();
  for (const m of engineBlock.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    assert.ok(!seen.has(m[1]), `имя «${m[1]}» объявлено дважды`);
    seen.set(m[1], true);
  }
  assert.ok(seen.size > 40);
});

test('встроены изображения всех 72 сторон карт', build, () => {
  const source = fs.readFileSync(images, 'utf8');
  const keys = [...source.matchAll(/"(\d{3}-\d{2})":/g)].map(m => m[1]);
  assert.equal(new Set(keys).size, 72);
});

test('размер сборки укладывается в лимит одностраничного артефакта', build, () => {
  const mb = fs.statSync(out).size / 1048576;
  assert.ok(mb < 16, `${mb.toFixed(2)} МБ — больше 16 МБ`);
});
