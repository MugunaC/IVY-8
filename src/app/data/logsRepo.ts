import type { ActivityLog, ActivityLogPage } from '@shared/types';
import { apiRequest } from './apiClient';

export async function getLogs(): Promise<ActivityLog[]> {
  return apiRequest<ActivityLog[]>('/api/logs');
}

export interface QueryLogsInput {
  page?: number;
  pageSize?: number;
  action?: ActivityLog['action'] | 'all';
  q?: string;
}

export async function queryLogs(input: QueryLogsInput = {}): Promise<ActivityLogPage> {
  const params = new URLSearchParams();
  if (input.page) params.set('page', String(input.page));
  if (input.pageSize) params.set('pageSize', String(input.pageSize));
  if (input.action && input.action !== 'all') params.set('action', input.action);
  if (input.q) params.set('q', input.q);
  return apiRequest<ActivityLogPage>(`/api/logs?${params.toString()}`);
}

export async function appendLog(entry: ActivityLog): Promise<ActivityLog[]> {
  return apiRequest<ActivityLog[]>('/api/logs', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function clearLogs() {
  return apiRequest<void>('/api/logs', {
    method: 'DELETE',
  });
}
