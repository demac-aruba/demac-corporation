import type { UserRole } from './domain';
import { navigationGroups } from './navigation';

function roleItems(role: UserRole) {
  return navigationGroups.flatMap((group) => group.items).filter((item) => item.roles.includes(role));
}

export function defaultAuthenticatedRoute(role: UserRole) {
  return roleItems(role)[0]?.href ?? '/login';
}

export function isAuthenticatedRouteAllowed(pathname: string, role: UserRole) {
  const normalized = pathname || '/';
  return roleItems(role).some((item) => normalized === item.href || normalized.startsWith(`${item.href}/`));
}
