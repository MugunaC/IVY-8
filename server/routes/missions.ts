import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { MissionPlan } from '../../shared/types.js';
import type { Db } from '../db.js';
import {
  deleteMission as dbDeleteMission,
  getMissionRoute,
  listMissions,
  setMissionRoute,
  upsertMission,
} from '../db.js';
import { BODY_LIMIT_MISSIONS } from '../config.js';
import { parseBody, sendJson } from '../lib/http.js';

function sanitizeWaypoints(raw: MissionPlan['waypoints']): MissionPlan['waypoints'] {
  if (!Array.isArray(raw)) return [];
  const next: MissionPlan['waypoints'] = [];
  for (const point of raw) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    next.push({
      lat,
      lng,
      label: typeof point?.label === 'string' ? point.label.slice(0, 64) : undefined,
    });
  }
  return next;
}

function sanitizeRoute(
  route: MissionPlan['route'] | null | undefined
): MissionPlan['route'] | undefined {
  if (!route || route.type !== 'LineString' || !Array.isArray(route.coordinates)) return undefined;
  const coords: [number, number][] = [];
  for (const entry of route.coordinates) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const lng = Number(entry[0]);
    const lat = Number(entry[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    coords.push([lng, lat]);
  }
  if (coords.length < 2) return undefined;
  return { type: 'LineString', coordinates: coords };
}

export async function handleMissionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL,
  db: Db
) {
  if (pathname === '/api/missions' && req.method === 'GET') {
    const vehicleId = url.searchParams.get('vehicleId') || '';
    const includeRoute =
      url.searchParams.get('includeRoute') === '1' ||
      url.searchParams.get('includeRoute') === 'true';
    sendJson(res, 200, listMissions(db, vehicleId || undefined, { includeRoute }));
    return true;
  }

  if (pathname === '/api/missions' && req.method === 'POST') {
    const body = await parseBody<Partial<MissionPlan>>(req, BODY_LIMIT_MISSIONS);
    const vehicleId = (body.vehicleId || '').trim();
    if (!vehicleId) {
      sendJson(res, 400, { error: 'vehicleId is required.' });
      return true;
    }
    const name = (body.name || `Mission ${new Date().toLocaleString()}`).trim().slice(0, 80);
    const pathType = body.pathType === 'roads' ? 'roads' : 'straight';
    const speedMps =
      typeof body.speedMps === 'number' && Number.isFinite(body.speedMps) && body.speedMps > 0
        ? body.speedMps
        : 1;
    const waypoints = sanitizeWaypoints(body.waypoints || []);
    const route = sanitizeRoute(body.route);
    const distanceMeters =
      typeof body.distanceMeters === 'number' && Number.isFinite(body.distanceMeters)
        ? body.distanceMeters
        : undefined;
    const etaSeconds =
      typeof body.etaSeconds === 'number' && Number.isFinite(body.etaSeconds)
        ? body.etaSeconds
        : undefined;
    const profile =
      body.profile === 'drone' ? 'drone' : body.profile === 'rover' ? 'rover' : undefined;
    const arrivalRadiusM =
      typeof body.arrivalRadiusM === 'number' && Number.isFinite(body.arrivalRadiusM)
        ? body.arrivalRadiusM
        : undefined;
    const loiterSeconds =
      typeof body.loiterSeconds === 'number' && Number.isFinite(body.loiterSeconds)
        ? body.loiterSeconds
        : undefined;
    const cruiseAltitudeM =
      typeof body.cruiseAltitudeM === 'number' && Number.isFinite(body.cruiseAltitudeM)
        ? body.cruiseAltitudeM
        : undefined;
    const now = new Date().toISOString();
    const plan: MissionPlan = {
      id: body.id || randomUUID(),
      vehicleId,
      name: name || `Mission ${now}`,
      pathType,
      speedMps,
      profile,
      arrivalRadiusM,
      loiterSeconds,
      cruiseAltitudeM,
      waypoints,
      route,
      distanceMeters,
      etaSeconds,
      createdAt: body.createdAt || now,
      updatedAt: now,
    };
    upsertMission(db, plan);
    sendJson(res, 201, listMissions(db, vehicleId));
    return true;
  }

  if (pathname.startsWith('/api/missions/') && pathname.endsWith('/route') && req.method === 'GET') {
    const id = decodeURIComponent(pathname.replace('/api/missions/', '').replace('/route', ''));
    const route = getMissionRoute(db, id);
    if (!route) {
      sendJson(res, 404, { error: 'Route not found.' });
      return true;
    }
    sendJson(res, 200, { route });
    return true;
  }

  if (pathname.startsWith('/api/missions/') && pathname.endsWith('/route') && req.method === 'PUT') {
    const id = decodeURIComponent(pathname.replace('/api/missions/', '').replace('/route', ''));
    const body = await parseBody<{
      route?: MissionPlan['route'];
      distanceMeters?: number;
      etaSeconds?: number;
    }>(req, BODY_LIMIT_MISSIONS);
    const existing = listMissions(db, undefined, { includeRoute: true }).find((entry) => entry.id === id);
    if (!existing) {
      sendJson(res, 404, { error: 'Mission not found.' });
      return true;
    }
    const route = sanitizeRoute(body.route ?? existing.route);
    if (!route) {
      sendJson(res, 400, { error: 'Route is required.' });
      return true;
    }
    const next: MissionPlan = {
      ...existing,
      route,
      distanceMeters:
        typeof body.distanceMeters === 'number' && Number.isFinite(body.distanceMeters)
          ? body.distanceMeters
          : existing.distanceMeters,
      etaSeconds:
        typeof body.etaSeconds === 'number' && Number.isFinite(body.etaSeconds)
          ? body.etaSeconds
          : existing.etaSeconds,
      updatedAt: new Date().toISOString(),
    };
    upsertMission(db, next);
    setMissionRoute(db, next.id, next.vehicleId, route, next.updatedAt);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname.startsWith('/api/missions/') && req.method === 'PUT') {
    const id = decodeURIComponent(pathname.replace('/api/missions/', ''));
    const body = await parseBody<Partial<MissionPlan>>(req, BODY_LIMIT_MISSIONS);
    const existing = listMissions(db, undefined, { includeRoute: true }).find((entry) => entry.id === id);
    if (!existing) {
      sendJson(res, 404, { error: 'Mission not found.' });
      return true;
    }
    const waypoints = sanitizeWaypoints(body.waypoints ?? existing.waypoints);
    const route = sanitizeRoute(body.route ?? existing.route);
    const next: MissionPlan = {
      ...existing,
      name: typeof body.name === 'string' ? body.name.trim().slice(0, 80) : existing.name,
      pathType:
        body.pathType === 'roads'
          ? 'roads'
          : body.pathType === 'straight'
            ? 'straight'
            : existing.pathType,
      speedMps:
        typeof body.speedMps === 'number' && Number.isFinite(body.speedMps) && body.speedMps > 0
          ? body.speedMps
          : existing.speedMps,
      profile:
        body.profile === 'drone'
          ? 'drone'
          : body.profile === 'rover'
            ? 'rover'
            : existing.profile,
      arrivalRadiusM:
        typeof body.arrivalRadiusM === 'number' && Number.isFinite(body.arrivalRadiusM)
          ? body.arrivalRadiusM
          : existing.arrivalRadiusM,
      loiterSeconds:
        typeof body.loiterSeconds === 'number' && Number.isFinite(body.loiterSeconds)
          ? body.loiterSeconds
          : existing.loiterSeconds,
      cruiseAltitudeM:
        typeof body.cruiseAltitudeM === 'number' && Number.isFinite(body.cruiseAltitudeM)
          ? body.cruiseAltitudeM
          : existing.cruiseAltitudeM,
      waypoints,
      route,
      distanceMeters:
        typeof body.distanceMeters === 'number' && Number.isFinite(body.distanceMeters)
          ? body.distanceMeters
          : existing.distanceMeters,
      etaSeconds:
        typeof body.etaSeconds === 'number' && Number.isFinite(body.etaSeconds)
          ? body.etaSeconds
          : existing.etaSeconds,
      updatedAt: new Date().toISOString(),
    };
    upsertMission(db, next);
    sendJson(res, 200, listMissions(db, next.vehicleId));
    return true;
  }

  if (pathname.startsWith('/api/missions/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.replace('/api/missions/', ''));
    const existing = listMissions(db).find((entry) => entry.id === id);
    if (!existing) {
      sendJson(res, 404, { error: 'Mission not found.' });
      return true;
    }
    dbDeleteMission(db, id);
    sendJson(res, 200, listMissions(db, existing.vehicleId));
    return true;
  }

  return false;
}
