// Проверки интерфейса в настоящем DOM.
//
// jsdom НЕ является зависимостью репозитория: без него эти тесты пропускаются,
// и `npm test` по-прежнему работает на чистой машине без npm install.
// Чтобы включить их: npm install --no-save jsdom
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const built = path.join(root, 'dist', 'table.html');

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* не установлен */ }

const ready = !JSDOM ? { skip: 'нет jsdom: npm install --no-save jsdom' }
  : !fs.existsSync(built) ? { skip: 'нет dist/table.html: npm run table' }
    : { skip: false };

async function open() {
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(built, 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(win) {
      win.claude = { use: async () => null };          // онлайн-режим недоступен — стол работает локально
      const proto = win.HTMLDialogElement?.prototype;   // jsdom не реализует <dialog>
      if (proto) { proto.showModal = function () { this.open = true; }; proto.close = function () { this.open = false; }; }
      win.addEventListener('error', e => errors.push(e.message));
    },
  });
  await new Promise(r => setTimeout(r, 200));
  return { w: dom.window, errors, close: () => dom.window.close() };
}

function start(w, { count = 3, capitalists = false, chain = false } = {}) {
  const form = w.document.querySelector('#setup-form');
  form.querySelectorAll('.pname').forEach((input, i) => { input.value = ['Аня', 'Борис', 'Вика', 'Гена'][i]; });
  form.querySelector('[name=count]').value = String(count);
  form.querySelector('[name=capitalists]').checked = capitalists;
  form.querySelector('[name=chain]').checked = chain;
  form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  assert.ok(w.eval('S()'), 'партия не создалась');
}

/** Доводит партию до фазы производства обычными командами интерфейса. */
const TO_PRODUCTION = `
  (function () {
    let guard = 0;
    while (S().phase !== 'production' && guard++ < 4000) {
      const s = S(), p = s.players.find(x => x.id === currentActor(s));
      if (s.phase === 'auction') {
        let done = false;
        outer: for (const d of p.discs) { if (d.used) continue;
          for (const l of s.lots) if (!bidError(s, p.id, d.id, l.id, d.value)) {
            act({ type: 'Bid', discId: d.id, lotId: l.id, value: d.value }, true); done = true; break outer; } }
        if (!done) act({ type: 'SkipPair' }, true);
      } else if (s.phase === 'settlement') {
        const pend = s.settlement.pending;
        act(pend ? { type: 'Compensate', times: 0 } : { type: 'ResolveLot' }, true);
      } else act({ type: 'ConfirmPlan' }, true);
    }
    return S().phase;
  })();`;

