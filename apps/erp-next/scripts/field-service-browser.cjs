// Component regressions. No Firebase calls; authenticated service persistence is tested separately.
const http=require('node:http');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const tools = process.env.FIELD_PORTAL_TEST_TOOLS;
if (!tools) throw new Error('Expected isolated FIELD_PORTAL_TEST_TOOLS.');
const { chromium } = require(path.join(tools, 'node_modules/playwright'));
const esbuild = require(path.join(tools, 'node_modules/esbuild'));
const app = path.resolve(__dirname, '..');
const output = path.resolve(process.env.FIELD_SERVICE_EVIDENCE || path.join(app, '.field-service-browser'));
fs.mkdirSync(output, { recursive: true });
const define={'process.env.NEXT_PUBLIC_ISOLATED_PREVIEW':'"true"'};
for(const [key,value] of Object.entries({PROJECT_ID:'demo-demac-dwellings',API_KEY:'synthetic',AUTH_DOMAIN:'demo-demac-dwellings.invalid',STORAGE_BUCKET:'demo-demac-dwellings.appspot.com',MESSAGING_SENDER_ID:'0',APP_ID:'synthetic',MEASUREMENT_ID:''}))define['process.env.NEXT_PUBLIC_FIREBASE_'+key]=JSON.stringify(value);
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');});
let origin;
const build = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'field-service-browser.fixture.tsx')], bundle: true, write: false, define, outfile: path.join(output, 'fixture.js'), jsx: 'automatic', tsconfig: path.join(app, 'tsconfig.json'), nodePaths: [path.join(tools, 'node_modules')] });
const js = build.outputFiles.find((file) => file.path.endsWith('.js')).text;
const css = build.outputFiles.find((file) => file.path.endsWith('.css')).text;
async function mount(page, mode = 'planned') {
  await page.goto(origin);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase('demac-field-procedure-captures-v1');req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);}));
  await page.setContent('<html lang="es"><head><style>body{margin:0;font-family:Arial,sans-serif;background:#f3f8ff}button,input,textarea{font:inherit}</style></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate((mode) => { window.serviceTestMode = mode; }, mode);
  await page.addScriptTag({ content: js });
  await page.getByRole('heading', { name: mode === 'planned' ? 'Seleccionar servicio' : 'Trabajo adicional', exact: true }).waitFor();
}
async function change(page, value) { await page.evaluate((value) => window.changeServiceFixture(value), value); }
async function settled(page){await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]')).some(x=>/Recuperando borrador|Guardando borrador/.test(x.textContent)));}
async function choose(page, value) { await settled(page);await page.locator(`input[type="radio"][value="${value}"]`).check();await settled(page); }
async function events(page) { return page.evaluate(() => window.serviceEvents); }
async function choosePlanned(page) { await choose(page, 'VA-1'); await choose(page, 'PLAN-1'); await choose(page, 'SVC-1'); }
(async () => {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.FIELD_PORTAL_BROWSER_EXECUTABLE ? { executablePath: process.env.FIELD_PORTAL_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const [name, width, height] of [['mobile-360',360,800], ['mobile-390',390,844], ['desktop',1365,1000]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [], outside = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => { if (!request.url().startsWith(origin)&&!/^(data:|blob:|about:)/.test(request.url())) outside.push(request.url()); });
      await mount(page);
      assert.equal(await page.locator('input:checked').count(), 0, 'no implicit selection');
      assert.deepEqual(await events(page), []);
      await choosePlanned(page);
      assert.equal(await page.getByRole('radio', { name: /Standard Service Servicio del catálogo/ }).count(), 2, 'identical labels retain distinct catalog IDs');
      assert.deepEqual(await events(page), [], 'selecting air, planned line and service is not a write');
      assert.equal(await page.evaluate(() => Boolean(window.injected)), false, 'catalog text is escaped, never executed');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long labels do not overflow');
      assert.equal(await page.locator('input[value="SVC-1"]').evaluate((node) => node.parentElement.getBoundingClientRect().height >= 44), true, 'touch card target');
      await page.screenshot({ path: path.join(output, `03-servicio-${name}.png`), fullPage: true });
      const save = page.getByRole('button', { name: 'Guardar servicio para este aire', exact: true });
      await save.click();
      assert.deepEqual(await events(page), [{ kind: 'intervention', visitAssetId: 'VA-1', plannedWorkLineId: 'PLAN-1', serviceCatalogItemId: 'SVC-1' }]);
      assert.equal(await page.getByRole('button', { name: 'Guardando servicio…', exact: true }).isDisabled(), true);
      await change(page, 'error');
      await page.getByText('Error de prueba: conserva tu selección y reintenta.', { exact: true }).waitFor();
      assert.equal(await page.locator('input[value="SVC-1"]').isChecked(), true, 'error preserves the choice');
      await choose(page, 'VA-2');
      assert.equal(await save.isDisabled(), true, 'another air never inherits a service');
      await choose(page, 'VA-1');
      assert.equal(await page.locator('input[value="SVC-1"]').isChecked(), true, 'back to air restores its unsaved choice');
      await change(page, 'remove-service');
      await page.getByText('Las opciones disponibles cambiaron. Revisa la selección antes de guardar.').waitFor();
      assert.equal(await save.isDisabled(), true, 'removed catalog item cannot submit');
      await choose(page, 'SVC-2');
      await change(page, 'remove-line');
      assert.equal(await save.isDisabled(), true, 'removed plan option cannot submit');
      await change(page, 'other-job');
      assert.equal(await page.locator('input:checked').count(), 0, 'new job resets context, even if local option IDs are reused');
      await change(page, 'revoke');
      assert.equal(await page.locator('input[type=radio]').count(), 0, 'server eligibility denial never falls back to role inference');
      await mount(page);
      await choosePlanned(page);
      await change(page, 'busy');
      assert.equal(await page.locator('input[value="SVC-1"]').isDisabled(), true, 'busy or stale/offline parent locks editing');
      assert.equal(await page.getByRole('button', { name: 'Guardando servicio…', exact: true }).isDisabled(), true);
      await change(page, 'idle');
      await page.getByRole('button', { name: 'Limpiar selección' }).click();
      assert.equal(await save.isDisabled(), true);
      await page.locator('input[value="SVC-1"]').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('input[value="SVC-1"]').isChecked(), true, 'native keyboard selection');
      assert.deepEqual(await events(page), [], 'keyboard selection does not submit');
      await change(page, 'empty-catalog');
      await page.getByText('No hay servicios disponibles en el catálogo autorizado. Consulta con oficina.').waitFor();
      assert.equal(await save.isDisabled(), true);
      await mount(page, 'additional');
      await choose(page, 'VA-1'); await choose(page, 'SVC-2');
      const propose = page.getByRole('button', { name: 'Proponer trabajo adicional', exact: true });
      assert.equal(await propose.isDisabled(), true, 'no default requester/origin/need');
      await choose(page, 'technician_discovered_additional_need');
      await page.getByLabel('Razón / necesidad observada').fill('Necesidad observada de prueba');
      await choose(page, 'VA-2');
      assert.equal(await page.getByLabel('Razón / necesidad observada').inputValue(), '', 'additional draft is per air');
      await choose(page, 'VA-1');
      assert.equal(await page.getByLabel('Razón / necesidad observada').inputValue(), 'Necesidad observada de prueba');
      await page.screenshot({ path: path.join(output, `03-adicional-${name}.png`), fullPage: true });
      await propose.click();
      assert.deepEqual(await events(page), [{ visitAssetId: 'VA-1', serviceCatalogItemId: 'SVC-2', origin: 'technician_discovered_additional_need', reason: 'Necesidad observada de prueba' }]);
      await change(page, 'error'); await change(page, 'other-job');
      assert.equal(await page.locator('input:checked').count(), 0);
      await choose(page, 'VA-1');
      assert.equal(await page.getByLabel('Razón / necesidad observada').inputValue(), '', 'another visit does not inherit an additional note');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(outside, []); assert.deepEqual(errors, []);
      results.push({ name, viewport: { width, height }, status: 'passed', checks: ['explicit selection', 'canonical callback IDs', 'no mutation on selection', 'no default origin', 'per-air drafts', 'per-visit reset', 'catalog and scope revalidation', 'eligibility denial', 'busy state', 'error retention', 'keyboard', 'touch targets', 'escaped labels', 'duplicate labels', 'no overflow', 'no external network'] });
      console.log(`PASS service selection components: ${name}`);
      await page.close();
    }
    fs.writeFileSync(path.join(output, 'service-component-results.json'), JSON.stringify({ componentOnly: true, checkedAt: new Date().toISOString(), results }, null, 2));
  } finally { await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r)); }
})().catch((error) => { console.error(error);process.exitCode=1;server.closeAllConnections();server.close(); });
