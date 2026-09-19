import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { requireFirebaseWebSession } from '@/lib/firebase/session';
import { firebaseClientConfig } from '@/lib/firebase/client-config';
import { uploadPublicWebsiteImage } from '@/lib/firebase/storage-rest';
import type { PublicVrfContent } from '@/lib/public-vrf-content';
import { applyChanges, isReviewBuild, type EditorialChange } from './contract';
import { verifyPublishedWebsiteVersion } from './publication-check';

export type EditorSnapshot = { content: PublicVrfContent; revision: number; savedAt: string; publicationId?: string; pendingPublicationId?: string; seedToken?: string; publishedContent?: PublicVrfContent; legacyDraftChanged?: boolean };
export type RevisionEntry = { id: string; savedAt: string; content: PublicVrfContent };
export interface EditorialRepository {
  mode: 'review' | 'live';
  load(seed: PublicVrfContent): Promise<EditorSnapshot>;
  save(changes: EditorialChange[], expectedRevision: number): Promise<EditorSnapshot>;
  publish(expectedRevision: number, requestId: string): Promise<EditorSnapshot>;
  history(): Promise<RevisionEntry[]>;
  restore(id: string, expectedRevision: number): Promise<EditorSnapshot>;
  reset(expectedRevision: number): Promise<EditorSnapshot>;
  upload(file: File): Promise<string>;
  dispose(): void;
}
export class PublicationRecoveryRequired extends Error {
  constructor(message: string, readonly requestId: string, readonly expectedRevision: number) { super(message); this.name = 'PublicationRecoveryRequired'; }
}
async function owner(actorId: string) {
  const principal = await loadFirebasePrincipal();
  if (!principal.active || principal.role !== 'super_admin' || principal.userId !== actorId) throw new Error('Owner / Super Admin access is required. Return to Settings and sign in again.');
}
async function verifyImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP image smaller than 8 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('The image dimensions are invalid or too large.');
  } finally { URL.revokeObjectURL(url); }
}
function copy<T>(value: T): T { return structuredClone(value); }
function validSnapshot(result: EditorSnapshot) {
  if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0 || !result.content?.hero?.title || !Array.isArray(result.content.indoorUnits)) throw new Error('The saved draft response is invalid. Reload before editing further.');
  if (result.seedToken !== undefined && !/^[0-9a-f]{64}$/.test(result.seedToken)) throw new Error('Invalid draft import version. Reload the draft.');
  return result;
}

/** Review stays in this tab; live mode never falls back to local success. */
export function createEditorialRepository(actorId: string): EditorialRepository {
  const review = isReviewBuild();
  let snapshot: EditorSnapshot | null = null, published: PublicVrfContent | null = null;
  const revisions: RevisionEntry[] = [], urls = new Set<string>(), requests = new Map<string, EditorSnapshot>();
  let seedToken: string | undefined;
  let pendingRequest: { requestId: string; expectedRevision: number; expectedSeedToken?: string } | undefined;
  const writable = () => { if (pendingRequest) throw new PublicationRecoveryRequired('Recover or reload the pending publication before changing this draft.', pendingRequest.requestId, pendingRequest.expectedRevision); };
  const ready = (revision: number) => { if (!snapshot || snapshot.revision !== revision) throw new Error('This draft changed in another operation. Reload it before saving.'); return snapshot; };
  const seed = () => seedToken ? { expectedSeedToken: seedToken } : {};
  const accepted = (result: EditorSnapshot) => { validSnapshot(result); seedToken = result.seedToken; return result; };
  async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    await owner(actorId);
    const session = await requireFirebaseWebSession();
    const url = `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/websiteContentApi`;
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: 'vrf', action, ...payload }), signal: AbortSignal.timeout(30_000) });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result.result === undefined) throw new Error(result?.message || 'The publishing response could not be verified. Reload or retry to check the result.');
    return result.result as T;
  }
  return {
    mode: review ? 'review' : 'live',
    async load(seedContent) {
      if (!review) { const result = accepted(await call<EditorSnapshot>('load')); pendingRequest = result.pendingPublicationId ? { requestId: result.pendingPublicationId, expectedRevision: result.revision, ...seed() } : undefined; return result; }
      await owner(actorId);
      if (!snapshot) { snapshot = { content: copy(seedContent), revision: 0, savedAt: '' }; published = copy(seedContent); }
      return copy(snapshot);
    },
    async save(changes, expectedRevision) {
      if (!review) { writable(); return accepted(await call<EditorSnapshot>('save', { changes, expectedRevision, ...seed() })); }
      await owner(actorId); const current = ready(expectedRevision);
      snapshot = { content: applyChanges(current.content, changes, { allowPreviewImages: true }), revision: current.revision + 1, savedAt: new Date().toISOString() };
      return copy(snapshot);
    },
    async publish(expectedRevision, requestId) {
      if (!review) {
        pendingRequest ||= { requestId, expectedRevision, ...seed() };
        const attempt = pendingRequest;
        try {
          const result = validSnapshot(await call<EditorSnapshot>('publish', attempt));
          if (result.publicationId !== attempt.requestId) throw new Error('Publication acknowledgement does not match this request. Reload to recover.');
          await verifyPublishedWebsiteVersion(result);
          accepted(result); pendingRequest = undefined; return result;
        } catch (cause) { throw new PublicationRecoveryRequired(cause instanceof Error ? cause.message : 'Publication could not be verified.', attempt.requestId, attempt.expectedRevision); }
      }
      await owner(actorId);
      if (requests.has(requestId)) return copy(requests.get(requestId)!);
      const current = ready(expectedRevision);
      if (published) revisions.unshift({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), content: copy(published) });
      published = copy(current.content); published.version += 1; published.publicationId = requestId;
      snapshot = { ...current, content: copy(published), publicationId: requestId }; requests.set(requestId, copy(snapshot)); return copy(snapshot);
    },
    async history() { if (!review) return call('history'); await owner(actorId); return copy(revisions.slice(0, 20)); },
    async restore(id, expectedRevision) {
      if (!review) { writable(); return accepted(await call<EditorSnapshot>('restore', { revisionId: id, expectedRevision, ...seed() })); }
      await owner(actorId); const current = ready(expectedRevision);
      const previous = revisions.find((item) => item.id === id); if (!previous) throw new Error('The selected revision is unavailable.');
      snapshot = { content: copy(previous.content), revision: current.revision + 1, savedAt: new Date().toISOString() }; return copy(snapshot);
    },
    async reset(expectedRevision) {
      if (!review) { writable(); const result = accepted(await call<EditorSnapshot>('reset', { expectedRevision, ...seed() })); pendingRequest = undefined; return result; }
      await owner(actorId); const current = ready(expectedRevision); if (!published) throw new Error('Published review content is unavailable.');
      snapshot = { content: copy(published), revision: current.revision + 1, savedAt: new Date().toISOString() }; return copy(snapshot);
    },
    async upload(file) {
      if (!review) writable(); await owner(actorId); await verifyImage(file);
      if (review) { const url = URL.createObjectURL(file); urls.add(url); return url; }
      const result = await uploadPublicWebsiteImage(file, 'vrf/editor');
      if (result.persistence !== 'firebase-storage') throw new Error('The image was not uploaded to cloud storage. Nothing was published.');
      return result.mediaUrl;
    },
    dispose() { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); snapshot = null; published = null; pendingRequest = undefined; seedToken = undefined; revisions.length = 0; requests.clear(); },
  };
}
