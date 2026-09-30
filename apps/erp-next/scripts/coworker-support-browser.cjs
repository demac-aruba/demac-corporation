// Real React agenda, browser transport, Office facade and Firestore emulator.
// Only authentication and transport host are synthetic. Never contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '../..');
const PROJECT = 'demo-demac-support';
const tooling = process.env.SUPPORT_TEST_TOOLS;
const output = process.env.SUPPORT_TEST_OUTPUT;
if (![tooling, output].every(value => value && path.isAbsolute(value))
  || process.env.GCLOUD_PROJECT !== PROJECT
  || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('Absolute test paths and loopback demo-demac-support emulator required.');
}
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
const functionsRequire = require('node:module').createRequire(path.join(ROOT, 'functions/package.json'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { seedRecords } = require(path.join(ROOT, 'functions/test-support/manualMoveSynthetic.cjs'));
const { arubaDateParts, addDays } = require(path.join(ROOT, 'functions/bookingSchedulingPrimitives'));
const { createOfficeBookingAuthorityFacade } = require(path.join(ROOT, 'functions/officeBookingAuthorityFacade'));
const firebase = initializeApp({ projectId: PROJECT });
const db = getFirestore(firebase);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async token => {
  if (token !== 'synthetic-support-token') throw Error('Synthetic token required');
  return { uid: 'demo-office' };
} });
const today = arubaDateParts(new Date()).date;
let futureDate = addDays(today, 1);
if (new Date(`${futureDate}T12:00:00Z`).getUTCDay() === 0) futureDate = addDays(futureDate, 1);
let pastDate = addDays(today, -1);
if (new Date(`${pastDate}T12:00:00Z`).getUTCDay() === 0) pastDate = addDays(pastDate, -1);
const stubs = {
  'auth-provider': `const principal={userId:'demo-office',displayName:'Synthetic dispatcher',active:true,capabilities:new Set(['scheduling.view','scheduling.manage'])};const refreshPrincipal=async()=>{};export function useAuth(){return {principal,refreshPrincipal};}`,
  'session': `export async function requireFirebaseWebSession(){return {uid:'demo-office',idToken:'synthetic-support-token'};}`,
  'isolated-preview': `export function firebaseTransportUrl(url){const u=new URL(url);if(u.hostname==='firestore.googleapis.com')return '/firestore'+u.pathname+u.search;if(u.hostname==='us-central1-${PROJECT}.cloudfunctions.net'&&u.pathname==='/officeBookingAuthority')return '/authority';throw Error('Non-synthetic destination rejected: '+u.hostname);}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {LiveSchedulingOverview} from './components/scheduling/live-scheduling-overview';import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';createRoot(document.getElementById('app')).render(<div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><LiveSchedulingOverview/></div>);`;
const actions = [];
async function reset(date, historical) {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert(response.ok);
  const seed = seedRecords(date);
  seed['clients/DEMO-CUSTOMER'].name = 'Synthetic installation customer';
  seed['workOrders/DEMO-WO'].appointmentWorkLabel = 'Two standard installations';
  seed['workOrders/DEMO-WO'].customerFacingDescription = 'Two standard installations';
  seed['workOrders/DEMO-WO'].airConditionerCount = 2;
  seed['workOrders/VAN-3-NEXT'] = { ...seed['workOrders/DEMO-WO'], appointmentId: 'NEXT-APT',
    vanId: 'VAN-3', time: '09:30', appointmentEndTime: '10:30', scheduledSlots: 1,
    appointmentDurationMinutes: 60, airConditionerCount: 1, appointmentWorkLabel: 'Next scheduled service' };
  if (historical) { seed['workOrders/DEMO-WO'].status = 'Completada'; seed['appointments/DEMO-APT'].status = 'completed'; }
  const batch = db.batch();
  for (const [key, value] of Object.entries(seed)) batch.set(db.doc(key), value);
  await batch.commit();
  actions.length = 0;
}
async function runCase(browser, origin, label, viewport, historical = false) {
  const date = historical ? pastDate : futureDate;
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  await reset(date, historical);
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const errors = [], external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(origin);
    if (!await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).count()) {
      await page.getByRole('button', { name: historical ? '‹' : '›', exact: true }).click();
    }
    await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).click();
    if (viewport.width < 760) await page.getByRole('button', { name: 'Show Van 3', exact: true }).click();
    const van3 = page.getByRole('region', { name: 'Van 3 schedule', exact: true });
    const firstSlot = van3.locator('[data-schedule-slot="open"]').first();
    await firstSlot.getByRole('button', { name: 'SUPPORT', exact: true }).waitFor();
    assert.match(await firstSlot.innerText(), /8:30 AM/);
    await firstSlot.getByRole('button', { name: 'SUPPORT', exact: true }).click();
    const support = page.getByRole('dialog', { name: 'Send van support', exact: true });
    await support.waitFor();
    assert.match(await support.innerText(), /8:30 AM–9:30 AM/);
    await support.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(actions.filter(item => item.action === 'add_adhoc_support').length, 0);
    // The full open-card entry must expose support as well as normal booking.
    if (viewport.width < 760) {
      await page.getByRole('button', { name: 'Show Van 3', exact: true }).click();
      await firstSlot.getByRole('button', { name: 'BOOK', exact: true }).click();
    } else await firstSlot.getByRole('button', { name: 'Book VAN-3 at 8:30 AM', exact: true }).click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: /Send van support Use this open slot/ }).click();
    await support.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await support.getByRole('button').filter({ hasText: 'Next scheduled service' }).count(), 0);
    await support.getByRole('button').filter({ hasText: 'Synthetic installation customer · Van 1' }).click();
    await support.getByRole('combobox').selectOption('Heavy lifting / installation support');
    await support.getByRole('textbox').fill('Help with the first installation before the next job.');
    const saveSupport = support.getByRole('button', { name: historical ? 'Save historical support' : 'Send support', exact: true });
    if (historical) {
      assert.equal(await saveSupport.isEnabled(), false);
      assert.match(await support.innerText(), /No customer or technician alerts/);
      await support.getByRole('checkbox').check();
      assert.equal(await saveSupport.isEnabled(), true);
    }
    await page.screenshot({ path: path.join(output, `${label}-support-selected.png`), fullPage: true });
    const beforePrimary = (await db.doc('workOrders/DEMO-WO').get()).data();
    const beforeNext = (await db.doc('workOrders/VAN-3-NEXT').get()).data();
    const beforeAppointment = (await db.doc('appointments/DEMO-APT').get()).data();
    await saveSupport.click();
    await support.waitFor({ state: 'detached' });
    const requests = actions.filter(item => item.action === 'add_adhoc_support');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.requestedDate, date);
    assert.equal(requests[0].data.requestedTime, '08:30');
    assert.equal(requests[0].data.requiredVanId, 'VAN-3');
    const appointment = (await db.doc('appointments/DEMO-APT').get()).data();
    const assignment = appointment.assignments.find(item => item.role === 'support');
    assert.equal(assignment.vanId, 'VAN-3');
    assert.equal(assignment.slots, 1);
    assert.equal(assignment.endTime, '09:30');
    assert.deepEqual(appointment.assignments[0], beforeAppointment.assignments[0]);
    assert.deepEqual((await db.doc('workOrders/DEMO-WO').get()).data(), beforePrimary);
    assert.deepEqual((await db.doc('workOrders/VAN-3-NEXT').get()).data(), beforeNext);
    assert.equal((await db.collection('appointments').get()).size, 1);
    const order = (await db.doc(`workOrders/${assignment.id}`).get()).data();
    assert.equal(order.supportNonBillable, true);
    if (historical) {
      assert.equal(requests[0].data.bookingMode, 'backdated');
      assert.equal(requests[0].data.backdatingAcknowledged, true);
      assert.equal(order.backdated, true);
      assert.equal(order.workAlreadyPerformed, true);
      assert.equal(order.backdatedRecordedBy, 'demo-office');
      assert.equal(appointment.status, 'completed');
      assert.equal(appointment.backdated, undefined);
    }
    assert.equal(order.customerCommunicationOwner, false);
    assert.deepEqual(order.notificationRecipients, []);
    assert.equal(order.whatsappNotificationsEnabled, false);
    assert.deepEqual(order.technicianIds, ['DRIVER-3', 'HELPER-3']);
    // Replaying the transport call cannot create another support assignment.
    const replay = await facade.handle({ method: 'POST', headers: { authorization: 'Bearer synthetic-support-token' }, body: requests[0] });
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    await page.reload();
    if (!await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).count()) await page.getByRole('button', { name: historical ? '‹' : '›', exact: true }).click();
    await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).click();
    if (viewport.width < 760) await page.getByRole('button', { name: 'Show Van 3', exact: true }).click();
    await van3.locator('[data-schedule-job]').filter({ hasText: 'Support assignment' }).waitFor();
    assert.equal(await van3.locator('[data-schedule-job]').count(), 2);
    await page.screenshot({ path: path.join(output, `${label}-support-saved.png`), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    return { label, date, result: 'PASS', externalRequests: external.length, writes: requests.length };
  } catch (error) { await page.screenshot({ path: path.join(output, `${label}-failure.png`), fullPage: true }); throw error; } finally { await context.close(); }
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic.local', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'synthetic', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'synthetic', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic' }) },
    plugins: [{ name: 'isolated-auth-and-transport', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = path.basename(args.path); if (stubs[key]) return { path: key, namespace: 'synthetic' }; });
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP }));
    } }] });
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (req.url === '/authority') {
        const requestBody = JSON.parse(body.toString()); actions.push(requestBody);
        const result = await facade.handle({ method: req.method, headers: req.headers, body: requestBody });
        res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.body)); return;
      }
      if (req.url.startsWith(`/firestore/v1/projects/${PROJECT}/`)) {
        const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${req.url.slice('/firestore'.length)}`, { method: req.method, headers: { 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}) });
        res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text()); return;
      }
      if (['/app.js', '/app.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.SUPPORT_TEST_CHROME ? { executablePath: process.env.SUPPORT_TEST_CHROME } : {}), args: ['--no-sandbox'] });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    for (const historical of [false, true]) {
      for (const [label, viewport] of [['desktop', { width: 1500, height: 1060 }], ['mobile', { width: 390, height: 844 }]]) {
        results.push(await runCase(browser, origin, `${historical ? 'historical' : 'future'}-${label}`, viewport, historical));
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await deleteApp(firebase); }
}
main().catch(error => { console.error(error); process.exit(1); });
