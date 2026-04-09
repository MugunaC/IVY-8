import path from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  defaultVehicleCapabilities,
  withVehicleCapabilities,
} from './adapters/vehicleAdapter.js';
import { hashPassword } from './lib/auth.js';
import type {
  ActivityLog,
  MissionPlan,
  RecordEntry,
  TelemetryEntry,
  User,
  Vehicle,
} from '../shared/types.js';

const DB_DIR = path.join(process.cwd(), 'server/data');
const DB_FILE = path.join(DB_DIR, 'ivy.db');
const LEGACY_DATA_DIR = path.resolve(process.cwd(), '..', '5', 'server', 'data');
const MIGRATION_META_KEY = 'json_migrated_v1';
const ENABLE_LEGACY_MIGRATION = process.env.IVY_ENABLE_LEGACY_MIGRATION === '1';

function ensureDbDir() {
  mkdirSync(DB_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

export type StoredUser = User & { passwordHash: string };

export type Db = Database;

export function openDb() {
  ensureDbDir();
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      email TEXT,
      passwordHash TEXT NOT NULL,
      createdAt TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      condition TEXT NOT NULL,
      assignedUsers TEXT NOT NULL,
      location TEXT NOT NULL,
      charge REAL NOT NULL,
      currentUser TEXT,
      currentUserId TEXT,
      controlLeaseId TEXT,
      controlLeaseIssuedAt TEXT,
      capabilities TEXT
    );
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      userId TEXT,
      username TEXT,
      vehicleId TEXT
    );
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      name TEXT NOT NULL,
      pathType TEXT NOT NULL,
      speedMps REAL NOT NULL,
      waypoints TEXT NOT NULL,
      route TEXT,
      distanceMeters REAL,
      etaSeconds REAL,
      profile TEXT,
      arrivalRadiusM REAL,
      loiterSeconds REAL,
      cruiseAltitudeM REAL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mission_routes (
      missionId TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      route TEXT,
      route_polyline TEXT,
      route_encoding TEXT,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      userId TEXT,
      username TEXT,
      vehicleId TEXT,
      payload TEXT NOT NULL,
      bytes INTEGER NOT NULL
    );
  `);
  ensureDbMigrations(db);
  return db;
}

function ensureDbMigrations(db: Db) {
  const missionRouteCols = db.prepare(`PRAGMA table_info('mission_routes')`).all() as Array<{
    name: string;
  }>;
  const hasPolyline = missionRouteCols.some((col) => col.name === 'route_polyline');
  if (!hasPolyline) {
    db.exec(`ALTER TABLE mission_routes ADD COLUMN route_polyline TEXT;`);
    db.exec(`ALTER TABLE mission_routes ADD COLUMN route_encoding TEXT;`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_ts ON telemetry(vehicleId, ts);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_missions_vehicle_updated ON missions(vehicleId, updatedAt);`);
}

function encodePolyline(coords: [number, number][], precision = 5) {
  const factor = Math.pow(10, precision);
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  for (const [lng, lat] of coords) {
    const latE5 = Math.round(lat * factor);
    const lngE5 = Math.round(lng * factor);
    const dLat = latE5 - lastLat;
    const dLng = lngE5 - lastLng;
    lastLat = latE5;
    lastLng = lngE5;
    result += encodeSigned(dLat) + encodeSigned(dLng);
  }
  return result;
}

function encodeSigned(value: number) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let result = '';
  while (v >= 0x20) {
    result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  result += String.fromCharCode(v + 63);
  return result;
}

function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const coords: [number, number][] = [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;
  while (index < len) {
    let result = 1;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f && index < len);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f && index < len);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

