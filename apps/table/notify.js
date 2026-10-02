/* ===== Индустрия — уведомления, настройки и горячие клавиши =====
   Собирается сразу после ui.js. render() вызывает afterRender(s) в конце каждого кадра. */

const PREFS_KEY = 'industry.table.prefs';
const prefs = { sound: true, sfx: true, anim: true, notify: false, feed: true, banner: true, handoff: false, ...loadPrefs() };
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* приватный режим */ } }

const BASE_TITLE = document.title;
const watch = { seq: null, phase: null, round: null, mine: false, actor: null, record: null, wallet: null, cards: null, bids: null };

/* ---------- звук: короткий двухтоновый сигнал без файлов ---------- */
let audio = null;
function chime(kind = 'turn') {
  if (!prefs.sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const notes = kind === 'turn' ? [660, 880] : kind === 'end' ? [523, 659, 784] : [520];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.13;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.3);
    });
  } catch { /* без звука */ }
}
// Браузер разрешает звук только после действия пользователя: создаём контекст на первом клике.
document.addEventListener('pointerdown', () => {
  if (!audio && prefs.sound) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* нет звука */ } }
}, { once: true });

/* ---------- звуковые эффекты игровых событий ---------- */
function tone(freq, start, dur, { type = 'sine', vol = 0.15, slide = 0 } = {}) {
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + start;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
function thud(start, vol = 0.22) {
  // короткий шум с фильтром — стук деревянного диска о стол
  const len = Math.floor(audio.sampleRate * 0.08), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain(), t = audio.currentTime + start;
  f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = vol;
  src.buffer = buf; src.connect(f).connect(g).connect(audio.destination); src.start(t);
}
const SFX = {
  disc: () => { thud(0); tone(180, 0, 0.12, { type: 'triangle', vol: 0.12, slide: 0.7 }); },
  coin: () => { tone(1318, 0, 0.12, { type: 'triangle', vol: 0.09 }); tone(1760, 0.07, 0.22, { type: 'triangle', vol: 0.08 }); },
  resource: () => tone(520, 0, 0.1, { type: 'triangle', vol: 0.07, slide: 1.3 }),
  upgrade: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.07, 0.25, { type: 'triangle', vol: 0.09 })),
  win: () => { [392, 494, 587].forEach(f => tone(f, 0, 0.5, { vol: 0.07 })); tone(784, 0.12, 0.45, { vol: 0.06 }); },
  whoosh: () => tone(300, 0, 0.25, { type: 'sawtooth', vol: 0.03, slide: 2.4 }),
};
let sfxLast = {};
function sfx(kind) {
  if (!prefs.sfx || !SFX[kind]) return;
  const now = Date.now();
  if (now - (sfxLast[kind] ?? 0) < 90) return;   // пачка одинаковых событий звучит один раз
  sfxLast[kind] = now;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    SFX[kind]();
  } catch { /* без звука */ }
}
const EVENT_SFX = {
  BidPlaced: 'disc', CardWon: 'win', ManagerWon: 'win', AgentTookCard: 'disc', CardUpgraded: 'upgrade',
  ConversionPerformed: 'coin', ResourceGained: 'resource', Compensation: 'resource', CompensationChosen: 'resource',
  SupplyTaken: 'resource', CardScrapped: 'coin', CardStarted: 'whoosh', ManagerBonus: 'coin',
};

/* ---------- анимации ---------- */
const reduced = () => !prefs.anim || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
/** Всплывающее «+2» / «−1» над ресурсом в вашей панели. */
function floatDelta(kind, diff) {
  const target = document.querySelector(`.vault .res.${kind}`);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const d = el('div', `delta ${diff > 0 ? 'up' : 'down'} ${kind}`, `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`);
  d.style.left = `${r.left + r.width / 2}px`; d.style.top = `${r.top}px`;
  document.body.append(d);
  setTimeout(() => d.remove(), 1200);
}
function pulse(selector, cls) {
  document.querySelectorAll(selector).forEach(n => { n.classList.remove(cls); void n.offsetWidth; n.classList.add(cls); });
}
function visualEffects(s, fresh) {
  try { visualEffectsUnsafe(s, fresh); } catch { /* анимация не должна ломать игру */ }
}
function visualEffectsUnsafe(s, fresh) {
  const mine = me();
  if (watch.meId !== mine.id) { watch.wallet = null; watch.cards = null; watch.meId = mine.id; }
  if (!reduced()) {
    // ресурсы: всплывающие изменения
    if (watch.wallet) for (const k of ['money', 'coal', 'metal', 'oil', 'upgrade']) {
      const diff = mine.wallet[k] - (watch.wallet[k] ?? 0);
      if (diff) floatDelta(k, diff);
    }
    // новая карта в вашей линии
    if (watch.cards) for (const c of mine.cards) if (!watch.cards.has(c.id) && !c.borrowed) pulse(`#line-strip .card[data-card="${c.id}"]`, 'won');
    // свежие диски на лотах
    if (watch.bids) for (const lot of s.lots) {
      const before = watch.bids[lot.id] ?? 0;
      if (lot.bids.length > before) {
        const discs = document.querySelectorAll(`.card[data-lot="${lot.id}"] .bid-pile .disc`);
        for (let i = before; i < discs.length; i++) discs[i].classList.add('drop');
      }
    }
    // улучшение: вспышка
    for (const e of fresh) if (e.type === 'CardUpgraded') pulse(`.card[data-card="${e.cardId}"] .card-face`, 'shine');
  }
  watch.wallet = { ...mine.wallet };
  watch.cards = new Set(mine.cards.map(c => c.id));
  watch.bids = Object.fromEntries(s.lots.map(l => [l.id, l.bids.length]));
}

/* ---------- системное уведомление, когда вкладка скрыта ---------- */
function systemNotify(title, body) {
  if (!prefs.notify || !document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'industry-turn', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* не поддерживается */ }
}

/* ---------- лента событий ---------- */
const FEED_TYPES = new Set(['BidPlaced', 'CardWon', 'ManagerWon', 'AgentTookCard', 'CardUpgraded', 'CardDiscarded',
  'SupplyTaken', 'CardScrapped', 'NeighbourCardUsed', 'CardRepeated']);
function feed(html, seat) {
  if (!prefs.feed) return;
  const box = $('#feed');
  const item = el('div', 'feed-item', html);
  if (seat != null) item.style.setProperty('--seat', SEATS[seat % SEATS.length].base);
  box.append(item);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { item.classList.add('out'); setTimeout(() => item.remove(), 400); }, 4200);
}

