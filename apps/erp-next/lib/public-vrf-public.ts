import { firebaseClientConfig, isFirebaseClientConfigured } from './firebase/client-config';
import { defaultPublicVrfContent, normalizePublicVrfContent, PUBLIC_VRF_CONFIG_PATH, VRF_PUBLISHED_ID, type PublicVrfContent } from './public-vrf-content';

/** A missing/unreachable public snapshot is not a new version. Callers retain
 * the last rendered content instead of replacing it with defaults on outages. */
export async function readPublishedVrfContent(): Promise<PublicVrfContent | null> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) return null;
  const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(PUBLIC_VRF_CONFIG_PATH)}?alt=media&v=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Published website content is temporarily unavailable.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid published website snapshot.');
  return normalizePublicVrfContent(value, VRF_PUBLISHED_ID);
}

export async function loadPublishedVrfContent(): Promise<PublicVrfContent> {
  try { return await readPublishedVrfContent() ?? defaultPublicVrfContent; }
  catch { return defaultPublicVrfContent; }
}
