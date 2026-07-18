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

type FirestoreValue = {
  nullValue?: 'NULL_VALUE';
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type FirestoreListResponse = {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
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
  const response = await fetch(
    `${getFirestoreBaseUrl()}/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );

  if (response.status === 404) return undefined;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Firestore profile lookup failed');

  return decodeFirestoreFields(payload.fields ?? {});
}

export async function listFirestoreCollection<T extends { id: string }>(collectionPath: string): Promise<T[]> {
  const session = await requireFirebaseSession();
  const documents: T[] = [];
  let pageToken = '';

  do {
    const query = pageToken ? `?pageSize=500&pageToken=${encodeURIComponent(pageToken)}` : '?pageSize=500';
    const response = await fetch(`${getFirestoreBaseUrl()}/${collectionPath}${query}`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    const payload = (await response.json()) as FirestoreListResponse & { error?: { message?: string } };
    if (!response.ok) {
      if (response.status === 403 && collectionPath === 'whatsappMessages') return documents;
      throw new Error(payload.error?.message ?? `No se pudo cargar ${collectionPath}.`);
    }

    for (const document of payload.documents ?? []) {
      const id = decodeURIComponent(document.name.split('/').pop() ?? '');
      documents.push({ ...decodeFirestoreFields(document.fields ?? {}), id } as T);
    }

    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return documents;
}

export async function saveFirestoreDocument<T extends { id: string }>(
  collectionPath: string,
  document: T,
): Promise<void> {
  const session = await requireFirebaseSession();
  const { id, ...data } = document;
  const response = await fetch(
    `${getFirestoreBaseUrl()}/${collectionPath}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: encodeFirestoreFields(data as Record<string, unknown>) }),
    },
  );

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `No se pudo guardar ${collectionPath}/${id}.`);
}

export async function deleteFirestoreDocument(collectionPath: string, documentId: string): Promise<void> {
  const session = await requireFirebaseSession();
  const response = await fetch(
    `${getFirestoreBaseUrl()}/${collectionPath}/${encodeURIComponent(documentId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.idToken}` },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message = `No se pudo eliminar ${collectionPath}/${documentId}.`;
    if (text) {
      try {
        const payload = JSON.parse(text);
        message = payload?.error?.message ?? message;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
}

async function requireFirebaseSession() {
  const session = await getValidFirebaseSession();
  if (!session) throw new Error('La sesión de Firebase expiró. Inicia sesión nuevamente.');
  return session;
}

function getFirestoreBaseUrl() {
  if (!firebaseConfig.projectId) throw new Error('Cloud Firestore no está configurado para este entorno.');
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
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

function encodeFirestoreFields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)]),
  );
}

function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreFields(fields: Record<string, FirestoreValue>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields ?? {});
  return undefined;
}
