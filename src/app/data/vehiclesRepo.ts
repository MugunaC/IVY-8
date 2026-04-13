import type { PaginatedResult, Vehicle } from '@shared/types';
import { apiRequest } from './apiClient';

export async function getVehicles(): Promise<Vehicle[]> {
  return apiRequest<Vehicle[]>('/api/vehicles');
}

export interface QueryVehiclesInput {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: Vehicle['status'] | 'all';
}

export async function queryVehicles(input: QueryVehiclesInput = {}): Promise<PaginatedResult<Vehicle>> {
  const params = new URLSearchParams();
  if (input.page) params.set('page', String(input.page));
  if (input.pageSize) params.set('pageSize', String(input.pageSize));
  if (input.q) params.set('q', input.q);
  if (input.status && input.status !== 'all') params.set('status', input.status);
  return apiRequest<PaginatedResult<Vehicle>>(`/api/vehicles?${params.toString()}`);
}

export async function addVehicle(vehicle: Vehicle): Promise<Vehicle[]> {
  return apiRequest<Vehicle[]>('/api/vehicles', {
    method: 'POST',
    body: JSON.stringify(vehicle),
  });
}

export async function updateVehicle(vehicleId: string, updates: Partial<Vehicle>): Promise<Vehicle[]> {
  return apiRequest<Vehicle[]>(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function removeVehicle(vehicleId: string): Promise<Vehicle[]> {
  return apiRequest<Vehicle[]>(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: 'DELETE',
  });
}

export async function assignUsers(vehicleId: string, userIds: string[]) {
  return updateVehicle(vehicleId, { assignedUsers: userIds });
}

export async function markVehicleInUse(vehicleId: string, username?: string, userId?: string) {
  return updateVehicle(vehicleId, {
    status: 'unavailable',
    currentUser: username,
    currentUserId: userId,
  });
}

export async function releaseVehicle(vehicleId: string) {
  return updateVehicle(vehicleId, {
    status: 'available',
    currentUser: undefined,
    currentUserId: undefined,
  });
}
