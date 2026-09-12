import { getFirestoreDocument, saveFirestoreDocument } from './firestore-rest';
import { uploadAuthenticatedFirebaseStorageObject } from './storage-upload';
import {
  clonePublicVrfContent,
  defaultPublicVrfContent,
  normalizePublicVrfContent,
  PUBLIC_VRF_CONFIG_PATH,
  VRF_DRAFT_ID,
  VRF_PUBLISHED_ID,
  VRF_SETTINGS_COLLECTION,
  type PublicVrfContent,
} from '../public-vrf-content';

const LOCAL_DRAFT_KEY = 'demac.website-manager.vrf.draft.v1';
const LOCAL_PUBLISHED_KEY = 'demac.website-manager.vrf.published.v1';

function readLocal(key: string, id: string): PublicVrfContent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalizePublicVrfContent(JSON.parse(raw), id) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, content: PublicVrfContent) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(content)); } catch { /* resilience fallback only */ }
}

function buildDraft(content: PublicVrfContent, actorId: string): PublicVrfContent {
  return {
    ...clonePublicVrfContent(content, VRF_DRAFT_ID),
    id: VRF_DRAFT_ID,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  };
}

function containsBrowserOnlyImage(content: PublicVrfContent) {
  return content.hero.imageUrl.startsWith('data:image/') || content.trust.imageUrl.startsWith('data:image/');
}

export async function loadVrfWebsiteDraft() {
  try {
    const stored = await getFirestoreDocument<PublicVrfContent>(VRF_SETTINGS_COLLECTION, VRF_DRAFT_ID);
    if (stored) {
      const normalized = normalizePublicVrfContent(stored, VRF_DRAFT_ID);
      writeLocal(LOCAL_DRAFT_KEY, normalized);
      return normalized;
    }
    const published = await getFirestoreDocument<PublicVrfContent>(VRF_SETTINGS_COLLECTION, VRF_PUBLISHED_ID);
    if (published) {
      const normalized = normalizePublicVrfContent(published, VRF_DRAFT_ID);
      writeLocal(LOCAL_DRAFT_KEY, normalized);
      return normalized;
    }
  } catch { /* keep manager usable if rules lag deployment */ }
  return readLocal(LOCAL_DRAFT_KEY, VRF_DRAFT_ID) ?? clonePublicVrfContent(defaultPublicVrfContent, VRF_DRAFT_ID);
}

export async function loadVrfWebsitePublishedForManager() {
  try {
    const stored = await getFirestoreDocument<PublicVrfContent>(VRF_SETTINGS_COLLECTION, VRF_PUBLISHED_ID);
    if (stored) {
      const normalized = normalizePublicVrfContent(stored, VRF_PUBLISHED_ID);
      writeLocal(LOCAL_PUBLISHED_KEY, normalized);
      return normalized;
    }
  } catch { /* fall through to local snapshot */ }
  return readLocal(LOCAL_PUBLISHED_KEY, VRF_PUBLISHED_ID);
}

export async function saveVrfWebsiteDraft(content: PublicVrfContent, actorId: string) {
  const next = buildDraft(content, actorId);
  try {
    const saved = await saveFirestoreDocument(VRF_SETTINGS_COLLECTION, next);
    writeLocal(LOCAL_DRAFT_KEY, saved);
    return saved;
  } catch {
    writeLocal(LOCAL_DRAFT_KEY, next);
    return next;
  }
}

export async function publishVrfWebsiteContent(content: PublicVrfContent, actorId: string) {
  if (containsBrowserOnlyImage(content)) {
    const draft = buildDraft(content, actorId);
    writeLocal(LOCAL_DRAFT_KEY, draft);
    throw new Error('This VRF draft contains an image saved only in this browser. Upload the image to website media or use an image URL before publishing. The live VRF page has not changed.');
  }

  const now = new Date().toISOString();
  const published: PublicVrfContent = {
    ...clonePublicVrfContent(content, VRF_PUBLISHED_ID),
    id: VRF_PUBLISHED_ID,
    version: Math.max(1, content.version + 1),
    updatedAt: now,
    updatedBy: actorId,
    publishedAt: now,
    publishedBy: actorId,
  };

  let auditCopy = published;
  try { auditCopy = await saveFirestoreDocument(VRF_SETTINGS_COLLECTION, published); } catch { /* Storage remains publishing source */ }

  const payload = JSON.stringify(auditCopy);
  if (new Blob([payload]).size > 512 * 1024) throw new Error('The VRF page configuration is too large to publish.');
  try {
    await uploadAuthenticatedFirebaseStorageObject(PUBLIC_VRF_CONFIG_PATH, payload, 'application/json');
  } catch {
    const draft = buildDraft(content, actorId);
    writeLocal(LOCAL_DRAFT_KEY, draft);
    throw new Error('VRF publishing is waiting for Firebase website Storage permissions. Your draft is preserved and the live VRF page has not changed.');
  }

  writeLocal(LOCAL_PUBLISHED_KEY, auditCopy);
  const draftFromPublished = { ...clonePublicVrfContent(auditCopy, VRF_DRAFT_ID), id: VRF_DRAFT_ID };
  try {
    const savedDraft = await saveFirestoreDocument(VRF_SETTINGS_COLLECTION, draftFromPublished);
    writeLocal(LOCAL_DRAFT_KEY, savedDraft);
    return { published: auditCopy, draft: savedDraft };
  } catch {
    writeLocal(LOCAL_DRAFT_KEY, draftFromPublished);
    return { published: auditCopy, draft: draftFromPublished };
  }
}
