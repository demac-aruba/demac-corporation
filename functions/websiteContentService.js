'use strict';
const crypto = require('node:crypto');
const { PAGE, defaults, normalizeVrf, applyChanges, values } = require('./websiteEditorialContract');
const canonicalJson = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digest = (value) => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function assertOwner(profile) {
  const role = String(profile?.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (profile?.active !== true || !['owner', 'admin', 'superadmin', 'super_admin'].includes(role)) throw fail('permission-denied', 'Owner / Super Admin access is required.', 403);
}
function changesOnly(base, edited) {
  const before = values(base), after = values(edited);
  return Object.keys(before).filter((key) => typeof after[key] === 'string' && after[key] !== before[key]).map((key) => ({ key, value: after[key] }));
}
function safeApply(base, changes) {
  try { return applyChanges(base, changes); }
  catch (error) { throw fail('invalid-editorial-field', error.message); }
}

/** Public Storage JSON remains the only published authority. */
function createWebsiteContentService({ store, media, clock = () => new Date().toISOString() }) {
  async function authorized(actor) {
    if (!actor?.uid) throw fail('unauthenticated', 'Sign in to DEMAC ERP.', 401);
    assertOwner(await store.profile(actor.uid));
    if (!await store.enabled()) throw fail('not-active', 'Website publishing is not activated. No data was changed.', 503);
  }
  async function publication() {
    const result = await media.read();
    return { generation: result?.generation || '0', content: normalizeVrf(result?.content || defaults) };
  }
  function editableDraft(state, publicState) {
    const raw = state.draft || (state.bootstrap ? state.legacyDraft : null) || publicState.content;
    // Full import token binds first-save review to both the legacy draft and
    // public Storage generation. Loading alone never migrates or publishes.
    const seedToken = state.bootstrap ? digest({ legacy: state.legacyDraft || null, generation: publicState.generation }) : null;
    const content = safeApply(publicState.content, changesOnly(publicState.content, normalizeVrf(raw)));
    return { ...content, id: PAGE.draftId, ...(seedToken ? { editorSeedToken: seedToken } : {}), editorRevision: state.bootstrap ? 0 : raw.editorRevision || 0, editorBaseGeneration: state.bootstrap ? publicState.generation : raw.editorBaseGeneration || publicState.generation, updatedAt: raw.updatedAt || '', updatedBy: raw.updatedBy || '' };
  }
  const snapshot = (draft, pendingPublicationId) => ({ ...(draft.editorSeedToken ? { seedToken: draft.editorSeedToken } : {}), content: normalizeVrf(draft), revision: draft.editorRevision || 0, savedAt: draft.updatedAt || '', ...(pendingPublicationId ? { pendingPublicationId } : {}) });
  function revision(draft, expected, expectedSeedToken) {
    if (draft.editorSeedToken && draft.editorSeedToken !== expectedSeedToken) throw fail('draft-conflict', 'The legacy draft or published content changed before import. Reload to review it.', 409);
    if (!Number.isSafeInteger(expected) || expected < 0 || (draft.editorRevision || 0) !== expected) throw fail('draft-conflict', 'The shared draft changed. Reload before saving or publishing.', 409);
  }
  const matches = (state, release) => state?.content?.publicationId === release.id && digest(state.content) === release.digest;
  async function execute(actor, command) {
    await authorized(actor);
    if (command?.pageId !== PAGE.id) throw fail('page-forbidden', 'This page is not connected to the content editor.', 403);
    const action = command.action;
    if (action === 'status') return { pageId: PAGE.id, active: true, schemaVersion: 1 };
    if (action === 'load') {
      const publicState = await publication(), state = await store.read();
      return { ...snapshot(editableDraft(state, publicState), state.pending?.id), publishedContent: publicState.content, legacyDraftChanged: state.legacyDraftChanged === true, ...(state.legacyDraftChanged ? { legacyConflictToken: state.legacyFingerprint } : {}) };
    }
    if (action === 'history') return (await store.history()).filter((entry) => entry.status === 'published').slice(0, 20).map((entry) => ({ id: entry.id, savedAt: entry.createdAt, content: entry.previousContent }));
    if (['save', 'restore', 'reset'].includes(action)) {
      const publicState = await publication();
      const old = action === 'restore' && uuid(command.revisionId) ? await store.release(command.revisionId) : null;
      if (action === 'restore' && (!old || old.status !== 'published')) throw fail('revision-not-found', 'The selected published version is unavailable.', 404);
      return store.transaction(async (state) => {
        assertOwner(state.profile);
        if (state.pending) throw fail('publication-pending', 'Recover the pending publication before changing this draft.', 409);
        const draft = editableDraft(state, publicState); revision(draft, command.expectedRevision, command.expectedSeedToken);
        if (state.legacyDraftChanged && action !== 'reset') throw fail('legacy-draft-conflict', 'An older Website Manager tab changed its draft. Reload, review the warning and explicitly reset to published before continuing. Both drafts are preserved.', 409);
        if (state.legacyDraftChanged && command.expectedLegacyFingerprint !== state.legacyFingerprint) throw fail('legacy-draft-conflict', 'The older draft changed again. Reload before reconciling it.', 409);
        const content = action === 'reset' ? publicState.content : action === 'restore' ? safeApply(draft, changesOnly(draft, normalizeVrf(old.previousContent))) : safeApply(draft, command.changes);
        const next = { ...normalizeVrf(content), id: PAGE.draftId, editorRevision: draft.editorRevision + 1, editorBaseGeneration: action === 'save' ? draft.editorBaseGeneration : publicState.generation, updatedAt: clock(), updatedBy: actor.uid };
        return { draft: next, acknowledgeLegacy: action === 'reset' && state.legacyDraftChanged === true, result: { ...snapshot(next), publishedContent: publicState.content, legacyDraftChanged: false } };
      }, actor.uid);
    }
    if (action !== 'publish') throw fail('invalid-action', 'Unsupported content-editor operation.');
    if (!uuid(command.requestId)) throw fail('invalid-request', 'A publication request identifier is required.');
    let release = await store.release(command.requestId);
    if (release && release.draftRevision !== command.expectedRevision) throw fail('request-mismatch', 'Retry the original publication with its original revision.', 409);
    if (release?.status === 'conflict') throw fail('publication-conflict', 'A newer version prevented this publication. Review the current version before retrying.', 409);
    if (!release) {
      const publicState = await publication();
      release = await store.transaction(async (state) => {
        assertOwner(state.profile);
        if (state.release) return { result: state.release };
        if (state.pending) throw fail('publication-pending', 'A publication needs recovery. Reload the editor to resume it.', 409);
        if (state.legacyDraftChanged) throw fail('legacy-draft-conflict', 'An older Website Manager tab changed its draft. Reload and reconcile it before publishing. Both drafts are preserved.', 409);
        const draft = editableDraft(state, publicState); revision(draft, command.expectedRevision, command.expectedSeedToken);
        if (draft.editorBaseGeneration !== publicState.generation) throw fail('published-version-conflict', 'The public version changed. Reset the draft to published and review your edits first.', 409);
        if (/"imageUrl"\s*:\s*"(?:blob:|data:)/.test(JSON.stringify(state.draft || state.legacyDraft || {}))) throw fail('unpublished-image', 'Upload browser-only images before publishing.');
        const nextContent = { ...normalizeVrf(draft), id: PAGE.publishedId, version: publicState.content.version + 1, publicationId: command.requestId, updatedAt: clock(), updatedBy: actor.uid, publishedAt: clock(), publishedBy: actor.uid };
        if (Buffer.byteLength(JSON.stringify(nextContent)) > 512 * 1024) throw fail('content-too-large', 'The website configuration is too large.');
        const record = { id: command.requestId, status: 'prepared', actorId: actor.uid, createdAt: clock(), draftRevision: draft.editorRevision, expectedGeneration: publicState.generation, previousContent: publicState.content, nextContent, digest: digest(nextContent) };
        return { ...(state.bootstrap ? { draft } : {}), release: record, pending: { id: record.id }, result: record };
      }, actor.uid, command.requestId);
    }
    if (release.draftRevision !== command.expectedRevision) throw fail('request-mismatch', 'Retry the original publication with its original revision.', 409);
    await authorized(actor);
    let publicState = await media.read();
    if (release.status === 'published') {
      if (!matches(publicState, release)) throw fail('publication-superseded', 'That request already published an earlier version. Reload to view the current page; no old content was republished.', 409);
      return { ...snapshot(release.nextContent), revision: release.draftRevision, publicationId: release.id };
    }
    if (!matches(publicState, release)) {
      try { await media.compareAndWrite(release.nextContent, release.expectedGeneration, release.id); }
      catch (error) {
        const observed = await media.read().catch(() => null);
        if (!matches(observed, release)) {
          if (Number(error.code || error.status) === 412) {
            await store.transaction(async (state) => {
              assertOwner(state.profile);
              if (state.release?.status === 'published') return { result: null };
              return { ...(state.pending?.id === release.id ? { pending: null } : {}), release: { ...release, status: 'conflict' }, result: null };
            }, actor.uid, release.id);
            throw fail('publication-conflict', 'A newer page version was not overwritten. Reset to published to reconcile the draft.', 409);
          }
          throw fail('publication-uncertain', 'Publication is not confirmed. Retry this same request to recover safely.', 503);
        }
      }
    }
    publicState = await media.read();
    if (!matches(publicState, release)) throw fail('publication-unverified', 'The public version could not be verified. Retry to recover this publication.', 503);
    const generation = publicState.generation;
    return store.transaction(async (state) => {
      assertOwner(state.profile);
      if (state.release?.status === 'published') return { result: { ...snapshot(state.release.nextContent), revision: release.draftRevision, publicationId: release.id } };
      if (state.pending?.id !== release.id) throw fail('publication-lock-lost', 'Publication state changed. Reload to review it.', 409);
      const completed = { ...release, status: 'published', publishedAt: clock(), generation };
      const projection = { ...release.nextContent, editorGeneration: generation };
      const draft = { ...release.nextContent, id: PAGE.draftId, editorRevision: release.draftRevision, editorBaseGeneration: generation, updatedAt: clock(), updatedBy: actor.uid };
      return { draft, published: projection, release: completed, pending: null, result: { ...snapshot(draft), publicationId: release.id } };
    }, actor.uid, release.id);
  }
  return { execute };
}
module.exports = { createWebsiteContentService, assertOwner, fail, digest };
