import { readJson, readString, STORAGE_KEYS, writeJson } from './storage';

export type PresenceEntry = {
  deviceOnline?: boolean;
  gamepadConnected?: boolean;
  controlLeaseId?: string | null;
  driveMode?: 'manual' | 'auto';
  controlWsConnected?: boolean;
  updatedAt?: number;
};

type PresenceState = Record<string, PresenceEntry>;
type PresenceOwner = { id: string; ts: number };
const OWNER_TTL_MS = 5000;
const PRESENCE_FLUSH_MS = 350;

let pendingPresenceState: PresenceState | null = null;
let pendingPresenceTimer: ReturnType<typeof setTimeout> | null = null;

function normalizePresence(entry: PresenceEntry): PresenceEntry {
  return {
    ...entry,
    updatedAt: entry.updatedAt ?? Date.now(),
  };
}

function readPresenceState(): PresenceState {
  const stored = readJson<PresenceState>(STORAGE_KEYS.presence, {});
  if (!pendingPresenceState) return stored;
  return { ...stored, ...pendingPresenceState };
}

function writePresenceState(next: PresenceState) {
  writeJson(STORAGE_KEYS.presence, next);
}

function schedulePresenceFlush() {
  if (pendingPresenceTimer) return;
  pendingPresenceTimer = setTimeout(() => {
    if (pendingPresenceState) {
      writePresenceState(pendingPresenceState);
      pendingPresenceState = null;
    }
    if (pendingPresenceTimer) {
      clearTimeout(pendingPresenceTimer);
      pendingPresenceTimer = null;
    }
  }, PRESENCE_FLUSH_MS);
}

function readPresenceOwner(vehicleId: string): PresenceOwner | null {
  return readJson<PresenceOwner | null>(STORAGE_KEYS.presenceOwner(vehicleId), null);
}

function writePresenceOwner(vehicleId: string, owner: PresenceOwner) {
  writeJson(STORAGE_KEYS.presenceOwner(vehicleId), owner);
}

export function claimPresenceOwner(vehicleId: string, ownerId: string) {
  const current = readPresenceOwner(vehicleId);
  const now = Date.now();
  if (!current || now - current.ts > OWNER_TTL_MS || current.id === ownerId) {
    writePresenceOwner(vehicleId, { id: ownerId, ts: now });
    return true;
  }
  return false;
}

export function getPresenceOwnerId(vehicleId: string) {
  return readPresenceOwner(vehicleId)?.id || null;
}

export function isPresenceOwner(vehicleId: string, ownerId: string) {
  const current = readPresenceOwner(vehicleId);
  if (!current) return false;
  if (current.id !== ownerId) return false;
  return Date.now() - current.ts <= OWNER_TTL_MS;
}

function migrateLegacyPresence(vehicleId: string, state: PresenceState) {
  if (state[vehicleId]) return state;
  const controlLeaseId = readString(STORAGE_KEYS.controlLease(vehicleId)) || undefined;
  const deviceOnlineRaw = readString(STORAGE_KEYS.deviceOnline(vehicleId));
  const gamepadConnectedRaw = readString(STORAGE_KEYS.gamepadConnected(vehicleId));
  const controlWsConnectedRaw = readString(STORAGE_KEYS.controlWsConnected(vehicleId));
  const driveModeRaw = readString(STORAGE_KEYS.driveMode(vehicleId));

  const migrated: PresenceEntry = {};
  if (controlLeaseId) migrated.controlLeaseId = controlLeaseId;
  if (deviceOnlineRaw === '1' || deviceOnlineRaw === '0') {
    migrated.deviceOnline = deviceOnlineRaw === '1';
  }
  if (gamepadConnectedRaw === '1' || gamepadConnectedRaw === '0') {
    migrated.gamepadConnected = gamepadConnectedRaw === '1';
  }
  if (controlWsConnectedRaw === '1' || controlWsConnectedRaw === '0') {
    migrated.controlWsConnected = controlWsConnectedRaw === '1';
  }
  if (driveModeRaw === 'auto' || driveModeRaw === 'manual') {
    migrated.driveMode = driveModeRaw;
  }

  if (Object.keys(migrated).length === 0) return state;
  const next = { ...state, [vehicleId]: normalizePresence(migrated) };
  writePresenceState(next);
  return next;
}

export function getPresence(vehicleId: string): PresenceEntry {
  let state = readPresenceState();
  state = migrateLegacyPresence(vehicleId, state);
  return state[vehicleId] || {};
}

export function setPresence(vehicleId: string, updates: PresenceEntry) {
  const state = readPresenceState();
  const nextEntry = normalizePresence({ ...state[vehicleId], ...updates });
  const next = { ...state, [vehicleId]: nextEntry };
  pendingPresenceState = next;
  schedulePresenceFlush();
  return nextEntry;
}

export function setPresenceIfOwner(vehicleId: string, ownerId: string, updates: PresenceEntry) {
  if (!isPresenceOwner(vehicleId, ownerId)) return getPresence(vehicleId);
  return setPresence(vehicleId, updates);
}

export function subscribePresence(vehicleId: string, handler: (entry: PresenceEntry) => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.presence) return;
    const next = getPresence(vehicleId);
    handler(next);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
