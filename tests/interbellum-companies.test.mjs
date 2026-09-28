import test from 'node:test';
import assert from 'node:assert/strict';
import { interbellumCompanies, companyNeeds, rowNeeds } from '../packages/content/interbellum-companies.mjs';
import { validateWallet, classifyConversion } from '../packages/domain/rules.mjs';

const RESOURCES = ['coal', 'metal', 'oil', 'upgrade'];
const ASSETS = [...RESOURCES, 'money'];
const rowsOf = c => [c.compensation, ...c.basic, ...c.advanced];
/** Разворачивает поставку до её содержимого. */
const inner = row => (row.kind === 'supply' ? row.of : row);

test('в дополнении ровно 24 карты предприятий, идентификаторы уникальны', () => {
  assert.equal(interbellumCompanies.length, 24);
  assert.equal(new Set(interbellumCompanies.map(c => c.id)).size, 24);
  for (const c of interbellumCompanies) {
    assert.equal(c.officialVerified, false, 'сверки с физическими картами не было');
    assert.equal(c.source.file, 'Карты_предприятий.pdf');
    assert.ok(c.source.page >= 1 && c.source.page <= 24, `${c.id}: страница скана`);
  }
});

test('у каждой карты есть компенсация и хотя бы по одной строке на каждой стороне', () => {
  for (const c of interbellumCompanies) {
    assert.ok(c.compensation, `${c.id}: нет компенсации`);
    assert.ok(c.basic.length >= 1, `${c.id}: пустая обычная сторона`);
    assert.ok(c.advanced.length >= 1, `${c.id}: пустая модернизированная сторона`);
  }
});

test('компенсация — это добыча или переработка, но не поставка и не текст', () => {
  for (const c of interbellumCompanies) {
    assert.ok(['gain', 'convert'].includes(c.compensation.kind),
      `${c.id}: компенсация вида ${c.compensation.kind}`);
  }
});

test('во всех кошельках только известные ресурсы и целые положительные числа', () => {
  for (const c of interbellumCompanies) {
    for (const row of rowsOf(c)) {
      const e = inner(row);
      for (const bundle of [e.cost, e.gain]) {
        if (!bundle) continue;
        validateWallet(bundle);
        for (const [k, v] of Object.entries(bundle)) {
          assert.ok(ASSETS.includes(k), `${c.id}: неизвестный ресурс ${k}`);
          assert.ok(Number.isSafeInteger(v) && v > 0, `${c.id}: ${k} = ${v}`);
        }
      }
    }
  }
});

test('у каждой переработки есть стоимость, выход и целая кратность', () => {
  for (const c of interbellumCompanies) {
    for (const row of rowsOf(c)) {
      const e = inner(row);
      if (e.kind !== 'convert') continue;
      assert.ok(Object.keys(e.cost).length > 0, `${c.id}: переработка без стоимости`);
      assert.ok(Object.keys(e.gain).length > 0, `${c.id}: переработка без выхода`);
      assert.ok(Number.isSafeInteger(e.limit) && e.limit >= 1, `${c.id}: кратность ${e.limit}`);
      assert.equal(Object.keys(e.cost).some(k => k === 'money'), false,
        `${c.id}: деньги не тратятся по эффектам предприятий`);
      const kinds = classifyConversion(e);
      assert.ok(kinds.sale || kinds.exchange, `${c.id}: переработка ни продажа, ни обмен`);
    }
  }
});

test('добыча ничего не стоит', () => {
  for (const c of interbellumCompanies) {
    for (const row of rowsOf(c)) {
      const e = inner(row);
      if (e.kind === 'gain') assert.equal(e.cost, undefined, `${c.id}: у добычи есть стоимость`);
    }
  }
});

test('поставка оборачивает обычный эффект, а не другую поставку', () => {
  const supplies = interbellumCompanies.flatMap(c => rowsOf(c).filter(r => r.kind === 'supply').map(r => [c.id, r]));
  assert.ok(supplies.length > 0);
  for (const [id, row] of supplies) {
    assert.ok(row.of, `${id}: поставка без содержимого`);
    assert.ok(['gain', 'convert'].includes(row.of.kind), `${id}: поставка вида ${row.of.kind}`);
  }
  // Компенсация поставкой быть не может.
  for (const c of interbellumCompanies) assert.notEqual(c.compensation.kind, 'supply', c.id);
});

test('поставки на обычной стороне — только добыча, значит применяются сами', () => {
  // Правила дополнения, стр. 5: поставка с обычной стороны срабатывает сразу после
  // получения карты на аукционе. Если бы там была переработка, игроку пришлось бы
  // выбирать посреди разбора лотов. По сканам таких карт нет — фиксируем это.
  for (const c of interbellumCompanies) {
    for (const row of c.basic) {
      if (row.kind !== 'supply') continue;
      assert.equal(row.of.kind, 'gain', `${c.id}: поставка-переработка на обычной стороне`);
    }
  }
});

test('текстовые и постоянные строки названы и снабжены пояснением', () => {
  for (const c of interbellumCompanies) {
    for (const row of rowsOf(c)) {
      if (!['text', 'permanent'].includes(row.kind)) continue;
      assert.ok(row.id, `${c.id}: строка без идентификатора`);
      assert.ok(row.text && row.text.length > 10, `${c.id}: строка без пояснения`);
      assert.ok(row.needs, `${c.id}: строка должна быть помечена как нереализованная`);
    }
  }
});

test('нереализованные механики перечислены явно', () => {
  const kinds = new Set();
  for (const c of interbellumCompanies) for (const row of rowsOf(c)) {
    const need = rowNeeds(row);
    if (need) kinds.add(need);
  }
  assert.deepEqual([...kinds].sort(), ['permanent', 'supply', 'text'],
    'появилась незадокументированная механика');
});

test('карты разложены по тому, чего им не хватает', () => {
  const by = {};
  for (const c of interbellumCompanies) {
    const key = companyNeeds(c).sort().join('+') || 'ready';
    (by[key] ??= []).push(c.id);
  }
  assert.equal(by.ready?.length, 3, 'три карты играбельны уже сейчас');
  assert.equal(by.supply?.length, 10, 'десяти картам нужны только поставки');
  const total = Object.values(by).reduce((n, ids) => n + ids.length, 0);
  assert.equal(total, 24);
});

test('карты с оговорками несут примечание', () => {
  // Два прочтения со скана неуверенные: одиночный значок переворота и строка
  // без синей подложки. Примечание обязано остаться, пока нет сверки.
  // ib-06 и ib-05: устное описание владельца расходится с напечатанным, это должно быть видно.
  for (const id of ['ib-05', 'ib-06']) {
    const c = interbellumCompanies.find(x => x.id === id);
    assert.ok(c.notes.length > 0, `${id}: потеряно примечание о расхождении`);
    assert.match(c.notes.join(' '), /сверк/i);
  }
  // ib-19: прочтение опирается на решение владельца, а не на иконку.
  const nineteen = interbellumCompanies.find(x => x.id === 'ib-19');
  assert.match(nineteen.notes.join(' '), /Владелец коробки/);
  assert.equal(nineteen.advanced[0].kind, 'upgrade-next-in-line');
});

test('каталог дополнения пока не подмешан в игровую колоду', async () => {
  const { basePack } = await import('../packages/content/base-pack.mjs');
  for (const c of interbellumCompanies)
    assert.equal(Boolean(basePack.definitions[c.id]), false,
      `${c.id} попал в колоду, хотя его механики ещё не реализованы`);
});
