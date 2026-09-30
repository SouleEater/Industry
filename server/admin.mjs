// Администрирование без веб-интерфейса (почты для восстановления пароля нет):
//   node server/admin.mjs users                      список пользователей
//   node server/admin.mjs reset-password <логин>     новый временный пароль, все сессии закрываются
//   node server/admin.mjs delete-user <логин>        удалить пользователя, его места и столы
// Каталог данных берётся из DATA_DIR, как у сервера. В Docker:
//   docker compose exec app node server/admin.mjs users
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { hashPassword, usernameKey } from './auth.mjs';

export function listUsers(store) {
  return store.db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all()
    .map(u => ({ id: Number(u.id), username: u.username, createdAt: new Date(u.created_at).toISOString() }));
}

/** Возвращает временный пароль; пользователь должен сменить его после входа. */
export async function resetPassword(store, username) {
  const row = store.q.userByName.get(usernameKey(username));
  if (!row) throw new Error(`Нет пользователя «${username}».`);
  const temp = crypto.randomBytes(9).toString('base64url');   // 12 символов
  const hash = await hashPassword(temp);
  store.tx(() => { store.q.delUserSessions.run(row.id); store.q.setHash.run(hash, row.id); });
  return temp;
}

export function deleteUser(store, username) {
  const row = store.q.userByName.get(usernameKey(username));
  if (!row) throw new Error(`Нет пользователя «${username}».`);
  // Столы, где он хозяин и единственный игрок, удаляются каскадом; остальные передают стол другому.
  store.tx(() => {
    for (const t of store.db.prepare('SELECT code FROM tables WHERE host_id = ?').all(row.id)) {
      const others = store.q.seats.all(t.code).filter(s => Number(s.user_id) !== Number(row.id));
      if (others.length) store.q.setHost.run(others[0].user_id, Date.now(), t.code); else store.q.delTable.run(t.code);
    }
    store.db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, name] = process.argv.slice(2);
  const config = loadConfig();
  const store = openStore(config.dataDir);
  try {
    if (command === 'users') {
      for (const u of listUsers(store)) console.log(`${u.id}\t${u.username}\t${u.createdAt}`);
    } else if (command === 'reset-password' && name) {
      const temp = await resetPassword(store, name);
      console.log(`Временный пароль для «${name}»: ${temp}\nПередайте его владельцу; после входа пароль нужно сменить (Аккаунт → Сменить пароль).`);
    } else if (command === 'delete-user' && name) {
      deleteUser(store, name);
      console.log(`Пользователь «${name}» удалён.`);
    } else {
      console.log('Команды: users | reset-password <логин> | delete-user <логин>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  } finally { store.close(); }
}
