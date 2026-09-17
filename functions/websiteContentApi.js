'use strict';
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { PAGE } = require('./websiteEditorialContract');
const { createWebsiteContentService, fail } = require('./websiteContentService');
if (!getApps().length) initializeApp();
const db = getFirestore(), auth = getAuth();
const draftRef = db.collection('businessSettings').doc(PAGE.draftId);
const publishedRef = db.collection('businessSettings').doc(PAGE.publishedId);
const releases = publishedRef.collection('editorReleases');
const settingsRef = db.collection('businessSettings').doc('website-editor');
const file = () => getStorage().bucket().file(PAGE.publicPath);

const store = {
  async profile(uid) { return (await db.collection('users').doc(uid).get()).data(); },
  async enabled() { return process.env.WEBSITE_EDITOR_ENABLED === 'true' && (await settingsRef.get()).data()?.backendEnabled === true; },
  async read() { const [draft, published] = await db.getAll(draftRef, publishedRef); return { draft: draft.exists ? draft.data() : null, pending: published.data()?.editorPending || null, published: published.data() || null }; },
  async release(id) { if (!/^[0-9a-f-]{36}$/.test(id || '')) return null; return (await releases.doc(id).get()).data() || null; },
  async history() { return (await releases.orderBy('createdAt', 'desc').limit(30).get()).docs.map((doc) => doc.data()); },
  async transaction(work, uid, requestId) {
    return db.runTransaction(async (tx) => {
      const [draft, published, profile, config] = await tx.getAll(draftRef, publishedRef, db.collection('users').doc(uid), settingsRef);
      if (config.data()?.backendEnabled !== true || process.env.WEBSITE_EDITOR_ENABLED !== 'true') throw fail('not-active', 'Website publishing is not activated.', 503);
      const receipt = requestId ? await tx.get(releases.doc(requestId)) : null;
      const outcome = await work({ release: receipt?.exists ? receipt.data() : null, published: published.data() || null, draft: draft.exists ? draft.data() : null, pending: published.data()?.editorPending || null, profile: profile.data() });
      if (outcome.draft) tx.set(draftRef, outcome.draft);
      if (outcome.published) tx.set(publishedRef, outcome.published, { merge: true });
      if ('pending' in outcome) tx.set(publishedRef, { editorPending: outcome.pending === null ? FieldValue.delete() : outcome.pending }, { merge: true });
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
        const [bytes] = await getStorage().bucket().file(PAGE.publicPath, { generation: metadata.generation }).download();
        return { generation: String(metadata.generation), content: JSON.parse(bytes.toString('utf8')) };
      } catch (error) {
        // Replacement can retire an unversioned object's pinned generation.
        // Retry metadata; never misreport that race as an absent public page.
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
const service = createWebsiteContentService({ store, media });

exports.websiteContentApi = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB', maxInstances: 3 }, async (request, response) => {
  const origin = request.get('origin') || '';
  const allowed = new Set(['https://demac-aruba.com', 'https://www.demac-aruba.com', ...(process.env.WEBSITE_EDITOR_ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)]);
  const local = process.env.FUNCTIONS_EMULATOR === 'true' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
  response.set('Cache-Control', 'no-store'); response.set('X-Content-Type-Options', 'nosniff'); response.set('Vary', 'Origin');
  if (!allowed.has(origin) && !local) { response.status(403).json({ ok: false, message: 'Origin not authorized for website publishing.' }); return; }
  response.set('Access-Control-Allow-Origin', origin); response.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (request.method === 'OPTIONS') { response.status(204).send(''); return; }
  if (request.method !== 'POST') { response.status(405).json({ ok: false, message: 'POST required.' }); return; }
  try {
    if (Buffer.byteLength(JSON.stringify(request.body || {})) > 512 * 1024) throw fail('body-too-large', 'Request is too large.', 413);
    const match = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') || '');
    if (!match) throw fail('unauthenticated', 'Sign in to DEMAC ERP.', 401);
    let token;
    try { token = await auth.verifyIdToken(match[1], true); } catch { throw fail('unauthenticated', 'Session expired. Sign in again.', 401); }
    const result = await service.execute({ uid: token.uid }, request.body);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    response.status(status).json({ ok: false, code: error.code || 'website-editor-error', message: status === 500 ? 'Website publishing did not complete. Retry or reload to recover; no success was confirmed.' : error.message });
  }
});
