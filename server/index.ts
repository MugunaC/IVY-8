import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { clientMessageSchema, inputPayloadSchema, PROTOCOL_VERSION } from '../shared/protocol.js';
import {
  getVehicleAdapter,
  supportsModule,
  withVehicleCapabilities,
} from './adapters/vehicleAdapter.js';
import type {
  CameraStatusPayload,
  CameraControlPayload,
  CoopRole,
  ControlPayload,
  DeviceHelloPayload,
  MissionPayload,
  SensorStatePayload,
  TelemetryEntry,
  TelemetryPayload,
  VehicleLocationPayload,
  Vehicle,
  WsServerMessage,
} from '../shared/types.js';
import {
  initDb,
  listVehicles,
  getVehicle as dbGetVehicle,
  appendTelemetry,
  listTelemetry,
  pruneTelemetry,
  pruneTelemetryBefore,
  newId,
} from './db.js';
import {
  ALLOW_LEGACY_INPUT,
  API_PORT,
  CAMERA_CONTROL_RATE_LIMIT_PER_SEC,
  CONTROL_RATE_BURST,
  CONTROL_RATE_LIMIT_PER_SEC,
  CONTROL_REPLAY_WINDOW,
  CONTROL_SEQ_MAX_JUMP,
  DEVICE_AUTH_WINDOW_MS,
  DEVICE_HEARTBEAT_SCAN_MS,
  DEVICE_HEARTBEAT_TIMEOUT_MS,
  DEVICE_SHARED_SECRET,
  MAX_TELEMETRY,
  START_API,
  START_WS,
  TELEMETRY_ACK_INTERVAL_MS,
  TELEMETRY_ARCHIVE_DIR,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_INGEST_BURST,
  TELEMETRY_INGEST_RATE_PER_SEC,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_RETENTION_DAYS,
  TELEMETRY_SLOWDOWN_MS,
  WS_CONTROL_PORT,
  WS_DEVICE_PORT,
  WS_HOST,
  WS_TELEMETRY_PORT,
  WS_VERBOSE,
} from './config.js';
import { sendJson, sendText } from './lib/http.js';
import { logStructured, logWsVerbose as writeWsVerbose } from './lib/logging.js';
import { formatPromLines, incMetric, metricKey } from './lib/metrics.js';
import { consumeRateLimit, type RateLimitState } from './lib/rateLimit.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleMissionRoutes } from './routes/missions.js';
import { handleTelemetryRoutes } from './routes/telemetry.js';
import { InMemoryCoopSessionService, type CoopBroadcast } from './services/coopSessions.js';

const BINARY_MAGIC = Buffer.from([0x49, 0x56, 0x59, 0x01]); // "IVY" + version
const BINARY_MODULE_TELEMETRY = 1;
const BINARY_MODULE_CONTROL = 2;

interface DeviceRegistryEntry {
  vehicleId: string;
  deviceId: string;
  secret: string;
}

function logWsVerbose(
  message: string,
  context?: {
    endpoint?: string;
    connectionId?: string;
  }
) {
  writeWsVerbose(WS_VERBOSE, message, context);
}

function getConnectionId(ws: WebSocket) {
  const existing = connectionIdBySocket.get(ws);
  if (existing) return existing;
  const created = randomUUID();
  connectionIdBySocket.set(ws, created);
  return created;
}

function observeAckLatency(endpoint: string, vehicleId: string | undefined, ms: number) {
  const keyBase = metricKey([endpoint, vehicleId]);
  incMetric(wsAckLatencySum, keyBase, ms);
  incMetric(wsAckLatencyCount, keyBase, 1);
  const bucket = ACK_LATENCY_BUCKETS.find((limit) => ms <= limit) ?? Infinity;
  const bucketKey = metricKey([endpoint, vehicleId, bucket]);
  incMetric(wsAckLatencyBuckets, bucketKey, 1);
}

const db = initDb();
const telemetryQueue: TelemetryEntry[] = [];

function defaultDeviceRegistry(): DeviceRegistryEntry[] {
  return listVehicles(db).map((vehicle) => ({
    vehicleId: vehicle.id,
    deviceId: `PICO-${vehicle.id}`,
    secret: DEVICE_SHARED_SECRET,
  }));
}

function loadDeviceRegistry(): Map<string, DeviceRegistryEntry> {
  const table = new Map<string, DeviceRegistryEntry>();
  for (const entry of defaultDeviceRegistry()) {
    table.set(entry.vehicleId, entry);
  }

  const raw = process.env.DEVICE_REGISTRY_JSON;
  if (!raw) return table;

  try {
    const parsed = JSON.parse(raw) as Array<Partial<DeviceRegistryEntry>>;
    if (!Array.isArray(parsed)) {
      return table;
    }
    for (const item of parsed) {
      const vehicleId = (item.vehicleId || '').trim();
      const deviceId = (item.deviceId || '').trim();
      const secret = (item.secret || '').trim();
      if (!vehicleId || !deviceId || !secret) continue;
      table.set(vehicleId, { vehicleId, deviceId, secret });
    }
  } catch (error) {
    console.warn(
      'Failed to parse DEVICE_REGISTRY_JSON, using default device registry:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return table;
}

const deviceRegistry = loadDeviceRegistry();
const usedAuthNonces = new Map<string, number>();
const deviceSocketByVehicleId = new Map<string, WebSocket>();
const connectionIdBySocket = new Map<WebSocket, string>();
const defaultVehicleBySocket = new Map<WebSocket, string>();
const lastInputTsBySocket = new Map<WebSocket, number>();
const lastSlowDownBySocket = new Map<WebSocket, number>();
const endpointBySocket = new Map<WebSocket, 'control' | 'telemetry' | 'device'>();
const pendingDeviceMessagesByVehicle = new Map<
  string,
  {
    missionQueue: Array<{ message: WsServerMessage; enqueuedAt: number }>;
    controlLatest?: { message: WsServerMessage; enqueuedAt: number };
    replayTimer?: ReturnType<typeof setTimeout> | null;
  }
>();
const pendingDeviceNoticeByVehicle = new Set<string>();
const authBySocket = new Map<
  WebSocket,
  { vehicleId: string; deviceId: string; authenticated: boolean; lastSeenMs: number }
>();
const deviceOnlineByVehicle = new Map<string, boolean>();
const lastDeviceStatusSentMsByVehicle = new Map<string, number>();
const deviceIpByVehicle = new Map<string, string>();
const deviceFwByVehicle = new Map<string, string>();
const deviceIpBySocket = new Map<WebSocket, string>();

const wsMetricsReceived = new Map<string, number>();
const wsMetricsSent = new Map<string, number>();
const wsMetricsDropped = new Map<string, number>();
const wsAckLatencyBuckets = new Map<string, number>();
const wsAckLatencySum = new Map<string, number>();
const wsAckLatencyCount = new Map<string, number>();
const userUpdateRateById = new Map<string, number>();

const ACK_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface SequenceState {
  highest: number;
  recent: Set<number>;
  queue: number[];
}

const controlRateByVehicle = new Map<string, RateLimitState>();
const cameraRateByVehicle = new Map<string, RateLimitState>();
const telemetryApiRateBySource = new Map<string, RateLimitState>();
const telemetryWsRateBySource = new Map<string, RateLimitState>();
const controlSequenceByVehicle = new Map<string, SequenceState>();
const cameraSequenceByVehicle = new Map<string, SequenceState>();
const driveModeByVehicle = new Map<string, 'manual' | 'assisted' | 'auto'>();
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
let telemetryFlushInFlight = false;

function flushTelemetryQueue() {
  if (telemetryFlushInFlight) return;
  telemetryFlushInFlight = true;
  const batch = telemetryQueue.splice(0, telemetryQueue.length);
  try {
    if (batch.length) {
      appendTelemetry(db, batch);
      pruneTelemetry(db, MAX_TELEMETRY);
    }
  } catch (error) {
    console.error(
      'Failed to persist telemetry batch:',
      error instanceof Error ? error.message : String(error)
    );
    telemetryQueue.unshift(...batch);
  } finally {
    telemetryFlushInFlight = false;
    if (telemetryQueue.length) {
      scheduleTelemetryFlush();
    }
  }
}

function scheduleTelemetryFlush() {
  if (telemetryFlushTimer) return;
  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = null;
    flushTelemetryQueue();
  }, Math.max(50, TELEMETRY_FLUSH_INTERVAL_MS));
}