function seedDb(db: Db) {
  const usersCount = db.prepare('SELECT COUNT(1) as count FROM users').get() as { count: number };
  if (usersCount.count > 0) return;
  const users: StoredUser[] = [
    {
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      createdAt: nowIso(),
      passwordHash: hashPassword('admin123'),
    },
    {
      id: 'user-1',
      username: 'user1',
      email: 'user1@example.com',
      role: 'user',
      createdAt: nowIso(),
      passwordHash: hashPassword('user123'),
    },
    {
      id: 'user-2',
      username: 'user2',
      email: 'user2@example.com',
      role: 'user',
      createdAt: nowIso(),
      passwordHash: hashPassword('user123'),
    },
  ];
  const vehicles: Vehicle[] = [
    {
      id: 'VH-001',
      model: 'Tesla Model 3',
      status: 'available',
      condition: 'Excellent',
      assignedUsers: ['user-1', 'user-2'],
      location: 'Garage A',
      charge: 85,
      capabilities: defaultVehicleCapabilities('rover'),
    },
    {
      id: 'VH-002',
      model: 'Toyota Prius',
      status: 'available',
      condition: 'Good',
      assignedUsers: ['user-1'],
      location: 'Garage B',
      charge: 92,
      capabilities: defaultVehicleCapabilities('rover'),
    },
    {
      id: 'VH-003',
      model: 'Honda Civic',
      status: 'maintenance',
      condition: 'Fair',
      assignedUsers: [],
      location: 'Service Center',
      charge: 45,
      capabilities: defaultVehicleCapabilities('rover'),
    },
  ];
  const insertUser = db.prepare(
    `INSERT INTO users (id, username, role, email, passwordHash, createdAt)
     VALUES (@id, @username, @role, @email, @passwordHash, @createdAt)`
  );
  const insertVehicle = db.prepare(
    `INSERT INTO vehicles (id, model, status, condition, assignedUsers, location, charge, currentUser, currentUserId, controlLeaseId, controlLeaseIssuedAt, capabilities)
     VALUES (@id, @model, @status, @condition, @assignedUsers, @location, @charge, @currentUser, @currentUserId, @controlLeaseId, @controlLeaseIssuedAt, @capabilities)`
  );
  const tx = db.transaction(() => {
    users.forEach((user) => insertUser.run(user));
    vehicles.forEach((vehicle) => insertVehicle.run(serializeVehicle(vehicle)));
  });
  tx();
}

function getMeta(db: Db, key: string) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setMeta(db: Db, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Failed to parse legacy JSON file at ${filePath}:`, error);
    return null;
  }
}

function maybeMigrateFromJson(db: Db) {
  if (!ENABLE_LEGACY_MIGRATION) return false;
  if (getMeta(db, MIGRATION_META_KEY) === '1') return false;

  const usersCount = db.prepare('SELECT COUNT(1) as count FROM users').get() as { count: number };
  const vehiclesCount = db.prepare('SELECT COUNT(1) as count FROM vehicles').get() as { count: number };
  if (usersCount.count > 0 || vehiclesCount.count > 0) {
    return false;
  }

  const dbJson = readJsonFile<{
    users?: StoredUser[];
    vehicles?: Vehicle[];
    logs?: ActivityLog[];
    records?: RecordEntry[];
  }>(path.join(process.env.JSON_MIGRATION_PATH || LEGACY_DATA_DIR, 'db.json'));
  const missionsJson = readJsonFile<{ missions?: MissionPlan[] }>(
    path.join(process.env.JSON_MIGRATION_PATH || LEGACY_DATA_DIR, 'missions.json')
  );
  const telemetryJson =
    readJsonFile<{ telemetry?: TelemetryEntry[] }>(
      path.join(process.env.JSON_MIGRATION_PATH || LEGACY_DATA_DIR, 'telemetry.json')
    ) ||
    readJsonFile<{ telemetry?: TelemetryEntry[] }>(
      path.join(process.env.JSON_MIGRATION_PATH || LEGACY_DATA_DIR, 'input.json')
    );

  if (!dbJson && !missionsJson && !telemetryJson) {
    return false;
  }

  console.log('Migrating legacy JSON data into SQLite...');

  const insertUserStmt = db.prepare(
    `INSERT OR REPLACE INTO users (id, username, role, email, passwordHash, createdAt)
     VALUES (@id, @username, @role, @email, @passwordHash, @createdAt)`
  );
  const insertVehicleStmt = db.prepare(
    `INSERT OR REPLACE INTO vehicles (id, model, status, condition, assignedUsers, location, charge, currentUser, currentUserId, controlLeaseId, controlLeaseIssuedAt, capabilities)
     VALUES (@id, @model, @status, @condition, @assignedUsers, @location, @charge, @currentUser, @currentUserId, @controlLeaseId, @controlLeaseIssuedAt, @capabilities)`
  );
  const insertLogStmt = db.prepare(
    `INSERT OR REPLACE INTO logs (id, userId, username, action, details, timestamp)
     VALUES (@id, @userId, @username, @action, @details, @timestamp)`
  );
  const insertRecordStmt = db.prepare(
    `INSERT OR REPLACE INTO records (id, ts, action, details, userId, username, vehicleId)
     VALUES (@id, @ts, @action, @details, @userId, @username, @vehicleId)`
  );
  const insertMissionStmt = db.prepare(
    `INSERT OR REPLACE INTO missions (id, vehicleId, name, pathType, speedMps, waypoints, route, distanceMeters, etaSeconds, profile, arrivalRadiusM, loiterSeconds, cruiseAltitudeM, createdAt, updatedAt)
     VALUES (@id, @vehicleId, @name, @pathType, @speedMps, @waypoints, @route, @distanceMeters, @etaSeconds, @profile, @arrivalRadiusM, @loiterSeconds, @cruiseAltitudeM, @createdAt, @updatedAt)`
  );
  const insertRouteStmt = db.prepare(
    `INSERT OR REPLACE INTO mission_routes (missionId, vehicleId, route, updatedAt)
     VALUES (@missionId, @vehicleId, @route, @updatedAt)`
  );

  const tx = db.transaction(() => {
    dbJson?.users?.forEach((user) => insertUserStmt.run(serializeUser(user)));
    dbJson?.vehicles?.forEach((vehicle) => {
      insertVehicleStmt.run(serializeVehicle(withVehicleCapabilities(vehicle)));
    });
    dbJson?.logs?.forEach((log) => insertLogStmt.run(serializeLog(log)));
    dbJson?.records?.forEach((record) => insertRecordStmt.run(serializeRecord(record)));
    missionsJson?.missions?.forEach((mission) => {
      insertMissionStmt.run(serializeMission(mission));
      if (mission.route) {
        insertRouteStmt.run({
          missionId: mission.id,
          vehicleId: mission.vehicleId,
          route: JSON.stringify(mission.route),
          updatedAt: mission.updatedAt ?? nowIso(),
        });
      }
    });
  });
  tx();

  if (telemetryJson?.telemetry?.length) {
    const entries = telemetryJson.telemetry.map((entry) => ({
      ...entry,
      bytes: entry.bytes ?? JSON.stringify(entry.payload).length,
    }));
    const batchSize = 500;
    for (let i = 0; i < entries.length; i += batchSize) {
      appendTelemetry(db, entries.slice(i, i + batchSize));
    }
  }

  setMeta(db, MIGRATION_META_KEY, '1');
  console.log('Legacy JSON migration completed.');
  return true;
}

function serializeVehicle(vehicle: Vehicle) {
  return {
    ...vehicle,
    currentUser: vehicle.currentUser ?? null,
    currentUserId: vehicle.currentUserId ?? null,
    controlLeaseId: vehicle.controlLeaseId ?? null,
    controlLeaseIssuedAt: vehicle.controlLeaseIssuedAt ?? null,
    assignedUsers: JSON.stringify(vehicle.assignedUsers ?? []),
    capabilities: vehicle.capabilities ? JSON.stringify(vehicle.capabilities) : null,
  };
}

function serializeUser(user: StoredUser) {
  return {
    ...user,
    email: user.email ?? null,
  };
}

function serializeLog(log: ActivityLog) {
  return {
    ...log,
    id: log.id || newId('log'),
    details: log.details ?? null,
  };
}

function serializeRecord(record: RecordEntry) {
  return {
    ...record,
    id: record.id || newId('record'),
    details: record.details ?? null,
    userId: record.userId ?? null,
    username: record.username ?? null,
    vehicleId: record.vehicleId ?? null,
  };
}

function deserializeVehicle(row: any): Vehicle {
  const assignedUsers = row.assignedUsers ? JSON.parse(row.assignedUsers) : [];
  const capabilities = row.capabilities ? JSON.parse(row.capabilities) : undefined;
  return withVehicleCapabilities({
    ...row,
    assignedUsers,
    capabilities,
  } as Vehicle);
}

function serializeMission(plan: MissionPlan) {
  return {
    ...plan,
    profile: plan.profile ?? null,
    arrivalRadiusM: plan.arrivalRadiusM ?? null,
    loiterSeconds: plan.loiterSeconds ?? null,
    cruiseAltitudeM: plan.cruiseAltitudeM ?? null,
    waypoints: JSON.stringify(plan.waypoints ?? []),
    route: null,
  };
}

function deserializeMission(row: any): MissionPlan {
  const route = resolveRouteFromRow(row);
  return {
    ...row,
    waypoints: row.waypoints ? JSON.parse(row.waypoints) : [],
    route,
  } as MissionPlan;
}

function resolveRouteFromRow(row: any): MissionPlan['route'] | undefined {
  if (row?.route_polyline && row?.route_encoding === 'polyline5') {
    try {
      const coords = decodePolyline(String(row.route_polyline), 5);
      if (coords.length >= 2) {
        return { type: 'LineString', coordinates: coords };
      }
    } catch {
      return undefined;
    }
  }
  const raw = row?.route ?? row?.route_legacy ?? row?.route_fallback;
  if (raw) {
    try {
      return JSON.parse(raw) as MissionPlan['route'];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function initDb() {
  const db = openDb();
  const migrated = maybeMigrateFromJson(db);
  if (!migrated) {
    seedDb(db);
  }
  return db;
}

export function listUsers(db: Db) {
  return db.prepare('SELECT * FROM users').all() as StoredUser[];
}

export function findUserByIdentifier(db: Db, identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return undefined;
  return db
    .prepare('SELECT * FROM users WHERE lower(id) = ? OR lower(username) = ? OR lower(email) = ? LIMIT 1')
    .get(normalized, normalized, normalized) as StoredUser | undefined;
}

export function insertUser(db: Db, user: StoredUser) {
  db.prepare(
    `INSERT INTO users (id, username, role, email, passwordHash, createdAt)
     VALUES (@id, @username, @role, @email, @passwordHash, @createdAt)`
  ).run(user);
}

export function updateUser(db: Db, id: string, updates: Partial<StoredUser>) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as StoredUser | undefined;
  if (!existing) return null;
  const next = { ...existing, ...updates };
  db.prepare(
    `UPDATE users SET username=@username, role=@role, email=@email, passwordHash=@passwordHash, createdAt=@createdAt WHERE id=@id`
  ).run(next);
  return next;
}

export function deleteUser(db: Db, id: string) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function listVehicles(db: Db): Vehicle[] {
  const rows = db.prepare('SELECT * FROM vehicles').all();
  return rows.map(deserializeVehicle);
}

export function getVehicle(db: Db, id: string): Vehicle | null {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  return row ? deserializeVehicle(row) : null;
}

export function insertVehicle(db: Db, vehicle: Vehicle) {
  db.prepare(
    `INSERT INTO vehicles (id, model, status, condition, assignedUsers, location, charge, currentUser, currentUserId, controlLeaseId, controlLeaseIssuedAt, capabilities)
     VALUES (@id, @model, @status, @condition, @assignedUsers, @location, @charge, @currentUser, @currentUserId, @controlLeaseId, @controlLeaseIssuedAt, @capabilities)`
  ).run(serializeVehicle(vehicle));
}

export function updateVehicle(db: Db, id: string, updates: Partial<Vehicle>) {
  const existing = getVehicle(db, id);
  if (!existing) return null;
  const next = { ...existing, ...updates };
  db.prepare(
    `UPDATE vehicles SET model=@model, status=@status, condition=@condition, assignedUsers=@assignedUsers, location=@location, charge=@charge,
      currentUser=@currentUser, currentUserId=@currentUserId, controlLeaseId=@controlLeaseId, controlLeaseIssuedAt=@controlLeaseIssuedAt, capabilities=@capabilities
     WHERE id=@id`
  ).run(serializeVehicle(next));
  return next;
}

export function deleteVehicle(db: Db, id: string) {
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
}

export function listLogs(db: Db, limit: number) {
  return db
    .prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as ActivityLog[];
}

export function addLog(db: Db, log: ActivityLog) {
  db.prepare(
    `INSERT INTO logs (id, userId, username, action, details, timestamp)
     VALUES (@id, @userId, @username, @action, @details, @timestamp)`
  ).run(log);
}

export function clearLogs(db: Db) {
  db.prepare('DELETE FROM logs').run();
}

export function listRecords(db: Db, limit: number) {
  return db.prepare('SELECT * FROM records ORDER BY ts DESC LIMIT ?').all(limit) as RecordEntry[];
}

export function addRecord(db: Db, record: RecordEntry) {
  db.prepare(
    `INSERT INTO records (id, ts, action, details, userId, username, vehicleId)
     VALUES (@id, @ts, @action, @details, @userId, @username, @vehicleId)`
  ).run(record);
}

export function listMissions(
  db: Db,
  vehicleId?: string,
  options?: { includeRoute?: boolean }
) {
  const includeRoute = options?.includeRoute === true;
  const baseColumns = [
    'id',
    'vehicleId',
    'name',
    'pathType',
    'speedMps',
    'waypoints',
    'distanceMeters',
    'etaSeconds',
    'profile',
    'arrivalRadiusM',
    'loiterSeconds',
    'cruiseAltitudeM',
    'createdAt',
    'updatedAt',
  ];
  const baseColumnsSql = baseColumns.join(', ');
  const baseColumnsQualifiedSql = baseColumns.map((col) => `m.${col}`).join(', ');
  if (includeRoute) {
    const sql = vehicleId
      ? `SELECT ${baseColumnsQualifiedSql}, r.route_polyline, r.route_encoding, r.route as route_legacy, m.route as route_fallback
         FROM missions m LEFT JOIN mission_routes r ON r.missionId = m.id WHERE m.vehicleId = ? ORDER BY m.updatedAt DESC`
      : `SELECT ${baseColumnsQualifiedSql}, r.route_polyline, r.route_encoding, r.route as route_legacy, m.route as route_fallback
         FROM missions m LEFT JOIN mission_routes r ON r.missionId = m.id ORDER BY m.updatedAt DESC`;
    const rows = vehicleId ? db.prepare(sql).all(vehicleId) : db.prepare(sql).all();
    return rows.map(deserializeMission) as MissionPlan[];
  }
  const sql = vehicleId
    ? `SELECT ${baseColumnsSql} FROM missions WHERE vehicleId = ? ORDER BY updatedAt DESC`
    : `SELECT ${baseColumnsSql} FROM missions ORDER BY updatedAt DESC`;
  const rows = vehicleId ? db.prepare(sql).all(vehicleId) : db.prepare(sql).all();
  return rows.map(deserializeMission) as MissionPlan[];
}

export function upsertMission(db: Db, plan: MissionPlan) {
  const exists = db.prepare('SELECT id FROM missions WHERE id = ?').get(plan.id);
  if (exists) {
    db.prepare(
      `UPDATE missions SET vehicleId=@vehicleId, name=@name, pathType=@pathType, speedMps=@speedMps, waypoints=@waypoints, route=@route,
        distanceMeters=@distanceMeters, etaSeconds=@etaSeconds, profile=@profile, arrivalRadiusM=@arrivalRadiusM, loiterSeconds=@loiterSeconds,
        cruiseAltitudeM=@cruiseAltitudeM, createdAt=@createdAt, updatedAt=@updatedAt WHERE id=@id`
    ).run(serializeMission(plan));
  } else {
    db.prepare(
      `INSERT INTO missions (id, vehicleId, name, pathType, speedMps, waypoints, route, distanceMeters, etaSeconds, profile, arrivalRadiusM, loiterSeconds, cruiseAltitudeM, createdAt, updatedAt)
       VALUES (@id, @vehicleId, @name, @pathType, @speedMps, @waypoints, @route, @distanceMeters, @etaSeconds, @profile, @arrivalRadiusM, @loiterSeconds, @cruiseAltitudeM, @createdAt, @updatedAt)`
    ).run(serializeMission(plan));
  }
  if (plan.route) {
    setMissionRoute(db, plan.id, plan.vehicleId, plan.route, plan.updatedAt);
  }
}

export function deleteMission(db: Db, id: string) {
  db.prepare('DELETE FROM missions WHERE id = ?').run(id);
  db.prepare('DELETE FROM mission_routes WHERE missionId = ?').run(id);
}

export function setMissionRoute(
  db: Db,
  missionId: string,
  vehicleId: string,
  route: MissionPlan['route'],
  updatedAt: string
) {
  const polyline =
    route && route.coordinates?.length ? encodePolyline(route.coordinates, 5) : null;
  db.prepare(
    `INSERT OR REPLACE INTO mission_routes (missionId, vehicleId, route, route_polyline, route_encoding, updatedAt)
     VALUES (@missionId, @vehicleId, @route, @route_polyline, @route_encoding, @updatedAt)`
  ).run({
    missionId,
    vehicleId,
    route: route ? JSON.stringify(route) : null,
    route_polyline: polyline,
    route_encoding: polyline ? 'polyline5' : null,
    updatedAt,
  });
}

export function getMissionRoute(db: Db, id: string) {
  const row = db
    .prepare('SELECT route, route_polyline, route_encoding FROM mission_routes WHERE missionId = ?')
    .get(id) as { route?: string; route_polyline?: string; route_encoding?: string } | undefined;
  if (row?.route_polyline && row?.route_encoding === 'polyline5') {
    try {
      const coords = decodePolyline(row.route_polyline, 5);
      return coords.length ? { type: 'LineString', coordinates: coords } : null;
    } catch {
      return null;
    }
  }
  if (row?.route) {
    try {
      return JSON.parse(row.route) as MissionPlan['route'];
    } catch {
      return null;
    }
  }
  const fallback = db.prepare('SELECT route FROM missions WHERE id = ?').get(id) as
    | { route?: string }
    | undefined;
  if (fallback?.route) {
    try {
      return JSON.parse(fallback.route) as MissionPlan['route'];
    } catch {
      return null;
    }
  }
  return null;
}

export function appendTelemetry(db: Db, entries: TelemetryEntry[]) {
  if (!entries.length) return;
  const stmt = db.prepare(
    `INSERT INTO telemetry (ts, userId, username, vehicleId, payload, bytes)
     VALUES (@ts, @userId, @username, @vehicleId, @payload, @bytes)`
  );
  const tx = db.transaction((rows: TelemetryEntry[]) => {
    rows.forEach((entry) =>
      stmt.run({
        ts: entry.ts,
        userId: entry.userId ?? null,
        username: entry.username ?? null,
        vehicleId: entry.vehicleId ?? null,
        payload: JSON.stringify(entry.payload),
        bytes: entry.bytes ?? JSON.stringify(entry.payload).length,
      })
    );
  });
  tx(entries);
}

export function listTelemetry(db: Db, limit: number) {
  const rows = db
    .prepare('SELECT ts, userId, username, vehicleId, payload, bytes FROM telemetry ORDER BY ts DESC LIMIT ?')
    .all(limit);
  return rows.map((row: any) => ({
    ts: row.ts,
    userId: row.userId ?? undefined,
    username: row.username ?? undefined,
    vehicleId: row.vehicleId ?? undefined,
    payload: row.payload ? JSON.parse(row.payload) : {},
    bytes: row.bytes ?? undefined,
  })) as TelemetryEntry[];
}

export function pruneTelemetry(db: Db, maxRows: number) {
  const row = db.prepare('SELECT COUNT(1) as count FROM telemetry').get() as { count: number };
  if (row.count <= maxRows) return;
  const offset = row.count - maxRows;
  const cutoff = db
    .prepare('SELECT id FROM telemetry ORDER BY id ASC LIMIT 1 OFFSET ?')
    .get(offset) as { id: number } | undefined;
  if (!cutoff) return;
  db.prepare('DELETE FROM telemetry WHERE id < ?').run(cutoff.id);
}

export function pruneTelemetryBefore(
  db: Db,
  cutoffTs: number,
  archiveDir?: string
) {
  if (!Number.isFinite(cutoffTs)) return;
  const rows = db
    .prepare('SELECT ts, userId, username, vehicleId, payload, bytes FROM telemetry WHERE ts < ? ORDER BY ts ASC')
    .all(cutoffTs) as Array<{ ts: number; userId?: string; username?: string; vehicleId?: string; payload: string; bytes: number }>;
  if (!rows.length) return;
  if (archiveDir) {
    mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date(cutoffTs).toISOString().slice(0, 10).replace(/-/g, '');
    const file = path.join(archiveDir, `telemetry-${stamp}.jsonl`);
    rows.forEach((row) => {
      const line = JSON.stringify({
        ts: row.ts,
        userId: row.userId ?? null,
        username: row.username ?? null,
        vehicleId: row.vehicleId ?? null,
        payload: row.payload ? JSON.parse(row.payload) : {},
        bytes: row.bytes,
      });
      appendFileSync(file, line + '\n');
    });
  }
  db.prepare('DELETE FROM telemetry WHERE ts < ?').run(cutoffTs);
}

export function newId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}
