/* Интерфейс цифрового стола. Собирается в один файл через scripts/build-table.mjs.
   Правила берутся из packages/domain, содержимое — из packages/content. */
/* ===== Индустрия — интерфейс, часть 1 ===== */

const PACK = basePack;
const DEFS = PACK.definitions;
// ключ картинки — имя файла из каталога без расширения
const keyOf = path => path.split('/').pop().replace(/\.[^.]+$/, '');
const SEATS = [
  { base: '#c2543a', lite: '#e07a5f' },
  { base: '#2f7d8a', lite: '#4fa8b5' },
  { base: '#8a6a2f', lite: '#c19a4a' },
  { base: '#6a4a8a', lite: '#9b78bf' },
];
const RES_NAME = { coal: 'уголь', metal: 'металл', oil: 'нефть', upgrade: 'жетон модернизации', money: 'деньги' };
const RES_SHORT = { coal: 'угля', metal: 'металла', oil: 'нефти', upgrade: 'жетонов', money: 'денег' };

/* состояние интерфейса */
const ui = {
  record: null,          // { state, config }
  seat: null,            // индекс места «моего» игрока в онлайне, null = один стол
  disc: null,            // выбранный диск
  varValue: 1,           // номинал переменного диска
  focus: null,           // лот, по которому открыт расчёт
  times: 1,              // счётчик операций
  online: null,          // { code, db, room, me }
  prevWallets: {},
  settleTimer: null,
};

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => ui.record?.state ?? null;
const me = () => {
  const s = S(); if (!s) return null;
  return ui.seat == null ? s.players[s.players.findIndex(p => p.id === currentActor(s))] ?? s.players[0] : s.players[ui.seat];
};
const myTurn = () => { const s = S(); return s && currentActor(s) === me()?.id; };
const capOf = id => PACK.capitalists.find(c => c.id === id);
const capImage = c => keyOf(c.images[0]);
const src = key => `data:image/webp;base64,${CARD_IMAGES[key]}`;

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

/* ---------- ресурсы ---------- */
function resHtml(kind, value, opts = {}) {
  const zero = !value && !opts.keepZero ? ' zero' : '';
  const label = `${value} ${RES_NAME[kind]}`;
  return `<span class="res ${kind}${zero}" title="${label}" aria-label="${label}"><span class="pip"></span><span class="num">${value}</span></span>`;
}
function bundleHtml(values, mult = 1) {
  const parts = Object.entries(values || {}).filter(([, v]) => v > 0);
  if (!parts.length) return '<span class="res zero"><span class="num">—</span></span>';
  return `<span class="grp">${parts.map(([k, v]) => resHtml(k, v * mult, { keepZero: true })).join('')}</span>`;
}
function effectHtml(e) {
  if (!e) return '';
  if (e.kind === 'upgrade') return `${bundleHtml({ coal: 1, upgrade: 1 })}<span class="to">→</span><span>модернизация</span>`;
  if (e.kind === 'gain') return bundleHtml(e.gain);
  const cap = e.limitUnknown ? '<span class="cap">кратность не напечатана</span>'
    : e.limit > 1 ? `<span class="cap">до ${e.limit} раз</span>` : '';
  return `${bundleHtml(e.cost)}<span class="to">→</span>${bundleHtml(e.gain)}${cap}`;
}

/* ---------- диски ---------- */
function discHtml(disc, seatIdx, { pickable = false, chosen = false, small = false } = {}) {
  const seat = SEATS[seatIdx % SEATS.length];
  const cls = ['disc', small ? 'small' : '', pickable ? 'pickable' : '', chosen ? 'chosen' : '',
    disc.used ? 'spent' : '', disc.bonus ? 'bonus' : '', disc.kind === 'variable' ? 'variable' : ''].filter(Boolean).join(' ');
  const face = disc.kind === 'variable' && !disc.used && !disc.value ? '◇' : disc.value;
  return `<button type="button" class="${cls}" data-seat="${seatIdx}" data-disc="${disc.id}"
    style="--seat:${seat.base};--seat-lite:${seat.lite}" ${pickable ? '' : 'tabindex="-1" disabled'}
    title="${disc.bonus ? 'Дополнительная двойка Артура' : disc.kind === 'variable' ? 'Переменный диск: номинал оплачивается углём' : 'Диск ' + disc.value}">${face}</button>`;
}

/* ---------- карта ---------- */
function faceKey(card) {
  const d = DEFS[card.definitionId];
  return keyOf(d.images[card.upgraded && d.images[1] ? 1 : 0]);
}
function cardNode(card, { owner = null, lot = null, mode = 'view' } = {}) {
  const s = S(), d = DEFS[card.definitionId];
  const node = el('div', 'card');
  node.dataset.card = card.id;
  if (lot) node.dataset.lot = lot.id;

  const used = owner && card.usedRound === s.round;
  const running = s.production?.active?.cardId === card.id;
  if (used) node.classList.add('spent');
  if (running) node.classList.add('running');

  const face = el('div', 'card-face');
  const img = el('img');
  img.src = src(faceKey(card));
  img.alt = `${d.name}${card.upgraded ? ', улучшенная сторона' : ''}`;
  img.loading = 'lazy';
  face.append(img);

  if (card.upgraded) face.append(el('span', 'card-tag up', 'улучшено'));
  else if (d.kind === 'startup') face.append(el('span', 'card-tag', 'стартовое'));
  if (d.unknownLimit) {
    const w = el('span', 'card-tag warn', '!');
    w.title = 'На макете этой карты не напечатана кратность одного обмена. В игре он идёт ×1 и требует сверки с оригиналом.';
    face.append(w);
  }
  node.append(face);

  if (lot?.bids.length) {
    const pile = el('div', 'bid-pile');
    pile.innerHTML = lot.bids.map(b => {
      const p = s.players.find(x => x.id === b.playerId);
      return discHtml({ id: b.discId, value: b.value, kind: b.kind, bonus: b.bonus }, p.seat, { small: true });
    }).join('');
    node.append(pile);
  }
  return node;
}

