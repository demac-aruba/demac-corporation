// Real Projects page and read service, synthetic Firestore/auth only. No production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.BUDGET_TEST_TOOLS;
if (!tooling || !path.isAbsolute(tooling)) throw Error('BUDGET_TEST_TOOLS must be an isolated absolute tooling path.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tooling, 'node_modules/playwright'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-slot-progress-'));
const artifacts = path.resolve(process.env.PROJECT_SLOT_TEST_OUTPUT || path.join(APP, '../../project-slot-progress-evidence'));
fs.mkdirSync(artifacts, { recursive: true });
const ids = Array.from({ length: 13 }, (_, i) => `WO-${i}`);
const project = {
  id: 'SYNTHETIC-PROJECT', projectNumber: 'PRJ-SYNTHETIC', name: 'Synthetic VRF Project', customerId: 'SYNTHETIC-CUSTOMER',
  customerName: 'Synthetic customer', siteId: 'SYNTHETIC-SITE', location: 'Synthetic site', contactPerson: '', type: 'VRF Project',
  status: 'Planned', priority: 'Normal', managerId: '', managerName: 'Synthetic manager', startsOn: '2026-09-01', estimatedCompletionOn: '2026-09-30',
  totalUnits: 10, completedUnits: 0, unitType: 'Units', estimatedWorkDays: 11, slotsPerWorkDay: 6, slotDurationMinutes: 60,
  estimatedSlots: 66, estimatedLaborHours: 66, actualLaborHours: 0, scheduledFutureHours: 75, materialBudget: null, materialActual: 0,
  assignedVans: [], phases: [], materials: [], expenses: [], costEntries: [],
  assignments: ids.map((id) => ({ id: `LINK-${id}`, projectId: 'SYNTHETIC-PROJECT', phaseId: 'GENERAL-PROJECT-WORK', vanId: 'VAN-1',
    technicianIds: [], scheduledHours: 6, actualHours: 0, unitsPlanned: 0, unitsCompleted: 0, status: 'Scheduled', appointmentId: `APT-${id}`, workOrderId: id })).reverse(),
};
const docs = Object.fromEntries(ids.map((id, i) => [`workOrders/${id}`, { id, appointmentId: `APT-${id}`, clientId: project.customerId,
  propertyId: project.siteId, date: `2026-09-${String(i + 1).padStart(2, '0')}`, time: '08:30', vanId: 'VAN-1', status: 'Confirmada',
  scheduledSlots: i === 12 ? 3 : 6, technicianIds: ['TECH-1', 'TECH-2', 'TECH-3'] }]));