/* ---------- баннер смены фазы ---------- */
const PHASE_BANNER = {
  choosing: ['Подготовка', 'Пятый игрок выбирает карты'],
  auction: ['Аукцион', 'Ставьте диски на предприятия'],
  settlement: ['Разбор лотов', 'Компенсации и новые предприятия'],
  planning: ['План', 'Расставьте свою линию'],
  production: ['Производство', 'Запускайте предприятия'],
  finished: ['Партия окончена', 'Смотрим итог'],
};
function banner(title, sub, seat = null) {
  if (!prefs.banner) return;
  const b = $('#banner');
  b.innerHTML = `<div class="banner-card"${seat != null ? ` style="--seat:${SEATS[seat % SEATS.length].base}"` : ''}><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

/* ---------- передача устройства (игра на одном компьютере) ---------- */
function handoff(p) {
  const box = $('#handoff');
  box.innerHTML = `<div class="handoff-card" style="--seat:${SEATS[p.seat % SEATS.length].base}">
    <div class="cap">Передайте устройство</div><div class="who">${esc(p.name)}</div>
    <button class="act" type="button">Я ${esc(p.name)} — продолжить</button></div>`;
  box.hidden = false;
  box.querySelector('button').onclick = () => { box.hidden = true; };
  box.querySelector('button').focus();
}

/* ---------- главный хук: вызывается после каждого кадра ---------- */
function afterRender(s) {
  if (!s) return;
  // Новая партия (или переход в онлайн): запоминаем состояние без уведомлений.
  if (watch.record !== ui.record || watch.seq == null || s.events.length && s.events.at(-1).seq < watch.seq) {
    watch.record = ui.record; watch.seq = s.events.at(-1)?.seq ?? 0; watch.phase = s.phase; watch.round = s.round;
    watch.mine = myTurn(); watch.actor = currentActor(s);
    watch.meId = me().id; watch.wallet = { ...me().wallet }; watch.cards = new Set(me().cards.map(c => c.id));
    watch.bids = Object.fromEntries(s.lots.map(l => [l.id, l.bids.length]));
    updateTitle(s); return;
  }
  const mine = me();
  const name = id => esc(s.players.find(p => p.id === id)?.name ?? '');
  const seatOf = id => s.players.find(p => p.id === id)?.seat ?? null;
  const online = Boolean(ui.online?.playing);

  // Лента: действия других игроков (в онлайне) и агента (всегда).
  const fresh = s.events.filter(e => e.seq > watch.seq);
  const kinds = new Set(fresh.map(e => EVENT_SFX[e.type]).filter(Boolean));
  // один самый «важный» звук на кадр
  for (const k of ['win', 'upgrade', 'coin', 'disc', 'resource', 'whoosh']) if (kinds.has(k)) { sfx(k); break; }
  visualEffects(s, fresh);
  for (const e of fresh) {
    if (!FEED_TYPES.has(e.type)) continue;
    const other = e.playerId && e.playerId !== mine.id;
    const agent = e.playerId === 'agent' || e.type === 'AgentTookCard';
    if ((online && other) || agent) {
      const text = LOG_TEXT[e.type]?.(e, name);
      if (text) feed(text, seatOf(e.playerId));
    }
  }
  watch.seq = s.events.at(-1)?.seq ?? watch.seq;

  // Смена раунда и фазы.
  if (s.phase !== watch.phase || s.round !== watch.round) {
    const [t, sub] = PHASE_BANNER[s.phase] ?? [s.phase, ''];
    banner(s.phase === 'auction' && s.round !== watch.round ? `Раунд ${s.round} · ${t}` : t, sub);
    if (s.phase === 'finished') chime('end');
    watch.phase = s.phase; watch.round = s.round;
  }

  // Чей ход.
  const actor = currentActor(s);
  const nowMine = myTurn() && s.phase !== 'finished' && !(s.phase === 'settlement' && !s.settlement.pending);
  if (online) {
    if (nowMine && !watch.mine) {
      chime('turn');
      systemNotify('Индустрия: ваш ход', PHASE_BANNER[s.phase]?.[0] ?? '');
    }
  } else if (actor && actor !== watch.actor && s.phase !== 'finished') {
    // Один компьютер: me() следует за очередью, поэтому сообщаем, кто теперь ходит.
    const p = s.players.find(x => x.id === actor);
    const humans = s.players.filter(x => !x.agent).length;
    if (p && !p.agent && humans > 1 && !(s.phase === 'settlement' && !s.settlement.pending)) {
      if (prefs.handoff) handoff(p);
      else if (s.phase === watch.phase) banner(`Ходит ${esc(p.name)}`, '', p.seat);
      chime('soft');
    }
  }
  watch.mine = nowMine; watch.actor = actor;
  updateTitle(s);
}

function updateTitle(s) {
  const mineNow = ui.online?.playing && myTurn() && s.phase !== 'finished';
  document.title = mineNow ? `● Ваш ход — ${BASE_TITLE}` : BASE_TITLE;
}

/* ---------- настройки ---------- */
function showSettings() {
  const row = (key, title, note) => `<label class="switch"><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}>
    <span>${title}<small>${note}</small></span></label>`;
  const perm = typeof Notification === 'undefined' ? 'не поддерживаются этим браузером'
    : Notification.permission === 'denied' ? 'запрещены в браузере — разрешите их в настройках сайта' : '';
  $('#settings-body').innerHTML = `<h2>Настройки</h2>
    ${row('sound', 'Сигнал хода', 'Сигнал, когда наступает ваш ход, и в конце партии.')}
    ${row('sfx', 'Звуки игры', 'Стук диска, монеты, модернизация, выигранное предприятие.')}
    ${row('anim', 'Анимации', 'Всплывающие изменения ресурсов, переворот и вспышка карт, падающие диски.')}
    ${row('notify', 'Уведомления', `Системное уведомление о вашем ходе, если вкладка свёрнута (онлайн-партия).${perm ? ` Сейчас: ${perm}.` : ''}`)}
    ${row('feed', 'Лента событий', 'Короткие сообщения о ставках и покупках соперников и агента.')}
    ${row('banner', 'Баннеры этапов', 'Крупная надпись при смене раунда, этапа и игрока.')}
    ${row('handoff', 'Передача устройства', 'Игра на одном компьютере: перед ходом следующего игрока экран закрывается, пока он не нажмёт «продолжить».')}
    <h3 class="sub">Горячие клавиши</h3>
    <ul class="keys"><li><kbd>1</kbd>–<kbd>5</kbd> выбрать диск на аукционе</li><li><kbd>←</kbd> <kbd>→</kbd> выбрать предприятие</li>
      <li><kbd>Enter</kbd> поставить диск / выполнить</li><li><kbd>Esc</kbd> снять выбор</li><li><kbd>L</kbd> журнал, <kbd>?</kbd> правила</li></ul>
    <div class="sheet-actions"><button class="act ghost" type="button" id="test-sound">Проверить звук</button><button class="act" data-close>Готово</button></div>`;
  $('#settings-body').querySelectorAll('[data-pref]').forEach(input => input.onchange = async () => {
    prefs[input.dataset.pref] = input.checked;
    if (input.dataset.pref === 'notify' && input.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') { prefs.notify = false; input.checked = false; toast('Уведомления не разрешены браузером.'); }
    }
    savePrefs();
  });
  $('#test-sound').onclick = () => {
    const was = prefs.sfx; prefs.sfx = true; sfxLast = {};
    ['disc', 'coin', 'upgrade', 'win'].forEach((k, i) => setTimeout(() => { sfxLast = {}; sfx(k); }, i * 450));
    prefs.sfx = was;
  };
  $('#settings').showModal();
}

/* ---------- горячие клавиши ---------- */
document.addEventListener('keydown', ev => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.target.closest?.('input, textarea, select') || document.querySelector('dialog[open]') || !$('#handoff').hidden) return;
  const s = S(); if (!s) return;
  if (ev.key === 'l' || ev.key === 'L' || ev.key === 'д' || ev.key === 'Д') { $('#drawer').classList.toggle('open'); return; }
  if (ev.key === '?') { showHelp(); return; }
  if (ev.key === 'Escape') { ui.disc = null; ui.focus = null; $('#drawer').classList.remove('open'); render(); return; }
  if (s.phase !== 'auction' || !myTurn()) {
    if (ev.key === 'Enter') { const go = document.querySelector('#effect-slot .act:not(.ghost):not(:disabled), #prompt .act:not(.ghost):not(:disabled)'); if (go) { ev.preventDefault(); go.click(); } }
    return;
  }
  const p = me();
  if (/^[1-5]$/.test(ev.key)) {
    const free = p.discs.filter(d => !d.used);
    const d = free.find(x => x.kind === 'fixed' && x.value === Number(ev.key) && !x.bonus)
      ?? (ev.key === '5' ? free.find(x => x.bonus || x.kind === 'variable') : null);
    if (d) { ui.disc = ui.disc === d.id ? null : d.id; render(); }
    return;
  }
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    const open = s.lots.filter(l => !l.resolved);
    let i = open.findIndex(l => l.id === ui.focus);
    i = i < 0 ? 0 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + open.length) % open.length;
    ui.focus = open[i]?.id ?? null; render();
    document.querySelector('.card.picked')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    ev.preventDefault(); return;
  }
  if (ev.key === 'Enter') {
    const cta = document.querySelector('.bid-dock .card-cta.go');
    if (cta) { ev.preventDefault(); cta.click(); }
  }
});
document.addEventListener('click', ev => { if (ev.target.closest('[data-open="settings"]')) showSettings(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S()) updateTitle(S()); });
