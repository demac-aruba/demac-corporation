'use strict';
const { createMessageCopySettings } = require('./messageCopySettings');
function allowedOrigin(origin) {
  return ['https://demac-aruba.com', 'https://www.demac-aruba.com'].includes(origin)
    || /^https:\/\/demac-corporation(?:-web)?-[a-z0-9-]+-demac-corporation\.vercel\.app$/.test(origin || '');
}
function createMessageCopyHandler({ db, verifyIdToken }) {
  const service = createMessageCopySettings({ db });
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('origin');
    if (origin && !allowedOrigin(origin)) return res.status(403).json({ error: 'origin-denied' });
    if (origin) res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
    const token = /^Bearer (\S+)$/i.exec(req.get('authorization') || '')?.[1];
    if (!token) return res.status(401).json({ error: 'sign-in-required' });
    let uid;
    try { uid = (await verifyIdToken(token, true)).uid; } catch { return res.status(401).json({ error: 'sign-in-required' }); }
    if (typeof uid !== 'string' || !uid) return res.status(401).json({ error: 'sign-in-required' });
    if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > 12000) return res.status(400).json({ error: 'invalid-request' });
    try { return res.json(await service.execute(uid, req.body)); }
    catch (error) {
      const known = [400, 401, 403, 409].includes(error.status);
      return res.status(known ? error.status : 500).json({ error: known ? error.code : 'settings-unavailable' });
    }
  };
}
module.exports = { createMessageCopyHandler, allowedOrigin };
