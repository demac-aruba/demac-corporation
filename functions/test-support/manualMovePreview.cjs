// Local-only harness around the unmodified ERP export and the real office facade.
// No Firebase credentials, cloud database, notification trigger or external transport.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated, resetSynthetic } = require('./manualMoveSynthetic.cjs');
const { createOfficeBookingAuthorityFacade } = require('../officeBookingAuthorityFacade');
assertIsolated();
const db = getFirestore(initializeApp({ projectId: PROJECT }));
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async (token) => {
  if (!['demo-office', 'demo-technician'].includes(token)) throw new Error('Unknown isolated demo identity');
  return { uid: token };
} });
const root = path.resolve(__dirname, '../../apps/erp-next/out');
const allowedActions = new Set(['prepare_appointment_move', 'move_appointment', 'get_appointment', 'list_appointment_attribution', 'list_presets']);
const bootstrap = `<script>
sessionStorage.setItem('demac.erp-next.firebase.session.v1',JSON.stringify({uid:'demo-office',email:'operator@example.invalid',idToken:'demo-office',refreshToken:'demo-only',expiresAt:Date.now()+86400000,displayName:'Operador de prueba'}));
localStorage.setItem('demac-theme','light');
const originalFetch=window.fetch.bind(window);
window.fetch=function(input,init){const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.hostname==='firestore.googleapis.com')return originalFetch('/_demo/firestore'+u.pathname+u.search,init);if(u.hostname==='us-central1-demo-demac-overtime.cloudfunctions.net'&&u.pathname==='/officeBookingAuthority')return originalFetch('/_demo/booking',init);if(u.origin!==location.origin)return Promise.reject(new Error('Isolated preview blocks external requests'));return originalFetch(input,init);};
window.addEventListener('load',()=>{const banner=document.createElement('div');banner.style.cssText='position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:100;background:#fff7de;color:#713c06;padding:10px 16px;border:1px solid #e8b948;border-radius:10px;font:13px system-ui;box-shadow:0 4px 20px #0002;display:flex;align-items:center;gap:12px';banner.innerHTML='<b>Preview aislado · datos sintéticos</b><span>Doble clic en la cita → Van 2, 2:30 PM → REVISAR</span><button id="demo-reset" style="cursor:pointer">Reiniciar escenario</button>';document.body.appendChild(banner);document.getElementById('demo-reset').onclick=async()=>{await originalFetch('/_demo/reset',{method:'POST'});location.href='/scheduling/';};});
</script>`;
async function body(req) { let value = ''; for await (const chunk of req) { value += chunk; if (value.length > 1_000_000) throw new Error('Request too large'); } return value; }
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1', 'localhost'].some((host) => req.headers.host === `${host}:4315`)) return json(res, 403, { error: 'Loopback only' });
    if (req.headers.origin && !['http://127.0.0.1:4315', 'http://localhost:4315'].includes(req.headers.origin)) return json(res, 403, { error: 'Same-origin preview only' });
    const url = new URL(req.url, 'http://127.0.0.1:4315');
    if (url.pathname === '/_demo/reset' && req.method === 'POST') { await resetSynthetic(db); return json(res, 200, { success: true }); }
    if (url.pathname === '/_demo/booking' && req.method === 'POST') {
      const payload = JSON.parse(await body(req));
      if (!allowedActions.has(payload.action)) return json(res, 403, { error: { message: 'Preview limitado al traslado; no se envían comunicaciones.' } });
      const result = await facade.handle({ method: req.method, headers: req.headers, body: payload });
      return json(res, result.status, result.body);
    }
    if (url.pathname.startsWith('/_demo/firestore/')) {
      const targetPath = url.pathname.slice('/_demo/firestore'.length);
      if (!targetPath.startsWith(`/v1/projects/${PROJECT}/databases/(default)/documents`) || !(req.method === 'GET' || req.method === 'POST' && targetPath.endsWith(':runQuery'))) return json(res, 403, { error: 'Read-only isolated projection' });
      const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${targetPath}${url.search}`, { method: req.method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, ...(req.method === 'POST' ? { body: await body(req) } : {}) });
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(await response.text());
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method blocked' });
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) return json(res, 403, { error: 'Invalid path' });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(file);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'" });
    if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace('<head>', '<head>' + bootstrap));
    fs.createReadStream(file).pipe(res);
  } catch (error) { json(res, 500, { error: { message: error.message } }); }
});
resetSynthetic(db).then(() => server.listen(4315, '127.0.0.1', () => console.log('Synthetic ERP preview: http://127.0.0.1:4315/scheduling/')));