function enqueueTelemetry(entry: TelemetryEntry) {
  telemetryQueue.push(entry);
  let dropped = 0;
  if (telemetryQueue.length > TELEMETRY_QUEUE_MAX) {
    const overflow = telemetryQueue.length - TELEMETRY_QUEUE_MAX;
    telemetryQueue.splice(0, overflow);
    dropped = overflow;
  }
  if (telemetryQueue.length >= 200) {
    flushTelemetryQueue();
  } else {
    scheduleTelemetryFlush();
  }
  return dropped;
}

function normalizePayload(payload: TelemetryPayload): TelemetryPayload {
  const normalizeButtonValue = (value: number) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 0;
    return Math.max(0, Math.min(1, num));
  };

  return {
    buttons: payload.buttons.map((value) => normalizeButtonValue(value)),
    axes: payload.axes.map((value) => Number(value)),
    vehicleId: payload.vehicleId,
    leaseId: payload.leaseId,
    seq: payload.seq,
  };
}

type ParsedIncomingMessage =
  | { kind: 'hello'; protocolVersion?: number; vehicleId?: string }
  | { kind: 'input'; payload: TelemetryPayload; vehicleId?: string }
  | { kind: 'location_subscribe'; vehicleId: string }
  | {
      kind: 'coop_join';
      sessionId: string;
      vehicleId?: string;
      userId: string;
      username: string;
      role?: CoopRole;
    }
  | { kind: 'coop_leave'; sessionId: string; userId: string }
  | { kind: 'coop_chat'; sessionId: string; vehicleId?: string; userId: string; username: string; text: string }
  | {
      kind: 'coop_plan_set';
      sessionId: string;
      vehicleId?: string;
      userId: string;
      username: string;
      waypoints: Array<{ lat: number; lng: number; label?: string }>;
      route?: { type: 'LineString'; coordinates: [number, number][] } | null;
      distanceMeters?: number;
      etaSeconds?: number;
    }
  | { kind: 'coop_plan_clear'; sessionId: string; userId: string }
  | { kind: 'device_hello'; payload: DeviceHelloPayload; protocolVersion?: number }
  | { kind: 'control'; vehicleId: string; payload: ControlPayload }
  | { kind: 'mission'; vehicleId: string; payload: MissionPayload }
  | { kind: 'camera_control'; vehicleId: string; payload: CameraControlPayload }
  | { kind: 'sensor_state'; vehicleId: string; payload: SensorStatePayload }
  | { kind: 'camera_status'; vehicleId: string; payload: CameraStatusPayload }
  | { kind: 'location'; payload: VehicleLocationPayload };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function parseBinaryIncoming(buffer: Buffer, fallbackVehicleId?: string): ParsedIncomingMessage | null {
  if (buffer.length < 13) return null;
  if (!buffer.subarray(0, 4).equals(BINARY_MAGIC)) return null;

  const moduleType = buffer.readUInt8(4);
  const seq = buffer.readUInt32LE(8);
  const vehicleIdLength = buffer.readUInt8(12);
  const vehicleIdStart = 13;
  const vehicleIdEnd = vehicleIdStart + vehicleIdLength;
  if (vehicleIdEnd > buffer.length) return null;
  const vehicleIdRaw = vehicleIdLength > 0 ? buffer.subarray(vehicleIdStart, vehicleIdEnd).toString('utf8') : '';
  const vehicleId = vehicleIdRaw || fallbackVehicleId;
  let offset = vehicleIdEnd;

  if (moduleType === BINARY_MODULE_TELEMETRY) {
    if (offset + 2 > buffer.length) return null;
    const buttonCount = buffer.readUInt8(offset);
    const axisCount = buffer.readUInt8(offset + 1);
    offset += 2;

    const buttonEnd = offset + buttonCount;
    const axisEnd = buttonEnd + axisCount * 2;
    if (axisEnd > buffer.length) return null;

    const buttons: number[] = [];
    for (let i = 0; i < buttonCount; i += 1) {
      buttons.push(roundTo(buffer.readUInt8(offset + i) / 255, 3));
    }
    offset = buttonEnd;

    const axes: number[] = [];
    for (let i = 0; i < axisCount; i += 1) {
      const value = buffer.readInt16LE(offset + i * 2) / 10_000;
      axes.push(roundTo(clamp(value, -1, 1), 4));
    }

        return {
          kind: 'input',
          payload: normalizePayload({ buttons, axes, vehicleId }),
          vehicleId,
        };
    }

  if (moduleType === BINARY_MODULE_CONTROL) {
    if (offset + 8 > buffer.length || !vehicleId) return null;
    const steer = clamp(buffer.readInt16LE(offset) / 10_000, -1, 1);
    const throttle = clamp(buffer.readUInt16LE(offset + 2) / 10_000, 0, 1);
    const brake = clamp(buffer.readUInt16LE(offset + 4) / 10_000, 0, 1);
    const estop = buffer.readUInt8(offset + 6) > 0;
    const modeCode = buffer.readUInt8(offset + 7);
    const mode = modeCode === 1 ? 'manual' : modeCode === 2 ? 'assisted' : modeCode === 3 ? 'auto' : undefined;

      return {
        kind: 'control',
        vehicleId,
        payload: {
          seq,
          leaseId: '',
          buttons: [estop ? 1 : 0],
          axes: [roundTo(steer, 4), roundTo(throttle, 4), roundTo(brake, 4)],
        ...(mode ? { mode } : {}),
      },
    };
  }

  return null;
}

