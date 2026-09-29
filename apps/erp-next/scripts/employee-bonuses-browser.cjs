// Real Employees + Finance components and version-checked REST writes, synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const output = process.env.BONUS_TEST_OUTPUT;
const paths = [process.env.BONUS_TEST_TOOLS, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
if (!output || !path.isAbsolute(output)) throw Error('Absolute BONUS_TEST_OUTPUT required');
const { build } = require(require.resolve('esbuild', { paths }));
const { chromium } = require(require.resolve('playwright', { paths }));
fs.mkdirSync(output, { recursive: true });
const employees = [{ id: 'staff-one', name: 'Synthetic One', active: true }, { id: 'staff-two', name: 'Synthetic Two', active: true }];
const seed = { 'legacy-one': { id: 'legacy-one', name: 'Synthetic One', weekdayHours: 8, payrollAdjustments: [{ id: 'legacy-bonus', employeeId: 'legacy-one', employeeName: 'Synthetic One', type: 'bonus', status: 'active', payrollPeriodId: '2026-08-27_2026-09-26', date: '2026-09-14', amountAfl: 100, concept: 'Legacy achievement', createdAt: '2026-09-14T12:00:00Z', updatedAt: '2026-09-14T12:00:00Z' }] } };
const stubs = {
  'auth-provider': `const principal={role:window.testRole||'super_admin',active:true,userId:'synthetic-operator',displayName:'Synthetic Operator',capabilities:new Set(window.testRole?[]:['payroll_sensitive.view'])};export function useAuth(){return {principal};}`,
  'canonical-operations': `export * from './lib/canonical-operations';export async function loadCanonicalOperationsState(){return {staffProfiles:${JSON.stringify(employees)},vans:[],vanHalfDaySchedules:[],staffAbsences:[]};}`,
  'firestore-rest': `export * from './lib/firebase/firestore-rest';export async function listFirestoreCollection(collection){window.payrollReads++;if(collection==='employeeTimesheets')return [];if(collection==='employeePayrollSettings')return Object.values(window.bonusDb);throw Error('Unexpected synthetic collection');}`,
  'session': `export * from './lib/firebase/session';export async function requireFirebaseWebSession(){return {idToken:'synthetic-test-only'};}`,
  'employee-directory-overview': `export function EmployeeDirectoryOverview(){return null;}`,
  'employee-profile-dialog': `export function EmployeeProfileDialog(){return null;}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {EmployeeWorkspace} from './components/employees/employee-workspace';import {EmployeePayrollWorkspace} from './components/employees/employee-payroll-workspace';import {encodeFirestoreFields,decodeFirestoreFields} from './lib/firebase/firestore-rest';
window.bonusDb=JSON.parse(sessionStorage.getItem('synthetic-bonus-data')||${JSON.stringify(JSON.stringify(seed))});window.payrollReads=0;window.patchCount=0;window.versions={};
window.fetch=async function(url,init){const parsed=new URL(url),id=decodeURIComponent(parsed.pathname.split('/').at(-1));if(parsed.hostname!=='firestore.googleapis.com'||!parsed.pathname.includes('/projects/demo-demac-bonuses/'))throw Error('Unexpected external request');if(window.denyWrites)return new Response(JSON.stringify({error:{status:'PERMISSION_DENIED',message:'Synthetic permission denial'}}),{status:403});const stamp=()=> '2026-09-14T12:00:00.'+String(window.versions[id]||1).padStart(6,'0')+'Z';if(init?.method==='PATCH'){if(window.bonusDb[id]&&parsed.searchParams.get('currentDocument.updateTime')!==stamp())return new Response(JSON.stringify({error:{status:'FAILED_PRECONDITION'}}),{status:409});window.bonusDb[id]={...window.bonusDb[id],...decodeFirestoreFields(JSON.parse(init.body).fields),id};window.versions[id]=(window.versions[id]||1)+1;window.patchCount++;sessionStorage.setItem('synthetic-bonus-data',JSON.stringify(window.bonusDb));}if(!window.bonusDb[id])return new Response('{}',{status:404});return new Response(JSON.stringify({name:parsed.pathname.slice(4),fields:encodeFirestoreFields(window.bonusDb[id]),updateTime:stamp()}),{status:200});};
createRoot(document.getElementById('app')).render(location.pathname.startsWith('/finance')?<EmployeePayrollWorkspace/>:<EmployeeWorkspace/>);`;
async function download(page, label, filename, quick = false) {
  if (quick) await page.locator('summary').filter({ hasText: 'Quick actions' }).click();
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await ready; await result.saveAs(path.join(output, filename));
  return fs.readFileSync(path.join(output, filename)).toString('latin1');
}
async function runCase(browser, origin, name, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage(); const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue();external.push(route.request().url());return route.abort(); });
  await page.clock.install({ time: new Date('2026-09-14T14:00:00Z') });
  try {
    await page.goto(origin); await page.getByRole('button', { name: 'Bonuses', exact: true }).click();
    await page.getByText('Legacy achievement', { exact: true }).waitFor();
    await page.getByLabel('Bonus amount', { exact: true }).fill('100');
    await page.getByLabel('Bonus reason', { exact: true }).fill('Approved perfect attendance');
    await page.getByRole('button', { name: 'Save Bonus', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Bonus saved' }).waitFor();
    await page.getByLabel('Bonus employee', { exact: true }).selectOption('staff-two');
    await page.getByLabel('Bonus type', { exact: true }).selectOption('equipment_sales');
    await page.getByLabel('Bonus amount', { exact: true }).fill('75.25');
    await page.getByLabel('Bonus reason', { exact: true }).fill('Approved equipment sale');
    await page.getByRole('button', { name: 'Save Bonus', exact: true }).click();
    await page.getByText('Approved equipment sale', { exact: true }).waitFor();
    assert.match(await page.getByLabel('Employee bonuses').innerText(), /Afl\. 275\.25/);
    await page.reload(); await page.getByRole('button', { name: 'Bonuses', exact: true }).click();
    await page.getByText('Approved equipment sale', { exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: 'Approved perfect attendance' }).getByRole('button', { name: 'Cancel bonus', exact: true }).click();
    await page.getByLabel('Bonus cancellation reason', { exact: true }).fill('Correction approved');
    await page.getByRole('button', { name: 'Confirm Cancellation', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Bonus cancelled' }).waitFor();
    await page.evaluate(() => { window.denyWrites = true; });
    await page.getByLabel('Bonus type', { exact: true }).selectOption('service_sales');
    await page.getByLabel('Bonus amount', { exact: true }).fill('15');
    await page.getByLabel('Bonus reason', { exact: true }).fill('Approved service commission');
    await page.getByRole('button', { name: 'Save Bonus', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic permission denial' }).waitFor();
    assert.equal(await page.getByLabel('Bonus amount', { exact: true }).inputValue(), '15');
    await page.evaluate(() => { window.denyWrites = false; });
    await page.getByRole('button', { name: 'Save Bonus', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Bonus saved' }).waitFor();
    assert.match(await page.getByLabel('Employee bonuses').innerText(), /Afl\. 190\.25/);
    const form = await page.getByRole('heading', { name: 'Add Bonus', exact: true }).locator('..').boundingBox();
    assert.ok(form && form.width <= viewport.width, 'Bonus form fits the viewport');
    await page.screenshot({ path: path.join(output, name + '-bonuses.png'), fullPage: true });
    const details = await download(page, 'Export Bonus Details', name + '-details.csv');
    assert.match(details, /Correction approved/); assert.match(details, /equipment_sales|Air Conditioner Sales/);
    const pdf = await download(page, 'Export payroll summary PDF', name + '-employees.pdf', true);
    assert.match(pdf, /Bonuses/); assert.match(pdf, /Afl. 190.25/);
    const csv = await download(page, 'Export accounting CSV', name + '-employees.csv', true);
    assert.match(csv, /Bonuses Afl/); assert.match(csv, /Approved equipment sale/);
    await page.goto(origin + '/finance/payroll/');
    const financePdf = await download(page, 'Download Payroll PDF', name + '-finance.pdf');
    assert.match(financePdf, /Afl. 190.25/);
    const financeCsv = await download(page, 'Summary CSV', name + '-finance.csv');
    assert.match(financeCsv, /Bonuses Afl/); assert.match(financeCsv, /Approved equipment sale/);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    return { name, result: 'PASS', externalRequests: 0, saves: 3, cancellations: 1, exports: 5 };
  } catch (error) {
    await page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, name + '-failure.txt'), await page.locator('body').innerText());
    throw error;
  } finally { await context.close(); }
}
async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-demac-bonuses', NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-demac-bonuses.firebaseapp.com', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-demac-bonuses.appspot.com', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic', NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: 'false' }) },
    plugins: [{ name: 'synthetic-bonus-adapters', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (args.namespace === 'synthetic') return;
        const key = path.basename(args.path);
        if (key === 'firestore-rest' || key === 'session' || key === 'auth-provider' || ((args.importer.endsWith('employee-workspace.tsx') || args.importer.endsWith('employee-payroll-workspace.tsx')) && stubs[key])) return { path: key, namespace: 'synthetic' };
      });
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: APP }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css');return res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); }
    res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:16px Arial;margin:12px;--canvas:#f5f7fb;--surface:#fff;--panel:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--brand:#1465ff;--success:#148158}*{box-sizing:border-box}</style></head><body><p>SYNTHETIC BONUS TEST — NO PRODUCTION CONNECTION</p><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true }); const results = [];
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) results.push(await runCase(browser, origin, name, viewport));
    const restricted = await browser.newContext(); const page = await restricted.newPage();
    await page.addInitScript(() => { window.testRole = 'technician'; });
    await page.goto(origin); await page.getByRole('heading', { name: 'Employees', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bonuses', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.payrollReads), 0);
    await restricted.close(); results.push({ name: 'restricted-role', result: 'PASS', payrollReads: 0 });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