const MANAGERS = Object.fromEntries(PACK.managers.map(m => [m.id, m]));

/* ---------- карта университета: иллюстраций нет, рисуем значения ---------- */
function tableNode(lot) {
  const s = S();
  const node = el('div', 'card university');
  node.dataset.lot = lot.id;
  const face = el('div', 'card-face uni-face');
  face.innerHTML = `
    <div class="uni-head">Университет</div>
    <div class="uni-note">Компенсацию можно разделить между двумя вариантами</div>
    <div class="uni-opt"><span class="uni-key">либо</span><span class="recipe">${effectHtml(lot.table.options[0])}</span></div>
    <div class="uni-opt"><span class="uni-key">либо</span><span class="recipe">${effectHtml(lot.table.options[1])}</span></div>
    <div class="uni-token">${lot.token
      ? `<b>Жетон управляющего</b><br>${esc(MANAGERS[lot.token].text)}`
      : '<b>Жетон уже забрали</b>'}</div>`;
  node.append(face);
  if (lot.bids.length) {
    const pile = el('div', 'bid-pile');
    pile.innerHTML = lot.bids.map(b => {
      const p = s.players.find(x => x.id === b.playerId);
      return discHtml({ id: b.discId, value: b.value, kind: b.kind, bonus: b.bonus }, p.seat, { small: true });
    }).join('');
    node.append(pile);
  }
  return node;
}

/* ---------- расчёт ставки: главный элемент интерфейса ---------- */
function ledgerNode(lot) {
  const s = S(), p = me();
  const disc = ui.disc && p.discs.find(d => d.id === ui.disc);
  const value = disc ? (disc.kind === 'variable' ? ui.varValue : disc.value) : null;
  const box = el('div', 'ledger');

  if (!disc) {
    box.innerHTML = `<div class="ledger-head">СНАЧАЛА ВЫБЕРИТЕ ДИСК</div>
      <div class="ledger-note">Ставка решает две задачи сразу: крупный диск борется за предприятие, мелкий — за компенсацию. Выберите диск внизу, и здесь появится точный расчёт.</div>`;
    return box;
  }
  const err = bidError(s, p.id, disc.id, lot.id, value);
  if (lot.kind === 'university') {
    const units = value + (p.ability === 'compensation-plus-one' ? 1 : 0);
    box.innerHTML = `
      <div class="ledger-head">СТАВКА ${value} НА УНИВЕРСИТЕТ</div>
      <div class="ledger-row win"><span class="ledger-key">Выиграете</span>
        <span class="ledger-val">жетон управляющего: ${lot.token ? esc(MANAGERS[lot.token].text) : 'уже забран'}</span></div>
      <div class="ledger-row lose"><span class="ledger-key">Проиграете</span>
        <span class="ledger-val"><b>${units}</b> единиц компенсации, делите между двумя вариантами карты</span></div>`;
    if (err) box.append(el('div', 'ledger-note', `<em>${esc(err)}</em>`));
    return box;
  }
  const out = bidOutcome(s, DEFS, p.id, lot.id, value);
  const d = DEFS[lot.card.definitionId];
  const compText = out.compensation.kind === 'gain'
    ? `${bundleHtml(out.compensation.gain, out.units)}`
    : out.max > 0
      ? `${bundleHtml(out.compensation.cost, out.max)}<span class="to">→</span>${bundleHtml(out.compensation.gain, out.max)}`
      : '<span class="res zero"><span class="num">ничего: не хватает сырья</span></span>';

  box.innerHTML = `
    <div class="ledger-head">СТАВКА ${value} НА «${esc(d.name).toUpperCase()}»</div>
    <div class="ledger-row win"><span class="ledger-key">Выиграете</span>
      <span class="ledger-val">предприятие в свою линию${out.leading ? '' : `<br><span class="cap">сейчас впереди ставка ${out.bestRival}</span>`}</span></div>
    <div class="ledger-row lose"><span class="ledger-key">Проиграете</span>
      <span class="ledger-val recipe">${compText}</span></div>`;

  const notes = [];
  if (p.ability === 'compensation-plus-one' && value >= 0) notes.push(`Генри: компенсация считается как <em>${out.units}</em>, а не ${value}.`);
  if (disc.kind === 'variable') notes.push(`Переменный диск: <em>${value}</em> угля спишется сразу. Останется ${p.wallet.coal - value}.`);
  if (out.compensation.kind === 'convert' && out.max < out.units && out.max > 0) notes.push(`Сырья хватит только на <em>${out.max}</em> из ${out.units} операций.`);
  if (err) notes.push(`<em>${esc(err)}</em>`);
  if (notes.length) box.append(el('div', 'ledger-note', notes.join('<br>')));
  return box;
}

/* ---------- верхняя планка ---------- */
function renderRail() {
  const s = S();
  const phases = { auction: 'аукцион', settlement: 'разбор лотов', planning: 'планирование линии', production: 'производство', finished: 'итог' };
  $('#rail').innerHTML = `
    <span class="logo">ИНДУ<b>С</b>ТРИЯ</span>
    <span class="rounds" aria-label="Раунд ${s.round} из 4">${[1, 2, 3, 4].map(r =>
      `<i class="${r < s.round ? 'done' : r === s.round ? 'now' : ''}"></i>`).join('')}</span>
    <span class="phase-name">раунд ${s.round} · <b>${phases[s.phase]}</b></span>
    <span class="spacer"></span>
    ${ui.online ? `<button class="chip live" data-open="invite">стол ${esc(ui.online.code)}</button>` : ''}
    <button class="chip" data-open="gallery">Карты</button>
    <button class="chip" data-open="log">Журнал</button>
    <button class="chip" data-open="setup">Новая партия</button>`;
}

/* ---------- соперники ---------- */
function renderRivals() {
  const s = S(), mine = me();
  const box = $('#rivals');
  box.innerHTML = '';
  for (const p of s.players) {
    if (p.id === mine.id) continue;
    const seat = SEATS[p.seat % SEATS.length];
    const node = el('div', 'rival');
    node.style.setProperty('--seat', seat.base);
    if (currentActor(s) === p.id) node.classList.add('acting');
    if (s.phase === 'production' && p.done) node.classList.add('finished');
    const cap = p.capitalistId ? capOf(p.capitalistId) : null;
    const lastRoll = [...s.events].reverse().find(e => e.playerId === 'agent' && e.roll)?.roll;
    node.innerHTML = p.agent
      ? `<div class="rival-top">
          <span class="rival-name">${esc(p.name)}</span>
          <span class="rival-cap" title="Агент базовой игры: бросок d6 выбирает предприятие, затем ставится минимальный легальный диск. Экономику не копит.">ставит сам</span>
        </div>
        <div class="rival-row"><span class="res"><span class="num" style="color:var(--frost)">${
          lastRoll ? 'последний бросок d6: ' + lastRoll : 'ещё не ходил'}</span></span></div>
        <div class="rival-row discs">${p.discs.map(d => discHtml(d, p.seat, { small: true })).join('')}</div>`
      : `<div class="rival-top">
          <span class="rival-name">${esc(p.name)}</span>
          ${cap ? `<span class="rival-cap" title="${esc(cap.text)}">${esc(cap.name)}</span>` : ''}
        </div>
        <div class="rival-row">
          ${resHtml('money', p.wallet.money, { keepZero: true })}
          ${['coal', 'metal', 'oil', 'upgrade'].map(k => resHtml(k, p.wallet[k])).join('')}
          <span class="res" title="предприятий"><span class="num" style="color:var(--frost)">${p.cards.length} пр.</span></span>
        </div>
        <div class="rival-row discs">${p.discs.map(d => discHtml(d, p.seat, { small: true })).join('')}</div>`;
    box.append(node);
  }
}

/* ---------- сцена: лоты или разбор ---------- */
function renderStage() {
  const s = S(), head = $('#stage-head'), strip = $('#stage-strip');
  strip.innerHTML = '';

  if (s.phase === 'auction' || s.phase === 'settlement') {
    const open = s.lots.filter(l => !l.resolved).length;
    head.innerHTML = s.phase === 'auction'
      ? `<h2>ЛОТЫ РАУНДА</h2><span>${s.lots.length} предприятий · разбор пойдёт слева направо</span>`
      : `<h2>РАЗБОР ЛОТОВ</h2><span>осталось ${open} — сначала компенсации, потом карта</span>`;

    s.lots.forEach((lot, i) => {
      const node = lot.kind === 'university' ? tableNode(lot) : cardNode(lot.card, { lot });
      const current = s.phase === 'settlement' && i === s.settlement.index;
      if (lot.resolved) node.classList.add('dim');
      if (current) node.classList.add('lifted');

      if (s.phase === 'auction') {
        const focused = ui.focus === lot.id;
        if (focused) node.classList.add('lifted');
        node.tabIndex = 0;
        node.style.cursor = 'pointer';
        node.addEventListener('click', ev => {
          if (ev.target.closest('.card-cta')) return;
          ui.focus = ui.focus === lot.id ? null : lot.id;
          render();
        });
        node.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); node.click(); } });

        if (focused) {
          node.append(ledgerNode(lot));
          const p = me();
          const disc = ui.disc && p.discs.find(d => d.id === ui.disc);
          const value = disc ? (disc.kind === 'variable' ? ui.varValue : disc.value) : null;
          const err = !myTurn() ? 'Сейчас ходит другой игрок'
            : !disc ? 'Выберите диск' : bidError(s, p.id, disc.id, lot.id, value);
          const cta = el('button', `card-cta ${err ? '' : 'go'}`, err ? esc(err) : `Поставить ${value}`);
          cta.disabled = !!err;
          cta.addEventListener('click', ev => {
            ev.stopPropagation();
            act({ type: 'Bid', discId: disc.id, lotId: lot.id, value });
            ui.focus = null; ui.disc = null;
          });
          node.append(cta);
        }
      }
      strip.append(node);
    });
    return;
  }

  /* планирование и производство: сцена показывает чужие линии компактно */
  head.innerHTML = s.phase === 'planning'
    ? '<h2>ЛИНИИ ИГРОКОВ</h2><span>порядок решает, каким сырьём вы сможете заплатить дальше</span>'
    : s.phase === 'production'
      ? '<h2>ЛИНИИ ИГРОКОВ</h2><span>предприятие работает один раз за раунд</span>'
      : '<h2>ПАРТИЯ ОКОНЧЕНА</h2><span></span>';

  for (const p of s.players) {
    if (p.id === me().id || p.agent) continue;
    const wrap = el('div', 'card');
    wrap.style.width = 'auto';
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px';
    p.cards.forEach(c => {
      const n = cardNode(c, { owner: p });
      n.style.width = 'calc(var(--card-w) * .72)';
      row.append(n);
    });
    const label = el('div', '', `<span class="rival-name" style="color:${SEATS[p.seat % 4].lite}">${esc(p.name)}</span>`);
    label.style.cssText = 'font-size:13px;margin-bottom:6px';
    const box = el('div');
    box.append(label, row);
    strip.append(box);
  }
  if (!strip.children.length) strip.append(el('div', '', '<span style="color:var(--frost)">Соперников не видно.</span>'));
}

/* ===== Индустрия — интерфейс, часть 2 ===== */

