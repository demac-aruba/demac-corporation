'use strict';
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { createWebsiteContentService, fail } = require('./websiteContentService');
const { createWebsiteContentFirebase } = require('./websiteContentFirebase');

// Candidate endpoint only. It is deliberately not imported by bootstrap.js.
// No existing production function is replaced or redeployed by this module.
if (!getApps().length) initializeApp();
const auth = getAuth();
const service = createWebsiteContentService(createWebsiteContentFirebase({
  db: getFirestore(), bucket: getStorage().bucket(), deleteField: () => FieldValue.delete(),
  deploymentEnabled: () => process.env.WEBSITE_EDITOR_ENABLED === 'true',
}));

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
