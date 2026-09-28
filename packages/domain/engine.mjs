import { requireRule, emptyWallet, validateWallet, integer, canPay, transfer, shuffle, rankPlayers, classifyConversion, clone } from './rules.mjs';
import { ABILITIES, has, compensationUnits, upgradeCost, extraDisc, ignoresBidLimits, pickWinner } from './capitalists.mjs';
import { isAgent, rollD6, chooseBid } from './agent.mjs';

export const RULES_VERSION = 'prototype-0.3';
function definition(definitions, id) {
  requireRule(Object.hasOwn(definitions, id), 'UNKNOWN_CARD', 'Неизвестная карта.');
  return definitions[id];
}
function validateEffect(e, compensation = false) {
  if (e && e.kind === 'supply') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Компенсация не может быть поставкой.');
    requireRule(e.of && ['gain', 'convert'].includes(e.of.kind), 'UNSUPPORTED_EFFECT', 'Поставка оборачивает добычу или переработку.');
    validateEffect(e.of);
    return;
  }
  requireRule(e && ['gain', 'convert', 'upgrade'].includes(e.kind), 'UNSUPPORTED_EFFECT', 'Эффект ещё не поддерживается.');
  if (e.kind === 'upgrade') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Модернизация не может быть этой компенсацией.');
    return;
  }
  validateWallet(e.gain);
  if (e.kind === 'convert') {
    validateWallet(e.cost);
    requireRule(Object.values(e.cost).some(v => v > 0), 'INVALID_EFFECT', 'Обмен должен иметь стоимость.');
    requireRule(compensation || integer(e.limit, 1), 'INVALID_EFFECT', 'Не задан лимит обмена.');
  }
}
function event(s, type, data = {}) { s.events.push({ seq: s.events.length + 1, round: s.round, type, ...data }); }
function player(s, id) {
  const p = s.players.find(p => p.id === id);
  requireRule(p, 'UNKNOWN_PLAYER', 'Игрок не найден.'); return p;
}
function owned(p, id) {
  const card = p.cards.find(c => c.id === id);
  requireRule(card, 'UNKNOWN_CARD', 'У игрока нет этой карты.'); return card;
}
function phase(s, name) { requireRule(s.phase === name, 'WRONG_PHASE', 'Это действие недоступно в текущей фазе.'); }
function actor(s, id) { requireRule(currentActor(s) === id, 'NOT_YOUR_TURN', 'Сейчас действует другой игрок.'); }

