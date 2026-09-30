import { requireRule, emptyWallet, validateWallet, integer, canPay, transfer, shuffle, rankPlayers, classifyConversion, clone, RESOURCES } from './rules.mjs';
import { ABILITIES, has, compensationUnits, upgradeCost, extraDisc, ignoresBidLimits, pickWinner, variableBonus, stacksManagers } from './capitalists.mjs';
import { isAgent, rollD6, chooseBid } from './agent.mjs';

export const RULES_VERSION = 'prototype-0.3';
function definition(definitions, id) {
  requireRule(Object.hasOwn(definitions, id), 'UNKNOWN_CARD', 'Неизвестная карта.');
  return definitions[id];
}
/** Активные строки указанной стороны карты, включая обёрнутые в поставку. */
function activeRows(card, d) {
  return [...d.effects, ...(card.upgraded ? d.advanced ?? [] : [])];
}
/**
 * «За каждую вашу карту, где можете продать/обменять X» — считаются только карты,
 * на которых нужный эффект активен, то есть напечатан полноцветным на текущей стороне
 * (пояснения дополнения, стр. 11). Неактивные строги другой стороны не учитываются.
 * Поставки считаются: на своей стороне они полноцветные.
 */
function countCardsWith(p, defs, on, resource) {
  return p.cards.filter(card => !card.borrowed && activeRows(card, definition(defs, card.definitionId)).some(row => {
    const e = row.kind === 'supply' ? row.of : row;
    if (e.kind !== 'convert') return false;
    if ((e.cost[resource] ?? 0) <= 0) return false;
    const kinds = classifyConversion(e);
    return on === 'sale' ? kinds.sale : kinds.exchange;
  })).length;
}

/**
 * Постоянные эффекты действуют с момента получения карты, включая фазу аукциона,
 * но только с той стороны, которая сейчас лицевая. Возвращает карты игрока,
 * на которых активен постоянный эффект с данным правилом.
 */
function permanentCards(p, defs, rule) {
  // Чужая карта, взятая у соседа, постоянных эффектов не даёт (пояснения дополнения, стр. 11).
  return p.cards.filter(card => !card.borrowed && activeRows(card, definition(defs, card.definitionId))
    .some(row => row.kind === 'permanent' && row.rule === rule));
}
/** Ресурсы, накопленные НА карте. В отличие от запаса управляющего, живут между раундами. */
/** Постоянный эффект «кладите сюда каждый ресурс, потраченный на модернизацию». */
function storeUpgradeCost(s, defs, p, cost) {
  for (const card of permanentCards(p, defs, 'store-upgrade-cost')) {
    const row = activeRows(card, definition(defs, card.definitionId)).find(r => r.rule === 'store-upgrade-cost');
    const spent = cost[row.resource] ?? 0;
    if (!spent) continue;
    storeOnCard(card, row.resource, spent);
    event(s, 'StoredOnCard', { playerId: p.id, cardId: card.id, resource: row.resource, amount: spent, reason: 'upgrade' });
  }
}
function storeOnCard(card, resource, amount = 1) {
  card.stored = { ...(card.stored ?? {}) };
  card.stored[resource] = (card.stored[resource] ?? 0) + amount;
}

