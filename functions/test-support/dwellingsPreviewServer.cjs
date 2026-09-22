// No Firebase trigger, queue consumer, scheduler, billing or external delivery worker is loaded.
const { PROJECT, assertIsolated } = require('./dwellingsIsolation.cjs');
assertIsolated();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
const { createOfficeBookingAuthorityFacade } = require('../officeBookingAuthorityFacade');
const { fieldOperationsAuthority } = require('../fieldOperationsAuthority');
const sessions = new Map();
const refreshTokens = new Set();
const auth = getAuth();
const db = getFirestore();
// Durable emulator snapshots stay local; this endpoint is never routed publicly.
const checkpointPath = path.resolve(__dirname, '../../../dwellings-emulator-data');
let checkpointBusy = false;
async function checkpoint() {
  if (checkpointBusy) return;
  checkpointBusy = true;
  try {
    const response = await fetch('http://127.0.0.1:4497/_admin/export', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: checkpointPath, initiatedBy: 'dwellings-preview', targets: ['auth','firestore','storage'] }) });
    if (!response.ok) throw new Error('Emulator snapshot failed.');
  } catch { console.error('Preview checkpoint failed. Keep emulators running and retry the local export.'); }
  finally { checkpointBusy = false; }
}
setInterval(checkpoint, 30000).unref();
const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '');
async function verify(token) {
  // Emulator JWTs are unsigned. Only tokens minted through this password-authenticated
  // gateway are accepted, preventing forged emulator tokens from reaching the backend.
  if (!sessions.has(token) || sessions.get(token) < Date.now()) throw new Error('Preview session is not authenticated.');
  return auth.verifyIdToken(token, true);
}
const office = createOfficeBookingAuthorityFacade({ db, verifyIdToken: verify });
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/__preview/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use('/__preview/firebase', express.raw({ type: () => true, limit: '15mb' }));
const upstream = async (req, res, target, body = req.body) => {
  const response = await fetch(target, { method: req.method, headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) }, ...(req.method === 'GET' ? {} : { body }) });
  res.status(response.status).set('Content-Type', response.headers.get('content-type') || 'application/json').send(Buffer.from(await response.arrayBuffer()));
};
app.use('/__preview/firebase', async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://preview.invalid');
    const host = parsed.pathname.split('/')[1];
    const pathname = parsed.pathname.slice(host.length + 1);
    if (host === 'identitytoolkit.googleapis.com' || host === 'securetoken.googleapis.com') {
      if (req.method !== 'POST' || !['/v1/accounts:signInWithPassword', '/v1/token'].includes(pathname)) return res.status(403).json({ error: { message: 'This preview only permits provisioned test sign-in.' } });
      const input = JSON.parse(req.body.toString());
      if (pathname === '/v1/token' && !refreshTokens.has(input.refresh_token)) return res.status(401).json({ error: { message: 'Sign in to the preview again.' } });
      const response = await fetch(`http://127.0.0.1:9297/${host}${pathname}?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json();
      if (response.ok) {
        const token = result.idToken || result.id_token;
        const refresh = result.refreshToken || result.refresh_token;
        if (!token || !refresh) throw new Error('Invalid emulator authentication response.');
        sessions.set(token, Date.now() + 3500_000); refreshTokens.add(refresh);
      }
      return res.status(response.status).json(result);
    }
    const identity = await verify(bearer(req));
    if (host === `us-central1-${PROJECT}.cloudfunctions.net`) {
      if (req.method !== 'POST') return res.sendStatus(405);
      req.body = JSON.parse(req.body.toString());
      if (/^(send_|queue_)/.test(req.body.action || '')) return res.status(403).json({ error: { message: 'External delivery is disabled in this isolated preview.' } });
      if (pathname === '/officeBookingAuthority') { const result = await office.handle(req); return res.status(result.status).json(result.body); }
      if (pathname === '/fieldOperationsAuthority') return fieldOperationsAuthority(req, res);
      return res.sendStatus(403);
    }
    if (host === 'firestore.googleapis.com') {
      if (!pathname.startsWith(`/v1/projects/${PROJECT}/databases/(default)/documents`)) return res.sendStatus(403);
      if (!(req.method === 'GET' || (req.method === 'POST' && pathname.endsWith(':runQuery')))) return res.sendStatus(403);
      return upstream(req, res, `http://127.0.0.1:8297${pathname}${parsed.search}`);
    }
    if (host === 'firebasestorage.googleapis.com') {
      if (!pathname.startsWith(`/v0/b/${PROJECT}.appspot.com/o`)) return res.sendStatus(403);
      const object = parsed.searchParams.get('name') || decodeURIComponent(pathname.split('/o/')[1] || '');
      if (!object.startsWith('field-evidence/') || !['GET', 'POST'].includes(req.method)) return res.sendStatus(403);
      return upstream(req, res, `http://127.0.0.1:9397${pathname}${parsed.search}`);
    }
    return res.sendStatus(403);
  } catch (error) { return res.status(401).json({ error: { message: 'Preview request denied. Sign in again if the session expired.' } }); }
});
app.get('/__preview/health', (_req, res) => res.json({ isolated: true, project: PROJECT, workers: false }));
const output = path.resolve(__dirname, '../../apps/erp-next/out');
if (!fs.existsSync(path.join(output, 'index.html'))) throw new Error('Build the isolated frontend first.');
const chunks = fs.readdirSync(path.join(output, '_next/static'), { recursive: true }).filter((name) => name.endsWith('.js'));
const bundle = chunks.map((name) => fs.readFileSync(path.join(output, '_next/static', name), 'utf8')).join('\n');
if (!bundle.includes(PROJECT) || !bundle.includes('/__preview/firebase/') || bundle.includes('AIza')) throw new Error('Refusing frontend without isolated Firebase configuration.');
app.get('/', (_req, res) => res.redirect('/login'));
app.get('/__preview/notice.js', (_req, res) => res.type('text/javascript').send("document.documentElement.dataset.preview='synthetic';const n=document.createElement('div');n.textContent='DEMO · isolated synthetic data · external delivery disabled';n.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#122e38;color:white;text-align:center;padding:6px;font:12px system-ui;z-index:2147483647;pointer-events:none';document.body.appendChild(n);"));
app.use((req, res, next) => {
  if (req.method !== 'GET' || path.extname(req.path)) return next();
  const target = path.resolve(output, '.' + req.path, 'index.html');
  if (!target.startsWith(output + path.sep) || !fs.existsSync(target)) return next();
  res.type('html').send(fs.readFileSync(target, 'utf8').replace('</body>', '<script src="/__preview/notice.js"></script></body>'));
});
app.use(express.static(output, { extensions: ['html'], dotfiles: 'deny' }));
app.listen(4397, '127.0.0.1', () => console.log('Synthetic preview gateway listening on http://127.0.0.1:4397'));
