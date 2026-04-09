import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../server/lib/auth';

describe('server auth helpers', () => {
  it('verifies hashes created with the current format', () => {
    const hash = hashPassword('password-123');

    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('password-123', hash)).toBe(true);
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('remains compatible with legacy static-salt hashes', () => {
    const legacyHash = scryptSync('password-123', 'ivy-static-salt', 64).toString('hex');

    expect(verifyPassword('password-123', legacyHash)).toBe(true);
    expect(verifyPassword('wrong-password', legacyHash)).toBe(false);
  });
});
