'use strict';
// Actual previous-main and candidate clients, isolated API/Firestore double.
// Real Firestore rules denial is separately covered by the emulator suite.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..'), ROOT = path.resolve(APP, '../..');
const BASE = '0dc09f3167150ed775018a6f257542961b21cddf';
const tools = process.env.BOOKING_MODAL_TEST_TOOLS, evidence = process.env.BOOKING_MODAL_TEST_OUTPUT;
if (![tools, evidence].every(p => p && path.isAbsolute(p))) throw Error('Absolute isolated tooling/output required');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium } = require(path.join(tools, 'node_modules/playwright'));
const { TransactionalFirestore } = require(path.join(ROOT, 'functions/test-support/transactionalFirestore'));
const { createOfficeBookingAuthorityFacade } = require(path.join(ROOT, 'functions/officeBookingAuthorityFacade'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-cutover-'));
fs.mkdirSync(evidence, { recursive: true });
const session = "({uid:'office',idToken:'office',email:'synthetic@example.invalid'})";
const direct = `export async function listFirestoreCollection(name){return fetch('/direct?collection='+name).then(r=>r.json());} export async function saveFirestoreDocument(){const r=await fetch('/direct',{method:'POST'});throw Error((await r.json()).error);} export const updateFirestoreDocument=saveFirestoreDocument,deleteFirestoreDocument=saveFirestoreDocument;`;
const firebase = `${direct} export const isFirebaseConfigured=true;export async function getValidFirebaseSession(){return ${session};} export async function getFirebaseUserProfile(){return {active:true,role:'office',name:'Synthetic operator'};}export const clearFirebaseSession=async()=>{},signInWithFirebaseEmail=getValidFirebaseSession;`;
async function bundle(kind, old) {
  const legacy = kind === 'legacy', base = legacy ? ROOT : APP;
  const entry = kind === 'finance' ? `import React from 'react';import {createRoot} from 'react-dom/client';import {AppointmentChargesWorkspace} from './components/scheduling/appointment-charges';import './app/globals.css';createRoot(document.getElementById('app')).render(<AppointmentChargesWorkspace currentUserId="office" appointmentId="apt" canManage onBusyChange={()=>{}} onChanged={()=>{}}/>);`
    : legacy ? `import React from 'react';import {createRoot} from 'react-dom/client';import {AppStateProvider,useAppState} from './src/state/AppState';import {CatalogScreen} from './src/screens/CatalogScreen';function Probe(){const state=useAppState();window.__state=state;return <CatalogScreen/>;}createRoot(document.getElementById('app')).render(<AppStateProvider><Probe/></AppStateProvider>);`
    : `import React from 'react';import {createRoot} from 'react-dom/client';import {ServiceCatalogWorkspace} from './components/service-catalog-workspace';import './app/globals.css';createRoot(document.getElementById('app')).render(<ServiceCatalogWorkspace/>);`;
  await build({ absWorkingDir: base, stdin: { contents: entry, loader: 'tsx', resolveDir: base }, outfile: path.join(folder, `${kind}-${old ? 'old' : 'new'}.js`), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-demac-charges' }) }, alias: legacy ? { 'react-native': 'react-native-web' } : {}, plugins: [{ name: 'isolated-previous-client', setup(b) {
      b.onResolve({ filter: /firebase\/(session|principal|client-config|isolated-preview|firestore-rest)$/ }, a => ({ path: path.basename(a.path), namespace: 'stub' }));
      b.onResolve({ filter: /services\/firebase$|^\.\/firebase$/ }, () => ({ path: 'legacy', namespace: 'stub' }));
      b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: 'storage', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ loader: 'js', contents: a.path === 'session' ? `export const loadFirebaseWebSession=()=>${session};export async function requireFirebaseWebSession(){return ${session};}`
        : a.path === 'principal' ? "export async function loadFirebasePrincipal(){return {userId:'office',displayName:'Synthetic operator',role:'office_operator'};}"
        : a.path === 'client-config' ? "export const firebaseClientConfig={projectId:'demo-demac-charges'};"
        : a.path === 'isolated-preview' ? "export const firebaseTransportUrl=()=>'/authority';"
        : a.path === 'storage' ? "export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};"
        : a.path === 'firestore-rest' ? direct : firebase }));
      if (old) b.onLoad({ filter: /\.[jt]sx?$/ }, a => {
        if (!a.path.startsWith(ROOT + '/') || a.path.includes('/node_modules/')) return;
        const relative = path.relative(ROOT, a.path);
        return { contents: execFileSync('git', ['show', `${BASE}:${relative}`], { cwd: ROOT, encoding: 'utf8' }), loader: path.extname(a.path).slice(1), resolveDir: path.dirname(a.path) };
      });
    } }] });
}
async function main() {
  for (const kind of ['finance', 'erp', 'legacy']) for (const old of [true, false]) await bundle(kind, old);
  // Use the actual prior backend to create an old receipt with an old fingerprint.
  const prior = path.join(folder, 'prior'); fs.mkdirSync(prior);
  execFileSync('tar', ['-xf', '-', '-C', prior], { input: execFileSync('git', ['archive', BASE, 'functions'], { cwd: ROOT, maxBuffer: 50e6 }) });
  fs.symlinkSync(path.join(ROOT, 'functions/node_modules'), path.join(prior, 'functions/node_modules'), 'dir');
  const previousCharges = require(path.join(prior, 'functions/appointmentCharges')).createAppointmentCharges;
  const db = new TransactionalFirestore({ 'users/office': { active: true, role: 'office', name: 'Synthetic operator' },
    'appointments/apt': { customerId: 'customer', propertyId: 'property', status: 'confirmed', workOrderIds: [] },
    'services/existing': { name: 'Existing synthetic service', active: true, itemType: 'Servicio', basePrice: 125, durationMinutes: 60, category: 'Servicio', serviceDefinition: { version: 1, bookingCode: 'existing_synthetic', duration: { minutes: 60 } } } });
  const oldApi = previousCharges({ db }), modernApi = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async uid => ({ uid }) });
  const lines = [{ id: 'line', label: 'Existing synthetic service', serviceId: 'existing', quantity: 1 }];
  const quote = await oldApi.execute({ uid: 'office', action: 'quote_appointment_charges', data: { lines } });
  await oldApi.execute({ uid: 'office', action: 'save_appointment_estimate', data: { appointmentId: 'apt', requestId: 'old-estimate-request', expectedVersion: 0, lines, quoteToken: quote.quote.quoteToken } });
  const paid = { action: 'record_appointment_payment', data: { appointmentId: 'apt', requestId: 'old-payment-request', expectedVersion: 1, payment: { method: 'cash', amount: '50' } } };
  await oldApi.execute({ uid: 'office', ...paid });
  const call = input => modernApi.handle({ method: 'POST', headers: { authorization: 'Bearer office' }, body: input });
  const beforeRetry = [...db.store]; const retry = await call(paid);
  assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true); assert.deepEqual([...db.store], beforeRetry);
  const requests = [], directWrites = [], results = [{ name: 'old-committed-payment-exact-retry', status: 'PASS' }];
  // Race the ACTUAL archived handler against the new lease, under synthetic MVCC.
  for (const action of ['save_appointment_estimate', 'finalize_appointment_charges', 'record_appointment_payment', 'void_appointment_payment']) {
    for (const leaseFirst of [false, true]) {
      const raceDb = new TransactionalFirestore(Object.fromEntries(db.store));
      const old = previousCharges({ db: raceDb });
      const modern = createOfficeBookingAuthorityFacade({ db: raceDb, verifyIdToken: async uid => ({ uid }) });
      const before = raceDb.read('appointments/apt').jobCharges;
      const data = { appointmentId: 'apt', requestId: 'cutover-race-request', expectedVersion: before.version,
        lines, quoteToken: quote.quote.quoteToken, note: 'Synthetic reviewed correction', scopeReviewed: true,
        payment: { method: 'cash', amount: '7' }, paymentId: [...raceDb.store.keys()].find(p => p.startsWith('payments/')).split('/')[1], reason: 'Synthetic correction' };
      const acquire = () => modern.handle({ method: 'POST', headers: { authorization: 'Bearer office' }, body: { action: 'acquire_appointment_charge_edit', data: { appointmentId: 'apt', editSessionId: 'race-session-0000000000001' } } });
      if (leaseFirst) {
        const transact = raceDb.runTransaction.bind(raceDb);
        let paused, resume, pause = true;
        const reached = new Promise(resolve => { paused = resolve; }), gate = new Promise(resolve => { resume = resolve; });
        raceDb.runTransaction = fn => transact(async tx => { const value = await fn(tx); if (pause) { pause = false; paused(); await gate; } return value; });
        const pending = old.execute({ uid: 'office', action, data });
        const rejection = assert.rejects(pending, error => error.code === 'charge_conflict');
        await reached; const lease = await acquire(); assert.equal(lease.status, 200);
        const afterLease = structuredClone([...raceDb.store]); resume(); await rejection;
        assert.deepEqual([...raceDb.store], afterLease, 'Old transaction cannot mutate any evidence after the lease');
        assert.deepEqual(raceDb.read('appointments/apt').jobCharges, { ...before, version: before.version + 1 });
      } else {
        await old.execute({ uid: 'office', action, data });
        const committed = raceDb.read('appointments/apt').jobCharges;
        const lease = await acquire(); assert.equal(lease.body.edit.financialVersion, committed.version + 1);
        assert.deepEqual(raceDb.read('appointments/apt').jobCharges, { ...committed, version: committed.version + 1 });
        const afterLease = structuredClone([...raceDb.store]);
        assert.equal((await old.execute({ uid: 'office', action, data })).replayed, true);
        assert.deepEqual([...raceDb.store], afterLease, 'Exact committed retry creates no duplicate');
      }
      results.push({ name: `old-inflight-${action}-${leaseFirst ? 'lease-wins' : 'payment-wins'}`, status: 'PASS' });
    }
  }

  const server = http.createServer(async (req, res) => { try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/authority') { let raw = ''; for await (const part of req) raw += part; const input = JSON.parse(raw); requests.push(input); const result = await modernApi.handle({ method: 'POST', headers: req.headers, body: input }); res.statusCode = result.status; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(result.body)); }
    if (url.pathname === '/direct') { res.setHeader('content-type', 'application/json'); if (req.method !== 'GET') { directWrites.push(req.method); res.statusCode = 403; return res.end(JSON.stringify({ error: 'Missing or insufficient permissions.' })); }
      const collection = url.searchParams.get('collection'); return res.end(JSON.stringify(collection === 'services' ? [{ id: 'existing', ...db.read('services/existing') }] : collection === 'clients' ? [{ id: 'customer', name: 'Synthetic customer' }] : [])); }
    if (/\.(js|css)$/.test(url.pathname)) { const target = path.join(folder, path.basename(url.pathname)); res.setHeader('content-type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'); return res.end(fs.existsSync(target) ? fs.readFileSync(target) : ''); }
    const key = /^(finance|erp|legacy)-(old|new)$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : 'finance-old';
    res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html><head><link rel="stylesheet" href="/${key}.css"></head><body><div id="app"></div><script src="/${key}.js"></script></body></html>`);
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: e.message } })); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.BOOKING_MODAL_CHROMIUM ? { executablePath: process.env.BOOKING_MODAL_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }), errors = [], external = [];
  await context.route('**/*', r => { if (new URL(r.request().url()).origin === origin) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await context.addInitScript(() => { const original = window.fetch.bind(window); window.fetch = (url, options) => original(typeof url === 'string' && url.includes('demo-demac-charges.cloudfunctions.net/officeBookingAuthority') ? '/authority' : url, options); });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  try {
    for (const action of ['save_appointment_estimate', 'finalize_appointment_charges', 'record_appointment_payment', 'void_appointment_payment']) {
      await page.goto(origin + '/finance-old'); await page.getByRole('button', { name: 'Registrar pago', exact: true }).waitFor(); const before = structuredClone([...db.store]);
      if (action === 'record_appointment_payment') { await page.getByRole('button', { name: 'Registrar pago', exact: true }).click(); await page.getByLabel('Monto recibido (Afl.)', { exact: true }).fill('25'); await page.getByRole('button', { name: 'Guardar pago', exact: true }).click(); }
      else if (action === 'void_appointment_payment') { page.once('dialog', d => d.accept('Synthetic void request')); await page.getByRole('button', { name: 'Anular registro', exact: true }).click(); }
      else { await page.getByRole('button', { name: action === 'save_appointment_estimate' ? 'Editar proyectado' : 'Confirmar monto final', exact: true }).click(); await page.getByLabel('Motivo / detalle del alcance', { exact: false }).fill('Retained old-session draft'); if (action === 'finalize_appointment_charges') await page.getByLabel('Revisé los trabajos realizados', { exact: false }).check(); await page.getByRole('button', { name: action === 'save_appointment_estimate' ? 'Guardar proyección' : 'Confirmar monto final', exact: true }).click(); }
      await page.getByRole('alert').filter({ hasText: 'Actualiza la página del ERP' }).waitFor(); assert.deepEqual([...db.store], before);
      if (action === 'record_appointment_payment') assert.equal(await page.getByLabel('Monto recibido (Afl.)', { exact: true }).inputValue(), '25');
      else if (action !== 'void_appointment_payment') assert.equal(await page.getByLabel('Motivo / detalle del alcance', { exact: false }).inputValue(), 'Retained old-session draft');
      assert.ok(requests.some(r => r.action === action && !r.data.editSessionId)); results.push({ name: 'old-session-' + action, status: 'PASS' });
    }
    for (const kind of ['erp', 'legacy']) {
      await page.goto(origin + '/' + kind + '-old'); const before = structuredClone([...db.store]), count = directWrites.length;
      if (kind === 'erp') { await page.getByRole('button', { name: /Existing synthetic service/ }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Description', { exact: false }).fill('Old catalog draft'); await page.getByRole('button', { name: 'Save canonical item', exact: true }).click(); }
      else { await page.getByText('Existing synthetic service', { exact: true }).first().click(); await page.getByText('Editar', { exact: true }).click(); await page.getByPlaceholder('Ej. Servicio estándar 18,000 BTU', { exact: true }).fill('Old legacy draft'); await page.getByText('Guardar artículo', { exact: true }).click(); }
      await page.getByText(kind === 'erp' ? 'Missing or insufficient permissions.' : 'Firebase rechazó la operación.', { exact: false }).first().waitFor(); assert.deepEqual([...db.store], before); assert.equal(directWrites.length, count + 1);
      assert.equal(await (kind === 'erp' ? page.getByLabel('Description', { exact: false }) : page.getByPlaceholder('Ej. Servicio estándar 18,000 BTU', { exact: true })).inputValue(), kind === 'erp' ? 'Old catalog draft' : 'Old legacy draft');
      if (kind === 'legacy') assert.equal(await page.evaluate(() => window.__state.clients.length), 1);
      await page.screenshot({ path: path.join(evidence, 'old-' + kind + '-draft-preserved.png'), fullPage: true });
      results.push({ name: 'old-' + kind + '-catalog-direct-write-denied-draft-retained', status: 'PASS' });
      // Deliberate reload after the test has inspected the old draft, never an automatic UI refresh.
      await page.goto(origin + '/' + kind + '-new');
      if (kind === 'erp') { await page.getByRole('button', { name: /Existing synthetic service/ }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Description', { exact: false }).fill('Updated via new ' + kind); await page.getByRole('button', { name: 'Save canonical item', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
      else { await page.getByText('Existing synthetic service', { exact: true }).first().click(); await page.getByText('Editar', { exact: true }).click(); await page.getByPlaceholder('Ej. Servicio estándar 18,000 BTU', { exact: true }).fill('New legacy service'); await page.getByText('Guardar artículo', { exact: true }).click(); await page.getByText('Editar artículo', { exact: true }).waitFor({ state: 'hidden' }); }
      assert.equal(directWrites.length, count + 1); assert.match(db.read('services/existing').catalogRevision, /^[0-9a-f-]{36}$/); results.push({ name: 'new-' + kind + '-governed-save', status: 'PASS' });
    }
    await page.goto(origin + '/finance-new'); await page.getByText('Edición reservada para ti en esta cita.', { exact: true }).waitFor(); await page.getByLabel('Monto recibido (Afl.)', { exact: true }).fill('25'); await page.getByRole('button', { name: 'Registrar pago', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Pago registrado' }).waitFor();
    assert.equal(db.read('appointments/apt').jobCharges.receivedCents, 7500); assert.equal([...db.store.keys()].filter(k => k.startsWith('payments/')).length, 2);
    results.push({ name: 'new-session-lease-payment', status: 'PASS' }); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    fs.writeFileSync(path.join(evidence, 'cutover-results.json'), JSON.stringify({ base: BASE, results }, null, 2)); console.log('PASS ' + results.length + ' previous/current-client cutover cases');
  } catch (error) { await page.screenshot({ path: path.join(evidence, 'cutover-failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-4000)); throw error; }
  finally { await context.close(); await browser.close(); await new Promise(r => server.close(r)); fs.rmSync(folder, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
