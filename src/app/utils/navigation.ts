import type { UserRole } from '@shared/types';

export function getHomeRoute(role?: UserRole | null) {
  return role === 'admin' ? '/admin' : '/user';
}