export function createGame({ names = ['Игрок 1', 'Игрок 2', 'Игрок 3'], variableCapital = false, seed = 2026, planning = true, productionChain = false, turnSeconds = 0, capitalists = false, pairedExtraDisc = false, universities = false } = {}, pack) {
  requireRule(Array.isArray(names) && [2, 3, 4].includes(names.length), 'UNSUPPORTED_CONFIG', 'Поддерживаются 2, 3 или 4 игрока.');
  requireRule(names.every(n => typeof n === 'string' && n.trim().length > 0 && n.length <= 40), 'INVALID_NAME', 'Имя должно содержать от 1 до 40 символов.');
  requireRule(typeof variableCapital === 'boolean' && integer(seed) && seed <= 0xffffffff, 'INVALID_CONFIG', 'Некорректная настройка партии.');
  requireRule(typeof planning === 'boolean' && typeof productionChain === 'boolean' && (!productionChain || planning), 'INVALID_CONFIG', 'Цепочка требует планирования.');
  requireRule(integer(turnSeconds) && turnSeconds <= 3600, 'INVALID_CONFIG', 'Таймер: 0 (выключен) или 1–3600 секунд.');
  requireRule(typeof capitalists === 'boolean', 'INVALID_CONFIG', 'Промышленники включаются или выключаются.');
  requireRule(typeof pairedExtraDisc === 'boolean', 'INVALID_CONFIG', 'Парная двойка включается или выключается.');
  requireRule(typeof universities === 'boolean', 'INVALID_CONFIG', 'Университеты включаются или выключаются.');
  requireRule(pack && typeof pack.version === 'string' && Array.isArray(pack.deck), 'INVALID_PACK', 'Не указан контент-пакет.');
  for (const d of Object.values(pack.definitions)) {
    requireRule(['company', 'startup'].includes(d.kind), 'INVALID_PACK', 'Неизвестный тип карты.');
    requireRule(Array.isArray(d.effects) && d.effects.length > 0, 'INVALID_PACK', 'У карты нет эффектов.');
    d.effects.forEach(e => validateEffect(e));
    (d.advanced ?? []).forEach(e => validateEffect(e));
    if (d.kind === 'company') validateEffect(d.compensation, true);
  }
  // Каждому своё стартовое предприятие, если пакет их даёт; иначе одно общее.
  let rng = seed >>> 0;
  const humans = names.length;
  const withAgent = humans === 2;   // B16: вдвоём третьим участником садится агент базы
  const lotsPerRound = humans + 4 + Number(variableCapital);
  let startIds = names.map(() => pack.startupId);
  if (Array.isArray(pack.startupIds) && pack.startupIds.length >= names.length) {
    const roll = shuffle(pack.startupIds, rng); rng = roll.seed;
    startIds = roll.items.slice(0, names.length);
  }
  const starts = startIds.map(id => {
    const card = definition(pack.definitions, id);
    requireRule(card.kind === 'startup', 'INVALID_PACK', 'Стартовая карта должна быть стартовым предприятием.');
    validateWallet(card.starting);
    return card;
  });
  let abilities = names.map(() => null);
  if (capitalists) {
    requireRule(Array.isArray(pack.capitalists) && pack.capitalists.length >= names.length,
      'INVALID_PACK', 'В пакете нет промышленников на всех игроков.');
    pack.capitalists.forEach(c => requireRule(ABILITIES.includes(c.ability), 'INVALID_PACK', 'Неизвестная способность промышленника.'));
    const roll = shuffle(pack.capitalists, rng); rng = roll.seed;
    abilities = roll.items.slice(0, names.length);
  }
  // Университеты: на 1–3 игроков две случайные карты, на 4–5 — все три (правила дополнения, стр. 6).
  let tables = [], managerDeck = [], managerDefs = {};
  if (universities) {
    requireRule(Array.isArray(pack.universities) && pack.universities.length >= 3,
      'INVALID_PACK', 'В пакете нет карт университетов.');
    requireRule(Array.isArray(pack.managers) && pack.managers.length > 0,
      'INVALID_PACK', 'В пакете нет жетонов управляющих.');
    const pick = shuffle(pack.universities, rng); rng = pick.seed;
    const count = humans >= 4 ? 3 : 2;
    tables = pick.items.slice(0, count).map(card => {
      const side = shuffle(card.sides, rng); rng = side.seed;
      const face = side.items[0];
      face.options.forEach(e => validateEffect(e, true));
      return { id: card.id, sideId: face.id, options: face.options };
    });
    const deck = shuffle(pack.managers.map(m => m.id), rng); rng = deck.seed;
    managerDeck = deck.items;
    managerDefs = Object.fromEntries(pack.managers.map(m => [m.id, m.effect]));
    requireRule(managerDeck.length >= tables.length * 4, 'SHORT_MANAGERS',
      'Жетонов управляющих не хватит на четыре раунда.');
  }
  // Колода должна закрыть хотя бы первый раунд. Если на четыре раунда её не хватает,
  // невыкупленные лоты возвращаются в колоду — это временная мера для неполного каталога.
  requireRule(pack.deck.length >= lotsPerRound, 'SHORT_DECK', 'Недостаточно карт даже на один раунд.');
  pack.deck.forEach(id => requireRule(definition(pack.definitions, id).kind === 'company', 'INVALID_PACK', 'В колоде должна быть карта предприятия.'));
  const s = { schemaVersion: 1, rulesVersion: RULES_VERSION, contentVersion: pack.version,
    revision: 0, config: { variableCapital, planning, productionChain, turnSeconds, capitalists, pairedExtraDisc, universities, deckCoversGame: pack.deck.length >= lotsPerRound * 4 },
    rng, round: 1, firstPlayer: 0, turn: 0,
    phase: 'auction', deck: pack.deck.map((definitionId, i) => ({ id: `c${i}`, definitionId, upgraded: false, usedRound: 0 })),
    players: names.map((name, i) => ({ id: `p${i}`, name: name.trim(), seat: i,
      ability: abilities[i]?.ability ?? null, capitalistId: abilities[i]?.id ?? null,
      wallet: { ...emptyWallet(), ...starts[i].starting, coal: (starts[i].starting.coal ?? 0) + Number(variableCapital) },
      cards: [{ id: `start${i}`, definitionId: startIds[i], upgraded: false, usedRound: 0 }],
      discs: [], managers: [], blocked: false, done: false, repeated: false })),
    lots: [], discard: [], settlement: null, production: null, pendingPair: null,
    tables, managerDeck, managerDefs, managerDiscard: [], supplies: [], events: [] };
  if (withAgent) s.players.push({ id: 'agent', name: 'Агент', agent: true, seat: s.players.length, ability: null, capitalistId: null,
    wallet: emptyWallet(), cards: [], discs: [], managers: [], blocked: false, done: false, repeated: false, lockedOrder: [], planned: false });
  s.config.agent = withAgent;
  event(s, 'GameStarted', withAgent ? { agent: true } : {}); startAuction(s); return s;
}
function startAuction(s) {
  // Агент не увеличивает число лотов: вдвоём их шесть (B03).
  const humans = s.players.filter(p => !isAgent(p)).length;
  const count = humans + 4 + Number(s.config.variableCapital);
  if (s.deck.length < count && s.discard.length) {
    // Каталог короче базовой коробки, поэтому невыкупленные лоты возвращаются в колоду.
    const back = shuffle(s.discard, s.rng); s.rng = back.seed;
    s.deck = [...s.deck, ...back.items]; s.discard = [];
    event(s, 'DeckRefilled');
  }
  const shuffled = shuffle(s.deck, s.rng); s.deck = shuffled.items; s.rng = shuffled.seed;
  s.lots = s.deck.splice(0, Math.min(count, s.deck.length))
    .map((card, i) => ({ id: `r${s.round}l${i}`, kind: 'company', card, bids: [], resolved: false }));
  // Университеты лежат в самом конце ряда и разбираются последними (правила дополнения, стр. 7).
  s.tables.forEach((table, i) => {
    const token = s.managerDeck.shift() ?? null;
    s.lots.push({ id: `r${s.round}u${i}`, kind: 'university', table, token, bids: [], resolved: false });
  });
  for (const p of s.players) {
    p.lockedOrder = p.cards.map(c => c.id); p.planned = false;
    // Конец раунда: игрок забирает жетоны со своих карт, сами жетоны остаются у него.
    p.cards.forEach(c => { c.manager = null; c.local = null; });
    p.discs = [1, 2, 3, 4].map(value => ({ id: `fixed${value}`, kind: 'fixed', value, used: false }));
    const extra = extraDisc(p);
    if (extra) p.discs.push({ ...extra });
    if (s.config.variableCapital) p.discs.push({ id: 'variable', kind: 'variable', value: 0, used: false });
    p.blocked = false; p.repeated = false;
    // Агент не строит экономику (B17): фазы плана и производства он пропускает.
    p.done = isAgent(p); p.planned = isAgent(p);
  }
  s.phase = 'auction'; s.turn = s.firstPlayer; s.settlement = null; s.production = null; s.pendingPair = null;
  event(s, 'AuctionStarted', { count: s.lots.length });
}
export function currentActor(s) {
  if (s.phase === 'finished') return null;
  if (s.phase === 'settlement') return s.settlement.pending?.playerId ?? s.players[s.firstPlayer].id;
  return s.players[s.turn].id;
}
export function bidError(s, playerId, discId, lotId, value) {
  if (s.phase !== 'auction') return 'Аукцион уже завершён.';
  if (currentActor(s) !== playerId) return 'Ход другого игрока.';
  const p = s.players.find(p => p.id === playerId), lot = s.lots.find(l => l.id === lotId);
  if (!p || !lot) return 'Неизвестный игрок или лот.';
  return bidLegality(s, p, p.discs.find(d => d.id === discId), lot, value);
}
// Легальность самой ставки, без вопроса «чья очередь».
// Разделение обязательно: проверка «остались ли ходы у соперника» идёт вне его очереди.
function bidLegality(s, p, d, lot, value) {
  if (!d || d.used || p.blocked) return 'Диск недоступен.';
  const pair = s.pendingPair;
  if (pair && pair.playerId === p.id) {
    if (!d.bonus) return 'Сначала выставьте дополнительную двойку.';
    if (lot.id === pair.lotId) return 'Дополнительная двойка идёт на другое предприятие.';
  } else if (d.bonus && s.config.pairedExtraDisc) {
    return 'Дополнительную двойку ставят вместе с обычной ставкой.';
  }
  const v = d.kind === 'fixed' ? d.value : value;
  if (!integer(v)) return 'Значение должно быть целым и неотрицательным.';
  if (d.kind === 'variable' && v > p.wallet.coal) return 'Не хватает угля для этой ставки.';
  const free = ignoresBidLimits(p);
  if (!free && lot.bids.some(b => b.playerId === p.id)) return 'На предприятии уже есть ваш диск.';
  if (free && lot.bids.some(b => b.playerId === p.id && b.discId === d.id)) return 'Этот диск уже здесь.';
  if (!free && lot.bids.some(b => b.value === v)) return 'Такое значение уже стоит на предприятии.';
  return null;
}
function canBidAnywhere(s, p) {
  if (p.blocked) return false;
  return p.discs.some(d => {
    // Бонусный диск сам по себе ход не даёт только в режиме парной ставки.
    if (d.used || (d.bonus && s.config.pairedExtraDisc)) return false;
    return s.lots.some(l => {
      if (d.kind === 'fixed') return !bidLegality(s, p, d, l, d.value);
      // At most N opponents forbid N values: checking 0..N is sufficient, even for huge coal stocks.
      for (let v = 0; v <= Math.min(p.wallet.coal, l.bids.length); v++)
        if (!bidLegality(s, p, d, l, v)) return true;
      return false;
    });
  });
}
/**
 * Очередь ставок. Люди идут по кругу от первого игрока, агент ВСЕГДА последний:
 * правила базы, стр.6 — «в каждом круге аукциона агент кладёт диск третьим».
 */
