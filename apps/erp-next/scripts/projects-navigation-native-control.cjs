'use strict';
// Deterministically exercise the proven WebKit diagnostic through the SAME acceptance
// oracle. Plain HTML/native fetch only; no ERP/Firebase write or external service.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { verifyNavigationEvidence } = require('./projects-navigation-diagnostics.cjs');
const tools = process.env.PROJECTS_UI_TOOLS;
if (!tools || !path.isAbsolute(tools)) throw Error('Explicit isolated browser tools are required.');
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const output = path.resolve(__dirname, '../../../projects-central-ui-evidence');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://loopback');
  if (url.pathname === '/projects/__next._head.txt') {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('synthetic RSC asset');
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Native teardown control</title><h1>Ready</h1>');
  }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await launcher.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const trace = [];
    const external = [];
    page.on('request', request => {
      if (new URL(request.url()).origin !== origin) external.push(request.url());
    });
    page.on('pageerror', error => trace.push({ event: 'pageerror', message: error.message, stack: error.stack }));
    page.on('console', event => {
      if (event.text().startsWith('__NATIVE_CONTROL__')) trace.push(JSON.parse(event.text().slice('__NATIVE_CONTROL__'.length)));
    });
    try {
      await context.addInitScript(() => {
        const documentId = crypto.randomUUID();
        let lifecycle = 'active';
        let ordinal = 0;
        const emit = (kind, data = {}) => console.debug('__NATIVE_CONTROL__' + JSON.stringify({
          event: 'lifecycle', kind, documentId, lifecycle, ordinal: ++ordinal,
          time: performance.timeOrigin + performance.now(), ...data,
        }));
        const armed = sessionStorage.getItem('native-control-finished') !== 'true';
        emit('document-start');
        addEventListener('pageshow', event => { lifecycle = 'active'; emit('pageshow', { persisted: event.persisted }); });
        addEventListener('beforeunload', () => { lifecycle = 'beforeunload'; emit('beforeunload'); });
        addEventListener('error', event => emit('dom-error', { message: String(event.message) }), true);
        addEventListener('unhandledrejection', event => emit('dom-unhandledrejection', { message: String(event.reason) }));
        addEventListener('pagehide', event => {
          lifecycle = 'pagehide'; emit('pagehide', { persisted: event.persisted });
          if (!armed) return;
          sessionStorage.setItem('native-control-finished', 'true');
          for (let index = 0; index < 2; index++) {
            const url = `${location.origin}/projects/__next._head.txt?_rsc=native-control-${index}`;
            const headers = { rsc: '1', 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/_head' };
            emit('same-origin-fetch', { url, method: 'GET', rsc: headers.rsc,
              prefetch: headers['next-router-prefetch'], segment: headers['next-router-segment-prefetch'] });
            // This intentionally HANDLED rejection is the behavior under investigation.
            // No application promise or global exception listener is intercepted.
            void fetch(url, { headers }).catch(() => {});
          }
        });
      });
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Ready' }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Ready' }).waitFor();
      const verdict = await verifyNavigationEvidence(page, trace, { engine, origin });
      assert.equal(verdict.rawPageErrors, engine === 'webkit' ? 2 : 0,
        'Pinned engine reproduction must execute, not pass by failing to trigger the race.');
      assert.equal(verdict.teardownDiagnostics.length, engine === 'webkit' ? 2 : 0);
      assert.equal(verdict.probes.length, engine === 'webkit' ? 2 : 0);
      assert.deepEqual(external, []);
      fs.writeFileSync(path.join(output, `${engine}-native-control.json`), JSON.stringify({ engine, verdict, trace }, null, 2));
      console.log(`PASS ${engine}: native teardown diagnostics=${verdict.rawPageErrors}, active-read proofs=${verdict.probes.length}, external requests=0`);
    } finally {
      fs.writeFileSync(path.join(output, `${engine}-native-control-raw.json`), JSON.stringify(trace, null, 2));
      await context.close();
      await browser.close();
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
