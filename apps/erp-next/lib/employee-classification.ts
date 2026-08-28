import type { CanonicalStaffProfile } from './canonical-operations';

const TECHNICAL_ROLES = new Set(['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor']);

export function isTechnicalEmployee(profile: CanonicalStaffProfile) {
  return profile.employeeType === 'Técnico' || TECHNICAL_ROLES.has(profile.role ?? '');
}
