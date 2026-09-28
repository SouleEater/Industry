import { createGame, dispatch, RULES_VERSION } from '../domain/engine.mjs';

export function restore(record, pack) {
  if (!record || record.schemaVersion !== 1 || ![RULES_VERSION, 'prototype-0.1'].includes(record.rulesVersion) || record.contentVersion !== pack.version)
    throw new Error('Сохранение относится к другой версии игры. Оно не будет перезаписано автоматически.');
  if (!Array.isArray(record.commands) || record.commands.length > 10000) throw new Error('Повреждён журнал сохранения.');
  let state = createGame(record.rulesVersion === 'prototype-0.1' ? { ...record.options, planning: false, productionChain: false, turnSeconds: 0 } : record.options, pack);
  for (const command of record.commands) state = dispatch(state, command, pack.definitions);
  return state;
}

// Storage port: load(): object|null; save(record): void. Infrastructure is injected.
export class GameSession {
  constructor(pack, storage) { this.pack = pack; this.storage = storage; this.state = null; this.record = null; this.storageError = null; }
  load() {
    const record = this.storage.load();
    if (record) {
      const state = restore(record, this.pack);
      this.record = record.rulesVersion === 'prototype-0.1' ? { ...record, rulesVersion: RULES_VERSION, options: { ...record.options, planning: false, productionChain: false, turnSeconds: 0 } } : record;
      this.state = state;
    }
    return this.state;
  }
  start(options) {
    const state = createGame(options, this.pack);
    this.state = state;
    this.record = { schemaVersion: 1, rulesVersion: RULES_VERSION, contentVersion: this.pack.version, options: structuredClone(options), commands: [] };
    this.persist(); return this.state;
  }
  send(command) {
    const accepted = { ...command, expectedRevision: this.state.revision };
    const next = dispatch(this.state, accepted, this.pack.definitions);
    this.state = next; this.record.commands.push(structuredClone(accepted)); this.persist(); return next;
  }
  persist() {
    try { this.storage.save(this.record); this.storageError = null; }
    catch { this.storageError = 'Не удалось сохранить партию на этом устройстве. Не закрывайте страницу.'; }
  }
}
