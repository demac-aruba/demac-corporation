'use strict';
// Actual phase dialog; synthetic transport. No booking or Field mutation is sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const TOOLS = process.env.PROJECTS_UI_TOOLS;
if (!TOOLS || !path.isAbsolute(TOOLS)) throw Error('An isolated tooling directory is required.');
const { build } = require(path.join(TOOLS, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(TOOLS, 'node_modules/playwright'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-review-'));
const artifacts = path.resolve(APP, '../../projects-central-ui-evidence');
fs.mkdirSync(artifacts, { recursive: true });
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PhaseCompletionDialog} from './components/projects/central/phase-completion-dialog';
const scenario=new URLSearchParams(location.search).get('case');
const phase={id:'PH-TEST',name:'Synthetic installation',scopeOfWork:'Synthetic scope',completionCriteria:'Pressure checked',plannedVanMinutes:60,dependencies:[],progressMethod:'units',unitsPlanned:2,checklist:[{id:'CL-TEST',label:'Pressure test verified',required:true}]};
const project={id:'P-TEST',projectNumber:'PRJ-TEST',schemaVersion:1,version:3,phases:[phase],budget:{unit:'van_minutes',originalMinutes:60,currentMinutes:60,revision:1}};
window.saved=[];window.reads=[];
const request=async(command)=>{window.reads.push(command);if(scenario==='late-read')await new Promise(resolve=>setTimeout(resolve,300));return {mode:'phase_completion_review',projectId:project.id,projectVersion:scenario==='stale'?2:3,phaseId:phase.id,phase,status:scenario==='reopen'?'needs_review':'open',canApprove:!['incomplete','reopen'].includes(scenario),blockers:scenario==='incomplete'?['phase_office_approval_pending']:[],digest:'a'.repeat(64),sources:[{workOrderId:'WO-SYNTHETIC',vanId:'VAN-TEST',reviewStatus:'approved',revisionId:'REV-TEST'}]};};
function Harness(){const [open,setOpen]=useState(true);return open?<PhaseCompletionDialog project={project} phase={phase} request={request} busy={false} canManage={scenario!=='read-only'} onClose={()=>setOpen(false)} onSave={async(action,data)=>{window.saved.push({action,data});setOpen(false);}}/>:<main>Review closed</main>;}
createRoot(document.getElementById('app')).render(<Harness/>);
`;

async function main() {
  // Unlike Next, this standalone harness has no public environment substitution.
  // An empty build-time object keeps imported configuration inert, without copying
  // any runner environment, credentials or production project into the browser.
  await build({
    absWorkingDir: APP,
    tsconfig: path.join(APP, 'tsconfig.json'),
    stdin: { contents: entry, resolveDir: APP, sourcefile: 'phase-harness.tsx', loader: 'tsx' },
    outfile: path.join(out, 'app.js'), bundle: true, jsx: 'automatic', platform: 'browser', format: 'iife',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
  });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    if (name === '/app.js' || name === '/app.css') {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(out, name.slice(1))));
      return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'");
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial;background:#f5f7fb;color:#13233b}*{box-sizing:border-box}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const completed = [];
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const scenario of ['eligible', 'incomplete', 'read-only', 'units', 'reopen', 'stale', 'late-read']) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          const errors = [], external = [], diagnostics = [];
          page.on('pageerror', error => { errors.push(error.message); diagnostics.push({ type: 'pageerror', message: error.message, stack: error.stack }); });
          page.on('console', event => { if (event.type() === 'error') diagnostics.push({ type: 'console', message: event.text() }); });
          page.on('request', request => { if (new URL(request.url()).origin !== url) external.push(request.url()); });
          page.on('requestfailed', request => diagnostics.push({ type: 'requestfailed', url: request.url(), reason: request.failure()?.errorText }));
          try {
            await page.goto(`${url}/?case=${scenario}`);
            const dialog = page.getByRole('dialog');
            await dialog.waitFor();
            if (scenario === 'late-read') {
              await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
              await page.getByText('Review closed', { exact: true }).waitFor();
              await page.waitForTimeout(400);
              assert.equal(await page.getByRole('dialog').count(), 0);
            } else if (scenario === 'stale') {
              await page.getByRole('alert').waitFor();
              assert.match(await page.getByRole('alert').innerText(), /changed or its evidence/);
              assert.equal(await page.getByRole('button', { name: 'Approve phase completion', exact: true }).count(), 0);
            } else if (scenario === 'reopen') {
              await page.getByLabel('Reason to reopen for additional work or correction', { exact: true }).fill('Synthetic correction needed');
              await page.getByRole('button', { name: 'Reopen phase', exact: true }).click();
              await page.getByText('Review closed', { exact: true }).waitFor();
              const saved = await page.evaluate(() => window.saved);
              assert.equal(saved.length, 1);
              assert.equal(saved[0].action, 'reopen_phase');
              assert.equal(saved[0].data.confirmation, undefined);
            } else {
              await page.getByLabel(/Verified completed units/).waitFor();
              const submit = page.getByRole('button', { name: 'Approve phase completion', exact: true });
              assert.equal(await submit.isDisabled(), true);
              if (scenario !== 'read-only') {
                await page.getByLabel(/Verified completed units/).fill(scenario === 'units' ? '1' : '2');
                await page.getByRole('checkbox', { name: 'Pressure test verified', exact: true }).check();
                await page.getByRole('checkbox', { name: /I reviewed the evidence/ }).check();
                await page.getByLabel('Scope review note', { exact: true }).fill('Verified all synthetic criteria');
              }
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
              if (scenario === 'eligible') {
                assert.equal(await submit.isDisabled(), false);
                await page.screenshot({ path: path.join(artifacts, `${name}-phase-review-mobile.png`), fullPage: true });
                await submit.click();
                await page.getByText('Review closed', { exact: true }).waitFor();
                const saved = await page.evaluate(() => window.saved);
                assert.equal(saved.length, 1);
                assert.equal(saved[0].action, 'approve_phase_completion');
                assert.equal(saved[0].data.expectedVersion, 3);
                assert.equal(saved[0].data.previewDigest, 'a'.repeat(64));
                assert.deepEqual(saved[0].data.confirmation, { criteriaConfirmed: true, verifiedUnits: 2, checklistIds: ['CL-TEST'] });
              } else assert.equal(await submit.isDisabled(), true);
            }
            if (!['eligible', 'reopen'].includes(scenario)) assert.equal(await page.evaluate(() => window.saved.length), 0);
            assert.deepEqual(errors, []);
            assert.deepEqual(external, []);
            completed.push({ browser: name, scenario, passed: true });
            console.log(`PASS phase UI ${name}: ${scenario}`);
          } catch (error) {
            const evidence = { browser: name, scenario, errors, external, diagnostics, text: await page.locator('body').innerText() };
            fs.writeFileSync(path.join(artifacts, `${name}-phase-${scenario}-failure.json`), JSON.stringify(evidence, null, 2));
            console.error('PHASE_UI_FAILURE', JSON.stringify(evidence));
            await page.screenshot({ path: path.join(artifacts, `${name}-phase-${scenario}-failure.png`), fullPage: true });
            throw error;
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    assert.equal(completed.length, 14);
  } finally {
    fs.writeFileSync(path.join(artifacts, 'phase-ui-summary.json'), JSON.stringify({ completed, expected: 14, syntheticTransport: true }, null, 2));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(out, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
