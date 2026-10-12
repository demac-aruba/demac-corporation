'use strict';

const { createSandboxService, validateConfig, fault } = require('./quickbooksSandboxService');

function createSandboxHttpHandler({ db, verifyIdToken, getConfig, fetchImpl, now, log = () => {} }) {
  return async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    response.set('Referrer-Policy', 'no-referrer');
    response.set('X-Content-Type-Options', 'nosniff');
    let config;
    try {
      const rawConfig = getConfig();
      // Only the configured ERP origin may use authenticated JSON endpoints.
      const origin = request.get('origin');
      const allowedOrigin = new URL(rawConfig.returnUrl).origin;
      if (origin && origin !== allowedOrigin) throw fault(403, 'origin-denied');
      response.set('Access-Control-Allow-Origin', allowedOrigin);
      response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') return response.status(204).send('');
      const callback = request.path === '/callback';
      if (callback) {
        if (request.method !== 'GET') throw fault(405, 'method-not-allowed');
        config = validateConfig(rawConfig);
        const result = await createSandboxService({ db, config, fetchImpl, now }).callback(request.query || {});
        const fragment = new URLSearchParams(result.ticket ? { qbo_ticket: result.ticket } : { qbo_error: result.error });
        response.set('Location', `${config.returnUrl}#${fragment}`);
        return response.status(302).send('');
      }
      if (request.path !== '/' && request.path !== '') throw fault(404, 'not-found');
      if (!['GET', 'POST'].includes(request.method)) throw fault(405, 'method-not-allowed');
      const token = /^Bearer (\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw fault(401, 'sign-in-required');
      let uid;
      try { uid = (await verifyIdToken(token)).uid; } catch { throw fault(401, 'sign-in-required'); }
      if (typeof uid !== 'string' || !uid) throw fault(401, 'sign-in-required');
      const service = createSandboxService({ db, config: rawConfig, fetchImpl, now });
      await service.requireAdmin(uid);
      try { config = validateConfig(rawConfig); } catch {
        if (request.method === 'GET') return response.json({ configured: false, environment: 'sandbox', syncEnabled: false, connection: null });
        throw fault(503, 'not-configured');
      }
      if (request.method === 'GET') return response.json(await service.status(uid));
      if (!/^application\/json(?:;|$)/i.test(request.get('content-type') || '') || Number(request.get('content-length')) > 8192 ||
        (request.rawBody && request.rawBody.length > 8192)) throw fault(400, 'invalid-request');
      const body = request.body || {};
      if (body.action === 'start') return response.json(await service.start(uid, body.proofHash));
      if (body.action === 'finish') return response.json(await service.finish(uid, body.ticket, body.proof));
      throw fault(400, 'invalid-request');
    } catch (error) {
      const code = error.safeCode || 'connection-failed';
      const status = error.safeCode ? error.status : 503;
      // Never log request URLs, provider bodies, exception messages or OAuth parameters.
      log({ code, status });
      return response.status(status).json({ error: code });
    }
  };
}

module.exports = { createSandboxHttpHandler };
