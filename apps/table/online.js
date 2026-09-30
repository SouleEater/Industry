/* ===== Индустрия — вход и онлайн-партии =====
   Работает, только когда страница открыта с сервера (server/index.mjs). Без сервера
   (двойной щелчок по файлу, table:serve) остаётся игра на одном устройстве.
   Файл подключается после ui.js и вызывает boot() в самом конце. */

const net = { server: false, user: null, csrf: '', registration: 'open', source: null };

/** Запрос к API сервера: cookie сессии уходит сама, изменяющие запросы несут CSRF-токен. */
async function api(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  if (method !== 'GET' && net.csrf) options.headers['X-CSRF-Token'] = net.csrf;
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { /* не JSON */ }
  if (!res.ok) {
    const error = new Error(data?.error || `Ошибка сервера (${res.status})`);
    error.status = res.status; error.data = data;
    if (res.status === 401 && net.user) { net.user = null; net.csrf = ''; renderRail(); }
    throw error;
  }
  return data;
}

async function initNet() {
  try {
    const cfg = await fetch('/api/config', { credentials: 'same-origin' });
    if (!cfg.ok || !String(cfg.headers.get('content-type')).includes('json')) return;
    net.registration = (await cfg.json()).registration;
    net.server = true;
    const me = await api('GET', '/api/me');
    net.user = me.user; net.csrf = me.csrf ?? '';
  } catch { net.server = false; }
  renderRail();
}

