import { describe, expect, it } from 'vitest';
import { consumeRateLimit } from '../server/lib/rateLimit';

describe('server rate limit helper', () => {
  it('allows up to burst capacity and then rejects until refill', () => {
    const table = new Map<string, { tokens: number; lastRefillMs: number }>();
    const key = 'vehicle-1';
    const start = 1_000;

    expect(consumeRateLimit(table, key, 2, start, 2)).toBe(true);
    expect(consumeRateLimit(table, key, 2, start, 2)).toBe(true);
    expect(consumeRateLimit(table, key, 2, start, 2)).toBe(true);
    expect(consumeRateLimit(table, key, 2, start, 2)).toBe(true);
    expect(consumeRateLimit(table, key, 2, start, 2)).toBe(false);

    expect(consumeRateLimit(table, key, 2, start + 500, 2)).toBe(true);
    expect(consumeRateLimit(table, key, 2, start + 500, 2)).toBe(false);
  });
});
