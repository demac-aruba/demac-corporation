import { firebaseClientConfig, isFirebaseClientConfigured } from './firebase/client-config';
import { decodeFirestoreFields, type FirestoreValue } from './firebase/firestore-rest';
import {
  defaultPublicWebsiteContent,
  normalizePublicWebsiteContent,
  WEBSITE_PUBLISHED_ID,
  WEBSITE_SETTINGS_COLLECTION,
  type PublicWebsiteContent,
} from './public-website-content';

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
};

export async function loadPublishedWebsiteContent(): Promise<PublicWebsiteContent> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.projectId) return defaultPublicWebsiteContent;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseClientConfig.projectId}/databases/(default)/documents/${WEBSITE_SETTINGS_COLLECTION}/${WEBSITE_PUBLISHED_ID}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return defaultPublicWebsiteContent;
    const document = await response.json() as FirestoreDocument;
    return normalizePublicWebsiteContent(decodeFirestoreFields(document.fields ?? {}), WEBSITE_PUBLISHED_ID);
  } catch {
    return defaultPublicWebsiteContent;
  }
}
