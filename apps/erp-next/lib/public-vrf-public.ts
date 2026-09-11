import { firebaseClientConfig, isFirebaseClientConfigured } from './firebase/client-config';
import {
  defaultPublicVrfContent,
  normalizePublicVrfContent,
  PUBLIC_VRF_CONFIG_PATH,
  VRF_PUBLISHED_ID,
  type PublicVrfContent,
} from './public-vrf-content';

export async function loadPublishedVrfContent(): Promise<PublicVrfContent> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) return defaultPublicVrfContent;
  try {
    const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(PUBLIC_VRF_CONFIG_PATH)}?alt=media&v=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return defaultPublicVrfContent;
    return normalizePublicVrfContent(await response.json(), VRF_PUBLISHED_ID);
  } catch {
    return defaultPublicVrfContent;
  }
}
