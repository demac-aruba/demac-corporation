const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127\.0\.0\.1:4397'.replace(/\\/g, '');
if (!/^http:\/\/127\.0\.0\.1:4397$/.test(base) && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw new Error('Only the isolated gateway is allowed.');
const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
const output = process.env.PREVIEW_EVIDENCE_DIR;
fs.mkdirSync(output, { recursive: true });
const results = [];
(async () => {
  for (const [name, engine, uid, viewport] of [
    ['android-chromium', chromium, 'demo-tech', { width: 390, height: 844 }],
    ['iphone-webkit', webkit, 'demo-helper', { width: 390, height: 844 }],
    ['desktop-chromium', chromium, 'demo-tech', { width: 1365, height: 1000 }],
  ]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
    const account = credentials.accounts.find((candidate) => candidate.uid === uid);
    const errors = [], outside = [], actions = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith(base) && !/^(data:|blob:)/.test(request.url())) outside.push(new URL(request.url()).origin);
      if (request.url().includes('/fieldOperationsAuthority') && request.postData()) {
        try { actions.push(JSON.parse(request.postData()).action); } catch {}
      }
    });
    try {
      await page.goto(`${base}/login/`);
      await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `00-login-${name}.png`) });
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Sign in securely' }).click();
      await page.waitForURL((url) => url.pathname.startsWith('/field'));
      await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} home overflow`);
      await page.screenshot({ path: path.join(output, `01-inicio-${name}.png`) });
      await page.getByRole('button', { name: 'Agenda', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi agenda', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `02-agenda-${name}.png`) });
      await page.getByRole('button', { name: 'Perfil', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `03-perfil-${name}.png`) });
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      const beforeOpen = actions.length;
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).click();
      await page.getByRole('heading', { name: /Trabajo en curso|Detalle del trabajo/, exact: true }).waitFor();
      await page.getByRole('heading', { name: 'DEMO · Apartamento 1', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} job overflow`);
      await page.screenshot({ path: path.join(output, `04-trabajo-${name}.png`) });
      assert.equal(actions.slice(beforeOpen).some((action) => !['get_job','get_schedule'].includes(action)), false, 'opening a job cannot mutate the visit');
      // The visible ordinal is part of this real button's accessible name.
      await page.getByRole('navigation', { name: 'Pasos del trabajo' }).getByRole('button', { name: '2 Servicio', exact: true }).click();
      await page.getByText('DEMO · Sala', { exact: false }).first().waitFor();
      // Tab round trip does not unmount the selected job or reset its service panel.
      await page.getByRole('button', { name: 'Perfil', exact: true }).click();
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).click();
      await page.getByText('DEMO · Sala', { exact: false }).first().waitFor();
      await page.screenshot({ path: path.join(output, `05-aire-existente-${name}.png`) });
      await page.reload();
      await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).waitFor();
      assert.deepEqual(outside, [], 'the browser must not contact a production or external origin');
      assert.deepEqual(errors, []);
      results.push({ name, viewport, account: uid, checks: ['password login', 'four navigation tabs', 'canonical job context', 'no mutation by navigation', 'selected job remains mounted across tabs', 'session and backend data survive reload', 'zero external requests', 'no horizontal overflow'], emulated: viewport.width < 600 });
      console.log(`PASS real isolated app: ${name}`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${name}.png`), fullPage: true });
      throw error;
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output, 'authenticated-browser-results.json'), JSON.stringify({ base, checkedAt: new Date().toISOString(), results, excluded: ['Physical devices', '14/9 procedures', 'shared part claims', 'persistent binary outbox', 'complete review send/return cycle'] }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