function parseIncoming(message: RawData, fallbackVehicleId?: string): ParsedIncomingMessage | null {
  if (message instanceof Buffer) {
    const binary = parseBinaryIncoming(message, fallbackVehicleId);
    if (binary) {
      return binary;
    }
  }

  const text = message instanceof Buffer ? message.toString() : String(message);
  if (text === 'Connected' || text === 'hello') {
    return { kind: 'hello' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (ALLOW_LEGACY_INPUT && Array.isArray(parsed)) {
    const buttons = parsed.slice(0, 18).map((value) => Number(value));
    const axes = parsed.slice(18).map((value) => Number(value));
    return { kind: 'input', payload: normalizePayload({ buttons, axes }) };
  }

  if (ALLOW_LEGACY_INPUT) {
    const legacyInput = inputPayloadSchema.safeParse(parsed);
    if (legacyInput.success) {
      return { kind: 'input', payload: normalizePayload(legacyInput.data) };
    }
  }

  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Invalid payload format');
  }

  if (result.data.type === 'hello') {
    return {
      kind: 'hello',
      protocolVersion: result.data.protocolVersion,
      vehicleId: result.data.vehicleId,
    };
  }

  if (result.data.type === 'location_subscribe') {
    return { kind: 'location_subscribe', vehicleId: result.data.vehicleId };
  }

  if (result.data.type === 'coop_join') {
    return {
      kind: 'coop_join',
      sessionId: result.data.sessionId,
      userId: result.data.userId,
      username: result.data.username,
      vehicleId: result.data.vehicleId,
      role: result.data.role,
    };
  }

  if (result.data.type === 'coop_leave') {
    return {
      kind: 'coop_leave',
      sessionId: result.data.sessionId,
      userId: result.data.userId,
    };
  }

  if (result.data.type === 'coop_chat') {
    return {
      kind: 'coop_chat',
      sessionId: result.data.sessionId,
      vehicleId: result.data.vehicleId,
      userId: result.data.userId,
      username: result.data.username,
      text: result.data.text,
    };
  }

  if (result.data.type === 'coop_plan_set') {
    return {
      kind: 'coop_plan_set',
      sessionId: result.data.sessionId,
      vehicleId: result.data.vehicleId,
      userId: result.data.userId,
      username: result.data.username,
      waypoints: result.data.waypoints,
      route: result.data.route,
      distanceMeters: result.data.distanceMeters,
      etaSeconds: result.data.etaSeconds,
    };
  }

  if (result.data.type === 'coop_plan_clear') {
    return {
      kind: 'coop_plan_clear',
      sessionId: result.data.sessionId,
      userId: result.data.userId,
    };
  }

  if (result.data.type === 'device_hello') {
    return {
      kind: 'device_hello',
      payload: result.data.payload,
      protocolVersion: result.data.protocolVersion,
    };
  }

  if (result.data.type === 'control') {
    return {
      kind: 'control',
      vehicleId: result.data.vehicleId,
      payload: result.data.payload,
    };
  }

  if (result.data.type === 'mission') {
    return {
      kind: 'mission',
      vehicleId: result.data.vehicleId,
      payload: result.data.payload,
    };
  }

  if (result.data.type === 'input') {
    return {
      kind: 'input',
      payload: normalizePayload(result.data.payload),
      vehicleId: result.data.vehicleId,
    };
  }

  if (result.data.type === 'camera_control') {
    return {
      kind: 'camera_control',
      vehicleId: result.data.vehicleId,
      payload: result.data.payload,
    };
  }

  if (result.data.type === 'sensor_state') {
    return {
      kind: 'sensor_state',
      vehicleId: result.data.vehicleId,
      payload: result.data.payload,
    };
  }

  if (result.data.type === 'camera_status') {
    return {
      kind: 'camera_status',
      vehicleId: result.data.vehicleId,
      payload: result.data.payload,
    };
  }

  if (result.data.type === 'location') {
    return { kind: 'location', payload: result.data.payload };
  }
  return null;
}

function pruneNonces(nowTs: number) {
  for (const [key, value] of usedAuthNonces) {
    if (nowTs - value > DEVICE_AUTH_WINDOW_MS) {
      usedAuthNonces.delete(key);
    }
  }
}

function signaturesEqual(expectedHex: string, actualHex: string) {
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    if (expected.length === 0 || expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function checkProtocolVersion(protocolVersion?: number) {
  if (protocolVersion === undefined || protocolVersion === null) {
    return { ok: true, message: null };
  }
  if (!Number.isFinite(protocolVersion) || protocolVersion < 0) {
    return { ok: false, message: 'Invalid protocol version.' };
  }
  if (protocolVersion > PROTOCOL_VERSION) {
    return {
      ok: false,
      message: `Unsupported protocol version ${protocolVersion}. Server=${PROTOCOL_VERSION}.`,
    };
  }
  if (protocolVersion < PROTOCOL_VERSION) {
    return {
      ok: true,
      message: `Client protocol ${protocolVersion} is older than server ${PROTOCOL_VERSION}.`,
    };
  }
  return { ok: true, message: null };
}

function authenticateDeviceHello(payload: DeviceHelloPayload) {
  const registry = deviceRegistry.get(payload.vehicleId);
  if (!registry) {
    return { ok: false as const, message: 'Unknown vehicle for device authentication.' };
  }
  if (registry.deviceId !== payload.deviceId) {
    return { ok: false as const, message: 'Device ID does not match registered vehicle.' };
  }

  const nowTs = Date.now();
  if (Math.abs(nowTs - payload.ts) > DEVICE_AUTH_WINDOW_MS) {
    return { ok: false as const, message: 'Authentication timestamp outside allowed window.' };
  }

  pruneNonces(nowTs);
  const nonceKey = `${payload.vehicleId}:${payload.deviceId}:${payload.nonce}`;
  if (usedAuthNonces.has(nonceKey)) {
    return { ok: false as const, message: 'Replay detected for authentication nonce.' };
  }

  const signInput = `${payload.vehicleId}|${payload.deviceId}|${payload.ts}|${payload.nonce}`;
  const expectedSig = createHmac('sha256', registry.secret).update(signInput).digest('hex');
  if (!signaturesEqual(expectedSig, payload.sig)) {
    return { ok: false as const, message: 'Invalid authentication signature.' };
  }

  usedAuthNonces.set(nonceKey, nowTs);
  return {
    ok: true as const,
    vehicleId: payload.vehicleId,
    deviceId: payload.deviceId,
  };
}

function validateSequence(
  table: Map<string, SequenceState>,
  key: string,
  seq: number,
  moduleName: 'control' | 'camera_control'
) {
  if (!Number.isFinite(seq) || seq < 0) {
    return `${moduleName} sequence must be a non-negative number.`;
  }

  const state = table.get(key) || { highest: -1, recent: new Set<number>(), queue: [] };

  if (state.highest >= 0 && seq > state.highest + Math.max(1, CONTROL_SEQ_MAX_JUMP)) {
    return `${moduleName} sequence jump too large (seq=${seq}, highest=${state.highest}).`;
  }
  if (state.highest >= 0 && seq < state.highest - Math.max(1, CONTROL_REPLAY_WINDOW)) {
    return `${moduleName} sequence too old (seq=${seq}, highest=${state.highest}).`;
  }
  if (state.recent.has(seq)) {
    return `${moduleName} replay detected for seq=${seq}.`;
  }

  state.recent.add(seq);
  state.queue.push(seq);
  state.highest = Math.max(state.highest, seq);
  while (state.queue.length > Math.max(8, CONTROL_REPLAY_WINDOW)) {
    const removed = state.queue.shift();
    if (removed !== undefined) {
      state.recent.delete(removed);
    }
  }
  table.set(key, state);
  return null;
}

function markDeviceAlive(ws: WebSocket) {
  const auth = authBySocket.get(ws);
  if (!auth) return;
  auth.lastSeenMs = Date.now();
  authBySocket.set(ws, auth);
  broadcastDeviceStatus(auth.vehicleId, auth.deviceId, true, auth.lastSeenMs);
}

function formatCppText(payload: TelemetryPayload) {
  const buttonValues = payload.buttons.map((value) => value.toFixed(4)).join(', ');
  const axisValues = payload.axes.map((axis) => axis.toFixed(4)).join(', ');
  return `// C++ Code\n\ndouble buttons[] = { ${buttonValues} };\nint axisCount = ${payload.axes.length};\ndouble axes[] = { ${axisValues} };`;
}

function sendMessage(ws: WebSocket, message: WsServerMessage) {
  ws.send(JSON.stringify(message));
  const vehicleId = 'vehicleId' in message ? message.vehicleId : undefined;
  const endpoint = endpointBySocket.get(ws) || 'unknown';
  incMetric(wsMetricsSent, metricKey([endpoint, vehicleId, message.type]));
}

const locationSubscribers = new Map<WebSocket, string>();
const latestLocations = new Map<string, VehicleLocationPayload>();
const inputAckBySocket = new Map<WebSocket, { received: number; lastAckTs: number }>();

function buildInvitePath(sessionId: string, vehicleId?: string) {
  const params = new URLSearchParams();
  params.set('role', 'spectator');
  if (vehicleId) params.set('vehicleId', vehicleId);
  return `/coop/session/${encodeURIComponent(sessionId)}?${params.toString()}`;
}

const coopSessions = new InMemoryCoopSessionService<WebSocket>({
  getInvitePath: buildInvitePath,
  getVehicleSnapshot: (vehicleId) => {
    const latest = latestLocations.get(vehicleId);
    if (!latest) return undefined;
    return {
      vehicleId,
      lat: latest.lat,
      lng: latest.lng,
      heading: latest.heading,
      speedMps: latest.speedMps,
      lastUpdatedAt: latest.ts,
    };
  },
  resolveHost: (entry) => {
    if (!entry.vehicleId) return false;
    const vehicle = getVehicle(entry.vehicleId);
    return vehicle?.currentUserId === entry.userId || vehicle?.currentUser === entry.username;
  },
  createId: newId,
  now: () => Date.now(),
});

function broadcastCoopState(broadcast: CoopBroadcast<WebSocket> | null) {
  if (!broadcast) return;
  broadcast.sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      sendMessage(socket, { type: 'coop_state', payload: broadcast.payload });
    }
  });
}

function broadcastCoopStateForVehicle(vehicleId: string) {
  coopSessions.buildBroadcastsForVehicle(vehicleId).forEach(broadcastCoopState);
}

function acknowledgeInput(ws: WebSocket, vehicleId: string | undefined, endpoint: string) {
  const previous = inputAckBySocket.get(ws) || { received: 0, lastAckTs: 0 };
  const received = previous.received + 1;
  const now = Date.now();
  const shouldAck = now - previous.lastAckTs >= Math.max(100, TELEMETRY_ACK_INTERVAL_MS);

  inputAckBySocket.set(ws, {
    received,
    lastAckTs: shouldAck ? now : previous.lastAckTs,
  });

  if (!shouldAck) return;
  const lastInput = lastInputTsBySocket.get(ws);
  if (lastInput) {
    observeAckLatency(endpoint, vehicleId, Math.max(0, now - lastInput));
  }
  sendMessage(ws, { type: 'input_ack', ts: now, vehicleId, received });
}