/* ---------- планшет игрока ---------- */
function renderBoard() {
  const s = S(), p = me();
  const seat = SEATS[p.seat % SEATS.length];
  const cap = p.capitalistId ? capOf(p.capitalistId) : null;

  $('#board').style.setProperty('--seat', seat.base);
  $('#board-head').innerHTML = `
    <span class="you">
      <span class="you-name" style="color:${seat.lite}">${esc(p.name)}</span>
      ${cap ? `<button class="you-cap" data-cap="${cap.id}">${esc(cap.name)}</button>` : ''}
    </span>
    ${p.managers.length ? `<span class="managers" title="Жетоны управляющих">${
      p.managers.map(id => `<span class="token" title="${esc(MANAGERS[id].text)}">У</span>`).join('')}</span>` : ''}
    <span class="vault">
      ${resHtml('money', p.wallet.money, { keepZero: true })}
      ${['coal', 'metal', 'oil', 'upgrade'].map(k => resHtml(k, p.wallet[k], { keepZero: true })).join('')}
    </span>`;

  renderPrompt();
  renderEffect();
  renderLine();
}

function promptBox(text, calm = false) {
  const box = $('#prompt');
  box.className = `prompt${calm ? ' calm' : ''}`;
  box.innerHTML = `<span class="prompt-text">${text}</span>`;
  return box;
}

function renderPrompt() {
  const s = S(), p = me();
  const waiting = !myTurn();
  const actorName = esc(s.players.find(x => x.id === currentActor(s))?.name ?? '');

  if (s.phase === 'auction') {
    if (waiting) return promptBox(`Ставку делает <b>${actorName}</b>.`, true);
    const pair = s.pendingPair?.playerId === p.id;   // только в режиме обновлённой карты «Интербеллума»
    const box = promptBox(pair
      ? 'Можно доставить дополнительную двойку Артура — но только <b>на другое предприятие</b>. Или пропустите: диск останется у вас.'
      : ui.disc ? 'Теперь выберите предприятие: в карточке появится расчёт обоих исходов.'
        : 'Выберите диск, затем предприятие. <b>Мелкий диск — это не проигрыш</b>, а заказ компенсации.');

    const row = el('span', 'discs');
    p.discs.forEach(d => {
      if (pair && !d.bonus) return;
      const btn = el('span', '', discHtml(d, p.seat, { pickable: !d.used, chosen: ui.disc === d.id })).firstChild;
      btn.addEventListener('click', () => { ui.disc = ui.disc === d.id ? null : d.id; render(); });
      row.append(btn);
    });
    box.append(row);

    const chosen = ui.disc && p.discs.find(d => d.id === ui.disc);
    if (chosen?.kind === 'variable') {
      const wrap = el('span', 'counter');
      wrap.style.margin = '0';
      wrap.innerHTML = `<span class="cap">номинал</span>`;
      const minus = el('button', '', '−'), plus = el('button', '', '+');
      const val = el('span', 'times', ui.varValue);
      minus.disabled = ui.varValue <= 0; plus.disabled = ui.varValue >= p.wallet.coal;
      minus.onclick = () => { ui.varValue--; render(); };
      plus.onclick = () => { ui.varValue++; render(); };
      wrap.append(minus, val, plus, el('span', 'cap', `уголь: ${p.wallet.coal}`));
      box.append(wrap);
    }
    if (pair) {
      const skip = el('button', 'act ghost', 'Не ставить двойку');
      skip.onclick = () => act({ type: 'SkipPair' });
      box.append(skip);
    }
    return box;
  }

  if (s.phase === 'settlement') {
    const pending = s.settlement.pending;
    const lot = s.lots[s.settlement.index];
    if (!pending) return promptBox(`Открываем лот <b>${s.settlement.index + 1}</b> из ${s.lots.length}…`, true);
    if (pending.playerId !== p.id) {
      return promptBox(`<b>${esc(s.players.find(x => x.id === pending.playerId).name)}</b> выбирает, сколько раз применить компенсацию.`, true);
    }
    return promptBox(`Ваш диск проиграл лот. Компенсация — до <b>${pending.limit}</b> операций, можно взять меньше или отказаться.`);
  }

  if (s.phase === 'planning') {
    if (p.planned) return promptBox('План принят. Ждём остальных игроков.', true);
    if (waiting) return promptBox(`Линию расставляет <b>${actorName}</b>.`, true);
    const box = promptBox(s.config.productionChain
      ? 'Цепочка: новые предприятия можно вставить куда угодно, но старые сохраняют взаимный порядок. Производство пойдёт <b>строго слева направо</b>.'
      : 'Расставьте линию. Порядок решает, чем вы заплатите за следующее предприятие.');
    const go = el('button', 'act', 'Принять план');
    go.onclick = () => act({ type: 'ConfirmPlan' });
    box.append(go);
    return box;
  }

  if (s.phase === 'production') {
    if (p.done) return promptBox('Производство завершено. Ждём остальных.', true);
    if (waiting) return promptBox(`Производит <b>${actorName}</b>.`, true);
    const active = s.production.active;
    const left = p.cards.filter(c => c.usedRound !== s.round).length;
    const box = promptBox(active
      ? 'Идёт работа предприятия — разберите строки сверху вниз.'
      : left ? `Осталось предприятий: <b>${left}</b>. Выберите следующее в линии внизу.`
        : 'Все предприятия отработали.');

    if (!active && p.ability === 'repeat-card' && !p.repeated && p.wallet.coal >= 2
      && p.cards.some(c => c.usedRound === s.round)) {
      const btn = el('button', 'act ghost', 'Эварист: повторить за 2 угля');
      btn.onclick = () => { ui.repeatPick = !ui.repeatPick; render(); };
      box.append(btn);
    }
    if (!active && !left) {
      const fin = el('button', 'act', 'Завершить производство');
      fin.onclick = () => act({ type: 'FinishProduction' });
      box.append(fin);
    }
    return box;
  }

  if (s.phase === 'finished') {
    const box = promptBox('Партия окончена.', true);
    const btn = el('button', 'act', 'Показать итог');
    btn.onclick = showResult;
    box.append(btn);
    return box;
  }
}

