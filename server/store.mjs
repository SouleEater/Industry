// Хранилище на встроенном SQLite (node:sqlite): пользователи, сессии, столы и места.
// Состояние партии хранится как JSON; правила исполняет ядро из packages/domain.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'industry.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS tables (
      code TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'finished')),
      is_public INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL,
      state TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seats (
      code TEXT NOT NULL REFERENCES tables(code) ON DELETE CASCADE,
      seat INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (code, seat),
      UNIQUE (code, user_id)
    );
  `);
  try { fs.chmodSync(path.join(dataDir, 'industry.db'), 0o600); } catch { /* Windows */ }

  const q = {
    userByName: db.prepare('SELECT id, username, pass_hash FROM users WHERE username_key = ?'),
    userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
    userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
    addUser: db.prepare('INSERT INTO users (username, username_key, pass_hash, created_at) VALUES (?, ?, ?, ?)'),
    setHash: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(`SELECT s.token_hash, s.expires_at, u.id AS user_id, u.username
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

    table: db.prepare('SELECT * FROM tables WHERE code = ?'),
    addTable: db.prepare(`INSERT INTO tables (code, host_id, status, is_public, options, created_at, updated_at)
      VALUES (?, ?, 'lobby', ?, ?, ?, ?)`),
    setHost: db.prepare('UPDATE tables SET host_id = ?, updated_at = ? WHERE code = ?'),
    startTable: db.prepare(`UPDATE tables SET status = 'playing', state = ?, revision = ?, updated_at = ? WHERE code = ?`),
    saveState: db.prepare('UPDATE tables SET state = ?, revision = ?, status = ?, updated_at = ? WHERE code = ?'),
    touchTable: db.prepare('UPDATE tables SET updated_at = ? WHERE code = ?'),
    delTable: db.prepare('DELETE FROM tables WHERE code = ?'),
    countHosted: db.prepare(`SELECT COUNT(*) AS n FROM tables WHERE host_id = ? AND status != 'finished'`),

    seats: db.prepare(`SELECT s.seat, s.user_id, u.username FROM seats s JOIN users u ON u.id = s.user_id
      WHERE s.code = ? ORDER BY s.seat`),
    addSeat: db.prepare('INSERT INTO seats (code, seat, user_id) VALUES (?, ?, ?)'),
    delSeat: db.prepare('DELETE FROM seats WHERE code = ? AND user_id = ?'),
    mySeat: db.prepare('SELECT seat FROM seats WHERE code = ? AND user_id = ?'),

    myTables: db.prepare(`SELECT t.code, t.status, t.updated_at, t.host_id, h.username AS host,
        (SELECT COUNT(*) FROM seats WHERE code = t.code) AS players
      FROM tables t JOIN seats s ON s.code = t.code AND s.user_id = ? JOIN users h ON h.id = t.host_id
      ORDER BY t.updated_at DESC LIMIT 30`),
    openTables: db.prepare(`SELECT t.code, t.updated_at, h.username AS host,
        (SELECT COUNT(*) FROM seats WHERE code = t.code) AS players
      FROM tables t JOIN users h ON h.id = t.host_id
      WHERE t.status = 'lobby' AND t.is_public = 1
        AND (SELECT COUNT(*) FROM seats WHERE code = t.code) < 4
        AND NOT EXISTS (SELECT 1 FROM seats WHERE code = t.code AND user_id = ?)
      ORDER BY t.created_at DESC LIMIT 30`),
    staleLobbies: db.prepare(`DELETE FROM tables WHERE status = 'lobby' AND updated_at < ?`),
    staleFinished: db.prepare(`DELETE FROM tables WHERE status = 'finished' AND updated_at < ?`),
    staleAbandoned: db.prepare(`DELETE FROM tables WHERE status = 'playing' AND updated_at < ?`),
  };

  /** Выполняет функцию в транзакции: всё или ничего. */
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { db, q, tx, close: () => db.close() };
}