test('расчёт ставки показывает оба исхода до постановки диска', ready, async () => {
  const { w, errors, close } = await open();
  try {
    start(w);
    w.eval('ui.disc = "fixed3"; ui.focus = S().lots[0].id; render();');
    const ledger = w.document.querySelector('.ledger');
    assert.ok(ledger, 'расчёт ставки не открылся');
    assert.match(ledger.textContent, /Выиграете/);
    assert.match(ledger.textContent, /Проиграете/);
    const cta = w.document.querySelector('.card-cta');
    assert.ok(cta && !cta.disabled, 'кнопка ставки недоступна');
    cta.click();
    assert.equal(w.eval('S().lots[0].bids.length'), 1, 'ставка не прошла');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('шаг модернизации предлагает названное действие, а не просто имя карты', ready, async () => {
  const { w, errors, close } = await open();
  try {
    start(w);
    assert.equal(w.eval(TO_PRODUCTION), 'production');

    const panel = w.eval(`
      (function () {
        const p = S().players.find(x => x.id === currentActor(S()));
        const start = p.cards.find(c => DEFS[c.definitionId].kind === 'startup');
        // Раздача случайна: гарантируем, что есть чем платить и что улучшать.
        p.wallet.coal = 5; p.wallet.upgrade = 5;
        if (!p.cards.some(c => !c.upgraded && DEFS[c.definitionId].kind === 'company'))
          p.cards.push({ id: 'target', definitionId: PACK.deck.find(x => DEFS[x].advanced.length > 0), upgraded: false, usedRound: 0, managers: [], local: null });
        act({ type: 'UseCard', cardId: start.id }, true);
        let steps = 0;
        while (S().production.active && steps++ < 12) {
          const e = activeEffect(S(), DEFS);
          if (e && e.kind === 'upgrade') { render(); return document.querySelector('#effect-slot').innerHTML; }
          act({ type: 'NextEffect' }, true);
        }
        return null;
      })();`);
    assert.ok(panel, 'строка модернизации не встретилась на стартовом предприятии');

    const box = w.document.querySelector('#effect-slot');
    const buttons = [...box.querySelectorAll('button')].map(b => b.textContent);
    assert.ok(buttons.some(t => t.startsWith('Улучшить: ')),
      `кнопка модернизации должна называть действие, а не только карту: ${buttons.join(' / ')}`);
    assert.ok(buttons.some(t => t === 'Не улучшать'), 'нужен явный отказ');

    const before = w.eval('S().players.find(x => x.id === currentActor(S())).cards.filter(c => c.upgraded).length');
    [...box.querySelectorAll('button')].find(b => b.textContent.startsWith('Улучшить: ')).click();
    const after = w.eval('S().players.find(x => x.id === currentActor(S())).cards.filter(c => c.upgraded).length');
    assert.equal(after, before + 1, 'нажатие не улучшило предприятие');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('нехватка ресурсов на модернизацию объясняется точной цифрой', ready, async () => {
  const { w, close } = await open();
  try {
    start(w);
    assert.equal(w.eval(TO_PRODUCTION), 'production');
    const text = w.eval(`
      (function () {
        const p = S().players.find(x => x.id === currentActor(S()));
        const start = p.cards.find(c => DEFS[c.definitionId].kind === 'startup');
        act({ type: 'UseCard', cardId: start.id }, true);
        let steps = 0;
        while (S().production.active && steps++ < 12) {
          const e = activeEffect(S(), DEFS);
          if (e && e.kind === 'upgrade') {
            const me = S().players.find(x => x.id === currentActor(S()));
            me.wallet.coal = 0; me.wallet.upgrade = 0; me.wallet.metal = 0;
            render();
            return document.querySelector('#effect-slot').textContent;
          }
          act({ type: 'NextEffect' }, true);
        }
        return '';
      })();`);
    assert.match(text, /Не хватает \d+ /, `ожидалось точное количество, получено: ${text}`);
  } finally { close(); }
});

test('агент ни разу не требует ввода от человека', ready, async () => {
  const { w, errors, close } = await open();
  try {
    start(w, { count: 2, capitalists: true });
    const seen = w.eval(`
      (function () {
        let guard = 0, asked = 0;
        while (S().phase !== 'finished' && guard++ < 6000) {
          const s = S(), p = s.players.find(x => x.id === currentActor(s));
          if (p.agent) { asked++; break; }
          if (s.phase === 'auction') {
            let done = false;
            outer: for (const d of p.discs) { if (d.used) continue;
              for (const l of s.lots) if (!bidError(s, p.id, d.id, l.id, d.value)) {
                act({ type: 'Bid', discId: d.id, lotId: l.id, value: d.value }, true); done = true; break outer; } }
            if (!done) act({ type: 'SkipPair' }, true);
          } else if (s.phase === 'settlement') {
            const pend = s.settlement.pending;
            act(pend ? { type: 'Compensate', times: 0 } : { type: 'ResolveLot' }, true);
          } else if (s.phase === 'planning') act({ type: 'ConfirmPlan' }, true);
          else {
            const free = p.cards.filter(c => c.usedRound !== s.round);
            if (S().production.active) act({ type: 'NextEffect' }, true);
            else act(free.length ? { type: 'UseCard', cardId: free[0].id } : { type: 'FinishProduction' }, true);
          }
        }
        return { asked, phase: S().phase, result: S().result ? S().result.length : 0 };
      })();`);
    assert.equal(seen.asked, 0, 'агент попросил ход у человека');
    assert.equal(seen.phase, 'finished');
    assert.equal(seen.result, 2, 'в итоге должны быть только два человека');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('университет показывает оба варианта компенсации и жетон', ready, async () => {
  const { w, errors, close } = await open();
  try {
    const form = w.document.querySelector('#setup-form');
    form.querySelectorAll('.pname').forEach((input, i) => { input.value = ['Аня', 'Борис', 'Вика'][i]; });
    form.querySelector('[name=count]').value = '3';
    form.querySelector('[name=universities]').checked = true;
    form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
    assert.ok(w.eval('S()'), 'партия не создалась');
    assert.equal(w.eval('S().tables.length'), 2, 'втроём выкладывают две карты университетов');

    const faces = [...w.document.querySelectorAll('#stage-strip .card.university .uni-face')];
    assert.equal(faces.length, 2, 'университеты должны быть видны в ленте лотов');
    assert.match(faces[0].textContent, /Университет/);
    assert.ok(faces[0].querySelector('img'), 'на карте университета — официальная картинка с двумя вариантами');
    const strips = [...w.document.querySelectorAll('#stage-strip .card.university .uni-token')];
    assert.equal(strips.length, 2, 'под каждым университетом лежит жетон управляющего');
    assert.match(strips[0].textContent, /Жетон управляющего/);

    // расчёт ставки на университет говорит про делимую компенсацию
    const uniLot = w.eval('S().lots.filter(l => l.kind === "university")[0].id');
    w.eval(`ui.disc = "fixed3"; ui.focus = ${JSON.stringify(uniLot)}; render();`);
    const ledger = w.document.querySelector('.ledger');
    assert.ok(ledger, 'расчёт не открылся');
    assert.match(ledger.textContent, /жетон управляющего/i);
    assert.match(ledger.textContent, /делите между двумя вариантами/);
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('компенсацию университета можно разделить кнопками', ready, async () => {
  const { w, errors, close } = await open();
  try {
    const form = w.document.querySelector('#setup-form');
    form.querySelectorAll('.pname').forEach((input, i) => { input.value = ['Аня', 'Борис', 'Вика'][i]; });
    form.querySelector('[name=count]').value = '3';
    form.querySelector('[name=universities]').checked = true;
    form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));

    // ставим на университет старший и младший диск, остальное раскладываем как придётся
    const ok = w.eval(`
      (function () {
        const uni = S().lots.filter(l => l.kind === 'university')[0].id;
        act({ type: 'Bid', discId: 'fixed4', lotId: uni }, true);
        act({ type: 'Bid', discId: 'fixed3', lotId: uni }, true);
        let guard = 0, offset = 0;
        while (S().phase === 'auction' && guard++ < 300) {
          const s = S(), me = s.players.find(x => x.id === currentActor(s));
          let placed = false;
          outer: for (const d of me.discs) { if (d.used) continue;
            for (let i = 0; i < s.lots.length; i++) {
              const l = s.lots[(i + offset) % s.lots.length];
              if (!bidError(s, me.id, d.id, l.id, d.value)) {
                act({ type: 'Bid', discId: d.id, lotId: l.id }, true); placed = true; offset++; break outer; } } }
          if (!placed) break;
        }
        guard = 0;
        while (S().phase === 'settlement' && guard++ < 400) {
          const pend = S().settlement.pending;
          if (pend && pend.options.length > 1) return pend.limit;
          act(pend ? { type: 'Compensate', picks: pend.options.map(() => 0) } : { type: 'ResolveLot' }, true);
        }
        return 0;
      })();`);
    assert.ok(ok > 0, 'делимая компенсация не встретилась');

    w.eval('ui.seat = S().players.findIndex(x => x.id === S().settlement.pending.playerId); render();');
    const panel = w.document.querySelector('#effect-slot');
    const rows = [...panel.querySelectorAll('.counter')];
    assert.ok(rows.length >= 3, 'два варианта плюс строка действий');
    assert.match(panel.textContent, /распределите/);

    const plus = [...rows[0].querySelectorAll('button')].find(b => b.textContent === '+');
    assert.ok(plus && !plus.disabled, 'первый вариант должен быть доступен');
    plus.click();
    assert.equal(w.eval('ui.picks[0]'), 1);

    const take = [...w.document.querySelectorAll('#effect-slot .act')].find(b => b.textContent.includes('Взять'));
    const before = w.eval('S().revision');
    take.click();
    assert.ok(w.eval('S().revision') > before, 'компенсация не применилась');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('управляющего ставят в планировании и применяют в производстве', ready, async () => {
  const { w, errors, close } = await open();
  try {
    const form = w.document.querySelector('#setup-form');
    form.querySelectorAll('.pname').forEach((input, i) => { input.value = ['Аня', 'Борис', 'Вика'][i]; });
    form.querySelector('[name=count]').value = '3';
    form.querySelector('[name=universities]').checked = true;
    form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));

    // выдаём первому игроку жетон «модернизировать за металл» и доводим до планирования
    const ready2 = w.eval(`
      (function () {
        let guard = 0, offset = 0;
        while (S().phase === 'auction' && guard++ < 300) {
          const s = S(), me = s.players.find(x => x.id === currentActor(s));
          let placed = false;
          outer: for (const d of me.discs) { if (d.used) continue;
            for (let i = 0; i < s.lots.length; i++) {
              const l = s.lots[(i + offset) % s.lots.length];
              if (!bidError(s, me.id, d.id, l.id, d.value)) {
                act({ type: 'Bid', discId: d.id, lotId: l.id }, true); placed = true; offset++; break outer; } } }
          if (!placed) break;
        }
        guard = 0;
        while (S().phase === 'settlement' && guard++ < 400) {
          const pend = S().settlement.pending;
          act(pend ? { type: 'Compensate', picks: pend.options.map(() => 0) } : { type: 'ResolveLot' }, true);
        }
        if (S().phase !== 'planning') return 'фаза ' + S().phase;
        const p = S().players.find(x => x.id === currentActor(S()));
        if (!p.managers.includes('upgrade-for-metal')) p.managers.push('upgrade-for-metal');
        p.wallet.metal = 5;
        ui.seat = null; render();
        return 'ok';
      })();`);
    assert.equal(ready2, 'ok', 'не дошли до планирования');

    const pick = w.document.querySelector('#line-strip .mgr-pick');
    assert.ok(pick, 'в планировании должен быть выбор управляющего для предприятия');
    const option = [...pick.options].find(o => o.value === 'upgrade-for-metal');
    assert.ok(option, 'выигранный жетон должен быть в списке');
    pick.value = 'upgrade-for-metal';
    pick.dispatchEvent(new w.Event('change'));
    assert.equal(w.eval('S().players.find(x => x.id === currentActor(S())).cards.some(c => (c.managers ?? []).includes("upgrade-for-metal"))'), true,
      'жетон не лёг на карту');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('панель управляющего называет действие и применяет его', ready, async () => {
  const { w, errors, close } = await open();
  try {
    const form = w.document.querySelector('#setup-form');
    form.querySelectorAll('.pname').forEach((input, i) => { input.value = ['Аня', 'Борис', 'Вика'][i]; });
    form.querySelector('[name=count]').value = '3';
    form.querySelector('[name=universities]').checked = true;
    form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));

    const staged = w.eval(`
      (function () {
        const s = S(), p = s.players[0];
        const id = PACK.deck.find(x => DEFS[x].advanced.length > 0);
        p.cards.push({ id: 'ui-card', definitionId: id, upgraded: false, usedRound: 0, managers: ['upgrade-for-metal'], local: null });
        p.managers.push('upgrade-for-metal');
        p.wallet.metal = 5; p.wallet.coal = 5;
        s.phase = 'production'; s.turn = 0; s.production = { active: null };
        ui.seat = null;
        act({ type: 'UseCard', cardId: 'ui-card' }, true);
        render();
        return S().production.active ? 'ok' : 'карта завершилась сразу';
      })();`);
    assert.equal(staged, 'ok', staged);

    const panel = w.document.querySelector('#effect-slot .manager-step');
    assert.ok(panel, 'панель управляющего не показана');
    const btn = [...panel.querySelectorAll('button')].find(b => b.textContent.includes('Улучшить'));
    assert.ok(btn && !btn.disabled, `кнопка недоступна: ${[...panel.querySelectorAll('button')].map(b => b.textContent)}`);
    btn.click();
    assert.equal(w.eval('S().players[0].cards.find(c => c.id === "ui-card").upgraded'), true,
      'нажатие не улучшило предприятие');
    w.eval('render()');
    assert.equal(w.document.querySelector('#effect-slot .manager-step'), null, 'панель должна исчезнуть после применения');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('в цепочке две старые карты нельзя поменять местами, стрелки заблокированы', ready, async () => {
  const { w, errors, close } = await open();
  try {
    start(w, { count: 3, chain: true });
    const staged = w.eval(`(function () {
      const s = S(), p = s.players[0];
      const ids = PACK.deck.slice(0, 2);
      p.cards = [
        { id: 'old1', definitionId: PACK.startupIds[0], upgraded: false, usedRound: 0, managers: [], local: null },
        { id: 'old2', definitionId: ids[0], upgraded: false, usedRound: 0, managers: [], local: null },
        { id: 'new1', definitionId: ids[1], upgraded: false, usedRound: 0, managers: [], local: null },
      ];
      p.lockedOrder = ['old1', 'old2']; p.planned = false;
      s.phase = 'planning'; s.turn = 0; ui.seat = null; render();
      return 'ok';
    })();`);
    assert.equal(staged, 'ok');
    const rows = [...w.document.querySelectorAll('#line-strip .card')].map(card => ({
      left: card.querySelector('.move-row:last-child button:first-child'),
      right: card.querySelector('.move-row:last-child button:last-child'),
    }));
    assert.equal(rows.length, 3);
    assert.equal(rows[0].right.disabled, true, 'старую карту нельзя сдвинуть через другую старую');
    assert.equal(rows[1].left.disabled, true);
    assert.equal(rows[1].right.disabled, false, 'старую карту можно сдвинуть через новую');
    assert.equal(rows[2].left.disabled, false, 'новую карту можно двигать');
    assert.match(w.document.querySelector('#line-strip').textContent, /старая/);
    assert.deepEqual(errors, []);
  } finally { close(); }
});
