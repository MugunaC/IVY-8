export interface RateLimitState {
  tokens: number;
  lastRefillMs: number;
}

export function consumeRateLimit(
  table: Map<string, RateLimitState>,
  key: string,
  ratePerSec: number,
  nowMs: number,
  burstMultiplier: number
) {
  const refillRate = Math.max(1, ratePerSec);
  const burstCapacity = Math.max(1, refillRate * Math.max(1, burstMultiplier));
  const state = table.get(key) || { tokens: burstCapacity, lastRefillMs: nowMs };
  const elapsed = Math.max(0, nowMs - state.lastRefillMs);
  const refill = (elapsed / 1000) * refillRate;
  state.tokens = Math.min(burstCapacity, state.tokens + refill);
  state.lastRefillMs = nowMs;

  if (state.tokens < 1) {
    table.set(key, state);
    return false;
  }

  state.tokens -= 1;
  table.set(key, state);
  return true;
}
