'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const ROOT = path.resolve(__dirname, '../../..'), APP = path.join(ROOT, 'apps/erp-next'), PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Loopback emulators required.');
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Credential-free demo project required.');
const fromFunctions = require('node:module').createRequire(path.join(ROOT, 'functions/package.json'));
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app'), { getFirestore } = fromFunctions('firebase-admin/firestore'), { getAuth } = fromFunctions('firebase-admin/auth');
const { createOfficeBookingAuthorityFacade } = require(path.join(ROOT, 'functions/officeBookingAuthorityFacade'));
const { interruptResponse } = require('./projects-central-response-fault.cjs');
const { build } = require(path.join(process.env.PROJECTS_UI_TOOLS, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(process.env.PROJECTS_UI_TOOLS, 'node_modules/playwright'));
const app = initializeApp({ projectId: PROJECT }, 'lifecycle-browser'); const db = getFirestore(app), auth = getAuth(app);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: token => auth.verifyIdToken(token, true), projectsEnabled: false });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-lifecycle-'));
const evidence = path.join(ROOT, 'office-lifecycle-evidence'); fs.mkdirSync(evidence, { recursive: true });
let actor, current, sequence = 0; const next = () => `UI-LIFECYCLE-${++sequence}`; const traces = [];
const call = (action, data) => facade.handle({ method: 'POST', headers: { authorization: `Bearer ${actor.idToken}` }, body: { action, data } });
function success(result) { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://local');
  if (url.pathname === '/office') {
    try {
      let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 65536) throw Error('Oversized fixture command'); }
      const body = JSON.parse(raw); current.calls.push(body);
      const start = performance.now(); const result = await facade.handle({ method: request.method, headers: request.headers, body });
      current.timings.push({ action: body.action, milliseconds: performance.now() - start, status: result.status });
      if (['cancel_appointment', 'reschedule_appointment'].includes(body.action) && result.status === 200) {
        current.commits += result.body.replayed ? 0 : 1; current.replays += result.body.replayed ? 1 : 0;
        if (current.original) assert.equal(raw, current.original, 'Recovery sends the original exact command'); else current.original = raw;
        if (!current.release) {
          if (current.invalidAck) return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...result.body, appointment: { id: 'WRONG' } }));
          return interruptResponse(response);
        }
      }
      response.writeHead(result.status, { 'content-type': 'application/json' }).end(JSON.stringify(result.body));
    } catch (error) { current.errors.push(error.message); response.writeHead(500).end('{}'); }
    return;
  }
  if (['/app.js', '/app.css'].includes(url.pathname)) { response.setHeader('content-type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'); return response.end(fs.readFileSync(path.join(out, url.pathname.slice(1)))); }
  response.setHeader('content-type', 'text/html');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'");
  response.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>:root{--surface:#fff;--surface-2:#f6f7fa;--text:#172337;--border:#ccc;--line:#ddd;--muted:#536174;--brand:#2660c2;--brand-soft:#ecf2ff}body{font:16px Arial;margin:0}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
});
async function readState(id) {
  const appointment = (await db.collection('appointments').doc(id).get()).data();
  const orders = await db.getAll(...appointment.workOrderIds.map(value => db.collection('workOrders').doc(value)));
  const locks = await db.getAll(...appointment.capacityLockIds.map(value => db.collection('bookingCapacityLocks').doc(value)));
  return { appointment, orders: orders.map(row => row.data()), locks: locks.map(row => row.data()) };
}
async function fixture(scenario) {
  const customerId = next(), propertyId = next();
  const customer = { id: customerId, name: 'Synthetic lifecycle customer', active: true }, property = { id: propertyId, clientId: customerId, name: 'Synthetic site', address: 'Synthetic site', operationalZone: 'Oranjestad', active: true };
  await db.collection('clients').doc(customerId).set(customer); await db.collection('properties').doc(propertyId).set(property);
  const date = new Date(Date.UTC(2098, 0, 6 + sequence * 7)).toISOString().slice(0, 10);
  const offered = success(await call('check_availability', { requestId: next(), customerId, propertyId, requestedDate: date, requestedTime: '08:30', requiredVanId: 'VAN-1',
    workLines: [{ id: 'WORK', presetId: 'standard_service', serviceId: 'LIFECYCLE-SERVICE', quantity: 2, customerFacingDescription: 'Synthetic original scope', technicianInstructions: 'Synthetic original instructions' }] }));
  assert.ok(offered.available, JSON.stringify(offered));
  const created = success(await call('create_appointment', { requestId: next(), offerId: offered.offer.id, offerVersion: offered.offer.version, optionId: offered.options[0].id }));
  const state = await readState(created.appointmentId);
  return { scenario, appointmentId: created.appointmentId, customer, property, orders: state.orders.map((row, index) => ({ ...row, id: state.appointment.workOrderIds[index] })),
    calls: [], timings: [], errors: [], commits: 0, replays: 0, release: false, invalidAck: scenario === 'invalid-ack' };
}
async function main() {
  actor = await (await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'lifecycle-ui@example.test', password: 'synthetic-password-123', returnSecureToken: true }) })).json(); assert.ok(actor.idToken);
  await db.collection('users').doc(actor.localId).set({ role: 'admin', active: true });
  await db.collection('businessSettings').doc('appointment-work-presets').set({ presets: [{ id: 'standard_service', label: 'Synthetic service', serviceId: 'LIFECYCLE-SERVICE', durationMinutesPerUnit: 60, active: true }] });
  await db.collection('services').doc('LIFECYCLE-SERVICE').set({ name: 'Synthetic service', durationMinutes: 60, active: true });
  await db.collection('vans').doc('VAN-1').set({ name: 'Van 1', active: true, responsibleStaffId: 'LIFECYCLE-DRIVER' });
  await db.collection('staffProfiles').doc('LIFECYCLE-DRIVER').set({ active: true, availability: 'Disponible', canDriveVan: true });
  const stubs = {
    'appointment-communication-panel': 'export function AppointmentCommunicationPanel(){return null}',
    'visual-schedule-day-cache': 'export function peekVisualScheduleDay(dateKey){return {dateKey,appointments:[],capacityState:null,loadedAt:Date.now()}}export async function loadVisualScheduleDay(dateKey){return peekVisualScheduleDay(dateKey)}export function prefetchAdjacentVisualScheduleDays(){}',
  };
  await build({ absWorkingDir: APP, stdin: { loader: 'tsx', resolveDir: APP, contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LiveAppointmentEditPanel}from'./components/scheduling/live-appointment-edit-panel';import{LiveAppointmentDetailsDrawer}from'./components/scheduling/live-appointment-details-drawer';import{AppointmentRescheduleSchedulePicker}from'./components/scheduling/remaining-work-schedule-picker';import{OfficeLifecycleRecovery}from'./components/scheduling/office-lifecycle-recovery';import{projectLiveSchedulingAppointments}from'./lib/live-scheduling';const f=window.__fixture;const appointment=projectLiveSchedulingAppointments(f.orders,[f.customer],[f.property],[{id:'VAN-1',name:'Van 1'}])[0];function Harness(){const[done,setDone]=useState(false);const saved=()=>setDone(true);return <><OfficeLifecycleRecovery onRecovered={saved}/>{done?<h1>Verified change</h1>:f.scenario.startsWith('cancel')?<LiveAppointmentDetailsDrawer appointment={appointment} onClose={()=>{}} onChanged={saved}/>:f.scenario.startsWith('reschedule')?<AppointmentRescheduleSchedulePicker appointment={appointment} onClose={()=>{}} onRescheduled={saved}/>:<LiveAppointmentEditPanel appointment={appointment} onBack={()=>{}} onSaved={saved}/>}</>}createRoot(document.getElementById('app')).render(<Harness/>);` },
    outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT }) },
    plugins: [{ name: 'presentation-fixtures-only', setup(builder) { builder.onResolve({ filter: /.*/ }, args => { const key = path.basename(args.path); if (stubs[key]) return { path: key, namespace: 'fixture' }; }); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP })); } }],
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const scenario of ['edit', 'cancel', 'reschedule', 'stale', 'cancel-stale', 'invalid-ack', 'edit-cleared', 'reschedule-cleared', 'edit-generated', 'edit-generated-add']) {
        current = await fixture(scenario); const context = await browser.newContext({ viewport: { width: scenario === 'edit' ? 390 : 1280, height: 900 }, serviceWorkers: 'block' });
        await context.addInitScript(({ fixture, session }) => {
          window.__fixture = fixture; sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify(session));
          const nativeFetch = window.fetch.bind(window); window.fetch = (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url, location.href);
            if (url.hostname.endsWith('.cloudfunctions.net') && url.pathname === '/officeBookingAuthority') return nativeFetch('/office', init);
            if (url.origin === location.origin) return nativeFetch(input, init);
            throw Error('Unexpected network access in isolated lifecycle test');
          };
        }, { fixture: current, session: { uid: actor.localId, email: actor.email, idToken: actor.idToken, refreshToken: actor.refreshToken, expiresAt: Date.now() + 3600000 } });
        const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
        if (scenario === 'cancel-stale') await db.collection('appointments').doc(current.appointmentId).set({ date: '2099-12-20' }, { merge: true });
        if (scenario.endsWith('-cleared')) {
          const state = await readState(current.appointmentId);
          const cleared = { ...state.appointment.workLines[0], customerFacingDescription: '', technicianInstructions: '' };
          current.expectedLines = [{ ...cleared, quantity: 1 }, { ...cleared, id: 'WORK-2', quantity: 1, customerFacingDescription: 'Current second scope', technicianInstructions: 'Current second instructions' }];
          // The board still contains the old text; the GET must own both display and input.
          await db.collection('appointments').doc(current.appointmentId).set({ workLines: current.expectedLines }, { merge: true });
        }
        if (scenario.startsWith('edit-generated')) {
          const state = await readState(current.appointmentId);
          const preset = success(await call('list_presets', {})).presets.find(row => row.id === state.appointment.workLines[0].presetId);
          assert.ok(preset);
          current.legacyDescription = `${preset.label} × 2`;
          const line = { ...state.appointment.workLines[0], customerFacingDescription: current.legacyDescription };
          await db.collection('appointments').doc(current.appointmentId).set({ workLines: [line] }, { merge: true });
          current.expectedLines = [{ ...line, quantity: 3, customerFacingDescription: `Scheduled work: 3 × ${preset.label}.` }];
          if (scenario === 'edit-generated-add') {
            delete current.expectedLines;
            current.expectedGeneratedText = `Scheduled work: 2 × ${preset.label}; 1 × Check Up.`;
          }
        }
        await page.goto(origin); const baseline = await readState(current.appointmentId);
        if (scenario.startsWith('cancel')) {
          if (scenario === 'cancel-stale') {
            await page.getByRole('region', { name: 'Current canonical appointment' }).getByText(/2099-12-20/).waitFor();
            await db.collection('appointments').doc(current.appointmentId).set({ notes: 'A later concurrent change' }, { merge: true });
          }
          await page.getByRole('button', { name: 'Cancel Appointment', exact: true }).click();
          await page.getByRole('combobox').selectOption({ index: 1 });
          await page.getByRole('button', { name: 'Cancel Appointment', exact: true }).last().click();
          if (scenario === 'cancel-stale') {
            await page.getByText(/changed after it was loaded/).first().waitFor();
            assert.equal(current.commits, 0); assert.deepEqual((await readState(current.appointmentId)).orders, baseline.orders);
            traces.push({ engineName, scenario, passed: true }); await context.close(); continue;
          }
        } else if (scenario.startsWith('reschedule')) {
          if (scenario.endsWith('-cleared')) await page.getByRole('region', { name: 'Current canonical appointment' }).getByText('No custom work description recorded.', { exact: true }).waitFor();
          await page.getByRole('button', { name: /CHOOSE AS PRIMARY.*Van 1/ }).click();
          const times = page.getByRole('button', { name: /8:30 AM/ }); if (await times.count()) await times.first().click();
          await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
        } else {
          if (scenario === 'edit-cleared') {
            await page.getByRole('region', { name: 'Current canonical appointment' }).waitFor();
            assert.equal(await page.getByLabel('Customer-facing work description').inputValue(), '');
            assert.equal(await page.getByLabel('Technician instructions', { exact: true }).inputValue(), '');
          } else if (scenario.startsWith('edit-generated')) {
            await page.getByRole('region', { name: 'Current canonical appointment' }).waitFor();
            assert.equal(await page.getByLabel('Customer-facing work description').inputValue(), current.legacyDescription);
            if (scenario === 'edit-generated-add') await page.getByRole('button', { name: /^Check Up/ }).click();
            else await page.getByRole('button', { name: '＋', exact: true }).click();
          } else await page.getByLabel('Customer-facing work description').fill('Synthetic revised scope');
          const save = page.getByRole('button', { name: 'Save changes', exact: true }); await save.waitFor();
          await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Save changes' && !button.disabled));
          if (scenario === 'stale') await db.collection('appointments').doc(current.appointmentId).set({ notes: 'Another operator changed scope' }, { merge: true });
          await save.click();
          if (scenario === 'stale') {
            await page.getByText(/changed after it was loaded/).first().waitFor(); assert.equal(current.commits, 0);
            assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('demac.booking.lifecycle.pending'))), false);
            assert.deepEqual((await readState(current.appointmentId)).orders, baseline.orders);
            traces.push({ engineName, scenario, passed: true }); await context.close(); continue;
          }
        }
        const recovery = page.getByRole('button', { name: 'Recover original change' }); await recovery.waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Recover original change' && !button.disabled));
        assert.equal(current.commits, 1); const committed = await readState(current.appointmentId);
        if (current.expectedLines) {
          const textOnly = rows => rows.map(row => ({ id: row.id, quantity: row.quantity, description: row.customerFacingDescription || '', instructions: row.technicianInstructions || '' }));
          assert.deepEqual(textOnly(committed.appointment.workLines), textOnly(current.expectedLines), 'Canonical cleared/mixed text survives edit and reschedule');
        }
        if (current.expectedGeneratedText) {
          const lines = committed.appointment.workLines;
          assert.deepEqual(lines.map(line => [line.presetId, line.quantity]), [['standard_service', 2], ['check_up', 1]]);
          assert.ok(lines.every(line => line.customerFacingDescription === current.expectedGeneratedText));
          assert.equal(lines[0].technicianInstructions, 'Synthetic original instructions');
          assert.equal(lines[1].technicianInstructions || '', '');
        }
        const raw = await page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('demac.booking.lifecycle.pending')))); assert.ok(raw);
        await page.reload(); await recovery.waitFor(); current.release = true; await recovery.click();
        await page.getByRole('heading', { name: 'Verified change' }).waitFor();
        assert.equal(current.commits, 1); assert.ok(current.replays >= 1); assert.deepEqual(await readState(current.appointmentId), committed);
        assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('demac.booking.lifecycle.pending'))), false);
        assert.deepEqual(errors, []); assert.deepEqual(current.errors, []);
        if (scenario === 'edit') await page.screenshot({ path: path.join(evidence, `${engineName}-recovered.png`), fullPage: true });
        traces.push({ engineName, scenario, passed: true, commits: current.commits, replays: current.replays, timings: current.timings }); await context.close();
        console.log(`${engineName}: ${scenario} passed`);
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(traces, null, 2));
  console.log(`Lifecycle UI: ${traces.length} scenarios passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await new Promise(resolve => server.close(resolve)); await deleteApp(app); });
