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

function normalizeRole(value?: string): UserRole | null {
  const role = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (role === 'owner' || role === 'admin' || role === 'superadmin' || role === 'super_admin') return 'super_admin';
  if (role === 'operation' || role === 'operations' || role === 'manager' || role === 'supervisor') return 'operations';
  if (role === 'office' || role === 'operator' || role === 'office_operator') return 'office_operator';
  if (role === 'finance' || role === 'accounting') return 'finance';
  if (role === 'warehouse' || role === 'inventory') return 'warehouse';
  if (role === 'sales') return 'sales';
  if (role === 'project_manager' || role === 'projects') return 'project_manager';
  if (role === 'technician' || role === 'tech') return 'technician';
  if (role === 'auditor' || role === 'readonly' || role === 'read_only') return 'auditor';
  return null;
}

export async function loadFirebasePrincipal(): Promise<AuthPrincipal> {
  const session = await requireFirebaseWebSession();
  const profile = await getFirebaseUserProfile<FirebaseUserProfile>(session.uid);
  if (!profile) throw new Error('This Firebase account has no DEMAC ERP profile and is not provisioned for access.');
  if (profile.active !== true) throw new Error('This DEMAC ERP account is inactive.');

  const role = normalizeRole(profile.role);
  if (!role) throw new Error(`ERP role is not recognized for this account: ${profile.role ?? 'missing role'}.`);

  return {
    userId: session.uid,
    displayName: profile.name ?? profile.displayName ?? session.displayName ?? session.email,
    role,
    active: true,
    capabilities: roleCapabilities[role],
  };
}
