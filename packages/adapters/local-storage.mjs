export function localStorageAdapter(storage, key = 'industry.training.v1') {
  return {
    load() { const raw = storage.getItem(key); if (!raw) return null;
      if (raw.length > 2000000) throw new Error('Сохранение слишком велико.');
      try { return JSON.parse(raw); } catch { throw new Error('Сохранение повреждено. Начните новую учебную партию явно.'); }
    },
    save(record) { storage.setItem(key, JSON.stringify(record)); },
  };
}
