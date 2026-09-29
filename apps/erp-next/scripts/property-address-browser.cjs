// Real shared PropertyEditor + Aruba directory. Synthetic property reads/save callback only.
// No Firebase writes or real customer data; this verifies the UI's existing save contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const output = process.env.ADDRESS_TEST_OUTPUT;
const toolPaths = [process.env.ADDRESS_TEST_TOOLS, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
if (!output || !path.isAbsolute(output)) throw Error('Absolute ADDRESS_TEST_OUTPUT required');
const { build } = require(require.resolve('esbuild', { paths: toolPaths }));
const { chromium } = require(require.resolve('playwright', { paths: toolPaths }));
fs.mkdirSync(output, { recursive: true });

const fixture = {
  property: { id: 'synthetic-property', clientId: 'synthetic-customer', name: 'Synthetic property', type: 'Casa',
    address: 'Tanki Leendert 23 A, Apt 2', zone: 'Oranjestad Oeste', neighborhood: 'Tanki Leendert',
    updatedAt: '2026-09-29T12:00:00.000Z', locationVersion: 7 },
  dwellings: [{ id: 'synthetic-apartment', name: 'Apartamento existente', code: 'A-01', type: 'apartment' }],
  areas: [], assignments: [], equipment: [],
};
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PropertyEditor} from './components/crm/property-editor';
import {emptyPropertyEditor} from './lib/property-editor-draft';
window.saved=[]; window.closed=0; window.failSave=false;
const edit=new URLSearchParams(location.search).has('edit');
createRoot(document.getElementById('app')).render(<PropertyEditor
 mode={edit?'edit':'create'} requestId="synthetic-request" customerId="synthetic-customer" customerName="Cliente de prueba" contacts={[]}
 initial={edit?{...emptyPropertyEditor,id:'synthetic-property',address:'Stale address',zone:'Stale zone'}:emptyPropertyEditor}
 onClose={()=>window.closed++} onSave={async value=>{window.saved.push(structuredClone(value));if(window.failSave)throw Error('Synthetic lost response');}}
 />);`;

async function verify(browser, origin, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const street = page.getByRole('combobox', { name: 'Calle / barrio *', exact: true });
  const house = page.getByLabel('Número / letra de casa', { exact: true });
  const zone = page.getByLabel('Zona *', { exact: true });
  const create = page.getByRole('button', { name: 'Crear propiedad', exact: true });
  const saved = () => page.evaluate(() => window.saved.at(-1));
  const fresh = () => page.goto(origin);

  await fresh();
  await house.fill('54 C');
  await street.fill('Sero Blanco'); // Typo: fuzzy result from the real directory.
  const blanco = page.getByRole('option', { name: /^Seroe Blanco\b/ });
  await blanco.waitFor();
  assert.equal(await zone.inputValue(), '', 'Fuzzy results must require a choice.');
  await page.screenshot({ path: path.join(output, `${name}-suggestions.png`), fullPage: true });
  await blanco.click();
  assert.equal(await street.inputValue(), 'Seroe Blanco');
  assert.equal(await house.inputValue(), '54 C');
  assert.equal(await zone.inputValue(), 'Oranjestad Centro');
  assert.equal(await page.getByRole('listbox').count(), 0, 'Selection closes suggestions.');
  await house.fill('175K');
  assert.equal(await zone.inputValue(), 'Oranjestad Centro');
  await create.click();
  await page.waitForFunction(() => window.saved.length === 1);
  let value = await saved();
  assert.equal(value.address, 'Seroe Blanco 175K');
  assert.equal(value.neighborhood, 'Seroe Blanco');
  assert.equal(value.zone, 'Oranjestad Centro');
  assert.deepEqual(value.locations.rows, []);

  await fresh();
  await street.fill('Seru Blanco'); // Exact alias fills automatically, even without a click.
  assert.equal(await zone.inputValue(), 'Oranjestad Centro');
  await house.fill('23-B');
  await create.click();
  assert.equal((await saved()).address, 'Seroe Blanco 23-B');

  await fresh();
  await house.fill('99');
  await street.fill('Betico Croes 42'); // Pasted number replaces the old separate number.
  await street.press('ArrowDown'); await street.press('Enter');
  assert.equal(await street.inputValue(), 'Caya G. F. Betico Croes');
  assert.equal(await house.inputValue(), '42');
  assert.equal(await zone.inputValue(), 'Oranjestad Centro');
  assert.equal(await page.evaluate(() => window.saved.length), 0, 'Enter chooses; it must not submit.');
  await create.click();
  value = await saved();
  assert.equal(value.address, 'Caya G. F. Betico Croes 42');
  assert.equal(value.neighborhood, 'Playa');
  await street.fill('Seroe');
  await street.press('Escape');
  assert.equal(await page.getByRole('listbox').count(), 0);
  assert.equal(await page.evaluate(() => window.closed), 1, 'Escape closes only the suggestions, not the dialog.');
  await street.fill('Lugar sintético desconocido');
  assert.equal(await zone.inputValue(), '', 'An unrelated address must not retain the old zone.');
  assert.equal(await create.isDisabled(), true);
  await page.getByText(/Sin coincidencias/).waitFor();
  await zone.fill('Paradera');
  await create.click();
  value = await saved();
  assert.equal(value.address, 'Lugar sintético desconocido 42');
  assert.equal(value.zone, 'Paradera'); assert.equal(value.neighborhood, '');

  await fresh();
  await street.fill('Acordeonstraat'); // OSM-only entry without trustworthy zone metadata.
  await page.getByRole('option', { name: /^Acordeonstraat\b/ }).click();
  assert.equal(await zone.inputValue(), '');
  assert.equal(await create.isDisabled(), true);
  await zone.fill('Oranjestad');
  await house.fill('12');
  await create.click();
  assert.equal((await saved()).address, 'Acordeonstraat 12');

  await page.goto(origin + '/?edit');
  await page.waitForFunction(() => document.querySelector('[role="combobox"]').value === 'Tanki Leendert');
  assert.equal(await house.inputValue(), '23A, Apt 2');
  assert.equal(await zone.inputValue(), 'Oranjestad Oeste');
  await page.screenshot({ path: path.join(output, `${name}-edit.png`), fullPage: true });
  const save = page.getByRole('button', { name: 'Guardar cambios', exact: true });
  await save.click();
  value = await saved();
  assert.equal(value.address, fixture.property.address, 'Untouched legacy addresses are not rewritten.');
  assert.equal(value.id, fixture.property.id);
  assert.equal(value.expectedUpdatedAt, fixture.property.updatedAt);
  assert.equal(value.locations.expectedVersion, 7);
  assert.deepEqual(value.locations.rows, [], 'Existing dwellings are not regenerated.');
  await house.fill('23B, Apt 2');
  await save.click();
  assert.equal((await saved()).address, 'Tanki Leendert 23B, Apt 2');
  assert.equal((await saved()).zone, 'Oranjestad Oeste');
  // A fresh visit recovers the canonical snapshot, rather than keeping the previous draft.
  await page.goto(origin + '/?edit');
  await page.waitForFunction(() => document.querySelector('[role="combobox"]').value === 'Tanki Leendert');
  assert.equal(await house.inputValue(), '23A, Apt 2');

  await fresh();
  await street.fill('Santa Cruz'); await house.fill('54-C');
  await page.evaluate(() => { window.failSave = true; });
  await create.click();
  const retry = page.getByRole('button', { name: 'Reintentar guardado', exact: true });
  await retry.waitFor();
  assert.equal(await street.isDisabled(), true);
  assert.equal(await house.isDisabled(), true);
  await page.evaluate(() => { window.failSave = false; });
  await retry.click();
  const attempts = await page.evaluate(() => window.saved);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(attempts[1].address, 'Santa Cruz 54-C');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await context.close();
  return { name, result: 'PASS', cases: 7, externalRequests: 0 };
}

async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'),
    stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
    plugins: [{ name: 'synthetic-property-read', setup(b) {
      b.onResolve({ filter: /property-locations$/ }, args => args.importer.endsWith('property-editor.tsx') ? { path: 'read', namespace: 'synthetic' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: `export async function loadPropertyLocations(){return ${JSON.stringify(fixture)}}`, loader: 'js' }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css');
      return res.end(fs.readFileSync(path.join(output, req.url.slice(1))));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial;--surface:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--muted-2:#7d8da3;--border:#d6e1ef;--border-strong:#bfcfe3;--brand:#1465ff;--brand-2:#0750da;--brand-soft:#edf5ff;--danger:#a52222;--danger-soft:#fff1f1}*{box-sizing:border-box}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.ADDRESS_TEST_CHROME || undefined });
    const results = [];
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      results.push(await verify(browser, origin, name, viewport));
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
