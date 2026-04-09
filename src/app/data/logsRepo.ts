import type { ActivityLog } from '@shared/types';
import { apiRequest } from './apiClient';

export async function getLogs(): Promise<ActivityLog[]> {
  return apiRequest<ActivityLog[]>('/api/logs');
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