function auctionOrder(s) {
  const humans = [], agents = [];
  s.players.forEach((p, i) => (isAgent(p) ? agents : humans).push(i));
  const start = Math.max(0, humans.indexOf(s.firstPlayer));
  return [...humans.slice(start), ...humans.slice(0, start), ...agents];
}
function advanceBid(s) {
  if (s.pendingPair) return;
  const order = auctionOrder(s);
  // Цикл, а не рекурсия: после хода агента очередь идёт дальше в том же проходе.
  for (let guard = 0; guard <= order.length * 6; guard++) {
    let moved = false;
    let pos = order.indexOf(s.turn);
    for (let step = 1; step <= order.length; step++) {
      const next = order[(pos + step) % order.length], p = s.players[next];
      if (canBidAnywhere(s, p)) { s.turn = next; moved = true; break; }
      p.blocked = true;
    }
    if (!moved) {
      s.phase = 'settlement'; s.settlement = { index: 0, cursor: 0, queue: null, pending: null };
      event(s, 'AuctionClosed'); return;
    }
    const current = s.players[s.turn];
    if (!isAgent(current)) return;
    playAgent(s, current);
  }
  requireRule(false, 'AGENT_LOOP', 'Агент зациклился.');
}

/** Ставка агента: d6 выбирает лот, дальше минимальный легальный диск, поиск вправо (B16). */
function playAgent(s, agent) {
  const roll = rollD6(s.rng); s.rng = roll.seed;
  const move = chooseBid(agent, s.lots, (d, lot) => !bidLegality(s, agent, d, lot, d.value), roll.value);
  if (!move) { agent.blocked = true; event(s, 'AgentBlocked', { roll: roll.value }); return; }
  const disc = agent.discs.find(d => d.id === move.discId);
  const lot = s.lots.find(l => l.id === move.lotId);
  disc.used = true;
  lot.bids.push({ playerId: agent.id, discId: disc.id, kind: disc.kind, value: disc.value, bonus: false });
  event(s, 'BidPlaced', { playerId: agent.id, lotId: lot.id, value: disc.value, discKind: disc.kind, bonus: false, roll: roll.value });
}
function resolveLot(s, defs) {
  const flow = s.settlement, lot = s.lots[flow.index];
  requireRule(!flow.pending, 'CHOICE_REQUIRED', 'Сначала выберите компенсацию.');
  if (!flow.queue) {
    const win = pickWinner(lot.bids, id => s.players.find(x => x.id === id));
    const losers = lot.bids.filter(b => b !== win).sort((a, b) => a.value - b.value);
    flow.queue = win ? [...losers, win] : [];
  }
  const losers = flow.queue.slice(0, -1);
  const options = lot.kind === 'university'
    ? lot.table.options
    : [definition(defs, lot.card.definitionId).compensation];
  while (flow.cursor < losers.length) {
    const bid = losers[flow.cursor], p = player(s, bid.playerId), units = compensationUnits(p, bid.value);
    const choice = options.length > 1;   // университет: два варианта, выбор всегда за игроком
    const single = options[0];
    if (isAgent(p)) {
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, times: 0, agent: true }); flow.cursor++;
    } else if (units === 0) {
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, times: 0 }); flow.cursor++;
    } else if (!choice && single.kind === 'gain') {
      transfer(p.wallet, {}, single.gain, units);
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, gain: single.gain, times: units }); flow.cursor++;
    } else if (!choice && !canPay(p.wallet, single.cost)) {
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, times: 0 }); flow.cursor++;
    } else { flow.pending = { playerId: p.id, lotId: lot.id, options, limit: units }; return; }
  }
  const winner = flow.queue.at(-1);
  if (lot.kind === 'university') {
    // Карта университета остаётся в ряду, победитель забирает с неё жетон управляющего.
    if (!winner) {
      if (lot.token) { s.managerDiscard.push(lot.token); event(s, 'ManagerDiscarded', { token: lot.token }); }
    } else if (isAgent(player(s, winner.playerId))) {
      if (lot.token) { s.managerDiscard.push(lot.token); event(s, 'AgentTookManager', { token: lot.token }); }
    } else if (lot.token) {
      player(s, winner.playerId).managers.push(lot.token);
      event(s, 'ManagerWon', { playerId: winner.playerId, token: lot.token, value: winner.value });
    }
    lot.token = null;
  } else if (winner && isAgent(player(s, winner.playerId))) {
    s.discard.push(lot.card);
    event(s, 'AgentTookCard', { cardId: lot.card.id, definitionId: lot.card.definitionId, value: winner.value });
  } else if (winner) {
    const owner = player(s, winner.playerId);
    owner.cards.push(lot.card);
    triggerSupplies(s, defs, owner, lot.card, 'basic');
    event(s, 'CardWon', { playerId: winner.playerId, cardId: lot.card.id, definitionId: lot.card.definitionId, value: winner.value });
  } else { s.discard.push(lot.card); event(s, 'CardDiscarded', { cardId: lot.card.id }); }
  lot.resolved = true; flow.index++; flow.cursor = 0; flow.queue = null;
  if (flow.index === s.lots.length) {
    s.phase = s.config.planning ? 'planning' : 'production'; s.turn = s.firstPlayer; s.production = { active: null };
    for (const p of s.players) for (const d of p.discs) { d.used = false; if (d.kind === 'variable') d.value = 0; }
    event(s, s.config.planning ? 'PlanningStarted' : 'ProductionStarted');
  }
}
/** Эффект жетона управляющего, лежащего на карте, или null. */
function managerEffect(s, card) {
  return card.manager ? s.managerDefs?.[card.manager] ?? null : null;
}
/** Жетоны, которые игрок применяет сам в любой момент использования карты. */
const ORDERED_MANAGER = ['upgrade-self', 'discard-self', 'local-gain', 'local-choice'];

