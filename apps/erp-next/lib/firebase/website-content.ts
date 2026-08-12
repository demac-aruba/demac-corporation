import { getFirestoreDocument, saveFirestoreDocument } from './firestore-rest';
import { publishPublicWebsiteConfig } from './storage-rest';
import {
  cloneWebsiteContent,
  defaultPublicWebsiteContent,
  normalizePublicWebsiteContent,
  WEBSITE_DRAFT_ID,
  WEBSITE_PUBLISHED_ID,
  WEBSITE_SETTINGS_COLLECTION,
  type PublicWebsiteContent,
} from '../public-website-content';

const LOCAL_DRAFT_KEY = 'demac.website-manager.draft.v1';
const LOCAL_PUBLISHED_KEY = 'demac.website-manager.published.v1';

function readLocalWebsiteContent(key: string, id: string): PublicWebsiteContent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizePublicWebsiteContent(JSON.parse(raw), id);
  } catch {
    return null;
  }
}

function writeLocalWebsiteContent(key: string, content: PublicWebsiteContent) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(content));
  } catch {
    // Browser storage is a resilience fallback only. A storage quota/privacy
    // failure must not make the Website Manager crash.
  }
}

function buildDraft(content: PublicWebsiteContent, actorId: string): PublicWebsiteContent {
  const now = new Date().toISOString();
  return {
    ...cloneWebsiteContent(content, WEBSITE_DRAFT_ID),
    id: WEBSITE_DRAFT_ID,
    version: Math.max(1, content.version),
    updatedAt: now,
    updatedBy: actorId,
  };
}

export async function loadWebsiteDraft() {
  try {
    const stored = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_DRAFT_ID);
    if (stored) {
      const normalized = normalizePublicWebsiteContent(stored, WEBSITE_DRAFT_ID);
      writeLocalWebsiteContent(LOCAL_DRAFT_KEY, normalized);
      return normalized;
    }

    const published = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_PUBLISHED_ID);
    if (published) {
      const normalized = normalizePublicWebsiteContent(published, WEBSITE_DRAFT_ID);
      writeLocalWebsiteContent(LOCAL_DRAFT_KEY, normalized);
      return normalized;
    }
  } catch {
    // Firestore rules can be deployed independently from Vercel. If the
    // active rules are temporarily behind the application, keep the content
    // studio usable instead of surfacing a raw 403 to the owner.
  }

  return readLocalWebsiteContent(LOCAL_DRAFT_KEY, WEBSITE_DRAFT_ID)
    ?? cloneWebsiteContent(defaultPublicWebsiteContent, WEBSITE_DRAFT_ID);
}

export async function loadWebsitePublishedForManager() {
  try {
    const stored = await getFirestoreDocument<PublicWebsiteContent>(WEBSITE_SETTINGS_COLLECTION, WEBSITE_PUBLISHED_ID);
    if (stored) {
      const normalized = normalizePublicWebsiteContent(stored, WEBSITE_PUBLISHED_ID);
      writeLocalWebsiteContent(LOCAL_PUBLISHED_KEY, normalized);
      return normalized;
    }
  } catch {
    // Fall through to the last locally known published snapshot.
  }
  return readLocalWebsiteContent(LOCAL_PUBLISHED_KEY, WEBSITE_PUBLISHED_ID);
}

export async function saveWebsiteDraft(content: PublicWebsiteContent, actorId: string) {
  const next = buildDraft(content, actorId);
  try {
    const saved = await saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, next);
    writeLocalWebsiteContent(LOCAL_DRAFT_KEY, saved);
    return saved;
  } catch {
    // Save Draft must remain useful while Firebase rules are pending. This is
    // intentionally browser-local and never makes content public.
    writeLocalWebsiteContent(LOCAL_DRAFT_KEY, next);
    return next;
  }
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

  // Firestore is the authenticated audit copy, but it must not be a single
  // point of failure for the public publishing path. The customer site reads
  // only the public Storage JSON and has bundled defaults as a final fallback.
  let auditCopy = published;
  try {
    auditCopy = await saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, published);
  } catch {
    // Continue to Storage. This covers the window where Vercel is current but
    // Firestore rules have not yet been deployed.
  }

  try {
    await publishPublicWebsiteConfig(auditCopy);
  } catch {
    const preservedDraft = buildDraft(content, actorId);
    writeLocalWebsiteContent(LOCAL_DRAFT_KEY, preservedDraft);
    throw new Error('Publish is waiting for the Firebase website Storage rules to be activated. Your draft is preserved in this browser and the live website has not been changed.');
  }

  writeLocalWebsiteContent(LOCAL_PUBLISHED_KEY, auditCopy);

  const draftFromPublished: PublicWebsiteContent = {
    ...cloneWebsiteContent(auditCopy, WEBSITE_DRAFT_ID),
    id: WEBSITE_DRAFT_ID,
  };

  try {
    const savedDraft = await saveFirestoreDocument(WEBSITE_SETTINGS_COLLECTION, draftFromPublished);
    writeLocalWebsiteContent(LOCAL_DRAFT_KEY, savedDraft);
    return { published: auditCopy, draft: savedDraft };
  } catch {
    writeLocalWebsiteContent(LOCAL_DRAFT_KEY, draftFromPublished);
    return { published: auditCopy, draft: draftFromPublished };
  }
}
