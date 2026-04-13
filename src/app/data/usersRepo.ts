import type { PaginatedResult, User } from '@shared/types';
import { apiRequest } from './apiClient';

export interface CreateUserInput {
  username: string;
  email?: string;
  role: User['role'];
  password: string;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  role?: User['role'];
  password?: string;
}

export async function getUsers(): Promise<User[]> {
  return apiRequest<User[]>('/api/users');
}

export interface QueryUsersInput {
  page?: number;
  pageSize?: number;
  q?: string;
}

export async function queryUsers(input: QueryUsersInput = {}): Promise<PaginatedResult<User>> {
  const params = new URLSearchParams();
  if (input.page) params.set('page', String(input.page));
  if (input.pageSize) params.set('pageSize', String(input.pageSize));
  if (input.q) params.set('q', input.q);
  return apiRequest<PaginatedResult<User>>(`/api/users?${params.toString()}`);
}

export async function addUser(input: CreateUserInput): Promise<User[]> {
  return apiRequest<User[]>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUser(userId: string, updates: UpdateUserInput): Promise<User[]> {
  return apiRequest<User[]>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function removeUser(userId: string): Promise<User[]> {
  return apiRequest<User[]>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
