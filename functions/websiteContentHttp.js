'use strict';
const { fail } = require('./websiteContentService');
/** Exact same HTTP boundary in deployment and emulator integration. */
function createWebsiteContentHttp({ service, verifyToken, allowedOrigins }) {
  const allowed = new Set(allowedOrigins);
  return async (request, response) => {
    const origin = request.get('origin') || '';
    response.set('Cache-Control', 'no-store'); response.set('X-Content-Type-Options', 'nosniff'); response.set('Vary', 'Origin');
    if (!allowed.has(origin)) { response.status(403).json({ ok: false, code: 'origin-denied', message: 'Origin not authorized for website editing.' }); return; }
    response.set('Access-Control-Allow-Origin', origin); response.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') { response.status(204).send(''); return; }
    if (request.method !== 'POST') { response.status(405).json({ ok: false, code: 'method-denied', message: 'POST required.' }); return; }
    try {
      if (!(request.get('content-type') || '').toLowerCase().startsWith('application/json')) throw fail('content-type', 'JSON request required.', 415);
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Buffer.byteLength(JSON.stringify(request.body)) > 512 * 1024) throw fail('invalid-body', 'Invalid or oversized editor request.', 400);
      const match = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') || '');
      if (!match) throw fail('unauthenticated', 'Sign in to DEMAC ERP.', 401);
      let token;
      try { token = await verifyToken(match[1], true); } catch { throw fail('unauthenticated', 'Session expired. Sign in again.', 401); }
      const result = await service.execute({ uid: token.uid }, request.body);
      response.status(200).json({ ok: true, result });
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      response.status(status).json({ ok: false, code: typeof error.code === 'string' ? error.code : 'website-editor-error', message: status === 500 ? 'The result could not be verified. Reload or retry the same operation to recover safely.' : error.message });
    }
  };
}
module.exports = { createWebsiteContentHttp };