function seedLocation(vehicleId: string): VehicleLocationPayload {
  const hash = [...vehicleId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const lat = 37.7749 + ((hash % 100) - 50) * 0.0002;
  const lng = -122.4194 + ((hash % 80) - 40) * 0.0002;
  return {
    ts: Date.now(),
    vehicleId,
    lat,
    lng,
    heading: 0,
    speedMps: 0,
  };
}

function updateVehicleLocationFromTelemetry(
  vehicleId: string,
  payload: TelemetryPayload
): VehicleLocationPayload {
  const prev = latestLocations.get(vehicleId) || seedLocation(vehicleId);
  const steer = Number(payload.axes[0] || 0);
  const throttleAxis = Number(payload.axes[1] || 1);
  const throttle = Math.max(0, Math.min(1, (1 - throttleAxis) / 2));
  const brake = Math.max(0, Math.min(1, Number(payload.buttons[6] || 0)));
  const speed = Math.max(0, Math.min(35, (prev.speedMps || 0) + throttle * 1.2 - brake * 1.5));
  const heading = ((prev.heading || 0) + steer * 6 + 360) % 360;
  const radians = (heading * Math.PI) / 180;
  const meters = speed * 0.1;
  const lat = prev.lat + (meters * Math.cos(radians)) / 111_111;
  const lng = prev.lng + (meters * Math.sin(radians)) / (111_111 * Math.max(0.2, Math.cos((prev.lat * Math.PI) / 180)));
  const next: VehicleLocationPayload = {
    ts: Date.now(),
    vehicleId,
    lat,
    lng,
    heading,
    speedMps: speed,
  };
  latestLocations.set(vehicleId, next);
  return next;
}

function broadcastLocation(location: VehicleLocationPayload) {
  locationSubscribers.forEach((subscribedVehicleId, client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }
    if (subscribedVehicleId !== location.vehicleId) {
      return;
    }
    sendMessage(client, { type: 'location', payload: location });
  });
  broadcastCoopStateForVehicle(location.vehicleId);
}

function handleProtocolHandshake(
  ws: WebSocket,
  protocolVersion: number | undefined,
  sourceKey: string,
  label: string
) {
  const result = checkProtocolVersion(protocolVersion);
  if (!result.ok) {
    logWsVerbose(`${label} protocol error from ${sourceKey}: ${result.message}`, {
      endpoint: label,
      connectionId: getConnectionId(ws),
    });
    sendMessage(ws, { type: 'error', message: result.message || 'Unsupported protocol version.' });
    ws.close();
    return false;
  }
  if (result.message) {
    logWsVerbose(`${label} protocol notice from ${sourceKey}: ${result.message}`, {
      endpoint: label,
      connectionId: getConnectionId(ws),
    });
  }
  return true;
}

function handleTelemetryInput(
  ws: WebSocket,
  sourceKey: string,
  payload: TelemetryPayload,
  vehicleId?: string
) {
  const nowMs = Date.now();
  if (
    !consumeRateLimit(
      telemetryWsRateBySource,
      sourceKey,
      TELEMETRY_INGEST_RATE_PER_SEC,
      nowMs,
      TELEMETRY_INGEST_BURST
    )
  ) {
    incMetric(wsMetricsDropped, metricKey(['telemetry', vehicleId || payload.vehicleId, 'rate_limited']));
    const lastSlow = lastSlowDownBySocket.get(ws) || 0;
    if (nowMs - lastSlow > TELEMETRY_SLOWDOWN_MS / 2) {
      lastSlowDownBySocket.set(ws, nowMs);
      sendMessage(ws, { type: 'slow_down', retryAfterMs: TELEMETRY_SLOWDOWN_MS, reason: 'rate_limited' });
    }
    return;
  }

  const inputVehicleId =
    vehicleId || payload.vehicleId || defaultVehicleBySocket.get(ws);
  lastInputTsBySocket.set(ws, nowMs);
  if (inputVehicleId) {
    const vehicle = getVehicle(inputVehicleId);
    const enrichedPayload: TelemetryPayload = {
      ...payload,
      vehicleId: inputVehicleId,
      leaseId: payload.leaseId || vehicle?.controlLeaseId,
    };
    const location = updateVehicleLocationFromTelemetry(inputVehicleId, payload);
    broadcastLocation(location);
    forwardToVehicleDevice(inputVehicleId, {
      type: 'input',
      vehicleId: inputVehicleId,
      payload: enrichedPayload,
    });
  }

  const dropped = enqueueTelemetry({
    ts: nowMs,
    userId: undefined,
    username: undefined,
    vehicleId: inputVehicleId,
    payload,
    bytes: JSON.stringify(payload).length,
  });
  if (dropped > 0) {
    const key = metricKey(['telemetry', inputVehicleId, 'queue_overflow']);
    incMetric(wsMetricsDropped, key, dropped);
    const lastSlow = lastSlowDownBySocket.get(ws) || 0;
    if (nowMs - lastSlow > TELEMETRY_SLOWDOWN_MS / 2) {
      lastSlowDownBySocket.set(ws, nowMs);
      sendMessage(ws, { type: 'slow_down', retryAfterMs: TELEMETRY_SLOWDOWN_MS, reason: 'queue_overflow' });
    }
  }

  acknowledgeInput(ws, inputVehicleId, 'telemetry');
  sendMessage(ws, { type: 'cpp', text: formatCppText(payload) });
}

function broadcastToControlClients(message: WsServerMessage) {
  if (!wssControl) return;
  wssControl.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      sendMessage(client, message);
    }
  });
}

function broadcastDeviceStatus(
  vehicleId: string,
  deviceId: string | undefined,
  online: boolean,
  lastSeenMs: number,
  force = false
) {
  const now = Date.now();
  const prevOnline = deviceOnlineByVehicle.get(vehicleId);
  const lastSent = lastDeviceStatusSentMsByVehicle.get(vehicleId) || 0;
  if (!force && prevOnline === online && now - lastSent < 1000) {
    return;
  }
  const ip = deviceIpByVehicle.get(vehicleId);
  const fw = deviceFwByVehicle.get(vehicleId);
  deviceOnlineByVehicle.set(vehicleId, online);
  lastDeviceStatusSentMsByVehicle.set(vehicleId, now);
  broadcastToControlClients({
    type: 'device_status',
    vehicleId,
    deviceId,
    online,
    lastSeenMs,
    ...(ip ? { ip } : {}),
    ...(fw ? { fw } : {}),
  });
}

function forwardToVehicleDevice(vehicleId: string, message: WsServerMessage) {
  const socket = deviceSocketByVehicleId.get(vehicleId);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  sendMessage(socket, message);
  return true;
}

function getPendingQueue(vehicleId: string) {
  const existing = pendingDeviceMessagesByVehicle.get(vehicleId);
  if (existing) return existing;
  const created = { missionQueue: [], controlLatest: undefined, replayTimer: null };
  pendingDeviceMessagesByVehicle.set(vehicleId, created);
  return created;
}

function queueDeviceMessage(vehicleId: string, kind: 'control' | 'mission', message: WsServerMessage) {
  const pending = getPendingQueue(vehicleId);
  const now = Date.now();
  if (kind === 'control') {
    pending.controlLatest = { message, enqueuedAt: now };
  } else {
    pending.missionQueue.push({ message, enqueuedAt: now });
  }
  if (!pendingDeviceNoticeByVehicle.has(vehicleId)) {
    pendingDeviceNoticeByVehicle.add(vehicleId);
    logWsVerbose(`${kind} queued vehicle=${vehicleId} (device disconnected)`);
  }
}

function stopReplayTimer(vehicleId: string) {
  const pending = pendingDeviceMessagesByVehicle.get(vehicleId);
  if (!pending?.replayTimer) return;
  clearTimeout(pending.replayTimer);
  pending.replayTimer = null;
}