/* ---------- панель текущего эффекта ---------- */
function counterPanel({ title, steps, stepIndex, effect, max, onRun, onSkip, runLabel, skipLabel }) {
  const box = el('div', 'effect');
  const head = el('div', 'effect-head');
  head.innerHTML = `<span>${title}</span>` + (steps
    ? `<span class="step">${Array.from({ length: steps }, (_, i) => `<i class="${i <= stepIndex ? 'on' : ''}"></i>`).join('')}</span>` : '');
  box.append(head);
  box.append(el('div', 'recipe', effectHtml(effect)));

  ui.times = Math.min(Math.max(ui.times, 1), Math.max(max, 1));
  const row = el('div', 'counter');
  const minus = el('button', '', '−'), plus = el('button', '', '+');
  const val = el('span', 'times', ui.times);
  minus.disabled = ui.times <= 1; plus.disabled = ui.times >= max;
  minus.onclick = () => { ui.times--; render(); };
  plus.onclick = () => { ui.times++; render(); };
  const result = el('span', 'result');
  result.innerHTML = max > 0
    ? `<span class="cap">отдадите</span>${bundleHtml(effect.cost, ui.times)}<span class="cap">получите</span>${bundleHtml(effect.gain, ui.times)}`
    : '<span class="cap">не хватает сырья</span>';
  row.append(minus, val, plus, el('span', 'cap', `макс. ${max}`), result);
  box.append(row);

  const actions = el('div', 'counter');
  const run = el('button', 'act', runLabel);
  run.disabled = max < 1;
  run.onclick = () => onRun(ui.times);
  const skip = el('button', 'act ghost', skipLabel);
  skip.onclick = onSkip;
  actions.append(run, skip);
  box.append(actions);
  return box;
}

/** Компенсация университета: единицы делятся между двумя вариантами. */
function splitPanel(pending, p) {
  const box = el('div', 'effect');
  if (!Array.isArray(ui.picks) || ui.picks.length !== pending.options.length) ui.picks = pending.options.map(() => 0);
  const used = ui.picks.reduce((a, b) => a + b, 0);
  const left = pending.limit - used;

  box.append(el('div', 'effect-head',
    `<span>Компенсация университета — распределите <b>${pending.limit}</b></span>`));
  pending.options.forEach((e, i) => {
    const row = el('div', 'counter');
    const minus = el('button', '', '−'), plus = el('button', '', '+');
    const val = el('span', 'times', ui.picks[i]);
    // Вариант-обмен ограничен ещё и запасом: считаем, хватит ли на следующее применение.
    const afford = e.kind === 'gain' || canPay(p.wallet, e.cost, ui.picks[i] + 1);
    minus.disabled = ui.picks[i] <= 0;
    plus.disabled = left <= 0 || !afford;
    minus.onclick = () => { ui.picks[i]--; render(); };
    plus.onclick = () => { ui.picks[i]++; render(); };
    row.append(minus, val, plus, el('span', 'recipe', effectHtml(e)));
    if (e.kind === 'convert' && !afford && left > 0) row.append(el('span', 'cap', 'не хватает сырья'));
    box.append(row);
  });

  const actions = el('div', 'counter');
  actions.append(el('span', 'cap', left ? `осталось распределить: ${left}` : 'всё распределено'));
  const run = el('button', 'act', 'Взять компенсацию');
  run.onclick = () => { const picks = ui.picks; ui.picks = null; act({ type: 'Compensate', picks }); };
  const skip = el('button', 'act ghost', 'Отказаться');
  skip.onclick = () => { ui.picks = null; act({ type: 'Compensate', picks: pending.options.map(() => 0) }); };
  actions.append(run, skip);
  box.append(actions);
  return box;
}

