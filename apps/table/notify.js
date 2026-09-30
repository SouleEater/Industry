/* ===== Индустрия — уведомления, настройки и горячие клавиши =====
   Собирается сразу после ui.js. render() вызывает afterRender(s) в конце каждого кадра. */

const PREFS_KEY = 'industry.table.prefs';
const prefs = { sound: true, notify: false, feed: true, banner: true, handoff: false, ...loadPrefs() };
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* приватный режим */ } }

const BASE_TITLE = document.title;
const watch = { seq: null, phase: null, round: null, mine: false, actor: null, record: null };

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
    updateTitle(s); return;
  }
  const mine = me();
  const name = id => esc(s.players.find(p => p.id === id)?.name ?? '');
  const seatOf = id => s.players.find(p => p.id === id)?.seat ?? null;
  const online = Boolean(ui.online?.playing);

  // Лента: действия других игроков (в онлайне) и агента (всегда).
  for (const e of s.events) {
    if (e.seq <= watch.seq) continue;
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
    ${row('sound', 'Звук', 'Сигнал, когда наступает ваш ход, и в конце партии.')}
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
  $('#test-sound').onclick = () => { const was = prefs.sound; prefs.sound = true; chime('turn'); prefs.sound = was; };
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
