import { firebaseClientConfig, isFirebaseClientConfigured } from './firebase/client-config';
import { PUBLIC_WEBSITE_CONFIG_PATH } from './firebase/storage-rest';
import {
  defaultPublicWebsiteContent,
  normalizePublicWebsiteContent,
  WEBSITE_PUBLISHED_ID,
  type PublicWebsiteContent,
} from './public-website-content';

export async function loadPublishedWebsiteContent(): Promise<PublicWebsiteContent> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) return defaultPublicWebsiteContent;
  try {
    const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(PUBLIC_WEBSITE_CONFIG_PATH)}?alt=media&v=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return defaultPublicWebsiteContent;
    return normalizePublicWebsiteContent(await response.json(), WEBSITE_PUBLISHED_ID);
  } catch {
    return defaultPublicWebsiteContent;
  }
}