function scheduleMissionReplay(vehicleId: string, socket: WebSocket) {
  const pending = pendingDeviceMessagesByVehicle.get(vehicleId);
  if (!pending || pending.replayTimer) return;
  if (!pending.missionQueue.length) return;

  const sendNext = () => {
    const current = pendingDeviceMessagesByVehicle.get(vehicleId);
    if (!current) return;
    if (socket.readyState !== WebSocket.OPEN) {
      current.replayTimer = null;
      return;
    }
    const next = current.missionQueue.shift();
    if (!next) {
      current.replayTimer = null;
      return;
    }
    sendMessage(socket, next.message);
    logWsVerbose(`mission delivered after reconnect vehicle=${vehicleId}`);
    if (!current.missionQueue.length) {
      current.replayTimer = null;
      pendingDeviceNoticeByVehicle.delete(vehicleId);
      return;
    }
    const following = current.missionQueue[0];
    const delay = Math.max(0, following.enqueuedAt - next.enqueuedAt);
    current.replayTimer = setTimeout(sendNext, delay);
  };

  // Start with no delay for the first queued message; spacing is preserved between subsequent messages.
  pending.replayTimer = setTimeout(sendNext, 0);
}

function flushPendingDeviceMessages(vehicleId: string, socket: WebSocket) {
  const pending = pendingDeviceMessagesByVehicle.get(vehicleId);
  if (!pending) return;
  if (pending.controlLatest) {
    sendMessage(socket, pending.controlLatest.message);
    logWsVerbose(`control delivered after reconnect vehicle=${vehicleId}`);
    pending.controlLatest = undefined;
  }
  scheduleMissionReplay(vehicleId, socket);
}

function sendToVehicleOrQueue(
  vehicleId: string,
  kind: 'control' | 'mission',
  message: WsServerMessage
) {
  const socket = deviceSocketByVehicleId.get(vehicleId);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    queueDeviceMessage(vehicleId, kind, message);
    return false;
  }
  sendMessage(socket, message);
  return true;
}

function isDeviceSocketReady(vehicleId: string) {
  const socket = deviceSocketByVehicleId.get(vehicleId);
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function getVehicle(vehicleId: string) {
  return dbGetVehicle(db, vehicleId);
}

function validateControlLease(vehicle: Vehicle, leaseId: string) {
  if (!leaseId || typeof leaseId !== 'string') {
    return `Control lease missing for vehicle ${vehicle.id}.`;
  }
  if (vehicle.status !== 'unavailable') {
    return `Vehicle ${vehicle.id} is not in an active control session.`;
  }
  if (!vehicle.controlLeaseId) {
    return `No active control lease for vehicle ${vehicle.id}.`;
  }
  if (vehicle.controlLeaseId !== leaseId) {
    return `Control lease mismatch for vehicle ${vehicle.id}.`;
  }
  return null;
}

function validateControlForVehicle(vehicle: Vehicle, payload: ControlPayload) {
  if (!supportsModule(vehicle, 'control')) {
    return `Vehicle ${vehicle.id} does not support control module.`;
  }
  const adapter = getVehicleAdapter(vehicle);
  return adapter.validateControl(payload, withVehicleCapabilities(vehicle).capabilities!);
}

function validateCameraControlForVehicle(vehicle: Vehicle, payload: CameraControlPayload) {
  if (!supportsModule(vehicle, 'camera_control')) {
    return `Vehicle ${vehicle.id} does not support camera control module.`;
  }
  const adapter = getVehicleAdapter(vehicle);
  return adapter.validateCameraControl(payload, withVehicleCapabilities(vehicle).capabilities!);
}

function filterTelemetry(query: URLSearchParams) {
  const limit = Number(query.get('limit') || 200);
  const userId = query.get('userId') || '';
  const vehicleId = query.get('vehicleId') || '';
  const leaseId = query.get('leaseId') || '';
  const startTs = Number(query.get('startTs') || 0);
  const endTs = Number(query.get('endTs') || Number.MAX_SAFE_INTEGER);
  const cappedLimit = Math.max(1, Math.min(10000, Number.isFinite(limit) ? limit : 200));
  const entries = listTelemetry(db, cappedLimit);

  return entries
    .filter((entry) => {
      if (userId && entry.userId !== userId) return false;
      if (vehicleId && (entry.vehicleId || entry.payload.vehicleId) !== vehicleId) return false;
      if (leaseId && entry.payload.leaseId !== leaseId) return false;
      return entry.ts >= startTs && entry.ts <= endTs;
    })
    .slice(0, cappedLimit);
}

function buildTelemetrySourceKey(source: string, userId?: string, vehicleId?: string) {
  const safeSource = source.trim() || 'unknown';
  const safeUserId = (userId || 'anon').trim() || 'anon';
  const safeVehicleId = (vehicleId || 'none').trim() || 'none';
  return `${safeSource}|${safeUserId}|${safeVehicleId}`;
}

const apiServer = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.on('finish', () => {
    logStructured('info', 'api_request', {
      id: requestId,
      method: req.method,
      path: pathname,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      source: req.socket.remoteAddress || 'unknown',
    });
  });

  try {
    if (pathname === '/metrics' && req.method === 'GET') {
      const lines: string[] = [];
      lines.push(...formatPromLines(wsMetricsReceived, 'ivy_ws_received_total', [
        'endpoint',
        'vehicleId',
        'type',
      ]));
      lines.push(...formatPromLines(wsMetricsSent, 'ivy_ws_sent_total', [
        'endpoint',
        'vehicleId',
        'type',
      ]));
      lines.push(...formatPromLines(wsMetricsDropped, 'ivy_ws_dropped_total', [
        'endpoint',
        'vehicleId',
        'reason',
      ]));
      lines.push(...formatPromLines(wsAckLatencyBuckets, 'ivy_ws_ack_latency_ms_bucket', [
        'endpoint',
        'vehicleId',
        'le',
      ]));
      lines.push(...formatPromLines(wsAckLatencySum, 'ivy_ws_ack_latency_ms_sum', [
        'endpoint',
        'vehicleId',
      ]));
      lines.push(...formatPromLines(wsAckLatencyCount, 'ivy_ws_ack_latency_ms_count', [
        'endpoint',
        'vehicleId',
      ]));
      lines.push(`ivy_telemetry_queue_depth ${telemetryQueue.length}`);
      sendText(res, 200, lines.join('\n'));
      return;
    }
    if (pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ts: Date.now(),
        ws: {
          controlClients: wssControl?.clients.size ?? 0,
          telemetryClients: wssTelemetry?.clients.size ?? 0,
          deviceClients: wssDevice?.clients.size ?? 0,
        },
      });
      return;
    }

    if (await handleAuthRoutes(req, res, pathname, url, db)) return;
    if (
      await handleAdminRoutes(req, res, pathname, url, {
        db,
        userUpdateRateById,
        resetVehicleControlSequence: (vehicleId) => {
          for (const key of controlSequenceByVehicle.keys()) {
            if (key.startsWith(`${vehicleId}:`)) {
              controlSequenceByVehicle.delete(key);
            }
          }
        },
      })
    ) {
      return;
    }
    if (await handleMissionRoutes(req, res, pathname, url, db)) return;
    if (
      await handleTelemetryRoutes(req, res, pathname, url, {
        filterTelemetry,
        enqueueTelemetry: (entry, source) => {
          const nowMs = Date.now();
          const rateKey = buildTelemetrySourceKey(source, entry.userId, entry.vehicleId);
          if (
            !consumeRateLimit(
              telemetryApiRateBySource,
              rateKey,
              TELEMETRY_INGEST_RATE_PER_SEC,
              nowMs,
              TELEMETRY_INGEST_BURST
            )
          ) {
            incMetric(wsMetricsDropped, metricKey(['api', entry.vehicleId, 'rate_limited']));
            return { ok: false, dropped: 'rate_limited' };
          }
          const dropped = enqueueTelemetry(entry);
          if (dropped > 0) {
            incMetric(wsMetricsDropped, metricKey(['api', entry.vehicleId, 'queue_overflow']), dropped);
            return { ok: false, dropped: 'queue_overflow' };
          }
          return { ok: true };
        },
      })
    ) {
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if ((error as Error & { code?: string }).code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: message });
      return;
    }
    sendJson(res, 500, { error: message });
  }
});

if (START_API) {
  apiServer.listen(API_PORT, WS_HOST, () => {
    console.log(`API server is running on ${WS_HOST}:${API_PORT}`);
    logStructured('info', 'api_listen', { host: WS_HOST, port: API_PORT });
  });
}