function renderEffect() {
  const s = S(), p = me(), slot = $('#effect-slot');
  slot.innerHTML = '';

  if (s.phase === 'settlement') {
    const pending = s.settlement.pending;
    if (!pending || pending.playerId !== p.id) return;
    if (pending.options.length > 1) { slot.append(splitPanel(pending, p)); return; }
    const e = pending.options[0];
    let max = 0;
    for (let t = pending.limit; t >= 1; t--) if (canPay(p.wallet, e.cost, t)) { max = t; break; }
    slot.append(counterPanel({
      title: 'Компенсация за проигранный лот', effect: e, max,
      runLabel: 'Применить', skipLabel: 'Отказаться',
      onRun: times => act({ type: 'Compensate', picks: [times] }),
      onSkip: () => act({ type: 'Compensate', picks: [0] }),
    }));
    return;
  }

  if (s.phase !== 'production' || !myTurn()) return;
  const a = s.production.active;
  if (!a) return;
  const card = p.cards.find(c => c.id === a.cardId), d = DEFS[card.definitionId];
  const list = [...d.effects, ...(card.upgraded ? d.advanced : [])];
  const e = list[a.index];
  if (!e) return;

  if (e.kind === 'upgrade') {
    const box = el('div', 'effect upgrade-step');
    const cost = p.wallet.upgrade > 0 ? { coal: 1, upgrade: 1 }
      : p.ability === 'metal-for-upgrade' ? { coal: 1, metal: 1 } : { coal: 1, upgrade: 1 };
    const targets = p.cards.filter(c => !c.upgraded && DEFS[c.definitionId].kind === 'company');
    const paid = canPay(p.wallet, cost);
    const offer = targets.length > 0 && paid;

    box.append(el('div', 'effect-head',
      `<span>${offer ? 'Можно модернизировать предприятие' : 'Модернизация'} — строка ${a.index + 1} из ${list.length}</span>
       <span class="step">${list.map((_, i) => `<i class="${i <= a.index ? 'on' : ''}"></i>`).join('')}</span>`));
    box.append(el('div', 'recipe',
      `${bundleHtml(cost)}<span class="to">\u2192</span><span>предприятие переворачивается на улучшенную сторону и получает новые строки</span>`));
    if (p.ability === 'metal-for-upgrade' && p.wallet.upgrade === 0)
      box.append(el('div', 'ledger-note', 'Тимур: жетоны кончились, поэтому платите металлом.'));

    const row = el('div', 'counter');
    if (!targets.length) {
      row.append(el('span', 'cap', p.cards.length > 1
        ? 'Все ваши предприятия уже улучшены. Стартовое улучшать нельзя.'
        : 'Улучшать нечего: у вас только стартовое предприятие, а оно не улучшается.'));
    } else if (!paid) {
      const short = Object.entries(cost).filter(([k, v]) => p.wallet[k] < v)
        .map(([k, v]) => `${v - p.wallet[k]} ${RES_SHORT[k]}`).join(' и ');
      row.append(el('span', 'cap', `Не хватает ${short}.`));
    } else {
      targets.forEach(c => {
        const btn = el('button', 'act', `Улучшить: ${DEFS[c.definitionId].name}`);
        btn.onclick = () => act({ type: 'Upgrade', cardId: c.id });
        row.append(btn);
      });
    }
    const skip = el('button', 'act ghost', offer ? 'Не улучшать' : 'Дальше');
    skip.onclick = () => act({ type: 'NextEffect' });
    row.append(skip);
    box.append(row);
    slot.append(box);
    return;
  }

  if (e.kind === 'convert') {
    const room = e.limit - a.used;
    let max = 0;
    for (let t = room; t >= 1; t--) if (canPay(p.wallet, e.cost, t)) { max = t; break; }
    slot.append(counterPanel({
      title: `${esc(d.name)} — строка ${a.index + 1} из ${list.length}`,
      steps: list.length, stepIndex: a.index, effect: e, max,
      runLabel: 'Выполнить', skipLabel: a.used ? 'Дальше' : 'Пропустить строку',
      onRun: times => act({ type: 'Convert', times }),
      onSkip: () => act({ type: 'NextEffect' }),
    }));
  }
}

/* ---------- ваша линия ---------- */
function renderLine() {
  const s = S(), p = me(), strip = $('#line-strip');
  strip.innerHTML = '';
  const planning = s.phase === 'planning' && !p.planned && myTurn();
  const producing = s.phase === 'production' && myTurn() && !p.done;

  $('#line-head').textContent = planning
    ? (s.config.productionChain ? 'Ваша линия — двигайте только новые предприятия' : 'Ваша линия — порядок можно менять свободно')
    : `Ваша линия · ${p.cards.length} предприятий`;

  p.cards.forEach((card, i) => {
    const node = cardNode(card, { owner: p });
    const used = card.usedRound === s.round;

    if (planning) {
      node.classList.add('movable');
      const row = el('div', 'move-row');
      const left = el('button', '', '←'), right = el('button', '', '→');
      left.disabled = i === 0; right.disabled = i === p.cards.length - 1;
      left.onclick = () => moveCard(i, i - 1);
      right.onclick = () => moveCard(i, i + 1);
      row.append(left, right);
      node.append(row);
    } else if (producing && ui.repeatPick && used) {
      const btn = el('button', 'card-cta go', 'Повторить за 2 угля');
      btn.onclick = () => { ui.repeatPick = false; act({ type: 'RepeatCard', cardId: card.id }); };
      node.append(btn);
    } else if (producing && !s.production.active) {
      // Подсказка: строка модернизации живёт на стартовом предприятии, найти её неочевидно.
      const rows = [...DEFS[card.definitionId].effects, ...(card.upgraded ? DEFS[card.definitionId].advanced : [])];
      if (!used && rows.some(r => r.kind === 'upgrade')
        && p.cards.some(c => !c.upgraded && DEFS[c.definitionId].kind === 'company'))
        node.querySelector('.card-face').append(el('span', 'card-tag hint', 'здесь модернизация'));
      const chainWait = s.config.productionChain && p.cards.find(c => c.usedRound !== s.round)?.id !== card.id;
      const btn = el('button', `card-cta ${used || chainWait ? '' : 'go'}`,
        used ? 'Отработало' : chainWait ? 'Ждёт очереди' : 'Запустить');
      btn.disabled = used || chainWait;
      btn.onclick = () => { ui.times = 1; act({ type: 'UseCard', cardId: card.id }); };
      node.append(btn);
    }
    strip.append(node);
  });
}

function moveCard(from, to) {
  const p = me();
  const ids = p.cards.map(c => c.id);
  const [x] = ids.splice(from, 1);
  ids.splice(to, 0, x);
  act({ type: 'ArrangeCards', cardIds: ids });
}

