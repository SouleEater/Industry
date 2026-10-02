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
  { base: '#2f5f9e', lite: '#5b8fd6' },
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
const capOf = id => [...PACK.capitalists, ...(PACK.expansionCapitalists ?? [])].find(c => c.id === id);
const capImage = c => keyOf(c.images[0]);
/* Картинки лежат в пакете строками base64. Раньше каждая перерисовка вставляла в DOM строку
   на 50–100 КБ и браузер заново разбирал её. Теперь строка превращается в Blob один раз,
   а дальше везде используется короткий blob:-адрес — он же кэширует декодированную картинку. */
const BLOBS = new Map();
const src = key => {
  if (BLOBS.has(key)) return BLOBS.get(key);
  const b64 = typeof CARD_IMAGES !== 'undefined' ? CARD_IMAGES[key] : null;
  if (!b64) return '';
  let url;
  try {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
  } catch { url = `data:image/webp;base64,${b64}`; }
  BLOBS.set(key, url);
  return url;
};
/** Пропорции берутся из самой картинки: у карт издателя и у макетов они разные. */
const setRatio = (node, key) => {
  const size = typeof CARD_SIZES !== 'undefined' ? CARD_SIZES[key] : null;
  if (size) node.style.setProperty('--card-ratio', `${size[0]} / ${size[1]}`);
};

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

/* ---------- ресурсы ---------- */
/* Значки повторяют игровые: уголь — тёмный куб с огнём, металл — слиток,
   нефть — бочка, деньги — монета, модернизация — шестерня. */