let wssControl: WebSocketServer | null = null;
let wssTelemetry: WebSocketServer | null = null;
let wssDevice: WebSocketServer | null = null;

if (START_WS) {
  wssControl = new WebSocketServer({ host: WS_HOST, port: WS_CONTROL_PORT });
  wssTelemetry = new WebSocketServer({ host: WS_HOST, port: WS_TELEMETRY_PORT });
}

if (START_WS && wssControl) {
  wssControl.on('connection', (ws, req) => {
  const sourceKey = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || 0}`;
  endpointBySocket.set(ws, 'control');
  const connectionId = getConnectionId(ws);
  logWsVerbose(`control socket connected from ${sourceKey}`, {
    endpoint: 'control',
    connectionId,
  });
  logStructured('info', 'ws_connect', { endpoint: 'control', source: sourceKey, connectionId });
  ws.on('message', (message) => {
    try {
      const parsed = parseIncoming(message, defaultVehicleBySocket.get(ws));
      if (!parsed) return;
      incMetric(wsMetricsReceived, metricKey(['control', parsed.kind === 'input' ? parsed.vehicleId : undefined, parsed.kind]));
      if (parsed.kind === 'hello') {
        handleProtocolHandshake(ws, parsed.protocolVersion, sourceKey, 'control');
        if (parsed.vehicleId) {
          defaultVehicleBySocket.set(ws, parsed.vehicleId);
        }
        return;
      }

      if (parsed.kind === 'location_subscribe') {
        logWsVerbose(`location_subscribe on control socket from ${sourceKey}`, {
          endpoint: 'control',
          connectionId,
        });
        locationSubscribers.set(ws, parsed.vehicleId);
        const latest = latestLocations.get(parsed.vehicleId) || seedLocation(parsed.vehicleId);
        latestLocations.set(parsed.vehicleId, latest);
        sendMessage(ws, { type: 'location', payload: latest });
        return;
      }

      if (parsed.kind === 'coop_join') {
        coopSessions
          .join(ws, {
            sessionId: parsed.sessionId,
            vehicleId: parsed.vehicleId,
            userId: parsed.userId,
            username: parsed.username,
            role: parsed.role,
          })
          .forEach(broadcastCoopState);
        return;
      }

      if (parsed.kind === 'coop_leave') {
        broadcastCoopState(coopSessions.leave(ws));
        return;
      }

      if (parsed.kind === 'coop_chat') {
        const actor = coopSessions.getMeta(ws);
        const actorUserId = actor?.userId || parsed.userId;
        const actorUsername = actor?.username || parsed.username;
        const result = coopSessions.pushChat({
          sessionId: parsed.sessionId,
          userId: actorUserId,
          username: actorUsername,
          vehicleId: actor?.vehicleId || parsed.vehicleId,
          text: parsed.text,
        });
        if (result?.message) {
          const broadcast = result.broadcast;
          broadcast.sockets.forEach((socket) => {
            if (socket.readyState === WebSocket.OPEN) {
              sendMessage(socket, { type: 'coop_chat', payload: result.message! });
            }
          });
          broadcastCoopState(broadcast);
        }
        return;
      }

      if (parsed.kind === 'coop_plan_set') {
        const actor = coopSessions.getMeta(ws);
        broadcastCoopState(
          coopSessions.setPlan({
            sessionId: parsed.sessionId,
            userId: actor?.userId || parsed.userId,
            username: actor?.username || parsed.username,
            vehicleId: actor?.vehicleId || parsed.vehicleId,
            waypoints: parsed.waypoints,
            route: parsed.route,
            distanceMeters: parsed.distanceMeters,
            etaSeconds: parsed.etaSeconds,
          }, actor?.userId || parsed.userId)
        );
        return;
      }

      if (parsed.kind === 'coop_plan_clear') {
        const actor = coopSessions.getMeta(ws);
        broadcastCoopState(coopSessions.clearPlan(parsed.sessionId, actor?.userId || parsed.userId));
        return;
      }

      if (parsed.kind === 'input') {
        logWsVerbose(`input received on control socket from ${sourceKey}`, {
          endpoint: 'control',
          connectionId,
        });
        handleTelemetryInput(ws, sourceKey, parsed.payload, parsed.vehicleId);
        return;
      }

      if (parsed.kind === 'control') {
        const controlLabel = parsed.payload.mode === 'auto' ? 'mission' : 'control';
        const deviceReady = isDeviceSocketReady(parsed.vehicleId);
        logWsVerbose(
          `${controlLabel} received from ${sourceKey} vehicle=${parsed.vehicleId} lease=${parsed.payload.leaseId} seq=${parsed.payload.seq} device=${deviceReady ? 'online' : 'offline'}`,
          { endpoint: 'control', connectionId }
        );
        const vehicle = getVehicle(parsed.vehicleId);
        if (!vehicle) {
          sendMessage(ws, { type: 'error', message: `Vehicle ${parsed.vehicleId} not found.` });
          return;
        }
        if (!parsed.payload.leaseId && vehicle.controlLeaseId) {
          parsed.payload.leaseId = vehicle.controlLeaseId;
        }
        const leaseError = validateControlLease(vehicle, parsed.payload.leaseId);
        if (leaseError) {
          sendMessage(ws, { type: 'error', message: leaseError });
          return;
        }
        const nowMs = Date.now();
        const controlRateKey = parsed.vehicleId;
        if (
          !consumeRateLimit(
            controlRateByVehicle,
            controlRateKey,
            CONTROL_RATE_LIMIT_PER_SEC,
            nowMs,
            CONTROL_RATE_BURST
          )
        ) {
          sendMessage(ws, {
            type: 'error',
            message: `Control rate limit exceeded for vehicle ${parsed.vehicleId}.`,
          });
          return;
        }
        const controlSequenceError = validateSequence(
          controlSequenceByVehicle,
          `${parsed.vehicleId}:${parsed.payload.leaseId}`,
          parsed.payload.seq,
          'control'
        );
        if (controlSequenceError) {
          sendMessage(ws, { type: 'error', message: controlSequenceError });
          return;
        }
        const controlError = validateControlForVehicle(vehicle, parsed.payload);
        if (controlError) {
          sendMessage(ws, { type: 'error', message: controlError });
          return;
        }
        if (parsed.payload.mode) {
          driveModeByVehicle.set(parsed.vehicleId, parsed.payload.mode);
        }
        logWsVerbose(
          `control -> device vehicle=${parsed.vehicleId} payload=${JSON.stringify(parsed.payload)}`,
          { endpoint: 'control', connectionId }
        );
        const delivered = sendToVehicleOrQueue(parsed.vehicleId, 'control', {
          type: 'control',
          vehicleId: parsed.vehicleId,
          payload: parsed.payload,
        });
        if (!delivered) {
          logWsVerbose(`control queued vehicle=${parsed.vehicleId} (awaiting reconnect)`, {
            endpoint: 'control',
            connectionId,
          });
        }
        return;
      }

      if (parsed.kind === 'mission') {
        const deviceReady = isDeviceSocketReady(parsed.vehicleId);
        logWsVerbose(
          `mission received from ${sourceKey} vehicle=${parsed.vehicleId} waypoints=${parsed.payload.waypoints.length} device=${deviceReady ? 'online' : 'offline'}`,
          { endpoint: 'control', connectionId }
        );
        const vehicle = getVehicle(parsed.vehicleId);
        if (!vehicle) {
          sendMessage(ws, { type: 'error', message: `Vehicle ${parsed.vehicleId} not found.` });
          return;
        }
        if (vehicle.status !== 'unavailable' || !vehicle.controlLeaseId) {
          sendMessage(ws, {
            type: 'error',
            message: `Vehicle ${parsed.vehicleId} is not in an active control session.`,
          });
          return;
        }
        logWsVerbose(
          `mission -> device vehicle=${parsed.vehicleId} payload=${JSON.stringify(parsed.payload)}`,
          { endpoint: 'control', connectionId }
        );
        const delivered = sendToVehicleOrQueue(parsed.vehicleId, 'mission', {
          type: 'mission',
          vehicleId: parsed.vehicleId,
          payload: parsed.payload,
        });
        if (!delivered) {
          logWsVerbose(`mission queued vehicle=${parsed.vehicleId} (awaiting reconnect)`, {
            endpoint: 'control',
            connectionId,
          });
        }
        return;
      }

      if (parsed.kind === 'camera_control') {
        logWsVerbose(`camera_control from ${sourceKey} vehicle=${parsed.vehicleId} seq=${parsed.payload.seq}`, {
          endpoint: 'control',
          connectionId,
        });
        const vehicle = getVehicle(parsed.vehicleId);
        if (!vehicle) {
          sendMessage(ws, { type: 'error', message: `Vehicle ${parsed.vehicleId} not found.` });
          return;
        }
        const nowMs = Date.now();
        const cameraRateKey = parsed.vehicleId;
        if (
          !consumeRateLimit(
            cameraRateByVehicle,
            cameraRateKey,
            CAMERA_CONTROL_RATE_LIMIT_PER_SEC,
            nowMs,
            CONTROL_RATE_BURST
          )
        ) {
          sendMessage(ws, {
            type: 'error',
            message: `Camera control rate limit exceeded for vehicle ${parsed.vehicleId}.`,
          });
          return;
        }
        const cameraSequenceError = validateSequence(
          cameraSequenceByVehicle,
          parsed.vehicleId,
          parsed.payload.seq,
          'camera_control'
        );
        if (cameraSequenceError) {
          sendMessage(ws, { type: 'error', message: cameraSequenceError });
          return;
        }
        const cameraError = validateCameraControlForVehicle(vehicle, parsed.payload);
        if (cameraError) {
          sendMessage(ws, { type: 'error', message: cameraError });
          return;
        }
        const delivered = forwardToVehicleDevice(parsed.vehicleId, {
          type: 'camera_control',
          vehicleId: parsed.vehicleId,
          payload: parsed.payload,
        });
        if (!delivered) {
          logWsVerbose(`camera_control not delivered vehicle=${parsed.vehicleId} (no device socket)`, {
            endpoint: 'control',
            connectionId,
          });
          sendMessage(ws, {
            type: 'error',
            message: `No authenticated device socket for vehicle ${parsed.vehicleId}.`,
          });
        }
        return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WS][control][conn=${connectionId}] Failed to parse message:`, messageText);
      sendMessage(ws, { type: 'error', message: messageText });
    }
  });

  ws.on('close', () => {
    broadcastCoopState(coopSessions.leave(ws));
    telemetryWsRateBySource.delete(sourceKey);
    inputAckBySocket.delete(ws);
    locationSubscribers.delete(ws);
    lastInputTsBySocket.delete(ws);
    defaultVehicleBySocket.delete(ws);
    lastSlowDownBySocket.delete(ws);
    endpointBySocket.delete(ws);
    const connectionId = getConnectionId(ws);
    connectionIdBySocket.delete(ws);
    logStructured('info', 'ws_close', { endpoint: 'control', source: sourceKey, connectionId });
  });
  });
}

