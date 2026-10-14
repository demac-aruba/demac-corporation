'use strict';
// Actual component and nested-dialog ownership, synthetic guarded read, no external network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.BOOKING_MODAL_TEST_TOOLS, evidence = process.env.BOOKING_MODAL_TEST_OUTPUT;
if (![tooling, evidence].every(value => value && path.isAbsolute(value))) throw Error('Absolute isolated tooling/output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-qbo-preview-'));
fs.mkdirSync(evidence, { recursive: true });
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AppointmentQuickBooksPreviewButton} from './components/scheduling/appointment-quickbooks-preview';
import {useBookingDialog} from './components/scheduling/use-booking-dialog';
function Harness(){const [id,setId]=useState('appointment-synthetic'),[version,setVersion]=useState(4),[visible,setVisible]=useState(true);
window.__change=(id,version)=>{setId(id);setVersion(version);};window.__hide=()=>setVisible(false);
const ref=useBookingDialog(()=>setVisible(false),false,visible);
return <main style={{fontFamily:'Arial',padding:16}}><p>DEMAC · Datos sintéticos · Prueba aislada</p>{visible?<aside ref={ref} role="dialog" aria-modal="true" aria-label="Cita de prueba" style={{padding:16,border:'1px solid #ddd'}}><h1>Importes y pagos</h1><AppointmentQuickBooksPreviewButton key={id+':'+version} appointmentId={id} currentUserId="owner-test" expectedVersion={version}/></aside>:<p>Cita cerrada</p>}</main>}
createRoot(document.getElementById('app')).render(<React.StrictMode><Harness/></React.StrictMode>);`;
const record = { success: true, blocker: '', history: [], appointmentStatus: 'confirmed', state: { schemaVersion: 1, version: 4,
  originalEstimate: null, estimate: null, receivedCents: 25000, paymentCount: 1,
  final: { currency: 'AWG', capturedAt: '2026-10-13T16:00:00Z', quoteToken: 'synthetic', totalCents: 37500, knownTotalCents: 37500,
    lines: [{ id: 'line-1', serviceId: 'standard-12k', label: 'Servicio estándar 12k · ejemplo', quantityMillis: 3000, unitCents: 12500,
      totalCents: 37500, pendingReason: '', pricingVersion: 'test' }] } }, payments: [{ id: 'payment-1', source: 'appointment-operational',
  amountCents: 25000, method: 'transfer', reference: 'REFERENCIA-DE-PRUEBA', receivedAt: '2026-10-13T00:10:00Z', status: 'recorded' }] };
const stubs = {
  'appointment-charges': `export const chargeMoney=c=>'Afl. '+(c/100).toFixed(2);export const paymentMethods=[{id:'transfer',label:'Transferencia'}];
