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
const { arubaDateParts, addDays } = require(path.join(ROOT, 'functions/bookingSchedulingPrimitives'));
const { createOfficeBookingAuthorityFacade } = require(path.join(ROOT, 'functions/officeBookingAuthorityFacade'));
assertIsolated();
fs.mkdirSync(output, { recursive: true });
const firebase = initializeApp({ projectId: PROJECT });
const db = getFirestore(firebase);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async token => {
  if (token !== 'synthetic-overtime-token') throw Error('Synthetic token required');
  return { uid: 'demo-office' };
} });
const today = arubaDateParts(new Date()).date;
let date = addDays(today, 1);
if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) date = addDays(date, 1);
const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const stubs = {
  'auth-provider': `const principal={userId:'demo-office',displayName:'Synthetic office operator',active:true,capabilities:new Set(['scheduling.view','scheduling.manage'])};export function useAuth(){return {principal,refreshPrincipal:async()=>{}};}`,
  'session': `export async function requireFirebaseWebSession(){return {uid:'demo-office',idToken:'synthetic-overtime-token'};}`,
  'isolated-preview': `export function firebaseTransportUrl(url){const u=new URL(url);if(u.hostname==='firestore.googleapis.com')return '/firestore'+u.pathname+u.search;if(u.hostname==='us-central1-demo-demac-overtime.cloudfunctions.net'&&u.pathname==='/officeBookingAuthority')return '/authority';throw Error('Non-synthetic destination rejected: '+u.hostname);}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {LiveSchedulingOverview} from './components/scheduling/live-scheduling-overview';import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';createRoot(document.getElementById('app')).render(<div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><LiveSchedulingOverview/></div>);`;
const actions = [];
let loseCreateResponse = false;
async function main() {
  await resetSynthetic(db, date);
  await db.doc('clients/DEMO-CUSTOMER').update({ name: 'Synthetic overtime customer' });
  await db.doc('properties/DEMO-PROPERTY').update({ name: 'Synthetic overtime property' });
  await db.doc('vanHalfDaySchedules/REST-VAN-2').set({ vanId: 'VAN-2', weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), active: true, workdayStart: '08:00', workdayEnd: '13:00', extraMorningSlot: '11:30' });
  await db.doc('vans/VAN-4').update({ status: 'Fuera de servicio' });
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
      if (req.url === '/authority') {
        const requestBody = JSON.parse(body.toString());
        actions.push(requestBody);
        const result = await facade.handle({ method: req.method, headers: req.headers, body: requestBody });
        if (loseCreateResponse && requestBody.action === 'create_rest_day_overtime' && result.status === 200) { loseCreateResponse = false; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
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
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] });
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
    await page.goto(origin);
    await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).click();
    const van2 = page.getByRole('region', { name: 'Van 2 schedule', exact: true });
    await van2.getByRole('button', { name: 'BOOK OVERTIME', exact: true }).first().waitFor();
    assert.equal(await van2.getByRole('button', { name: 'BOOK OVERTIME', exact: true }).count(), 3);
    assert.equal(await page.getByRole('region', { name: 'Van 4 schedule', exact: true }).getByRole('button', { name: 'BOOK OVERTIME' }).count(), 0);
    assert.equal(await van2.getByRole('button', { name: '＋ AFTER-HOURS / EMERGENCY' }).isEnabled(), true);
    await page.screenshot({ path: path.join(output, 'weekly-rest-slots.png'), fullPage: true });
    // First warning cancelled: no drawer and no write.
    acceptDialog = false;
    await van2.getByRole('button', { name: 'BOOK OVERTIME', exact: true }).first().click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    acceptDialog = true;
    await van2.getByRole('button', { name: 'BOOK OVERTIME', exact: true }).first().click();
    await page.getByRole('heading', { name: 'New overtime appointment' }).waitFor();
    const drawer = page.getByRole('dialog');
    await drawer.getByPlaceholder(/Name, company, phone/).fill('Synthetic overtime');
    await drawer.getByRole('button').filter({ hasText: 'Synthetic overtime customer' }).first().click();
    await drawer.getByRole('button', { name: /Standard Service/ }).first().click();
    for (let i = 0; i < 3; i++) await drawer.getByRole('button', { name: '＋', exact: true }).click();
    await drawer.getByRole('button', { name: 'Review and confirm overtime' }).waitFor();
    acceptDialog = false;
    await drawer.getByRole('button', { name: 'Review and confirm overtime' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] button')?.disabled);
    assert.equal(actions.filter(item => item.action === 'create_rest_day_overtime').length, 0);
    assert.equal((await db.collection('appointments').where('primaryVanId', '==', 'VAN-2').get()).size, 0);
    assert(dialogs.some(message => message.includes('4 cupos') && message.includes('5:30 PM')));
    await page.screenshot({ path: path.join(output, 'overtime-drawer.png'), fullPage: true });
    // A committed response is lost. Recovery must use the original id and consent.
    acceptDialog = true; loseCreateResponse = true;
    await drawer.getByRole('button', { name: 'Review and confirm overtime' }).click();
    await drawer.getByRole('button', { name: 'Recuperar reserva original' }).waitFor();
    await page.keyboard.press('Escape');
    await drawer.getByRole('button', { name: 'Recuperar reserva original' }).click();
    await drawer.waitFor({ state: 'detached' });
    const creates = actions.filter(item => item.action === 'create_rest_day_overtime');
    assert.equal(creates.length, 2);
    assert.deepEqual(creates[0].data, creates[1].data);
    const saved = (await db.collection('appointments').where('primaryVanId', '==', 'VAN-2').get()).docs;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].data().endTime, '17:30');
    await page.reload();
    await page.locator('[data-schedule-day]').filter({ hasText: dateLabel }).click();
    await van2.getByText('Overtime programado', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(output, 'overtime-saved.png'), fullPage: true });
    // Future emergency uses the same complete booking flow and selected future date.
    const van3 = page.getByRole('region', { name: 'Van 3 schedule', exact: true });
    await van3.getByRole('button', { name: '＋ AFTER-HOURS / EMERGENCY' }).click();
    await page.getByRole('heading', { name: 'New after-hours appointment' }).waitFor();
    await drawer.getByPlaceholder(/Name, company, phone/).fill('Synthetic overtime');
    await drawer.getByRole('button').filter({ hasText: 'Synthetic overtime customer' }).first().click();
    await drawer.getByRole('button', { name: /Standard Service/ }).first().click();
    await drawer.getByRole('button', { name: 'Create for Van 3', exact: true }).click();
    await drawer.waitFor({ state: 'detached' });
    const emergency = (await db.collection('appointments').where('primaryVanId', '==', 'VAN-3').get()).docs[0].data();
    assert.equal(emergency.date, date); assert.equal(emergency.afterHoursOpenEnded, true);
    // Mobile review of actual persisted agenda.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Next van', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'overtime-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.equal((await db.collection('employeeTimesheets').get()).size, 0);
    assert.equal((await db.collection('whatsappOutboundQueue').get()).size, 0);
    fs.writeFileSync(path.join(output, 'integration-result.json'), JSON.stringify({ status: 'PASS', date, scenarios: ['future emergency', 'rest warning cancel', 'four services', 'final cancel', 'lost response exact retry', 'Escape preserves recovery', 'reload overtime slots', 'unavailable Van'], pageErrors: errors, externalRequests: external }, null, 2));
    console.log('PASS integrated browser assertions; checking agent-browser CLI smoke separately.');
    // Keep CLI smoke failure visible; never turn a failed tool check into PASS.
    const cli = path.join(testTools, 'node_modules/.bin/agent-browser');
    const cliEnv = { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: browserPath };
    await execFile(cli, ['--debug', '--session', 'demac-overtime-review', 'open', origin], { env: cliEnv });
    const snapshot = await execFile(cli, ['--session', 'demac-overtime-review', 'snapshot', '-i'], { env: cliEnv });
    fs.writeFileSync(path.join(output, 'agent-browser-snapshot.txt'), snapshot.stdout);
    await execFile(cli, ['--session', 'demac-overtime-review', 'close'], { env: cliEnv });
    console.log('PASS real Scheduling → real booking transport → office facade → Firestore: future emergency, rest warning/cancel, four services, final cancel, lost-response recovery, persisted overtime refresh, unavailable Van protection; desktop/mobile and agent-browser smoke. No external requests or actual attendance/messages.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify({errors,external,actions}, null, 2)}`);
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await deleteApp(firebase); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
