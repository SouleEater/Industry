import { requireRule, emptyWallet, validateWallet, integer, canPay, transfer, shuffle, rankPlayers, classifyConversion } from './rules.mjs';

export const RULES_VERSION = 'prototype-0.2';
function definition(definitions, id) {
  requireRule(Object.hasOwn(definitions, id), 'UNKNOWN_CARD', 'Неизвестная карта.');
  return definitions[id];
}
function validateEffect(e, compensation = false) {
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

export function createGame({ names = ['Игрок 1', 'Игрок 2', 'Игрок 3'], variableCapital = false, seed = 2026, planning = true, productionChain = false, turnSeconds = 0 } = {}, pack) {
  requireRule(Array.isArray(names) && [3, 4].includes(names.length), 'UNSUPPORTED_CONFIG', 'Учебный стол поддерживает 3 или 4 игроков.');
  requireRule(names.every(n => typeof n === 'string' && n.trim().length > 0 && n.length <= 40), 'INVALID_NAME', 'Имя должно содержать от 1 до 40 символов.');
  requireRule(typeof variableCapital === 'boolean' && integer(seed) && seed <= 0xffffffff, 'INVALID_CONFIG', 'Некорректная настройка партии.');
  requireRule(typeof planning === 'boolean' && typeof productionChain === 'boolean' && (!productionChain || planning), 'INVALID_CONFIG', 'Цепочка требует планирования.');
  requireRule(integer(turnSeconds) && turnSeconds <= 3600, 'INVALID_CONFIG', 'Таймер: 0 (выключен) или 1–3600 секунд.');
  requireRule(pack && typeof pack.version === 'string' && Array.isArray(pack.deck), 'INVALID_PACK', 'Не указан контент-пакет.');
  for (const d of Object.values(pack.definitions)) {
    requireRule(['company', 'startup'].includes(d.kind), 'INVALID_PACK', 'Неизвестный тип карты.');
    requireRule(Array.isArray(d.effects) && d.effects.length > 0, 'INVALID_PACK', 'У карты нет эффектов.');
    d.effects.forEach(e => validateEffect(e));
    (d.advanced ?? []).forEach(e => validateEffect(e));
    if (d.kind === 'company') validateEffect(d.compensation, true);
  }
  const start = definition(pack.definitions, pack.startupId);
  requireRule(start.kind === 'startup', 'INVALID_PACK', 'Стартовая карта должна быть стартовым предприятием.');
  validateWallet(start.starting);
  requireRule(pack.deck.length >= (names.length + 4 + Number(variableCapital)) * 4, 'SHORT_DECK', 'Недостаточно карт для четырёх раундов.');
  pack.deck.forEach(id => requireRule(definition(pack.definitions, id).kind === 'company', 'INVALID_PACK', 'В колоде должна быть карта предприятия.'));
  const s = { schemaVersion: 1, rulesVersion: RULES_VERSION, contentVersion: pack.version,
    revision: 0, config: { variableCapital, planning, productionChain, turnSeconds }, rng: seed, round: 1, firstPlayer: 0, turn: 0,
    phase: 'auction', deck: pack.deck.map((definitionId, i) => ({ id: `c${i}`, definitionId, upgraded: false, usedRound: 0 })),
    players: names.map((name, i) => ({ id: `p${i}`, name: name.trim(), wallet: { ...emptyWallet(), ...start.starting, coal: (start.starting.coal ?? 0) + Number(variableCapital) },
      cards: [{ id: `start${i}`, definitionId: pack.startupId, upgraded: false, usedRound: 0 }],
      discs: [], blocked: false, done: false })), lots: [], discard: [], settlement: null, production: null, events: [] };
  event(s, 'GameStarted'); startAuction(s); return s;
}
function startAuction(s) {
  const shuffled = shuffle(s.deck, s.rng); s.deck = shuffled.items; s.rng = shuffled.seed;
  const count = s.players.length + 4 + Number(s.config.variableCapital);
  s.lots = s.deck.splice(0, count).map((card, i) => ({ id: `r${s.round}l${i}`, card, bids: [], resolved: false }));
  for (const p of s.players) {
    p.lockedOrder = p.cards.map(c => c.id); p.planned = false;
    p.discs = [1, 2, 3, 4].map(value => ({ id: `fixed${value}`, kind: 'fixed', value, used: false }));
    if (s.config.variableCapital) p.discs.push({ id: 'variable', kind: 'variable', value: 0, used: false });
    p.blocked = false; p.done = false;
  }
  s.phase = 'auction'; s.turn = s.firstPlayer; s.settlement = null; s.production = null;
  event(s, 'AuctionStarted', { count });
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
  const d = p.discs.find(d => d.id === discId);
  if (!d || d.used || p.blocked) return 'Диск недоступен.';
  const v = d.kind === 'fixed' ? d.value : value;
  if (!integer(v)) return 'Значение должно быть целым и неотрицательным.';
  if (d.kind === 'variable' && v > p.wallet.coal) return 'Не хватает угля для этой ставки.';
  if (lot.bids.some(b => b.playerId === playerId)) return 'На предприятии уже есть ваш диск.';
  if (lot.bids.some(b => b.value === v)) return 'Такое значение уже стоит на предприятии.';
  return null;
}
function canBidAnywhere(s, p) {
  if (p.blocked) return false;
  return p.discs.some(d => !d.used && s.lots.some(l => {
    if (l.bids.some(b => b.playerId === p.id)) return false;
    if (d.kind === 'fixed') return !l.bids.some(b => b.value === d.value);
    // At most N opponents forbid N values: checking 0..N is sufficient, even for huge coal stocks.
    for (let v = 0; v <= Math.min(p.wallet.coal, l.bids.length); v++)
      if (!l.bids.some(b => b.value === v)) return true;
    return false;
  }));
}
function advanceBid(s) {
  for (let step = 1; step <= s.players.length; step++) {
    const next = (s.turn + step) % s.players.length, p = s.players[next];
    if (canBidAnywhere(s, p)) { s.turn = next; return; }
    p.blocked = true;
  }
  s.phase = 'settlement'; s.settlement = { index: 0, cursor: 0, queue: null, pending: null };
  event(s, 'AuctionClosed');
}
function resolveLot(s, defs) {
  const flow = s.settlement, lot = s.lots[flow.index];
  requireRule(!flow.pending, 'CHOICE_REQUIRED', 'Сначала выберите компенсацию.');
  if (!flow.queue) flow.queue = [...lot.bids].sort((a, b) => a.value - b.value);
  const losers = flow.queue.slice(0, -1), effect = definition(defs, lot.card.definitionId).compensation;
  while (flow.cursor < losers.length) {
    const bid = losers[flow.cursor], p = player(s, bid.playerId);
    if (effect.kind === 'gain') {
      transfer(p.wallet, {}, effect.gain, bid.value);
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, gain: effect.gain, times: bid.value }); flow.cursor++;
    } else if (bid.value === 0 || !canPay(p.wallet, effect.cost)) {
      event(s, 'Compensation', { playerId: p.id, lotId: lot.id, times: 0 }); flow.cursor++;
    } else { flow.pending = { playerId: p.id, effect, limit: bid.value }; return; }
  }
  const winner = flow.queue.at(-1);
  if (winner) {
    player(s, winner.playerId).cards.push(lot.card);
    event(s, 'CardWon', { playerId: winner.playerId, cardId: lot.card.id, definitionId: lot.card.definitionId });
  } else { s.discard.push(lot.card); event(s, 'CardDiscarded', { cardId: lot.card.id }); }
  lot.resolved = true; flow.index++; flow.cursor = 0; flow.queue = null;
  if (flow.index === s.lots.length) {
    s.phase = s.config.planning ? 'planning' : 'production'; s.turn = s.firstPlayer; s.production = { active: null };
    for (const p of s.players) for (const d of p.discs) { d.used = false; if (d.kind === 'variable') d.value = 0; }
    event(s, s.config.planning ? 'PlanningStarted' : 'ProductionStarted');
  }
}
export function activeEffect(s, defs) {
  const active = s.production?.active;
  if (!active) return null;
  const card = owned(player(s, active.playerId), active.cardId), d = definition(defs, card.definitionId);
  return [...d.effects, ...(card.upgraded ? d.advanced ?? [] : [])][active.index] ?? null;
}
function automaticEffects(s, defs) {
  while (s.production.active) {
    const a = s.production.active, e = activeEffect(s, defs), p = player(s, a.playerId);
    if (!e) {
      owned(p, a.cardId).usedRound = s.round;
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
  const s = structuredClone(state), p = player(s, command.actorId);
  switch (command.type) {
    case 'Bid': {
      phase(s, 'auction');
      const error = bidError(s, p.id, command.discId, command.lotId, command.value);
      requireRule(!error, 'ILLEGAL_BID', error);
      const d = p.discs.find(d => d.id === command.discId), lot = s.lots.find(l => l.id === command.lotId);
      if (d.kind === 'variable') { transfer(p.wallet, { coal: command.value }); d.value = command.value; }
      d.used = true; lot.bids.push({ playerId: p.id, discId: d.id, kind: d.kind, value: d.value });
      event(s, 'BidPlaced', { playerId: p.id, lotId: lot.id, value: d.value, discKind: d.kind }); advanceBid(s); break;
    }
    case 'ResolveLot': phase(s, 'settlement'); resolveLot(s, defs); break;
    case 'Compensate': {
      phase(s, 'settlement'); const flow = s.settlement, choice = flow.pending;
      requireRule(choice, 'NO_CHOICE', 'Нет ожидаемой компенсации.');
      convert(s, p, choice.effect, command.times, choice.limit, { context: 'compensation' });
      event(s, 'CompensationChosen', { playerId: p.id, times: command.times });
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
      s.production.active = { playerId: p.id, cardId: card.id, index: 0, used: 0 };
      event(s, 'CardStarted', { playerId: p.id, cardId: card.id }); automaticEffects(s, defs); break;
    }
    case 'Convert': {
      phase(s, 'production'); const e = activeEffect(s, defs), a = s.production.active;
      requireRule(e?.kind === 'convert', 'WRONG_EFFECT', 'Сейчас не эффект переработки.');
      requireRule(integer(command.times, 1), 'INVALID_COUNT', 'Выберите хотя бы одну операцию или пропустите эффект.');
      convert(s, p, e, command.times, e.limit - a.used, { cardId: a.cardId, context: 'production' });
      a.used += command.times; break;
    }
    case 'NextEffect': {
      phase(s, 'production'); requireRule(s.production.active, 'NO_ACTIVE_CARD', 'Сначала выберите предприятие.');
      s.production.active.index++; s.production.active.used = 0; automaticEffects(s, defs); break;
    }
    case 'Upgrade': {
      phase(s, 'production'); requireRule(activeEffect(s, defs)?.kind === 'upgrade', 'WRONG_EFFECT', 'Модернизация доступна только по эффекту.');
      const card = owned(p, command.cardId);
      requireRule(!card.upgraded && definition(defs, card.definitionId).kind === 'company', 'CANNOT_UPGRADE', 'Эту карту нельзя модернизировать.');
      transfer(p.wallet, { coal: 1, upgrade: 1 }); card.upgraded = true;
      event(s, 'CardUpgraded', { playerId: p.id, cardId: card.id }); break;
    }
    case 'FinishProduction': {
      phase(s, 'production'); requireRule(!s.production.active, 'CARD_ACTIVE', 'Завершите текущее предприятие.');
      requireRule(p.cards.every(c => c.usedRound === s.round), 'CARDS_REMAIN', 'Используйте оставшиеся предприятия.');
      p.done = true;
      if (s.players.every(p => p.done)) {
        if (s.round === 4) { s.phase = 'finished'; s.result = rankPlayers(s.players); event(s, 'GameFinished'); }
        else { s.round++; s.firstPlayer = (s.firstPlayer + 1) % s.players.length; startAuction(s); }
      } else {
        do { s.turn = (s.turn + 1) % s.players.length; } while (s.players[s.turn].done);
      }
      break;
    }
    default: requireRule(false, 'INVALID_COMMAND', 'Неизвестная команда.');
  }
  s.players.forEach(p => validateWallet(p.wallet)); s.revision++; return s;
}
