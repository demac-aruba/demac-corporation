import { firebaseTransportUrl } from './isolated-preview';
import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { fetchFirebaseResponse, firebaseResponseError, isTransientFirebaseError, readFirebaseJson } from './request-error';

const SESSION_KEY = 'demac.erp-next.firebase.session.v1';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
let generation = 0;
let refreshFlight: { generation: number; identity: string; promise: Promise<FirebaseWebSession> } | null = null;

export type FirebaseWebSession = {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  displayName?: string;
};

type IdentityToolkitSignInResponse = {
  localId: string; email: string; idToken: string; refreshToken: string;
  expiresIn: string; displayName?: string;
};
type SecureTokenResponse = {
  user_id: string; id_token: string; refresh_token: string; expires_in: string;
};

export class FirebaseSessionSupersededError extends Error {
  constructor() { super('The sign-in session changed.'); this.name = 'FirebaseSessionSupersededError'; }
}

function storage() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function expiration(expiresIn: string) {
  const seconds = Number(expiresIn);
  const expiresAt = Date.now() + seconds * 1000;
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(expiresAt)) throw new Error('Invalid authentication response.');
  return expiresAt;
}

function isSession(value: unknown): value is FirebaseWebSession {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<FirebaseWebSession>;
  return ['uid', 'email', 'idToken', 'refreshToken'].every((key) => {
    const v = s[key as keyof FirebaseWebSession]; return typeof v === 'string' && v.trim().length > 0;
  }) && typeof s.expiresAt === 'number' && Number.isFinite(s.expiresAt)
    && (s.displayName === undefined || typeof s.displayName === 'string');
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetchFirebaseResponse(firebaseTransportUrl(url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw await firebaseResponseError(response, 'Firebase authentication request failed.');
  return readFirebaseJson<T>(response);
}

export function persistFirebaseWebSession(session: FirebaseWebSession) {
  if (!isSession(session)) throw new Error('Invalid authentication response.');
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  generation += 1;
}

export function loadFirebaseWebSession(): FirebaseWebSession | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isSession(value)) return value;
  } catch { /* Invalid stored data is not an authenticated session. */ }
  clearFirebaseWebSession();
  return null;
}

export function clearFirebaseWebSession() {
  generation += 1;
  refreshFlight = null;
  storage()?.removeItem(SESSION_KEY);
}

export async function signInWithFirebaseEmail(email: string, password: string) {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.apiKey) {
    throw new Error('Firebase is not configured for ERP Next in this environment.');
  }
  // Explicit sign-in replaces the old session; late responses cannot restore it.
  clearFirebaseWebSession();
  const started = generation;
  const payload = await postJson<IdentityToolkitSignInResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseClientConfig.apiKey}`,
    { email, password, returnSecureToken: true },
  );
  if (generation !== started) throw new FirebaseSessionSupersededError();
  const session: FirebaseWebSession = {
    uid: payload.localId, email: payload.email, idToken: payload.idToken,
    refreshToken: payload.refreshToken, expiresAt: expiration(payload.expiresIn), displayName: payload.displayName,
  };
  persistFirebaseWebSession(session);
  return session;
}

export function refreshFirebaseWebSession(session: FirebaseWebSession): Promise<FirebaseWebSession> {
  const identity = JSON.stringify(session);
  const started = generation;
  const stillCurrent = () => generation === started && JSON.stringify(loadFirebaseWebSession()) === identity;
  if (!stillCurrent()) return Promise.reject(new FirebaseSessionSupersededError());
  if (refreshFlight?.generation === started && refreshFlight.identity === identity) return refreshFlight.promise;
  const promise = (async () => {
    try {
      if (!isFirebaseClientConfigured || !firebaseClientConfig.apiKey) throw new Error('Firebase is not configured for ERP Next in this environment.');
      const payload = await postJson<SecureTokenResponse>(
        `https://securetoken.googleapis.com/v1/token?key=${firebaseClientConfig.apiKey}`,
        { grant_type: 'refresh_token', refresh_token: session.refreshToken },
      );
      if (!stillCurrent()) throw new FirebaseSessionSupersededError();
      if (payload.user_id !== session.uid) throw new Error('Authentication response identity mismatch.');
      const refreshed: FirebaseWebSession = {
        ...session, uid: payload.user_id, idToken: payload.id_token,
        refreshToken: payload.refresh_token, expiresAt: expiration(payload.expires_in),
      };
      persistFirebaseWebSession(refreshed);
      return refreshed;
    } catch (error) {
      if (!stillCurrent()) throw new FirebaseSessionSupersededError();
      // A timeout/5xx is not revocation. Keep the refresh credential for a later
      // explicit retry, but never return an expired token as a successful refresh.
      if (!isTransientFirebaseError(error)) clearFirebaseWebSession();
      throw error;
    }
  })();
  refreshFlight = { generation: started, identity, promise };
  const clearFlight = () => { if (refreshFlight?.promise === promise) refreshFlight = null; };
  void promise.then(clearFlight, clearFlight);
  return promise;
}

export async function getValidFirebaseWebSession() {
  const session = loadFirebaseWebSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
  return refreshFirebaseWebSession(session);
}

export async function requireFirebaseWebSession() {
  const session = await getValidFirebaseWebSession();
  if (!session) throw new Error('Firebase authentication is required for this operation.');
  return session;
}
