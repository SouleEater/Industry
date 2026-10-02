// Столы: комната ожидания, места, старт партии и ходы. Правила исполняет ядро
// packages/domain; сервер лишь проверяет, кто именно ходит, и рассылает результат.
import crypto from 'node:crypto';
import { createGame, dispatch, currentActor } from '../packages/domain/engine.mjs';
import { basePack } from '../packages/content/base-pack.mjs';
import { RuleError } from '../packages/domain/rules.mjs';

const DEFS = basePack.definitions;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OPTION_KEYS = ['expansion', 'universities', 'chain', 'variable', 'capitalists'];
const MAX_SEATS = 5;   // пятый игрок — правило «Интербеллума»

export class GameError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

/** Только булевы настройки из белого списка: остальное клиент прислать не может. */
export function cleanOptions(input = {}) {
  const out = {};
  for (const key of OPTION_KEYS) out[key] = input?.[key] === true;
  return out;
}

/** Игрокам не нужен порядок колоды и состояние генератора: по ним можно узнать будущие лоты. */
export function publicState(state) {
  if (!state) return null;
  const { deck, rng, managerDeck, ...rest } = state;
  return { ...rest, events: state.events.slice(-300), deckSize: deck?.length ?? 0 };
}

export function createGames({ store, config }) {
  const { q, tx } = store;
  const subscribers = new Map();   // code -> Set<{ res, userId }>

  function seatsOf(code) {
    return q.seats.all(code).map(s => ({ seat: s.seat, userId: Number(s.user_id), username: s.username }));
  }

  /** Вид стола для всех участников. Личное («вы») клиент выводит по своему логину. */
  function viewOf(row) {
    const seats = seatsOf(row.code);
    const host = seats.length ? q.userById.get(row.host_id) : null;
    return {
      code: row.code,
      status: row.status,
      isPublic: Boolean(row.is_public),
      host: host?.username ?? null,
      options: JSON.parse(row.options),
      seats: seats.map(({ seat, username }) => ({ seat, username })),
      revision: row.revision,
      state: row.state ? publicState(JSON.parse(row.state)) : null,
    };
  }

  function push(code) {
    const set = subscribers.get(code);
    if (!set?.size) return;
    const row = q.table.get(code);
    const data = row ? JSON.stringify(viewOf(row)) : JSON.stringify({ code, status: 'deleted' });
    for (const { res } of set) res.write(`event: view\ndata: ${data}\n\n`);
  }

  function requireTable(code) {
    const row = typeof code === 'string' ? q.table.get(code.toUpperCase()) : null;
    if (!row) throw new GameError(404, 'Стол не найден.');
    return row;
  }
  function requireSeat(row, userId) {
    const mine = q.mySeat.get(row.code, userId);
    if (!mine) throw new GameError(403, 'Вы не сидите за этим столом.');
    return Number(mine.seat);
  }

  return {
    create(user, body) {
      if (q.countHosted.get(user.id).n >= config.maxTablesPerUser)
        throw new GameError(429, `Нельзя вести больше ${config.maxTablesPerUser} столов одновременно.`);
      const options = cleanOptions(body?.options);
      const now = Date.now();
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = newCode();
        try {
          tx(() => {
            q.addTable.run(code, user.id, body?.isPublic === true ? 1 : 0, JSON.stringify(options), now, now);
            q.addSeat.run(code, 0, user.id);
          });
          return viewOf(q.table.get(code));
        } catch (error) {
          if (!/UNIQUE|PRIMARY/i.test(String(error.message))) throw error;
        }
      }
      throw new GameError(500, 'Не удалось создать стол. Повторите.');
    },

    get(user, code) {
      const row = requireTable(code);
      const seated = q.mySeat.get(row.code, user.id);
      // Комнату ожидания может посмотреть любой вошедший (так вводят код); партию — только игроки.
      if (row.status !== 'lobby' && !seated) throw new GameError(403, 'Партия уже идёт, вы в ней не участвуете.');
      return { ...viewOf(row), mySeat: seated ? Number(seated.seat) : null };
    },

    list(user) {
      const mine = q.myTables.all(user.id).map(t => ({
        code: t.code, status: t.status, host: t.host, players: Number(t.players), updatedAt: t.updated_at,
      }));
      const open = q.openTables.all(user.id).map(t => ({
        code: t.code, host: t.host, players: Number(t.players), updatedAt: t.updated_at,
      }));
      return { mine, open };
    },

    join(user, code) {
      const row = requireTable(code);
      const result = tx(() => {
        if (row.status !== 'lobby') throw new GameError(409, 'Партия уже началась.');
        if (q.mySeat.get(row.code, user.id)) return;
        const taken = new Set(seatsOf(row.code).map(s => s.seat));
        if (taken.size >= MAX_SEATS) throw new GameError(409, 'За столом нет свободных мест.');
        let seat = 0; while (taken.has(seat)) seat++;
        q.addSeat.run(row.code, seat, user.id);
        q.touchTable.run(Date.now(), row.code);
        return true;
      });
      if (result) push(row.code);
      return this.get(user, row.code);
    },

    leave(user, code) {
      const row = requireTable(code);
      requireSeat(row, user.id);
      if (row.status !== 'lobby') throw new GameError(409, 'Из начатой партии выйти нельзя: место остаётся за вами.');
      tx(() => {
        q.delSeat.run(row.code, user.id);
        const rest = seatsOf(row.code);
        if (!rest.length) q.delTable.run(row.code);
        else if (row.host_id === user.id) q.setHost.run(rest[0].userId, Date.now(), row.code);
      });
      push(row.code);
      return { ok: true };
    },

    start(user, code) {
      const row = requireTable(code);
      if (row.host_id !== user.id) throw new GameError(403, 'Начать партию может только хозяин стола.');
      const state = tx(() => {
        const fresh = q.table.get(row.code);
        if (fresh.status !== 'lobby') throw new GameError(409, 'Партия уже началась.');
        let seats = seatsOf(row.code);
        if (seats.length < 2) throw new GameError(409, 'Для игры нужно хотя бы два человека.');
        // Места после выхода из комнаты могут идти с пропуском (0, 2, 3): номер места должен
        // совпадать с номером игрока в партии, поэтому перед стартом места сдвигаются подряд.
        seats.forEach((st, i) => { if (st.seat !== i) q.moveSeat.run(i, row.code, st.userId); });
        seats = seatsOf(row.code);
        const o = JSON.parse(fresh.options);
        const game = createGame({
          names: seats.map(s => s.username),
          seed: crypto.randomInt(0, 2 ** 32),
          planning: true, randomFirst: true,
          expansion: o.expansion, universities: o.universities, productionChain: o.chain,
          variableCapital: o.variable, capitalists: o.capitalists,
        }, basePack);
        q.startTable.run(JSON.stringify(game), game.revision, Date.now(), row.code);
        return game;
      });
      push(row.code);
      return { started: true, revision: state.revision };
    },

    /** Ход игрока. Клиент присылает команду и ревизию, на которую смотрел. */
    command(user, code, body) {
      const row = requireTable(code);
      const seat = requireSeat(row, user.id);
      const command = body?.command;
      if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.type !== 'string' || command.type.length > 40)
        throw new GameError(400, 'Некорректная команда.');
      if (!Number.isSafeInteger(command.expectedRevision))
        throw new GameError(400, 'Не указана ревизия партии.');

      const result = tx(() => {
        const fresh = q.table.get(row.code);
        if (fresh.status !== 'playing') throw new GameError(409, fresh.status === 'lobby' ? 'Партия ещё не началась.' : 'Партия окончена.');
        const state = JSON.parse(fresh.state);
        // Играть можно только за своё место. Нейтральный разбор лота может подать любой игрок,
        // чтобы партия не встала, если хозяин отключился.
        const actorId = command.type === 'ResolveLot' ? currentActor(state) : `p${seat}`;
        let next;
        try {
          next = dispatch(state, { ...command, actorId }, DEFS);
        } catch (error) {
          if (error instanceof RuleError) throw new GameError(422, error.message, { code: error.code });
          throw error;
        }
        const status = next.phase === 'finished' ? 'finished' : 'playing';
        q.saveState.run(JSON.stringify(next), next.revision, status, Date.now(), row.code);
        return next;
      });
      push(row.code);
      return { revision: result.revision, state: publicState(result) };
    },

    /** Подписка на обновления стола (Server-Sent Events). */
    subscribe(user, code, res) {
      const row = requireTable(code);
      if (row.status !== 'lobby') requireSeat(row, user.id);
      const set = subscribers.get(row.code) ?? new Set();
      const mineNow = [...subscribers.values()].reduce((n, s) => n + [...s].filter(x => x.userId === user.id).length, 0);
      if (mineNow >= 6) throw new GameError(429, 'Слишком много открытых подключений.');
      const entry = { res, userId: user.id };
      set.add(entry); subscribers.set(row.code, set);
      const timer = setInterval(() => res.write(': ping\n\n'), 20000);
      timer.unref?.();
      res.on('close', () => { clearInterval(timer); set.delete(entry); if (!set.size) subscribers.delete(row.code); });
      res.write(`event: view\ndata: ${JSON.stringify(viewOf(row))}\n\n`);
    },

    housekeeping() {
      const day = 24 * 3600 * 1000, now = Date.now();
      q.staleLobbies.run(now - day);
      q.staleFinished.run(now - 30 * day);
      q.staleAbandoned.run(now - 60 * day);
    },

    closeAll() {
      for (const set of subscribers.values()) for (const { res } of set) res.end();
      subscribers.clear();
    },
  };
}