/* ---------- журнал ---------- */
const LOG_TEXT = {
  GameStarted: () => 'Партия началась',
  AuctionStarted: e => `Выставлено лотов: ${e.count}`,
  DeckRefilled: () => 'Невыкупленные лоты вернулись в колоду (в каталоге 31 предприятие вместо 36)',
  BidPlaced: (e, n) => `<b>${n(e.playerId)}</b> ставит ${e.value}${e.bonus ? ' (доп. двойка)' : ''}${e.roll ? ' · d6: ' + e.roll : ''}`,
  AgentTookCard: e => `Агент забирает «${DEFS[e.definitionId].name}» за ${e.value} — карта выбывает из игры`,
  AgentBlocked: e => `Агенту ставить некуда (d6: ${e.roll})`,
  PairOffered: (e, n) => `<b>${n(e.playerId)}</b> может доставить дополнительную двойку`,
  AuctionClosed: () => 'Ставок больше нет',
  Compensation: (e, n) => e.times ? `<b>${n(e.playerId)}</b> берёт компенсацию ×${e.times}` : `<b>${n(e.playerId)}</b> без компенсации`,
  CompensationChosen: (e, n) => `<b>${n(e.playerId)}</b> применяет компенсацию ×${e.times}`,
  CardWon: (e, n) => `<b>${n(e.playerId)}</b> забирает «${DEFS[e.definitionId].name}» за ${e.value}`,
  CardDiscarded: () => 'Лот никто не взял',
  ManagerWon: (e, n) => `<b>${n(e.playerId)}</b> забирает жетон управляющего за ${e.value}`,
  ManagerDiscarded: () => 'На университет не поставили — жетон сброшен',
  AgentTookManager: () => 'Жетон управляющего достался агенту и выбыл',
  PlanningStarted: () => 'Расстановка линий',
  PlanConfirmed: (e, n) => `<b>${n(e.playerId)}</b> принял план`,
  ProductionStarted: () => 'Производство',
  CardStarted: (e, n) => `<b>${n(e.playerId)}</b> запускает предприятие`,
  ResourceGained: (e, n) => `<b>${n(e.playerId)}</b> получает ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  ConversionPerformed: (e, n) => `<b>${n(e.playerId)}</b>: ${Object.entries(e.cost).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(' + ')} → ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  CardUpgraded: (e, n) => `<b>${n(e.playerId)}</b> модернизирует предприятие`,
  CardRepeated: (e, n) => `<b>${n(e.playerId)}</b> повторяет предприятие за 2 угля`,
  CardCompleted: () => null,
  CardsArranged: () => null,
  GameFinished: () => 'Четвёртый раунд сыгран',
};

function renderLog() {
  const s = S();
  const name = id => esc(s.players.find(p => p.id === id)?.name ?? '');
  const list = $('#log');
  list.innerHTML = '';
  let round = 0;
  for (const e of s.events) {
    if (e.round !== round) { round = e.round; list.append(el('li', 'round-mark', `РАУНД ${round}`)); }
    const text = LOG_TEXT[e.type]?.(e, name);
    if (text) list.append(el('li', '', text));
  }
  list.scrollTop = list.scrollHeight;
}

/* ---------- сборка кадра ---------- */
function render() {
  const s = S();
  if (!s) return;
  clearTimeout(ui.settleTimer);

  renderRail(); renderRivals(); renderStage(); renderBoard(); renderLog();

  // вспышка на изменившихся запасах
  for (const p of s.players) {
    const prev = ui.prevWallets[p.id];
    if (prev) {
      for (const k of ['coal', 'metal', 'oil', 'upgrade', 'money']) {
        if (prev[k] !== p.wallet[k] && p.id === me().id) {
          document.querySelectorAll(`.vault .res.${k}`).forEach(n => {
            n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
          });
        }
      }
    }
    ui.prevWallets[p.id] = { ...p.wallet };
  }

  // разбор лотов идёт сам, с паузой — чтобы было видно, что происходит
  if (s.phase === 'settlement' && !s.settlement.pending && myTurn()) {
    ui.settleTimer = setTimeout(() => act({ type: 'ResolveLot' }, true), 900);
  }
  if (s.phase === 'finished' && !ui.shownResult) { ui.shownResult = true; showResult(); }
}

/* ---------- команды ---------- */
function act(command, quiet = false) {
  const s = S();
  try {
    const next = dispatch(s, { ...command, actorId: me().id, expectedRevision: s.revision }, DEFS);
    ui.record.state = next;
    ui.times = 1;
    if (command.type !== 'ArrangeCards') ui.focus = null;
    save();
    render();
  } catch (err) {
    if (!quiet) toast(err.message || 'Действие недоступно.');
    render();
  }
}

/* ---------- сохранение ---------- */
const KEY = 'industry.table.v1';
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ state: ui.record.state, seat: ui.seat })); } catch { /* приватный режим */ }
  pushOnline();
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.state?.rulesVersion === RULES_VERSION ? data : null;
  } catch { return null; }
}

/* ---------- итог ---------- */
function showResult() {
  const s = S();
  $('#result-body').innerHTML = `
    <h2>Итог партии</h2>
    <p>Сначала деньги, затем число предприятий, затем сырьё.</p>
    <table class="score">
      <tr><th>Игрок</th><th>Деньги</th><th>Предприятий</th><th>Сырьё</th></tr>
      ${s.result.map(r => `<tr class="${r.winner ? 'win' : ''}">
        <td>${esc(r.name)}${r.winner ? ' ★' : ''}</td>
        <td>${resHtml('money', r.money, { keepZero: true })}</td>
        <td>${r.companies}</td><td>${r.resources}</td></tr>`).join('')}
    </table>`;
  $('#result').showModal();
}

/* ---------- каталог карт ---------- */
function renderGallery(filter = 'company') {
  const groups = {
    company: PACK.deck.filter((v, i, a) => a.indexOf(v) === i).map(id => DEFS[id]),
    startup: PACK.startupIds.map(id => DEFS[id]),
    capitalist: PACK.capitalists,
  };
  const body = $('#gallery-body');
  body.innerHTML = `
    <h2>Карты стола</h2>
    <p>${PACK.observedCompanies} предприятий из ${PACK.expectedCompanies} в базовой коробке. Изображения — ваши макеты из репозитория.</p>
    <div class="tabs">
      ${[['company', 'Предприятия'], ['startup', 'Стартовые'], ['capitalist', 'Промышленники']]
      .map(([k, t]) => `<button data-tab="${k}" class="${k === filter ? 'on' : ''}">${t}</button>`).join('')}
    </div>
    <div class="gallery"></div>`;
  const grid = body.querySelector('.gallery');
  if (filter === 'capitalist') {
    for (const c of PACK.capitalists) {
      const box = el('div');
      box.innerHTML = `<img src="${src(capImage(c))}" alt="${esc(c.name)}">
        <div style="font-size:12.5px;margin-top:6px"><b>${esc(c.name)}</b><br><span style="color:var(--frost)">${esc(c.text)}</span></div>`;
      box.querySelector('img').onclick = () => zoom(capImage(c));
      grid.append(box);
    }
  } else {
    for (const d of groups[filter]) {
      for (const key of d.images.map(keyOf)) {
        const img = el('img');
        img.src = src(key); img.alt = d.name; img.loading = 'lazy';
        img.onclick = () => zoom(key);
        grid.append(img);
      }
    }
  }
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderGallery(b.dataset.tab));
}
function zoom(key) {
  $('#zoom').innerHTML = `<img src="${src(key)}" alt="">`;
  $('#zoom').onclick = () => $('#zoom').close();
  $('#zoom').showModal();
}

