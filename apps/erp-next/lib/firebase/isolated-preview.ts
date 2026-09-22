import { firebaseClientConfig } from './client-config';

/** Only the explicit synthetic build may use the loopback-backed preview gateway. */
export function firebaseTransportUrl(url: string) {
  if (process.env.NEXT_PUBLIC_ISOLATED_PREVIEW !== 'true') return url;
  if (firebaseClientConfig.projectId !== 'demo-demac-dwellings') throw new Error('Isolated preview project mismatch.');
  const parsed = new URL(url);
  const allowed = new Set(['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'firebasestorage.googleapis.com', 'us-central1-demo-demac-dwellings.cloudfunctions.net']);
  if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) throw new Error('Non-preview Firebase destination rejected.');
  return `/__preview/firebase/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}
