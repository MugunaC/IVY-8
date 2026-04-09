import { describe, expect, it } from 'vitest';
import { userSchema } from '@shared/schemas';
import {
  readArrayWithSchema,
  readJson,
  STORAGE_KEYS,
  writeJson,
} from '@/app/data/storage';

const validUser = {
  id: 'user-123',
  username: 'valid',
  role: 'user' as const,
};

describe('storage helpers', () => {
  it('filters invalid items when reading arrays', () => {
    writeJson('ivy.testUsers', [validUser, { id: 1 }]);
    const result = readArrayWithSchema('ivy.testUsers', userSchema);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(validUser);
    expect(result.valid).toBe(false);
  });

  it('does not seed server-owned domain entities into local storage', () => {
    expect(localStorage.getItem('ivy.users')).toBeNull();
    expect(localStorage.getItem('ivy.vehicles')).toBeNull();
  });

  it('returns fallback for missing keys', () => {
    const missing = readJson(STORAGE_KEYS.logs, []);
    expect(missing).toEqual([]);
  });

  it('caps stored logs to a bounded size window', () => {
    const logs = Array.from({ length: 650 }, (_, index) => ({
      id: `log-${index}`,
      userId: 'user-1',
      username: 'user1',
      action: 'login' as const,
      timestamp: new Date(index).toISOString(),
    }));

    writeJson(STORAGE_KEYS.logs, logs);
    const stored = readJson<typeof logs>(STORAGE_KEYS.logs, []);

    expect(stored).toHaveLength(500);
    expect(stored[0]?.id).toBe('log-150');
    expect(stored[stored.length - 1]?.id).toBe('log-649');
  });
});