const ICONS = {
  coal: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" fill="#2a2a30" stroke="#0a0a0c" stroke-width="1.2"/><path d="M12 3v18M3 7l9 4 9-4" stroke="#0a0a0c" stroke-width="1" fill="none"/><path d="M7 12l2 3-2 2-2-2zM17 12l2 3-2 2-2-2z" fill="#ff7a3a"/></svg>',
  metal: '<svg viewBox="0 0 24 24"><path d="M2 15l4-8h12l4 8-2 3H4z" fill="#8fb1cf" stroke="#2b4560" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 7l-2 8h16l-2-8" fill="#c7dcee" opacity=".65"/><path d="M4 15h16" stroke="#2b4560" stroke-width="1"/></svg>',
  oil: '<svg viewBox="0 0 24 24"><rect x="4.5" y="3" width="15" height="18" rx="3.5" fill="#5b5f66" stroke="#141518" stroke-width="1.2"/><path d="M4.7 8h14.6M4.7 16h14.6" stroke="#141518" stroke-width="1.1"/><path d="M12 9.6c-1.6 2-2.3 2.9-2.3 4a2.3 2.3 0 004.6 0c0-1.1-.7-2-2.3-4z" fill="#d7a35a"/></svg>',
  money: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="#e7b552" stroke="#8a5c14" stroke-width="1.3"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#9c6a1a" stroke-width="1"/><path d="M10.2 7.4v9.2M10.2 7.4h2.5a2.1 2.1 0 010 4.2h-2.5m2.7 0a2.4 2.4 0 010 5h-2.7" stroke="#6b430b" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
  upgrade: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="none" stroke="#c98d4c" stroke-width="4.2" stroke-dasharray="3.2 3.2"/><circle cx="12" cy="12" r="7" fill="#9a9aa2" stroke="#3a3a42" stroke-width="1.2"/><circle cx="12" cy="12" r="3" fill="#1b2530" stroke="#3a3a42" stroke-width="1"/></svg>',
};
ICONS.flip = '<svg viewBox="0 0 24 24"><rect x="3.5" y="2" width="17" height="20" rx="3" fill="#8fd06a" stroke="#3b6b20" stroke-width="1.4"/><path d="M8 16V10a4 4 0 018 0v3M13.5 11.5L16 14l2.5-2.5" fill="none" stroke="#173a08" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
ICONS.bolt = '<svg viewBox="0 0 24 24"><path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#f0c94a" stroke="#7a5a08" stroke-width="1.3" stroke-linejoin="round"/></svg>';
ICONS.swap = '<svg viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" fill="none" stroke="#e7eef4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RES_TITLE = { coal: 'Уголь', metal: 'Металл', oil: 'Нефть', upgrade: 'Улучшение', money: 'Деньги' };
function resHtml(kind, value, opts = {}) {
  const zero = !value && !opts.keepZero ? ' zero' : '';
  const label = `${value} ${RES_NAME[kind]}`;
  return `<span class="res ${kind}${zero}" title="${label}" aria-label="${label}"><span class="ico">${ICONS[kind]}</span><span class="num">${value}</span><span class="lbl">${RES_TITLE[kind]}</span></span>`;
}
function bundleHtml(values, mult = 1) {
  const parts = Object.entries(values || {}).filter(([, v]) => v > 0);
  if (!parts.length) return '<span class="res zero"><span class="num">—</span></span>';
  return `<span class="grp">${parts.map(([k, v]) => resHtml(k, v * mult, { keepZero: true })).join('')}</span>`;
}
function effectHtml(e) {
  if (!e) return '';
  if (e.kind === 'supply') return `<span class="bolt">⚡</span>${effectHtml(e.of)}<span class="cap">однократно</span>`;
  if (['count-cards', 'operation-bonus', 'upgrade-next', 'text', 'permanent', 'take-stored'].includes(e.kind))
    return `<span>${esc(e.text ?? '')}</span>`;
  if (e.kind === 'upgrade') return `${bundleHtml(e.cost ?? { coal: 1, upgrade: 1 })}<span class="to">→</span><span class="res flip" title="Модернизация"><span class="ico">${ICONS.flip}</span></span>${e.limit ? `<span class="cap">до ${e.limit} раз</span>` : ''}`;
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

/* Иллюстраций «Интербеллума» в проекте нет (материалы издателя), поэтому сцена
   рисуется схематично в цветах ресурса, который карта даёт. */
const TONE_TITLE = { coal: 'Шахта', metal: 'Литейная', oil: 'Нефтяная вышка', money: 'Торговый дом', upgrade: 'Мастерская' };
const TONE_PAL = {
  coal:  { sky: ['#e8c9a4', '#b4643a'], far: '#7d4630', near: '#2b1a14', glow: '#ff9350' },
  metal: { sky: ['#cfdbe4', '#7f9bb0'], far: '#4c6478', near: '#1e2a35', glow: '#ffb15c' },
  oil:   { sky: ['#f0d3a0', '#c98d4c'], far: '#8b5b2b', near: '#2e2014', glow: '#ffd48a' },
  money: { sky: ['#dfe4c2', '#8fa46a'], far: '#5f7448', near: '#22301f', glow: '#ffe28a' },
  upgrade: { sky: ['#d8e0da', '#8db3a0'], far: '#557a6a', near: '#1f2f29', glow: '#c9f0d8' },
};
function toneOf(d) {
  if (d.tone && TONE_PAL[d.tone]) return d.tone;
  const gain = [d.compensation, ...d.effects].map(e => e?.gain && Object.keys(e.gain)[0]).find(Boolean);
  return TONE_PAL[gain] ? gain : 'coal';
}
function sceneSvg(tone, seed) {
  const c = TONE_PAL[tone], id = `g${seed}${tone}`;
  const flip = seed % 2 ? ' transform="translate(200 0) scale(-1 1)"' : '';
  let art = '';
  if (tone === 'coal') {
    art = `<path d="M0 92 L40 62 L78 84 L118 54 L160 80 L200 60 V120 H0z" fill="${c.far}"/>
      <path d="M0 104 L60 88 L130 100 L200 84 V120 H0z" fill="${c.near}"/>
      <path d="M118 104 L132 58 M148 104 L136 58 M124 82 H142 M121 94 H145" stroke="${c.near}" stroke-width="3" fill="none"/>
      <circle cx="134" cy="52" r="9" fill="none" stroke="${c.near}" stroke-width="3"/><circle cx="134" cy="52" r="2.5" fill="${c.near}"/>
      <path d="M40 106 h30 l-5 -12 h-20z" fill="#0d0908"/><circle cx="48" cy="108" r="3.5" fill="${c.glow}"/><circle cx="64" cy="108" r="3.5" fill="${c.glow}"/>`;
  } else if (tone === 'oil') {
    art = `<path d="M0 100 Q60 90 100 98 T200 94 V120 H0z" fill="${c.far}"/>
      <path d="M0 108 H200 V120 H0z" fill="${c.near}"/>
      <path d="M92 108 L106 32 L120 108 M96 90 H116 M99 70 H113 M102 52 H110 M94 96 L116 76 M118 96 L98 76 M100 76 L112 58" stroke="${c.near}" stroke-width="2.6" fill="none"/>
      <path d="M40 108 v-22 l26 -10 M30 86 l40 -14 l5 6 l-38 14z" stroke="${c.near}" stroke-width="2.4" fill="${c.near}"/>
      <path d="M150 108 L156 62 L162 108 M152 92 H160" stroke="${c.near}" stroke-width="2" fill="none"/>`;
  } else if (tone === 'money') {
    art = `<path d="M0 100 H200 V120 H0z" fill="${c.near}"/>
      <rect x="14" y="58" width="34" height="46" fill="${c.far}"/><rect x="54" y="38" width="42" height="66" fill="${c.near}"/>
      <rect x="102" y="52" width="30" height="52" fill="${c.far}"/><rect x="138" y="30" width="46" height="74" fill="${c.near}"/>
      ${[[62, 46], [78, 46], [62, 62], [78, 62], [146, 38], [162, 38], [146, 54], [162, 54], [146, 70], [110, 60], [110, 76]].map(([x, y]) => `<rect x="${x}" y="${y}" width="8" height="8" fill="${c.glow}" opacity=".85"/>`).join('')}
      <path d="M54 38 L75 22 L96 38z" fill="${c.far}"/>`;
  } else {
    art = `<path d="M0 96 L50 78 L100 92 L160 70 L200 86 V120 H0z" fill="${c.far}"/>
      <path d="M0 106 H200 V120 H0z" fill="${c.near}"/>
      <rect x="22" y="62" width="70" height="44" fill="${c.near}"/><rect x="100" y="76" width="56" height="30" fill="${c.near}"/>
      <rect x="34" y="34" width="9" height="30" fill="${c.near}"/><rect x="60" y="42" width="9" height="22" fill="${c.near}"/>
      <rect x="118" y="52" width="9" height="26" fill="${c.near}"/>
      <circle cx="40" cy="26" r="9" fill="#fff" opacity=".35"/><circle cx="52" cy="17" r="12" fill="#fff" opacity=".28"/><circle cx="124" cy="44" r="8" fill="#fff" opacity=".3"/>
      <rect x="32" y="74" width="10" height="9" fill="${c.glow}"/><rect x="52" y="74" width="10" height="9" fill="${c.glow}"/><rect x="72" y="74" width="10" height="9" fill="${c.glow}"/>`;
  }
  return `<svg class="scene" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky[0]}"/><stop offset="1" stop-color="${c.sky[1]}"/></linearGradient></defs>
    <rect width="200" height="120" fill="url(#${id})"/>
    <circle cx="${seed % 2 ? 40 : 160}" cy="30" r="14" fill="${c.glow}" opacity=".55"/>
    <g${flip}>${art}</g></svg>`;
}
/** Название карты: у карт дополнения в данных лишь номер, поэтому даём понятное имя. */
function cardTitle(d, id) {
  if (!d.expansion || d.kind !== 'company') return d.name;
  const n = String(id ?? d.name).match(/(\d+)\s*$/)?.[1] ?? '';
  return `Интербеллум ${Number(n) + 1 || ''}`.trim();
}
/** Имя карты для людей — одно и то же под картой, на кнопках и в журнале. */
const titleOf = id => cardTitle(DEFS[id], id);
/** Имя карты в линии игрока; при одинаковых картах добавляется позиция: «Шахта 3 (2-я)». */
function lineTitle(p, card) {
  const t = titleOf(card.definitionId);
  const same = p.cards.filter(c => titleOf(c.definitionId) === t);
  return same.length > 1 ? `${t} (${p.cards.indexOf(card) + 1}-я в линии)` : t;
}
/** Кнопка, которая при наведении подсвечивает карту в линии. */
function pointsAt(btn, cardId) {
  const on = () => document.querySelector(`#line-strip .card[data-card="${cardId}"]`)?.classList.add('pointed');
  const off = () => document.querySelectorAll('.card.pointed').forEach(n => n.classList.remove('pointed'));
  btn.addEventListener('mouseenter', on); btn.addEventListener('focus', on);
  btn.addEventListener('mouseleave', off); btn.addEventListener('blur', off);
  return btn;
}

function plainFace(card, d) {
  const tone = toneOf(d), num = Number(String(card.definitionId).match(/(\d+)\s*$/)?.[1] ?? 0);
  const rows = [...d.effects, ...(card.upgraded ? d.advanced : [])];
  const next = card.upgraded ? '' : `<div class="pf-next"><span class="pf-tag">после модернизации</span>${
    d.advanced.map(r => `<div class="recipe dim-row">${effectHtml(r)}</div>`).join('')}</div>`;
  return `<div class="pf-title">${esc(cardTitle(d, card.definitionId))}</div>
    <div class="pf-scene">${sceneSvg(tone, num)}</div>
    <div class="pf-body">
      <div class="pf-row comp"><span class="pf-tag">компенсация</span><span class="recipe">${effectHtml(d.compensation)}</span></div>
      ${rows.map((r, i) => `<div class="pf-row">${i === 0 ? '<span class="pf-tag">производство</span>' : ''}<span class="recipe">${effectHtml(r)}</span></div>`).join('')}
      ${next}
    </div>`;
}

/* Карта рисуется по данным: иллюстрация вырезана из скана, строки эффектов — наши,
   поэтому после улучшения сторона меняется по-настоящему (компенсации сверху нет). */
/** Картинка есть в пакете: без PDF издателя часть картинок не упаковывается. */
const hasPacked = key => typeof CARD_IMAGES !== 'undefined' && Boolean(CARD_IMAGES[key]);
const hasArt = d => d.images.length > 0 && typeof CARD_IMAGES !== 'undefined' && Boolean(CARD_IMAGES['art-' + keyOf(d.images[0])]);
const TEXT_KINDS = ['count-cards', 'operation-bonus', 'upgrade-next', 'text', 'permanent', 'take-stored'];
function rowHtml(e, cls = '') {
  const text = TEXT_KINDS.includes(e.kind);
  return `<div class="pf-row ${text ? 'txt' : ''} ${e.kind === 'permanent' ? 'perm' : ''} ${cls}"><span class="recipe">${effectHtml(e)}</span></div>`;
}
function drawnFace(card, d) {
  const up = card.upgraded, start = d.kind === 'startup';
  const top = start
    ? `<span class="df-tag">на старте</span>${bundleHtml(d.starting)}`
    : up ? '<span class="df-ribbon">★ улучшено</span>'
      : `<span class="df-tag">компенсация</span><span class="recipe">${effectHtml(d.compensation)}</span>`;
  const adv = (d.advanced ?? []).map(e => rowHtml(e, up ? 'adv on' : 'adv off')).join('');
  return `<div class="df-top">${top}</div>
    <div class="df-art"><img src="${src('art-' + keyOf(d.images[0]))}" alt=""></div>
    <div class="df-body">
      ${d.effects.map(e => rowHtml(e)).join('')}
      ${adv ? `<div class="df-sep"><span>${up ? 'улучшенная сторона' : 'после улучшения'}</span></div>${adv}` : ''}
    </div>`;
}

function bidPileHtml(lot) {
  const s = S();
  return lot.bids.map(b => {
    const p = s.players.find(x => x.id === b.playerId);
    return discHtml({ id: b.discId, value: b.value, kind: b.kind, bonus: b.bonus }, p.seat, { small: true });
  }).join('');
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

  const body = el('div', 'card-body');
  const face = el('div', 'card-face');
  if (hasArt(d)) {
    face.classList.add('plain-face', 'drawn');
    face.style.setProperty('--card-ratio', '7 / 10');
    face.innerHTML = drawnFace(card, d);
    face.setAttribute('role', 'img');
    face.setAttribute('aria-label', `${cardTitle(d, card.definitionId)}${card.upgraded ? ', улучшенная сторона' : ''}`);
    // Переворот показываем один раз — в кадре, где карта стала улучшенной.
    if (ui.seenUp?.[card.id] === false && card.upgraded) face.classList.add('flip-in');
  } else if (d.images.length && hasPacked(faceKey(card))) {
    const img = el('img');
    img.src = src(faceKey(card));
    setRatio(face, faceKey(card));
    if (/^(co-ib|st-off|uni|char)-/.test(faceKey(card))) img.classList.add('trim');
    img.alt = `${cardTitle(d, card.definitionId)}${card.upgraded ? ', улучшенная сторона' : ''}`;
    face.append(img);
  } else {
    face.classList.add('plain-face');
    face.innerHTML = plainFace(card, d);
  }

  const onCard = card.managers ?? (card.manager ? [card.manager] : []);
  if (onCard.length) {
    const tag = el('span', 'card-tag mgr', onCard.length > 1 ? `управляющие ×${onCard.length}` : 'управляющий');
    tag.title = onCard.map(t => MANAGERS[t].text).join('\n\n');
    face.append(tag);
  }
  if (card.local && Object.values(card.local).some(v => v > 0))
    face.append(el('span', 'card-tag local', `на карте: ${Object.entries(card.local)
      .filter(([, v]) => v > 0).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`));
  if (d.unknownLimit) {
    const w = el('span', 'card-tag warn', '!');
    w.title = 'На макете этой карты не напечатана кратность одного обмена. В игре он идёт ×1 и требует сверки с оригиналом.';
    face.append(w);
  }
  body.append(face);

  if (mode !== 'zoom' && mode !== 'gallery') {
    const zb = el('button', 'zoom-btn', '⤢');
    zb.type = 'button'; zb.title = 'Посмотреть карту крупно'; zb.setAttribute('aria-label', 'Посмотреть карту крупно');
    zb.addEventListener('click', ev => { ev.stopPropagation(); zoomCard(card); });
    body.append(zb);
  }
  if (lot?.bids.length) body.append(el('div', 'bid-pile', bidPileHtml(lot)));
  node.append(body);

  const state = card.borrowed ? '<span class="cn-state">карта соседа</span>' : card.upgraded ? '<span class="cn-state up">улучшено</span>'
    : d.kind === 'startup' ? '<span class="cn-state">стартовое</span>' : '';
  node.append(el('div', 'card-name', `<span>${esc(cardTitle(d, card.definitionId))}</span>${state}`));
  return node;
}

const MANAGERS = Object.fromEntries([...PACK.managers, PACK.personalManager].filter(Boolean).map(m => [m.id, m]));

/* ---------- жетон управляющего, нарисованный ---------- */
function mgrIconKey(m) {
  const e = m.effect ?? {};
  const resource = Object.keys(e.gain ?? e.options?.[0] ?? {})[0];
  if (resource) return resource;
  if (e.kind === 'upgrade-self') return 'flip';
  if (e.kind === 'repeat-supply') return 'bolt';
  return 'swap';
}
function managerTokenHtml(m, { mini = false } = {}) {
  const icon = `<span class="mt-ico">${ICONS[mgrIconKey(m)]}</span>`;
  return mini
    ? `<span class="mgr-token mini" data-mgr="${esc(m.id)}" title="${esc(m.text)}" role="button" tabindex="0">${icon}</span>`
    : `<div class="mgr-token">${icon}<div class="mt-body"><div class="mt-kind">Жетон управляющего${m.personal ? ' · личный' : ''}</div><div class="mt-text">${esc(m.text)}</div></div></div>`;
}

/* ---------- карточка промышленника, нарисованная ---------- */
const portraitKey = c => 'port-' + keyOf(c.images?.[0] ?? '');
const hasPortrait = c => Boolean(c?.images?.length && hasPacked(portraitKey(c)));
/** Текст способности: у Артура с «Интербеллумом» действует обновлённая карта. */
const capText = c => (c.textExpansion && S()?.config?.pairedExtraDisc ? c.textExpansion : c.text);
function heroCardHtml(c, { compact = false, big = false } = {}) {
  const img = hasPortrait(c) ? `<img class="hc-portrait" src="${src(portraitKey(c))}" alt="Портрет: ${esc(c.name)}">` : '';
  return `<div class="hero-card ${compact ? 'compact' : ''} ${big ? 'big' : ''}" data-cap="${c.id}">${img}
    <div class="hc-text"><div class="hc-kind">Промышленник</div><div class="hc-name">${esc(c.name)}</div><p>${esc(capText(c))}</p></div></div>`;
}
function zoomHero(c) {
  const z = $('#zoom');
  z.innerHTML = heroCardHtml(c, { big: true });
  z.onclick = () => z.close();
  z.showModal();
}
function zoomToken(id) {
  const m = MANAGERS[id]; if (!m) return;
  const z = $('#zoom');
  z.innerHTML = `<div class="big-token">${managerTokenHtml(m)}</div>`;
  z.onclick = () => z.close();
  z.showModal();
}

/* ---------- карта университета ---------- */
const UNI_SIDES = Object.fromEntries(PACK.universities.flatMap(u => u.sides).map(side => [side.id, side]));
function optionKind(e) { return e.kind === 'gain' ? 'получить' : 'обменять'; }
function tableNode(lot) {
  const node = el('div', 'card university');
  node.dataset.lot = lot.id;
  const body = el('div', 'card-body');
  const face = el('div', 'card-face uni-face plain-face drawn uni');
  face.style.setProperty('--card-ratio', '7 / 10');
  const side = UNI_SIDES[lot.table.sideId];
  const [a, b] = lot.table.options;
  face.innerHTML = `
    <div class="pf-title">Университет</div>
    <div class="uni-opts">
      <div class="uo-head">Компенсация на выбор</div>
      <div class="uni-opt"><span class="uo-tag">вариант 1 · ${optionKind(a)}</span><span class="recipe">${effectHtml(a)}</span></div>
      <div class="uo-or"><span>либо</span></div>
      <div class="uni-opt"><span class="uo-tag">вариант 2 · ${optionKind(b)}</span><span class="recipe">${effectHtml(b)}</span></div>
      <p class="uo-note">Единицы компенсации можно делить между вариантами как угодно.</p>
    </div>
    ${side?.image && CARD_IMAGES['art-' + side.image] ? `<div class="df-art"><img src="${src('art-' + side.image)}" alt=""></div>` : ''}`;
  body.append(face);
  if (lot.bids.length) body.append(el('div', 'bid-pile', bidPileHtml(lot)));
  node.append(body);
  node.append(tokenStrip(lot.token));
  node.append(el('div', 'card-name', '<span>Университет</span>'));
  return node;
}
/** Жетон управляющего под картой университета. */
function tokenStrip(tokenId) {
  const box = el('div', 'uni-token');
  const m = tokenId ? MANAGERS[tokenId] : null;
  box.innerHTML = m ? managerTokenHtml(m) : '<b>Жетон управляющего</b> уже забрали';
  return box;
}

function zoomCard(card) {
  const z = $('#zoom');
  z.innerHTML = '';
  const n = cardNode(card, { mode: 'zoom' });
  n.classList.add('big');
  z.append(n);
  z.onclick = () => z.close();
  z.showModal();
}

/* ---------- расчёт ставки: главный элемент интерфейса ---------- */
/** Уголь, который уйдёт на диск переменного капитала, и итоговый номинал ставки. */
function stakeOf(p, disc) {
  if (!disc) return { coal: 0, nominal: null, value: null };
  if (disc.kind !== 'variable') return { coal: 0, nominal: disc.value, value: disc.value };
  return { coal: ui.varValue, nominal: ui.varValue + variableBonus(p), value: ui.varValue };
}
function ledgerNode(lot) {
  const s = S(), p = me();
  const disc = ui.disc && p.discs.find(d => d.id === ui.disc);
  const stake = stakeOf(p, disc);
  const value = stake.value, nominal = stake.nominal;
  const box = el('div', 'ledger');

  if (!disc) {
    box.innerHTML = `<div class="ledger-head">СНАЧАЛА ВЫБЕРИТЕ ДИСК</div>
      <div class="ledger-note">Ставка решает две задачи сразу: крупный диск борется за предприятие, мелкий — за компенсацию. Выберите диск внизу, и здесь появится точный расчёт.</div>`;
    return box;
  }
  const err = bidError(s, p.id, disc.id, lot.id, value);
  if (lot.kind === 'university') {
    const units = nominal + (p.ability === 'compensation-plus-one' ? 1 : 0);
    box.innerHTML = `
      <div class="ledger-head">СТАВКА ${nominal} НА УНИВЕРСИТЕТ</div>
      <div class="ledger-row win"><span class="ledger-key">Выиграете</span>
        <span class="ledger-val">жетон управляющего: ${lot.token ? esc(MANAGERS[lot.token].text) : 'уже забран'}</span></div>
      <div class="ledger-row lose"><span class="ledger-key">Проиграете</span>
        <span class="ledger-val"><b>${units}</b> единиц компенсации, делите между двумя вариантами карты</span></div>`;
    if (err) box.append(el('div', 'ledger-note', `<em>${esc(err)}</em>`));
    return box;
  }
  const out = bidOutcome(s, DEFS, p.id, lot.id, nominal, stake.coal);
  const d = DEFS[lot.card.definitionId];
  const compText = out.compensation.kind === 'gain'
    ? `${bundleHtml(out.compensation.gain, out.units)}`
    : out.max > 0
      ? `${bundleHtml(out.compensation.cost, out.max)}<span class="to">→</span>${bundleHtml(out.compensation.gain, out.max)}`
      : '<span class="res zero"><span class="num">ничего: не хватает сырья</span></span>';

  box.innerHTML = `
    <div class="ledger-head">СТАВКА ${nominal} НА «${esc(titleOf(lot.card.definitionId)).toUpperCase()}»</div>
    <div class="ledger-row win"><span class="ledger-key">Выиграете</span>
      <span class="ledger-val">предприятие в свою линию${out.leading ? '' : `<br><span class="cap">сейчас впереди ставка ${out.bestRival}</span>`}</span></div>
    <div class="ledger-row lose"><span class="ledger-key">Проиграете</span>
      <span class="ledger-val recipe">${compText}</span></div>`;

  const notes = [];
  if (p.ability === 'compensation-plus-one' && nominal >= 0) notes.push(`Генри: компенсация считается как <em>${out.units}</em>, а не ${nominal}.`);
  if (disc.kind === 'variable') notes.push(`Переменный диск: <em>${stake.coal}</em> угля спишется сразу (останется ${p.wallet.coal - stake.coal}), номинал ставки — <em>${nominal}</em>${variableBonus(p) ? ' с прибавкой Капиталиста +2' : ''}.`);
  if (out.compensation.kind === 'convert' && out.max < out.units && out.max > 0) notes.push(`Сырья хватит только на <em>${out.max}</em> из ${out.units} операций.`);
  if (err) notes.push(`<em>${esc(err)}</em>`);
  if (notes.length) box.append(el('div', 'ledger-note', notes.join('<br>')));
  return box;
}

/* ---------- верхняя планка ---------- */
function renderRail() {
  const s = S();
  const steps = [['auction', 'Аукцион'], ['settlement', 'Разбор'], ['planning', 'План'], ['production', 'Производство']];
  const at = !s ? 0 : s.phase === 'finished' ? 4 : Math.max(0, steps.findIndex(([k]) => k === s.phase));
  $('#rail').innerHTML = `
    <span class="logo">ИНДУ<b>С</b>ТРИЯ</span>
    ${s ? `<span class="round-badge" aria-label="Раунд ${s.round} из 4">Раунд <b>${s.round}</b> из 4</span>
    <ol class="steps" aria-label="Этапы раунда">${steps.map(([k, t], i) =>
      `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i>${i + 1}</i><span>${t}</span></li>`).join('')}</ol>` : ''}
    <span class="spacer"></span>
    ${ui.online ? `<button class="chip live" data-open="invite" title="Информация о столе">стол ${esc(ui.online.code)}</button>` : ''}
    ${net.server ? `<button class="chip" data-open="online" title="Играть по сети">Онлайн</button>` : ''}
    ${net.server ? (net.user
    ? `<button class="chip" data-open="account" title="Аккаунт">👤 ${esc(net.user.username)}</button>`
    : `<button class="chip" data-open="login">Войти</button>`) : ''}
    <button class="chip" data-open="settings" title="Настройки: звук, уведомления, горячие клавиши" aria-label="Настройки">⚙</button>
    <button class="chip" data-open="help" title="Как играть">? <span class="wide">Как играть</span></button>
    <button class="chip" data-open="gallery" title="Каталог карт">Карты</button>
    <button class="chip" data-open="log" title="Журнал ходов">Журнал</button>
    <button class="chip" data-open="setup" title="Начать новую партию">Новая <span class="wide">партия</span></button>`;
  if (typeof renderSetupOnline === 'function') renderSetupOnline();
}

/* ---------- соперники ---------- */
/** Ваша панель наверху: промышленник с описанием и ваши жетоны управляющих. */
function myPanel() {
  const p = me(), cap = p.capitalistId ? capOf(p.capitalistId) : null;
  if (!cap && !p.managers.length) return null;
  const node = el('div', 'me-panel');
  node.style.setProperty('--seat', SEATS[p.seat % SEATS.length].base);
  node.innerHTML = `${cap ? heroCardHtml(cap, { compact: true }) : ''}
    ${p.managers.length ? `<div class="me-mgrs"><span class="cap">Ваши жетоны управляющих:</span>${
      p.managers.map(id => MANAGERS[id] ? managerTokenHtml(MANAGERS[id], { mini: true }) : '').join('')}</div>` : ''}`;
  return node;
}
function renderRivals() {
  const s = S(), mine = me();
  const box = $('#rivals');
  box.innerHTML = '';
  const mp = myPanel();
  if (mp) box.append(mp);
  for (const p of s.players) {
    if (p.id === mine.id) continue;
    const seat = SEATS[p.seat % SEATS.length];
    const node = el('div', 'rival');
    node.style.setProperty('--seat', seat.base);
    const rcap = p.capitalistId ? capOf(p.capitalistId) : null;
    if (currentActor(s) === p.id) node.classList.add('acting');
    const turn = currentActor(s) === p.id ? '<span class="turn-dot">ходит</span>' : '';
    if (s.phase === 'production' && p.done) node.classList.add('finished');
    const cap = p.capitalistId ? capOf(p.capitalistId) : null;
    const lastRoll = [...s.events].reverse().find(e => e.playerId === 'agent' && e.roll)?.roll;
    node.innerHTML = p.agent
      ? `<div class="rival-top">
          <span class="rival-name">${esc(p.name)}</span>${turn}
          <span class="rival-cap" title="Агент базовой игры: бросок d6 выбирает предприятие, затем ставится минимальный легальный диск. Экономику не копит.">ставит сам</span>
        </div>
        <div class="rival-row"><span class="res"><span class="num" style="color:var(--frost)">${
          lastRoll ? 'последний бросок d6: ' + lastRoll : 'ещё не ходил'}</span></span></div>
        <div class="rival-row discs">${p.discs.map(d => discHtml(d, p.seat, { small: true })).join('')}</div>`
      : `<div class="rival-top">
          <span class="rival-name">${esc(p.name)}</span>${turn}
          ${cap ? `<button type="button" class="rival-cap hero-link" data-cap="${cap.id}" title="${esc(cap.text)}">${hasPortrait(cap) ? `<img src="${src(portraitKey(cap))}" alt="">` : ''}${esc(cap.name)}</button>` : ''}
        </div>
        <div class="rival-row">
          ${resHtml('money', p.wallet.money, { keepZero: true })}
          ${['coal', 'metal', 'oil', 'upgrade'].map(k => resHtml(k, p.wallet[k])).join('')}
          <span class="rival-count" title="Предприятий в линии">🏭 ${p.cards.length}</span>
        </div>
        <div class="rival-row discs">${p.discs.map(d => discHtml(d, p.seat, { small: true })).join('')}</div>`;
    box.append(node);
  }
}

/** Плашка на разобранном лоте: кому досталась карта или жетон. */
function lotResult(s, lot) {
  const box = el('div', 'lot-result');
  let who = null;
  if (lot.kind === 'university') {
    const win = pickWinner(lot.bids, id => s.players.find(x => x.id === id));
    who = win ? s.players.find(x => x.id === win.playerId) : null;
    box.innerHTML = who ? `жетон → <b>${esc(who.name)}</b>` : 'жетон сброшен';
  } else {
    const e = [...s.events].reverse().find(x => x.cardId === lot.card.id && ['CardWon', 'AgentTookCard', 'CardDiscarded'].includes(x.type));
    who = e?.type === 'CardWon' ? s.players.find(x => x.id === e.playerId) : e?.type === 'AgentTookCard' ? s.players.find(x => x.agent) : null;
    box.innerHTML = e?.type === 'CardWon' ? `→ <b>${esc(who.name)}</b> за ${e.value}`
      : e?.type === 'AgentTookCard' ? `→ <b>агент</b> за ${e.value}` : 'никто не взял';
  }
  if (who) box.style.setProperty('--seat', SEATS[who.seat % SEATS.length].base);
  // Анимируем только только что разобранный лот, иначе плашки мигали бы при каждой перерисовке.
  if (!(ui.seenResolved ?? new Set()).has(lot.id)) box.classList.add('fresh');
  return box;
}

/* ---------- сцена: лоты или разбор ---------- */
function renderStage() {
  const s = S(), head = $('#stage-head'), strip = $('#stage-strip');
  strip.innerHTML = '';

  if (s.phase === 'auction' || s.phase === 'settlement') {
    const open = s.lots.filter(l => !l.resolved).length;
    head.innerHTML = s.phase === 'auction'
      ? `<h2>Лоты раунда</h2><span>Нажмите на предприятие, чтобы поставить на него диск. Разбор идёт слева направо.</span>`
      : `<h2>Разбор лотов</h2><span>Осталось ${open}. Сначала компенсации проигравшим, затем карта достаётся победителю.</span>`;

    s.lots.forEach((lot, i) => {
      const node = lot.kind === 'university' ? tableNode(lot) : cardNode(lot.card, { lot });
      const current = s.phase === 'settlement' && i === s.settlement.index;
      if (lot.resolved) {
        node.classList.add('dim');
        node.querySelector('.card-body')?.append(lotResult(s, lot));
      }
      if (current) node.classList.add('lifted');

      if (s.phase === 'auction') {
        const focused = ui.focus === lot.id;
        if (focused) node.classList.add('lifted', 'picked');
        node.tabIndex = 0;
        node.style.cursor = 'pointer';
        node.addEventListener('click', ev => {
          ui.focus = ui.focus === lot.id ? null : lot.id;
          render();
          requestAnimationFrame(() => document.querySelector('.card.picked')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        });
        node.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); node.click(); } });

      }
      strip.append(node);
    });
    return;
  }

  /* планирование и производство: сцена показывает чужие линии компактно */
  head.innerHTML = s.phase === 'planning'
    ? '<h2>Линии соперников</h2><span>Ниже вы расставляете свою линию: порядок решает, чем вы заплатите дальше.</span>'
    : s.phase === 'production'
      ? '<h2>Линии соперников</h2><span>Каждое предприятие работает один раз за раунд.</span>'
      : s.phase === 'choosing' ? '<h2>Подготовка</h2><span>Пятый игрок выбирает, с чем начнёт партию.</span>'
      : '<h2>Партия окончена</h2><span></span>';

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
      ${s.phase === 'finished' ? '' : myTurn() ? '<span class="turn-badge">ваш ход</span>' : '<span class="turn-badge wait">ждём соперника</span>'}
      ${cap ? `<button class="you-cap" data-cap="${cap.id}">${esc(cap.name)}</button>` : ''}
    </span>

    <span class="vault labeled">
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

  if (s.phase === 'choosing') {
    if (waiting) return promptBox(`<b>${actorName}</b> ходит пятым и выбирает стартовое предприятие и промышленника.`, true);
    return promptBox('Вы ходите пятым: по правилам «Интербеллума» выберите одно из двух стартовых предприятий и одного из двух промышленников.');
  }
  if (s.phase === 'auction') {
    if (waiting) return promptBox(`Ставку делает <b>${actorName}</b>.`, true);
    const pair = s.pendingPair?.playerId === p.id;   // только в режиме обновлённой карты «Интербеллума»
    const box = promptBox(pair
      ? 'Можно доставить дополнительную двойку Артура — но только <b>на другое предприятие</b>. Или пропустите: диск останется у вас.'
      : ui.disc && ui.focus ? 'Диск выбран. Можно выбрать другой:'
      : ui.disc ? 'Теперь нажмите на предприятие: ниже появится расчёт обоих исходов.'
        : 'Выберите диск, затем предприятие. <b>Мелкий диск — это не проигрыш</b>, а заказ компенсации.');

    const row = el('span', 'discs');
    row.append(el('span', 'cap', 'Ваши диски:'));
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
      wrap.innerHTML = `<span class="cap">уголь на диск</span>`;
      const minus = el('button', '', '−'), plus = el('button', '', '+');
      const val = el('span', 'times', ui.varValue);
      minus.disabled = ui.varValue <= 0; plus.disabled = ui.varValue >= p.wallet.coal;
      minus.onclick = () => { ui.varValue--; render(); };
      plus.onclick = () => { ui.varValue++; render(); };
      wrap.append(minus, val, plus, el('span', 'cap', `номинал ставки: <b>${ui.varValue + variableBonus(p)}</b> · угля в запасе: ${p.wallet.coal}`));
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
    if (s.supplies?.some(x => x.playerId === p.id))
      return promptBox('Пришла <b>поставка</b>: однократный эффект вне обычной очереди. Возьмите её или откажитесь.');
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

/** Применяемый управляющий доступен в любой момент использования карты. */
const ORDERED_TOKENS = ['upgrade-self', 'discard-self', 'local-gain', 'local-choice', 'repeat-supply'];
function managerPanel(card, p) {
  const s = S();
  const used = s.production.active.managersUsed ?? [];
  const onCard = card.managers ?? (card.manager ? [card.manager] : []);
  const pending = onCard.filter(t => ORDERED_TOKENS.includes(MANAGERS[t]?.effect.kind) && !used.includes(t));
  if (!pending.length) return null;

  const box = el('div', 'effect manager-step');
  box.append(el('div', 'effect-head',
    `<span>${pending.length > 1 ? 'Управляющие на этом предприятии' : 'Управляющий на этом предприятии'}</span>`));
  for (const token of pending) {
    const boost = MANAGERS[token].effect;
    box.append(el('div', 'ledger-note', esc(MANAGERS[token].text)));
    const row = el('div', 'counter');
    if (boost.kind === 'local-choice') {
      boost.options.forEach((option, i) => {
        const btn = el('button', 'act', `Взять ${Object.entries(option).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(' и ')}`);
        btn.onclick = () => act({ type: 'UseManager', token, option: i });
        row.append(btn);
      });
    } else {
      const label = boost.kind === 'upgrade-self' ? 'Улучшить это предприятие'
        : boost.kind === 'discard-self' ? `Сбросить предприятие и взять ${boost.gain.money} денег`
          : boost.kind === 'repeat-supply' ? 'Разыграть поставку ещё раз'
            : `Взять ${Object.entries(boost.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(' и ')} на карту`;
      const btn = el('button', 'act', label);
      if (boost.kind === 'upgrade-self') {
        const pool = Object.fromEntries(Object.keys(p.wallet).map(k => [k, p.wallet[k] + (card.local?.[k] ?? 0)]));
        btn.disabled = card.upgraded || !canPay(pool, boost.cost) || DEFS[card.definitionId].kind !== 'company';
      }
      btn.onclick = () => act({ type: 'UseManager', token });
      row.append(btn);
    }
    box.append(row);
  }
  return box;
}

function renderEffect() {
  renderEffectMain();
  extraPanels();
}

/** Панели способностей, которые доступны вне очереди строк: постоянная модернизация и «Сосед». */
function extraPanels() {
  const s = S(), p = me(), slot = $('#effect-slot');
  if (s.phase !== 'production' || !myTurn() || p.done || s.production.active) return;

  const holder = p.cards.some(c => !c.borrowed && (DEFS[c.definitionId].effects ?? []).concat(c.upgraded ? DEFS[c.definitionId].advanced ?? [] : [])
    .some(r => r.kind === 'permanent' && r.rule === 'upgrade-on-gain'));
  const targets = p.cards.filter(c => !c.upgraded && DEFS[c.definitionId].kind === 'company');
  if (holder && p.wallet.upgrade > 0 && p.wallet.coal > 0 && targets.length) {
    const box = el('div', 'effect upgrade-step');
    box.append(el('div', 'effect-head', '<span>Постоянный эффект стартового предприятия: модернизация за жетон и уголь</span>'));
    box.append(el('div', 'recipe', `${bundleHtml({ coal: 1, upgrade: 1 })}<span class="to">→</span><span>модернизация</span>`));
    const row = el('div', 'counter');
    targets.forEach(c => {
      const btn = pointsAt(el('button', 'act', `Улучшить: ${esc(lineTitle(p, c))}`), c.id);
      btn.onclick = () => act({ type: 'Upgrade', cardId: c.id });
      row.append(btn);
    });
    box.append(row); slot.append(box);
  }

  if (p.ability === 'use-neighbour-card' && !p.neighbourUsed && p.wallet.metal > 0 && p.cards.every(c => c.usedRound === s.round)) {
    const humans = s.players.filter(x => !x.agent);
    const right = humans.length > 1 ? humans[(humans.indexOf(p) - 1 + humans.length) % humans.length] : null;
    const cards = right ? right.cards.filter(c => DEFS[c.definitionId].kind === 'company') : [];
    if (cards.length) {
      const box = el('div', 'effect');
      box.append(el('div', 'effect-head', `<span>Сосед: 1 металл — использовать предприятие соседа справа (${esc(right.name)})</span>`));
      const row = el('div', 'counter');
      cards.forEach(c => {
        const btn = el('button', 'act ghost', `${esc(lineTitle(right, c))}${c.upgraded ? ' (улучшено)' : ''}`);
        btn.onclick = () => act({ type: 'UseNeighbourCard', cardId: c.id });
        row.append(btn);
      });
      box.append(row); slot.append(box);
    }
  }
}

function renderEffectMain() {
  const s = S(), p = me(), slot = $('#effect-slot');
  slot.innerHTML = '';

  if (s.phase === 'choosing') {
    if (!myTurn() || !s.choice) return;
    const c = s.choice;
    ui.pick ??= { startupId: c.startups?.[0] ?? null, capitalistId: c.capitalists?.[0] ?? null };
    const box = el('div', 'effect choose');
    if (c.startups) {
      box.append(el('div', 'effect-head', '<span>Стартовое предприятие</span>'));
      const row = el('div', 'choose-row');
      c.startups.forEach(id => {
        const node = cardNode({ id: `opt-${id}`, definitionId: id, upgraded: false, usedRound: 0 });
        node.classList.add('choice');
        if (ui.pick.startupId === id) node.classList.add('picked');
        node.tabIndex = 0;
        node.onclick = () => { ui.pick.startupId = id; render(); };
        row.append(node);
      });
      box.append(row);
    }
    if (c.capitalists) {
      box.append(el('div', 'effect-head', '<span>Промышленник</span>'));
      const row = el('div', 'choose-row heroes');
      c.capitalists.forEach(id => {
        const wrap = el('div', `hero-choice ${ui.pick.capitalistId === id ? 'picked' : ''}`, heroCardHtml(capOf(id), { compact: true }));
        wrap.querySelector('.hero-card').removeAttribute('data-cap');
        wrap.tabIndex = 0;
        wrap.onclick = () => { ui.pick.capitalistId = id; render(); };
        row.append(wrap);
      });
      box.append(row);
    }
    const go = el('button', 'act', 'Подтвердить выбор');
    go.onclick = () => {
      const pick = ui.pick; ui.pick = null;
      act({ type: 'ChooseStart', startupId: pick.startupId, capitalistId: pick.capitalistId });
      if (S().phase !== 'choosing' && S().players.some(x => x.capitalistId)) showDeal();
    };
    const actions = el('div', 'counter'); actions.append(go); box.append(actions);
    slot.append(box);
    return;
  }

  if (s.phase === 'auction' && ui.focus) {
    const lot = s.lots.find(l => l.id === ui.focus);
    if (lot) {
      const wrap = el('div', 'bid-dock');
      wrap.append(ledgerNode(lot));
      const disc = ui.disc && p.discs.find(d => d.id === ui.disc);
      const { value, nominal } = stakeOf(p, disc);
      const err = !myTurn() ? 'Сейчас ходит другой игрок'
        : !disc ? 'Сначала выберите диск' : bidError(s, p.id, disc.id, lot.id, value);
      const cta = el('button', `card-cta ${err ? '' : 'go'}`, err ? esc(err) : `Поставить диск ${nominal}`);
      cta.disabled = !!err;
      cta.addEventListener('click', () => {
        act({ type: 'Bid', discId: disc.id, lotId: lot.id, value });
        ui.focus = null; ui.disc = null;
      });
      wrap.append(cta);
      slot.append(wrap);
    }
    return;
  }

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

  // Поставка вне очереди: пока она не разыграна, производство не идёт дальше.
  const supply = s.supplies?.find(x => x.playerId === p.id);
  if (supply) {
    const e = supply.effect;
    let max = 0;
    max = supplyCapacity(s, DEFS, p.id, e);
    slot.append(counterPanel({
      title: 'Поставка — однократно, вне очереди производства', effect: e, max,
      runLabel: 'Взять поставку', skipLabel: 'Отказаться',
      onRun: times => act({ type: 'TakeSupply', times }),
      onSkip: () => act({ type: 'TakeSupply', times: 0 }),
    }));
    return;
  }

  const a = s.production.active;
  if (!a) return;

  // Компенсатор: своя компенсация разыгрывается до обычных строк.
  if (a.compensationLeft) {
    const card = p.cards.find(c => c.id === a.cardId);
    const comp = DEFS[card.definitionId].compensation;
    const box = el('div', 'effect manager-step');
    box.append(el('div', 'effect-head', '<span>Компенсация своего предприятия — до обычных строк</span>'));
    box.append(el('div', 'recipe', effectHtml(comp)));
    const row = el('div', 'counter');
    if (comp.kind === 'gain') {
      const take = el('button', 'act', 'Взять компенсацию');
      take.onclick = () => act({ type: 'UseOwnCompensation', times: 1 });
      row.append(take);
    } else {
      let max = 0;
      for (let t = comp.limit; t >= 1; t--) if (canPay(p.wallet, comp.cost, t)) { max = t; break; }
      for (let t = 1; t <= max; t++) {
        const btn = el('button', 'act', `Применить ×${t}`);
        btn.onclick = () => act({ type: 'UseOwnCompensation', times: t });
        row.append(btn);
      }
      if (!max) row.append(el('span', 'cap', 'не хватает сырья'));
    }
    const skip = el('button', 'act ghost', 'Не применять');
    skip.onclick = () => act({ type: 'UseOwnCompensation', times: 0 });
    row.append(skip);
    box.append(row); slot.append(box);
    return;
  }
  const card = p.cards.find(c => c.id === a.cardId), d = DEFS[card.definitionId];
  // Поставки идут вне очереди производства, поэтому в списке строк их нет.
  const list = [...d.effects, ...(card.upgraded ? d.advanced : [])].filter(r => r.kind !== 'supply');
  const mgr = managerPanel(card, p);
  if (mgr) slot.append(mgr);
  const e = list[a.index];
  if (!e) {
    // Строки кончились: остался только выбор по управляющему либо завершение карты.
    const done = el('div', 'counter');
    done.style.margin = '0 14px 10px';
    const btn = el('button', 'act ghost', mgr ? 'Не применять управляющего' : 'Завершить предприятие');
    btn.onclick = () => act({ type: 'NextEffect' });
    done.append(btn);
    slot.append(done);
    return;
  }

  if (e.kind === 'upgrade') {
    const box = el('div', 'effect upgrade-step');
    const local = card.local ?? {};
    const cost = upgradeCost({ ...p, wallet: { ...p.wallet, upgrade: p.wallet.upgrade + (local.upgrade ?? 0) } }, e.cost);
    const targets = p.cards.filter(c => !c.upgraded && DEFS[c.definitionId].kind === 'company');
    const pool = Object.fromEntries(Object.keys(p.wallet).map(k => [k, p.wallet[k] + (local[k] ?? 0)]));
    const paid = canPay(pool, cost);
    const offer = targets.length > 0 && paid;

    box.append(el('div', 'effect-head',
      `<span>${offer ? 'Можно модернизировать предприятие' : 'Модернизация'} — строка ${a.index + 1} из ${list.length}</span>
       <span class="step">${list.map((_, i) => `<i class="${i <= a.index ? 'on' : ''}"></i>`).join('')}</span>`));
    box.append(el('div', 'recipe',
      `${bundleHtml(cost)}<span class="to">\u2192</span><span>предприятие переворачивается на улучшенную сторону и получает новые строки${e.limit ? ` (не более ${e.limit - (a.used ?? 0)} раз)` : ''}</span>`));
    if (p.ability === 'metal-for-upgrade' && (e.cost?.upgrade ?? 1) > 0 && p.wallet.upgrade === 0)
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
        const btn = pointsAt(el('button', 'act', `Улучшить: ${esc(lineTitle(p, c))}`), c.id);
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

  if (e.kind === 'upgrade-next') {
    const box = el('div', 'effect upgrade-step');
    box.append(el('div', 'effect-head', `<span>Модернизация соседа — строка ${a.index + 1} из ${list.length}</span>`));
    box.append(el('div', 'ledger-note', esc(e.text)));
    const idx = p.cards.findIndex(c => c.id === card.id), next = p.cards[idx + 1];
    const row = el('div', 'counter');
    const can = next && !next.upgraded && DEFS[next.definitionId].kind === 'company';
    if (!next) row.append(el('span', 'cap', 'Это предприятие последнее в линии.'));
    else if (!can) row.append(el('span', 'cap', `«${esc(lineTitle(p, next))}» улучшить нельзя.`));
    else {
      const btn = pointsAt(el('button', 'act', `Улучшить следующее: ${esc(lineTitle(p, next))}`), next.id);
      btn.onclick = () => act({ type: 'UpgradeNext' });
      row.append(btn);
    }
    const skip = el('button', 'act ghost', can ? 'Не улучшать' : 'Дальше');
    skip.onclick = () => act({ type: 'NextEffect' });
    row.append(skip);
    box.append(row); slot.append(box);
    return;
  }

  if (e.kind === 'convert') {
    const max = convertCapacity(s, DEFS);
    slot.append(counterPanel({
      title: `${esc(lineTitle(p, card))} — строка ${a.index + 1} из ${list.length}`,
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
    ? (s.config.productionChain ? 'Ваша линия — «Цепочка»: старые карты закреплены, двигайте новые' : 'Ваша линия — порядок можно менять свободно')
    : `Ваша линия · предприятий: ${p.cards.length}. Производство идёт слева направо.`;

  p.cards.forEach((card, i) => {
    const node = cardNode(card, { owner: p });
    const used = card.usedRound === s.round;

    if (planning && p.managers.length) {
      const row = el('div', 'move-row mgr-row');
      const here = card.managers ?? [];
      const busy = new Set(p.cards.flatMap(c => (c.id === card.id ? [] : c.managers ?? [])));
      const free = p.managers.filter(t => !busy.has(t));
      const pick = el('select', 'mgr-pick');
      pick.innerHTML = `<option value="">без управляющего</option>` + free.map(t =>
        `<option value="${t}" ${here.includes(t) ? 'selected' : ''}>${esc(MANAGERS[t].text.slice(0, 40))}…</option>`).join('');
      if (p.ability === 'personal-manager') pick.multiple = true;
      pick.title = here.length ? here.map(t => MANAGERS[t].text).join('\n\n') : 'Поставить жетон управляющего';
      pick.onchange = () => {
        const chosen = pick.multiple ? [...pick.selectedOptions].map(o => o.value).filter(Boolean)
          : (pick.value ? [pick.value] : []);
        const next = p.cards.flatMap(c => (c.id === card.id ? chosen : c.managers ?? [])
          .map(token => ({ cardId: c.id, token })));
        act({ type: 'PlaceManagers', assignments: next });
      };
      node.append(pick);
      node.append(row);
    }
    if (planning) {
      node.classList.add('movable');
      const row = el('div', 'move-row');
      const left = el('button', '', '←'), right = el('button', '', '→');
      // В цепочке старые карты сохраняют взаимный порядок: две старые карты местами не меняются.
      const pinned = j => s.config.productionChain && (p.lockedOrder ?? []).includes(p.cards[j]?.id) && (p.lockedOrder ?? []).includes(card.id);
      left.disabled = i === 0 || pinned(i - 1); right.disabled = i === p.cards.length - 1 || pinned(i + 1);
      const why = 'В цепочке нельзя менять порядок двух старых карт: двигайте новые.';
      if (left.disabled && i > 0) left.title = why;
      if (right.disabled && i < p.cards.length - 1) right.title = why;
      left.onclick = () => moveCard(i, i - 1);
      right.onclick = () => moveCard(i, i + 1);
      if (s.config.productionChain && (p.lockedOrder ?? []).includes(card.id))
        node.querySelector('.card-name').append(el('span', 'cn-state lock', '🔒 старая'));
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
  AgentTookCard: e => `Агент забирает «${esc(titleOf(e.definitionId))}» за ${e.value} — карта выбывает из игры`,
  AgentBlocked: e => `Агенту ставить некуда (d6: ${e.roll})`,
  PairOffered: (e, n) => `<b>${n(e.playerId)}</b> может доставить дополнительную двойку`,
  AuctionClosed: () => 'Ставок больше нет',
  Compensation: (e, n) => e.times ? `<b>${n(e.playerId)}</b> берёт компенсацию ×${e.times}` : `<b>${n(e.playerId)}</b> без компенсации`,
  CompensationChosen: (e, n) => {
    const k = e.times ?? (e.picks ?? []).reduce((a, b) => a + b, 0);
    return k ? `<b>${n(e.playerId)}</b> применяет компенсацию ×${k}` : `<b>${n(e.playerId)}</b> отказывается от компенсации`;
  },
  CardWon: (e, n) => `<b>${n(e.playerId)}</b> забирает «${esc(titleOf(e.definitionId))}» за ${e.value}`,
  CardDiscarded: () => 'Лот никто не взял',
  ManagerWon: (e, n) => `<b>${n(e.playerId)}</b> забирает жетон управляющего за ${e.value}`,
  ManagersPlaced: (e, n) => e.count ? `<b>${n(e.playerId)}</b> расставляет управляющих: ${e.count}` : null,
  ManagerBonus: (e, n) => `<b>${n(e.playerId)}</b> получает от управляющего ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  ManagerSupplied: (e, n) => `<b>${n(e.playerId)}</b> кладёт на предприятие ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  CountedCards: (e, n) => `<b>${n(e.playerId)}</b> считает подходящие предприятия: ${e.cards}`,
  BonusArmed: (e, n) => `<b>${n(e.playerId)}</b> включает надбавку за операции с ресурсом`,
  OperationBonus: (e, n) => `<b>${n(e.playerId)}</b> получает надбавку ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  SupplyRepeated: (e, n) => `<b>${n(e.playerId)}</b> повторяет поставку жетоном управляющего`,
  OwnCompensationUsed: (e, n) => e.times ? `<b>${n(e.playerId)}</b> разыгрывает компенсацию своей карты ×${e.times}` : null,
  SupplyTaken: (e, n) => `<b>${n(e.playerId)}</b> получает поставку: ${Object.entries(e.gain).map(([k, v]) => `${v} ${RES_SHORT[k]}`).join(', ')}`,
  SupplyOffered: (e, n) => `<b>${n(e.playerId)}</b> может разыграть поставку`,
  SupplyResolved: (e, n) => e.times ? `<b>${n(e.playerId)}</b> разыгрывает поставку ×${e.times}` : `<b>${n(e.playerId)}</b> отказывается от поставки`,
  CardScrapped: (e, n) => `<b>${n(e.playerId)}</b> выводит предприятие из игры за ${e.gain.money} денег`,
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
  StoredOnCard: (e, n) => `<b>${n(e.playerId)}</b> кладёт ${RES_SHORT[e.resource]} на карту${e.reason === 'compensation' ? ' (компенсация за диск 3–4)' : ''}`,
  TookFromCard: (e, n) => e.amount ? `<b>${n(e.playerId)}</b> забирает с карты ${e.amount} ${RES_SHORT[e.resource]}` : null,
  NeighbourCardUsed: (e, n) => `<b>${n(e.playerId)}</b> тратит 1 металл и использует предприятие соседа`,
  ChoiceOffered: (e, n) => `<b>${n(e.playerId)}</b> ходит пятым и выбирает стартовое предприятие и промышленника`,
  ChoiceMade: (e, n) => `<b>${n(e.playerId)}</b> выбирает «${esc(DEFS[e.startupId]?.name ?? '')}»${e.capitalistId ? ` и промышленника ${esc(capOf(e.capitalistId)?.name ?? '')}` : ''}`,
  CardCompleted: () => null,
  CardsArranged: () => null,
  GameFinished: () => 'Четвёртый раунд сыгран',
};

function renderLog() {
  const s = S();
  const stamp = `${ui.record?.state === s ? '' : 'x'}${s.events.length}:${s.events.at(-1)?.seq ?? 0}`;
  if (ui.logStamp === stamp && ui.logRecord === ui.record) return;   // журнал не менялся
  ui.logStamp = stamp; ui.logRecord = ui.record;
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

  ui.seenResolved = new Set((s.lots ?? []).filter(l => l.resolved).map(l => l.id));
  ui.seenUp = {};
  for (const p of s.players) for (const c of p.cards) ui.seenUp[c.id] = Boolean(c.upgraded);

  // разбор лотов идёт сам, с паузой — чтобы было видно, что происходит
  if (s.phase === 'settlement' && !s.settlement.pending && (ui.online?.playing || myTurn())) {
    // Онлайн разбор может запустить любой игрок (сервер принимает его от всех), поэтому
    // ждём по-разному: если первый клиент отключился, партия не встанет.
    const delay = 900 + (ui.online?.playing && !myTurn() ? 700 + 500 * (ui.seat ?? 0) : 0);
    ui.settleTimer = setTimeout(() => act({ type: 'ResolveLot' }, true), delay);
  }
  if (s.phase === 'finished' && !ui.shownResult) { ui.shownResult = true; showResult(); }
  if (typeof afterRender === 'function') afterRender(s);
}

/* ---------- команды ---------- */
function act(command, quiet = false) {
  if (ui.online?.playing) return actOnline(command, quiet);
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
  if (ui.online?.playing) return;   // онлайн-партия хранится на сервере, локальное сохранение не трогаем
  try { localStorage.setItem(KEY, JSON.stringify({ state: ui.record.state, seat: ui.seat })); } catch { /* приватный режим */ }
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
  const tabs = [['company', 'Предприятия'], ['expansion', 'Интербеллум'], ['startup', 'Стартовые'],
    ['university', 'Университеты'], ['manager', 'Управляющие'], ['capitalist', 'Промышленники']];
  const body = $('#gallery-body');
  body.innerHTML = `
    <h2>Карты стола</h2>
    <p>${filter === 'company' || filter === 'expansion' ? 'У каждого предприятия две стороны: обычная и после улучшения. ' : ''}Нажмите на карту, чтобы рассмотреть её крупно.</p>
    <div class="tabs">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${k === filter ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="gallery ${filter === 'capitalist' || filter === 'manager' ? 'wide' : 'cards'}"></div>`;
  const grid = body.querySelector('.gallery');
  const companyPair = id => {
    const box = el('div', 'g-pair');
    for (const upgraded of [false, true]) {
      const card = { id: `g-${id}-${upgraded}`, definitionId: id, upgraded, usedRound: 0 };
      const node = cardNode(card, { mode: 'gallery' });
      node.querySelector('.card-face').onclick = () => zoomCard(card);
      box.append(node);
    }
    return box;
  };
  if (filter === 'company') for (const id of [...new Set(PACK.deck)]) grid.append(companyPair(id));
  if (filter === 'expansion') for (const id of PACK.expansionDeck) grid.append(companyPair(id));
  if (filter === 'startup') for (const id of [...PACK.startupIds, ...PACK.expansionStartupIds]) {
    const card = { id: `g-${id}`, definitionId: id, upgraded: false, usedRound: 0 };
    const node = cardNode(card, { mode: 'gallery' });
    node.querySelector('.card-face').onclick = () => zoomCard(card);
    grid.append(node);
  }
  if (filter === 'university') for (const u of PACK.universities) for (const side of u.sides)
    grid.append(tableNode({ id: `g-${side.id}`, table: { id: u.id, sideId: side.id, options: side.options }, token: null, bids: [] }));
  if (filter === 'manager') for (const m of [...PACK.managers, PACK.personalManager].filter(Boolean)) {
    const box = el('div', 'g-item', managerTokenHtml(m));
    grid.append(box);
  }
  if (filter === 'capitalist') for (const c of [...PACK.capitalists, ...PACK.expansionCapitalists]) {
    const box = el('div', 'g-item', heroCardHtml(c));
    grid.append(box);
  }
  body.querySelectorAll('[data-tab]').forEach(btn => btn.onclick = () => renderGallery(btn.dataset.tab));
}
function zoom(key) {
  $('#zoom').innerHTML = `<img src="${src(key)}" alt="">`;
  $('#zoom').onclick = () => $('#zoom').close();
  $('#zoom').showModal();
}

/* ---------- новая партия ---------- */
function maybeHelp() {
  try { if (!localStorage.getItem('industry.table.helped')) { localStorage.setItem('industry.table.helped', '1'); showHelp(); } } catch { showHelp(); }
}
/** Показывает, кому какой промышленник и стартовое предприятие достались при раздаче. */
function showDeal() {
  const s = S();
  $('#deal-body').innerHTML = `<h2>Раздача</h2>
    <p>Каждый получил стартовое предприятие и промышленника. Способность промышленника действует всю партию; посмотреть её можно наверху экрана.</p>
    <div class="deal-list">${s.players.filter(x => !x.agent).map(p => {
      if (s.phase === 'choosing' && s.choice?.playerId === p.id)
        return `<div class="deal-row" style="--seat:${SEATS[p.seat % SEATS.length].base}"><div class="deal-name">${esc(p.name)}</div>
          <div class="deal-start">Ходит пятым: выбирает одно из двух стартовых предприятий и одного из двух промышленников.</div></div>`;
      const c = p.capitalistId ? capOf(p.capitalistId) : null;
      const st = DEFS[p.cards[0].definitionId];
      return `<div class="deal-row" style="--seat:${SEATS[p.seat % SEATS.length].base}">
        <div class="deal-name">${esc(p.name)}</div>
        ${c ? heroCardHtml(c) : ''}
        <div class="deal-start">Стартовое предприятие: <b>${esc(st.name)}</b> · ресурсы на старте: ${bundleHtml(st.starting)}</div>
      </div>`;
    }).join('')}</div>
    <div class="sheet-actions"><button class="act" data-close>К столу</button></div>`;
  $('#deal').showModal();
}
function showHelp() {
  $('#help-body').innerHTML = `
    <h2>Как играть</h2>
    <p>Побеждает тот, у кого после четвёртого раунда больше денег. Каждый раунд состоит из четырёх этапов.</p>
    <ol class="how">
      <li><b>Аукцион.</b> Выберите один из своих дисков, затем нажмите на предприятие и поставьте диск. Чей диск больше, тот и заберёт предприятие.</li>
      <li><b>Разбор.</b> Кто проиграл лот, получает <em>компенсацию</em> с карты: столько операций, какой номинал у его диска. Мелкий диск — это не проигрыш, а заказ компенсации.</li>
      <li><b>План.</b> Расставьте свою линию предприятий. Порядок важен: производство идёт слева направо, и от него зависит, чем вы заплатите дальше.</li>
      <li><b>Производство.</b> Запускайте предприятия по очереди: каждое обменивает одни ресурсы на другие. Каждое работает один раз за раунд.</li>
    </ol>
    <h3 class="how-h">Что означают значки</h3>
    <div class="legend">${['money', 'coal', 'metal', 'oil', 'upgrade'].map(k =>
      `<span class="res ${k} labeled">${'<span class="ico">' + ICONS[k] + '</span><span class="lbl">' + RES_TITLE[k] + '</span>'}</span>`).join('')}</div>
    <p class="how-note">Модернизация переворачивает предприятие на улучшенную сторону. Стрелка на карте — «отдаёте → получаете», число рядом с «×» — сколько раз можно повторить обмен.</p>
    <details class="more">
      <summary>Подробные правила</summary>
      <div class="rules">
        <h3>Подготовка</h3>
        <p>Каждый получает случайное стартовое предприятие и берёт ресурсы с его верхней полосы, комплект дисков 1–4 и (если играете с промышленниками) карту промышленника. Первый игрок выбирается случайно.</p>
        <h3>Аукцион</h3>
        <p>В ряд выкладывают карт по числу игроков плюс четыре: вдвоём 6, втроём 7, вчетвером 8. Игроки по очереди кладут по одному диску на карту. Нельзя класть диск на карту, где уже лежит ваш диск или диск с таким же значением. Если ходить некуда, ход пропускается.</p>
        <h3>Итоги аукциона</h3>
        <p>Карты разбираются слева направо. Предприятие получает владелец самого большого диска. Все остальные получают компенсацию из верхней части карты: если это добыча, ресурсы выдаются столько раз, каково значение диска; если переработка, то её можно применить до стольких раз. Ресурсы, полученные с карты слева, можно потратить на карте справа. Карта без дисков сбрасывается. Затем все забирают свои диски.</p>
        <h3>Производство</h3>
        <p>Каждое предприятие работает один раз за раунд, порядок выбираете вы. На обычной стороне действуют обычные эффекты (яркие символы), после модернизации — ещё и продвинутые. Эффекты одной карты идут сверху вниз, чужой эффект между ними вставить нельзя. Верхняя строка стартового предприятия даёт жетон модернизации, нижняя позволяет за жетон и уголь модернизировать любое число ваших карт. Стартовое предприятие модернизировать нельзя; уже отработавшая карта в этом раунде второй раз не работает, даже если её модернизировали.</p>
        <h3>Конец раунда и игры</h3>
        <p>Жетон первого игрока переходит соседу слева. После четвёртого раунда побеждает тот, у кого больше денег. При равенстве побеждает тот, у кого больше карт, затем больше ресурсов.</p>
        <h3>«Интербеллум»</h3>
        <p><b>Диск переменного капитала</b>: его значение равно числу потраченного угля. <b>Университеты</b> лежат в конце ряда: победитель забирает с них жетон управляющего, а компенсацию можно разделить между двумя вариантами. <b>Управляющие</b> в фазе производства кладутся по одному на карту и работают как дополнительный эффект; в конце раунда вы забираете их обратно. <b>Поставки</b> (значок молнии) применяются один раз сразу после получения или модернизации карты. <b>Постоянные эффекты</b> (на синем фоне) действуют всё время, пока карта у вас.</p>
      </div>
    </details>
    <div class="sheet-actions"><button class="act" data-close>Понятно, играем</button></div>`;
  $('#help').showModal();
}

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
        expansion: field('expansion').checked,
      universities: field('universities').checked,
      variableCapital: field('variable').checked,
        productionChain: field('chain').checked,
        randomFirst: true,
        capitalists: field('capitalists').checked,
      }, PACK);
      if (ui.online) leaveOnline(false);
      ui.record = { state }; ui.seat = null; ui.disc = null; ui.focus = null; ui.shownResult = false;
      ui.prevWallets = {};
      save(); render();
      $('#setup').close();
      if (state.phase === 'choosing' && !state.players[4]?.agent) maybeHelp();
      else if (state.players.some(x => x.capitalistId)) showDeal(); else maybeHelp();
    } catch (err) { toast(err.message); }
  };
  const sync = () => {
    const n = Number(field('count').value);
    form.querySelectorAll('.pname-row').forEach((row, i) => row.style.display = i < n ? '' : 'none');
    $('#deck-warn').style.display = n >= 4 ? '' : 'none';
    $('#five-note').style.display = n === 5 ? '' : 'none';
    $('#agent-note').style.display = n === 2 ? '' : 'none';
    // С дополнением колода становится полной, костыль с возвратом лотов не нужен.
    if (field('expansion').checked) $('#deck-warn').style.display = 'none';
  };
  field('count').onchange = sync; field('expansion').onchange = sync; sync();
  $('#setup').showModal();
}

/* ---------- запуск ---------- */
function bindShell() {
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-close]')) ev.target.closest('dialog')?.close();
    const open = ev.target.closest('[data-open]')?.dataset.open;
    if (open === 'log') $('#drawer').classList.toggle('open');
    if (open === 'gallery') { renderGallery(); $('#gallery').showModal(); }
    if (open === 'setup') openSetup();
    if (open === 'help') showHelp();
    if (ev.target.closest('[data-close-drawer]')) $('#drawer').classList.remove('open');
    const cap = ev.target.closest('[data-cap]')?.dataset.cap;
    if (cap && !ev.target.closest('#zoom')) zoomHero(capOf(cap));
    const mgr = ev.target.closest('[data-mgr]')?.dataset.mgr;
    if (mgr && !ev.target.closest('#zoom')) zoomToken(mgr);
  });
}

function boot() {
  $('#deal').addEventListener('close', maybeHelp);
  bindShell();
  const saved = loadLocal();
  if (saved) { ui.record = { state: saved.state }; ui.seat = saved.seat ?? null; render(); }
  else openSetup();
  if (typeof initOnline === 'function') initOnline();
}
