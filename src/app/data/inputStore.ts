import type { RecordEntry, TelemetryEntry, TelemetryPayload } from '@shared/types';
import { apiRequest } from './apiClient';

export interface TelemetryFilter {
  limit?: number;
  userId?: string;
  vehicleId?: string;
  leaseId?: string;
  startTs?: number;
  endTs?: number;
}

function toQuery(params: TelemetryFilter = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.userId) query.set('userId', params.userId);
  if (params.vehicleId) query.set('vehicleId', params.vehicleId);
  if (params.leaseId) query.set('leaseId', params.leaseId);
  if (typeof params.startTs === 'number') query.set('startTs', String(params.startTs));
  if (typeof params.endTs === 'number') query.set('endTs', String(params.endTs));
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function enqueueTelemetry(
  payload: TelemetryPayload,
  context: { userId?: string; vehicleId?: string }
) {
  const entry: TelemetryEntry = {
    ts: Date.now(),
    userId: context.userId,
    vehicleId: context.vehicleId,
    payload,
    bytes: JSON.stringify(payload).length,
  };

  return apiRequest<{ ok: boolean }>('/api/input', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function enqueueRecord(entry: RecordEntry) {
  return apiRequest<RecordEntry[]>('/api/records', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function getTelemetryStats(filters: TelemetryFilter = {}) {
  return apiRequest<{ bytes: number; count: number }>(`/api/input/stats${toQuery(filters)}`);
}

export async function getRecentTelemetry(filters: TelemetryFilter = {}): Promise<TelemetryEntry[]> {
  return apiRequest<TelemetryEntry[]>(`/api/input${toQuery(filters)}`);
}

function toCsvValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function exportTelemetryCsv(filters: TelemetryFilter = {}) {
  const entries = await getRecentTelemetry({ ...filters, limit: filters.limit || 1000 });
  if (entries.length === 0) {
    return '';
  }
  const maxButtons = Math.max(18, ...entries.map((entry) => entry.payload.buttons.length));
  const maxAxes = Math.max(4, ...entries.map((entry) => entry.payload.axes.length));
  const header = [
    'ts',
    'iso',
    'userId',
    'vehicleId',
    'leaseId',
    ...Array.from({ length: maxButtons }, (_, i) => `button_${i}`),
    ...Array.from({ length: maxAxes }, (_, i) => `axis_${i}`),
  ];
  const lines = [header.join(',')];

  entries.forEach((entry) => {
    const row = [
      entry.ts,
      new Date(entry.ts).toISOString(),
      entry.userId || '',
      entry.vehicleId || '',
      entry.payload.leaseId || '',
      ...Array.from({ length: maxButtons }, (_, i) => entry.payload.buttons[i] ?? ''),
      ...Array.from({ length: maxAxes }, (_, i) => entry.payload.axes[i] ?? ''),
    ];
    lines.push(row.map(toCsvValue).join(','));
  });

  return lines.join('\n');
}
