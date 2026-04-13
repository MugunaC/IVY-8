import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { ActivityLog, RecordEntry, User, Vehicle } from '../../shared/types.js';
import type { Db, StoredUser } from '../db.js';
import {
  addLog,
  addRecord,
  clearLogs,
  deleteUser,
  deleteVehicle as dbDeleteVehicle,
  getVehicle as dbGetVehicle,
  insertUser,
  insertVehicle,
  listLogs,
  listRecords,
  listUsers,
  listVehicles,
  newId,
  queryLogs,
  queryUsers,
  queryVehicles,
  updateUser,
  updateVehicle as dbUpdateVehicle,
} from '../db.js';
import {
  BODY_LIMIT_LOGS,
  BODY_LIMIT_RECORDS,
  BODY_LIMIT_USERS,
  BODY_LIMIT_VEHICLES,
  MAX_LOGS,
  MAX_RECORDS,
  USER_UPDATE_MIN_INTERVAL_MS,
} from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { parseBody, sendJson } from '../lib/http.js';
import { withVehicleCapabilities } from '../adapters/vehicleAdapter.js';

function sanitizeUser(user: StoredUser) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

function normalizeSearchQuery(value: string | null) {
  return (value || '').trim();
}

function clampSearchLimit(value: string | null, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export interface AdminRouteContext {
  db: Db;
  userUpdateRateById: Map<string, number>;
  resetVehicleControlSequence: (vehicleId: string) => void;
}

export async function handleAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL,
  context: AdminRouteContext
) {
  const { db, userUpdateRateById, resetVehicleControlSequence } = context;

  if (pathname === '/api/search' && req.method === 'GET') {
    const category = (url.searchParams.get('category') || 'users').trim();
    const query = normalizeSearchQuery(url.searchParams.get('q'));
    const limit = clampSearchLimit(url.searchParams.get('limit'));

    if (category === 'users') {
      const result = queryUsers(db, { q: query, page: 1, pageSize: limit });
      sendJson(res, 200, {
        category,
        results: result.items.map(sanitizeUser),
        total: result.total,
      });
      return true;
    }

    if (category === 'vehicles') {
      const result = queryVehicles(db, { q: query, page: 1, pageSize: limit });
      sendJson(res, 200, {
        category,
        results: result.items,
        total: result.total,
      });
      return true;
    }

    if (category === 'logs') {
      const result = queryLogs(db, { q: query, page: 1, pageSize: limit });
      sendJson(res, 200, {
        category,
        results: result.items,
        total: result.total,
      });
      return true;
    }

    sendJson(res, 400, { error: 'Unsupported search category.' });
    return true;
  }

  if (pathname === '/api/users' && req.method === 'GET') {
    const hasPagination =
      url.searchParams.has('page') || url.searchParams.has('pageSize') || url.searchParams.has('q');
    if (hasPagination) {
      const result = queryUsers(db, {
        page: Number(url.searchParams.get('page') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 10),
        q: normalizeSearchQuery(url.searchParams.get('q')),
      });
      sendJson(res, 200, {
        ...result,
        items: result.items.map(sanitizeUser),
      });
      return true;
    }
    sendJson(res, 200, listUsers(db).map(sanitizeUser));
    return true;
  }

  if (pathname === '/api/users' && req.method === 'POST') {
    const body = await parseBody<{
      username?: string;
      email?: string;
      role?: User['role'];
      password?: string;
    }>(req, BODY_LIMIT_USERS);
    const username = (body.username || '').trim();
    const email = (body.email || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'user';
    const password = body.password || '';

    if (!username || !password) {
      sendJson(res, 400, { error: 'Username and password are required.' });
      return true;
    }
    if (password.length < 8) {
      sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      return true;
    }

    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();
    const users = listUsers(db);
    const duplicate = users.some(
      (item) =>
        item.username.toLowerCase() === normalizedUsername ||
        (email && (item.email || '').toLowerCase() === normalizedEmail)
    );
    if (duplicate) {
      sendJson(res, 409, { error: 'User already exists.' });
      return true;
    }

    const user: StoredUser = {
      id: newId('user'),
      username,
      email: email || undefined,
      role,
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };
    insertUser(db, user);
    sendJson(res, 201, listUsers(db).map(sanitizeUser));
    return true;
  }

  if (pathname.startsWith('/api/users/') && req.method === 'PUT') {
    const id = decodeURIComponent(pathname.replace('/api/users/', ''));
    const lastUpdate = userUpdateRateById.get(id) || 0;
    const nowMs = Date.now();
    if (nowMs - lastUpdate < USER_UPDATE_MIN_INTERVAL_MS) {
      sendJson(res, 429, { error: 'User updates are rate limited. Please retry shortly.' });
      return true;
    }
    const body = await parseBody<{
      username?: string;
      email?: string;
      role?: User['role'];
      password?: string;
    }>(req, BODY_LIMIT_USERS);

    const next = updateUser(db, id, {
      username: body.username,
      email: body.email,
      role: body.role === 'admin' ? 'admin' : body.role === 'user' ? 'user' : undefined,
      passwordHash: body.password ? hashPassword(body.password) : undefined,
    });
    if (!next) {
      sendJson(res, 404, { error: 'User not found.' });
      return true;
    }
    userUpdateRateById.set(id, nowMs);
    sendJson(res, 200, listUsers(db).map(sanitizeUser));
    return true;
  }

  if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.replace('/api/users/', ''));
    deleteUser(db, id);
    const vehicles = listVehicles(db).map((vehicle) => ({
      ...vehicle,
      assignedUsers: vehicle.assignedUsers.filter((userId) => userId !== id),
    }));
    vehicles.forEach((vehicle) => dbUpdateVehicle(db, vehicle.id, vehicle));
    sendJson(res, 200, listUsers(db).map(sanitizeUser));
    return true;
  }

  if (pathname === '/api/vehicles' && req.method === 'GET') {
    const hasPagination =
      url.searchParams.has('page') ||
      url.searchParams.has('pageSize') ||
      url.searchParams.has('q') ||
      url.searchParams.has('status');
    if (hasPagination) {
      sendJson(
        res,
        200,
        queryVehicles(db, {
          page: Number(url.searchParams.get('page') || 1),
          pageSize: Number(url.searchParams.get('pageSize') || 10),
          q: normalizeSearchQuery(url.searchParams.get('q')),
          status: (url.searchParams.get('status') as Vehicle['status'] | 'all' | null) || 'all',
        })
      );
      return true;
    }
    sendJson(res, 200, listVehicles(db));
    return true;
  }

  if (pathname === '/api/vehicles' && req.method === 'POST') {
    const body = await parseBody<Vehicle>(req, BODY_LIMIT_VEHICLES);
    insertVehicle(db, withVehicleCapabilities(body));
    sendJson(res, 201, listVehicles(db));
    return true;
  }

  if (pathname.startsWith('/api/vehicles/') && req.method === 'PUT') {
    const id = decodeURIComponent(pathname.replace('/api/vehicles/', ''));
    const body = await parseBody<Partial<Vehicle>>(req, BODY_LIMIT_VEHICLES);
    const {
      controlLeaseId: _ignoredLease,
      controlLeaseIssuedAt: _ignoredLeaseIssuedAt,
      ...bodySafe
    } = body as Partial<Vehicle>;
    const leaseIssuedAt = new Date().toISOString();
    const vehicle = dbGetVehicle(db, id);
    if (!vehicle) {
      sendJson(res, 404, { error: 'Vehicle not found.' });
      return true;
    }
    const next = withVehicleCapabilities({
      ...vehicle,
      ...bodySafe,
      controlLeaseId: vehicle.controlLeaseId,
      controlLeaseIssuedAt: vehicle.controlLeaseIssuedAt,
    });
    const wantsLease = next.status === 'unavailable' && (next.currentUserId || next.currentUser);
    const userChanged =
      (next.currentUserId ?? next.currentUser ?? '') !==
      (vehicle.currentUserId ?? vehicle.currentUser ?? '');
    const statusChanged = vehicle.status !== next.status;
    if (wantsLease) {
      if (!next.controlLeaseId || statusChanged || userChanged) {
        next.controlLeaseId = newId('lease');
        next.controlLeaseIssuedAt = leaseIssuedAt;
        resetVehicleControlSequence(vehicle.id);
      }
    } else {
      next.controlLeaseId = undefined;
      next.controlLeaseIssuedAt = undefined;
      resetVehicleControlSequence(vehicle.id);
    }
    dbUpdateVehicle(db, id, next);
    sendJson(res, 200, listVehicles(db));
    return true;
  }

  if (pathname.startsWith('/api/vehicles/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.replace('/api/vehicles/', ''));
    dbDeleteVehicle(db, id);
    sendJson(res, 200, listVehicles(db));
    return true;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    const hasPagination =
      url.searchParams.has('page') ||
      url.searchParams.has('pageSize') ||
      url.searchParams.has('action') ||
      url.searchParams.has('q');
    if (hasPagination) {
      sendJson(
        res,
        200,
        queryLogs(db, {
          page: Number(url.searchParams.get('page') || 1),
          pageSize: Number(url.searchParams.get('pageSize') || 10),
          action: (url.searchParams.get('action') as ActivityLog['action'] | 'all' | null) || 'all',
          q: normalizeSearchQuery(url.searchParams.get('q')),
        })
      );
      return true;
    }
    sendJson(res, 200, listLogs(db, MAX_LOGS));
    return true;
  }

  if (pathname === '/api/logs' && req.method === 'POST') {
    const body = await parseBody<ActivityLog>(req, BODY_LIMIT_LOGS);
    addLog(db, body);
    sendJson(res, 201, listLogs(db, MAX_LOGS));
    return true;
  }

  if (pathname === '/api/logs' && req.method === 'DELETE') {
    clearLogs(db);
    sendJson(res, 204, {});
    return true;
  }

  if (pathname === '/api/records' && req.method === 'GET') {
    sendJson(res, 200, listRecords(db, MAX_RECORDS));
    return true;
  }

  if (pathname === '/api/records' && req.method === 'POST') {
    const body = await parseBody<RecordEntry>(req, BODY_LIMIT_RECORDS);
    addRecord(db, body);
    sendJson(res, 201, listRecords(db, MAX_RECORDS));
    return true;
  }

  return false;
}
