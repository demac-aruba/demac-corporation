import type { UserRole } from '../domain';
import { roleCapabilities, type AuthPrincipal } from '../security';
import { getFirebaseUserProfile } from './firestore-rest';
import { requireFirebaseWebSession } from './session';

type FirebaseUserProfile = {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  role?: string;
  active?: boolean;
};

function normalizeRole(value?: string): UserRole {
  const role = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (role === 'owner' || role === 'admin' || role === 'superadmin' || role === 'super_admin') return 'super_admin';
  if (role === 'operation' || role === 'operations' || role === 'manager') return 'operations';
  if (role === 'office' || role === 'operator' || role === 'office_operator') return 'office_operator';
  if (role === 'finance' || role === 'accounting') return 'finance';
  if (role === 'warehouse' || role === 'inventory') return 'warehouse';
  if (role === 'sales') return 'sales';
  if (role === 'project_manager' || role === 'projects') return 'project_manager';
  if (role === 'technician' || role === 'tech') return 'technician';
  if (role === 'auditor' || role === 'readonly' || role === 'read_only') return 'auditor';
  // Unknown legacy roles fail toward a read-only posture instead of broad office access.
  return 'auditor';
}

export async function loadFirebasePrincipal(): Promise<AuthPrincipal> {
  const session = await requireFirebaseWebSession();
  const profile = await getFirebaseUserProfile<FirebaseUserProfile>(session.uid);
  const role = normalizeRole(profile?.role);
  return {
    userId: session.uid,
    displayName: profile?.name ?? profile?.displayName ?? session.displayName ?? session.email,
    role,
    active: profile?.active ?? true,
    capabilities: roleCapabilities[role],
  };
}
