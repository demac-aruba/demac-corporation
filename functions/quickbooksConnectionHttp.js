'use strict';
const { createConnectionService, fault, RETURN } = require('./quickbooksConnectionService');
function createConnectionHttpHandler({ db, verifyIdToken, getConfig, fetchImpl, now, log = () => {} }) {
  return async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    response.set('Referrer-Policy', 'no-referrer');
    response.set('X-Content-Type-Options', 'nosniff');
    try {
      const origin = request.get('origin');
      if (origin && origin !== new URL(RETURN).origin) throw fault(403, 'origin-denied');
      response.set('Access-Control-Allow-Origin', new URL(RETURN).origin);
      response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') return response.status(204).send('');
      const service = createConnectionService({ db, config: getConfig(), fetchImpl, now, log });
      if (request.path === '/callback') {
        if (request.method !== 'GET') throw fault(405, 'method-not-allowed');
        const result = await service.callback(request.query || {});
        response.set('Location', `${RETURN}#${new URLSearchParams(result.ticket ? { qbo_production_ticket: result.ticket } : { qbo_production_error: result.error })}`);
        return response.status(302).send('');
      }
      if (request.path !== '/' && request.path !== '') throw fault(404, 'not-found');
      if (!['GET', 'POST'].includes(request.method)) throw fault(405, 'method-not-allowed');
      const token = /^Bearer (\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw fault(401, 'sign-in-required');
      let uid;
      try { uid = (await verifyIdToken(token)).uid; } catch { throw fault(401, 'sign-in-required'); }
      if (typeof uid !== 'string' || !uid) throw fault(401, 'sign-in-required');
      await service.requireOwner(uid);
      if (request.method === 'GET') return response.json(await service.status(uid));
      if (!/^application\/json(?:;|$)/i.test(request.get('content-type') || '') || Number(request.get('content-length')) > 8192 ||
        request.rawBody?.length > 8192 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw fault(400, 'invalid-request');
      const body = request.body;
      const fields = { start: ['action', 'proofHash'], finish: ['action', 'ticket', 'proof'], disconnect: ['action', 'version'] };
      if (!Object.hasOwn(fields, body.action) || Object.keys(body).some(key => !fields[body.action].includes(key))) throw fault(400, 'invalid-request');
      if (body.action === 'start') return response.json(await service.start(uid, body.proofHash));
      if (body.action === 'finish') return response.json(await service.finish(uid, body.ticket, body.proof));
      return response.json(await service.disconnect(uid, body.version));
    } catch (error) {
      const code = error.safeCode || 'connection-failed'; const status = error.safeCode ? error.status : 503;
      log({ code, status }); return response.status(status).json({ error: code });
    }
  };
}
module.exports = { createConnectionHttpHandler };