export async function getAppointmentCharges(id){window.__reads.push(id);if(window.__hold)await new Promise(resolve=>window.__release=resolve);if(window.__error)throw Error(window.__error);return structuredClone(window.__record);}`,
  'session': `export const loadFirebaseWebSession=()=>({uid:window.__uid});`,
};
async function main() {
  await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'synthetic-read-only',setup(b){b.onResolve({filter:/.*/},args=>{const key=path.basename(args.path);if(stubs[key])return {path:key,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'ts',resolveDir:APP}));}}]});
  const server = http.createServer((req,res)=>{const file=new URL(req.url,'http://local').pathname;
    if(['/app.js','/app.css'].includes(file)){res.setHeader('Content-Type',file.endsWith('js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,file.slice(1))));}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.BOOKING_MODAL_CHROMIUM?{executablePath:process.env.BOOKING_MODAL_CHROMIUM}:{})});const results=[];
  async function run(name,fn,flags={},viewport={width:1440,height:1000}) {
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),external=[],errors=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
    await context.addInitScript(({record,flags})=>Object.assign(window,{__record:record,__uid:'owner-test',__reads:[],__hold:false,__error:'',...flags}),{record,flags});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
    try{await page.goto(origin);await fn(page);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}
    catch(error){await page.screenshot({path:path.join(evidence,name+'-failure.png'),fullPage:true});throw error;}finally{await context.close();}
  }
  const trigger=page=>page.getByRole('button',{name:'Vista previa QuickBooks',exact:true});
  const preview=page=>page.getByRole('dialog',{name:'Vista previa QuickBooks',exact:true});
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}])await run('confirmed-preview-'+viewport.width,async page=>{
      assert.equal(await page.evaluate(()=>window.__reads.length),0);await trigger(page).click();await preview(page).getByText('Afl. 375.00',{exact:true}).first().waitFor();
      assert.match(await preview(page).innerText(),/Afl\. 250.00/);assert.match(await preview(page).innerText(),/Saldo operativo del ERP/);assert.match(await preview(page).innerText(),/Afl\. 125.00/);
      assert.match(await preview(page).innerText(),/2026-10-12/);assert.match(await preview(page).innerText(),/no envía datos/);
      assert.equal(await page.getByRole('button',{name:/^(Enviar|Sincronizar|Crear factura)/}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await page.screenshot({path:path.join(evidence,'preview-'+viewport.width+'.png'),fullPage:true});
      await page.keyboard.press('Escape');assert.equal(await preview(page).count(),0);assert.equal(await page.getByRole('dialog',{name:'Cita de prueba',exact:true}).count(),1);
      assert.equal(await trigger(page).evaluate(button=>button===document.activeElement),true,'Close restores keyboard focus to the preview trigger');
    },{},viewport);
    await run('double-click-deduplicates-and-close-discards-late-response',async page=>{
      await trigger(page).evaluate(button=>{button.click();button.click();});await preview(page).getByRole('status').waitFor();
      assert.equal(await page.evaluate(()=>window.__reads.length),1);await preview(page).getByRole('button',{name:'Cerrar vista previa QuickBooks'}).click();
      await page.evaluate(()=>window.__release());assert.equal(await preview(page).count(),0);
      await page.evaluate(()=>{window.__hold=false;});await trigger(page).click();await preview(page).getByText('Afl. 375.00',{exact:true}).first().waitFor();
      assert.equal(await page.evaluate(()=>window.__reads.length),2);
    },{__hold:true});
    await run('changed-session-hides-response',async page=>{
      await trigger(page).click();await preview(page).getByRole('status').waitFor();await page.evaluate(()=>{window.__uid='other';window.__release();});
      await preview(page).getByRole('alert').waitFor();assert.doesNotMatch(await preview(page).innerText(),/375.00|250.00|REFERENCIA-DE-PRUEBA/);
    },{__hold:true});
    await run('changed-appointment-discards-old-request',async page=>{
      await trigger(page).click();await preview(page).getByRole('status').waitFor();await page.evaluate(()=>window.__change('another-appointment',4));
      await page.evaluate(()=>window.__release());assert.equal(await preview(page).count(),0);
      await page.evaluate(()=>{window.__hold=false;});await trigger(page).click();await preview(page).getByText('Afl. 375.00',{exact:true}).first().waitFor();
      assert.deepEqual(await page.evaluate(()=>window.__reads),['appointment-synthetic','another-appointment']);
    },{__hold:true});
    await run('changed-source-version-requires-refresh',async page=>{
      await page.evaluate(()=>window.__record.state.version++);await trigger(page).click();await preview(page).getByRole('alert').waitFor();
      assert.match(await preview(page).innerText(),/Los importes cambiaron/);assert.equal(await preview(page).getByRole('table').count(),0);
    });
    await run('guarded-read-error-does-not-retain-old-figures',async page=>{
      await trigger(page).click();await preview(page).getByText('Afl. 375.00',{exact:true}).first().waitFor();await page.keyboard.press('Escape');
      await page.evaluate(()=>window.__error='Acceso denegado de prueba');await trigger(page).click();await preview(page).getByRole('alert').waitFor();
      assert.doesNotMatch(await preview(page).innerText(),/375.00|250.00/);
    });
    await run('source-reconciliation-blocker-does-not-show-financial-preview',async page=>{
      await page.evaluate(()=>window.__record.blocker='Legacy reconciliation');await trigger(page).click();
      await preview(page).getByRole('heading',{name:'Revisar los registros del ERP'}).waitFor();assert.equal(await preview(page).getByRole('table').count(),0);
      assert.doesNotMatch(await preview(page).innerText(),/375.00|250.00/);
    });
    fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({source:'synthetic-only',externalRequests:0,providerWrites:0,results},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
