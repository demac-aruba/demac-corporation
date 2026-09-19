'use strict';
const { PAGE } = require('./websiteEditorialContract');
const { fail, digest } = require('./websiteContentService');
const PRIVATE = `businessSettings/${PAGE.publishedId}/editorState`;
const PATHS = Object.freeze({ draft: `${PRIVATE}/draft`, control: `${PRIVATE}/control`, archive: `${PRIVATE}/legacy-import`, releases: `businessSettings/${PAGE.publishedId}/editorReleases` });

/** Keep the existing public snapshot authoritative. Private drafts/locks live
 * below the existing page document. Current rules already deny client access
 * to these subcollections; no operational reader or root rule change is needed. */
function createWebsiteContentFirebase({ db, bucket, deleteField, deploymentEnabled }) {
  const legacyRef = db.doc(`businessSettings/${PAGE.draftId}`);
  const publishedRef = db.doc(`businessSettings/${PAGE.publishedId}`);
  const draftRef = db.doc(PATHS.draft), controlRef = db.doc(PATHS.control);
  const releases = db.collection(PATHS.releases);
  const file = () => bucket.file(PAGE.publicPath);
  function stateOf(draft, published, control, legacy) {
    const raw = legacy.exists ? legacy.data() : null;
    return { draft: draft.exists ? draft.data() : null, legacyDraft: raw, bootstrap: !draft.exists,
      pending: control.data()?.pending || null, published: published.data() || null,
      legacyFingerprint: digest(raw), legacyDraftChanged: draft.exists && control.data()?.legacyFingerprint !== digest(raw) };
  }
  const store = {
    async profile(uid) { return (await db.doc(`users/${uid}`).get()).data(); },
    async enabled() { return deploymentEnabled() && (await controlRef.get()).data()?.disabled !== true; },
    async read() { return stateOf(...await db.getAll(draftRef, publishedRef, controlRef, legacyRef)); },
    async release(id) { if (!/^[0-9a-f-]{36}$/.test(id || '')) return null; return (await releases.doc(id).get()).data() || null; },
    async history() { return (await releases.orderBy('createdAt', 'desc').limit(30).get()).docs.map((doc) => doc.data()); },
    async transaction(work, uid, requestId) {
      return db.runTransaction(async (tx) => {
        const [draft, published, control, legacy, profile] = await tx.getAll(draftRef, publishedRef, controlRef, legacyRef, db.doc(`users/${uid}`));
        if (!deploymentEnabled() || control.data()?.disabled === true) throw fail('not-active', 'Website publishing is not activated.', 503);
        const receipt = requestId ? await tx.get(releases.doc(requestId)) : null;
        const state = stateOf(draft, published, control, legacy);
        const outcome = await work({ ...state, profile: profile.data(), release: receipt?.exists ? receipt.data() : null });
        if (outcome.draft) {
          tx.set(draftRef, outcome.draft);
          if (!draft.exists) {
            // Atomic first-save import. Preserve the original legacy record.
            tx.create(db.doc(PATHS.archive), { content: state.legacyDraft, fingerprint: state.legacyFingerprint, importedBy: uid, importedAt: new Date().toISOString() });
            tx.set(controlRef, { schemaVersion: 1, legacyFingerprint: state.legacyFingerprint }, { merge: true });
          }
        }
        if (outcome.acknowledgeLegacy) tx.set(controlRef, { legacyFingerprint: state.legacyFingerprint }, { merge: true });
        if (outcome.published) tx.set(publishedRef, outcome.published, { merge: true }); // Published-only compatibility projection.
        if ('pending' in outcome) tx.set(controlRef, { pending: outcome.pending === null ? deleteField() : outcome.pending }, { merge: true });
        if (outcome.release) tx.set(releases.doc(outcome.release.id), outcome.release);
        return outcome.result;
      });
    },
  };
  const media = {
    async read() {
      for (let attempt = 0; attempt < 3; attempt++) {
        let metadata;
        try { [metadata] = await file().getMetadata(); }
        catch (error) { if (Number(error.code) === 404) return null; throw error; }
        if (Number(metadata.size) > 512 * 1024) throw fail('public-read-failed', 'Published configuration exceeds its size limit.', 503);
        try {
          const [bytes] = await bucket.file(PAGE.publicPath, { generation: metadata.generation }).download();
          const content = JSON.parse(bytes.toString('utf8'));
          if (!content || typeof content !== 'object' || Array.isArray(content) || !content.hero) throw fail('public-read-failed', 'Published configuration is invalid; existing content was not replaced.', 503);
          return { generation: String(metadata.generation), content };
        } catch (error) { if (Number(error.code) !== 404 || attempt === 2) throw error; }
      }
      throw fail('public-read-failed', 'Published content could not be read.', 503);
    },
    async compareAndWrite(content, expectedGeneration, publicationId) {
      const payload = JSON.stringify(content);
      if (Buffer.byteLength(payload) > 512 * 1024) throw fail('content-too-large', 'The website configuration is too large.');
      await file().save(payload, { resumable: false, preconditionOpts: { ifGenerationMatch: expectedGeneration === '0' ? 0 : expectedGeneration }, metadata: { contentType: 'application/json', cacheControl: 'public,max-age=0,must-revalidate', metadata: { publicationId } } });
      const [metadata] = await file().getMetadata(); return String(metadata.generation);
    },
  };
  return { store, media };
}
module.exports = { createWebsiteContentFirebase, PATHS };
