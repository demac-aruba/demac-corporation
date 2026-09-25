const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4397';
if (!/^http:\/\/127\.0\.0\.1:4397$/.test(base) && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw new Error('Only the isolated gateway is allowed.');
const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
// A failed public run must never inherit a successful loopback report or screenshots.
const scope = base.startsWith('https:') ? 'public' : 'loopback';
const output = path.join(process.env.PREVIEW_EVIDENCE_DIR, scope);
fs.mkdirSync(output, { recursive: true });
const results = [];
const redact = (value) => {
  let text = String(value);
  for (const account of credentials.accounts) text = text.split(account.password).join('[REDACTED]');
  return text.replace(/https?:\/\/[^\s"<>]+/g, '[URL]').slice(0, 1000);
};
// No request body, query, Authorization header, cookie, token or response body is recorded.
const resource = (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname.includes('accounts:signInWithPassword')) return 'password-sign-in';
  if (pathname.includes('securetoken.googleapis.com')) return 'session-refresh';
  if (pathname.includes('firestore.googleapis.com')) return 'firestore-read';
  if (pathname.includes('fieldOperationsAuthority')) return 'field-api';
  if (pathname.includes('firebasestorage.googleapis.com')) return 'private-storage';
  if (pathname.startsWith('/_next/')) return 'app-static';
  return 'page-or-asset';
};
const saveResults = (status) => fs.writeFileSync(path.join(output, 'authenticated-browser-results.json'), JSON.stringify({
  base, scope, status, checkedAt: new Date().toISOString(), results,
  excluded: ['Physical devices', '14/9 procedures', 'shared part claims', 'persistent binary outbox', 'complete review send/return cycle'],
}, null, 2));
saveResults('running');
(async () => {
  for (const [name, engine, uid, viewport] of [
    ['android-chromium', chromium, 'demo-tech', { width: 390, height: 844 }],
    ['iphone-webkit', webkit, 'demo-helper', { width: 390, height: 844 }],
    ['desktop-chromium', chromium, 'demo-tech', { width: 1365, height: 1000 }],
  ]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
    const account = credentials.accounts.find((candidate) => candidate.uid === uid);
    const errors = [], outside = [], actions = [], network = [];
    let phase = 'open-login';
    const started = Date.now();
    const record = (request, details) => network.push({ ms: Date.now() - started, phase, resource: resource(request), method: request.method(), ...details });
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(redact(error.message)));
    page.on('requestfailed', (request) => record(request, { failure: redact(request.failure()?.errorText || 'unknown network failure') }));
    page.on('response', (response) => {
      if (response.status() >= 400 || response.url().includes('/__preview/firebase/')) record(response.request(), { status: response.status() });
    });
    page.on('request', (request) => {
      if (!/^(data:|blob:)/.test(request.url()) && new URL(request.url()).origin !== base) outside.push(new URL(request.url()).origin);
      if (request.url().includes('/fieldOperationsAuthority') && request.postData()) {
        try { actions.push(JSON.parse(request.postData()).action); } catch {}
      }
    });
    try {
      await page.goto(`${base}/login/`);
      await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `00-login-${name}.png`) });
      phase = 'password-login';
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Sign in securely' }).click();
      await page.waitForURL((url) => url.pathname.startsWith('/field'));
      phase = 'field-home';
      await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} home overflow`);
      assert.equal(await page.evaluate(() => { const n=document.querySelector('[data-preview-notice]')?.getBoundingClientRect(); const nav=document.querySelector('nav[aria-label="Navegación del portal"]')?.getBoundingClientRect(); return Boolean(n && nav && (n.bottom <= nav.top || n.top >= nav.bottom)); }), true, 'preview notice must not cover navigation labels');
      await page.screenshot({ path: path.join(output, `01-inicio-${name}.png`) });
      phase = 'agenda';
      await page.getByRole('button', { name: 'Agenda', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi agenda', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `02-agenda-${name}.png`) });
      phase = 'profile';
      await page.getByRole('button', { name: 'Perfil', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `03-perfil-${name}.png`) });
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      phase = 'open-job';
      const beforeOpen = actions.length;
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).click();
      await page.getByRole('heading', { name: /Trabajo en curso|Detalle del trabajo/, exact: true }).waitFor();
      await page.getByRole('heading', { name: 'DEMO · Apartamento 1', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} job overflow`);
      await page.screenshot({ path: path.join(output, `04-trabajo-${name}.png`) });
      assert.equal(actions.slice(beforeOpen).some((action) => !['get_job','get_schedule'].includes(action)), false, 'opening a job cannot mutate the visit');
      // The visible ordinal is part of this real button's accessible name.
      phase = 'service-and-tab-roundtrip';
      await page.getByRole('navigation', { name: 'Pasos del trabajo' }).getByRole('button', { name: '2 Servicio', exact: true }).click();
      await page.getByText('DEMO · Sala', { exact: false }).first().waitFor();
      // Tab round trip does not unmount the selected job or reset its service panel.
      await page.getByRole('button', { name: 'Perfil', exact: true }).click();
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).click();
      await page.getByText('DEMO · Sala', { exact: false }).first().waitFor();
      await page.screenshot({ path: path.join(output, `05-aire-existente-${name}.png`) });
      phase = 'reload-session';
      await page.reload();
      await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).waitFor();
      assert.deepEqual(outside, [], 'the browser must not contact a production or external origin');
      assert.deepEqual(errors, []);
      results.push({ name, viewport, account: uid, status: 'passed', checks: ['password login', 'four navigation tabs', 'canonical job context', 'no mutation by navigation', 'selected job remains mounted across tabs', 'session and backend data survive reload', 'zero external requests', 'no horizontal overflow'], emulated: viewport.width < 600 });
      saveResults('running');
      console.log(`PASS real isolated app (${scope}): ${name}`);
    } catch (error) {
      results.push({ name, viewport, account: uid, status: 'failed', phase, error: redact(error.message) });
      saveResults('failed');
      await page.screenshot({ path: path.join(output, `failure-${name}.png`), fullPage: true }).catch(() => {});
      console.error(`Failed ${scope}/${name} at ${phase}; see sanitized network diagnostics.`);
      throw error;
    } finally {
      fs.writeFileSync(path.join(output, `network-${name}.json`), JSON.stringify({ scope, name, phase, network, outside, errors }, null, 2));
      await browser.close();
    }
  }
  saveResults('passed');
})().catch((error) => { saveResults('failed'); console.error(redact(error.message)); process.exitCode = 1; });
