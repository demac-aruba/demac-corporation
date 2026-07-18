import { UserRole } from '../types';
import { getValidFirebaseSession } from './firebase';

const firebaseProjectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const firebaseApiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const functionsBaseUrl = process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL
  || (firebaseProjectId ? `https://us-central1-${firebaseProjectId}.cloudfunctions.net` : '');

export interface ManagedUser {
  id: string;
  uid: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
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
}

export interface ManagedUserInput {
  uid?: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  staffId?: string;
  vanId?: string;
  active: boolean;
}

type AdminUserResponse = {
  ok: boolean;
  message?: string;
  code?: string;
  users?: ManagedUser[];
  user?: ManagedUser;
};

async function callAdminUserFunction(action: 'list' | 'create' | 'update', payload: Record<string, unknown> = {}) {
  if (!functionsBaseUrl) throw new Error('Firebase Functions no está configurado para este entorno.');
  const session = await getValidFirebaseSession();
  if (!session) throw new Error('Tu sesión venció. Cierra sesión e inicia nuevamente.');

  const response = await fetch(`${functionsBaseUrl}/adminManageUser`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, payload }),
  });

  const result = await response.json().catch(() => ({})) as AdminUserResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.message || `No se pudo completar la operación de usuarios (${response.status}).`);
  }
  return result;
}

export async function listManagedUsers() {
  const result = await callAdminUserFunction('list');
  return result.users ?? [];
}

export async function createManagedUser(input: ManagedUserInput) {
  const result = await callAdminUserFunction('create', input as unknown as Record<string, unknown>);
  if (!result.user) throw new Error('La cuenta fue creada, pero el servidor no devolvió el usuario.');
  return result.user;
}

export async function updateManagedUser(input: ManagedUserInput & { uid: string }) {
  const result = await callAdminUserFunction('update', input as unknown as Record<string, unknown>);
  if (!result.user) throw new Error('El usuario fue actualizado, pero el servidor no devolvió el resultado.');
  return result.user;
}

export async function sendPasswordSetupEmail(emailValue: string) {
  const email = emailValue.trim().toLowerCase();
  if (!firebaseApiKey) throw new Error('Firebase Authentication no está configurado para enviar el correo.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.error?.message ?? 'PASSWORD_EMAIL_FAILED');
    if (code.includes('TOO_MANY_ATTEMPTS')) throw new Error('Firebase bloqueó temporalmente nuevos correos por demasiados intentos. Espera unos minutos.');
    if (code.includes('EMAIL_NOT_FOUND')) throw new Error('La cuenta todavía no está disponible en Firebase Authentication.');
    throw new Error(`No se pudo enviar el correo para establecer la contraseña: ${code}`);
  }
  return true;
}
