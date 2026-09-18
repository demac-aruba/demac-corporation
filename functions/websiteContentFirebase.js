'use strict';
const { PAGE } = require('./websiteEditorialContract');
const { fail } = require('./websiteContentService');

/** Website-only infrastructure adapter. No initialization, exports of deployed
 * functions, or operational dependencies. The same adapter is exercised against
 * demo emulators and used by the inactive production API candidate. */
function createWebsiteContentFirebase({ db, bucket, deleteField, deploymentEnabled }) {
  const draftRef = db.collection('businessSettings').doc(PAGE.draftId);
  const publishedRef = db.collection('businessSettings').doc(PAGE.publishedId);
  const releases = publishedRef.collection('editorReleases');
  const settingsRef = db.collection('businessSettings').doc('website-editor');
  const file = () => bucket.file(PAGE.publicPath);
  const store = {
    async profile(uid) { return (await db.collection('users').doc(uid).get()).data(); },
    async enabled() { return deploymentEnabled() && (await settingsRef.get()).data()?.backendEnabled === true; },
    async read() {
      const [draft, published] = await db.getAll(draftRef, publishedRef);
      return { draft: draft.exists ? draft.data() : null, pending: published.data()?.editorPending || null, published: published.data() || null };
    },
    async release(id) { if (!/^[0-9a-f-]{36}$/.test(id || '')) return null; return (await releases.doc(id).get()).data() || null; },
    async history() { return (await releases.orderBy('createdAt', 'desc').limit(30).get()).docs.map((doc) => doc.data()); },
    async transaction(work, uid, requestId) {
      return db.runTransaction(async (tx) => {
        const [draft, published, profile, config] = await tx.getAll(draftRef, publishedRef, db.collection('users').doc(uid), settingsRef);
        if (config.data()?.backendEnabled !== true || !deploymentEnabled()) throw fail('not-active', 'Website publishing is not activated.', 503);
        const receipt = requestId ? await tx.get(releases.doc(requestId)) : null;
        const outcome = await work({ release: receipt?.exists ? receipt.data() : null, published: published.data() || null, draft: draft.exists ? draft.data() : null, pending: published.data()?.editorPending || null, profile: profile.data() });
        if (outcome.draft) tx.set(draftRef, outcome.draft);
        if (outcome.published) tx.set(publishedRef, outcome.published, { merge: true });
        if ('pending' in outcome) tx.set(publishedRef, { editorPending: outcome.pending === null ? deleteField() : outcome.pending }, { merge: true });
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
        try {
          const [bytes] = await bucket.file(PAGE.publicPath, { generation: metadata.generation }).download();
          return { generation: String(metadata.generation), content: JSON.parse(bytes.toString('utf8')) };
        } catch (error) {
          if (Number(error.code) !== 404 || attempt === 2) throw error;
        }
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
module.exports = { createWebsiteContentFirebase };
