// Настройки сервера берутся из переменных окружения. Значения по умолчанию безопасны
// для запуска на своём компьютере; для публичного хостинга см. docs/07-deployment.md.
import path from 'node:path';

const env = process.env;
const flag = (name, fallback = false) => {
  const v = env[name];
  return v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const int = (name, fallback, min, max) => {
  const n = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: целое число от ${min} до ${max}`);
  return n;
};

/** @param {Record<string,string|undefined>} [overrides] значения для тестов */
export function loadConfig(overrides = {}) {
  const saved = { ...env };
  Object.assign(env, overrides);
  try {
    const registration = (env.REGISTRATION || 'open').toLowerCase();
    if (!['open', 'invite', 'closed'].includes(registration)) throw new Error('REGISTRATION: open, invite или closed');
    const inviteCode = env.INVITE_CODE || '';
    if (registration === 'invite' && inviteCode.length < 6) throw new Error('INVITE_CODE: при REGISTRATION=invite нужен код не короче 6 символов');
    const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
    if (publicOrigin && !/^https?:\/\/[^/\s]+$/.test(publicOrigin)) throw new Error('PUBLIC_ORIGIN: например https://industry.example.com');
    return {
      port: int('PORT', 8080, 0, 65535),
      host: env.HOST || '127.0.0.1',
      dataDir: path.resolve(env.DATA_DIR || 'data'),
      publicOrigin,
      trustProxy: flag('TRUST_PROXY'),
      registration,
      inviteCode,
      sessionDays: int('SESSION_DAYS', 14, 1, 90),
      sessionSecret: env.SESSION_SECRET || '',
      maxTablesPerUser: int('MAX_TABLES_PER_USER', 10, 1, 100),
      maxUsers: int('MAX_USERS', 500, 1, 100000),
    };
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete env[key]; else env[key] = saved[key];
    }
  }
}
