import path from 'node:path';

export const WS_HOST = process.env.WS_HOST || '0.0.0.0';
export const WS_CONTROL_PORT = Number(
  process.env.WS_CONTROL_PORT || process.env.WS_RECEIVE_PORT || process.env.WS_PORT || 3000
);
export const WS_TELEMETRY_PORT = Number(
  process.env.WS_TELEMETRY_PORT || process.env.WS_INPUT_PORT || 3001
);
export const WS_DEVICE_PORT = Number(
  process.env.WS_DEVICE_PORT || process.env.WS_BROADCAST_PORT || 4000
);
export const API_PORT = Number(process.env.API_PORT || 3100);
export const MAX_LOGS = 1000;
export const MAX_RECORDS = 10000;
export const MAX_TELEMETRY = 50000;
export const TELEMETRY_FLUSH_INTERVAL_MS = Number(
  process.env.TELEMETRY_FLUSH_INTERVAL_MS || 250
);
export const TELEMETRY_INGEST_RATE_PER_SEC = Number(
  process.env.TELEMETRY_INGEST_RATE_PER_SEC || 20
);
export const TELEMETRY_INGEST_BURST = Number(process.env.TELEMETRY_INGEST_BURST || 2);
export const TELEMETRY_ACK_INTERVAL_MS = Number(process.env.TELEMETRY_ACK_INTERVAL_MS || 500);
export const TELEMETRY_QUEUE_MAX = Math.max(
  100,
  Math.min(20_000, Number(process.env.TELEMETRY_QUEUE_MAX || 5000))
);
export const TELEMETRY_SLOWDOWN_MS = Number(process.env.TELEMETRY_SLOWDOWN_MS || 1000);
export const TELEMETRY_RETENTION_DAYS = Math.max(
  1,
  Math.min(30, Number(process.env.TELEMETRY_RETENTION_DAYS || 7))
);
export const TELEMETRY_ARCHIVE_DIR =
  process.env.TELEMETRY_ARCHIVE_DIR ||
  path.resolve(process.cwd(), 'server', 'data', 'telemetry-archive');
export const DEVICE_AUTH_WINDOW_MS = Number(process.env.DEVICE_AUTH_WINDOW_MS || 30_000);
export const DEVICE_SHARED_SECRET = process.env.DEVICE_SHARED_SECRET || 'ivy-dev-device-secret';
export const CONTROL_RATE_LIMIT_PER_SEC = Number(
  process.env.CONTROL_RATE_LIMIT_PER_SEC || 30
);
export const CAMERA_CONTROL_RATE_LIMIT_PER_SEC = Number(
  process.env.CAMERA_CONTROL_RATE_LIMIT_PER_SEC || 12
);
export const CONTROL_RATE_BURST = Number(process.env.CONTROL_RATE_BURST || 2);
export const CONTROL_REPLAY_WINDOW = Number(process.env.CONTROL_REPLAY_WINDOW || 128);
export const CONTROL_SEQ_MAX_JUMP = Number(process.env.CONTROL_SEQ_MAX_JUMP || 4096);
export const DEVICE_HEARTBEAT_TIMEOUT_MS = Number(
  process.env.DEVICE_HEARTBEAT_TIMEOUT_MS || 5_000
);
export const DEVICE_HEARTBEAT_SCAN_MS = Number(process.env.DEVICE_HEARTBEAT_SCAN_MS || 1_000);
export const ALLOW_LEGACY_INPUT = process.env.IVY_ALLOW_LEGACY_INPUT === '1';
export const USER_UPDATE_MIN_INTERVAL_MS = Number(
  process.env.USER_UPDATE_MIN_INTERVAL_MS || 5_000
);
export const WS_VERBOSE = process.env.WS_VERBOSE === '1';
export const START_API = process.env.IVY_START_API !== '0';
export const START_WS = process.env.IVY_START_WS !== '0';
export const BODY_LIMIT_DEFAULT = Number(process.env.BODY_LIMIT_DEFAULT || 5_000_000);
export const BODY_LIMIT_AUTH = Number(process.env.BODY_LIMIT_AUTH || 20_000);
export const BODY_LIMIT_USERS = Number(process.env.BODY_LIMIT_USERS || 50_000);
export const BODY_LIMIT_VEHICLES = Number(process.env.BODY_LIMIT_VEHICLES || 100_000);
export const BODY_LIMIT_LOGS = Number(process.env.BODY_LIMIT_LOGS || 100_000);
export const BODY_LIMIT_RECORDS = Number(process.env.BODY_LIMIT_RECORDS || 100_000);
export const BODY_LIMIT_MISSIONS = Number(process.env.BODY_LIMIT_MISSIONS || 2_000_000);
export const BODY_LIMIT_INPUT = Number(process.env.BODY_LIMIT_INPUT || 500_000);
