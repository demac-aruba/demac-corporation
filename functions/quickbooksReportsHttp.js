'use strict';
const { createConnectionService, fault, RETURN } = require('./quickbooksConnectionService');
const { createReportsService } = require('./quickbooksReportsService');
const { reportValidationIssue } = require('./quickbooksReportsFormat');
function createReportsHttpHandler({ db, verifyIdToken, getConfig, fetchImpl, now, log = () => {} }) {
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
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (request.method === 'OPTIONS') return response.status(204).send('');
      if (!['/', '', '/catalog'].includes(request.path)) throw fault(404, 'not-found');
      if (request.method !== 'POST') throw fault(405, 'method-not-allowed');
      const token = /^Bearer (\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw fault(401, 'sign-in-required');
      let uid;
      try { uid = (await verifyIdToken(token)).uid; } catch { throw fault(401, 'sign-in-required'); }
      if (typeof uid !== 'string' || !uid) throw fault(401, 'sign-in-required');
      const config = getConfig();
      const { requireOwner } = createConnectionService({ db, config });
      await requireOwner(uid);
      if (!/^application\/json(?:;|$)/i.test(request.get('content-type') || '') || Number(request.get('content-length')) > 8192 ||
        request.rawBody?.length > 8192 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw fault(400, 'invalid-report-request');
      const service = createReportsService({ db, config, requireOwner, fetchImpl, now });
      return response.json(await service[request.path === '/catalog' ? 'catalog' : 'report'](uid, request.body));
    } catch (error) {
      const code = error.safeCode || 'report-failed'; const status = error.safeCode ? error.status : 503;
      const validationIssue = reportValidationIssue(error);
      const diagnostic = validationIssue ? { validationIssue } : {};
      log({ code, status, ...diagnostic }); return response.status(status).json({ error: code, ...diagnostic });
    }
  };
}
module.exports = { createReportsHttpHandler };
