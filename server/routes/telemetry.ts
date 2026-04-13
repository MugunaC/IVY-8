import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { TelemetryEntry } from '../../shared/types.js';
import { BODY_LIMIT_INPUT } from '../config.js';
import { parseBody, sendJson, sendText } from '../lib/http.js';

export interface TelemetryRouteContext {
  filterTelemetry: (query: URLSearchParams) => TelemetryEntry[];
  enqueueTelemetry: (entry: TelemetryEntry, source: string) => { ok: boolean; dropped?: string };
}

export async function handleTelemetryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL,
  context: TelemetryRouteContext
) {
  if (pathname === '/api/input' && req.method === 'GET') {
    sendJson(res, 200, context.filterTelemetry(url.searchParams));
    return true;
  }

  if (pathname === '/api/input' && req.method === 'POST') {
    const body = await parseBody<TelemetryEntry>(req, BODY_LIMIT_INPUT);
    const source = req.socket.remoteAddress || 'unknown';
    const result = context.enqueueTelemetry(
      {
        ...body,
        id: body.id ?? Date.now(),
        bytes: body.bytes ?? JSON.stringify(body.payload).length,
      },
      source
    );
    if (!result.ok) {
      sendJson(res, 429, { ok: false, dropped: result.dropped });
      return true;
    }
    sendJson(res, 201, { ok: true });
    return true;
  }

  if (pathname === '/api/input/stats' && req.method === 'GET') {
    const entries = context.filterTelemetry(url.searchParams);
    const bytes = entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
    sendJson(res, 200, { bytes, count: entries.length });
    return true;
  }

  if (pathname === '/api/input/export' && req.method === 'GET') {
    const entries = context.filterTelemetry(url.searchParams);
    const header = 'ts,iso,userId,vehicleId,leaseId,buttons,axes';
    const lines = entries.map((entry) =>
      [
        entry.ts,
        new Date(entry.ts).toISOString(),
        entry.userId || '',
        entry.vehicleId || '',
        entry.payload.leaseId || '',
        `"${entry.payload.buttons.join('|')}"`,
        `"${entry.payload.axes.join('|')}"`,
      ].join(',')
    );
    sendText(res, 200, [header, ...lines].join('\n'));
    return true;
  }

  return false;
}
