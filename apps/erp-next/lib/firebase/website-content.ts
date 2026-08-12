import { getFirestoreDocument, saveFirestoreDocument } from './firestore-rest';
import {
  cloneWebsiteContent,
  defaultPublicWebsiteContent,
  normalizePublicWebsiteContent,
  WEBSITE_DRAFT_ID,
  WEBSITE_PUBLISHED_ID,
  WEBSITE_SETTINGS_COLLECTION,
  type PublicWebsiteContent,
} from '../public-website-content';

export async function loadWebsiteDraft() {
  const stored = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_DRAFT_ID);
  if (stored) return normalizePublicWebsiteContent(stored, WEBSITE_DRAFT_ID);
  const published = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_PUBLISHED_ID);
  return published
    ? normalizePublicWebsiteContent(published, WEBSITE_DRAFT_ID)
    : cloneWebsiteContent(defaultPublicWebsiteContent, WEBSITE_DRAFT_ID);
}

export async function loadWebsitePublishedForManager() {
  const stored = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_PUBLISHED_ID);
  return stored ? normalizePublicWebsiteContent(stored, WEBSITE_PUBLISHED_ID) : null;
}

export async function saveWebsiteDraft(content: PublicWebsiteContent, actorId: string) {
  const now = new Date().toISOString();
  const next: PublicWebsiteContent = {
    ...cloneWebsiteContent(content, WEBSITE_DRAFT_ID),
    id: WEBSITE_DRAFT_ID,
    version: Math.max(1, content.version),
    updatedAt: now,
    updatedBy: actorId,
  };
  return saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, next);
}

export async function publishWebsiteContent(content: PublicWebsiteContent, actorId: string) {
  const now = new Date().toISOString();
  const nextVersion = Math.max(1, content.version + 1);
  const published: PublicWebsiteContent = {
    ...cloneWebsiteContent(content, WEBSITE_PUBLISHED_ID),
    id: WEBSITE_PUBLISHED_ID,
    version: nextVersion,
    updatedAt: now,
    updatedBy: actorId,
    publishedAt: now,
    publishedBy: actorId,
  };
  const savedPublished = await saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, published);
  const draft = await saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, {
    ...cloneWebsiteContent(savedPublished, WEBSITE_DRAFT_ID),
    id: WEBSITE_DRAFT_ID,
  });
  return { published: savedPublished, draft };
}
