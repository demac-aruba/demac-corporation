'use strict';
// Actual shared dialogs; synthetic read/write transport. Real registry is tested with emulators separately.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const http = require('node:http');
const APP = path.resolve(__dirname, '..'); const tools = process.env.PROJECTS_UI_TOOLS;
if (!tools || !path.isAbsolute(tools)) throw Error('Isolated browser tooling required.');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-reviewed-flow-'));
const artifacts = path.resolve(APP, '../../projects-reviewed-flow-evidence'); fs.mkdirSync(artifacts, { recursive: true });
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PhaseProgressDialog} from './components/projects/central/phase-progress-dialog';
import {ProjectLifecycleDialog} from './components/projects/central/project-lifecycle-dialog';
import {PhaseTemplateDialog} from './components/projects/central/phase-template-dialog';
const scenario=new URLSearchParams(location.search).get('case');
const phase={id:'PH-TEST',name:'Synthetic phase',scopeOfWork:'Synthetic scope',completionCriteria:'Approved scope',plannedVanMinutes:60,dependencies:[],progressMethod:'units',unitsPlanned:10,checklist:[{id:'CL-TEST',label:'Installation checked',required:true}]};
const project={id:'P-TEST',projectNumber:'PRJ-TEST',schemaVersion:1,version:3,type:'VRF Project',planningStatus:scenario==='reopen'?'Completed':'Planned',phases:[phase],budget:{unit:'van_minutes',originalMinutes:120,currentMinutes:120,revision:1}};
window.saved=[];window.reads=[];
const template={id:'T-TEST',name:'Reusable phase',description:'Generic scope',version:2,active:true,projectType:'VRF Project',phaseCount:1,plannedVanMinutes:60};
const request=async(command)=>{
 window.reads.push(command);
 if(scenario==='late')await new Promise(resolve=>window.releaseRead=resolve);
 if(scenario==='read-error')throw Error('Synthetic read unavailable');
 if(command.action==='get_phase_progress')return {mode:'phase_progress_review',projectId:'P-TEST',projectVersion:scenario==='stale'?2:3,phaseId:'PH-TEST',phase,digest:'a'.repeat(64),canRecord:scenario!=='blocked',blockers:scenario==='blocked'?['phase_no_approved_progress_source']:[],previous:scenario==='correction'?{eventId:'PREVIOUS-EVENT',reviewedAt:'2026-09-19T12:00:00.000Z',reviewedBy:'REVIEWER',current:true,progress:{completedUnits:6,checklistIds:['CL-TEST']},measure:{percent:60},reason:'Previous cumulative checkpoint'}:null,sources:[{workOrderId:'WO-TEST',vanId:'VAN-A',revisionId:'REV-TEST'}]};
 if(command.action==='preview_project_status')return {mode:'project_lifecycle_review',projectId:'P-TEST',projectVersion:3,currentStatus:project.planningStatus,targetStatus:command.data.targetStatus,noop:false,reopening:scenario==='reopen',terminal:['Completed','Cancelled'].includes(command.data.targetStatus),canApply:scenario!=='cancel-blocked',blockers:scenario==='cancel-blocked'?['project_open_operational_work']:[],digest:'b'.repeat(64),workOrderCount:1};
 if(command.action==='list_phase_templates')return {source:'company_phase_templates',libraryVersion:4,templates:[template]};
 if(command.action==='preview_phase_template')return {mode:'template_application_preview',projectId:'P-TEST',projectVersion:3,templateId:template.id,templateVersion:2,templateName:template.name,canApply:true,blockers:[],phases:[phase],totalPlannedVanMinutes:120,digest:'c'.repeat(64)};
 throw Error('Unexpected command '+command.action);
};
function Harness(){const [open,setOpen]=useState(true);const props={project,request,busy:false,canManage:scenario!=='readonly',onClose:()=>setOpen(false),onSave:async(action,data)=>{window.saved.push({action,data});setOpen(false);}};if(!open)return <main>Dialog closed</main>;return ['active','complete','cancel-blocked','reopen'].includes(scenario)?<ProjectLifecycleDialog {...props}/>:scenario.startsWith('template')?<PhaseTemplateDialog {...props}/>:<PhaseProgressDialog {...props} phase={phase}/>;}
createRoot(document.getElementById('app')).render(<Harness/>);`;
async function main() {
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'),
    stdin: { contents: entry, resolveDir: APP, sourcefile: 'reviewed-harness.tsx', loader: 'tsx' },
    outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'");
    if (name === '/app.js' || name === '/app.css') {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css');
      return res.end(fs.readFileSync(path.join(out, name.slice(1))));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial;background:#f5f7fb;color:#13233b}*{box-sizing:border-box}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const [browserName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const scenario of ['partial','full','correction','blocked','readonly','stale','read-error','late','active','complete','cancel-blocked','reopen','template-apply','template-save','template-replace','template-archive']) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
          const page = await context.newPage(); page.setDefaultTimeout(12000);
          const errors = [], external = []; page.on('pageerror', error => errors.push(error.message));
          page.on('request', request => { if (new URL(request.url()).origin !== url) external.push(request.url()); });
          let wrote = false;
          try {
            await page.goto(`${url}/?case=${scenario}`); await page.getByRole('dialog').waitFor();
            if (['stale','read-error'].includes(scenario)) {
              await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('button', { name: 'Save cumulative checkpoint', exact: true }).count(), 0);
            } else if (scenario === 'late') {
              await page.waitForFunction(() => typeof window.releaseRead === 'function');
              await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
              await page.evaluate(() => window.releaseRead()); await page.getByText('Dialog closed', { exact: true }).waitFor();
              assert.equal(await page.getByRole('dialog').count(), 0);
            } else if (['partial','full','correction','blocked','readonly'].includes(scenario)) {
              const input = page.getByRole('spinbutton', { name: 'Cumulative verified units', exact: true }); await input.waitFor();
              const submit = page.getByRole('button', { name: 'Save cumulative checkpoint', exact: true });
              assert.equal(await submit.isDisabled(), true);
              if (scenario !== 'readonly') {
                await input.fill(scenario === 'full' ? '10' : scenario === 'correction' ? '2' : '4');
                await page.getByRole('checkbox', { name: 'Installation checked', exact: true }).check();
                await page.getByLabel('Progress review or correction note', { exact: true }).fill('Reviewed synthetic cumulative work');
              }
              if (scenario === 'correction') {
                assert.equal(await submit.isDisabled(), true);
                await page.getByRole('checkbox', { name: /I am correcting the previous checkpoint/ }).check();
              }
              if (['blocked','readonly'].includes(scenario)) assert.equal(await submit.isDisabled(), true);
              else {
                assert.equal(await submit.isDisabled(), false);
                if (scenario === 'partial') await page.screenshot({ path: path.join(artifacts, `${browserName}-partial-mobile.png`), fullPage: true });
                await submit.click(); wrote = true;
                const saved = await page.evaluate(() => window.saved); assert.equal(saved[0].action, 'record_phase_progress');
                assert.equal(saved[0].data.progress.completedUnits, scenario === 'full' ? 10 : scenario === 'correction' ? 2 : 4);
                assert.equal(saved[0].data.expectedVersion, 3); assert.equal(saved[0].data.previewDigest, 'a'.repeat(64));
                if (scenario === 'correction') assert.equal(saved[0].data.correctsEventId, 'PREVIOUS-EVENT');
              }
            } else if (['active','complete','cancel-blocked','reopen'].includes(scenario)) {
              const target = scenario === 'complete' ? 'Completed' : scenario === 'cancel-blocked' ? 'Cancelled' : 'Active';
              await page.getByRole('combobox', { name: 'New Project status', exact: true }).selectOption(target);
              await page.getByLabel('Reason for status change', { exact: true }).fill('Reviewed synthetic state change');
              const submit = page.getByRole('button', { name: 'Confirm Project status', exact: true });
              if (scenario === 'complete') { assert.equal(await submit.isDisabled(), true); await page.getByRole('checkbox', { name: /entire Project scope is finished/ }).check(); }
              if (scenario === 'reopen') { await page.getByRole('checkbox', { name: /explicitly authorize reopening/ }).waitFor(); assert.equal(await submit.isDisabled(), true); await page.getByRole('checkbox', { name: /explicitly authorize reopening/ }).check(); }
              if (scenario === 'cancel-blocked') { await page.getByText(/There are outstanding visits or reservations/).waitFor(); assert.equal(await submit.isDisabled(), true); }
              else {
                await submit.click(); wrote = true; const saved = await page.evaluate(() => window.saved);
                assert.equal(saved[0].action, 'transition_project_status'); assert.equal(saved[0].data.targetStatus, target);
                if (scenario === 'complete') assert.equal(saved[0].data.scopeConfirmed, true);
                if (scenario === 'reopen') assert.equal(saved[0].data.reopeningConfirmed, true);
              }
            } else {
              const operation = scenario === 'template-apply' ? 'apply' : scenario === 'template-archive' ? 'manage' : 'save';
              await page.getByRole('combobox', { name: 'Template operation', exact: true }).selectOption(operation);
              await page.getByRole('combobox', { name: 'Company template', exact: true }).waitFor();
              if (scenario !== 'template-save') await page.getByRole('combobox', { name: 'Company template', exact: true }).selectOption('T-TEST');
              await page.getByLabel('Reason for this template operation', { exact: true }).fill('Reviewed optional template operation');
              if (operation === 'save') {
                await page.getByLabel('Template name', { exact: true }).fill('Synthetic reusable installation');
                await page.getByLabel('Template description', { exact: true }).fill('Generic plan');
                if (scenario === 'template-replace') {
                  assert.equal(await page.getByRole('button', { name: 'Save company template', exact: true }).isDisabled(), true);
                  await page.getByRole('checkbox', { name: /Replace this library template/ }).check();
                }
              }
              const buttonName = operation === 'apply' ? 'Apply template phases' : operation === 'manage' ? 'Archive template' : 'Save company template';
              const submit = page.getByRole('button', { name: buttonName, exact: true });
              if (scenario === 'template-apply') { await page.getByRole('heading', { name: 'Reusable phase', exact: true }).waitFor(); await page.screenshot({ path: path.join(artifacts, `${browserName}-template-mobile.png`), fullPage: true }); }
              await submit.click(); wrote = true;
              const saved = await page.evaluate(() => window.saved);
              assert.equal(saved[0].action, operation === 'apply' ? 'apply_phase_template' : operation === 'manage' ? 'set_phase_template_active' : 'save_phase_template');
              if (scenario === 'template-apply') assert.equal(saved[0].data.previewDigest, 'c'.repeat(64));
            }
            if (wrote) await page.getByText('Dialog closed', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.saved.length), wrote ? 1 : 0);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
            assert.deepEqual(errors, []); assert.deepEqual(external, []);
            results.push({ browser: browserName, scenario, passed: true }); console.log(`PASS ${browserName}: ${scenario}`);
          } catch (error) {
            console.error('REVIEWED_UI_FAILURE', browserName, scenario, JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0,6500) }));
            await page.screenshot({ path: path.join(artifacts, `${browserName}-${scenario}-failure.png`), fullPage: true }); throw error;
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify({ results, externalRequestsForwarded: 0 }, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(out, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
