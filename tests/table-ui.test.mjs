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
