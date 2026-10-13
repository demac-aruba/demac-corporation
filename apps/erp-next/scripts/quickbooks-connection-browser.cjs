'use strict';
// Synthetic UI/transport verification; all non-loopback requests are mocked or blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const app = path.resolve(__dirname, '..');
const tooling = process.env.QBO_TEST_TOOLS; const output = process.env.QBO_TEST_OUTPUT;
if (!tooling || !output || !path.isAbsolute(tooling) || !path.isAbsolute(output)) throw Error('Absolute tooling/output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(require.resolve('playwright', { paths: [path.join(tooling, 'node_modules'), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-entry-browser-')); fs.mkdirSync(output, { recursive: true });
  await build({ absWorkingDir: app, tsconfig: path.join(app, 'tsconfig.json'), bundle: true, outfile: path.join(folder, 'fixture.js'), jsx: 'automatic',
    stdin: { contents: "import {createRoot} from 'react-dom/client'; import {QuickBooksConnectionPage} from './components/firebase/quickbooks-connection-page'; import './app/globals.css'; createRoot(document.getElementById('root')).render(<QuickBooksConnectionPage intent={location.pathname.includes('disconnect')?'disconnect':'connect'} />);", resolveDir: app, loader: 'tsx' },
    define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_QBO_PRODUCTION_ENABLED: 'true', NEXT_PUBLIC_ISOLATED_PREVIEW: 'false', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-qbo-browser' }) },
    plugins: [{ name: 'synthetic-auth-and-router', setup(builder) {
      builder.onResolve({ filter: /auth-provider$/ }, () => ({ path: 'auth', namespace: 'synthetic' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'synthetic' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'auth'
        ? "export function useAuth(){return {mode:window.testSignedOut?'signed_out':'firebase',status:'ready',principal:{active:true,role:window.testRole||'super_admin',userId:'owner'}}}"
        : "import React from 'react';export default function Link(props){return React.createElement('a',props,props.children)}", loader: 'js', resolveDir: app }));
    } }],
  });
  const server = http.createServer((request, response) => {
    const asset = request.url === '/fixture.js' ? 'fixture.js' : request.url === '/fixture.css' ? 'fixture.css' : null;
    response.setHeader('Content-Type', asset?.endsWith('.js') ? 'text/javascript' : asset ? 'text/css' : 'text/html');
    response.end(asset ? fs.readFileSync(path.join(folder, asset)) : '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROMIUM ? { executablePath: process.env.QBO_TEST_CHROMIUM } : {}) });
  const results = []; const version = Buffer.alloc(32, 7).toString('base64url');
  const empty = { configured: false, environment: 'production', syncEnabled: false, accountingWritesEnabled: false, phase: 'not-configured', connection: null, disconnectVersion: null };
  try {
    for (const width of [1280, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(() => {
        sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify({ uid: 'owner', email: 'test@example.test', idToken: 'synthetic', refreshToken: 'synthetic', expiresAt: Date.now() + 3600000 }));
        window.testSignedOut = sessionStorage.getItem('test-signed-out') === 'true';
        window.testRole = sessionStorage.getItem('test-role') || 'super_admin';
      });
      const page = await context.newPage(); const errors = []; const blocked = []; const posts = [];
      page.on('pageerror', error => errors.push(error.message));
      let current = { ...empty }; let failRevoke = false;
      await page.route('**/*', async route => {
        const req = route.request(); const url = req.url(); if (url.startsWith(origin)) return route.continue();
        if (url === 'https://us-central1-demo-qbo-browser.cloudfunctions.net/quickbooksConnection') {
          const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (req.method() === 'POST') {
            const body = req.postDataJSON(); posts.push(body);
            if (body.action === 'disconnect') {
              current = { ...empty, configured: true, phase: failRevoke ? 'disconnect-pending' : 'disconnected', disconnectVersion: failRevoke ? version : null };
              if (failRevoke) return route.fulfill({ status: 409, json: { error: 'revocation-pending' }, headers });
            } else if (body.action === 'finish') current = { ...current, phase: 'connected' };
            else throw Error('Unexpected mutation from page visit');
          }
          return route.fulfill({ json: current, headers });
        }
        blocked.push(url); return route.abort();
      });
      await page.goto(origin + '/quickbooks/connect/'); await page.getByRole('heading', { name: 'Activación pendiente' }).waitFor();
      assert.equal(posts.length, 0); assert.equal(await page.getByRole('button', { name: 'Conectar con QuickBooks', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, `pending-${width}.png`), fullPage: true });
      await page.evaluate(() => sessionStorage.setItem('test-signed-out', 'true')); await page.reload();
      const login = page.getByRole('link', { name: 'Iniciar sesión en DEMAC ERP' }); await login.waitFor();
      assert.equal(await login.getAttribute('href'), '/login?next=%2Fquickbooks%2Fconnect%2F');
      assert.equal(posts.length, 0);
      await page.evaluate(() => { sessionStorage.removeItem('test-signed-out'); sessionStorage.setItem('test-role', 'finance'); }); await page.reload();
      await page.getByText('Esta sección requiere una cuenta de administrador autorizada por DEMAC.').waitFor();
      assert.equal(posts.length, 0);
      await page.evaluate(() => sessionStorage.removeItem('test-role'));
      current = { ...empty, configured: true, phase: 'connected', disconnectVersion: version,
        connection: { realmId: '1234567890123456', companyName: 'DEMAC · datos sintéticos de prueba', country: 'AW', verifiedAt: '2026-10-13T02:30:00Z', connectedAt: '2026-10-13T02:30:00Z' } };
      await page.goto(origin + '/quickbooks/disconnect/?realmId=untrusted&disconnect=true');
      await page.getByRole('heading', { name: 'Identidad de empresa verificada' }).waitFor();
      assert.equal(posts.length, 0, 'Disconnect GET and query parameters cannot revoke');
      assert.equal(await page.getByRole('button', { name: 'Confirmar desconexión' }).isDisabled(), true);
      await page.screenshot({ path: path.join(output, `disconnect-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('checkbox').check(); failRevoke = true;
      await page.getByRole('button', { name: 'Confirmar desconexión' }).click();
      await page.getByRole('heading', { name: 'Desconexión pendiente de confirmar' }).waitFor();
      assert.equal(posts.length, 1); assert.deepEqual(posts[0], { action: 'disconnect', version });
      assert.equal(await page.getByRole('button', { name: 'Reintentar desconexión' }).isDisabled(), true);
      await page.getByRole('checkbox').check(); failRevoke = false; await page.getByRole('button', { name: 'Reintentar desconexión' }).click();
      await page.getByRole('status').filter({ hasText: 'QuickBooks confirmó la revocación' }).waitFor();
      assert.equal(posts.length, 2);
      // OAuth landing captures a browser-bound ticket but only an explicit confirmation commits.
      const ticket = Buffer.alloc(32, 3).toString('base64url'); const proof = Buffer.alloc(32, 2).toString('base64url');
      await page.evaluate(({ ticket, proof }) => sessionStorage.setItem('demac.quickbooks.production.v1', JSON.stringify({ uid: 'owner', ticket, proof, createdAt: Date.now() })), { ticket, proof });
      current = { ...empty, configured: true, phase: 'confirmation-pending', disconnectVersion: version };
      await page.goto(origin + '/quickbooks/connect/#qbo_production_ticket=' + ticket);
      await page.getByRole('button', { name: 'Confirmar autorización de DEMAC' }).waitFor(); assert.equal(posts.length, 2);
      assert.equal(new URL(page.url()).hash, '');
      await page.getByRole('button', { name: 'Confirmar autorización de DEMAC' }).click();
      await page.getByRole('heading', { name: 'Identidad de empresa verificada' }).waitFor(); assert.equal(posts.length, 3);
      assert.equal(posts.at(-1).action, 'finish'); assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      results.push({ width, result: 'PASS', states: ['disabled', 'signed-out', 'unauthorized', 'read-only-disconnect-landing', 'confirmation', 'uncertain-revocation', 'explicit-retry', 'explicit-OAuth-completion'], unexpectedRequests: 0, errors: 0 });
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(folder, { recursive: true, force: true }); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
}
main().catch(error => { console.error(error); process.exit(1); });