if (START_WS && wssTelemetry) {
  wssTelemetry.on('connection', (ws, req) => {
  const sourceKey = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || 0}`;
  endpointBySocket.set(ws, 'telemetry');
  const connectionId = getConnectionId(ws);
  logWsVerbose(`telemetry socket connected from ${sourceKey}`, {
    endpoint: 'telemetry',
    connectionId,
  });
  logStructured('info', 'ws_connect', { endpoint: 'telemetry', source: sourceKey, connectionId });
  ws.on('message', (message) => {
    try {
      const parsed = parseIncoming(message, defaultVehicleBySocket.get(ws));
      if (!parsed) return;
      incMetric(wsMetricsReceived, metricKey(['telemetry', parsed.kind === 'input' ? parsed.vehicleId : undefined, parsed.kind]));
      if (parsed.kind === 'hello') {
        handleProtocolHandshake(ws, parsed.protocolVersion, sourceKey, 'telemetry');
        if (parsed.vehicleId) {
          defaultVehicleBySocket.set(ws, parsed.vehicleId);
        }
        return;
      }
      if (parsed.kind === 'location_subscribe') {
        locationSubscribers.set(ws, parsed.vehicleId);
        const latest = latestLocations.get(parsed.vehicleId) || seedLocation(parsed.vehicleId);
        latestLocations.set(parsed.vehicleId, latest);
        sendMessage(ws, { type: 'location', payload: latest });
        return;
      }
      if (parsed.kind === 'input') {
        handleTelemetryInput(ws, sourceKey, parsed.payload, parsed.vehicleId);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WS][telemetry][conn=${connectionId}] Failed to parse telemetry message:`, messageText);
      sendMessage(ws, { type: 'error', message: messageText });
    }
  });

  ws.on('close', () => {
    telemetryWsRateBySource.delete(sourceKey);
    inputAckBySocket.delete(ws);
    locationSubscribers.delete(ws);
    lastInputTsBySocket.delete(ws);
    defaultVehicleBySocket.delete(ws);
    lastSlowDownBySocket.delete(ws);
    endpointBySocket.delete(ws);
    const connectionId = getConnectionId(ws);
    connectionIdBySocket.delete(ws);
    logStructured('info', 'ws_close', { endpoint: 'telemetry', source: sourceKey, connectionId });
  });
  });
}

if (START_WS) {
  wssDevice = new WebSocketServer({ host: WS_HOST, port: WS_DEVICE_PORT });
}

