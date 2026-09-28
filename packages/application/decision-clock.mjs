// Optional advisory clock. Time never mutates the domain or the replay journal.
export function decisionKey(state) {
  if (!state || !state.config.turnSeconds || state.phase === 'finished') return null;
  if (state.phase === 'auction') return `${state.round}:auction:${state.revision}`;
  if (state.phase === 'settlement') {
    const f = state.settlement;
    return f.pending ? `${state.round}:compensation:${f.index}:${f.cursor}:${f.pending.playerId}` : null;
  }
  return `${state.round}:${state.phase}:${state.players[state.turn].id}`;
}
export class DecisionClock {
  constructor(now = () => Date.now()) { this.now = now; this.value = null; }
  sync(key, seconds, saved = null) {
    if (!key || !seconds) { this.value = null; return null; }
    const candidate = this.value?.key === key ? this.value : saved;
    const now = this.now();
    this.value = candidate?.key === key && Number.isFinite(candidate.deadline) && candidate.deadline <= now + seconds * 1000
      ? { key, deadline: candidate.deadline } : { key, deadline: now + seconds * 1000 };
    return { ...this.value };
  }
  remaining() { return this.value ? Math.max(0, Math.ceil((this.value.deadline - this.now()) / 1000)) : null; }
}
