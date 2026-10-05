// Real React Scheduling + booking transports + office facade + loopback Firestore.
// Only authentication/session and transport host selection are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '../..');
const testTools = process.env.OVERTIME_TEST_TOOLS;
const browserPath = process.env.OVERTIME_TEST_CHROME;
const output = process.env.OVERTIME_TEST_OUTPUT;
if (![testTools, browserPath, output].every(value => value && path.isAbsolute(value))) throw Error('Absolute isolated tools, Chrome and evidence paths required.');
const { build } = require(path.join(testTools, 'node_modules/esbuild'));
const { chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
const functionsRequire = require('node:module').createRequire(path.join(ROOT, 'functions/package.json'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { PROJECT, assertIsolated, resetSynthetic } = require(path.join(ROOT, 'functions/test-support/manualMoveSynthetic.cjs'));
const { createProjectApi } = require(path.join(ROOT, 'functions/projectAuthority'));
assertIsolated();
fs.mkdirSync(output, { recursive: true });
const firebase = initializeApp({ projectId: PROJECT });
const db = getFirestore(firebase);
const { createOfficeBookingApi } = require(path.join(ROOT, 'functions/officeBookingAuthority'));
const { createBookingAuthority } = require(path.join(ROOT, 'functions/bookingAuthorityFirestore'));
const { createSchedulingProvider } = require(path.join(ROOT, 'functions/bookingAuthoritySchedulingProvider'));
const { withProjectBookingLinks } = require(path.join(ROOT, 'functions/projectBookingLinks'));
const clock = () => new Date('2026-10-05T17:24:00Z');
const provider = withProjectBookingLinks({ db, provider: createSchedulingProvider({ db }) });
const facade = createOfficeBookingApi({ db, verifyIdToken: async token => {
  if (token !== 'synthetic-overtime-token') throw Error('Synthetic token required');
  return { uid: 'demo-office' };
}, bookingAuthority: createBookingAuthority({ db, availabilityProvider: provider, clock }) });
const projectApi = createProjectApi({ db, verifyIdToken: async token => {
  if (token !== 'synthetic-overtime-token') throw Error('Synthetic token required');
  return { uid: 'demo-office' };
} });
const date = '2026-10-05';
const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const stubs = {
  'auth-provider': `const principal={userId:'demo-office',displayName:'Synthetic office operator',active:true,capabilities:new Set(['scheduling.view','scheduling.manage','projects.schedule'])};const refreshPrincipal=async()=>{};export function useAuth(){return {principal,refreshPrincipal};}`,
  'session': `export async function requireFirebaseWebSession(){return {uid:'demo-office',idToken:'synthetic-overtime-token'};}`,
  'isolated-preview': `export function firebaseTransportUrl(url){const u=new URL(url);if(u.hostname==='firestore.googleapis.com')return '/firestore'+u.pathname+u.search;if(u.hostname==='us-central1-demo-demac-overtime.cloudfunctions.net'&&u.pathname==='/officeBookingAuthority')return '/authority';if(u.hostname==='us-central1-demo-demac-overtime.cloudfunctions.net'&&u.pathname==='/projectAuthority')return '/projects';throw Error('Non-synthetic destination rejected: '+u.hostname);}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {LiveSchedulingOverview} from './components/scheduling/live-scheduling-overview';import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';createRoot(document.getElementById('app')).render(<div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><LiveSchedulingOverview/></div>);`;
const actions = [];
let loseCreateResponse = false;
async function main() {
  await resetSynthetic(db, date);
  await db.doc('projectRecords/DEMO-PROJECT').set({ id: 'DEMO-PROJECT', name: 'Synthetic historical project', projectNumber: 'PRJ-HIST-001',
    customerId: 'DEMO-CUSTOMER', customerName: 'Synthetic Project customer', siteId: 'DEMO-PROPERTY', location: 'Synthetic property',
    type: 'Renovation Service', status: 'Planned', serverVersion: 1, phases: [{ id: 'PHASE-1', name: 'Installation', status: 'Planned', estimatedLaborHours: 4, actualLaborHours: 0 }],
    assignments: [], assignedVans: [], scheduledFutureHours: 0, actualLaborHours: 0, estimatedSlots: 4, estimatedLaborHours: 4, slotDurationMinutes: 60, slotsPerWorkDay: 6 });
  await build({ absWorkingDir: APP, stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic.local', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'synthetic', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'synthetic', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic' }) },
    plugins: [{ name: 'isolated-auth-and-transport', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = path.basename(args.path); if (stubs[key]) return { path: key, namespace: 'synthetic' }; });
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP }));
    } }] });
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (req.url === '/authority' || req.url === '/projects') {
        const requestBody = JSON.parse(body.toString());
        actions.push(requestBody);
        const result = await (req.url === '/projects' ? projectApi : facade).handle({ method: req.method, headers: req.headers, body: requestBody });
        if (loseCreateResponse && requestBody.action === 'create_appointment' && result.status === 200) { loseCreateResponse = false; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
        res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.body)); return;
      }
      if (req.url.startsWith('/firestore/v1/projects/demo-demac-overtime/')) {
        const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${req.url.slice('/firestore'.length)}`, { method: req.method, headers: { 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}) });
        res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text()); return;
      }
      if (['/app.js', '/app.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1060 }, serviceWorkers: 'block' });
  const errors = [], external = [];
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  let acceptDialog = true;
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (acceptDialog ? dialog.accept() : dialog.dismiss()); });
  try {
    await page.clock.install({ time: clock() });
    await page.goto(origin);
    const van2 = page.getByRole('region', { name: 'Van 2 schedule', exact: true });
    const open = van2.getByRole('button', { name: 'Book VAN-2 at 8:30 AM', exact: true });
    await open.waitFor();
    acceptDialog = false;
    await open.click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal((await db.collection('bookingOffers').get()).size, 0);
    assert.equal((await db.collection('appointments').get()).size, 1);
    acceptDialog = true;
    await open.click();
    const drawer = page.getByRole('dialog');
    await drawer.getByText('BACKDATED APPOINTMENT', { exact: true }).waitFor();
    await drawer.getByRole('button', { name: /^Project Find/ }).click();
    await drawer.getByPlaceholder('Project name, number, customer or location…').fill('PRJ-HIST-001');
    await drawer.getByRole('button', { name: /PRJ-HIST-001 · Synthetic historical project/ }).click();
    await drawer.getByLabel('Planned Project slots *').fill('2');
    await drawer.getByLabel('Project phase *').selectOption('PHASE-1');
    await drawer.getByText('Booking Authority approved the complete allocation', { exact: true }).waitFor();
    assert.equal(await drawer.getByRole('button', { name: 'Temporary hold', exact: true }).count(), 0);
    await drawer.getByText('BACKDATED APPOINTMENT', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'backdated-project-ready.png'), fullPage: true });
    loseCreateResponse = true;
    await drawer.getByRole('button', { name: 'Save backdated appointment', exact: true }).click();
    await drawer.getByRole('button', { name: 'Recuperar reserva original' }).click();
    await drawer.waitFor({ state: 'detached' });
    const creates = actions.filter(item => item.action === 'create_appointment');
    assert.equal(creates.length, 2);
    assert.deepEqual(creates[0].data, creates[1].data);
    assert.equal(creates[0].data.bookingMode, 'backdated');
    assert.equal(creates[0].data.backdatingAcknowledged, true);
    const saved = (await db.doc('projectRecords/DEMO-PROJECT').get()).data();
    assert.equal(saved.assignments.length, 1);
    assert.equal(saved.assignments[0].scheduledDate, date);
    assert.equal(saved.assignments[0].scheduledStart, '08:30');
    assert.equal(saved.assignments[0].scheduledSlots, 2);
    await page.reload();
    await van2.getByText('Project · Synthetic historical project', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(output, 'backdated-project-saved.png'), fullPage: true });
    // Existing regular service backdating still works through the same drawer.
    const van3 = page.getByRole('region', { name: 'Van 3 schedule', exact: true });
    await van3.getByRole('button', { name: 'Book VAN-3 at 8:30 AM', exact: true }).click();
    await drawer.getByPlaceholder(/Name, company, phone/).fill('Cliente sintético');
    await drawer.getByRole('button').filter({ hasText: 'Cliente sintético' }).first().click();
    await drawer.getByRole('button', { name: /Standard Service/ }).first().click();
    await drawer.getByText('Booking Authority approved the complete allocation', { exact: true }).waitFor();
    await drawer.getByRole('button', { name: 'Save backdated appointment', exact: true }).click();
    await drawer.waitFor({ state: 'detached' });
    const regular = (await db.collection('appointments').where('primaryVanId', '==', 'VAN-3').get()).docs;
    assert.equal(regular.length, 1); assert.equal(regular[0].data().backdated, true);
    // Mobile renders the same historical Project selection and save action.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Next van', exact: true }).click();
    await van2.getByRole('button', { name: 'BOOK', exact: true }).first().click();
    await drawer.getByRole('button', { name: /^Project Find/ }).click();
    await drawer.getByRole('button', { name: /PRJ-HIST-001 · Synthetic historical project/ }).click();
    await drawer.getByLabel('Planned Project slots *').fill('1');
    await drawer.getByLabel('Project phase *').selectOption('PHASE-1');
    await drawer.getByText('Booking Authority approved the complete allocation', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'backdated-project-mobile.png'), fullPage: true });
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await db.doc('projectRecords/DEMO-PROJECT').get()).data().assignments.length, 1);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    for (const collection of ['employeeTimesheets', 'workVisits', 'whatsappOutboundQueue']) assert.equal((await db.collection(collection).get()).size, 0);
    fs.writeFileSync(path.join(output, 'integration-result.json'), JSON.stringify({ status: 'PASS', scenarios: ['cancel writes nothing', 'elapsed-today Project registration', 'lost-response exact retry', 'persisted Project visible after reload', 'regular service backdating', 'mobile Project drawer'], errors, external }));
    console.log('PASS functional browser scenarios; checking auxiliary agent-browser smoke next.');
    const cli = path.join(testTools, 'node_modules/.bin/agent-browser');
    const cliEnv = { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: browserPath };
    await execFile(cli, ['--session', 'demac-backdated-review', 'open', origin], { env: cliEnv });
    const snapshot = await execFile(cli, ['--session', 'demac-backdated-review', 'snapshot', '-i'], { env: cliEnv });
    fs.writeFileSync(path.join(output, 'agent-browser-snapshot.txt'), snapshot.stdout);
    await execFile(cli, ['--session', 'demac-backdated-review', 'close'], { env: cliEnv });
    console.log('PASS React Scheduling → real HTTP booking transport → Booking Authority → Firestore. Historical Project/service, acknowledgement/cancel, exact retry, persisted reload, mobile and agent-browser smoke.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify({errors,external,actions}, null, 2)}`);
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await deleteApp(firebase); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
