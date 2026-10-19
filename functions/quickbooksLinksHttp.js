'use strict';
const { createConnectionService, fault, RETURN } = require('./quickbooksConnectionService');
const { createLinksService } = require('./quickbooksLinksService');
function createLinksHttpHandler({ db, verifyIdToken, getConfig, fetchImpl, now, log = () => {} }) {
  return async (request, response) => {
    response.set('Cache-Control', 'private, no-store'); response.set('Referrer-Policy', 'no-referrer'); response.set('X-Content-Type-Options', 'nosniff');
    try {
      const origin = request.get('origin'), allowed = new URL(RETURN).origin;
      if (origin && origin !== allowed) throw fault(403, 'origin-denied');
      response.set('Access-Control-Allow-Origin', allowed); response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (request.method === 'OPTIONS') return response.status(204).send('');
      if (!['/', ''].includes(request.path)) throw fault(404, 'not-found');
      if (request.method !== 'POST') throw fault(405, 'method-not-allowed');
      const token = /^Bearer (\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw fault(401, 'sign-in-required');
      let uid; try { uid = (await verifyIdToken(token)).uid; } catch { throw fault(401, 'sign-in-required'); }
      if (typeof uid !== 'string' || !uid) throw fault(401, 'sign-in-required');
      const config = getConfig(), { requireOwner } = createConnectionService({ db, config }); await requireOwner(uid);
      if (!/^application\/json(?:;|$)/i.test(request.get('content-type') || '') || Number(request.get('content-length')) > 32768 ||
        request.rawBody?.length > 32768 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw fault(400, 'invalid-link-request');
      return response.json(await createLinksService({ db, config, requireOwner, fetchImpl, now }).execute(uid, request.body));
    } catch (error) {
      const code = error.safeCode || 'link-failed', status = error.safeCode ? error.status : 503;
      log({ code, status }); return response.status(status).json({ error: code });
    }
  };
}
module.exports = { createLinksHttpHandler };