/* ---------- новая партия ---------- */
function openSetup() {
  const form = $('#setup-form');
  const field = name => form.querySelector(`[name="${name}"]`);
  form.onsubmit = ev => {
    ev.preventDefault();
    const count = Number(field('count').value);
    const names = [...form.querySelectorAll('.pname')].slice(0, count).map((i, n) => i.value.trim() || `Игрок ${n + 1}`);
    try {
      const state = createGame({
        names, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
        universities: field('universities').checked,
      variableCapital: field('variable').checked,
        productionChain: field('chain').checked,
        capitalists: field('capitalists').checked,
      }, PACK);
      ui.record = { state }; ui.seat = null; ui.disc = null; ui.focus = null; ui.shownResult = false;
      ui.prevWallets = {};
      save(); render();
      $('#setup').close();
    } catch (err) { toast(err.message); }
  };
  const sync = () => {
    const n = Number(field('count').value);
    form.querySelectorAll('.pname-row').forEach((row, i) => row.style.display = i < n ? '' : 'none');
    $('#deck-warn').style.display = n === 4 ? '' : 'none';
    $('#agent-note').style.display = n === 2 ? '' : 'none';
  };
  field('count').onchange = sync; sync();
  $('#setup').showModal();
}

/* ---------- онлайн ---------- */
async function joinOnline(code, fresh) {
  if (typeof claude === 'undefined' || !claude?.use) {
    toast('Онлайн-стол работает только на опубликованной странице.'); return false;
  }
  const db = await claude.use('db');
  if (!db) { toast('Онлайн-стол здесь недоступен — играем на одном устройстве.'); return false; }
  const user = await claude.use('user');
  const myId = user ? await user.id() : 'anon';
  const doc = db.doc(`games/${code}`);

  if (fresh) {
    await doc.set({ state: trim(ui.record.state), seats: { p0: myId }, updated: Date.now() });
    ui.seat = 0;
  } else {
    const snap = await doc.get();
    if (!snap?.state) { toast(`Стол ${code} не найден.`); return false; }
    ui.record = { state: snap.state };
    const seats = { ...(snap.seats ?? {}) };
    let mine = Object.entries(seats).find(([, v]) => v === myId)?.[0];
    if (!mine) {
      mine = ui.record.state.players.map(p => p.id).find(id => !seats[id]);
      if (!mine) { toast('Все места за этим столом заняты.'); return false; }
      seats[mine] = myId;
      await doc.update({ seats });
    }
    ui.seat = Number(mine.slice(1));
  }
  ui.online = { code, doc };
  doc.onSnapshot(snap => {
    if (!snap?.state || snap.state.revision <= (S()?.revision ?? -1)) return;
    ui.record.state = snap.state;
    render();
  });
  render();
  return true;
}
const trim = state => ({ ...state, events: state.events.slice(-150) });
function pushOnline() {
  if (!ui.online) return;
  ui.online.doc.update({ state: trim(ui.record.state), updated: Date.now() })
    .catch(() => toast('Не удалось отправить ход: нужен доступ на редактирование этого артефакта.'));
}

/* ---------- запуск ---------- */
function bindShell() {
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-close]')) ev.target.closest('dialog')?.close();
    const open = ev.target.closest('[data-open]')?.dataset.open;
    if (open === 'log') $('#drawer').classList.toggle('open');
    if (open === 'gallery') { renderGallery(); $('#gallery').showModal(); }
    if (open === 'setup') openSetup();
    if (open === 'invite') {
      $('#invite-body').innerHTML = `<h2>Стол ${esc(ui.online.code)}</h2>
        <p>Отправьте друзьям ссылку на эту страницу и код стола. Они откроют её, нажмут «Новая партия» → «Присоединиться» и введут код.</p>
        <div class="warn-box">Чтобы друзья могли делать ходы, артефакт нужно расшарить им с правом редактирования. Иначе они увидят стол, но не смогут ходить.</div>`;
      $('#invite').showModal();
    }
    const cap = ev.target.closest('[data-cap]')?.dataset.cap;
    if (cap) {
      const c = capOf(cap);
      $('#zoom').innerHTML = `<img src="${src(capImage(c))}" alt="${esc(c.name)}">`;
      $('#zoom').onclick = () => $('#zoom').close();
      $('#zoom').showModal();
    }
  });
  $('#join-form').onsubmit = async ev => {
    ev.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (code && await joinOnline(code, false)) { $('#setup').close(); }
  };
  $('#host-btn').onclick = async () => {
    if (!S()) { toast('Сначала начните партию, потом откройте её для друзей.'); return; }
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    if (await joinOnline(code, true)) { $('#setup').close(); toast(`Стол ${code} открыт.`); }
  };
}

function boot() {
  bindShell();
  const saved = loadLocal();
  if (saved) { ui.record = { state: saved.state }; ui.seat = saved.seat ?? null; render(); }
  else openSetup();
}
boot();
