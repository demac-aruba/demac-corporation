'use strict';
const { createSupplierBillDraftService, fault } = require('./supplierBillDraftsService');
function createSupplierBillDraftsHandler({ db, verifyIdToken, enabled = false, origin = 'https://demac-aruba.com', now, log = () => {} }) {
  const service = createSupplierBillDraftService({ db, enabled, now });
  return async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    try {
      if (request.get('origin') && request.get('origin') !== origin) throw fault(403, 'origin-denied');
      response.set('Access-Control-Allow-Origin', origin); response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (request.method === 'OPTIONS') return response.status(204).send('');
      if (!['/', ''].includes(request.path)) throw fault(404, 'not-found');
      if (request.method !== 'POST') throw fault(405, 'method-not-allowed');
      const token = /^Bearer (\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw fault(401, 'sign-in-required');
      let uid;
      try { uid = (await verifyIdToken(token, true)).uid; } catch { throw fault(401, 'sign-in-required'); }
      if (!/^application\/json(?:;|$)/i.test(request.get('content-type') || '') || Number(request.get('content-length')) > 300000 || request.rawBody?.length > 300000 || Buffer.byteLength(JSON.stringify(request.body) || '') > 300000) throw fault(400, 'invalid-request');
      return response.json(await service.execute(uid, request.body));
    } catch (error) {
      const status = error.safeCode ? error.status : 503, code = error.safeCode || 'draft-request-uncertain';
      log({ status, code });
      return response.status(status).json({ error: code });
    }
  };
}
module.exports = { createSupplierBillDraftsHandler };