for (let i = 1; i <= 3; i++) docs[`staffProfiles/TECH-${i}`] = { id: `TECH-${i}`, name: `Synthetic technician ${i}` };
docs['employeeTimesheets/TECH-1_2026-09-01'] = { id: 'TECH-1_2026-09-01', employeeId: 'TECH-1', date: '2026-09-01', attendanceStatus: 'Present', clockInTime: '08:00', clockOutTime: '17:00' };
const stubs = {
  auth: `import {useState,useEffect} from 'react'; export function useAuth(){const [p,setP]=useState(window.__principal);useEffect(()=>{const fn=()=>setP({...window.__principal,capabilities:new Set(window.__principal.capabilities)});window.addEventListener('auth-test',fn);return()=>window.removeEventListener('auth-test',fn);},[]);return {principal:p};}`,
  session: `export async function requireFirebaseWebSession(){return {idToken:'synthetic-test-token'};}`,
};
async function main() {
  await build({ absWorkingDir: APP, stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectsPage from './app/(erp)/projects/page';import './app/globals.css';createRoot(document.getElementById('app')).render(<ProjectsPage/>);`, loader: 'tsx', resolveDir: APP },
    outfile: path.join(scratch, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-demac-slot-progress', NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic.invalid', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'synthetic.invalid', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'synthetic', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic' }) },
    plugins: [{ name: 'synthetic-read-boundary', setup(builder) {
      builder.onResolve({ filter: /auth-provider|\/session$/ }, (args) => {
        if (args.path.endsWith('auth-provider')) return { path: 'auth', namespace: 'slot-test' };
        if (args.importer.endsWith('firestore-rest.ts')) return { path: 'session', namespace: 'slot-test' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'slot-test' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: APP }));
    } }],
  });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    if (name === '/app.js' || name === '/app.css') { res.setHeader('Content-Type', name.endsWith('js') ? 'application/javascript' : 'text/css'); return res.end(fs.readFileSync(path.join(scratch, name.slice(1)))); }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:24px}#app{max-width:1600px;margin:auto}@media(max-width:560px){body{padding:8px}}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const [device, width] of [['desktop', 1440], ['mobile', 390]]) {
          const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
          const unexpected = [], errors = [];
          await context.route('**/*', async (route) => {
            const request = route.request(), requestUrl = new URL(request.url());
            if (requestUrl.origin === url) return route.continue();
            if (requestUrl.origin !== 'https://firestore.googleapis.com') { unexpected.push(request.url()); return route.abort(); }
            assert.equal(request.headers().authorization, 'Bearer synthetic-test-token');
            const prefix = 'projects/demo-demac-slot-progress/databases/(default)/documents/';
            const isBatch = requestUrl.pathname === '/v1/' + prefix.slice(0, -1) + ':batchGet';
            const body = isBatch ? request.postDataJSON() : null;
            assert.equal(request.method(), isBatch ? 'POST' : 'GET');
            if (isBatch) {
              assert.ok(body.documents.length <= 20);
              assert.deepEqual([...body.mask.fieldPaths].sort(), ['appointmentId','clientId','propertyId','date','time','vanId','status','scheduledSlots','technicianIds'].sort());
              assert.ok(body.documents.every(name => name.startsWith(prefix + 'workOrders/')));
            }
            const keys = isBatch ? body.documents.map(name => name.slice(prefix.length)) : [decodeURIComponent(requestUrl.pathname.slice(('/v1/' + prefix).length))];
            const state = await request.frame().evaluate((keys) => {
              window.__requests = (window.__requests || 0) + 1; window.__reads.push(...keys);
              return {values: keys.map(key => window.__docs[key] ?? null), delay: window.__slow || 5, fail: keys.includes(window.__fail)};
            }, keys);
            await new Promise(resolve => setTimeout(resolve, state.delay));
            if (state.fail) return route.fulfill({status: 403, json: {error:{message:'Synthetic denied read'}}});
            function encode(value) {
              if (value === null) return {nullValue:'NULL_VALUE'};
              if (Array.isArray(value)) return {arrayValue:{values:value.map(encode)}};
              if (typeof value === 'number') return {integerValue:String(value)};
              return {stringValue:value};
            }
            const documents = state.values.map((value, i) => value ? {name: prefix + keys[i], fields: Object.fromEntries(Object.entries(value).filter(([key]) => !isBatch || body.mask.fieldPaths.includes(key)).map(([key,value]) => [key,encode(value)]))} : null);
            if (isBatch) return route.fulfill({json: documents.map((doc, i) => doc ? {found: doc} : {missing: prefix + keys[i]}).reverse()});
            return route.fulfill({status: documents[0] ? 200 : 404, json: documents[0] || {}});
          });
          await context.addInitScript(({ project, docs }) => {
            localStorage.setItem('demac.erp-next.projects.preview.v1', JSON.stringify({ version: 1, selectedProjectId: project.id, projects: [project] }));
            window.__docs = docs; window.__reads = []; window.__principal = { userId: 'SYNTHETIC-OWNER', displayName: 'Synthetic owner', role: 'super_admin', active: true,
              capabilities: new Set(['projects.view', 'projects.manage', 'work_orders.view', 'payroll_sensitive.view']) };
          }, { project, docs });
          const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (error) => errors.push(error.message));
          try {
            await page.goto(url);
            const budget = page.getByRole('region', { name: 'Van slot budget · Synthetic VRF Project' });
            await budget.getByText('75 / 66 slots', { exact: true }).waitFor();
            await budget.getByText('+9 slots over budget', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.__requests), 1, '13 linked orders load in one real REST batch.');
            assert.equal(await budget.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
            const color = await budget.getByRole('progressbar').locator('i').evaluate((e) => getComputedStyle(e).backgroundColor);
            assert.equal(color, 'rgb(224, 79, 95)');
            await page.screenshot({ path: path.join(artifacts, `${name}-${device}-budget.png`), fullPage: true });
            await budget.getByRole('button', { name: 'More info' }).click();
            const dialog = page.getByRole('dialog', { name: 'Slot progress · Synthetic VRF Project' });
            await dialog.getByText('Present · 08:00–17:00', { exact: true }).waitFor();
            assert.deepEqual(await dialog.locator('ol > li > div > strong').allTextContents(), ids.map((_, i) => `2026-09-${String(i + 1).padStart(2, '0')} · 08:30`));
            await page.screenshot({ path: path.join(artifacts, `${name}-${device}-detail.png`), fullPage: true });
            assert.ok(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'dialog must fit mobile viewport');
            // Slot corrections and explicit attendance corrections on an old date.
            await page.evaluate(() => { window.__docs['workOrders/WO-0'].scheduledSlots = 0; window.__docs['workOrders/WO-1'].status = 'Cancelada'; window.__docs['employeeTimesheets/TECH-1_2026-09-01'].attendanceStatus = 'Absent'; });
            await dialog.getByRole('button', { name: 'Refresh progress' }).click();
            await budget.getByText('63 / 66 slots', { exact: true }).waitFor();
            await dialog.getByText('Absent', { exact: true }).waitFor();
            assert.equal(await budget.getByRole('progressbar').locator('i').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(23, 105, 224)');
            // Return-to-tab refresh, removal and an additional linked historical booking.
            await page.evaluate(() => { window.__docs['workOrders/WO-2'] = null; window.dispatchEvent(new Event('focus')); });
            await budget.getByText('57 / 66 slots', { exact: true }).waitFor();
            await page.evaluate(() => {
              const key = 'demac.erp-next.projects.preview.v1'; const state = JSON.parse(localStorage.getItem(key));
              const link = { ...state.projects[0].assignments[0], id: 'LINK-BACKDATE', workOrderId: 'WO-BACKDATE', appointmentId: 'APT-BACKDATE' };
              state.projects[0].assignments.push(link);
              window.__docs['workOrders/WO-BACKDATE'] = { ...window.__docs['workOrders/WO-3'], id: 'WO-BACKDATE', appointmentId: 'APT-BACKDATE', date: '2026-08-01' };
              localStorage.setItem(key, JSON.stringify(state)); window.dispatchEvent(new StorageEvent('storage', { key }));
            });
            await budget.getByText('63 / 66 slots', { exact: true }).waitFor();
            assert.equal(await dialog.locator('ol > li > div > strong').first().textContent(), '2026-08-01 · 08:30');
            // Read failure cannot look like a current zero; recovery restores full budget.
            await page.evaluate(() => { window.__fail = 'workOrders/WO-3'; });
            await dialog.getByRole('button', { name: 'Refresh progress' }).click();
            await budget.getByText('Verified subtotal · incomplete', { exact: true }).waitFor();
            assert.equal(await budget.getByRole('progressbar').getAttribute('aria-valuenow'), null);
            await page.evaluate(() => { window.__fail = ''; });
            await dialog.getByRole('button', { name: 'Refresh progress' }).click();
            await budget.getByText('63 / 66 slots', { exact: true }).waitFor();
            await page.waitForFunction(() => !document.querySelector('dialog button:disabled'));
            // Removing payroll access clears cached attendance immediately and stops reads.
            await page.evaluate(() => { window.__principal.capabilities = new Set(['projects.view', 'projects.manage', 'work_orders.view']); window.dispatchEvent(new Event('auth-test')); });
            await dialog.getByText('Attendance access required', { exact: true }).first().waitFor();
            const before = await page.evaluate(() => window.__reads.filter((key) => key.startsWith('employeeTimesheets/')).length);
            await dialog.getByRole('button', { name: 'Refresh progress' }).click();
            await page.waitForFunction(() => !document.querySelector('dialog button:disabled'));
            assert.equal(await page.evaluate(() => window.__reads.filter((key) => key.startsWith('employeeTimesheets/')).length), before);
            await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
            // A late response from the previous session cannot render after access is lost.
            await page.evaluate(() => { window.__slow = 150; window.dispatchEvent(new Event('focus')); window.__principal.active = false; window.dispatchEvent(new Event('auth-test')); });
            await page.getByText('Projects access required', { exact: true }).waitFor();
            await page.waitForTimeout(400);
            assert.equal(await page.getByRole('progressbar').count(), 0);
            assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
            results.push({ browser: name, device, result: 'PASS', checked: ['75/66 red +9', 'chronological crew detail', 'backdated slots and attendance refresh', 'automatic focus refresh', 'removed and added backdated allocation', 'incomplete/recovery', 'payroll access revocation', 'stale-session suppression', 'no external requests'] });
            console.log(`PASS: ${name} ${device} Project slot progress`);
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
