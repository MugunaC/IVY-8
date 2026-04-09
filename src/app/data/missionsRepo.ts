import type { MissionPlan } from '@shared/types';
import { apiRequest } from './apiClient';

export async function getMissions(
  vehicleId?: string,
  options?: { includeRoute?: boolean }
): Promise<MissionPlan[]> {
  const params = new URLSearchParams();
  if (vehicleId) params.set('vehicleId', vehicleId);
  if (options?.includeRoute) params.set('includeRoute', '1');
  const query = params.toString();
  return apiRequest<MissionPlan[]>(`/api/missions${query ? `?${query}` : ''}`);
}

export async function getMissionRoute(id: string) {
  const res = await apiRequest<{ route: MissionPlan['route'] }>(
    `/api/missions/${encodeURIComponent(id)}/route`
  );
  return res.route ?? null;
}

export async function updateMissionRoute(
  id: string,
  route: MissionPlan['route'],
  distanceMeters?: number,
  etaSeconds?: number
) {
  return apiRequest<{ ok: boolean }>(`/api/missions/${encodeURIComponent(id)}/route`, {
    method: 'PUT',
    body: JSON.stringify({ route, distanceMeters, etaSeconds }),
  });
}

export async function createMission(plan: Partial<MissionPlan>): Promise<MissionPlan[]> {
  return apiRequest<MissionPlan[]>('/api/missions', {
    method: 'POST',
    body: JSON.stringify(plan),
  });
}

export async function updateMission(id: string, updates: Partial<MissionPlan>): Promise<MissionPlan[]> {
  return apiRequest<MissionPlan[]>(`/api/missions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteMission(id: string): Promise<MissionPlan[]> {
  return apiRequest<MissionPlan[]>(`/api/missions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
