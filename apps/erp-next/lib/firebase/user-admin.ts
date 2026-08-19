import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession } from './session';

export type ManagedUserRole = 'admin' | 'office' | 'supervisor' | 'technician' | 'accounting' | 'inventory';

export type ManagedUser = {
  id: string;
  uid: string;
  name: string;
  email: string;
  phone?: string | null;
  role: ManagedUserRole;
  staffId?: string | null;
  vanId?: string | null;
  active: boolean;
  disabled: boolean;
  emailVerified: boolean;
  authMissing?: boolean;
  profileMissing?: boolean;
  authCreatedAt?: string | null;
  lastSignInAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdByName?: string | null;
};

export type ManagedUserInput = {
  name: string;
  email: string;
  phone?: string;
  role: ManagedUserRole;
  active: boolean;
  staffId?: string;
  vanId?: string;
};

type AdminUserResponse = {
  ok: boolean;
  message?: string;
  code?: string;
  users?: ManagedUser[];
  user?: ManagedUser;
};

function functionsBaseUrl() {
  const projectId = firebaseClientConfig.projectId;
  if (!projectId) throw new Error('Firebase Functions is not configured for this deployment.');
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

async function callAdminUserFunction(action: 'list' | 'create' | 'update', payload: Record<string, unknown> = {}) {
  const session = await requireFirebaseWebSession();
  const response = await fetch(`${functionsBaseUrl()}/adminManageUser`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, payload }),
  });

  const result = await response.json().catch(() => ({})) as AdminUserResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.message || `User management failed (${response.status}).`);
  }
  return result;
}

export async function listManagedUsers() {
  const result = await callAdminUserFunction('list');
  return result.users ?? [];
}

export async function createManagedUser(input: ManagedUserInput) {
  const result = await callAdminUserFunction('create', input as unknown as Record<string, unknown>);
  if (!result.user) throw new Error('The account was created, but the server did not return the user.');
  return result.user;
}

export async function updateManagedUser(input: ManagedUserInput & { uid: string }) {
  const result = await callAdminUserFunction('update', input as unknown as Record<string, unknown>);
  if (!result.user) throw new Error('The account was updated, but the server did not return the user.');
  return result.user;
}

export async function sendPasswordSetupEmail(emailValue: string) {
  const apiKey = firebaseClientConfig.apiKey;
  const email = emailValue.trim().toLowerCase();
  if (!apiKey) throw new Error('Firebase Authentication is not configured for password setup email.');

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.error?.message ?? 'PASSWORD_EMAIL_FAILED');
    if (code.includes('TOO_MANY_ATTEMPTS')) throw new Error('Firebase temporarily blocked additional access emails because of too many attempts.');
    if (code.includes('EMAIL_NOT_FOUND')) throw new Error('The Firebase Authentication account is not available yet.');
    throw new Error(`Could not send password setup email: ${code}`);
  }
}
