'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os'); const http = require('node:http');
const APP = path.resolve(__dirname, '..'); const tools = process.env.PROJECTS_UI_TOOLS;
if (!tools || !path.isAbsolute(tools)) throw Error('Isolated browser tooling required.');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'history-ui-'));
const evidence = path.resolve(APP, '../../projects-history-ui-evidence'); fs.mkdirSync(evidence, { recursive: true });
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {HistoryReconciliationDialog} from './components/projects/central/history-reconciliation-dialog';
import {ProjectMaterialsPanel} from './components/projects/central/project-materials-panel';
const scenario=new URLSearchParams(location.search).get('case');
const project={id:'P-TEST',version:3,phases:[],migration:{status:'pending_reconciliation'}};
window.saved=[];window.reads=[];
const request=async(command)=>{window.reads.push(command);
if(command.action==='get_materials'){if(scenario==='materials-error')throw Error('Synthetic inventory read failed');return {source:'canonical_inventory_movements',projectId:'P-TEST',projectVersion:scenario==='materials-stale'?2:3,workOrderId:command.data.workOrderId,rows:scenario==='materials-empty'?[]:[{movementId:command.data.afterId?'MOV-2':'MOV-1',itemId:'PIPE',itemName:command.data.afterId?'Second issue':'Synthetic pipe',itemKind:'material',quantity:2.125,occurredAt:'2026-09-19T12:00:00.000Z',sourceLocationId:'VAN-SUPPORT',workOrderStatus:'Confirmada',totalCost:null}],issues:[],nextCursor:scenario==='materials-ready'&&!command.data.afterId?'MOV-1':null,coverage:{pageValid:true,wholeProjectTotal:false,importReviewPending:false}};}
if(scenario==='late')await new Promise(r=>window.releaseRead=r);if(scenario==='error')throw Error('Synthetic read failed');
return {mode:'history_reconciliation_preview',projectId:'P-TEST',projectVersion:scenario==='stale'?2:3,digest:'a'.repeat(64),canFinalize:!['blocked','reviewed'].includes(scenario),alreadyReviewed:scenario==='reviewed',linkedAppointments:1,linkedWorkOrders:2,
rows:[{index:0,status:scenario==='unlinked'?'unlinked_source':'verified_link',appointmentId:'A-TEST',workOrderId:'W-TEST'}],
unlinkedIndexes:scenario==='unlinked'?[0]:[],blockers:scenario==='blocked'?[{code:'source_work_order_missing',index:0}]:[],
limitations:['archived_actuals_not_certified','backup_restore_not_certified','review_covers_saved_source_and_current_links_only']};};
function Harness(){const [open,setOpen]=useState(true);if(scenario.startsWith('materials-'))return <ProjectMaterialsPanel project={project} activity={{rows:[{workOrderId:'W-TEST',vanId:'VAN-SUPPORT',date:'2026-09-19'}]}} request={request}/>;return open?<HistoryReconciliationDialog project={project} request={request} busy={false} canManage={scenario!=='readonly'} onClose={()=>setOpen(false)} onSave={async(action,data)=>{window.saved.push({action,data});setOpen(false);}}/>:<main>Closed</main>;}
createRoot(document.getElementById('app')).render(<Harness/>);`;
async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, resolveDir: APP, sourcefile: 'history-harness.tsx', loader: 'tsx' }, outfile: path.join(output, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'");
    if (name === '/app.js' || name === '/app.css') { res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css'); return res.end(fs.readFileSync(path.join(output, name.slice(1)))); }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{font:16px Arial;margin:0}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const scenario of ['ready', 'blocked', 'unlinked', 'readonly', 'stale', 'error', 'late', 'reviewed', 'materials-ready', 'materials-empty', 'materials-error', 'materials-stale']) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const page = await context.newPage(); page.setDefaultTimeout(12000);
          const errors = []; const requests = []; page.on('pageerror', err => errors.push(err.message)); page.on('request', req => { if (new URL(req.url()).origin !== origin) requests.push(req.url()); });
          try {
            await page.goto(`${origin}/?case=${scenario}`); if(!scenario.startsWith('materials-'))await page.getByRole('dialog').waitFor();
            const submit = page.getByRole('button', { name: 'Finalize scheduling-history review', exact: true });
            if (scenario.startsWith('materials-')) {
              await page.getByRole('combobox', { name: 'Linked Work Order', exact: true }).waitFor();
              assert.equal(await page.evaluate(() => window.reads.length), 0);
              await page.getByRole('combobox', { name: 'Linked Work Order', exact: true }).selectOption('W-TEST');
              if (['materials-error', 'materials-stale'].includes(scenario)) { await page.getByRole('alert').waitFor(); assert.equal(await page.getByText(/No inventory issues are recorded/).count(), 0); }
              else if (scenario === 'materials-empty') await page.getByText(/not proof that the Project used no materials/).waitFor();
              else { await page.getByRole('heading', { name: 'Synthetic pipe', exact: true }).waitFor(); await page.getByText('2.125 recorded units', { exact: true }).waitFor();
                await page.getByRole('button', { name: 'Next issues', exact: true }).click(); await page.getByRole('heading', { name: 'Second issue', exact: true }).waitFor();
                assert.equal((await page.evaluate(() => window.reads)).at(-1).data.afterId, 'MOV-1');
                await page.screenshot({ path: path.join(evidence, `${name}-materials-mobile.png`), fullPage: true });
              }
            }
            else if (scenario === 'late') { await page.waitForFunction(() => typeof window.releaseRead === 'function'); await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await page.evaluate(() => window.releaseRead()); await page.getByText('Closed', { exact: true }).waitFor(); }
            else if (['stale', 'error'].includes(scenario)) { await page.getByRole('alert').waitFor(); assert.equal(await submit.count(), 0); }
            else if (scenario === 'reviewed') { await page.getByText(/Scheduling references were reviewed/).waitFor(); assert.equal(await submit.count(), 0); }
            else {
              await submit.waitFor(); assert.equal(await submit.isDisabled(), true);
              if (scenario === 'readonly') assert.equal(await page.getByRole('checkbox').first().isDisabled(), true);
              else {
                for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
                await page.getByLabel('Historical review note', { exact: true }).fill('Verified synthetic references and limitations');
                if (scenario === 'unlinked') { assert.equal(await submit.isDisabled(), true); await page.getByRole('textbox', { name: /Explain unverified source row 1/ }).fill('No reference exists in this source; retained unverified'); }
                if (scenario === 'blocked') assert.equal(await submit.isDisabled(), true);
                else { await submit.click(); await page.getByText('Closed', { exact: true }).waitFor(); const saved = await page.evaluate(() => window.saved); assert.equal(saved.length, 1); assert.equal(saved[0].action, 'finalize_history_reconciliation'); assert.equal(saved[0].data.expectedVersion, 3); assert.equal(saved[0].data.previewDigest, 'a'.repeat(64)); assert.equal(saved[0].data.unlinkedNotes.length, scenario === 'unlinked' ? 1 : 0); }
              }
              if (scenario === 'blocked') await page.screenshot({ path: path.join(evidence, `${name}-blocked-mobile.png`), fullPage: true });
            }
            if (!['ready', 'unlinked'].includes(scenario)) assert.equal(await page.evaluate(() => window.saved.length), 0);
            assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
            results.push({ browser: name, scenario, passed: true }); console.log(`PASS ${name}: ${scenario}`);
          } catch (err) { console.error(name, scenario, (await page.locator('body').innerText()).slice(0, 5000)); throw err; }
          finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify({ results, externalRequests: 0 }, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(output, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
