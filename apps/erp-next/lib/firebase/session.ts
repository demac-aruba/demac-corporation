import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';

const SESSION_KEY = 'demac.erp-next.firebase.session.v1';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type FirebaseWebSession = {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  displayName?: string;
};

type IdentityToolkitSignInResponse = {
  localId: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  displayName?: string;
};

type SecureTokenResponse = {
  user_id: string;
  id_token: string;
  refresh_token: string;
  expires_in: string;
};

function storage() {
  if (typeof window === 'undefined') return null;
  // Session storage survives refreshes but is cleared when the browser session ends.
  // This is intentionally more conservative than permanent localStorage auth tokens.
  return window.sessionStorage;
}

function expiration(expiresIn: string) {
  return Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Firebase authentication request failed.');
  return payload as T;
}

export function persistFirebaseWebSession(session: FirebaseWebSession) {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadFirebaseWebSession(): FirebaseWebSession | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FirebaseWebSession;
  } catch {
    storage()?.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearFirebaseWebSession() {
  storage()?.removeItem(SESSION_KEY);
}

export async function signInWithFirebaseEmail(email: string, password: string) {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.apiKey) {
    throw new Error('Firebase is not configured for ERP Next in this environment.');
  }
  const payload = await postJson<IdentityToolkitSignInResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseClientConfig.apiKey}`,
    { email, password, returnSecureToken: true },
  );
  const session: FirebaseWebSession = {
    uid: payload.localId,
    email: payload.email,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expiresAt: expiration(payload.expiresIn),
    displayName: payload.displayName,
  };
  persistFirebaseWebSession(session);
  return session;
}

export async function refreshFirebaseWebSession(session: FirebaseWebSession) {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.apiKey) {
    throw new Error('Firebase is not configured for ERP Next in this environment.');
  }
  const payload = await postJson<SecureTokenResponse>(
    `https://securetoken.googleapis.com/v1/token?key=${firebaseClientConfig.apiKey}`,
    { grant_type: 'refresh_token', refresh_token: session.refreshToken },
  );
  const refreshed: FirebaseWebSession = {
    ...session,
    uid: payload.user_id,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expiresAt: expiration(payload.expires_in),
  };
  persistFirebaseWebSession(refreshed);
  return refreshed;
}

export async function getValidFirebaseWebSession() {
  const session = loadFirebaseWebSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
  try {
    return await refreshFirebaseWebSession(session);
  } catch (error) {
    clearFirebaseWebSession();
    throw error;
  }
}

export async function requireFirebaseWebSession() {
  const session = await getValidFirebaseWebSession();
  if (!session) throw new Error('Firebase authentication is required for this operation.');
  return session;
}
