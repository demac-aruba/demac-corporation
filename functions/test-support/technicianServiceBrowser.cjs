// Actual compiled app + authenticated demo backend. Never runs against production.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4397';
if (!/^http:\/\/127\.0\.0\.1:4397$/.test(base) && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw new Error('Only the isolated demo gateway is allowed.');
const scope = base.startsWith('https:') ? 'public' : 'loopback';
const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
const account = credentials.accounts.find((candidate) => candidate.uid === 'demo-tech');
const endpoint = `${base}/__preview/firebase/us-central1-demo-demac-dwellings.cloudfunctions.net/fieldOperationsAuthority`;
const output = path.join(process.env.PREVIEW_EVIDENCE_DIR, scope);
fs.mkdirSync(output, { recursive: true });
let token = '', phase = 'authenticate';
const checks = [], outside = [], mutations = [], browserErrors = [];
function save(status) {
  fs.writeFileSync(path.join(output, 'service-browser-results.json'), JSON.stringify({ base, scope, status, phase, checkedAt: new Date().toISOString(), checks, limitations: ['Shared part ownership and 14/9 procedure workflow are not implemented by this increment.', 'Browser emulation, not physical device testing.'] }, null, 2));
}
async function call(payload) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, 'demo Field request must succeed');
  return response.json();
}
const readJob = async () => (await call({ action: 'get_job', data: { workOrderId: 'DEMO-FIELD-1' } })).job;
(async () => {
  save('running');
  const authentication = await fetch(`${base}/__preview/firebase/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }) });
  assert.equal(authentication.status, 200); token = (await authentication.json()).idToken;
  const before = await readJob();
  assert.equal(before.workOrderId, 'DEMO-FIELD-1');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(30000);
  page.on('pageerror', () => browserErrors.push('uncaught-browser-error'));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== base) outside.push(url.origin);
    if (request.url() === endpoint && request.postData()) {
      const payload = request.postDataJSON();
      if (!['get_schedule', 'get_job'].includes(payload.action)) mutations.push(payload.action);
    }
  });
  try {
    phase = 'browser-login';
    await page.goto(`${base}/login/`);
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
    const openJob = async () => {
      await page.getByRole('button', { name: /Continuar trabajo|Abrir próximo trabajo/, exact: true }).click();
      await page.getByRole('heading', { name: 'DEMO · Apartamento 1', exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Pasos del trabajo' }).getByRole('button', { name: '2 Servicio', exact: true }).click();
      const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Trabajo y materiales' }) }).first();
      if (!(await disclosure.getAttribute('open') !== null)) await disclosure.locator('summary').first().click();
      await page.getByRole('heading', { name: 'Seleccionar servicio', exact: true }).waitFor();
    };
    await openJob();
    phase = 'select-service';
    assert.deepEqual(mutations, [], 'opening service cards must not create or start work');
    if (scope === 'loopback') {
      const option = before.plannedInterventionOptions[0];
      assert.ok(option, 'fixture must expose an authorized planned-work option');
      const service = before.availableFieldServices.find((item) => item.bookingCode === 'standard_service') || before.availableFieldServices[0];
      assert.ok(service, 'fixture requires an actual canonical service, not an invented option');
      const region = page.getByRole('region', { name: 'Seleccionar servicio planificado' });
      for (const id of [option.visitAssetId, option.plannedWorkLineIds[0], service.id]) {
        await region.locator(`input[type="radio"][value=${JSON.stringify(id)}]`).check();
      }
      assert.deepEqual(mutations, [], 'selection itself is not a mutation');
      await region.screenshot({ path: path.join(output, '06-seleccionar-servicio.png') });
      const createdRequest = page.waitForRequest((request) => request.url() === endpoint && request.postDataJSON()?.action === 'create_planned_intervention');
      const createdResponse = page.waitForResponse((response) => response.url() === endpoint && response.request().postDataJSON()?.action === 'create_planned_intervention');
      await region.getByRole('button', { name: 'Guardar servicio para este aire', exact: true }).click();
      const payload = (await createdRequest).postDataJSON();
      assert.equal((await createdResponse).status(), 200);
      await page.getByText('Programado: DEMO · Standard Service · Confirmada', { exact: true }).waitFor();
      const after = await readJob();
      assert.equal(after.workInterventions.length, before.workInterventions.length + 1, 'one canonical intervention');
      const intervention = after.workInterventions.find((item) => item.visitAssetId === option.visitAssetId && item.plannedWorkLineId === option.plannedWorkLineIds[0]);
      assert.ok(intervention); assert.equal(intervention.serviceCatalogItemId, service.id);
      assert.equal(intervention.status, 'confirmed', 'saved selection is not performed work');
      assert.deepEqual(intervention.performedByStaffIds, []);
      assert.equal(after.fieldVisit.id, before.fieldVisit.id);
      assert.deepEqual(after.plannedWork, before.plannedWork, 'original scheduled scope is preserved');
      const retry = await call(payload);
      assert.equal(retry.replayed, true, 'exact transport retry must not duplicate service');
      assert.equal(retry.workIntervention.id, intervention.id);
      assert.equal((await readJob()).workInterventions.length, after.workInterventions.length);
      assert.deepEqual(mutations, ['create_planned_intervention'], 'no arrival, execution, billing or approval action');
      checks.push('real UI selection saved one canonical planned intervention', 'exact callback context', 'original planned scope retained', 'not performed or billed', 'exact retry reused intervention');
    } else {
      assert.equal(before.workInterventions.length, 1, 'public preview sees the service persisted by the isolated UI check');
      assert.equal(before.workInterventions[0].status, 'confirmed');
      checks.push('public HTTPS reads the previously persisted service without creating another');
    }
    phase = 'reload-and-proposal-context';
    await page.reload();
    await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
    await openJob();
    await page.getByText('Programado: DEMO · Standard Service · Confirmada', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, '07-servicio-registrado.png'), fullPage: true });
    const additional = page.getByRole('region', { name: 'Proponer servicio adicional' });
    const air = before.visitAssets[0];
    await additional.locator(`input[type="radio"][value=${JSON.stringify(air.id)}]`).check();
    await additional.getByRole('group', { name: '¿Qué servicio se realizará?' }).waitFor();
    assert.equal(await additional.getByRole('button', { name: 'Proponer trabajo adicional', exact: true }).isDisabled(), true);
    await additional.screenshot({ path: path.join(output, '08-proponer-servicio.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(outside, []);
    assert.deepEqual(browserErrors, []);
    checks.push('backend record survives reload', 'additional service requires explicit selection and explanation', 'no external browser requests', 'no horizontal overflow');
    save('passed'); console.log(`PASS authenticated service selection (${scope})`);
  } catch (error) {
    save('failed');
    await page.screenshot({ path: path.join(output, 'service-failure.png'), fullPage: true }).catch(() => {});
    // Do not log request bodies, tokens, headers, credentials, or raw page content.
    throw new Error(`Authenticated service check failed at ${phase}: ${error.name}`);
  } finally { await browser.close(); }
})().catch((error) => { save('failed'); console.error(error.message); process.exitCode = 1; });
