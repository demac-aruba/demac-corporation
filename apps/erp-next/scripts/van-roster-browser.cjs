'use strict';
// Real fleet workspace + real server domain transaction, with only synthetic transport/data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const APP = path.resolve(__dirname, '..'), ROOT = path.resolve(APP, '../..');
const out = process.env.VAN_ROSTER_TEST_OUTPUT;
if (!out || !path.isAbsolute(out)) throw Error('Absolute VAN_ROSTER_TEST_OUTPUT required');
const paths = [process.env.VAN_ROSTER_TEST_TOOLS, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
const { build } = require(require.resolve('esbuild', { paths })), { chromium } = require(require.resolve('playwright', { paths }));
const { TransactionalFirestore } = require(path.join(ROOT, 'functions/test-support/transactionalFirestore'));
const { seed } = require(path.join(ROOT, 'functions/test-support/vanRosterFixture'));
const { createVanRosterAuthority } = require(path.join(ROOT, 'functions/vanRosterAuthority'));
let db, api, attempts;
const reset = () => { db = new TransactionalFirestore(seed()); api = createVanRosterAuthority({ db, clock: () => new Date('2026-10-26T17:00:00Z') }); attempts = []; };
const stubs = {
  'auth-provider': `export function useAuth(){return {principal:{active:true,userId:'operator',displayName:'Synthetic Operator',capabilities:new Set(['scheduling.manage'])}};}`,
  'van-schedule-settings': `export async function getVanScheduleGroupSettings(){return {success:true,groups:[]};}export async function saveVanScheduleGroupSetting(){throw Error('Not part of test');}`,
  'canonical-operations-mutations': `const denied=async()=>{throw Error('Unexpected individual save');};export {denied as deleteCanonicalDailyVanAssignment,denied as saveCanonicalDailyVanAssignment,denied as saveCanonicalVanHalfDaySchedule,denied as saveCanonicalVanMaintenanceLog,denied as saveCanonicalVanProfile};`,
  'firestore-rest': `export async function listFirestoreCollection(name){return fetch('/collection/'+name).then(r=>r.json());}`,
  'office-booking-authority': `export class OfficeBookingRequestError extends Error{constructor(m,unknown){super(m);this.outcomeUnknown=unknown;}}export const officeBookingOutcomeUnknown=e=>!(e instanceof OfficeBookingRequestError)||e.outcomeUnknown;export async function callOfficeBookingAuthority(action,data){const response=await fetch('/api'+(window.loseNext?'?lose=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});window.loseNext=false;const payload=await response.json();if(!response.ok)throw new OfficeBookingRequestError(payload.error.message,response.status>=500);return payload;}`,
};
async function main() {
  fs.mkdirSync(out, { recursive: true }); reset();
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AdvancedVansWorkspace} from './components/vans/advanced-vans-workspace';createRoot(document.getElementById('app')).render(<AdvancedVansWorkspace/>);`, loader: 'tsx', resolveDir: APP }, outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [{ name: 'synthetic-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, args => { const name = args.path.split('/').at(-1); if (stubs[name]) return { path: name, namespace: 'synthetic' }; });
    b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: APP }));
  } }] });
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body); if (request.action === 'save_van_roster') attempts.push(request.data);
      res.setHeader('Content-Type', 'application/json');
      try { const result = await api.execute({ ...request, uid: 'operator' });
        if (req.url.includes('lose=1') && request.action === 'save_van_roster') { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: 'Synthetic lost response' } })); }
        return res.end(JSON.stringify(result));
      } catch (error) { res.statusCode = error.status || 500; return res.end(JSON.stringify({ error: { message: error.message } })); }
    }
    if (req.url.startsWith('/collection/')) { const name = req.url.split('/').at(-1); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify([...db.store].filter(([key]) => key.startsWith(name+'/') && key.split('/').length === 2).map(([key,value])=>({...value,id:key.split('/')[1]})))); }
    if (['/app.js', '/app.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(path.join(out, req.url.slice(1)))); }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:14px Arial;--canvas:#f5f7fb;--surface:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--brand:#1465ff;--success:#148158}*{box-sizing:border-box}</style></head><body><p>SYNTHETIC TEST · NO PRODUCTION DATA</p><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.VAN_ROSTER_CHROMIUM ? { executablePath: process.env.VAN_ROSTER_CHROMIUM } : {}) });
    for (const [name, viewport] of [['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]]) {
      reset(); const page = await browser.newPage({ viewport }); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(origin); await page.getByLabel('Van 1 ayudante', { exact: true }).waitFor();
      await page.getByLabel('Van 1 ayudante', { exact: true }).selectOption('helper-b');
      await page.getByRole('button', { name: 'Guardar todos los cambios', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'repetido' }).waitFor();
      assert.equal(db.read('vans/legacy-101').regularHelperId,'helper-a');
      assert.equal(await page.getByLabel('Van 1 ayudante', { exact: true }).inputValue(),'helper-b');
      // Changing selected Van does not remount or discard the shared roster draft.
      await page.locator('aside').getByRole('button').filter({ hasText: 'Van 2' }).click();
      assert.equal(await page.getByLabel('Van 1 ayudante', { exact: true }).inputValue(),'helper-b');
      await page.getByLabel('Van 2 ayudante', { exact: true }).selectOption('helper-a');
      await page.screenshot({ path: path.join(out,name+'-draft.png'), fullPage:true });
      await page.evaluate(()=>{window.loseNext=true;});
      await page.getByRole('button', { name: 'Guardar todos los cambios', exact: true }).click();
      await page.getByRole('button',{name:'Confirmar guardado pendiente',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Van 1 ayudante', { exact: true }).isDisabled(),true);
      assert.equal(db.read('vans/legacy-101').regularHelperId,'helper-b');
      await page.reload();
      await page.getByRole('button',{name:'Confirmar guardado pendiente',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Equipos guardados'}).waitFor();
      assert.deepEqual(attempts[1],attempts[2]);
      assert.equal(db.read('vans/legacy-101').crewHistory.length,2);
      assert.equal(db.read('workOrders/pending').technicianIds[1],'helper-b');
      await page.screenshot({path:path.join(out,name+'-saved.png'),fullPage:true});
      assert.deepEqual(errors,[]); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.close(); console.log('PASS '+name+': draft navigation, duplicate rejection, atomic swap and reload/retry after lost response');
    }
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