/** Подходит ли операция под условие жетона: обмен, продажа или любая. */
function operationFits(on, kinds) {
  return on === 'exchange' ? kinds.exchange : on === 'sale' ? kinds.sale : true;
}
/** Напечатанная кратность строки плюс прибавка от жетона «ещё один раз». */
function effectLimit(s, card, effect) {
  const boost = managerEffect(s, card);
  if (boost?.kind !== 'extra-limit') return effect.limit;
  return operationFits(boost.on, classifyConversion(effect)) ? effect.limit + boost.amount : effect.limit;
}
/** Ресурсы жетона лежат на карте: тратятся раньше общего запаса и сгорают в конце. */
function payWithLocal(card, wallet, cost, times) {
  const local = card.local ?? {};
  for (const [k, v] of Object.entries(cost))
    requireRule((local[k] ?? 0) + wallet[k] >= v * times, 'INSUFFICIENT_RESOURCES', 'Не хватает ресурсов.');
  for (const [k, v] of Object.entries(cost)) {
    const owed = v * times, fromCard = Math.min(local[k] ?? 0, owed);
    if (fromCard) local[k] -= fromCard;
    wallet[k] -= owed - fromCard;
  }
}
function addLocal(card, values) {
  card.local = { ...(card.local ?? {}) };
  for (const [k, v] of Object.entries(values)) card.local[k] = (card.local[k] ?? 0) + v;
}

