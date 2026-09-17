const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const PROJECT = 'demo-demac-health';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error(`Refusing non-local ${key}`);
}
if (process.env.GCLOUD_PROJECT !== PROJECT) throw Error('Refusing non-demo project');
const ROOT = path.resolve(__dirname, '../../..');
const requireFunctions = require('node:module').createRequire(path.join(ROOT, 'functions/package.json'));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getFirestore, Timestamp } = requireFunctions('firebase-admin/firestore');
const { getAuth } = requireFunctions('firebase-admin/auth');
const { createPerformanceTelemetryApi } = require(path.join(ROOT, 'functions/performanceTelemetryService'));
const { chromium, webkit } = require(path.join(process.env.PHC_TOOLS_DIR, 'node_modules/playwright'));
const app = initializeApp({ projectId: PROJECT }, 'performance-browser');
const db = getFirestore(app);
const api = createPerformanceTelemetryApi({ db, verifyIdToken: (token) => getAuth(app).verifyIdToken(token), timestamp: Timestamp.fromMillis, enabled: true, environment: 'test' });
const OUT = path.resolve(__dirname, '../out');
const ART = path.resolve(ROOT, 'performance-test-artifacts');
fs.mkdirSync(ART, { recursive: true });
const missingAssets = [];
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  let file = path.resolve(OUT, `.${pathname}`);
  if (!file.startsWith(OUT + path.sep)) { res.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file));
  } catch {
    if (missingAssets.length < 40) missingAssets.push(pathname);
    res.writeHead(404).end();
  }
});
async function main() {
  await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));
  const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `browser-${Date.now()}@example.test`, password: 'isolated-browser-test-123', returnSecureToken: true }),
  });
  const auth = await signup.json();
  assert.ok(auth.idToken);
  await db.collection('users').doc(auth.localId).set({ role: 'admin', active: true, name: 'Telemetry QA Administrator' });
  let failTelemetry = false;
  let ingests = 0;
  let renewals = 0;
  let controls = 0;
  const telemetryResults = [];
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    let page;
    const errors = [];
    let phase = 'launch';
    try {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, serviceWorkers: 'block' });
      const session = { uid: auth.localId, email: 'qa@example.test', idToken: auth.idToken, refreshToken: 'never-use-this-refresh-token', expiresAt: Date.now() + 3600000 };
      await context.addInitScript((value) => sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify(value)), session);
      // All external HTTP is intercepted. Never forward a production request.
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1') return route.continue();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
        if (url.hostname === 'securetoken.googleapis.com' || url.hostname === 'identitytoolkit.googleapis.com') { renewals++; return route.abort(); }
        if (url.hostname === 'firestore.googleapis.com') {
          if (/\/users\/[^/]+$/.test(url.pathname)) return route.fulfill({ status: 200, headers, body: JSON.stringify({ name: `projects/${PROJECT}/databases/(default)/documents/users/${auth.localId}`, fields: { role: { stringValue: 'admin' }, active: { booleanValue: true }, name: { stringValue: 'Telemetry QA Administrator' } } }) });
          return route.fulfill({ status: 200, headers, body: JSON.stringify(url.pathname.endsWith(':runQuery') ? [] : { documents: [] }) });
        }
        if (url.pathname === '/performanceTelemetry') {
          if (failTelemetry) return route.fulfill({ status: 503, headers, body: JSON.stringify({ error: { code: 'unavailable', message: 'Simulated telemetry outage' } }) });
          const payload = request.postDataJSON();
          if (payload.action === 'ingest') ingests++;
          if (payload.action === 'set_collection') controls++;
          const result = await api.handle({ method: 'POST', headers: request.headers(), body: payload });
          telemetryResults.push({ action: payload.action, status: result.status, code: result.body?.error?.code });
          return route.fulfill({ status: result.status, headers, body: JSON.stringify(result.body) });
        }
        if (url.hostname.endsWith('.cloudfunctions.net')) {
          // Honor the real GroupResponse contract. An incomplete generic fixture
          // previously made VanScheduleManualSend call undefined.filter().
          const payload = request.postDataJSON();
          if (payload?.action === 'get_van_schedule_groups') return route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, version: 18, groups: [] }) });
          return route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, version: 18, available: false, options: [], presets: [], attribution: [] }) });
        }
        return route.abort();
      });
      page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => errors.push(error.message));
      phase = 'initial scheduling';
      await page.goto('http://127.0.0.1:4173/scheduling/');
      await page.getByRole('link', { name: /Performance & Health/ }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(3500);
      const beforeRequests = ingests;
      phase = '25 observed support requests';
      await page.evaluate(async () => {
        for (let index = 0; index < 25; index++) await fetch('https://us-central1-demo-demac-health.cloudfunctions.net/officeBookingAuthority', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_availability', data: { supportSlotSelections: ['private-slot-id'], technicianInstructions: 'PRIVATE-INSTRUCTIONS-MUST-NOT-BE-STORED' } }),
        });
      });
      assert.equal(ingests, beforeRequests, 'No ingest per observed support request');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(2500);
      phase = 'navigate via performance link';
      assert.equal(errors.length, 0, `Unexpected page error before navigation: ${JSON.stringify(errors)}`);
      await page.getByRole('link', { name: /Performance & Health/ }).click();
      phase = 'dashboard verification';
      await page.getByRole('heading', { name: 'Performance & Health Center', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForTimeout(1500);
      const response = await api.handle({ method: 'POST', headers: { authorization: `Bearer ${auth.idToken}` }, body: { action: 'dashboard', data: { rangeMinutes: 60, release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA } } });
      assert.equal(response.status, 200);
      assert.ok(response.body.metrics.some((metric) => metric.name === 'support_slot_validation' && metric.module === 'scheduling' && metric.count >= 25), 'Browser measurements for this build must reach Firestore');
      assert.ok(!JSON.stringify(response.body).includes('PRIVATE-INSTRUCTIONS'));
      phase = 'six screens';
      for (const tab of ['Overview', 'Live Monitoring', 'Schedule Diagnostics', 'Query & Infrastructure', 'Alerts & Incidents', 'Backup & Rollback']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        if (name === 'chromium') await page.screenshot({ path: path.join(ART, `${tab.replace(/[^a-z0-9]/gi, '-')}.png`), fullPage: true });
      }
      phase = 'mobile overflow';
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'No page-level mobile overflow');
      await page.screenshot({ path: path.join(ART, `${name}-mobile.png`), fullPage: true });
      await page.setViewportSize({ width: 1600, height: 1050 });
      phase = 'near expiry outage';
      const raw = await page.evaluate(() => {
        const key = 'demac.erp-next.firebase.session.v1';
        const value = JSON.parse(sessionStorage.getItem(key));
        value.expiresAt = Date.now() + 60000;
        const text = JSON.stringify(value); sessionStorage.setItem(key, text); return text;
      });
      const renewBefore = renewals;
      failTelemetry = true;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForTimeout(1000);
      assert.match(await page.getByTestId('health-status').textContent(), /unavailable/i);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('demac.erp-next.firebase.session.v1')), raw);
      assert.equal(renewals, renewBefore);
      failTelemetry = false;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForTimeout(1000);
      phase = 'collection kill switch';
      page.on('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Pause collection', exact: true }).click();
      await page.waitForTimeout(1000);
      assert.ok(controls > 0);
      assert.match(await page.getByTestId('health-status').textContent(), /paused/i);
      await page.getByRole('button', { name: 'Resume collection', exact: true }).click();
      await page.waitForTimeout(1000);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      console.log(`${name}: browser -> authenticated handler -> Firestore -> dashboard, six tabs, mobile, outage/session safety and shutoff passed.`);
      await context.close();
    } catch (error) {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: path.join(ART, `${name}-failure.png`), fullPage: true }).catch(() => {});
        const diagnostic = { browser: name, phase, pathname: new URL(page.url()).pathname, errors, telemetryResults, missingAssets, visibleText: (await page.locator('body').innerText().catch(() => '')).slice(0, 5000) };
        fs.writeFileSync(path.join(ART, `${name}-failure.json`), JSON.stringify(diagnostic, null, 2));
        console.log('ISOLATED BROWSER FAILURE', JSON.stringify(diagnostic));
      }
      throw error;
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(ART, 'summary.json'), JSON.stringify({ environment: 'demo-demac-health only', browsers: ['chromium', 'webkit'], productionRequests: 0, tests: 'ingestion, authenticated dashboard, six screens, mobile layout, outage/session isolation, collection switch' }, null, 2));
}
main().then(() => console.log('Performance browser isolation checks complete.')).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { server.close(); await deleteApp(app); });
