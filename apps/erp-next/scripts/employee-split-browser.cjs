// Real EmployeeWorkspace + save/calculation/payroll; synthetic read/write adapters only.
// This is isolated component verification, not a Firebase production test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const output = process.env.ATTENDANCE_TEST_OUTPUT;
const toolPaths = [process.env.ATTENDANCE_TEST_TOOLS, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
if (!output || !path.isAbsolute(output)) throw Error('Absolute ATTENDANCE_TEST_OUTPUT required');
const { build } = require(require.resolve('esbuild', { paths: toolPaths }));
const { chromium } = require(require.resolve('playwright', { paths: toolPaths }));
fs.mkdirSync(output, { recursive: true });

const stubs = {
  'auth-provider': `const principal={role:'super_admin',userId:'synthetic-operator',displayName:'Test Operator',capabilities:new Set(['payroll_sensitive.view'])};export function useAuth(){return {principal};}`,
  'canonical-operations': `export * from './lib/canonical-operations';export async function loadCanonicalOperationsState(){return {staffProfiles:[{id:'synthetic-employee',name:'Synthetic Employee',active:true}],vans:[],vanHalfDaySchedules:[],staffAbsences:[]};}`,
  'firestore-rest': `export * from './lib/firebase/firestore-rest';export async function listFirestoreCollection(){return [];}export async function mutateFirestoreDocumentWithReads(collection,id,readIds,fn){const current=window.saved.filter(x=>x.id===id).at(-1)||null;const changes=fn(current,Object.fromEntries([id,...readIds].map(key=>[key,window.saved.filter(x=>x.id===key).at(-1)||null])));if(!changes)return current;const document={...current,...changes,id};window.saved.push(structuredClone(document));return document;}export async function saveFirestoreDocument(collection,document){if(collection!=='employeeTimesheets')throw Error('Unexpected collection');window.saved.push(structuredClone(document));return document;}`,
  'employee-directory-overview': `export function EmployeeDirectoryOverview(){return null;}`,
  'employee-profile-dialog': `export function EmployeeProfileDialog(){return null;}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {EmployeeWorkspace} from './components/employees/employee-workspace';window.saved=[];createRoot(document.getElementById('app')).render(<EmployeeWorkspace/>);`;

async function runCase(browser, origin, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.clock.install({ time: new Date('2026-09-14T14:00:00.000Z') });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Employee Calendar', exact: true }).click();
  await page.getByRole('checkbox', { name: /Split shift/ }).check();
  await page.getByLabel('Interval 2 Clock In', { exact: true }).fill('19:30');
  await page.getByLabel('Interval 2 Clock Out', { exact: true }).fill('05:00');
  await page.getByLabel('Interval 2 Clock out next day', { exact: true }).check();
  await page.getByText('Time between intervals excluded:', { exact: false }).filter({ hasText: '2h 30m' }).waitFor();
  await page.getByRole('button', { name: 'Split rates', exact: true }).click();
  await page.getByLabel('Allocation 1 hours', { exact: true }).fill('2');
  await page.getByLabel('Allocation 1 minutes', { exact: true }).fill('30');
  await page.getByLabel('Allocation 2 hours', { exact: true }).fill('7');
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic emergency overtime allocation');
  await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
  await page.waitForFunction(() => window.saved.length === 1);
  let saved = await page.evaluate(() => window.saved.at(-1));
  assert.equal(saved.regularHours, 8); assert.equal(saved.workedMinutes, 1050);
  assert.equal(saved.overtimeMinutes, 570);
  assert.deepEqual(saved.overtimePayAllocations, [{rate:150,minutes:150},{rate:200,minutes:420}]);
  assert.equal(saved.attendanceHistory.length, 1);
  await page.screenshot({ path: path.join(output, name + '-split.png'), fullPage: true });
  // A rate-only edit preserves the saved times and appends history.
  await page.getByRole('button', { name: 'All at 200%', exact: true }).click();
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic 200% approval');
  await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
  await page.waitForFunction(() => window.saved.length === 2);
  saved = await page.evaluate(() => window.saved.at(-1));
  assert.equal(saved.overtimeMinutes, 570); assert.equal(saved.workedMinutes, 1050);
  assert.deepEqual(saved.overtimePayAllocations, [{rate:200,minutes:570}]);
  assert.equal(saved.attendanceHistory.length, 2);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await context.close();
  return { name, result: 'PASS', externalRequests: 0, saves: 2 };
}

async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-demac-attendance', NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: 'false' }) },
    plugins: [{ name: 'synthetic-attendance-adapters', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (args.namespace === 'synthetic') return;
        const key = path.basename(args.path);
        if (key === 'firestore-rest' || (args.importer.endsWith('employee-workspace.tsx') && stubs[key])) return { path: key, namespace: 'synthetic' };
      });
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: APP }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css'); return res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); }
    res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:16px Arial;--canvas:#f5f7fb;--surface:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--brand:#1465ff;--success:#148158}*{box-sizing:border-box}</style></head><body><p>SYNTHETIC ATTENDANCE TEST — NO PRODUCTION CONNECTION</p><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) results.push(await runCase(browser, origin, name, viewport));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));console.log(JSON.stringify(results));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