function validateEffect(e, compensation = false) {
  if (e && e.kind === 'permanent') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Постоянный эффект не бывает компенсацией.');
    requireRule(['store-on-outbid', 'bonus-on-gain', 'extra-single-resource-sale', 'store-upgrade-cost', 'upgrade-on-gain', 'store-on-big-compensation'].includes(e.rule),
      'UNSUPPORTED_EFFECT', 'Такой постоянный эффект ещё не поддерживается.');
    return;
  }
  if (e && e.kind === 'take-stored') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Такой эффект не бывает компенсацией.');
    requireRule(RESOURCES.includes(e.resource), 'INVALID_EFFECT', 'Не указан ресурс.');
    return;
  }
  if (e && ['count-cards', 'operation-bonus', 'upgrade-next'].includes(e.kind)) {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Такой эффект не бывает компенсацией.');
    if (e.kind !== 'upgrade-next') {
      validateWallet(e.gain);
      requireRule(['sale', 'exchange'].includes(e.on), 'INVALID_EFFECT', 'Не указан вид операции.');
      requireRule(RESOURCES.includes(e.resource), 'INVALID_EFFECT', 'Не указан ресурс.');
    }
    return;
  }
  if (e && e.kind === 'supply') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Компенсация не может быть поставкой.');
    requireRule(e.of && ['gain', 'convert'].includes(e.of.kind), 'UNSUPPORTED_EFFECT', 'Поставка оборачивает добычу или переработку.');
    validateEffect(e.of);
    return;
  }
  requireRule(e && ['gain', 'convert', 'upgrade'].includes(e.kind), 'UNSUPPORTED_EFFECT', 'Эффект ещё не поддерживается.');
  if (e.kind === 'upgrade') {
    requireRule(!compensation, 'UNSUPPORTED_EFFECT', 'Модернизация не может быть этой компенсацией.');
    if (e.cost) validateWallet(e.cost);
    requireRule(e.limit === undefined || integer(e.limit, 1), 'INVALID_EFFECT', 'Некорректная кратность модернизации.');
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

export function createGame({ names = ['Игрок 1', 'Игрок 2', 'Игрок 3'], variableCapital = false, seed = 2026, planning = true, productionChain = false, turnSeconds = 0, capitalists = false, pairedExtraDisc = false, universities = false, expansion = false } = {}, pack) {
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
  requireRule(typeof expansion === 'boolean', 'INVALID_CONFIG', 'Дополнение включается или выключается.');
  const withAgent = humans === 2;   // B16: вдвоём третьим участником садится агент базы
  // «Исключение: обновлённая карта промышленника с 2 заменяет аналогичную из базовой игры».
  const pairedDisc = pairedExtraDisc || expansion;
  const lotsPerRound = humans + 4 + Number(variableCapital && !universities);
  let startIds = names.map(() => pack.startupId);
  // С дополнением в раздачу идут и его стартовые предприятия (правила дополнения, подготовка, пункт 1).
  const startPool = expansion && Array.isArray(pack.expansionStartupIds)
    ? [...pack.startupIds, ...pack.expansionStartupIds] : pack.startupIds;
  if (Array.isArray(startPool) && startPool.length >= names.length) {
    const roll = shuffle(startPool, rng); rng = roll.seed;
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
    // С дополнением в набор входят и его промышленники (правила дополнения, подготовка, пункт 1).
    // Те, что требуют выключенных модулей, отсеиваются: «Отдельные модули», стр. 9.
    let pool = pack.capitalists;
    if (expansion && Array.isArray(pack.expansionCapitalists)) pool = [...pool, ...pack.expansionCapitalists];
    if (!variableCapital) pool = pool.filter(c => c.ability !== 'variable-plus-two');
    if (!universities) pool = pool.filter(c => c.ability !== 'personal-manager');
    requireRule(pool.length >= names.length, 'INVALID_PACK', 'В пакете нет промышленников на всех игроков.');
    pool.forEach(c => requireRule(ABILITIES.includes(c.ability), 'INVALID_PACK', 'Неизвестная способность промышленника.'));
    const roll = shuffle(pool, rng); rng = roll.seed;
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
    // Личный жетон в стопку не входит, но его эффект должен быть известен движку.
    if (pack.personalManager) managerDefs[pack.personalManager.id] = pack.personalManager.effect;
    requireRule(managerDeck.length >= tables.length * 4, 'SHORT_MANAGERS',
      'Жетонов управляющих не хватит на четыре раунда.');
  }
  // Колода должна закрыть хотя бы первый раунд. Если на четыре раунда её не хватает,
  // невыкупленные лоты возвращаются в колоду — это временная мера для неполного каталога.
  // Колода дополнения: все 24 новые карты плюс случайные базовые (правила дополнения, стр. 6).
  let deckIds = pack.deck;
  if (expansion) {
    requireRule(Array.isArray(pack.expansionDeck) && pack.expansionDeck.length > 0,
      'INVALID_PACK', 'В пакете нет карт дополнения.');
    const take = Math.min(pack.expansionBaseCount ?? 24, pack.deck.length);
    const roll = shuffle(pack.deck, rng); rng = roll.seed;
    deckIds = [...pack.expansionDeck, ...roll.items.slice(0, take)];
  }
  requireRule(deckIds.length >= lotsPerRound, 'SHORT_DECK', 'Недостаточно карт даже на один раунд.');
  deckIds.forEach(id => requireRule(definition(pack.definitions, id).kind === 'company', 'INVALID_PACK', 'В колоде должна быть карта предприятия.'));
  const s = { schemaVersion: 1, rulesVersion: RULES_VERSION, contentVersion: pack.version,
    revision: 0, config: { variableCapital, planning, productionChain, turnSeconds, capitalists, universities, expansion, pairedExtraDisc: pairedDisc, deckCoversGame: deckIds.length >= lotsPerRound * 4 },
    rng, round: 1, firstPlayer: 0, turn: 0,
    phase: 'auction', deck: deckIds.map((definitionId, i) => ({ id: `c${i}`, definitionId, upgraded: false, usedRound: 0, managers: [], local: null })),
    players: names.map((name, i) => ({ id: `p${i}`, name: name.trim(), seat: i,
      ability: abilities[i]?.ability ?? null, capitalistId: abilities[i]?.id ?? null,
      wallet: { ...emptyWallet(), ...starts[i].starting, coal: (starts[i].starting.coal ?? 0) + Number(variableCapital) },
      cards: [{ id: `start${i}`, definitionId: startIds[i], upgraded: false, usedRound: 0 }],
      discs: [],
      // «У вас есть личный управляющий»: жетон выдаётся при подготовке.
      managers: abilities[i]?.ability === 'personal-manager' && pack.personalManager ? [pack.personalManager.id] : [],
      bonuses: [], blocked: false, done: false, repeated: false })),
    lots: [], discard: [], settlement: null, production: null, pendingPair: null,
    tables, managerDeck, managerDefs, managerDiscard: [], supplies: [], events: [] };
  if (withAgent) s.players.push({ id: 'agent', name: 'Агент', agent: true, seat: s.players.length, ability: null, capitalistId: null,
    wallet: emptyWallet(), cards: [], discs: [], managers: [], bonuses: [], blocked: false, done: false, repeated: false, lockedOrder: [], planned: false });
  s.config.agent = withAgent;
  event(s, 'GameStarted', withAgent ? { agent: true } : {}); startAuction(s); return s;
}
function startAuction(s) {
  // Агент не увеличивает число лотов: вдвоём их шесть (B03).
  const humans = s.players.filter(p => !isAgent(p)).length;
  const count = humans + 4 + Number(s.config.variableCapital && !s.config.universities);
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
    p.cards.forEach(c => { c.managers = []; c.local = null; });
    p.discs = [1, 2, 3, 4].map(value => ({ id: `fixed${value}`, kind: 'fixed', value, used: false }));
    const extra = extraDisc(p);
    if (extra) p.discs.push({ ...extra });
    if (s.config.variableCapital) p.discs.push({ id: 'variable', kind: 'variable', value: 0, used: false });
    p.blocked = false; p.repeated = false; p.neighbourUsed = false;
    p.bonuses = [];   // надбавки от текстовых эффектов живут одну фазу производства
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
  if (d.kind === 'variable' && !integer(value)) return 'Значение должно быть целым и неотрицательным.';
  if (d.kind === 'variable' && value > p.wallet.coal) return 'Не хватает угля для этой ставки.';
  // Сравнивается итоговый номинал диска, а не потраченный уголь.
  const v = d.kind === 'fixed' ? d.value : value + variableBonus(p);
  if (!integer(v)) return 'Значение должно быть целым и неотрицательным.';
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
    // Постоянный эффект «получаете компенсацию за 3 или 4»: срабатывает один раз на ставку.
    if (!bid.storedTriggered && !isAgent(p) && (units === 3 || units === 4)) {
      bid.storedTriggered = true;
      for (const card of permanentCards(p, defs, 'store-on-big-compensation')) {
        const row = activeRows(card, definition(defs, card.definitionId)).find(r => r.rule === 'store-on-big-compensation');
        storeOnCard(card, row.resource);
        event(s, 'StoredOnCard', { playerId: p.id, cardId: card.id, resource: row.resource, reason: 'compensation' });
      }
    }
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
/** Жетоны, лежащие на карте. Их может быть несколько — у промышленника с личным управляющим. */
const cardManagers = card => card.managers ?? (card.manager ? [card.manager] : []);
/** Эффекты всех жетонов карты. */
function managerEffects(s, card) {
  return cardManagers(card).map(id => s.managerDefs?.[id]).filter(Boolean);
}
/** Первый эффект нужного вида среди жетонов карты. */
function managerEffectOf(s, card, kind) {
  return managerEffects(s, card).find(e => e.kind === kind) ?? null;
}
/** Жетоны, которые игрок применяет сам в любой момент использования карты. */
const ORDERED_MANAGER = ['upgrade-self', 'discard-self', 'local-gain', 'local-choice', 'repeat-supply'];
/** Жетоны карты, которые игрок ещё может применить сам. */
function pendingManagers(s, card, active) {
  return cardManagers(card).filter(id => {
    const e = s.managerDefs?.[id];
    return e && ORDERED_MANAGER.includes(e.kind) && !(active.managersUsed ?? []).includes(id);
  });
}

/** Подходит ли операция под условие жетона: обмен, продажа или любая. */
function operationFits(on, kinds) {
  return on === 'exchange' ? kinds.exchange : on === 'sale' ? kinds.sale : true;
}
/** Напечатанная кратность строки плюс прибавка от жетона «ещё один раз». */
function effectLimit(s, card, effect, p = null, defs = null) {
  let limit = effect.limit;
  const kinds = classifyConversion(effect);
  for (const boost of managerEffects(s, card))
    if (boost.kind === 'extra-limit' && operationFits(boost.on, kinds)) limit += boost.amount;
  // «Продающий только один вид ресурса» — слева от стрелки ровно один ресурс
  // (пояснения дополнения, стр. 11).
  if (p && defs && kinds.sale && Object.keys(effect.cost).length === 1) {
    for (const holder of permanentCards(p, defs, 'extra-single-resource-sale')) {
      const row = activeRows(holder, definition(defs, holder.definitionId)).find(r => r.rule === 'extra-single-resource-sale');
      limit += row.amount ?? 1;
    }
  }
  return limit;
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
/** «Сосед справа»: игрок, который ходит перед вами. Агент не считается. */
function rightNeighbour(s, p) {
  const humans = s.players.filter(x => !isAgent(x));
  return humans.length > 1 ? humans[(humans.indexOf(p) - 1 + humans.length) % humans.length] : null;
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
    // Компенсация Компенсатора разыгрывается до обычных строк, поэтому ждём решения.
    if (s.production.active.compensationLeft) return;
    const a = s.production.active, e = activeEffect(s, defs), p = player(s, a.playerId);
    if (!e) {
      const card = owned(p, a.cardId);
      // Управляющего можно применить в любой момент использования карты. Если все строки
      // автоматические, карта завершилась бы мгновенно, поэтому на конце делаем паузу.
      if (pendingManagers(s, card, a).length) return;
      const finals = managerEffects(s, card).filter(b => b.kind === 'if-all-sales');
      if (finals.length) {
        const rows = productionRows(card, definition(defs, card.definitionId));
        const sales = rows.map((row, i) => [row, i]).filter(([row]) => row.kind === 'convert' && classifyConversion(row).sale);
        // «Полностью применили» — не меньше напечатанной кратности (пояснения дополнения, стр. 11).
        if (sales.length && sales.every(([row, i]) => (a.usage?.[i] ?? 0) >= row.limit)) {
          for (const boost of finals) {
            transfer(p.wallet, {}, boost.gain);
            event(s, 'ManagerBonus', { playerId: p.id, cardId: card.id, gain: boost.gain, reason: 'all-sales' });
          }
        }
      }
      card.usedRound = s.round; card.local = null;
      event(s, 'CardCompleted', { playerId: p.id, cardId: a.cardId }); s.production.active = null;
      if (card.borrowed) p.cards = p.cards.filter(c => c.id !== card.id);
      return;
    }
    if (e.kind === 'count-cards') {
      // Обязательная добыча: считаем подходящие карты и выдаём ресурс за каждую.
      const n = countCardsWith(p, defs, e.on, e.resource);
      if (n) transfer(p.wallet, {}, e.gain, n);
      event(s, 'CountedCards', { playerId: p.id, cardId: a.cardId, cards: n, gain: e.gain });
      a.index++; a.used = 0; continue;
    }
    if (e.kind === 'operation-bonus') {
      // Включается в свою очередь и действует до конца фазы производства этого игрока.
      p.bonuses.push({ on: e.on, resource: e.resource, gain: e.gain });
      event(s, 'BonusArmed', { playerId: p.id, cardId: a.cardId, on: e.on, resource: e.resource });
      a.index++; a.used = 0; continue;
    }
    if (e.kind === 'take-stored') {
      const card = owned(p, a.cardId);
      const amount = card.stored?.[e.resource] ?? 0;
      if (amount) {
        transfer(p.wallet, {}, { [e.resource]: amount });
        card.stored = { ...card.stored, [e.resource]: 0 };
      }
      event(s, 'TookFromCard', { playerId: p.id, cardId: card.id, resource: e.resource, amount });
      a.index++; a.used = 0; continue;
    }
    if (e.kind === 'permanent') { a.index++; a.used = 0; continue; }   // не разыгрывается в очереди
    if (e.kind !== 'gain') return;
    // Постоянный эффект «каждая ваша добыча этого ресурса приносит дополнительный».
    let gain = e.gain;
    for (const card of permanentCards(p, defs, 'bonus-on-gain')) {
      const row = activeRows(card, definition(defs, card.definitionId)).find(r => r.rule === 'bonus-on-gain');
      if ((gain[row.resource] ?? 0) > 0) gain = { ...gain, [row.resource]: gain[row.resource] + 1 };
    }
    transfer(p.wallet, {}, gain); event(s, 'ResourceGained', { playerId: p.id, cardId: a.cardId, gain });
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
      if (d.kind === 'variable') {
        // «У вас +2 к значению»: уголь тратится по запросу, а номинал выше на два.
        transfer(p.wallet, { coal: command.value });
        d.value = command.value + variableBonus(p);
      }
      // Постоянный эффект «перебили вашу ставку»: смотрим, кто был наверху до нас.
      const topBefore = lot.bids.length ? Math.max(...lot.bids.map(b => b.value)) : -1;
      const leaders = lot.bids.filter(b => b.value === topBefore);
      d.used = true; lot.bids.push({ playerId: p.id, discId: d.id, kind: d.kind, value: d.value, bonus: Boolean(d.bonus) });
      if (d.value > topBefore) {
        for (const beaten of leaders) {
          if (beaten.playerId === p.id) continue;
          const victim = s.players.find(x => x.id === beaten.playerId);
          for (const card of permanentCards(victim, defs, 'store-on-outbid')) {
            const row = activeRows(card, definition(defs, card.definitionId)).find(r => r.rule === 'store-on-outbid');
            storeOnCard(card, row.resource);
            event(s, 'StoredOnCard', { playerId: victim.id, cardId: card.id, resource: row.resource, reason: 'outbid' });
          }
        }
      }
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
        requireRule(stacksManagers(p) || !spots.has(item.cardId),
          'INVALID_ASSIGNMENT', 'На предприятии не может быть двух управляющих.');
        owned(p, item.cardId);
        tokens.add(item.token); spots.add(item.cardId);
      }
      p.cards.forEach(c => { c.managers = []; });
      for (const item of list) p.cards.find(c => c.id === item.cardId).managers.push(item.token);
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
      const freeLeft = managerEffects(s, card)
        .filter(b => b.kind === 'free-operation').reduce((n, b) => n + b.times, 0);
      s.production.active = { playerId: p.id, cardId: card.id, index: 0, used: 0,
        usage: {}, managersUsed: [], freeLeft };
      card.local = {};
      // «Используя каждое своё немодернизированное предприятие, можете один раз
      // разыграть его эффект компенсации (перед обычным)».
      const def0 = definition(defs, card.definitionId);
      if (has(p, 'compensation-before-normal') && !card.upgraded && def0.kind === 'company' && !card.borrowed)
        s.production.active.compensationLeft = true;
      event(s, 'CardStarted', { playerId: p.id, cardId: card.id, managers: cardManagers(card) });
      automaticEffects(s, defs); break;
    }
    case 'Convert': {
      phase(s, 'production'); const e = activeEffect(s, defs), a = s.production.active;
      requireRule(e?.kind === 'convert', 'WRONG_EFFECT', 'Сейчас не эффект переработки.');
      requireRule(integer(command.times, 1), 'INVALID_COUNT', 'Выберите хотя бы одну операцию или пропустите эффект.');
      const card = owned(p, a.cardId), kinds = classifyConversion(e);
      const perOps = managerEffects(s, card).filter(b => b.kind === 'per-operation');
      requireRule(command.times <= effectLimit(s, card, e, p, defs) - a.used, 'INVALID_COUNT', 'Превышен лимит переработки.');
      // Операции идут по одной: жетон оплачивает отдельную операцию и платит за каждую отдельно.
      for (let i = 0; i < command.times; i++) {
        const free = a.freeLeft > 0 && managerEffects(s, card)
          .some(b => b.kind === 'free-operation' && operationFits(b.on, kinds));
        if (free) a.freeLeft--;
        else if (e.from === 'card') {
          // Строка тратит только то, что лежит на самой карте.
          for (const [k, v] of Object.entries(e.cost))
            requireRule((card.stored?.[k] ?? 0) >= v, 'INSUFFICIENT_RESOURCES', 'На карте не хватает ресурсов.');
          card.stored = { ...card.stored };
          for (const [k, v] of Object.entries(e.cost)) card.stored[k] -= v;
        } else payWithLocal(card, p.wallet, e.cost, 1);
        transfer(p.wallet, {}, e.gain);
        event(s, 'ConversionPerformed', { playerId: p.id, cost: free ? {} : e.cost, gain: e.gain,
          ...kinds, cardId: a.cardId, context: 'production', free });
        for (const boost of perOps) {
          if (!operationFits(boost.on, kinds)) continue;
          transfer(p.wallet, {}, boost.gain);
          event(s, 'ManagerBonus', { playerId: p.id, cardId: card.id, gain: boost.gain, reason: boost.on });
        }
        // Надбавки текстовых эффектов: «всякий раз, когда продаёте X, получайте ещё».
        for (const bonus of p.bonuses) {
          if (!operationFits(bonus.on, kinds)) continue;
          if ((e.cost[bonus.resource] ?? 0) <= 0) continue;
          transfer(p.wallet, {}, bonus.gain);
          event(s, 'OperationBonus', { playerId: p.id, cardId: card.id, gain: bonus.gain, resource: bonus.resource });
        }
      }
      a.used += command.times;
      a.usage[a.index] = (a.usage[a.index] ?? 0) + command.times;
      break;
    }
    case 'UpgradeNext': {
      phase(s, 'production');
      const e = activeEffect(s, defs);
      requireRule(e?.kind === 'upgrade-next', 'WRONG_EFFECT', 'Сейчас не эффект модернизации соседа.');
      const a = s.production.active;
      const index = p.cards.findIndex(c => c.id === a.cardId);
      const next = p.cards[index + 1];
      requireRule(next, 'NO_NEXT_CARD', 'Это предприятие последнее в линии.');
      requireRule(!next.upgraded && definition(defs, next.definitionId).kind === 'company',
        'CANNOT_UPGRADE', 'Следующее предприятие улучшить нельзя.');
      next.upgraded = true;
      event(s, 'CardUpgraded', { playerId: p.id, cardId: next.id, byNeighbour: true });
      triggerSupplies(s, defs, p, next, 'advanced');
      a.index++; a.used = 0; automaticEffects(s, defs); break;
    }
    case 'UseOwnCompensation': {
      phase(s, 'production');
      const a = s.production.active;
      requireRule(a?.compensationLeft, 'NO_COMPENSATION', 'Сейчас компенсацию своей карты разыграть нельзя.');
      const card = owned(p, a.cardId);
      const effect = definition(defs, card.definitionId).compensation;
      const times = command.times ?? 0;
      requireRule(integer(times), 'INVALID_COUNT', 'Число применений должно быть целым.');
      if (times) {
        if (effect.kind === 'gain') {
          transfer(p.wallet, {}, effect.gain, times);
          requireRule(times === 1, 'INVALID_COUNT', 'Добыча компенсации разыгрывается один раз.');
        } else {
          requireRule(times <= effect.limit, 'INVALID_COUNT', 'Превышен лимит компенсации.');
          convert(s, p, effect, times, effect.limit, { cardId: card.id, context: 'own-compensation' });
        }
      }
      event(s, 'OwnCompensationUsed', { playerId: p.id, cardId: card.id, times });
      a.compensationLeft = false;
      automaticEffects(s, defs); break;
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
      const card = owned(p, a.cardId);
      const pending = pendingManagers(s, card, a);
      const here = cardManagers(card);
      // Жетонов может быть несколько — у промышленника с личным управляющим.
      const token = command.token ?? pending[0] ?? here[0];
      requireRule(here.includes(token) || pending.length, 'NO_MANAGER', 'У этой карты нет применяемого управляющего.');
      requireRule(!((a.managersUsed ?? []).includes(token)), 'MANAGER_USED', 'Этот управляющий уже сработал.');
      requireRule(pending.includes(token), 'NO_MANAGER', 'Этот жетон здесь не лежит или применяется сам.');
      const boost = s.managerDefs[token];
      if (boost.kind === 'upgrade-self') {
        requireRule(!card.upgraded && definition(defs, card.definitionId).kind === 'company', 'CANNOT_UPGRADE', 'Эту карту нельзя модернизировать.');
        payWithLocal(card, p.wallet, boost.cost, 1);
        card.upgraded = true;
        storeUpgradeCost(s, defs, p, boost.cost);
        event(s, 'CardUpgraded', { playerId: p.id, cardId: card.id, byManager: true });
        triggerSupplies(s, defs, p, card, 'advanced');
      } else if (boost.kind === 'discard-self') {
        transfer(p.wallet, {}, boost.gain);
        p.cards = p.cards.filter(c => c.id !== card.id);
        p.lockedOrder = p.lockedOrder.filter(id => id !== card.id);
        s.discard.push({ ...card, manager: null, managers: [], local: null });
        event(s, 'CardScrapped', { playerId: p.id, cardId: card.id, gain: boost.gain });
        a.managersUsed = [...(a.managersUsed ?? []), token]; s.production.active = null; break;
      } else if (boost.kind === 'repeat-supply') {
        // «Разыграйте эффект ⚡ этой карты ещё раз» — повторяется активная сторона.
        triggerSupplies(s, defs, p, card, card.upgraded ? 'advanced' : 'basic');
        event(s, 'SupplyRepeated', { playerId: p.id, cardId: card.id });
      } else if (boost.kind === 'local-gain') {
        addLocal(card, boost.gain);
        event(s, 'ManagerSupplied', { playerId: p.id, cardId: card.id, gain: boost.gain });
      } else {
        const pick = boost.options[command.option ?? 0];
        requireRule(pick, 'INVALID_COUNT', 'Выберите один из вариантов управляющего.');
        addLocal(card, pick);
        event(s, 'ManagerSupplied', { playerId: p.id, cardId: card.id, gain: pick });
      }
      a.managersUsed = [...(a.managersUsed ?? []), token]; break;
    }
    case 'NextEffect': {
      phase(s, 'production'); requireRule(s.production.active, 'NO_ACTIVE_CARD', 'Сначала выберите предприятие.');
      const a = s.production.active;
      // На конце карты «дальше» означает отказ от оставшихся управляющих.
      if (!activeEffect(s, defs)) {
        const card = owned(p, a.cardId);
        a.managersUsed = [...(a.managersUsed ?? []), ...pendingManagers(s, card, a)];
      }
      a.index++; a.used = 0; automaticEffects(s, defs); break;
    }
    case 'Upgrade': {
      phase(s, 'production');
      const row = activeEffect(s, defs), a = s.production.active;
      const viaRow = row?.kind === 'upgrade';
      // Постоянный эффект «получаете жетон модернизации — можете потратить его и уголь»:
      // приближение к правилу — доступно всё время, пока жетон лежит в запасе.
      const viaPermanent = !viaRow && !a && p.wallet.upgrade > 0 && permanentCards(p, defs, 'upgrade-on-gain').length > 0;
      requireRule(viaRow || viaPermanent, 'WRONG_EFFECT', 'Модернизация доступна только по эффекту.');
      const card = owned(p, command.cardId);
      requireRule(!card.upgraded && definition(defs, card.definitionId).kind === 'company' && !card.borrowed, 'CANNOT_UPGRADE', 'Эту карту нельзя модернизировать.');
      const cost = upgradeCost(p, viaRow ? row.cost : undefined);
      transfer(p.wallet, cost); card.upgraded = true;
      storeUpgradeCost(s, defs, p, cost);
      event(s, 'CardUpgraded', { playerId: p.id, cardId: card.id });
      triggerSupplies(s, defs, p, card, 'advanced');
      if (viaRow && row.limit) {
        a.used++;
        if (a.used >= row.limit) { a.index++; a.used = 0; automaticEffects(s, defs); }
      }
      break;
    }
    case 'UseNeighbourCard': {
      phase(s, 'production');
      requireRule(has(p, 'use-neighbour-card'), 'NO_ABILITY', 'У этого игрока нет такой способности.');
      requireRule(!p.neighbourUsed, 'ALREADY_USED', 'Способность уже использована в этой фазе производства.');
      requireRule(!s.production.active, 'CARD_ACTIVE', 'Сначала завершите текущее предприятие.');
      requireRule(p.cards.every(c => c.usedRound === s.round), 'CARDS_REMAIN', 'Способность действует в конце фазы производства: сначала используйте свои предприятия.');
      const right = rightNeighbour(s, p);
      requireRule(right, 'NO_NEIGHBOUR', 'Справа нет соседа.');
      const src = right.cards.find(c => c.id === command.cardId);
      requireRule(src, 'UNKNOWN_CARD', 'У соседа нет этой карты.');
      requireRule(definition(defs, src.definitionId).kind === 'company', 'CANNOT_BORROW', 'Стартовое предприятие соседа использовать нельзя.');
      transfer(p.wallet, { metal: 1 });
      p.neighbourUsed = true;
      // Жетоны управляющих на чужой карте работают, но «вывести» и «модернизировать» действуют на оригинал, а не на копию.
      const keep = (src.managers ?? []).filter(t => !['upgrade-self', 'discard-self'].includes(s.managerDefs[t]?.kind));
      const card = { id: `borrow-${src.id}`, definitionId: src.definitionId, upgraded: src.upgraded, usedRound: 0, borrowed: true, managers: keep, local: {} };
      p.cards.push(card);
      const freeLeft = managerEffects(s, card).filter(b => b.kind === 'free-operation').reduce((n, b) => n + b.times, 0);
      s.production.active = { playerId: p.id, cardId: card.id, index: 0, used: 0, usage: {}, managersUsed: [], freeLeft };
      event(s, 'NeighbourCardUsed', { playerId: p.id, ownerId: right.id, cardId: src.id, managers: cardManagers(card) });
      automaticEffects(s, defs); break;
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