/**
 * Поставка (⚡) — однократный эффект вне обычной очереди: с обычной стороны срабатывает
 * при получении карты, с модернизированной — сразу после модернизации.
 * В фазе производства строка поставки пропускается.
 */
const isSupply = row => row.kind === 'supply';
export function productionRows(card, d) {
  return [...d.effects, ...(card.upgraded ? d.advanced ?? [] : [])].filter(row => !isSupply(row));
}
export function activeEffect(s, defs) {
  const active = s.production?.active;
  if (!active) return null;
  const card = owned(player(s, active.playerId), active.cardId), d = definition(defs, card.definitionId);
  return productionRows(card, d)[active.index] ?? null;
}

/**
 * Запускает поставки указанной стороны. Добыча применяется сама, переработка
 * предлагается игроку: он выбирает, сколько раз её применить.
 */
function triggerSupplies(s, defs, p, card, side) {
  const d = definition(defs, card.definitionId);
  const rows = (side === 'advanced' ? d.advanced ?? [] : d.effects).filter(isSupply);
  for (const row of rows) {
    const e = row.of;
    if (e.kind === 'gain') {
      transfer(p.wallet, {}, e.gain);
      event(s, 'SupplyTaken', { playerId: p.id, cardId: card.id, gain: e.gain, side });
    } else {
      // Переработка требует решения игрока, поэтому кладём её в очередь ожидания.
      s.supplies.push({ playerId: p.id, cardId: card.id, effect: e, side });
      event(s, 'SupplyOffered', { playerId: p.id, cardId: card.id, side });
    }
  }
}
function automaticEffects(s, defs) {
  while (s.production.active) {
    const a = s.production.active, e = activeEffect(s, defs), p = player(s, a.playerId);
    if (!e) {
      const card = owned(p, a.cardId), boost = managerEffect(s, card);
      // Управляющего можно применить в любой момент использования карты. Если все строки
      // автоматические, карта завершилась бы мгновенно, поэтому на конце делаем паузу.
      if (boost && ORDERED_MANAGER.includes(boost.kind) && !a.managerUsed) return;
      if (boost?.kind === 'if-all-sales') {
        const d = definition(defs, card.definitionId);
        const rows = productionRows(card, d);
        const sales = rows.map((row, i) => [row, i]).filter(([row]) => row.kind === 'convert' && classifyConversion(row).sale);
        // «Полностью применили» — не меньше напечатанной кратности (пояснения дополнения, стр. 11).
        if (sales.length && sales.every(([row, i]) => (a.usage?.[i] ?? 0) >= row.limit)) {
          transfer(p.wallet, {}, boost.gain);
          event(s, 'ManagerBonus', { playerId: p.id, cardId: card.id, gain: boost.gain, reason: 'all-sales' });
        }
      }
      card.usedRound = s.round; card.local = null;
      event(s, 'CardCompleted', { playerId: p.id, cardId: a.cardId }); s.production.active = null; return;
    }
    if (e.kind !== 'gain') return;
    transfer(p.wallet, {}, e.gain); event(s, 'ResourceGained', { playerId: p.id, cardId: a.cardId, gain: e.gain });
    a.index++; a.used = 0;
  }
}
function convert(s, p, e, times, limit, data) {
  requireRule(integer(times) && times <= limit, 'INVALID_COUNT', 'Превышен лимит переработки.');
  for (let i = 0; i < times; i++) {
    transfer(p.wallet, e.cost, e.gain);
    event(s, 'ConversionPerformed', { playerId: p.id, cost: e.cost, gain: e.gain, ...classifyConversion(e), ...data });
  }
}

