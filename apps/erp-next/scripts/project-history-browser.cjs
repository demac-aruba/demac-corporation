// Complete React -> HTTP -> Project API -> isolated Firestore -> live slot totals.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const os = require('node:os');
const APP = path.resolve(__dirname, '..'); const FUNCTIONS = path.resolve(APP, '../../functions');
const PROJECT = 'demo-demac-project-history';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8398' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Use only the isolated historical demo emulator.');
const tooling = process.env.BUDGET_TEST_TOOLS;
if (!tooling || !path.isAbsolute(tooling)) throw Error('BUDGET_TEST_TOOLS must be an absolute isolated tooling directory.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tooling, 'node_modules/playwright'));
const backendRequire = require('node:module').createRequire(path.join(FUNCTIONS, 'package.json'));
const { initializeApp, deleteApp } = backendRequire('firebase-admin/app');
const { getFirestore } = backendRequire('firebase-admin/firestore');
const { createProjectApi } = require(path.join(FUNCTIONS, 'projectAuthority'));
const { lockId } = require(path.join(FUNCTIONS, 'projectHistoricalBooking'));
const { REGULAR_SLOTS } = require(path.join(FUNCTIONS, 'bookingSchedulingPrimitives'));
const app = initializeApp({ projectId: PROJECT }, 'project-history-browser'); const db = getFirestore(app);
const api = createProjectApi({ db, clock: () => new Date('2026-09-23T14:00:00Z'), verifyIdToken: async token => {
  if (token !== 'demo-owner') throw Error('Invalid synthetic session'); return { uid: token };
} });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-project-history-'));
const artifacts = path.resolve(process.env.PROJECT_HISTORY_OUTPUT || path.join(APP, '../../project-history-evidence'));
fs.mkdirSync(artifacts, { recursive: true });
const project = { id: 'DEMO-HISTORY-PROJECT', projectNumber: 'DEMO-101', name: 'Synthetic VRF Project', customerId: 'DEMO-C', siteId: 'DEMO-P',
  customerName: 'Synthetic customer', location: 'Synthetic site', description: '', contactPerson: '', type: 'VRF Project',
  status: 'Planned', priority: 'Normal', managerId: 'demo-owner', managerName: 'Synthetic owner', startsOn: '2026-09-01', estimatedCompletionOn: '2026-09-30',
  totalUnits: 1, completedUnits: 0, unitType: 'Units', estimatedWorkDays: 1, slotsPerWorkDay: 6, slotDurationMinutes: 60,
  estimatedSlots: 6, estimatedLaborHours: 6, scheduledFutureHours: 6, actualLaborHours: 0, materialBudget: null, materialActual: 0,
  assignedVans: ['DEMO-VAN'], phases: [], materials: [], expenses: [], costEntries: [],
  assignments: [{ id: 'PASG-DEMO-OLD-WO', projectId: 'DEMO-HISTORY-PROJECT', phaseId: 'GENERAL-PROJECT-WORK', appointmentId: 'DEMO-OLD', workOrderId: 'DEMO-OLD-WO',
    vanId: 'DEMO-VAN', technicianIds: ['DEMO-TECH-OLD'], scheduledHours: 6, scheduledSlots: 6, scheduledDate: '2026-09-21', scheduledStart: '08:30', scheduledEnd: '16:30',
    actualHours: 0, unitsPlanned: 0, unitsCompleted: 0, status: 'Scheduled', bookingStatus: 'confirmed' }] };
async function seed() {
  assert.equal((await fetch(`http://127.0.0.1:8398/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const records = {
    'users/demo-owner': { role: 'admin', name: 'Synthetic owner', active: true },
    'clients/DEMO-C': { name: 'Synthetic customer', active: true }, 'properties/DEMO-P': { clientId: 'DEMO-C', address: 'Synthetic site', active: true },
    'staffProfiles/DEMO-TECH-OLD': { name: 'Synthetic historical technician' },
    'vans/DEMO-VAN': { active: false, driverStaffId: 'DEMO-TODAY' },
    'appointments/DEMO-OLD': { appointmentId: 'DEMO-OLD', customerId: 'DEMO-C', propertyId: 'DEMO-P', status: 'cancelled', date: '2026-09-21', startTime: '08:30', endTime: '16:30',
      workOrderIds: ['DEMO-OLD-WO'], capacityLockIds: REGULAR_SLOTS.map(slot => lockId('2026-09-21', 'DEMO-VAN', slot)),
      assignments: [{ vanId: 'DEMO-VAN', vanName: 'Historical Van', technicianIds: ['DEMO-TECH-OLD'], quantity: 1, slots: 6, durationMinutes: 360, fullDay: true, time: '08:30', endTime: '16:30', role: 'primary' }] },
    'workOrders/DEMO-OLD-WO': { appointmentId: 'DEMO-OLD', clientId: 'DEMO-C', propertyId: 'DEMO-P', date: '2026-09-21', time: '08:30', appointmentCapacityEndTime: '16:30',
      vanId: 'DEMO-VAN', technicianIds: ['DEMO-TECH-OLD'], status: 'Cancelada', scheduledSlots: 6 },
  };
  await Promise.all(Object.entries(records).map(([key, value]) => db.doc(key).set(value)));
}
async function main() {
  let loseNextConfirmation = false;
  const env = { NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT, NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic.invalid', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'synthetic.invalid', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'synthetic', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic' };
  const stubs = {
    auth: `const principal={userId:'demo-owner',displayName:'Synthetic owner',role:'super_admin',active:true,capabilities:new Set(['projects.view','projects.manage','work_orders.view'])};export function useAuth(){return {principal};}`,
    session: `export async function requireFirebaseWebSession(){return {uid:'demo-owner',idToken:'demo-owner'};}`,
    transport: `export function firebaseTransportUrl(url){return '/transport?url='+encodeURIComponent(url);}`,
  };
  await build({ absWorkingDir: APP, stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectsPage from './app/(erp)/projects/page';import './app/globals.css';createRoot(document.getElementById('app')).render(<ProjectsPage/>);`, loader: 'tsx', resolveDir: APP },
    outfile: path.join(scratch, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify(env) },
    plugins: [{ name: 'isolated-auth-transport', setup(builder) {
      builder.onResolve({ filter: /auth-provider|\/session$|\/isolated-preview$/ }, args => ({ path: args.path.endsWith('auth-provider') ? 'auth' : args.path.endsWith('/session') ? 'session' : 'transport', namespace: 'history-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'history-test' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP }));
    } }],
  });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/transport') {
        const remote = new URL(url.searchParams.get('url'));
        const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks).toString();
        res.setHeader('Content-Type', 'application/json');
        if (remote.hostname === `us-central1-${PROJECT}.cloudfunctions.net` && remote.pathname === '/projectAuthority') {
          const input = JSON.parse(body || '{}');
          const result = await api.handle({ method: req.method, headers: req.headers, body: input });
          if (input.action === 'history_confirm' && result.status === 200 && loseNextConfirmation) {
            loseNextConfirmation = false; res.statusCode = 503; return res.end(JSON.stringify({ success: false, error: { message: 'Synthetic response lost after commit. Retry this save.' } }));
          }
          res.statusCode = result.status; return res.end(JSON.stringify(result.body));
        }
        if (remote.hostname === 'firestore.googleapis.com' && remote.pathname.startsWith(`/v1/projects/${PROJECT}/databases/(default)/documents`)
          && (req.method === 'GET' || (req.method === 'POST' && remote.pathname.endsWith(':batchGet')))) {
          const response = await fetch(`http://127.0.0.1:8398${remote.pathname}${remote.search}`, { method: req.method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, ...(body ? { body } : {}) });
          res.statusCode = response.status; return res.end(await response.text());
        }
        res.statusCode = 403; return res.end(JSON.stringify({ error: { message: 'Non-synthetic destination rejected.' } }));
      }
      if (url.pathname === '/app.js' || url.pathname === '/app.css') { res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css'); return res.end(fs.readFileSync(path.join(scratch, url.pathname.slice(1)))); }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><p>ISOLATED SYNTHETIC PREVIEW — NO PRODUCTION DATA</p><div id="app"></div><script src="/app.js"></script></body></html>');
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(8399, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:8399';
  if (process.argv.includes('--serve')) { await seed(); const published = await api.handle({ method: 'POST', headers: { authorization: 'Bearer demo-owner' }, body: { action: 'save', data: { project, expectedVersion: 0, requestId: 'synthetic-preview' } } }); assert.equal(published.status, 200); console.log(`Synthetic Projects preview: ${url}`); return; }
  try {
    const evidence = [];
    for (const [name, engine, width] of [['chromium-desktop', chromium, 1440], ['webkit-mobile', webkit, 390]]) {
      await seed(); loseNextConfirmation = name === 'chromium-desktop'; const browser = await engine.launch({ headless: true });
      const first = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const second = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const errors = [];
      for (const context of [first, second]) await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
      await first.addInitScript(project => localStorage.setItem('demac.erp-next.projects.preview.v1', JSON.stringify({ version: 1, selectedProjectId: project.id, projects: [project] })), project);
      const page = await first.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(url); await page.getByRole('button', { name: 'Open Phases', exact: true }).click();
      await page.getByRole('button', { name: 'Review shared Project', exact: true }).click();
      await page.getByRole('button', { name: 'Save shared Project', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Historical Project correction' });
      await panel.getByLabel('Cancelled booking').selectOption('DEMO-OLD');
      await panel.getByLabel('Replacement slots').fill('2');
      await panel.getByLabel('Correction reason').fill('Only two historical slots were used.');
      await panel.getByRole('checkbox').check(); await panel.getByRole('button', { name: 'Review correction', exact: true }).click();
      await panel.getByText('6 original slots (cancelled) → 2 replacement slots.').waitFor();
      await page.screenshot({ path: path.join(artifacts, `${name}-review.png`), fullPage: true });
      assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await panel.getByRole('button', { name: 'Save historical replacement', exact: true }).click();
      if (name === 'chromium-desktop') {
        await panel.getByText('Synthetic response lost after commit. Retry this save.').waitFor();
        await panel.getByRole('button', { name: 'Retry the same save', exact: true }).click();
      }
      await page.getByText('2 / 6 slots', { exact: true }).waitFor();
      await page.reload(); await page.getByText('2 / 6 slots', { exact: true }).waitFor();
      const other = await second.newPage(); other.on('pageerror', error => errors.push(error.message));
      await other.goto(url); await other.getByText('2 / 6 slots', { exact: true }).waitFor();
      assert.equal(await other.evaluate(() => localStorage.getItem('demac.erp-next.projects.preview.v1')), null);
      await other.getByRole('button', { name: 'More info' }).click();
      await other.getByText('Synthetic historical technician', { exact: false }).first().waitFor();
      await other.screenshot({ path: path.join(artifacts, `${name}-second-session.png`), fullPage: true });
      assert.equal((await db.collection('appointments').get()).size, 2); assert.deepEqual(errors, []);
      evidence.push({ name, sharedPublish: true, historical6To2: true, reload: true, emptyBrowserSecondSession: true, errors });
      await browser.close();
    }
    fs.writeFileSync(path.join(artifacts, 'browser-results.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
  } finally { await new Promise(resolve => server.close(resolve)); await db.terminate(); await deleteApp(app); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