if (START_WS && wssDevice) {
  wssDevice.on('connection', (ws, req) => {
  const sourceKey = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || 0}`;
  deviceIpBySocket.set(ws, req.socket.remoteAddress || 'unknown');
  endpointBySocket.set(ws, 'device');
  const connectionId = getConnectionId(ws);
  logWsVerbose(`device socket connected from ${sourceKey}`, {
    endpoint: 'device',
    connectionId,
  });
  logStructured('info', 'ws_connect', { endpoint: 'device', source: sourceKey, connectionId });
  ws.on('message', (message) => {
    try {
      const parsed = parseIncoming(message, defaultVehicleBySocket.get(ws));
      if (!parsed) {
        return;
      }
      incMetric(wsMetricsReceived, metricKey(['device', parsed.kind === 'input' ? parsed.vehicleId : undefined, parsed.kind]));
      if (parsed.kind === 'hello') {
        if (!handleProtocolHandshake(ws, parsed.protocolVersion, sourceKey, 'device')) {
          return;
        }
        if (parsed.vehicleId) {
          defaultVehicleBySocket.set(ws, parsed.vehicleId);
        }
        markDeviceAlive(ws);
        return;
      }

      if (parsed.kind === 'device_hello') {
        const versionCheck = checkProtocolVersion(parsed.protocolVersion);
        if (!versionCheck.ok) {
          logWsVerbose(
            `auth_error from ${sourceKey}: protocol mismatch (${versionCheck.message})`,
            { endpoint: 'device', connectionId }
          );
          sendMessage(ws, {
            type: 'auth_error',
            message: versionCheck.message || 'Unsupported protocol version.',
          });
          ws.close();
          return;
        }
        if (versionCheck.message) {
          logWsVerbose(`device protocol notice from ${sourceKey}: ${versionCheck.message}`, {
            endpoint: 'device',
            connectionId,
          });
        }
        const result = authenticateDeviceHello(parsed.payload);
        if (!result.ok) {
          logWsVerbose(
            `auth_error from ${sourceKey}: device_hello rejected (${result.message})`,
            { endpoint: 'device', connectionId }
          );
          sendMessage(ws, { type: 'auth_error', message: result.message });
          ws.close();
          return;
        }

        const previous = deviceSocketByVehicleId.get(result.vehicleId);
        if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
          sendMessage(previous, {
            type: 'auth_error',
            message: 'Device session replaced by a new authenticated connection.',
          });
          previous.close();
        }

        authBySocket.set(ws, {
          vehicleId: result.vehicleId,
          deviceId: result.deviceId,
          authenticated: true,
          lastSeenMs: Date.now(),
        });
        const deviceIp = deviceIpBySocket.get(ws);
        if (deviceIp) {
          deviceIpByVehicle.set(result.vehicleId, deviceIp);
        }
        if (parsed.payload.fw) {
          deviceFwByVehicle.set(result.vehicleId, parsed.payload.fw);
        }
        deviceSocketByVehicleId.set(result.vehicleId, ws);
        defaultVehicleBySocket.set(ws, result.vehicleId);
        flushPendingDeviceMessages(result.vehicleId, ws);
        logWsVerbose(
          `auth_ok vehicle=${result.vehicleId} device=${result.deviceId} source=${sourceKey}`,
          { endpoint: 'device', connectionId }
        );
        sendMessage(ws, {
          type: 'auth_ok',
          vehicleId: result.vehicleId,
          deviceId: result.deviceId,
          ts: Date.now(),
        });
        broadcastDeviceStatus(result.vehicleId, result.deviceId, true, Date.now(), true);
        return;
      }

      const auth = authBySocket.get(ws);
      if (!auth?.authenticated) {
      logWsVerbose(`auth_error from ${sourceKey}: unauthenticated socket`, {
        endpoint: 'device',
        connectionId,
      });
      sendMessage(ws, {
        type: 'auth_error',
        message: 'Unauthenticated device socket. Send device_hello first.',
      });
      ws.close();
        return;
      }
      markDeviceAlive(ws);

      if (parsed.kind === 'input') {
        const inputVehicleId = parsed.vehicleId || auth.vehicleId;
        if (inputVehicleId !== auth.vehicleId) {
          sendMessage(ws, {
            type: 'error',
            message: 'Input vehicleId does not match authenticated vehicle.',
          });
          return;
        }

        const nowMs = Date.now();
        if (
          !consumeRateLimit(
            telemetryWsRateBySource,
            sourceKey,
            TELEMETRY_INGEST_RATE_PER_SEC,
            nowMs,
            TELEMETRY_INGEST_BURST
          )
        ) {
          return;
        }

        const payload = parsed.payload;

        const location = updateVehicleLocationFromTelemetry(inputVehicleId, payload);
        broadcastLocation(location);
        broadcastToControlClients({ type: 'cpp', text: formatCppText(payload) });
        return;
      }

      if (parsed.kind === 'location') {
        const vehicle = getVehicle(parsed.payload.vehicleId);
        if (!vehicle) {
          sendMessage(ws, {
            type: 'error',
            message: `Vehicle ${parsed.payload.vehicleId} not found for location update.`,
          });
          return;
        }
        if (!supportsModule(vehicle, 'location')) {
          sendMessage(ws, {
            type: 'error',
            message: `Vehicle ${parsed.payload.vehicleId} does not support location module.`,
          });
          return;
        }
        if (parsed.payload.vehicleId !== auth.vehicleId) {
          sendMessage(ws, {
            type: 'error',
            message: 'Location vehicleId does not match authenticated vehicle.',
          });
          return;
        }
        latestLocations.set(parsed.payload.vehicleId, parsed.payload);
        broadcastLocation(parsed.payload);
        return;
      }

      if (parsed.kind === 'sensor_state') {
        const vehicle = getVehicle(parsed.vehicleId);
        if (!vehicle) {
          sendMessage(ws, { type: 'error', message: `Vehicle ${parsed.vehicleId} not found.` });
          return;
        }
        if (!supportsModule(vehicle, 'sensor_state')) {
          sendMessage(ws, {
            type: 'error',
            message: `Vehicle ${parsed.vehicleId} does not support sensor state module.`,
          });
          return;
        }
        if (parsed.vehicleId !== auth.vehicleId || parsed.payload.vehicleId !== auth.vehicleId) {
          sendMessage(ws, {
            type: 'error',
            message: 'Sensor state vehicleId mismatch for authenticated socket.',
          });
          return;
        }
        broadcastToControlClients({
          type: 'sensor_state',
          vehicleId: parsed.vehicleId,
          payload: parsed.payload,
        });
        return;
      }

      if (parsed.kind === 'camera_status') {
        const vehicle = getVehicle(parsed.vehicleId);
        if (!vehicle) {
          sendMessage(ws, { type: 'error', message: `Vehicle ${parsed.vehicleId} not found.` });
          return;
        }
        if (!supportsModule(vehicle, 'camera_status')) {
          sendMessage(ws, {
            type: 'error',
            message: `Vehicle ${parsed.vehicleId} does not support camera status module.`,
          });
          return;
        }
        if (parsed.vehicleId !== auth.vehicleId || parsed.payload.vehicleId !== auth.vehicleId) {
          sendMessage(ws, {
            type: 'error',
            message: 'Camera status vehicleId mismatch for authenticated socket.',
          });
          return;
        }
        broadcastToControlClients({
          type: 'camera_status',
          vehicleId: parsed.vehicleId,
          payload: parsed.payload,
        });
        return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WS][device][conn=${connectionId}] Failed to parse message:`, messageText);
      sendMessage(ws, { type: 'error', message: messageText });
    }
  });

  ws.on('close', () => {
    telemetryWsRateBySource.delete(sourceKey);
    const auth = authBySocket.get(ws);
    if (auth) {
      logWsVerbose(
        `device socket closed vehicle=${auth.vehicleId} device=${auth.deviceId} source=${sourceKey}`,
        { endpoint: 'device', connectionId }
      );
      stopReplayTimer(auth.vehicleId);
      broadcastDeviceStatus(auth.vehicleId, auth.deviceId, false, Date.now(), true);
    } else {
      logWsVerbose(`device socket closed source=${sourceKey}`, {
        endpoint: 'device',
        connectionId,
      });
    }
    if (auth) {
      const current = deviceSocketByVehicleId.get(auth.vehicleId);
      if (current === ws) {
        deviceSocketByVehicleId.delete(auth.vehicleId);
      }
      authBySocket.delete(ws);
    }
    deviceIpBySocket.delete(ws);
    lastInputTsBySocket.delete(ws);
    defaultVehicleBySocket.delete(ws);
    lastSlowDownBySocket.delete(ws);
    endpointBySocket.delete(ws);
    connectionIdBySocket.delete(ws);
    logStructured('info', 'ws_close', {
      endpoint: 'device',
      source: sourceKey,
      vehicleId: auth?.vehicleId,
      connectionId,
    });
  });
  });
}

setInterval(() => {
  const nowMs = Date.now();
  for (const [socket, auth] of authBySocket.entries()) {
    if (!auth.authenticated) continue;
    if (nowMs - auth.lastSeenMs <= DEVICE_HEARTBEAT_TIMEOUT_MS) continue;

    const currentSocket = deviceSocketByVehicleId.get(auth.vehicleId);
    if (currentSocket === socket) {
      deviceSocketByVehicleId.delete(auth.vehicleId);
    }
    authBySocket.delete(socket);
    stopReplayTimer(auth.vehicleId);
    broadcastDeviceStatus(auth.vehicleId, auth.deviceId, false, nowMs, true);

    if (socket.readyState === WebSocket.OPEN) {
      logWsVerbose(`heartbeat timeout vehicle=${auth.vehicleId} device=${auth.deviceId}`);
      sendMessage(socket, {
        type: 'auth_error',
        message: `Heartbeat timeout for vehicle ${auth.vehicleId}. Enter failsafe.`,
      });
      socket.close();
    }

    broadcastToControlClients({
      type: 'error',
      message: `Device heartbeat timed out for ${auth.vehicleId}. Failsafe should be active on edge controller.`,
    });
  }
}, Math.max(250, DEVICE_HEARTBEAT_SCAN_MS));

setInterval(() => {
  if (!Number.isFinite(TELEMETRY_RETENTION_DAYS) || TELEMETRY_RETENTION_DAYS <= 0) return;
  const cutoffTs = Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  pruneTelemetryBefore(db, cutoffTs, TELEMETRY_ARCHIVE_DIR);
}, 60_000);

if (START_WS) {
  console.log(
    `WebSocket servers are running on ${WS_HOST}:${WS_CONTROL_PORT} (control), ${WS_HOST}:${WS_TELEMETRY_PORT} (telemetry), and ${WS_HOST}:${WS_DEVICE_PORT} (device).`
  );
  logStructured('info', 'ws_listen', { endpoint: 'control', host: WS_HOST, port: WS_CONTROL_PORT });
  logStructured('info', 'ws_listen', {
    endpoint: 'telemetry',
    host: WS_HOST,
    port: WS_TELEMETRY_PORT,
  });
  logStructured('info', 'ws_listen', { endpoint: 'device', host: WS_HOST, port: WS_DEVICE_PORT });
}

