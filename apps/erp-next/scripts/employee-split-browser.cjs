// Real EmployeeWorkspace + save/calculation/payroll; synthetic read/write adapters only.
// --emulator retains real session, HTTP persistence and unmodified Firestore Rules.
// Both modes are isolated verification, never a Firebase production test.
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
const emulator = process.argv.includes('--emulator') ? require('./test-support/attendance-emulator.cjs') : null;
let storage, principal;
if (emulator) {
  emulator.configure();
  storage = require('../.employee-attendance-test/apps/erp-next/lib/firebase/firestore-rest');
}

const historical = { id: 'synthetic-employee_2026-09-11', employeeId: 'synthetic-employee', employeeName: 'Synthetic Employee', date: '2026-09-11', payrollPeriodId: '2026-08-27_2026-09-26', regularHours: 8, scheduledWorkHours: 8, overtimeHours: 2275 / 60, overtimeMinutes: 2275, aoHours: 0, vacationHours: 0, noWorkNoPayHours: 0, paidFreeHours: 0, status: 'Regular', notes: 'Synthetic historical OT without rate' };
const stubs = {
  'auth-provider': `const principal={role:'super_admin',userId:'synthetic-operator',displayName:'Test Operator',capabilities:new Set(['payroll_sensitive.view'])};export function useAuth(){return {principal};}`,
  'canonical-operations': `export * from './lib/canonical-operations';export async function loadCanonicalOperationsState(){return {staffProfiles:[{id:'synthetic-employee',name:'Synthetic Employee',active:true}],vans:[],vanHalfDaySchedules:[],staffAbsences:[]};}`,
  'firestore-rest': `export * from './lib/firebase/firestore-rest';export async function listFirestoreCollection(collection){return collection==='employeeTimesheets'?[window.historical]:[];}export async function mutateFirestoreDocumentWithReads(collection,id,readIds,fn){const current=window.saved.filter(x=>x.id===id).at(-1)||null;const changes=fn(current,Object.fromEntries([id,...readIds].map(key=>[key,window.saved.filter(x=>x.id===key).at(-1)||null])));if(!changes)return current;const document={...current,...changes,id};window.saved.push(structuredClone(document));return document;}export async function saveFirestoreDocument(collection,document){if(collection!=='employeeTimesheets')throw Error('Unexpected collection');window.saved.push(structuredClone(document));return document;}`,
  'employee-directory-overview': `export function EmployeeDirectoryOverview(){return null;}`,
  'employee-profile-dialog': `export function EmployeeProfileDialog(){return null;}`,
};
if (emulator) {
  stubs['firestore-rest'] = `export * from './lib/firebase/firestore-rest';`;
  stubs['auth-provider'] = `export function useAuth(){return {principal:{role:'super_admin',userId:window.syntheticUid,displayName:'Synthetic Admin',capabilities:new Set(['payroll_sensitive.view'])}};}`;
}
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {EmployeeWorkspace} from './components/employees/employee-workspace';${emulator ? `import {signInWithFirebaseEmail} from './lib/firebase/session';async function start(){const session=await signInWithFirebaseEmail('browser@attendance.invalid','Synthetic-attendance-test-123!');window.syntheticUid=session.uid;createRoot(document.getElementById('app')).render(<EmployeeWorkspace/>);}start();` : `window.saved=[];window.historical=${JSON.stringify(historical)};createRoot(document.getElementById('app')).render(<EmployeeWorkspace/>);`}`;

async function runCase(browser, origin, name, viewport, scenario = 'split') {
  const workDate = scenario === 'overnight' ? '2026-10-20' : '2026-09-14';
  if (emulator) { await emulator.reset(); principal = await emulator.account(storage, 'browser', 'admin'); await emulator.seed(storage, 'employeeTimesheets/' + historical.id, historical); }
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [], external = [], rpc = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    if (emulator) {
      const url = route.request().url();
      let destination;
      try { destination = emulator.destination(url); } catch { external.push(url); return route.abort(); }
      if (url.includes('firestore.googleapis.com')) {
        rpc.push(new URL(url).pathname.split(':').at(-1));
        assert.ok(!url.endsWith(':beginTransaction') && !url.endsWith(':rollback'));
      }
      // Forward the actual browser method/body/Authorization unchanged to the
      // emulator. No mocked response, persistence, session or Rules decision.
      const response = await route.fetch({ url: destination });
      return route.fulfill({ response });
    }
    external.push(route.request().url()); return route.abort();
  });
  await page.clock.install({ time: new Date(workDate + 'T14:00:00.000Z') });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Employee Calendar', exact: true }).click();
  const waitForAcceptedSave = async (count) => {
    // A committed document may be visible before the response reaches React.
    // Start the next user action only after the UI accepts that save and resets its reason.
    await page.getByText('Attendance history · '+count+' changes',{exact:true}).waitFor();
    const reason=await page.getByLabel('Reason for this change (required)',{exact:true}).elementHandle();
    await page.waitForFunction(input=>input.value==='',reason);
  };
  const readSaved = async (count) => {
    if (!emulator) { await page.waitForFunction(n => window.saved.length === n, count); await waitForAcceptedSave(count); return page.evaluate(() => window.saved.at(-1)); }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const row = await emulator.get(storage, 'employeeTimesheets/synthetic-employee_' + workDate);
      if (row?.attendanceHistory?.length === count) { await waitForAcceptedSave(count); return row; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await page.screenshot({path:path.join(output,name+'-'+scenario+'-failure.png'),fullPage:true});
    fs.writeFileSync(path.join(output,name+'-'+scenario+'-failure.json'),JSON.stringify({errors,rpc,expectedHistory:count,saved:await emulator.get(storage,'employeeTimesheets/synthetic-employee_'+workDate),visibleText:await page.locator('body').innerText()},null,2));
    throw Error('Authenticated browser save did not reach Firestore: '+name+'/'+scenario+' history '+count);
  };
  if (scenario === 'overnight') {
    await page.getByLabel('Clock In', { exact: true }).fill('15:00');
    await page.getByLabel('Clock Out', { exact: true }).fill('05:00');
    await page.getByLabel('Break Minutes', { exact: true }).fill('0');
    await page.getByText('Clock Out must follow Clock In. Select Clock out next day for overnight work.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isDisabled(), true);
    await page.getByRole('checkbox', { name: 'Clock out next day', exact: true }).check();
    await page.getByRole('checkbox', { name: /Adjust scheduled shift for this day/ }).check();
    await page.getByLabel('Scheduled start', { exact: true }).fill('15:00');
    await page.getByLabel('Scheduled end', { exact: true }).fill('00:00');
    await page.getByRole('checkbox', { name: 'Scheduled end is next day', exact: true }).check();
    await page.getByLabel('Scheduled break (min)', { exact: true }).fill('60');
    await page.getByRole('button', { name: 'All at 200%', exact: true }).click();
    await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic continuous overnight 200% approval');
    await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
    let saved = await readSaved(1);
    assert.equal(saved.workedMinutes,840); assert.equal(saved.regularHours,8); assert.equal(saved.overtimeMinutes,360);
    assert.equal(saved.breakMinutes,0); assert.equal(saved.scheduledBreakMinutes,60); assert.equal(saved.scheduledEndDayOffset,1);
    assert.equal(saved.workIntervals.length,1); assert.equal(saved.attendanceShiftRevision,1);
    assert.deepEqual(saved.attendanceShiftOverride,{startTime:'15:00',endTime:'00:00',endDayOffset:1,breakMinutes:60});
    assert.deepEqual(saved.overtimePayAllocations,[{rate:200,minutes:360}]);
    await page.screenshot({path:path.join(output,name+'-overnight-200.png'),fullPage:true});
    if (emulator) {
      await page.reload();
      await page.getByRole('button', {name:'Employee Calendar',exact:true}).click();
      await page.getByLabel('Clock In',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Clock In',{exact:true}).inputValue(),'15:00');
      assert.equal(await page.getByLabel('Clock Out',{exact:true}).inputValue(),'05:00');
      assert.equal(await page.getByLabel('Break Minutes',{exact:true}).inputValue(),'0');
      assert.equal(await page.getByRole('checkbox',{name:'Clock out next day',exact:true}).isChecked(),true);
      assert.equal(await page.getByRole('checkbox',{name:/Split shift/}).isChecked(),false);
      assert.equal(await page.getByLabel('Scheduled start',{exact:true}).inputValue(),'15:00');
      await page.getByLabel('Notes',{exact:true}).fill('Synthetic persisted shift note');
      await page.getByLabel('Reason for this change (required)',{exact:true}).fill('Synthetic persisted shift edit');
      await page.getByRole('button',{name:'Save Exception',exact:true}).click();
      saved=await readSaved(2);
      assert.equal(saved.attendanceShiftRevision,2);assert.equal(saved.workedMinutes,840);assert.equal(saved.overtimeMinutes,360);
      assert.deepEqual(saved.overtimePayAllocations,[{rate:200,minutes:360}]);
      await page.screenshot({path:path.join(output,name+'-overnight-persisted.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await context.close();
    return {name,scenario,result:'PASS',externalRequests:0,workedMinutes:840,regularMinutes:480,ot200Minutes:360,persistence:emulator?'real Auth + Firestore Rules, reload verified':'synthetic adapter'};
  }
  await page.getByRole('checkbox', { name: /Split shift/ }).check();
  await page.getByLabel('Interval 2 Clock In', { exact: true }).fill('19:30');
  await page.getByLabel('Interval 2 Clock Out', { exact: true }).fill('05:00');
  await page.getByLabel('Interval 2 Clock out next day', { exact: true }).check();
  await page.getByText('Time between intervals excluded:', { exact: false }).filter({ hasText: '2h 30m' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'All at 150%', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic default regular overtime');
  await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
  let saved = await readSaved(1);
  assert.equal(saved.overtimeMinutes, 570);
  assert.equal(saved.overtimePayAllocations, undefined);
  assert.equal(saved.attendanceHistory.length, 1);
  await page.screenshot({ path: path.join(output, name + '-default-150.png'), fullPage: true });
  await page.getByRole('button', { name: 'Split rates', exact: true }).click();
  await page.getByLabel('Allocation 1 hours', { exact: true }).fill('2');
  await page.getByLabel('Allocation 1 minutes', { exact: true }).fill('30');
  await page.getByLabel('Allocation 2 hours', { exact: true }).fill('7');
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic emergency overtime allocation');
  await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
  saved = await readSaved(2);
  assert.equal(saved.regularHours, 8); assert.equal(saved.workedMinutes, 1050);
  assert.equal(saved.overtimeMinutes, 570);
  assert.deepEqual(saved.overtimePayAllocations, [{rate:150,minutes:150},{rate:200,minutes:420}]);
  assert.equal(saved.attendanceHistory.length, 2);
  await page.screenshot({ path: path.join(output, name + '-split.png'), fullPage: true });
  // A rate-only edit preserves the saved times and appends history.
  await page.getByRole('button', { name: 'All at 200%', exact: true }).click();
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic 200% approval');
  await page.getByRole('button', { name: 'Save Exception', exact: true }).click();
  saved = await readSaved(3);
  assert.equal(saved.overtimeMinutes, 570); assert.equal(saved.workedMinutes, 1050);
  assert.deepEqual(saved.overtimePayAllocations, [{rate:200,minutes:570}]);
  assert.equal(saved.attendanceHistory.length, 3);
  const breakdown = page.getByRole('heading', { name: 'Payroll breakdown · selected period', exact: true }).locator('..');
  assert.deepEqual(await breakdown.locator('tbody td').allTextContents().then(rows => rows.slice(1)), ['47h 25m', '37h 55m', '9h 30m']);
  assert.equal(await page.getByText('Rate not assigned', { exact: true }).count(), 0);
  await page.locator('summary').filter({ hasText: 'Quick actions' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export accounting CSV', exact: true }).click();
  const download = await downloadPromise;
  const csvPath = path.join(output, name + '-accounting.csv');
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.ok(csv.includes('Regular OT 150%,Special OT 200%,OT Rate Review'));
  assert.ok(csv.split('\n')[1].endsWith(',37.92,9.50,'));
  if (emulator) {
    assert.equal(saved.updatedByUserId, principal.uid);
    assert.equal(await emulator.get(storage, 'employeeTimesheets/synthetic-employee_2026-09-13'), null);
    assert.equal(await emulator.get(storage, 'employeeTimesheets/synthetic-employee_2026-09-15'), null);
    assert.equal(rpc.filter(x => x === 'commit').length, 3);
    assert.equal(rpc.filter(x => x === 'batchGet').length, 3);
    assert.deepEqual(await emulator.get(storage, 'employeeTimesheets/' + historical.id), historical);
    await page.reload();
    await page.getByRole('button', { name: 'Employee Calendar', exact: true }).click();
    await page.getByLabel('Interval 2 Clock In', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Interval 2 Clock In', { exact: true }).inputValue(), '19:30');
    await page.screenshot({ path: path.join(output, name + '-persisted-200.png'), fullPage: true });
  }
  await page.getByLabel('Interval 2 Clock Out', { exact: true }).fill('06:00');
  assert.equal(await page.getByLabel('Allocation 1 rate', { exact: true }).inputValue(), '200');
  assert.equal(await page.getByLabel('Allocation 1 hours', { exact: true }).inputValue(), '9');
  await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic changed duration');
  assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isDisabled(), true);
  await page.getByText('Assigned overtime must exactly match calculated overtime.', { exact: true }).waitFor();
  if (emulator) {
    // Malformed stored data stays visible as a warning and cannot be silently resaved.
    await emulator.seed(storage, 'employeeTimesheets/synthetic-employee_2026-09-14', { ...saved, overtimePayAllocations: { rate: 200, minutes: 570 } });
    assert.deepEqual((await emulator.get(storage, 'employeeTimesheets/synthetic-employee_2026-09-14')).overtimePayAllocations, { rate: 200, minutes: 570 });
    await page.reload();
    await page.getByRole('button', { name: 'Employee Calendar', exact: true }).click();
    await page.getByText('Recorded overtime rates need review. Select a complete, valid allocation before saving.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'All at 150%', exact: true }).click();
    await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic explicit rate correction');
    assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isEnabled(), true);
    // Empty legacy selections retain the writer's reason requirement even without split mode.
    const { workIntervals: _intervals, ...ordinary } = saved;
    await emulator.seed(storage, 'employeeTimesheets/synthetic-employee_2026-09-14', { ...ordinary, overtimeMinutes: 0, overtimeHours: 0, workedMinutes: 480, overtimePayAllocations: [] });
    await page.reload();
    await page.getByRole('button', { name: 'Employee Calendar', exact: true }).click();
    await page.getByLabel('Reason for this change (required)', { exact: true }).waitFor();
    await page.getByLabel('Notes', { exact: true }).fill('Synthetic legacy note');
    assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isDisabled(), true);
    await page.getByLabel('Reason for this change (required)', { exact: true }).fill('Synthetic legacy update');
    assert.equal(await page.getByRole('button', { name: 'Save Exception', exact: true }).isEnabled(), true);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await context.close();
  return { name, result: 'PASS', externalRequests: 0, saves: 3, persistence: emulator ? 'real Auth + Firestore emulators, repository Rules, reload verified' : 'synthetic adapter' };
}

async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', ...Object.fromEntries(['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID'].map(k => ['NEXT_PUBLIC_FIREBASE_'+k, 'demo-demac-attendance'])), NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: 'false' }) },
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
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) for (const scenario of ['split','overnight']) results.push(await runCase(browser, origin, name, viewport, scenario));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));console.log(JSON.stringify(results));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
