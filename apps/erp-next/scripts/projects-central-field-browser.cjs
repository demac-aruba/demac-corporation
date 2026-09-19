'use strict';
// Actual Field execution React component; synthetic read transport. Backend authority is
// independently exercised by registry-execution.emulator.cjs, not mocked here as proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const tools = process.env.PROJECTS_UI_TOOLS;
if (!tools || !path.isAbsolute(tools)) throw Error('An isolated tooling directory is required.');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-field-ui-'));
const artifacts = path.resolve(APP, '../../projects-central-ui-evidence');
fs.mkdirSync(artifacts, { recursive: true });
const fixture = {
  projectId: 'SYNTHETIC-PROJECT', projectVersion: 1,
  source: 'canonical_field_event_timeline', timeBasis: 'closed_in_progress_intervals_not_person_hours',
  nextCursor: null, issues: [],
  coverage: { pageComplete: true, allProjectLinksIncluded: true, eventReadComplete: true },
  pageTotals: { closedRecordedMinutes: 60, openIntervals: 0, visits: 1, approvedReports: 0 },
  projectRecordedMinutes: 60,
  rows: [{ workOrderId: 'SYNTHETIC-WO', appointmentId: 'SYNTHETIC-APT', vanId: 'SYNTHETIC-VAN',
    date: '2026-09-18', cancelled: false, scheduledSlots: 6, plannedVanMinutes: 360, reviewStatus: null,
    visits: [{ visitId: 'SYNTHETIC-VISIT', status: 'pending', closedRecordedMinutes: 60,
      hasOpenInterval: false, complete: true, intervals: [{ startedAt: '2026-09-18T08:00:00.000Z',
        stoppedAt: '2026-09-18T09:00:00.000Z', startEventId: 'SYNTHETIC-START', stopEventId: 'SYNTHETIC-STOP' }] }],
  }],
};
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectFieldExecution} from './components/projects/central/project-field-execution';
function request(command,signal){
  window.__calls.push(command);
  if(signal)signal.addEventListener('abort',()=>window.__aborts++);
  if(window.__scenario==='failure')return Promise.reject(new Error('Synthetic read unavailable'));
  let result=structuredClone(window.__fixture);
  result.projectId=command.data.projectId;
  if(window.__scenario==='unknown'){
    result.issues=[{code:'field_timeline_missing',visitId:'SYNTHETIC-VISIT'}];
    result.coverage.pageComplete=false;result.coverage.allProjectLinksIncluded=false;
    result.pageTotals.closedRecordedMinutes=null;result.projectRecordedMinutes=null;
    result.rows[0].visits[0].closedRecordedMinutes=null;result.rows[0].visits[0].intervals=[];
  }
  if(window.__scenario==='open'){
    result.pageTotals.openIntervals=1;result.projectRecordedMinutes=null;
    result.rows[0].visits[0].hasOpenInterval=true;result.rows[0].visits[0].complete=false;
    result.rows[0].visits[0].status='in_progress';
  }
  if(window.__scenario==='pagination'){
    result.projectRecordedMinutes=null;result.coverage.allProjectLinksIncluded=false;
    result.nextCursor=command.data.afterId?null:'SYNTHETIC-CURSOR';
    result.rows[0].workOrderId=command.data.afterId?'PAGE-TWO-WO':'PAGE-ONE-WO';
  }
  if(window.__scenario==='version')result.projectVersion=2;
  if(window.__scenario==='stale'&&command.data.projectId==='SYNTHETIC-PROJECT'){
    result.pageTotals.closedRecordedMinutes=999*60;result.projectRecordedMinutes=999*60;
    return new Promise(resolve=>window.__releaseOld=()=>resolve(result));
  }
  return Promise.resolve(result);
}
function App(){const [project,setProject]=useState('SYNTHETIC-PROJECT');return <main>
  <button onClick={()=>setProject('SECOND-PROJECT')}>Switch project</button>
  <ProjectFieldExecution key={project} request={request} projectId={project} projectVersion={1} refreshToken={0}/>
</main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
async function main() {
  await build({ absWorkingDir: APP, stdin: { contents: entry, loader: 'tsx', resolveDir: APP },
    outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
    if (name === '/app.js' || name === '/app.css') {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css');
      return res.end(fs.readFileSync(path.join(out, name.slice(1))));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial,sans-serif}main{padding:16px;max-width:960px;margin:auto}*{box-sizing:border-box}button{font:inherit}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const scenario of ['recorded', 'failure', 'unknown', 'open', 'pagination', 'version', 'stale']) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
          const page = await context.newPage(); page.setDefaultTimeout(10000);
          const errors = [], external = [];
          page.on('pageerror', error => errors.push(error.message));
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            external.push(route.request().url()); return route.abort();
          });
          await page.addInitScript(({ fixture, scenario }) => {
            window.__fixture = fixture; window.__scenario = scenario; window.__calls = []; window.__aborts = 0;
          }, { fixture, scenario });
          try {
            await page.goto(origin);
            const panel = page.getByRole('region', { name: 'Field execution evidence' });
            if (scenario === 'failure') {
              await panel.getByRole('alert').filter({ hasText: 'Synthetic read unavailable' }).waitFor();
              assert.equal(await panel.getByText('0h', { exact: true }).count(), 0);
            } else if (scenario === 'version') {
              await panel.getByRole('alert').filter({ hasText: /Project changed/ }).waitFor();
              assert.equal(await panel.getByText('1h', { exact: true }).count(), 0);
            } else if (scenario === 'stale') {
              await panel.getByText('Reading Field history…', { exact: true }).waitFor();
              await page.getByRole('button', { name: 'Switch project', exact: true }).click();
              await panel.getByText(/Closed recorded time across all linked visits/).waitFor();
              await page.evaluate(async () => { window.__releaseOld(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
              assert.ok(await page.evaluate(() => window.__aborts >= 1));
              assert.equal(await panel.getByText('999h', { exact: true }).count(), 0);
              assert.equal((await page.evaluate(() => window.__calls)).at(-1).data.projectId, 'SECOND-PROJECT');
            } else if (scenario === 'unknown') {
              await panel.getByText(/There is no complete recorded timeline/).waitFor();
              assert.ok(await panel.getByText('Not reconciled', { exact: true }).count() >= 1);
              assert.equal(await panel.getByText('0h', { exact: true }).count(), 0);
            } else if (scenario === 'pagination') {
              await panel.getByText(/PAGE-ONE-WO/).waitFor();
              await panel.getByRole('button', { name: 'Next execution page', exact: true }).click();
              await panel.getByText(/PAGE-TWO-WO/).waitFor();
              assert.equal(await panel.getByText(/PAGE-ONE-WO/).count(), 0);
              assert.equal((await page.evaluate(() => window.__calls)).at(-1).data.afterId, 'SYNTHETIC-CURSOR');
              await panel.getByRole('button', { name: 'Previous execution page', exact: true }).click();
              await panel.getByText(/PAGE-ONE-WO/).waitFor();
            } else {
              await panel.getByText(/6 scheduled slots · 6h planned/).waitFor();
              assert.ok(await panel.getByText('1h', { exact: true }).count() >= 1);
              if (scenario === 'open') {
                await panel.getByText(/Current interval is open and not included/).waitFor();
                assert.equal(await panel.getByText(/across all linked visits/).count(), 0);
              } else {
                await panel.getByText('Source intervals (1)', { exact: true }).click();
                await panel.getByText(/SYNTHETIC-START \/ SYNTHETIC-STOP/).waitFor();
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
                await page.screenshot({ path: path.join(artifacts, `${engineName}-field-execution.png`), fullPage: true });
              }
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, []);
            const calls = await page.evaluate(() => window.__calls);
            assert.ok(calls.length >= 1 && calls.every(command => command.action === 'get_execution'));
            assert.equal(calls.length, scenario === 'pagination' ? 3 : scenario === 'stale' ? 2 : 1);
            results.push({ engine: engineName, scenario, reads: calls.length, result: 'pass' });
            console.log(`PASS ${engineName}: Field ${scenario}, only bounded explicit reads.`);
          } catch (error) {
            console.error('FIELD_COMPONENT_FAILURE', engineName, scenario, JSON.stringify({ errors, text: await page.locator('body').innerText() }));
            throw error;
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(artifacts, 'field-component-results.json'), JSON.stringify(results, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(out, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });