import type { UserRole } from './domain';
import { defaultAuthenticatedRoute } from './role-routing';
export function quickBooksLoginDestination(search: string, role: UserRole) {
  const next = new URLSearchParams(search).get('next');
  if (role === 'super_admin' && ['/quickbooks/connect/', '/quickbooks/disconnect/', '/quickbooks/compare/', '/integrations/'].includes(next || '')) return next!;
  return defaultAuthenticatedRoute(role);
}
