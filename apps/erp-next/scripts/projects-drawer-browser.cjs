'use strict';
// Actual React Scheduling drawer/client adapters -> Office/registry handlers -> Auth/Firestore.
// CRM/crew presentation and the capacity provider are deterministic synthetic fixtures.
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const assert = require('node:assert/strict'); const os = require('node:os');
const ROOT = path.resolve(__dirname, '../../..'); const APP = path.join(ROOT, 'apps/erp-next');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Loopback emulators required.');
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo-only drawer tests.');
const tools = process.env.PROJECTS_UI_TOOLS;
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const fromFunctions = require('node:module').createRequire(path.join(ROOT, 'functions/package.json'));
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app');
const { getAuth } = fromFunctions('firebase-admin/auth'); const { getFirestore } = fromFunctions('firebase-admin/firestore');
const { createProjectRegistryService } = require(path.join(ROOT, 'functions/projects/registry-service'));
const { createProjectRegistryHttp } = require(path.join(ROOT, 'functions/projects/registry-http'));
const { createBookingAuthority } = require(path.join(ROOT, 'functions/bookingAuthorityFirestore'));
const { createOfficeBookingApi } = require(path.join(ROOT, 'functions/officeBookingAuthority'));
const { createProjectBookingIntegration } = require(path.join(ROOT, 'functions/projects/booking-integration'));
const { interruptResponse } = require('./projects-central-response-fault.cjs');
const app = initializeApp({ projectId: PROJECT }, 'projects-drawer-browser');
const db = getFirestore(app); const auth = getAuth(app);
const registry = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'project-drawer-'));
const evidence = path.join(ROOT, 'projects-drawer-evidence'); fs.mkdirSync(evidence, { recursive: true });
let actor, origin, registryHttp, current, sequence = 0;
const traces = [];
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/proxy') {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 128 * 1024) throw Error('Oversized test input'); }
      const target = new URL(url.searchParams.get('target'));
      assert.equal(target.protocol, 'https:'); assert.ok(target.hostname.endsWith('.cloudfunctions.net'));
      const body = JSON.parse(raw || '{}');
      let result;
      if (target.pathname === '/projectsRegistry') {
        if (current.failReads) result = { status: 503, body: { success: false, error: { code: 'service_unavailable', message: 'Synthetic registry outage', outcome: 'unknown' } } };
        else result = await registryHttp({ method: req.method, headers: { ...req.headers, origin }, body });
      } else if (target.pathname === '/officeBookingAuthority') {
        current.officeCalls.push(body);
        if (body.action === 'list_presets') result = { status: 200, body: { success: true, presets: [{ id: 'other', label: 'Other', active: true, serviceId: 'SERVICE-T', durationMinutesPerUnit: 60, durationMode: 'fixed' }] } };
        else result = await current.office.handle({ method: req.method, headers: req.headers, body });
        if (current.loseResponse && ['create_appointment', 'create_temporary_hold'].includes(body.action) && result.status === 200) {
          const text = JSON.stringify(body);
          if (current.originalCommand) assert.equal(text, current.originalCommand, 'Same original booking only');
          else current.originalCommand = text;
          if (!result.body.replayed) current.commits++;
          else current.replays++;
          assert.equal(current.commits, 1);
          if (!current.release) return interruptResponse(res);
        }
      } else throw Error('Unexpected authority requested');
      res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result.body));
    } catch (error) {
      current.proxyErrors.push(error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false, error: { code: 'test_proxy_failed', message: 'Isolated test proxy failed' } }));
    }
    return;
  }
  if (url.pathname === '/app.js' || url.pathname === '/app.css') {
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css');
    return res.end(fs.readFileSync(path.join(out, url.pathname.slice(1))));
  }
  res.setHeader('Content-Security-Policy', CSP); res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial;color:#12233b}*{box-sizing:border-box}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
});
const requestId = () => `DRAWER-${++sequence}`;
async function command(action, data) { return registry.execute({ idToken: actor.idToken, command: { action, requestId: requestId(), data } }); }
const protectedCollections = ['clients', 'properties', 'appointments', 'workOrders', 'workVisits', 'bookingCapacityLocks', 'warehouseInventory', 'whatsappOutboundQueue'];
async function fixture(name, scenario) {
  const prefix = requestId(); const customerId = `${prefix}-C`; const propertyId = `${prefix}-S`;
  await db.collection('clients').doc(customerId).set({ name: 'Synthetic customer', active: true });
  await db.collection('properties').doc(propertyId).set({ clientId: customerId, name: 'Synthetic property', active: true });
  const created = await command('create_plan', { name, type: 'VRF Project', customerId, propertyId, startsOn: '2099-01-01', estimatedCompletionOn: '2099-12-31', budgetedVanMinutes: 3960, phases: [] });
  // Seven prior multi-van visits: 7 * (6 + 3) = 63 allocated Van hours, not actual labor.
  for (let index = 0; index < 7; index++) {
    const appointmentId = `${prefix}-PAST-${index}`; const workOrderIds = [`${appointmentId}-A`, `${appointmentId}-B`];
    await db.collection('appointments').doc(appointmentId).set({ customerId, propertyId, workOrderIds, status: 'completed' });
    for (const [n, minutes] of [360, 180].entries()) await db.collection('workOrders').doc(workOrderIds[n]).set({ appointmentId, clientId: customerId, propertyId, status: 'Completada', vanId: `PAST-${n}`, appointmentDurationMinutes: minutes, scheduledSlots: minutes / 60, date: '2099-08-01', time: '08:30' });
    const plan = (await command('get_plan', { projectId: created.projectId })).project;
    await command('attach_existing_appointment', { projectId: plan.id, expectedVersion: plan.version, appointmentId, phaseId: null, confirmedAssociation: true, reason: 'Reviewed synthetic prior allocation' });
  }
  const project = (await command('get_plan', { projectId: created.projectId })).project;
  const support = scenario === 'support';
  const option = { id: `${prefix}-OPTION`, date: '2099-09-18', time: '08:30', endTime: '15:30', capacityEndTime: '15:30', presetId: 'other', quantity: 1, durationMode: 'manual', durationMinutes: 360,
    assignments: [{ vanId: `${prefix}-VAN`, vanName: 'Synthetic Van', role: 'primary', quantity: 1, slots: 6, durationMinutes: 360 }, ...(support ? [{ vanId: `${prefix}-SUPPORT`, vanName: 'Support Van', role: 'support', quantity: 1, slots: 2, durationMinutes: 120 }] : [])] };
  const provider = {
    checkAvailability: async () => scenario === 'capacity' ? { options: [], reason: 'required-primary-target-unavailable' } : { options: [option] },
    revalidateSelection: async () => ({ available: true, option }),
    validateTransaction: async () => ({ available: true, capacityLocks: option.assignments.map((a, i) => ({ id: `${prefix}-LOCK-${i}`, vanId: a.vanId, date: option.date, slot: '08:30' })) }),
    buildWorkOrders: async ({ appointment }) => option.assignments.map((a, i) => ({ id: `${appointment.appointmentId}-WO-${i}`, appointmentId: appointment.appointmentId, clientId: customerId, propertyId, vanId: a.vanId, status: appointment.status === 'temporary_hold' ? 'Reserva temporal' : 'Confirmada', appointmentDurationMinutes: a.durationMinutes, scheduledSlots: a.slots, date: option.date, time: option.time })),
  };
  const authority = createBookingAuthority({ db, availabilityProvider: provider, projectIntegration: createProjectBookingIntegration({ db, enabled: true }) });
  const office = createOfficeBookingApi({ db, verifyIdToken: token => auth.verifyIdToken(token, true), schedulingProvider: provider, bookingAuthority: authority, projectsEnabled: true });
  const before = {}; for (const col of protectedCollections) before[col] = Object.fromEntries((await db.collection(col).get()).docs.map(doc => [doc.id, doc.data()]));
  return { project, customerId, propertyId, option, office, before, officeCalls: [], proxyErrors: [],
    failReads: scenario === 'outage', loseResponse: scenario === 'recovery', release: false, commits: 0, replays: 0,
    target: { dateKey: option.date, vanId: option.assignments[0].vanId, vanName: 'Synthetic Van', start: '08:30', end: '09:30' } };
}
async function main() {
  const signedUp = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'drawer-owner@example.test', password: 'synthetic-drawer-password', returnSecureToken: true }) });
  actor = await signedUp.json(); assert.ok(actor.idToken); await db.collection('users').doc(actor.localId).set({ role: 'admin', active: true });
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true, bookingEnabled: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  registryHttp = createProjectRegistryHttp({ service: registry, allowedOrigins: [origin] });
  const stubs = {
    'auth-provider': `const principal={userId:window.__fixture.uid,active:true,role:'super_admin',capabilities:new Set(window.__fixture.readOnly?['projects.view']:['projects.view','projects.manage'])};export function useAuth(){return {principal}}`,
    'live-scheduling-booking-data': `export async function loadBookingMasterReferenceData(){const f=window.__fixture;return {clients:[{id:f.customerId,name:'Synthetic customer',active:true}],properties:[{id:f.propertyId,clientId:f.customerId,name:'Synthetic property',address:'Synthetic site',active:true}]}}export async function loadBookingContactReferenceData(){return {contacts:[],contactAssignments:[]}}export async function createBookingCustomerWithProperty(){throw Error('Unexpected master write')}export async function createBookingProperty(){throw Error('Unexpected property write')}`,
    'live-operational-capacity': `export async function loadLiveOperationalCapacityState(){return {}}export function liveVanCrew(){return {label:'Synthetic crew'}}`,
    'property-communication-editor': `export function PropertyCommunicationPanel(){return null}export function PropertyContactDraftEditor(){return null}`,
  };
  await build({ absWorkingDir: APP, stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{LiveAppointmentCreateDrawer}from'./components/scheduling/live-appointment-create-drawer';function Harness(){const[done,setDone]=useState(false);if(done)return <h1>Verified booking received</h1>;return <LiveAppointmentCreateDrawer target={window.__fixture.target} onClose={()=>{}} onCreated={result=>{window.__created=result;setDone(true)}} onRecoveredProjectBooking={result=>{window.__recovered=result;setDone(true)}}/>}createRoot(document.getElementById('app')).render(<Harness/>);`, loader: 'tsx', resolveDir: APP }, outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_PROJECTS_REGISTRY_ENABLED: 'true', NEXT_PUBLIC_PROJECTS_BOOKING_ENABLED: 'true', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT }) },
    plugins: [{ name: 'synthetic-reference-presentation', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = path.basename(args.path); if (args.importer.endsWith('live-appointment-create-drawer.tsx') && stubs[key]) return { path: key, namespace: 'fixture' }; });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP }));
    } }],
  });
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const scenario of ['confirmed', 'hold', 'support', 'version', 'capacity', 'recovery', 'outage', 'read-only']) {
        const name = `${engineName}-${scenario}`; current = await fixture(name, scenario);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        await context.addInitScript(({ f, session }) => {
          window.__fixture = f; sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify(session));
          const key = 'demac.erp-next.projects.preview.v1';
          localStorage.setItem(key, 'DO-NOT-READ-OR-REWRITE-ORIGINAL-PROJECTS');
          window.__legacyReads = 0; window.__legacyWrites = 0;
          const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
          Storage.prototype.getItem = function (name) { if (this === localStorage && name === key) window.__legacyReads++; return get.call(this, name); };
          Storage.prototype.setItem = function (name, value) { if (this === localStorage && name === key) window.__legacyWrites++; return set.call(this, name, value); };
          Storage.prototype.removeItem = function (name) { if (this === localStorage && name === key) window.__legacyWrites++; return remove.call(this, name); };
          const nativeFetch = window.fetch.bind(window);
          window.fetch = async (input, init) => { const target = new URL(input instanceof Request ? input.url : String(input), location.href); if (target.origin === location.origin) return nativeFetch(input, init); const req = new Request(input, init); return nativeFetch('/proxy?target=' + encodeURIComponent(target.href), { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(), signal: req.signal, credentials: 'omit', redirect: 'error' }); };
        }, { f: { uid: actor.localId, customerId: current.customerId, propertyId: current.propertyId, target: current.target, readOnly: scenario === 'read-only' }, session: { uid: actor.localId, idToken: actor.idToken, refreshToken: 'UNUSED', expiresAt: Date.now() + 3600000 } });
        const page = await context.newPage(); page.setDefaultTimeout(20000); const errors = []; const outside = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (new URL(req.url()).origin !== origin) outside.push(new URL(req.url()).origin); });
        try {
          await page.goto(origin); await page.getByRole('button', { name: /^Project Find a Project/ }).click();
          if (scenario === 'outage') {
            await page.getByText(/Synthetic registry outage/).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Confirm appointment', exact: true }).isDisabled(), true);
          } else {
            await page.getByLabel('Search Project', { exact: true }).fill(name);
            await page.getByRole('button', { name: new RegExp(name) }).click();
            const slots = page.getByLabel(/Planned Project slots/); await slots.fill('6');
            const confirm = page.getByRole('button', { name: 'Confirm appointment', exact: true });
            await page.locator('[data-central-budget-warning]').waitFor();
            if (scenario === 'capacity') {
              await page.getByText(/no longer has the complete requested capacity/).waitFor(); assert.equal(await confirm.isDisabled(), true);
            } else if (scenario === 'read-only') {
              assert.equal(await confirm.isDisabled(), true);
            } else {
              await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Confirm appointment' && !b.disabled));
              const warning = await page.locator('[data-central-budget-warning]').innerText();
              assert.match(warning, /63 hours|63h/); assert.match(warning, scenario === 'support' ? /71 hours|71h/ : /69 hours|69h/);
              if (scenario === 'version') await command('edit_metadata', { projectId: current.project.id, expectedVersion: current.project.version, patch: { description: 'Concurrent edit' } });
              if (scenario === 'hold') await page.getByRole('button', { name: 'Temporary hold', exact: true }).click(); else await confirm.click();
              if (scenario === 'version') {
                await page.getByRole('alert').filter({ hasText: /version_conflict/ }).waitFor();
                assert.equal(await page.evaluate(() => window.__created), undefined);
              } else if (scenario === 'recovery') {
                // The journal exists BEFORE sending. Its visible banner is not commit evidence.
                // Wait for the failed request to settle before checking the committed receipt.
                await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
                  button.textContent.trim() === 'Recover original booking' && !button.disabled));
                const key = 'demac.projects.booking.pending.v1:' + actor.localId;
                const raw = await page.evaluate(key => sessionStorage.getItem(key), key); assert.ok(raw);
                assert.equal(current.commits, 1);
                page.once('dialog', dialog => dialog.accept()); await page.reload();
                await page.getByRole('button', { name: 'Recover original booking', exact: true }).waitFor();
                assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), raw);
                assert.equal(await page.getByRole('button', { name: 'Confirm appointment', exact: true }).isDisabled(), true);
                current.release = true; await page.getByRole('button', { name: 'Recover original booking', exact: true }).click();
                await page.getByRole('heading', { name: 'Verified booking received' }).waitFor();
                assert.equal(current.commits, 1); assert.ok(current.replays >= 1);
                assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
              } else {
                await page.getByRole('heading', { name: 'Verified booking received' }).waitFor();
                const created = await page.evaluate(() => window.__created);
                assert.equal(created.project.syncStatus, 'linked'); assert.equal(created.status, scenario === 'hold' ? 'temporary_hold' : 'confirmed');
                assert.equal(created.workOrderIds.length, scenario === 'support' ? 2 : 1);
                const link = (await db.collection('projectAppointmentLinks').doc(created.appointmentId).get()).data();
                assert.equal(link.projectId, current.project.id); assert.deepEqual(link.workOrderIdsAtLink, [...created.workOrderIds].sort());
              }
            }
          }
          assert.deepEqual(errors, []); assert.deepEqual(outside, []); assert.deepEqual(current.proxyErrors, []);
          assert.equal(await page.evaluate(() => window.__legacyReads), 0); assert.equal(await page.evaluate(() => window.__legacyWrites), 0);
          for (const col of protectedCollections) for (const [id, data] of Object.entries(current.before[col])) assert.deepEqual((await db.collection(col).doc(id).get()).data(), data, 'Pre-existing operational records unchanged');
          if (['version', 'capacity', 'outage', 'read-only'].includes(scenario)) {
            const links = await db.collection('projectAppointmentLinks').where('projectId', '==', current.project.id).get(); assert.equal(links.size, 7);
          }
          const stored = (await command('get_plan', { projectId: current.project.id })).project;
          assert.deepEqual(stored.budget, current.project.budget); assert.equal(stored.actualLaborHours, undefined);
          traces.push({ engine: engineName, scenario, result: 'pass', legacyReads: 0, legacyWrites: 0 });
          if (scenario === 'confirmed') { await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.getByRole('button', { name: /^Project Find a Project/ }).waitFor(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)); await page.screenshot({ path: path.join(evidence, `${engineName}-drawer-mobile.png`), fullPage: true }); }
          console.log('PASS drawer', engineName, scenario);
        } catch (error) {
          console.error('DRAWER_FAILURE', name, JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 4500) }));
          await page.screenshot({ path: path.join(evidence, `${name}-failure.png`), fullPage: true }); throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify({ tests: traces, project: PROJECT, externalRequests: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { server.close(); await deleteApp(app); fs.rmSync(out, { recursive: true, force: true }); });