export function dispatch(state, command, defs) {
  requireRule(command && typeof command === 'object', 'INVALID_COMMAND', 'Команда не задана.');
  requireRule(command.expectedRevision === undefined || command.expectedRevision === state.revision, 'STALE_REVISION', 'Состояние изменилось. Повторите действие.');
  requireRule(state.rulesVersion === RULES_VERSION, 'WRONG_VERSION', 'Версия правил не поддерживается.');
  actor(state, command.actorId);
  const s = clone(state), p = player(s, command.actorId);
  switch (command.type) {
    case 'Bid': {
      phase(s, 'auction');
      const error = bidError(s, p.id, command.discId, command.lotId, command.value);
      requireRule(!error, 'ILLEGAL_BID', error);
      const d = p.discs.find(d => d.id === command.discId), lot = s.lots.find(l => l.id === command.lotId);
      if (d.kind === 'variable') { transfer(p.wallet, { coal: command.value }); d.value = command.value; }
      d.used = true; lot.bids.push({ playerId: p.id, discId: d.id, kind: d.kind, value: d.value, bonus: Boolean(d.bonus) });
      event(s, 'BidPlaced', { playerId: p.id, lotId: lot.id, value: d.value, discKind: d.kind, bonus: Boolean(d.bonus) });
      const bonus = p.discs.find(x => x.bonus);
      // Парная постановка — свойство ОБНОВЛЁННОЙ карты из «Интербеллума».
      // Базовая карта даёт просто лишний диск 2, он выставляется как любой другой.
      if (s.pendingPair?.playerId === p.id) s.pendingPair = null;
      else if (s.config.pairedExtraDisc && bonus && !bonus.used) {
        // Двойка выставляется вместе с этой ставкой, поэтому легальность проверяется уже в парном режиме.
        s.pendingPair = { playerId: p.id, lotId: lot.id };
        if (s.lots.some(l => !bidLegality(s, p, bonus, l, bonus.value))) event(s, 'PairOffered', { playerId: p.id });
        else s.pendingPair = null;
      }
      advanceBid(s); break;
    }
    case 'SkipPair': {
      phase(s, 'auction');
      requireRule(s.pendingPair?.playerId === p.id, 'NO_PAIR', 'Нет предложенной парной ставки.');
      // Дополнительная двойка необязательна. «Одновременно с другой ставкой» описывает,
      // КАК её ставить, а не обязывает ставить. Отказ не расходует диск: если игрок
      // сделает ещё одну обычную ставку в этом раунде, двойку предложат снова.
      s.pendingPair = null; advanceBid(s); break;
    }
    case 'ResolveLot': phase(s, 'settlement'); resolveLot(s, defs); break;
    case 'Compensate': {
      phase(s, 'settlement'); const flow = s.settlement, choice = flow.pending;
      requireRule(choice, 'NO_CHOICE', 'Нет ожидаемой компенсации.');
      // picks[i] — сколько единиц отдано i-му варианту. У обычного предприятия вариант один,
      // у университета их два и игрок делит единицы как хочет (правила дополнения, стр. 7).
      const picks = command.picks ?? [command.times ?? 0];
      requireRule(Array.isArray(picks) && picks.length === choice.options.length && picks.every(n => integer(n)),
        'INVALID_COUNT', 'Укажите, сколько раз применить каждый вариант компенсации.');
      const total = picks.reduce((a, b) => a + b, 0);
      requireRule(total <= choice.limit, 'INVALID_COUNT', 'Единиц компенсации меньше, чем вы распределили.');
      choice.options.forEach((effect, i) => {
        if (!picks[i]) return;
        if (effect.kind === 'gain') {
          transfer(p.wallet, {}, effect.gain, picks[i]);
          event(s, 'Compensation', { playerId: p.id, lotId: choice.lotId, gain: effect.gain, times: picks[i] });
        } else {
          convert(s, p, effect, picks[i], choice.limit, { context: 'compensation' });
        }
      });
      event(s, 'CompensationChosen', { playerId: p.id, picks: [...picks] });
      flow.pending = null; flow.cursor++; resolveLot(s, defs); break;
    }
    case 'ArrangeCards': {
      phase(s, 'planning');
      const ids = command.cardIds;
      requireRule(Array.isArray(ids) && ids.length === p.cards.length && new Set(ids).size === ids.length && ids.every(id => p.cards.some(c => c.id === id)), 'INVALID_ORDER', 'План должен включать каждое ваше предприятие ровно один раз.');
      if (s.config.productionChain) {
        const old = new Set(p.lockedOrder);
        requireRule(ids.filter(id => old.has(id)).every((id, i) => id === p.lockedOrder[i]), 'LOCKED_ORDER', 'В цепочке нельзя менять взаимный порядок старых карт. Перемещайте новые карты.');
      }
      const cards = new Map(p.cards.map(c => [c.id, c])); p.cards = ids.map(id => cards.get(id));
      event(s, 'CardsArranged', { playerId: p.id, cardIds: [...ids] }); break;
    }
    case 'PlaceManagers': {
      phase(s, 'planning');
      requireRule(!p.planned, 'ALREADY_PLANNED', 'План уже принят.');
      const list = command.assignments ?? [];
      requireRule(Array.isArray(list) && list.length <= p.managers.length, 'INVALID_ASSIGNMENT', 'Жетонов у вас меньше.');
      const tokens = new Set(), spots = new Set();
      for (const item of list) {
        requireRule(p.managers.includes(item.token), 'INVALID_ASSIGNMENT', 'Этого жетона у вас нет.');
        requireRule(!tokens.has(item.token), 'INVALID_ASSIGNMENT', 'Один жетон нельзя положить дважды.');
        requireRule(!spots.has(item.cardId), 'INVALID_ASSIGNMENT', 'На предприятии не может быть двух управляющих.');
        owned(p, item.cardId);
        tokens.add(item.token); spots.add(item.cardId);
      }
      p.cards.forEach(c => { c.manager = null; });
      for (const item of list) p.cards.find(c => c.id === item.cardId).manager = item.token;
      event(s, 'ManagersPlaced', { playerId: p.id, count: list.length });
      break;
    }
    case 'ConfirmPlan': {
      phase(s, 'planning'); p.planned = true; event(s, 'PlanConfirmed', { playerId: p.id });
      if (s.players.every(p => p.planned)) {
        s.phase = 'production'; s.turn = s.firstPlayer; event(s, 'ProductionStarted');
      } else { do { s.turn = (s.turn + 1) % s.players.length; } while (s.players[s.turn].planned); }
      break;
    }
    case 'UseCard': {
      phase(s, 'production'); requireRule(!s.production.active, 'CARD_ACTIVE', 'Сначала завершите текущее предприятие.');
      const card = owned(p, command.cardId);
      requireRule(card.usedRound !== s.round, 'CARD_USED', 'Это предприятие уже использовано в раунде.');
      requireRule(!s.config.productionChain || p.cards.find(c => c.usedRound !== s.round)?.id === card.id, 'CHAIN_ORDER', 'В цепочке используйте следующее предприятие слева направо.');
      const boost = managerEffect(s, card);
      s.production.active = { playerId: p.id, cardId: card.id, index: 0, used: 0,
        usage: {}, managerUsed: false, freeLeft: boost?.kind === 'free-operation' ? boost.times : 0 };
      card.local = {};
      event(s, 'CardStarted', { playerId: p.id, cardId: card.id, manager: card.manager ?? null });
      automaticEffects(s, defs); break;
    }
    case 'Convert': {
      phase(s, 'production'); const e = activeEffect(s, defs), a = s.production.active;
      requireRule(e?.kind === 'convert', 'WRONG_EFFECT', 'Сейчас не эффект переработки.');
      requireRule(integer(command.times, 1), 'INVALID_COUNT', 'Выберите хотя бы одну операцию или пропустите эффект.');
      const card = owned(p, a.cardId), boost = managerEffect(s, card), kinds = classifyConversion(e);
      requireRule(command.times <= effectLimit(s, card, e) - a.used, 'INVALID_COUNT', 'Превышен лимит переработки.');
      // Операции идут по одной: жетон оплачивает отдельную операцию и платит за каждую отдельно.
      for (let i = 0; i < command.times; i++) {
        const free = boost?.kind === 'free-operation' && a.freeLeft > 0 && operationFits(boost.on, kinds);
        if (free) a.freeLeft--; else payWithLocal(card, p.wallet, e.cost, 1);
        transfer(p.wallet, {}, e.gain);
        event(s, 'ConversionPerformed', { playerId: p.id, cost: free ? {} : e.cost, gain: e.gain,
          ...kinds, cardId: a.cardId, context: 'production', free });
        if (boost?.kind === 'per-operation' && operationFits(boost.on, kinds)) {
          transfer(p.wallet, {}, boost.gain);
          event(s, 'ManagerBonus', { playerId: p.id, cardId: card.id, gain: boost.gain, reason: boost.on });
        }
      }
      a.used += command.times;
      a.usage[a.index] = (a.usage[a.index] ?? 0) + command.times;
      break;
    }
    case 'TakeSupply': {
      const pending = s.supplies[0];
      requireRule(pending, 'NO_SUPPLY', 'Нет ожидающей поставки.');
      requireRule(pending.playerId === p.id, 'NOT_YOUR_TURN', 'Эта поставка не ваша.');
      const e = pending.effect;
      requireRule(integer(command.times) && command.times <= e.limit, 'INVALID_COUNT', 'Превышен лимит поставки.');
      if (command.times) convert(s, p, e, command.times, e.limit, { cardId: pending.cardId, context: 'supply' });
      event(s, 'SupplyResolved', { playerId: p.id, cardId: pending.cardId, times: command.times });
      s.supplies.shift();
      break;
    }
    case 'UseManager': {
      phase(s, 'production');
      const a = s.production.active;
      requireRule(a, 'NO_ACTIVE_CARD', 'Управляющий действует только при использовании карты.');
      const card = owned(p, a.cardId), boost = managerEffect(s, card);
      requireRule(boost && ORDERED_MANAGER.includes(boost.kind), 'NO_MANAGER', 'У этой карты нет применяемого управляющего.');
      requireRule(!a.managerUsed, 'MANAGER_USED', 'Управляющий уже сработал на этой карте.');
      if (boost.kind === 'upgrade-self') {
        requireRule(!card.upgraded && definition(defs, card.definitionId).kind === 'company', 'CANNOT_UPGRADE', 'Эту карту нельзя модернизировать.');
        payWithLocal(card, p.wallet, boost.cost, 1);
        card.upgraded = true;
        event(s, 'CardUpgraded', { playerId: p.id, cardId: card.id, byManager: true });
        triggerSupplies(s, defs, p, card, 'advanced');
      } else if (boost.kind === 'discard-self') {
        transfer(p.wallet, {}, boost.gain);
        p.cards = p.cards.filter(c => c.id !== card.id);
        p.lockedOrder = p.lockedOrder.filter(id => id !== card.id);
        s.discard.push({ ...card, manager: null, local: null });
        event(s, 'CardScrapped', { playerId: p.id, cardId: card.id, gain: boost.gain });
        a.managerUsed = true; s.production.active = null; break;
      } else if (boost.kind === 'local-gain') {
        addLocal(card, boost.gain);
        event(s, 'ManagerSupplied', { playerId: p.id, cardId: card.id, gain: boost.gain });
      } else {
        const pick = boost.options[command.option ?? 0];
        requireRule(pick, 'INVALID_COUNT', 'Выберите один из вариантов управляющего.');
        addLocal(card, pick);
        event(s, 'ManagerSupplied', { playerId: p.id, cardId: card.id, gain: pick });
      }
      a.managerUsed = true; break;
    }
    case 'NextEffect': {
      phase(s, 'production'); requireRule(s.production.active, 'NO_ACTIVE_CARD', 'Сначала выберите предприятие.');
      const a = s.production.active;
      // На конце карты «дальше» означает отказ от управляющего.
      if (!activeEffect(s, defs)) a.managerUsed = true;
      a.index++; a.used = 0; automaticEffects(s, defs); break;
    }
    case 'Upgrade': {
      phase(s, 'production'); requireRule(activeEffect(s, defs)?.kind === 'upgrade', 'WRONG_EFFECT', 'Модернизация доступна только по эффекту.');
      const card = owned(p, command.cardId);
      requireRule(!card.upgraded && definition(defs, card.definitionId).kind === 'company', 'CANNOT_UPGRADE', 'Эту карту нельзя модернизировать.');
      transfer(p.wallet, upgradeCost(p)); card.upgraded = true;
      event(s, 'CardUpgraded', { playerId: p.id, cardId: card.id });
      triggerSupplies(s, defs, p, card, 'advanced');
      break;
    }
    case 'RepeatCard': {
      phase(s, 'production');
      requireRule(has(p, 'repeat-card'), 'NO_ABILITY', 'У этого игрока нет повтора.');
      requireRule(!p.repeated, 'ALREADY_REPEATED', 'Повтор уже использован в этой фазе производства.');
      requireRule(!s.production.active, 'CARD_ACTIVE', 'Сначала завершите текущее предприятие.');
      const card = owned(p, command.cardId);
      requireRule(card.usedRound === s.round, 'NOT_USED', 'Повторять можно только отработавшее предприятие.');
      transfer(p.wallet, { coal: 2 }); card.usedRound = 0; p.repeated = true;
      event(s, 'CardRepeated', { playerId: p.id, cardId: card.id }); break;
    }
    case 'FinishProduction': {
      phase(s, 'production'); requireRule(!s.production.active, 'CARD_ACTIVE', 'Завершите текущее предприятие.');
      requireRule(p.cards.every(c => c.usedRound === s.round), 'CARDS_REMAIN', 'Используйте оставшиеся предприятия.');
      requireRule(!s.supplies.some(x => x.playerId === p.id), 'SUPPLY_PENDING', 'Сначала разыграйте поставку.');
      p.done = true;
      if (s.players.every(p => p.done)) {
        if (s.round === 4) { s.phase = 'finished'; s.result = rankPlayers(s.players.filter(x => !isAgent(x))); event(s, 'GameFinished'); }
        else {
          s.round++;
          // Метка первого игрока обходит только людей: агент не ведёт раунд и не разбирает лоты.
          do { s.firstPlayer = (s.firstPlayer + 1) % s.players.length; } while (isAgent(s.players[s.firstPlayer]));
          startAuction(s);
        }
      } else {
        do { s.turn = (s.turn + 1) % s.players.length; } while (s.players[s.turn].done);
      }
      break;
    }
    default: requireRule(false, 'INVALID_COMMAND', 'Неизвестная команда.');
  }
  s.players.forEach(p => validateWallet(p.wallet)); s.revision++; return s;
}

/**
 * Что даст ставка: обе её ценности сразу. Нужна интерфейсу, чтобы игрок
 * видел и предприятие, и точную компенсацию до того, как поставит диск.
 * Чистая функция: состояние не меняется.
 */
export function bidOutcome(s, defs, playerId, lotId, value) {
  const p = player(s, playerId), lot = s.lots.find(l => l.id === lotId);
  requireRule(lot, 'UNKNOWN_LOT', 'Неизвестный лот.');
  const effect = definition(defs, lot.card.definitionId).compensation;
  const units = compensationUnits(p, value);
  const empty = lot.bids.length === 0;
  const best = empty ? -1 : Math.max(...lot.bids.map(b => b.value));
  let max = units;
  if (effect.kind === 'convert') {
    max = 0;
    for (let t = units; t >= 1; t--) if (canPay(p.wallet, effect.cost, t)) { max = t; break; }
  }
  const gain = max ? Object.fromEntries(Object.entries(effect.gain).map(([k, v]) => [k, v * max])) : null;
  return { units, max, gain, compensation: effect, empty, bestRival: best, leading: value > best };
}
