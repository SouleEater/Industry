export class RuleError extends Error {
  constructor(code, message) { super(message); this.name = 'RuleError'; this.code = code; }
}
export function requireRule(condition, code, message) {
  if (!condition) throw new RuleError(code, message);
}
export const RESOURCES = ['coal', 'metal', 'oil', 'upgrade'];
export const ASSETS = [...RESOURCES, 'money'];
export const emptyWallet = () => Object.fromEntries(ASSETS.map(k => [k, 0]));
export function integer(n, min = 0) { return Number.isSafeInteger(n) && n >= min; }
export function validateWallet(wallet) {
  requireRule(wallet && typeof wallet === 'object', 'INVALID_WALLET', 'Не указан запас ресурсов.');
  for (const [k, v] of Object.entries(wallet))
    requireRule(ASSETS.includes(k) && integer(v), 'INVALID_WALLET', 'Ресурсы должны быть неотрицательными целыми.');
}
export function canPay(wallet, cost, times = 1) {
  return Object.entries(cost).every(([k, v]) => wallet[k] >= v * times);
}
export function transfer(wallet, cost = {}, gain = {}, times = 1) {
  requireRule(integer(times), 'INVALID_COUNT', 'Количество должно быть целым и неотрицательным.');
  requireRule(canPay(wallet, cost, times), 'INSUFFICIENT_RESOURCES', 'Недостаточно ресурсов.');
  for (const k of ASSETS) {
    const value = wallet[k] - (cost[k] ?? 0) * times + (gain[k] ?? 0) * times;
    requireRule(integer(value), 'INVALID_AMOUNT', 'Количество ресурса вне допустимого диапазона.');
    wallet[k] = value;
  }
}
export function classifyConversion(effect) {
  return { sale: (effect.gain.money ?? 0) > 0,
    exchange: RESOURCES.some(k => (effect.gain[k] ?? 0) > 0) };
}
export function shuffle(items, seed) {
  const result = [...items]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { items: result, seed: state };
}
export function rankPlayers(players) {
  const rows = players.map(p => ({ id: p.id, name: p.name, money: p.wallet.money,
    companies: p.cards.length, resources: RESOURCES.reduce((n, k) => n + p.wallet[k], 0) }));
  rows.sort((a, b) => b.money - a.money || b.companies - a.companies || b.resources - a.resources);
  const first = rows[0];
  return rows.map(p => ({ ...p, winner: p.money === first.money && p.companies === first.companies && p.resources === first.resources }));
}
