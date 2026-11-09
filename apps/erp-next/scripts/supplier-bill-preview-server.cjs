// Managed-preview fixture only. Uses a synthetic transactional store, never Firebase Admin.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { TransactionalFirestore } = require('../../../functions/test-support/transactionalFirestore');
const { createSupplierBillDraftsHandler } = require('../../../functions/supplierBillDraftsHttp');
const { createSupplierBillDraftService } = require('../../../functions/supplierBillDraftsService');
const root = path.resolve(process.cwd(), 'dist');
const db = new TransactionalFirestore({ 'users/synthetic-owner': { active: true, role: 'admin', name: 'Administrador de prueba' } });
const service = createSupplierBillDraftService({ db, enabled: true });
let dropNext = false;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && ['/api', '/__test/drop', '/__test/conflict', '/__test/finance', '/__test/admin'].includes(url.pathname)) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks); let body;
    try { body = JSON.parse(rawBody.toString() || '{}'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/__test/')) {
      if (url.pathname === '/__test/drop') dropNext = true;
      if (url.pathname === '/__test/finance' || url.pathname === '/__test/admin') db.write('users/synthetic-owner', { active: true, role: url.pathname.endsWith('finance') ? 'accounting' : 'admin', name: 'Usuario de prueba' });
      if (url.pathname === '/__test/conflict') {
        const row = [...db.store.values()].find(value => value.schemaVersion === 1 && value.status === 'draft');
        if (row) await service.execute('synthetic-owner', { action:'save', id:row.id, requestId: require('node:crypto').randomUUID(), expectedVersion:row.version, draft:row.draft, reason:'Cambio de otro operador de prueba' });
      }
      res.writeHead(200, { 'Content-Type':'application/json' }); return res.end('{}');
    }
    const handler = createSupplierBillDraftsHandler({ db, enabled:true, origin:req.headers.origin || 'http://localhost', verifyIdToken:async token => { if (token !== 'synthetic-token') throw Error(); return { uid:'synthetic-owner' }; } });
    const response = { status(code) { res.statusCode=code; return this; }, set(key,value) { res.setHeader(key,value); }, send(value) { res.end(value); }, json(value) {
      if (dropNext && body.action === 'save' && value.accepted) { dropNext=false; res.writeHead(503, {'Content-Type':'application/json'}); res.end('{"error":"draft-request-uncertain"}'); return; }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
    } };
    return handler({ method:req.method,path:'/',get:key=>req.headers[key.toLowerCase()],body,rawBody },response);
  }
  if (req.method !== 'GET' || !['/', '/index.html','/app.js','/app.css'].includes(url.pathname)) { res.writeHead(404); return res.end(); }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'");
  res.end(fs.readFileSync(file));
}).listen(Number(process.env.PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 3000)),'0.0.0.0');
