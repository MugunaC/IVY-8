import type { ActivityLog, User, Vehicle } from '@shared/types';
import { apiRequest } from './apiClient';

export type SearchCategory = 'users' | 'vehicles' | 'logs';

type SearchResultsByCategory = {
  users: User[];
  vehicles: Vehicle[];
  logs: ActivityLog[];
};

export async function searchRecords<TCategory extends SearchCategory>(
  category: TCategory,
  query: string,
  limit = 50
): Promise<SearchResultsByCategory[TCategory]> {
  const params = new URLSearchParams();
  params.set('category', category);
  params.set('q', query);
  params.set('limit', String(limit));
  const response = await apiRequest<{
    category: TCategory;
    results: SearchResultsByCategory[TCategory];
    total: number;
  }>(`/api/search?${params.toString()}`);
  return response.results;
}
