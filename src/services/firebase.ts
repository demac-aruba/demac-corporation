import AsyncStorage from '@react-native-async-storage/async-storage';

const FIREBASE_SESSION_KEY = '@demac-corporation-firebase-session-v1';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

export type FirebaseSession = {
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

export async function signInWithFirebaseEmail(email: string, password: string) {
  if (!firebaseConfig.apiKey) throw new Error('Firebase no está configurado para este entorno.');

  const payload = await postFirebaseRequest<IdentityToolkitSignInResponse>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
    { email, password, returnSecureToken: true },
  );

  const session: FirebaseSession = {
    uid: payload.localId,
    email: payload.email,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expiresAt: getExpirationTime(payload.expiresIn),
    displayName: payload.displayName,
  };
  await persistFirebaseSession(session);
  return session;
}

export async function loadFirebaseSession() {
  const stored = await AsyncStorage.getItem(FIREBASE_SESSION_KEY);
  return stored ? (JSON.parse(stored) as FirebaseSession) : null;
}

export async function getValidFirebaseSession() {
  const session = await loadFirebaseSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return session;
  return refreshFirebaseSession(session);
}

export async function refreshFirebaseSession(session: FirebaseSession) {
  if (!firebaseConfig.apiKey) throw new Error('Firebase no está configurado para este entorno.');

  const payload = await postFirebaseRequest<SecureTokenResponse>(
    `https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`,
    { grant_type: 'refresh_token', refresh_token: session.refreshToken },
  );

  const refreshedSession: FirebaseSession = {
    ...session,
    uid: payload.user_id,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expiresAt: getExpirationTime(payload.expires_in),
  };
  await persistFirebaseSession(refreshedSession);
  return refreshedSession;
}

export async function persistFirebaseSession(session: FirebaseSession) {
  await AsyncStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(session));
}

export async function clearFirebaseSession() {
  await AsyncStorage.removeItem(FIREBASE_SESSION_KEY);
}

export async function getFirebaseUserProfile(uid: string, idToken: string) {
  if (!firebaseConfig.projectId) throw new Error('Cloud Firestore no está configurado para este entorno.');

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );

  if (response.status === 404) return undefined;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Firestore profile lookup failed');

  return decodeFirestoreFields(payload.fields ?? {});
}

async function postFirebaseRequest<TResponse>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Firebase request failed');
  return payload as TResponse;
}

function getExpirationTime(expiresInSeconds: string) {
  return Date.now() + Number(expiresInSeconds) * 1000;
}

function decodeFirestoreFields(fields: Record<string, { stringValue?: string; booleanValue?: boolean }>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value.stringValue ?? value.booleanValue]),
  );
}
