import type { ZodType } from 'zod';

export const STORAGE_KEYS = {
  authUser: 'ivy.authUser',
  logoutSignal: 'ivy.logoutSignal',
  logs: 'ivy.logs',
  theme: 'ivy.theme',
  wsUrlOverride: 'ivy.wsUrlOverride',
  presence: 'ivy.presence',
  presenceOwner: (vehicleId: string) => `ivy.presenceOwner:${vehicleId}`,
  lastVehicle: (userId: string) => `ivy.lastVehicle:${userId}`,
  missionDraft: (vehicleId: string) => `ivy.missionDraft:${vehicleId}`,
  driveMode: (vehicleId: string) => `ivy.driveMode:${vehicleId}`,
  controlLease: (vehicleId: string) => `ivy.controlLease:${vehicleId}`,
  deviceOnline: (vehicleId: string) => `ivy.deviceOnline:${vehicleId}`,
  gamepadConnected: (vehicleId: string) => `ivy.gamepadConnected:${vehicleId}`,
  controlWsConnected: (vehicleId: string) => `ivy.controlWsConnected:${vehicleId}`,
  telemetryCount: (vehicleId: string) => `ivy.telemetryCount:${vehicleId}`,
  mapSearchRegion: (vehicleId: string) => `ivy.mapSearchRegion:${vehicleId}`,
};

const STORAGE_PREFIX = 'ivy.';
const STORAGE_SOFT_LIMIT_BYTES = 4 * 1024 * 1024;
const LOG_SOFT_LIMIT = 500;

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getRaw(key: string) {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(key);
}

function estimateBytes(value: string) {
  return value.length * 2;
}

function getTotalIvyStorageBytes() {
  if (!isBrowser()) return 0;
  let total = 0;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const value = window.localStorage.getItem(key) || '';
    total += estimateBytes(key) + estimateBytes(value);
  }
  return total;
}

function getProjectedIvyStorageBytes(targetKey: string, targetRaw: string) {
  const currentTotal = getTotalIvyStorageBytes();
  const currentValue = getRaw(targetKey);
  const currentBytes =
    currentValue === null ? 0 : estimateBytes(targetKey) + estimateBytes(currentValue);
  const nextBytes = estimateBytes(targetKey) + estimateBytes(targetRaw);
  return currentTotal - currentBytes + nextBytes;
}

function safeParseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trimLogsArray(logs: unknown[]) {
  if (logs.length <= LOG_SOFT_LIMIT) return logs;
  return logs.slice(-LOG_SOFT_LIMIT);
}

function shrinkArrayTail(items: unknown[]) {
  if (items.length <= 1) return [];
  return items.slice(-Math.floor(items.length / 2));
}

function persistRaw(key: string, raw: string) {
  window.localStorage.setItem(key, raw);
}

function ensureStorageBudget(key: string, raw: string) {
  if (!isBrowser()) return;
  if (getProjectedIvyStorageBytes(key, raw) <= STORAGE_SOFT_LIMIT_BYTES) return;

  const logsRaw = getRaw(STORAGE_KEYS.logs);
  const parsedLogs = safeParseArray(logsRaw);
  if (parsedLogs.length === 0) {
    removeKey(STORAGE_KEYS.logs);
    return;
  }

  let trimmed = trimLogsArray(parsedLogs);
  while (
    trimmed.length > 0 &&
    getProjectedIvyStorageBytes(
      key,
      raw
    ) -
      (estimateBytes(STORAGE_KEYS.logs) +
        estimateBytes(logsRaw || '')) +
      (estimateBytes(STORAGE_KEYS.logs) + estimateBytes(JSON.stringify(trimmed))) >
      STORAGE_SOFT_LIMIT_BYTES
  ) {
    trimmed = shrinkArrayTail(trimmed);
  }

  if (trimmed.length === 0) {
    removeKey(STORAGE_KEYS.logs);
    return;
  }
  persistRaw(STORAGE_KEYS.logs, JSON.stringify(trimmed));
}

function isQuotaError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const quotaNames = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];
  return quotaNames.includes(error.name);
}

function writeWithGuard(key: string, raw: string) {
  if (!isBrowser()) return;
  ensureStorageBudget(key, raw);

  try {
    persistRaw(key, raw);
    return;
  } catch (error) {
    if (!isQuotaError(error)) return;
  }

  const logsRaw = getRaw(STORAGE_KEYS.logs);
  if (logsRaw) {
    const parsed = trimLogsArray(safeParseArray(logsRaw));
    let candidate = parsed;
    while (candidate.length > 0) {
      candidate = shrinkArrayTail(candidate);
      if (candidate.length === 0) break;
      persistRaw(STORAGE_KEYS.logs, JSON.stringify(candidate));
      try {
        persistRaw(key, raw);
        return;
      } catch (error) {
        if (!isQuotaError(error)) return;
      }
    }
    removeKey(STORAGE_KEYS.logs);
  }

  if (key === STORAGE_KEYS.logs) {
    let candidate = trimLogsArray(safeParseArray(raw));
    while (candidate.length > 0) {
      try {
        persistRaw(key, JSON.stringify(candidate));
        return;
      } catch (error) {
        if (!isQuotaError(error)) return;
      }
      candidate = shrinkArrayTail(candidate);
    }
    removeKey(STORAGE_KEYS.logs);
    return;
  }

  try {
    persistRaw(key, raw);
  } catch {
    // Best effort: skip write if storage is still full.
  }
}

export function hasKey(key: string) {
  return getRaw(key) !== null;
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = getRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T) {
  if (!isBrowser()) return;
  const normalized =
    key === STORAGE_KEYS.logs && Array.isArray(value) ? trimLogsArray(value as unknown[]) : value;
  writeWithGuard(key, JSON.stringify(normalized));
}

export function readString(key: string) {
  return getRaw(key);
}

export function writeString(key: string, value: string) {
  if (!isBrowser()) return;
  writeWithGuard(key, value);
}

export function removeKey(key: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(key);
}

function parseArrayWithSchema<T>(raw: string | null, schema: ZodType<T>) {
  if (!raw) {
    return { data: [] as T[], valid: false, rawExists: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: [] as T[], valid: false, rawExists: true };
  }

  if (!Array.isArray(parsed)) {
    return { data: [] as T[], valid: false, rawExists: true };
  }

  const data: T[] = [];
  let valid = true;

  for (const item of parsed) {
    const result = schema.safeParse(item);
    if (result.success) {
      data.push(result.data);
    } else {
      valid = false;
    }
  }

  return { data, valid, rawExists: true };
}

export function readArrayWithSchema<T>(key: string, schema: ZodType<T>) {
  return parseArrayWithSchema(getRaw(key), schema);
}