const escAttr = v => esc(v).replace(/`/g, '&#96;');

/** Блок «вход / онлайн» на экране новой партии: шапка под окном недоступна. */
function renderSetupOnline() {
  const box = $('#setup-online');
  if (!box) return;
  box.hidden = !net.server;
  if (!net.server) return;
  box.innerHTML = net.user
    ? `<span>Вы вошли как <b>${esc(net.user.username)}</b></span><button type="button" class="act ghost" data-open="online">Играть по сети</button>`
    : `<span>Хотите играть с друзьями по сети?</span><button type="button" class="act ghost" data-open="login">Войти или зарегистрироваться</button>`;
}

/* ---------- вход и регистрация ---------- */
let authMode = 'login', afterAuth = null;
function showAuth(next = null, mode = 'login') {
  afterAuth = next; setAuthMode(mode);
  $('#auth-error').textContent = '';
  $('#auth-form').reset();
  $('#auth').showModal();
  $('#auth-form [name=username]').focus();
}
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('#auth-title').textContent = reg ? 'Регистрация' : 'Вход';
  $('#auth-submit').textContent = reg ? 'Создать аккаунт' : 'Войти';
  $('#auth-form [name=password]').autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-invite').hidden = !(reg && net.registration === 'invite');
  $('#auth-hint').hidden = !reg;
  $('#auth-closed').hidden = !(reg && net.registration === 'closed');
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('on', b.dataset.authTab === mode));
}
async function submitAuth(ev) {
  ev.preventDefault();
  const form = ev.target, data = Object.fromEntries(new FormData(form));
  const button = $('#auth-submit'); button.disabled = true;
  try {
    const path = authMode === 'register' ? '/api/register' : '/api/login';
    const body = { username: String(data.username ?? '').trim(), password: String(data.password ?? '') };
    if (authMode === 'register' && data.invite) body.invite = String(data.invite);
    const r = await api('POST', path, body);
    net.user = r.user; net.csrf = r.csrf;
    form.reset(); $('#auth').close(); renderRail();
    toast(`Добро пожаловать, ${net.user.username}!`);
    const next = afterAuth; afterAuth = null; if (next) next();
  } catch (error) {
    $('#auth-error').textContent = error.message;
  } finally { button.disabled = false; }
}

function showAccount() {
  $('#account-body').innerHTML = `<h2>${esc(net.user.username)}</h2>
    <p>Вы вошли в аккаунт. Партии по сети привязаны к нему.</p>
    <form id="password-form">
      <label class="field"><span>Текущий пароль</span><input name="current" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Новый пароль (от 8 символов)</span><input name="next" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
      <p class="form-error" id="password-error" role="alert"></p>
      <div class="sheet-actions"><button class="act ghost" type="submit">Сменить пароль</button></div>
    </form>
    <div class="sheet-actions"><button class="act ghost" data-close>Закрыть</button><button class="act" id="logout-btn">Выйти</button></div>`;
  $('#password-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      const r = await api('POST', '/api/password', { current: f.current, next: f.next });
      net.csrf = r.csrf; ev.target.reset(); $('#password-error').textContent = '';
      toast('Пароль изменён. Остальные устройства вышли из аккаунта.');
    } catch (error) { $('#password-error').textContent = error.message; }
  };
  $('#logout-btn').onclick = async () => {
    try { await api('POST', '/api/logout'); } catch { /* уже вышли */ }
    net.user = null; net.csrf = '';
    leaveOnline(); $('#account').close(); renderRail();
    toast('Вы вышли из аккаунта.');
  };
  $('#account').showModal();
}

/* ---------- меню «Онлайн» ---------- */
const STATUS_TEXT = { lobby: 'ждёт игроков', playing: 'идёт игра', finished: 'окончена' };
async function showOnline() {
  if (!net.server) { toast('Онлайн-игра доступна, когда страница открыта с сервера.'); return; }
  if (!net.user) { showAuth(showOnline); return; }
  let lists = { mine: [], open: [] };
  try { lists = await api('GET', '/api/tables'); } catch (error) { toast(error.message); return; }
  const row = (t, action) => `<li class="t-row"><span class="t-code">${esc(t.code)}</span>
    <span class="t-info">хозяин: ${esc(t.host)} · игроков: ${t.players}${t.status ? ` · ${STATUS_TEXT[t.status]}` : ''}</span>
    <button class="chip" data-table="${esc(t.code)}" data-do="${action}">${action === 'open' ? 'Открыть' : 'Присоединиться'}</button></li>`;
  $('#online-body').innerHTML = `<h2>Онлайн-партия</h2>
    <p>Вы вошли как <b>${esc(net.user.username)}</b>. Создайте стол и отправьте друзьям код или ссылку либо присоединитесь к чужому.</p>
    <h3 class="sub">Создать стол</h3>
    <form id="create-form">
      <label class="switch"><input type="checkbox" name="expansion"><span>«Интербеллум»: новые предприятия<small>Колода дополнения, новые стартовые предприятия и промышленники.</small></span></label>
      <label class="switch"><input type="checkbox" name="universities"><span>Университеты и управляющие</span></label>
      <label class="switch"><input type="checkbox" name="capitalists"><span>Промышленники<small>У каждого игрока личная способность.</small></span></label>
      <label class="switch"><input type="checkbox" name="chain"><span>Цепочка</span></label>
      <label class="switch"><input type="checkbox" name="variable"><span>Переменный капитал</span></label>
      <label class="switch"><input type="checkbox" name="isPublic"><span>Открытый стол<small>Виден в списке всем игрокам. Иначе присоединиться можно только по коду.</small></span></label>
      <div class="sheet-actions" style="justify-content:flex-start"><button class="act" type="submit">Создать стол</button></div>
    </form>
    <h3 class="sub">Присоединиться по коду</h3>
    <form id="code-form" class="code-row"><input class="code-input" name="code" placeholder="КОД" maxlength="6" autocomplete="off" required>
      <button class="act ghost" type="submit">Войти за стол</button></form>
    <h3 class="sub">Мои столы</h3>
    <ul class="t-list">${lists.mine.length ? lists.mine.map(t => row(t, 'open')).join('') : '<li class="t-empty">Пока нет.</li>'}</ul>
    <h3 class="sub">Открытые столы</h3>
    <ul class="t-list">${lists.open.length ? lists.open.map(t => row(t, 'join')).join('') : '<li class="t-empty">Сейчас нет открытых столов.</li>'}</ul>
    <div class="sheet-actions"><button class="act ghost" data-close>Закрыть</button></div>`;
  $('#create-form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, on = name => f.elements[name].checked;
    try {
      const v = await api('POST', '/api/tables', {
        isPublic: on('isPublic'),
        options: { expansion: on('expansion'), universities: on('universities'), capitalists: on('capitalists'), chain: on('chain'), variable: on('variable') },
      });
      $('#online').close(); enterTable(v.code);
    } catch (error) { toast(error.message); }
  };
  $('#code-form').onsubmit = async ev => {
    ev.preventDefault();
    const code = String(new FormData(ev.target).get('code') ?? '').trim().toUpperCase();
    $('#online').close(); joinTable(code);
  };
  $('#online-body').querySelectorAll('[data-table]').forEach(b => b.onclick = () => {
    $('#online').close();
    b.dataset.do === 'open' ? enterTable(b.dataset.table) : joinTable(b.dataset.table);
  });
  $('#online').showModal();
}

/* ---------- стол: комната ожидания и партия ---------- */
async function joinTable(code) {
  if (!net.user) { showAuth(() => joinTable(code)); return; }
  try { await api('POST', `/api/tables/${encodeURIComponent(code)}/join`); enterTable(code); }
  catch (error) { toast(error.message); }
}

/** Открывает стол: подписывается на обновления и показывает комнату либо партию. */
async function enterTable(code) {
  code = String(code).toUpperCase();
  if (ui.online && ui.online.code !== code) leaveOnline(false);
  if (!ui.online) ui.online = { code, view: null, playing: false, stash: { record: ui.record, seat: ui.seat }, sawLobby: false };
  try {
    const view = await api('GET', `/api/tables/${code}`);
    applyView(view);
  } catch (error) { toast(error.message); leaveOnline(); return; }
  subscribeTable(code);
}
function subscribeTable(code) {
  net.source?.close();
  const source = new EventSource(`/api/tables/${code}/events`, { withCredentials: true });
  net.source = source;
  source.addEventListener('view', ev => { try { applyView(JSON.parse(ev.data)); } catch { /* повреждённое событие */ } });
  source.onerror = () => { /* EventSource переподключается сам; состояние придёт первым событием */ };
}

function mySeatIn(view) {
  return view.seats.find(s => s.username === net.user?.username)?.seat ?? null;
}

function applyView(view) {
  const o = ui.online;
  if (!o || view.code !== o.code) return;
  if (view.status === 'deleted') { toast('Стол закрыт.'); leaveOnline(); return; }
  const seat = mySeatIn(view);
  if (seat === null) { toast('Вы больше не сидите за этим столом.'); leaveOnline(); return; }
  o.view = view; o.seat = seat;
  if (view.status === 'lobby') { o.sawLobby = true; renderLobby(); if (S()) renderRail(); return; }
  if (!view.state) return;

  const first = !o.playing;
  o.playing = true;
  $('#lobby').open && $('#lobby').close();
  if (!S() || first || view.state.revision > (S().revision ?? -1)) {
    ui.record = { state: view.state }; ui.seat = seat;
    if (first) { ui.disc = null; ui.focus = null; ui.shownResult = false; ui.prevWallets = {}; ui.seenUp = {}; }
    render();
  }
  if (first && o.sawLobby) {
    o.sawLobby = false;
    if (view.state.phase !== 'choosing' && view.state.players.some(p => p.capitalistId)) showDeal(); else maybeHelp();
  }
}

function inviteLink(code) { return `${location.origin}/#t=${code}`; }

function renderLobby() {
  const o = ui.online, v = o.view;
  const iAmHost = v.host === net.user.username;
  const opts = Object.entries({ expansion: '«Интербеллум»', universities: 'университеты', capitalists: 'промышленники', chain: 'цепочка', variable: 'переменный капитал' })
    .filter(([k]) => v.options[k]).map(([, t]) => t);
  const seats = Array.from({ length: 5 }, (_, i) => v.seats.find(s => s.seat === i));
  $('#lobby-body').innerHTML = `<h2>Стол <span class="t-code big">${esc(v.code)}</span></h2>
    <p>Отправьте друзьям код или ссылку. Играть могут от 2 до 5 человек; вдвоём третьим садится агент.</p>
    <div class="link-row"><input readonly value="${escAttr(inviteLink(v.code))}" aria-label="Ссылка на стол"><button class="chip" id="copy-link">Копировать</button></div>
    <ol class="seats">${seats.map((s, i) => `<li class="${s ? 'taken' : ''}"><span class="seat-n">${i + 1}</span>${
      s ? `<b>${esc(s.username)}</b>${s.username === v.host ? ' <span class="cn-state">хозяин</span>' : ''}${s.username === net.user.username ? ' <span class="cn-state up">вы</span>' : ''}` : '<span class="muted">свободно</span>'}</li>`).join('')}</ol>
    <p class="muted">Правила: ${opts.length ? esc(opts.join(', ')) : 'базовая игра'}.${v.isPublic ? ' Стол виден в общем списке.' : ' Стол закрытый: вход по коду.'}</p>
    <div class="sheet-actions">
      <button class="act ghost" id="leave-lobby">Выйти из комнаты</button>
      ${iAmHost ? `<button class="act" id="start-table" ${v.seats.length < 2 ? 'disabled' : ''}>Начать игру</button>` : '<span class="muted">Ждём, когда хозяин начнёт игру…</span>'}
    </div>`;
  $('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(inviteLink(v.code)); toast('Ссылка скопирована.'); }
    catch { $('#lobby-body input').select(); toast('Скопируйте ссылку вручную (Ctrl+C).'); }
  };
  $('#leave-lobby').onclick = async () => {
    try { await api('POST', `/api/tables/${v.code}/leave`); } catch (error) { toast(error.message); }
    leaveOnline(); $('#lobby').close();
  };
  const start = $('#start-table');
  if (start) start.onclick = async () => {
    start.disabled = true;
    try { await api('POST', `/api/tables/${v.code}/start`); } catch (error) { toast(error.message); start.disabled = false; }
  };
  if (!$('#lobby').open) $('#lobby').showModal();
}

/** Выход из онлайн-режима: возвращаем локальную партию, если она была. */
function leaveOnline(restore = true) {
  net.source?.close(); net.source = null;
  const o = ui.online; ui.online = null;
  if ($('#lobby').open) $('#lobby').close();
  if (o && restore) {
    ui.record = o.stash?.record ?? null; ui.seat = o.stash?.seat ?? null;
    ui.disc = null; ui.focus = null;
    if (ui.record) render(); else openSetup();
  }
  if (S()) renderRail();
}

/** Окно с информацией о столе: код, ссылка и возврат к игре на одном устройстве. */
function showTableInfo() {
  const o = ui.online; if (!o) return;
  if (o.view?.status === 'lobby') { renderLobby(); return; }
  $('#invite-body').innerHTML = `<h2>Стол ${esc(o.code)}</h2>
    <p>Вы играете по сети как <b>${esc(net.user?.username ?? '')}</b>. Партия сохраняется на сервере: если закрыть страницу, вернуться можно через «Онлайн» → «Мои столы».</p>
    <div class="link-row"><input readonly value="${escAttr(inviteLink(o.code))}" aria-label="Ссылка на стол"></div>
    <div class="sheet-actions"><button class="act ghost" data-close>Закрыть</button><button class="act" id="leave-online">К игре на одном устройстве</button></div>`;
  $('#leave-online').onclick = () => { $('#invite').close(); leaveOnline(); };
  $('#invite').showModal();
}

/** Ход в онлайн-партии: сервер проверяет всё сам, клиент показывает то, что он вернул. */
async function actOnline(command, quiet) {
  const o = ui.online;
  if (o.busy) return;
  o.busy = true;
  try {
    const r = await api('POST', `/api/tables/${o.code}/command`, { command: { ...command, expectedRevision: S().revision } });
    ui.times = 1;
    if (command.type !== 'ArrangeCards') ui.focus = null;
    if (r.state.revision > (S()?.revision ?? -1)) ui.record.state = r.state;
    render();
  } catch (error) {
    if (!quiet) toast(error.message);
    if (error.status === 409 || error.status === 422) {
      try { applyView(await api('GET', `/api/tables/${o.code}`)); } catch { /* сеть */ }
    }
    render();
  } finally { o.busy = false; }
}

/* ---------- запуск ---------- */
function bindOnline() {
  $('#auth-form').addEventListener('submit', submitAuth);
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.authTab)));
  document.addEventListener('click', ev => {
    const open = ev.target.closest('[data-open]')?.dataset.open;
    if (open === 'login') showAuth();
    if (open === 'online') showOnline();
    if (open === 'account') showAccount();
    if (open === 'invite') showTableInfo();
  });
}

async function initOnline() {
  bindOnline();
  await initNet();
  // Ссылка-приглашение: https://хост/#t=КОД
  const m = /^#t=([A-Za-z2-9]{6})$/.exec(location.hash);
  if (m && net.server) {
    history.replaceState(null, '', location.pathname);
    if (net.user) joinTable(m[1].toUpperCase()); else showAuth(() => joinTable(m[1].toUpperCase()), 'register');
  }
}

boot();
