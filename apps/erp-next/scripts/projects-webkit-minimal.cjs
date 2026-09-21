'use strict';
// Diagnostic only: no ERP, Next, Firebase, credentials, production URLs or test-oracle filtering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require(path.join(process.env.PROJECTS_UI_TOOLS, 'node_modules/playwright'));
const output = process.env.DIAGNOSTIC_OUTPUT || 'projects-minimal-browser-evidence';
fs.mkdirSync(output, { recursive: true });
const held = new Set();
let secondaryOrigin = '';
function html() {
  return `<!doctype html><meta charset="utf-8"><title>Isolated browser diagnostic</title><h1>Plain HTML only</h1>
<script>
const key = 'diagnostic-events';
function record(type, text) {
  const entries = JSON.parse(sessionStorage.getItem(key) || '[]');
  entries.push({type, text:String(text), path:location.pathname});
  sessionStorage.setItem(key, JSON.stringify(entries));
}
addEventListener('error', event => record('error', event.message));
addEventListener('unhandledrejection', event => record('unhandledrejection', event.reason));
window.runDiagnostic = mode => {
  if(mode === 'throw') { setTimeout(() => { throw Error('CONTROL_UNCAUGHT_THROW'); }, 0); return; }
  if(mode === 'rejection') { Promise.reject(Error('CONTROL_UNHANDLED_REJECTION')); return; }
  if(mode === 'caught-cors') {
    fetch('${secondaryOrigin}/no-cors').then(r => r.text()).then(() => record('unexpected-success', mode)).catch(e => record('caught', e.message));
    return;
  }
  if(mode === 'pagehide-fetch') {
    addEventListener('pagehide', () => {
      record('pagehide', mode);
      for(let i = 0; i < 16; i++) fetch('/asset?i='+i).then(r => r.text()).catch(e => record('caught', e.message));
    }, {once:true});
    return;
  }
  if(mode === 'pending-reload') {
    for(let i = 0; i < 2; i++) fetch('/delayed?i='+i).then(r => r.text()).catch(e => record('caught', e.message));
    return;
  }
  throw Error('Unknown diagnostic case');
};
</script>`;
}
const secondary = http.createServer((req, res) => res.writeHead(200, {'Content-Type':'text/plain'}).end('No CORS permission'));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname === '/delayed') {
    // Leave a connection available for navigation; delayed responses are always bounded.
    held.add(res);
    const timer = setTimeout(() => { if(!res.destroyed)res.writeHead(200, {'Content-Type':'text/plain'}).end('Delayed response'); }, 2000);
    res.on('close', () => { clearTimeout(timer); held.delete(res); }); return;
  }
  if(url.pathname === '/asset') return res.writeHead(200, {'Content-Type':'text/plain'}).end('Same-origin asset');
  res.writeHead(200, {'Content-Type':'text/html', 'Cache-Control':'no-store',
    'Content-Security-Policy':`default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${secondaryOrigin}; img-src 'self'`});
  res.end(html());
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function main() {
  await listen(secondary); secondaryOrigin = `http://127.0.0.1:${secondary.address().port}`;
  await listen(server); const origin = `http://127.0.0.1:${server.address().port}`;
  const evidence = [];
  for(const [engine, launcher] of [['chromium',chromium],['webkit',webkit]]) {
    const browser = await launcher.launch({headless:true});
    try {
      for(const mode of ['pending-reload','pagehide-fetch','caught-cors','throw','rejection']) {
        const context = await browser.newContext({serviceWorkers:'block'});
        const page = await context.newPage(); const pageErrors = [], failedRequests = [], outside = [];
        page.on('pageerror', e => pageErrors.push({name:e.name, message:e.message, stack:e.stack}));
        page.on('requestfailed', r => failedRequests.push({path:new URL(r.url()).pathname, error:r.failure()?.errorText}));
        page.on('request', r => { if(![origin,secondaryOrigin].includes(new URL(r.url()).origin))outside.push(r.url()); });
        try {
          await page.goto(origin+'/original');
          await page.evaluate(mode => window.runDiagnostic(mode), mode);
          if(mode === 'pending-reload') {
            await new Promise((resolve,reject) => {
              const start = Date.now(); const wait = () => held.size >= 2 ? resolve() : Date.now()-start > 3000 ? reject(Error('Expected pending native requests')) : setTimeout(wait,10); wait();
            });
            await page.reload();
          } else if(mode === 'pagehide-fetch') await page.goto(origin+'/replacement');
          else await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('diagnostic-events')||'[]').length > 0);
          // Observation window only; never an application-readiness shortcut or retry-to-pass.
          await page.waitForTimeout(150);
          const domEvents = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diagnostic-events')||'[]'));
          const uncaught = domEvents.filter(e => ['error','unhandledrejection'].includes(e.type));
          if(mode === 'throw') assert.ok(uncaught.some(e=>e.text.includes('CONTROL_UNCAUGHT_THROW')));
          else if(mode === 'rejection') assert.ok(uncaught.some(e=>e.text.includes('CONTROL_UNHANDLED_REJECTION')));
          else assert.deepEqual(uncaught,[]);
          if(mode === 'caught-cors') assert.ok(domEvents.some(e=>e.type==='caught'));
          assert.deepEqual(outside,[]);
          const row = {engine,mode,pageErrors,failedRequests,domEvents,externalRequests:outside.length};
          evidence.push(row);
          console.log(JSON.stringify({engine,mode,playwrightPageErrors:pageErrors.length,trueUncaught:uncaught.length,caught:domEvents.filter(e=>e.type==='caught').length,diagnostics:pageErrors.map(e=>e.message)}));
          fs.writeFileSync(path.join(output,'observations.json'),JSON.stringify(evidence,null,2));
        } catch(error) {
          const domEvents = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diagnostic-events')||'[]')).catch(() => null);
          evidence.push({engine,mode,pageErrors,failedRequests,domEvents,externalRequests:outside.length,diagnosticFailure:String(error)});
          fs.writeFileSync(path.join(output,'observations.json'),JSON.stringify(evidence,null,2));
          throw error;
        } finally { for(const res of held)res.destroy(); held.clear(); await context.close(); }
      }
    } finally { await browser.close(); }
  }
  console.log('CONTROLLED_DIAGNOSTIC_COMPLETE: no application or operational backend used; raw evidence retained.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server.closeAllConnections();secondary.closeAllConnections();server.close();secondary.close();});
