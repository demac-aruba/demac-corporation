import { firebaseTransportUrl } from './isolated-preview';
import { fetchFirebaseResponse, firebaseResponseError, readFirebaseJson } from './request-error';
import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { requireFirebaseWebSession } from './session';

export type FirestoreValue = {
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
  createTime?: string;
  updateTime?: string;
};

type FirestoreListResponse = {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
  error?: { message?: string };
};

type FirestoreRunQueryRow = {
  document?: FirestoreDocument;
};

function baseUrl() {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.projectId) {
    throw new Error('Cloud Firestore is not configured for ERP Next in this environment.');
  }
  return `https://firestore.googleapis.com/v1/projects/${firebaseClientConfig.projectId}/databases/(default)/documents`;
}

function documentId(name: string) {
  return decodeURIComponent(name.split('/').pop() ?? '');
}

function decodeDocument<T extends { id: string }>(document: FirestoreDocument) {
  return { ...decodeFirestoreFields(document.fields ?? {}), id: documentId(document.name) } as T;
}

function isDateTimeField(key: string, value: unknown) {
  if (typeof value !== 'string') return false;
  if (!/(At|Until)$/.test(key)) return false;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

export function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.filter((item) => item !== undefined).map(encodeFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value as Record<string, unknown>) } };
  return { stringValue: String(value) };
}

export function encodeFirestoreFields(input: Record<string, unknown>) {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    fields[key] = isDateTimeField(key, value)
      ? { timestampValue: String(value) }
      : encodeFirestoreValue(value);
  }
  return fields;
}

export function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields ?? {});
  return undefined;
}

export function decodeFirestoreFields(fields: Record<string, FirestoreValue>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) result[key] = decodeFirestoreValue(value);
  return result;
}

