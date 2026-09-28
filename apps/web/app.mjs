import { GameSession } from '/packages/application/session.mjs';
import { localStorageAdapter } from '/packages/adapters/local-storage.mjs';
import { trainingPack } from '/packages/content/training.mjs';
import { currentActor, bidError, activeEffect } from '/packages/domain/engine.mjs';
import { canPay } from '/packages/domain/rules.mjs';
import { DecisionClock, decisionKey } from '/packages/application/decision-clock.mjs';

const defs = trainingPack.definitions, app = document.querySelector('#app');
const labels = { coal: 'уголь', metal: 'металл', oil: 'нефть', upgrade: 'модернизация', money: 'монеты' };
const symbols = { coal: '■', metal: '▰', oil: '●', upgrade: '⚙', money: '₽' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let selectedDisc = null, variableValue = 0, error = '';
const clock = new DecisionClock();
const session = new GameSession(trainingPack, {
  load: () => localStorageAdapter(window.localStorage).load(),
  save: record => localStorageAdapter(window.localStorage).save(record),
});
try { session.load(); }
catch (e) { error = e.message; }

function bundle(values) {
  const parts = Object.entries(values).filter(([, v]) => v > 0);
  return parts.length ? parts.map(([k, v]) => `<span class="resource ${k}" role="img" aria-label="${v} ${labels[k]}" title="${labels[k]}"><span aria-hidden="true">${symbols[k]}</span> ${v} <span class="unit">${labels[k]}</span></span>`).join(' ') : '—';
}
function effectText(e) {
  if (e.kind === 'upgrade') return `${bundle({ upgrade: 1, coal: 1 })} <span class="arrow">→</span> улучшить предприятие`;
  if (e.kind === 'gain') return bundle(e.gain);
  return `${bundle(e.cost)} <span class="arrow">→</span> ${bundle(e.gain)}${e.limit ? `<span class="limit">до ${e.limit} раз</span>` : ''}`;
}
function factory(tone = 'coal') {
  return `<div class="factory ${tone}" aria-hidden="true"><svg viewBox="0 0 260 100"><path class="skyline" d="M0 87H260M13 85V67L38 56V83M211 85V57H245V85"/><path class="building" d="M49 88V48L81 61V41L121 58V39L168 58V88ZM173 88V16H184L189 88ZM197 88V31H206L210 88Z"/><path class="window" d="M58 72H69M82 72H94M107 72H119M132 72H144M156 72H166"/><path class="smoke" d="M178 10C168 1 189 0 185 -8M202 24C219 16 196 7 210 0"/></svg></div>`;
}
function cardHtml(card, { lot = null, owner = null } = {}) {
  const s = session.state, d = defs[card.definitionId], used = owner && card.usedRound === s.round;
  const active = s.production?.active?.cardId === card.id;
  const current = s.players.find(p => p.id === currentActor(s));
  let action = '';
  if (lot && s.phase === 'auction') {
    const reason = selectedDisc ? bidError(s, current.id, selectedDisc, lot.id, variableValue) : 'Выберите диск капитала.';
    action = `<button class="bid-button" data-action="bid" data-id="${lot.id}" ${reason ? 'disabled' : ''}>${reason ? 'Недоступно' : 'Сделать ставку'}</button><span class="reason">${escape(reason ?? 'Выберите предприятие для ставки')}</span>`;
  } else if (owner && s.phase === 'production' && owner.id === currentActor(s)) {
    const waiting = s.config.productionChain && owner.cards.find(c => c.usedRound !== s.round)?.id !== card.id;
    action = `<button class="bid-button" data-action="use" data-id="${card.id}" ${used || s.production.active || waiting ? 'disabled' : ''}>${used ? 'Использовано' : active ? 'В работе' : waiting ? 'Ждёт своей очереди' : 'Использовать'}</button>`;
  }
  const bids = lot?.bids.map(b => `<span class="small-disc player-${b.playerId.slice(1)}" title="${escape(s.players.find(p => p.id === b.playerId).name)}">${b.kind === 'variable' ? '● ' : ''}${b.value}</span>`).join('') ?? '';
  return `<article class="company ${used ? 'used' : ''} ${active ? 'active-card' : ''} ${lot?.resolved ? 'resolved' : ''}"><div class="card-top"><span>${lot ? `ЛОТ ${s.lots.indexOf(lot) + 1}` : card.upgraded ? 'МОДЕРНИЗИРОВАНО' : d.kind === 'startup' ? 'СТАРТОВОЕ' : 'ПРЕДПРИЯТИЕ'}</span><span>${lot?.resolved ? '✓' : 'УЧЕБНАЯ'}</span></div><div class="compensation"><small>${lot ? 'Компенсация' : 'Уровень'}</small>${lot ? effectText(d.compensation) : card.upgraded ? 'II' : 'I'}</div>${factory(d.tone)}<h3>${escape(d.name)}</h3><div class="effects">${d.effects.map(e => `<div>${effectText(e)}</div>`).join('')}${d.advanced?.length ? `<div class="advanced ${card.upgraded ? 'enabled' : ''}"><small>${card.upgraded ? 'Активно' : 'После модернизации'}</small>${d.advanced.map(effectText).join('<br>')}</div>` : ''}</div>${lot ? `<div class="bids">${bids || '<span class="muted">Ставок пока нет</span>'}</div>` : ''}${action}</article>`;
}
function actorPanel() {
  const s = session.state;
  if (s.phase === 'finished') return `<div class="control-panel"><h2>Партия завершена</h2><p>Итог — деньги, затем предприятия и оставшиеся ресурсы.</p></div>`;
  const p = s.players.find(p => p.id === currentActor(s));
  let controls = '';
  if (s.phase === 'auction') {
    if (!p.discs.some(d => d.id === selectedDisc && !d.used)) selectedDisc = p.discs.find(d => !d.used)?.id;
    controls = `<p>Выберите диск, затем предприятие.</p><div class="discs">${p.discs.map(d => `<button class="disc ${selectedDisc === d.id ? 'selected' : ''}" data-action="disc" data-id="${d.id}" ${d.used ? 'disabled' : ''} aria-pressed="${selectedDisc === d.id}" aria-label="${d.kind === 'variable' ? 'Переменный диск' : `Диск ${d.value}`}">${d.kind === 'variable' ? '?' : d.value}</button>`).join('')}</div>${selectedDisc === 'variable' ? `<label class="variable-label">Уголь на ставку<input type="number" id="variable-value" min="0" max="${p.wallet.coal}" step="1" value="${variableValue}"></label><small>Можно поставить 0. Потраченный уголь сразу уйдёт в резерв.</small>` : ''}`;
  } else if (s.phase === 'settlement') {
    const pending = s.settlement.pending;
    controls = pending ? `<h3>Выберите компенсацию</h3><p>${effectText(pending.effect)}</p><label>Количество операций<input id="compensation-times" type="number" min="0" max="${pending.limit}" value="0" step="1"></label><p class="muted">До ${pending.limit} раз. Ноль означает отказ от переработки.</p><button class="primary" data-action="compensate">Подтвердить</button>` : `<h3>Итоги аукциона</h3><p>Следующий лот: ${s.settlement.index + 1}. Сначала компенсации, затем предприятие победителю.</p><button class="primary" data-action="resolve">Разыграть лот ${s.settlement.index + 1}</button>`;
  } else if (s.phase === 'planning') {
    controls = `<h3>Постройте производственную линию</h3><p>${s.config.productionChain ? 'Вставьте новые предприятия в цепочку. Порядок старых карт сохраняется между раундами.' : 'Разложите предприятия в удобном порядке. В обычном режиме этот план можно менять каждый раунд; при производстве доступен свободный выбор карты.'}</p><p class="muted">Сопоставьте выход ресурсов одной карты со стоимостью следующей. Кнопки ← и → меняют позицию карты.</p><button class="primary" data-action="confirm-plan">План готов</button>`;
  } else {
    const a = s.production.active, e = activeEffect(s, defs);
    if (a) {
      controls = `<h3>${escape(defs[p.cards.find(c => c.id === a.cardId).definitionId].name)}</h3><p>${effectText(e)}</p>`;
      if (e.kind === 'convert') controls += `<p class="muted">Выполнено ${a.used} из ${e.limit} операций.</p><button class="primary" data-action="convert" ${a.used >= e.limit || !canPay(p.wallet, e.cost) ? 'disabled' : ''}>Выполнить один раз</button>`;
      if (e.kind === 'upgrade') {
        const choices = p.cards.filter(c => !c.upgraded && defs[c.definitionId].kind === 'company');
        controls += choices.length ? `<div class="upgrade-list">${choices.map(c => `<button class="outline" data-action="upgrade" data-id="${c.id}" ${canPay(p.wallet, { coal: 1, upgrade: 1 }) ? '' : 'disabled'}>${escape(defs[c.definitionId].name)} <small>${c.usedRound === s.round ? 'уже использовано' : 'ещё не использовано'}</small></button>`).join('')}</div>` : '<p class="muted">Нет предприятий для модернизации.</p>';
      }
      controls += '<button class="outline next-effect" data-action="next">К следующему эффекту →</button>';
    } else {
      const remaining = p.cards.filter(c => c.usedRound !== s.round).length;
      controls = remaining ? `<p>${s.config.productionChain ? 'Используйте следующее предприятие в цепочке.' : 'Выберите предприятие.'} Осталось использовать: ${remaining}.</p><p class="muted">Эффекты каждой карты применяются сверху вниз. Добыча начисляется автоматически.</p>` : '<p>Все предприятия использованы.</p><button class="primary" data-action="finish">Завершить производство</button>';
    }
  }
  return `<section class="control-panel"><span class="eyebrow">${s.phase === 'settlement' ? 'РЕШЕНИЕ' : 'СЕЙЧАС ДЕЙСТВУЕТ'}</span><h2><span class="player-dot player-${p.id.slice(1)}"></span>${escape(p.name)}</h2><div id="decision-timer" class="decision-timer" hidden><span>Осталось <strong id="timer-value" role="timer" aria-live="off"></strong></span><small id="timer-expired" role="status"></small></div><div class="wallet">${bundle(p.wallet)}</div>${controls}</section>`;
}
function eventText(e) {
  const name = session.state.players.find(p => p.id === e.playerId)?.name ?? '';
  switch (e.type) {
    case 'GameStarted': return 'Учебная партия началась';
    case 'AuctionStarted': return `Раунд ${e.round}: ${e.count} предприятий на аукционе`;
    case 'BidPlaced': return `${name}: ставка ${e.value}${e.discKind === 'variable' ? ' за уголь' : ''}, лот ${Number(e.lotId.split('l')[1]) + 1}`;
    case 'AuctionClosed': return 'Все ставки сделаны';
    case 'Compensation': return `${name}: компенсация ×${e.times}`;
    case 'CompensationChosen': return `${name}: ${e.times} операций компенсации`;
    case 'CardWon': return `${name}: получает «${defs[e.definitionId].name}»`;
    case 'CardDiscarded': return 'Предприятие без ставок сброшено';
    case 'ProductionStarted': return 'Началось производство';
    case 'PlanningStarted': return 'Планирование производственной линии';
    case 'CardsArranged': return `${name}: изменён порядок предприятий`;
    case 'PlanConfirmed': return `${name}: план подтверждён`;
    case 'CardStarted': return `${name}: начинает предприятие`;
    case 'ResourceGained': return `${name}: добыча — ${Object.entries(e.gain).map(([k,v])=>`${v} ${labels[k]}`).join(', ')}`;
    case 'ConversionPerformed': return `${name}: ${Object.entries(e.cost).map(([k,v])=>`${v} ${labels[k]}`).join(', ')} → ${Object.entries(e.gain).map(([k,v])=>`${v} ${labels[k]}`).join(', ')}`;
    case 'CardCompleted': return `${name}: предприятие завершено`;
    case 'CardUpgraded': return `${name}: модернизация за 1 уголь и 1 жетон`;
    case 'GameFinished': return 'Четыре раунда завершены';
    default: return e.type;
  }
}
function render() {
  const s = session.state;
  if (!s) { app.innerHTML = `<section class="empty"><h1>${error ? 'Сохранение не загружено' : 'Ваш промышленный стол'}</h1><p>${escape(error || 'Нажмите «Новая партия», выберите порядок производства и настройте таймер.')}</p>${error ? '<p>Исходное сохранение оставлено без изменений.</p>' : ''}</section>`; return; }
  const control = actorPanel(); // selects the available disc before rendering auction cards
  const phaseName = { auction: 'Аукцион предприятий', settlement: 'Подведение итогов', planning: 'Планирование линии', production: 'Время производства', finished: 'Итоги партии' }[s.phase];
  let surface;
  if (s.phase === 'auction' || s.phase === 'settlement') surface = `<div class="card-grid">${s.lots.map(lot => cardHtml(lot.card, { lot })).join('')}</div>`;
  else if (s.phase === 'production' || s.phase === 'planning') {
    const p = s.players.find(p => p.id === currentActor(s));
    const pipeline = s.phase === 'planning' || s.config.productionChain;
    surface = `${pipeline ? `<p class="pipeline-hint">${s.config.productionChain ? 'Цепочка: производство слева направо' : 'План производства: свободный порядок'} · Прокручивайте линию горизонтально</p>` : ''}<div class="${pipeline ? 'pipeline' : 'card-grid'}" ${pipeline ? 'tabindex="0" aria-label="Производственная линия"' : ''}>${p.cards.map((card, index) => {
      const movable = !s.config.productionChain || !p.lockedOrder.includes(card.id);
      const planning = s.phase === 'planning';
      return pipeline ? `<section class="pipeline-step"><div class="pipeline-position"><strong>${index + 1} →</strong><span>${planning && !p.lockedOrder.includes(card.id) ? 'НОВОЕ' : 'В ЛИНИИ'}</span></div>${cardHtml(card, { owner: p })}${planning ? `<div class="pipeline-moves"><button class="outline" data-action="move-left" data-id="${card.id}" aria-label="Карта ${index + 1}: влево" ${!movable || index === 0 ? 'disabled' : ''}>← Влево</button><button class="outline" data-action="move-right" data-id="${card.id}" aria-label="Карта ${index + 1}: вправо" ${!movable || index === p.cards.length - 1 ? 'disabled' : ''}>Вправо →</button></div>` : ''}</section>` : cardHtml(card, { owner: p });
    }).join('')}</div>`;
  } else surface = `<div class="results">${s.result.map((r,i) => `<article><span class="eyebrow">${r.winner ? 'ПОБЕДИТЕЛЬ' : `МЕСТО ${i + 1}`}</span><h2>${escape(r.name)}</h2><strong>${r.money} ₽</strong><p>${r.companies} предприятий · ${r.resources} ресурсов</p></article>`).join('')}</div>`;
  app.innerHTML = `<div class="table-heading"><div><span class="eyebrow">${s.config.variableCapital ? 'БАЗОВЫЕ МЕХАНИКИ + ПЕРЕМЕННЫЙ КАПИТАЛ' : 'БАЗОВЫЕ МЕХАНИКИ'}</span><h1>${phaseName}</h1></div><div class="rounds" aria-label="Раунд ${s.round} из 4">${[1,2,3,4].map(n => `<span class="${n === s.round ? 'current' : n < s.round ? 'past' : ''}">${n}</span>`).join('')}<small>РАУНД</small></div></div><section class="players" aria-label="Игроки">${s.players.map(p => `<article class="player-summary ${p.id === currentActor(s) ? 'current-player' : ''}"><h3><span class="player-dot player-${p.id.slice(1)}"></span>${escape(p.name)} ${s.players[s.firstPlayer].id === p.id ? '<small>первый</small>' : ''}</h3><strong>${p.wallet.money} <small>монет</small></strong><div>${bundle(Object.fromEntries(Object.entries(p.wallet).filter(([k])=>k!=='money')))}</div><small>${p.cards.length} предприятий</small></article>`).join('')}</section><div class="workspace"><section class="play-surface" aria-label="Игровое поле">${surface}</section><aside>${control}<details class="help"><summary>Как играть на этом столе</summary><p>Сделайте ставки всеми дисками. Самый большой диск забирает предприятие; остальные дают компенсацию.</p><p>Разыграйте лоты слева направо. Затем используйте каждое предприятие: добыча обязательна, переработку можно пропустить.</p><p>Контора позволяет модернизировать предприятие за 1 уголь и 1 жетон. Улучшение не возвращает уже использованную карту в работу.</p><p>Игра заканчивается после четвёртого раунда. Все игроки управляются вручную. Сохранение — только на этом устройстве.</p></details><details class="journal" open><summary>Журнал действий</summary><ol reversed>${s.events.slice(-12).reverse().map(e => `<li><small>${String(e.seq).padStart(2,'0')}</small>${escape(eventText(e))}</li>`).join('')}</ol></details></aside></div><footer>Учебный набор v0.1 · Оригинальные карты ещё не подключены · ${session.storageError ? 'Сохранение недоступно' : 'Автосохранение на устройстве'}</footer>`;
  const notice = document.querySelector('#notice'); notice.textContent = error || session.storageError || ''; notice.classList.toggle('visible', !!notice.textContent);
  syncClock();
}
function syncClock() {
  const key = decisionKey(session.state);
  const value = clock.sync(key, session.state.config.turnSeconds, session.record.clock);
  if (JSON.stringify(value) !== JSON.stringify(session.record.clock ?? null)) { session.record.clock = value; session.persist(); }
  drawClock();
}
function drawClock() {
  const element = document.querySelector('#decision-timer'), remaining = clock.remaining();
  if (!element) return;
  element.hidden = remaining === null;
  if (remaining === null) return;
  document.querySelector('#timer-value').textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  element.classList.toggle('expired', remaining === 0);
  const status = document.querySelector('#timer-expired'), text = remaining === 0 ? 'Время вышло. Завершите решение; штрафа и автоматического хода нет.' : '';
  if (status.textContent !== text) status.textContent = text;
}
setInterval(drawClock, 250);
function send(type, payload = {}) {
  try { session.send({ type, actorId: currentActor(session.state), ...payload }); error = ''; selectedDisc = null; variableValue = 0; }
  catch (e) { error = e.message; }
  render();
}
app.addEventListener('click', e => {
  const button = e.target.closest('button[data-action]'); if (!button || button.disabled) return;
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'disc': selectedDisc = id; error = ''; render(); break;
    case 'bid': send('Bid', { lotId: id, discId: selectedDisc, value: selectedDisc === 'variable' ? Number(document.querySelector('#variable-value').value) : variableValue }); break;
    case 'resolve': send('ResolveLot'); break;
    case 'compensate': send('Compensate', { times: Number(document.querySelector('#compensation-times').value) }); break;
    case 'use': send('UseCard', { cardId: id }); break;
    case 'convert': send('Convert', { times: 1 }); break;
    case 'upgrade': send('Upgrade', { cardId: id }); break;
    case 'next': send('NextEffect'); break;
    case 'finish': send('FinishProduction'); break;
    case 'confirm-plan': send('ConfirmPlan'); break;
    case 'move-left':
    case 'move-right': {
      const p = session.state.players.find(p => p.id === currentActor(session.state));
      const ids = p.cards.map(c => c.id), from = ids.indexOf(id), to = from + (button.dataset.action === 'move-left' ? -1 : 1);
      if (from >= 0 && to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to], ids[from]]; send('ArrangeCards', { cardIds: ids }); }
      break;
    }
  }
});
app.addEventListener('input', e => {
  if (e.target.id !== 'variable-value') return;
  variableValue = e.target.value === '' ? NaN : Number(e.target.value);
  // Keep the focused input alive; update only the legal targets as the amount changes.
  for (const button of app.querySelectorAll('button[data-action="bid"]')) {
    const reason = bidError(session.state, currentActor(session.state), selectedDisc, button.dataset.id, variableValue);
    button.disabled = !!reason;
    button.textContent = reason ? 'Недоступно' : 'Сделать ставку';
    button.nextElementSibling.textContent = reason ?? 'Выберите предприятие для ставки';
  }
});
const setup = document.querySelector('#setup');
document.querySelector('#new-game').addEventListener('click', () => setup.showModal());
document.querySelector('#cancel-setup').addEventListener('click', () => setup.close());
document.querySelector('#timer-mode').addEventListener('change', e => {
  document.querySelector('#turn-seconds').disabled = e.target.value === 'off';
});
document.querySelector('#setup-form').addEventListener('submit', e => {
  e.preventDefault(); const count = Number(document.querySelector('#player-count').value);
  try {
    session.start({ names: Array.from({ length: count }, (_, i) => `Игрок ${i + 1}`), seed: crypto.getRandomValues(new Uint32Array(1))[0], variableCapital: document.querySelector('#variable').checked,
      planning: true, productionChain: document.querySelector('#production-mode').value === 'chain', turnSeconds: document.querySelector('#timer-mode').value === 'off' ? 0 : Number(document.querySelector('#turn-seconds').value) });
    clock.sync(null, 0); error = ''; selectedDisc = null; variableValue = 0; setup.close(); render();
  } catch (err) { document.querySelector('#setup-error').textContent = err.message; }
});
render();
if (!session.state && !error) setup.showModal();
