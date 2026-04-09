import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const LEGACY_STATIC_SALT = 'ivy-static-salt';
const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

function encodeSalt(buffer: Buffer) {
  return buffer.toString('hex');
}

function derive(password: string, salt: string) {
  return scryptSync(password, salt, KEY_LENGTH).toString('hex');
}

export function hashPassword(password: string) {
  const salt = encodeSalt(randomBytes(16));
  const digest = derive(password, salt);
  return `${HASH_PREFIX}$${salt}$${digest}`;
}

function verifyLegacyPassword(password: string, hash: string) {
  const computed = Buffer.from(derive(password, LEGACY_STATIC_SALT), 'hex');
  const expected = Buffer.from(hash, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function verifyPassword(password: string, hash: string) {
  const parts = hash.split('$');
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) {
    return verifyLegacyPassword(password, hash);
  }

  const [, salt, digest] = parts;
  const computed = Buffer.from(derive(password, salt), 'hex');
  const expected = Buffer.from(digest, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}