async function authenticatedFetch(url: string, init?: RequestInit) {
  const session = await requireFirebaseWebSession();
  const response = await fetchFirebaseResponse(firebaseTransportUrl(url), {
    ...init,
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return response;
}

async function readError(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    return JSON.parse(text)?.error?.message ?? fallback;
  } catch {
    return text;
  }
}

export async function getFirestoreDocument<T extends { id: string }>(collectionPath: string, id: string): Promise<T | null> {
  const response = await authenticatedFetch(`${baseUrl()}/${collectionPath}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await firebaseResponseError(response, 'Unable to load the requested document.');
  const document = await readFirebaseJson<FirestoreDocument>(response);
  return { ...decodeFirestoreFields(document.fields ?? {}), id } as T;
}

/** Application batch bound; Firestore Rules still enforce their own access-call limits. */
export const FIRESTORE_BATCH_GET_LIMIT = 20;

/** Exact document reads with the current user's token and normal Firestore Rules. */
export async function batchGetFirestoreDocuments<T extends { id: string }>(
  collectionPath: string, ids: string[], options: { fieldPaths?: string[]; signal?: AbortSignal } = {},
): Promise<Record<string, T | null>> {
  const result: Record<string, T | null> = Object.create(null);
  const unique = [...new Set(ids)];
  if (!unique.length) return result;
  const segments = collectionPath.split('/');
  if (unique.length > FIRESTORE_BATCH_GET_LIMIT || segments.length % 2 !== 1
    || [...segments, ...unique].some((part) => !part || part === '.' || part === '..' || part.includes('/'))) {
    throw new Error('Invalid bounded document read.');
  }
  options.signal?.throwIfAborted();
  const url = baseUrl();
  // Resource names in the JSON body are literal names, not URL-encoded paths.
  const prefix = `${url.slice('https://firestore.googleapis.com/v1/'.length)}/${collectionPath}/`;
  const requested = new Map(unique.map((id) => [`${prefix}${id}`, id]));
  const response = await authenticatedFetch(`${url}:batchGet`, {
    method: 'POST', signal: options.signal,
    body: JSON.stringify({ documents: [...requested.keys()],
      ...(options.fieldPaths?.length ? { mask: { fieldPaths: options.fieldPaths } } : {}) }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Unable to load document batch.'));
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Invalid document batch response.');
  for (const row of rows) {
    if (!row || typeof row !== 'object' || (!!row.found === !!row.missing)) throw new Error('Invalid document batch result.');
    const name = row.found?.name ?? row.missing;
    const id = requested.get(name);
    if (id === undefined || Object.hasOwn(result, id)) throw new Error('Unexpected document batch identity.');
    result[id] = row.found ? { ...decodeFirestoreFields(row.found.fields ?? {}), id } as T : null;
  }
  // An omitted response is unknown, never a confirmed missing document.
  return result;
}

export async function listFirestoreCollection<T extends { id: string }>(collectionPath: string, pageSize = 250): Promise<T[]> {
  const result: T[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await authenticatedFetch(`${baseUrl()}/${collectionPath}?${query.toString()}`);
    if (!response.ok) throw new Error(await readError(response, `Unable to list ${collectionPath}.`));
    const payload = await response.json() as FirestoreListResponse;
    for (const document of payload.documents ?? []) result.push(decodeDocument<T>(document));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return result;
}

export async function queryFirestoreCollectionDateRange<T extends { id: string }>(args: {
  collectionId: string;
  fieldPath: string;
  startInclusive: string;
  endInclusive: string;
  limit?: number;
}): Promise<T[]> {
  const limit = Math.max(1, Math.min(5000, Math.round(args.limit ?? 1000)));
  const response = await authenticatedFetch(`${baseUrl()}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: args.collectionId }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: args.fieldPath },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { stringValue: args.startInclusive },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: args.fieldPath },
                  op: 'LESS_THAN_OR_EQUAL',
                  value: { stringValue: args.endInclusive },
                },
              },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: args.fieldPath }, direction: 'ASCENDING' }],
        limit,
      },
    }),
  });
  if (!response.ok) throw new Error(await readError(response, `Unable to query ${args.collectionId} by ${args.fieldPath}.`));
  const rows = await response.json() as FirestoreRunQueryRow[];
  return rows.flatMap((row) => row.document ? [decodeDocument<T>(row.document)] : []);
}

export async function saveFirestoreDocument<T extends { id: string }>(collectionPath: string, document: T): Promise<T> {
  const { id, ...data } = document;
  const response = await authenticatedFetch(`${baseUrl()}/${collectionPath}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFirestoreFields(data as Record<string, unknown>) }),
  });
  if (!response.ok) throw new Error(await readError(response, `Unable to save ${collectionPath}/${id}.`));
  const payload = await response.json() as FirestoreDocument;
  return { ...decodeFirestoreFields(payload.fields ?? {}), id } as T;
}

export async function updateFirestoreDocument<T extends { id: string }>(collectionPath: string, id: string, changes: Record<string, unknown>): Promise<T> {
  const encoded = encodeFirestoreFields(changes);
  const paths = Object.keys(encoded);
  if (!paths.length) {
    const current = await getFirestoreDocument<T>(collectionPath, id);
    if (!current) throw new Error(`${collectionPath}/${id} does not exist.`);
    return current;
  }
  const query = new URLSearchParams();
  for (const path of paths) query.append('updateMask.fieldPaths', path);
  const response = await authenticatedFetch(`${baseUrl()}/${collectionPath}/${encodeURIComponent(id)}?${query.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encoded }),
  });
  if (!response.ok) throw new Error(await readError(response, `Unable to update ${collectionPath}/${id}.`));
  const payload = await response.json() as FirestoreDocument;
  return { ...decodeFirestoreFields(payload.fields ?? {}), id } as T;
}

export async function getFirebaseUserProfile<T extends { id: string }>(uid: string): Promise<T | null> {
  return getFirestoreDocument<T>('users', uid);
}
