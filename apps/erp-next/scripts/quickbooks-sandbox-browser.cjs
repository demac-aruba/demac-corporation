'use strict';
// Synthetic component/transport review. Every non-loopback request is intercepted or blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const app = path.resolve(__dirname, '..');
const tooling = process.env.QBO_TEST_TOOLS;
const output = process.env.QBO_TEST_OUTPUT;
if (!tooling || !output || !path.isAbsolute(tooling) || !path.isAbsolute(output)) throw Error('Absolute isolated tooling/output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(require.resolve('playwright', { paths: [path.join(tooling, 'node_modules'), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-browser-'));
  fs.mkdirSync(output, { recursive: true });
  await build({ absWorkingDir: app, tsconfig: path.join(app, 'tsconfig.json'), bundle: true, outfile: path.join(folder, 'fixture.js'), jsx: 'automatic',
    stdin: { contents: "import {createRoot} from 'react-dom/client'; import {QuickBooksSandboxStatusCard} from './components/firebase/quickbooks-sandbox-status'; import './app/globals.css'; import './app/system-governance.css'; createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:700,margin:'auto'}}><h1>Integrations</h1><p>Verificación con datos sintéticos</p><QuickBooksSandboxStatusCard /></main>);", resolveDir: app, loader: 'tsx' },
    define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_QBO_SANDBOX_ENABLED: 'true', NEXT_PUBLIC_ISOLATED_PREVIEW: 'false',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-qbo-browser' }) },
    plugins: [{ name: 'synthetic-auth-only', setup(builder) {
      builder.onResolve({ filter: /auth-provider$/ }, () => ({ path: 'auth', namespace: 'synthetic' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: "export function useAuth(){return {status:'ready',principal:{active:true,role:window.testRole||'super_admin',userId:'owner'}}}", loader: 'js' }));
    } }],
  });
  const server = http.createServer((request, response) => {
    const asset = request.url === '/fixture.js' ? 'fixture.js' : request.url === '/fixture.css' ? 'fixture.css' : null;
    response.setHeader('Content-Type', asset?.endsWith('.js') ? 'text/javascript' : asset ? 'text/css' : 'text/html');
    response.end(asset ? fs.readFileSync(path.join(folder, asset)) : '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROMIUM ? { executablePath: process.env.QBO_TEST_CHROMIUM } : {}) });
  const results = [];
  const reportRows = [{ kind: 'heading', depth: 0, values: ['Ingresos', ''] },
    { kind: 'data', depth: 1, values: ['Servicio sintético', '1234.50'] }, { kind: 'total', depth: 0, values: ['Total ingresos', '1234.50'] }];
  let reportResult = { environment: 'sandbox', syncEnabled: false, realmId: '1234567890123456', companyName: 'Synthetic Advanced Sandbox',
    fetchedAt: '2026-10-12T22:00:00Z', request: { report: 'ProfitAndLoss' },
    report: { name: 'ProfitAndLoss', currency: 'USD', basis: 'Accrual', startPeriod: '2026-10-01', endPeriod: '2026-10-12',
      noData: false, columns: [{ title: 'Concepto', type: 'Account' }, { title: 'Total', type: 'Money' }], rows: reportRows } };
  try {
    for (const width of [1280, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(() => sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify({ uid: 'owner', email: 'test@example.test', idToken: 'synthetic', refreshToken: 'synthetic', expiresAt: Date.now() + 3600000 })));
      const page = await context.newPage(); const failures = []; const blocked = [];
      page.on('pageerror', error => failures.push(error.message));
      let result = { configured: false, environment: 'sandbox', syncEnabled: false, connection: null };
      await page.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith(origin)) return route.continue();
        if (url === 'https://us-central1-demo-qbo-browser.cloudfunctions.net/quickbooksSandbox') return route.fulfill({ json: route.request().method() === 'POST' ? reportResult : result,
          headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
        blocked.push(url); return route.abort();
      });
      await page.goto(origin);
      await page.getByText('Falta activar la conexión de prueba en el servidor.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Conectar sandbox' }).isDisabled(), true);
      await page.screenshot({ path: path.join(output, `pending-${width}.png`), fullPage: true });
      result = { configured: true, environment: 'sandbox', syncEnabled: false, expectedRealmId: '1234567890123456', connection: null };
      await page.getByRole('button', { name: 'Consultar estado / reintentar' }).click();
      await page.getByText('Sandbox esperado:', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Conectar sandbox' }).isEnabled(), true);
      result.connection = { realmId: '1234567890123456', companyName: 'Synthetic Advanced Sandbox', country: 'US', verifiedAt: '2026-10-12T21:30:00Z', connectedAt: '2026-10-12T21:30:00Z' };
      await page.getByRole('button', { name: 'Consultar estado / reintentar' }).click();
      await page.getByText('Sandbox autorizado', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Consultar informe de prueba' }).click();
      await page.getByRole('region', { name: 'Resultado de QuickBooks', exact: true }).waitFor();
      assert.equal(await page.getByRole('cell', { name: '1234.50', exact: true }).count(), 2);
      await page.screenshot({ path: path.join(output, `authorized-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
      await page.getByLabel('Informe', { exact: true }).selectOption('AgedReceivables');
      assert.equal(await page.getByRole('region', { name: 'Resultado de QuickBooks', exact: true }).count(), 0, 'Changing filters clears old figures');
      assert.equal(await page.getByLabel('Base contable').isDisabled(), true);
      reportResult = { ...reportResult, report: { ...reportResult.report, noData: true, rows: [] } };
      await page.getByRole('button', { name: 'Consultar informe de prueba' }).click();
      await page.getByText('QuickBooks indica que no hay datos para esta consulta.').waitFor();
      reportResult = { ...reportResult, report: { ...reportResult.report, noData: false, rows: reportRows } };
      await page.addInitScript(() => { window.testRole = 'finance'; });
      await page.reload();
      await page.getByText('Solo el propietario o un administrador puede gestionar esta conexión.').waitFor();
      assert.equal(await page.getByRole('button', { name: /Conectar sandbox|Volver a autorizar/ }).count(), 0);
      assert.deepEqual(failures, []); assert.deepEqual(blocked, []);
      results.push({ width, result: 'PASS', states: ['unconfigured', 'ready', 'verified', 'report', 'filter-change', 'no-data', 'unauthorized'] });
      await context.close();
    }
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results));
}
main().catch(error => { console.error(error); process.exit(1); });
