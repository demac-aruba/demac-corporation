'use strict';
// Real charge components, client transport and Office Booking facade over loopback.
// Authentication and database are synthetic. Every external request is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '../..');
const tooling = process.env.BOOKING_MODAL_TEST_TOOLS, evidence = process.env.BOOKING_MODAL_TEST_OUTPUT;
if (![tooling,evidence].every(value => value && path.isAbsolute(value))) throw Error('Absolute isolated tooling and output paths required.');
const { build } = require(path.join(tooling,'node_modules/esbuild'));
const { chromium } = require(path.join(tooling,'node_modules/playwright'));
const { TransactionalFirestore } = require(path.join(ROOT,'functions/test-support/transactionalFirestore'));
const { createOfficeBookingAuthorityFacade } = require(path.join(ROOT,'functions/officeBookingAuthorityFacade'));
const { prepareInitialCharges } = require(path.join(ROOT,'functions/appointmentCharges'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(),'demac-charge-browser-'));
fs.mkdirSync(evidence,{recursive:true});
const seeds = [{id:'work-1',workLineId:'work-1',presetId:'standard_service',label:'Standard service',quantity:2}];
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {BookingChargesEditor,AppointmentChargesWorkspace} from './components/scheduling/appointment-charges';
import {initialChargesAcknowledged} from './lib/appointment-charge-contract';
import {bookingChargeDraft} from './lib/appointment-charges';
window.__chargeContract={initialChargesAcknowledged,bookingChargeDraft};
import {ChargeIcon} from './components/scheduling/appointment-charge-icons';
import styles from './components/scheduling/appointment-charges.module.css';
import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';
const seeds=${JSON.stringify(seeds)};
function Harness(){const [userId,setUserId]=useState('synthetic-office');window.__setChargeUser=setUserId;window.__chargeUser=userId;const [draft,setDraft]=useState(null),[saved,setSaved]=useState(location.pathname==='/existing'),[busy,setBusy]=useState(false),[history,setHistory]=useState(false),[error,setError]=useState('');
window.__chargeDraft=draft;
async function book(){const result=await fetch('/initial',{method:'POST',body:JSON.stringify(draft)});const data=await result.json();if(!result.ok){setError(data.error);return;}window.history.replaceState(null,'','/existing');setSaved(true);}
return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><div style={{background:'#0c203e',width:210,height:'100vh',padding:24,color:'white'}}><h2>DEMAC</h2><p>ERP · CORPORATION</p><p>Dashboard</p><p>Customers</p><p style={{background:'#1268ff',padding:10,borderRadius:8}}>Schedule</p><p>Work orders</p><p>Accounting</p></div><div className={styles.modalOverlay}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Synthetic appointment"><header className={styles.modalHeader}><div><span>DEMAC · SCHEDULING</span><h2>{saved?'Detalle de la cita':'Crear cita'}</h2><p>Datos sintéticos de verificación · Noord</p></div><button aria-label="Cerrar cita" disabled={busy}>×</button></header><div className={styles.context}>{[['calendar','FECHA','10 octubre 2026'],['van','VAN','Van 1'],['clock','HORARIO','08:30 – 10:30'],['person','CLIENTE','Cliente de prueba']].map(([icon,label,text])=><div key={label}><ChargeIcon name={icon}/><div><small>{label}</small><strong>{text}</strong></div></div>)}</div><nav className={styles.modalTabs}><button>Datos de la cita</button><button className={!history?styles.active:''} disabled={busy} onClick={()=>setHistory(false)}><ChargeIcon name="receipt"/>Importes y pagos</button>{saved?<button className={history?styles.active:''} disabled={busy} onClick={()=>setHistory(true)}><ChargeIcon name="history"/>Historial</button>:null}</nav><div className={styles.modalBody}>{error?<p role="alert">{error}</p>:null}{saved?<AppointmentChargesWorkspace key={userId} currentUserId={userId} appointmentId="apt" documentContext={{customer:"Cliente de prueba",dateKey:"2026-10-10"}} canManage showHistory={history} onBusyChange={setBusy} onChanged={()=>{}}/>:<><BookingChargesEditor seeds={seeds} value={draft} onChange={setDraft} disabled={busy}/><div className={styles.workspace}><div className={styles.footer}><span>2 equipos · 2 horas reservadas</span><button className={styles.primary} disabled={!draft?.quoteToken} onClick={book}>Confirmar cita de prueba</button></div></div></>}</div></section></div></div>}
createRoot(document.getElementById('app')).render(<Harness/>);`;
async function main(){
await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(folder,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production'})},plugins:[{name:'isolated-identity-and-routing',setup(builder){builder.onResolve({filter:/firebase\/(session|client-config|isolated-preview)$/},args=>({path:path.basename(args.path),namespace:'identity'}));builder.onLoad({filter:/.*/,namespace:'identity'},args=>({contents:args.path==='session'?"export const loadFirebaseWebSession=()=>({uid:window.__chargeUser||'synthetic-office'});export async function requireFirebaseWebSession(){return {...loadFirebaseWebSession(),idToken:window.__chargeUser||'synthetic-office'};}" : args.path==='client-config'?"export const firebaseClientConfig={projectId:'demo-demac-charges'};":"export const firebaseTransportUrl=()=>'/authority';",loader:'js'}));}}]});
let db, facade, dropNext = false, denyNext = false, loseNext = false, writes = [], catalogReads = 0;
function reset(){db=new TransactionalFirestore({'users/synthetic-office':{active:true,role:'office',name:'Oficina de prueba'},'users/another-office':{active:true,role:'office',name:'Otra oficina de prueba'},'appointments/apt':{customerId:'customer',propertyId:'property',workOrderIds:['wo'],status:'confirmed'},'workOrders/wo':{status:'Confirmada',scheduledSlots:2},'services/std12':{name:'12K BTU Split Unit Standard Service - First Floor',basePrice:999,serviceDefinition:{version:1,bookingCode:'12k_standard_service'},active:true,sku:'12KFSSF',description:'Limpieza de unidad interior y exterior, filtros y revisión de funcionamiento'},'services/std18':{name:'18K BTU Split Unit Standard Service - First Floor',serviceDefinition:{version:1,bookingCode:'18k_standard_service'},active:true,sku:'18KFSSF'},'services/deep18':{name:'18K BTU Deep Cleaning',serviceDefinition:{version:1,bookingCode:'18k_deep_cleaning'},active:true,sku:'18KDEEP'},'services/time':{name:'Tiempo adicional de prueba',basePrice:45,active:true},'businessSettings/company-service-pricing-rules':{version:1,deepCleaningSplit:[{btu:18000,price:250}],standardServiceSplit:[{btu:12000,price:125},{btu:18000,price:135}]},'services/check':{name:'Check up',active:true,basePrice:55,description:'Diagnóstico y revisión del equipo',sku:'CHECK-DEMO',durationMinutes:60},'services/gas':{name:'Refrigerante de prueba',itemType:'Producto',active:true,basePrice:55,sku:'GAS-DEMO',description:'Aplicación por libra',category:'Refrigerantes'}});facade=createOfficeBookingAuthorityFacade({db,verifyIdToken:async token=>{if(!['synthetic-office','another-office'].includes(token))throw Error('Bad token');return {uid:token};}});dropNext=false;denyNext=false;loseNext=false;writes=[];catalogReads=0;}
reset();
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;
if(pathname==='/authority'||pathname==='/initial'){let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);
if(pathname==='/initial'){await db.runTransaction(async transaction=>{const commit=await prepareInitialCharges({db,transaction,input,actor:{id:'synthetic-office',source:'office-scheduling'},appointmentId:'apt',appointment:db.read('appointments/apt')});transaction.update(db.collection('appointments').doc('apt'),{jobCharges:commit.value});commit.write();});writes.push('initial');res.setHeader('Content-Type','application/json');return res.end('{}');}
if(input.action==='record_appointment_payment'&&(denyNext||loseNext)){const denied=denyNext;denyNext=false;loseNext=false;writes.push(input);res.statusCode=denied?401:503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:{code:denied?'unauthenticated':'charge_internal',message:denied?'Synthetic session expired':'Synthetic request lost before authority'}}));}
if(input.action==='list_charge_services')catalogReads++;const result=await facade.handle({method:'POST',headers:req.headers,body:input});if(['save_appointment_estimate','finalize_appointment_charges','record_appointment_payment','void_appointment_payment'].includes(input.action))writes.push(input);
res.setHeader('Content-Type','application/json');if(dropNext&&input.action==='record_appointment_payment'&&result.status===200){dropNext=false;res.statusCode=503;return res.end(JSON.stringify({error:{message:'Synthetic response lost after commit'}}));}res.statusCode=result.status;return res.end(JSON.stringify(result.body));}
if(pathname==='/app.js'||pathname==='/app.css'){res.setHeader('Content-Type',pathname.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(folder,pathname.slice(1))));}
res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
}catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.BOOKING_MODAL_CHROMIUM?{executablePath:process.env.BOOKING_MODAL_CHROMIUM}:{})});
const results=[];
try{for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:390,height:844}]){
reset();const catalogBefore=structuredClone([...db.store.entries()].filter(([key])=>key.startsWith('services/')));const context=await browser.newContext({viewport,serviceWorkers:'block'}),errors=[],external=[];
await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
try{
await page.goto(origin);
assert.equal(await page.evaluate(()=>window.__chargeContract.initialChargesAcknowledged({}, {lines:[]})),false,'Old backend cannot silently acknowledge monetary input');
assert.equal(await page.evaluate(()=>window.__chargeContract.initialChargesAcknowledged({},undefined)),true,'Old callers stay compatible');
await page.getByText('Afl. 250.00',{exact:true}).first().waitFor();
assert.equal(await page.getByLabel('BTU 1',{exact:true}).count(),0,'Booking forecast does not require BTU input');
assert.equal(await page.getByRole('button',{name:/Registrar proyección|Editar proyectado/}).count(),0);
assert.equal(writes.length,0,'Opening and quoting never write');
await page.getByLabel('Registrar anticipo al confirmar la cita').check();
await page.getByRole('button',{name:'Transferencia',exact:true}).click();
await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('100');
await page.getByLabel('Referencia / comprobante',{exact:false}).fill('DEPOSIT-TEST-100');
await page.screenshot({path:path.join(evidence,`booking-${viewport.width}.png`),fullPage:true});
await page.getByRole('button',{name:'Confirmar cita de prueba'}).click();
await page.getByLabel('Añadir servicio o producto',{exact:true}).waitFor();
await page.waitForFunction(()=>!document.querySelector('input[aria-label="Añadir servicio o producto"]').disabled);
assert.equal(db.read('appointments/apt').jobCharges.originalEstimate.totalCents,25000);
assert.equal(db.read('appointments/apt').jobCharges.receivedCents,10000);
assert.equal(db.read('appointments/apt').jobCharges.final,null,'Forecast is not actual work');
await page.screenshot({path:path.join(evidence,`appointment-${viewport.width}.png`),fullPage:true});
const add=async(query,label)=>{await page.getByLabel('Añadir servicio o producto',{exact:true}).fill(query);await page.getByRole('button',{name:label,exact:true}).click();};
await add('12KFSSF','Seleccionar 12K BTU Split Unit Standard Service - First Floor · 12KFSSF');
assert.equal(await page.getByLabel('Añadir servicio o producto',{exact:true}).inputValue(),'');
assert.equal(await page.getByLabel('Añadir servicio o producto',{exact:true}).evaluate(node=>node===document.activeElement),true);
await page.getByRole('button',{name:'Añadir',exact:true}).click();
await add('18KDEEP','Seleccionar 18K BTU Deep Cleaning · 18KDEEP');
assert.equal(await page.locator('input[aria-label^="BTU"],select[aria-label^="Servicio realizado"]').count(),0,'Selected catalog specifications are immutable');
assert.equal(await page.getByRole('button',{name:/Tarifa del catálogo/}).count(),0,'No second selector inside a selected item');
assert.equal(await page.getByText('Motivo del cambio (obligatorio)',{exact:true}).count(),0);
assert.equal(await page.getByLabel('Descripción 1',{exact:true}).inputValue(),db.read('services/std12').description);
await page.getByLabel('Descripción 1',{exact:true}).fill('Bedroom service description');
await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();
assert.equal(catalogReads,1,'Adding lines does not reload the entire catalog');
await page.getByLabel('Concepto 1',{exact:true}).scrollIntoViewIfNeeded();
await page.screenshot({path:path.join(evidence,`catalog-selection-${viewport.width}.png`),fullPage:true});
// A receipt saved alongside the work draft must preserve selected catalog articles.

await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('10');
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
await page.getByRole('status').filter({hasText:'Pago registrado'}).waitFor();
assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'12K BTU Split Unit Standard Service - First Floor');
assert.equal(await page.getByLabel('Concepto 2',{exact:true}).textContent(),'18K BTU Deep Cleaning');

await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('20');
await page.getByText('Ver detalle del pago',{exact:true}).last().click();
page.once('dialog',dialog=>dialog.accept('Synthetic correction'));
await page.getByRole('button',{name:'Anular registro',exact:true}).last().click();
await page.getByText('Anulado · Synthetic correction',{exact:true}).waitFor();
assert.equal(await page.getByLabel('Monto recibido (Afl.)',{exact:true}).inputValue(),'20');
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('label')).find(el=>el.textContent==='Monto recibido (Afl.)')?.querySelector('input')?.value==='');
assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'12K BTU Split Unit Standard Service - First Floor');
await add('diagnostico','Seleccionar Check up · CHECK-DEMO');assert.equal(await page.getByLabel('Concepto 3',{exact:true}).textContent(),'Check up');
await page.getByLabel('Precio unitario 3',{exact:true}).filter({hasText:'Afl. 55.00'}).waitFor();
assert.equal(await page.locator('input[aria-label^="Precio unitario"]').count(),0,'Unit prices cannot be edited');
await add('Tiempo adicional','Seleccionar Tiempo adicional de prueba');await page.getByLabel('Cantidad 4',{exact:true}).fill('1.5');
await add('GAS-DEMO','Seleccionar Refrigerante de prueba · GAS-DEMO');await page.getByLabel('Cantidad 5',{exact:true}).fill('1.5');await page.getByText('Afl. 580.00',{exact:true}).first().waitFor();assert.equal(await page.getByLabel('Concepto 5',{exact:true}).textContent(),'Refrigerante de prueba');await page.getByRole('button',{name:'Eliminar concepto 5',exact:true}).click();
assert.equal(await page.getByLabel('Descripción 3',{exact:true}).inputValue(),'Diagnóstico y revisión del equipo');
await page.getByLabel('Descripción 1',{exact:true}).fill('Limpieza interior y exterior - sala');await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();await page.getByText('Afl. 497.50',{exact:true}).first().waitFor();
await page.screenshot({path:path.join(evidence,`catalog-lines-${viewport.width}.png`),fullPage:true});
await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.getByRole('status').filter({hasText:'Monto final confirmado'}).waitFor();
assert.deepEqual(db.read('appointments/apt').jobCharges.final.lines.map(line=>line.serviceId),['std12','deep18','check','time']);assert.deepEqual(db.read('appointments/apt').jobCharges.final.lines.map(line=>line.btu),[12000,18000,null,null],'Specific catalog codes supply capacity automatically; fixed prices need none');
assert.equal(db.read('appointments/apt').jobCharges.final.lines[0].description,'Limpieza interior y exterior - sala');assert.equal(db.read('appointments/apt').jobCharges.final.lines[2].description,'Diagnóstico y revisión del equipo');
assert.deepEqual([...db.store.entries()].filter(([key])=>key.startsWith('services/')),catalogBefore,'Invoice descriptions cannot modify catalog documents');
assert.equal(db.read('appointments/apt').jobCharges.final.totalCents,49750);assert.equal(db.read('workOrders/wo').status,'Confirmada');
for(const [method,amount,reference] of [['Efectivo','180',''],['POS','150','POS-TEST-150'],['SUAVE','47.50','SUAVE-TEST-47']]){
await page.getByRole('button',{name:method,exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill(amount);if(reference)await page.getByLabel('Referencia / comprobante',{exact:false}).fill(reference);
if(method==='SUAVE')dropNext=true;
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
if(method==='SUAVE'){await page.getByRole('button',{name:'Reintentar la misma operación'}).waitFor();assert.equal(await page.getByRole('button',{name:'Cerrar cita'}).isDisabled(),true);await page.getByRole('button',{name:'Reintentar la misma operación'}).click();}
await page.getByRole('status').filter({hasText:'Pago registrado'}).waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('label')).find(el=>el.textContent==='Monto recibido (Afl.)')?.querySelector('input')?.value==='');
}
assert.equal(db.read('appointments/apt').jobCharges.receivedCents,49750);assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,6);
await page.getByText('✓ Pagado',{exact:true}).waitFor();
await page.screenshot({path:path.join(evidence,`final-${viewport.width}.png`),fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No document horizontal overflow');
assert.ok(await page.locator('svg').count()>=12,'Visual icons retained');
await page.getByRole('button',{name:'Historial',exact:true}).click();await page.getByText('Monto final confirmado',{exact:true}).waitFor();assert.equal(await page.getByText('Pago registrado',{exact:true}).count(),5);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
await page.reload();await page.getByText('✓ Pagado',{exact:true}).waitFor();assert.equal(db.read('appointments/apt').jobCharges.final.lines[0].description,'Limpieza interior y exterior - sala');assert.equal(db.read('appointments/apt').jobCharges.final.lines[2].description,'Diagnóstico y revisión del equipo');
assert.equal(db.read('appointments/apt').jobCharges.final.totalCents,49750);assert.equal(db.read('appointments/apt').jobCharges.receivedCents,49750);
results.push({viewport,status:'PASS',receiptCount:6,finalCents:49750});console.log('PASS financial flow '+viewport.width);
}catch(error){await page.screenshot({path:path.join(evidence,`failure-${viewport.width}.png`),fullPage:true});console.error((await page.locator('body').innerText()).slice(0,6000));throw error;}finally{await context.close();}
}
// Owner's exact case: an old appointment with no stored projection; draft work
// and saved transfer coexist, then finalization and a fresh PDF preserve identity.
reset();
const context=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block'}),external=[],errors=[];
await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
try{
await page.goto(origin+'/existing');await page.getByLabel('Añadir servicio o producto',{exact:true}).fill('12KFSSF');await page.getByRole('button',{name:'Seleccionar 12K BTU Split Unit Standard Service - First Floor · 12KFSSF',exact:true}).click();await page.getByLabel('Cantidad 1',{exact:true}).fill('3');
await page.getByLabel('Importe 1',{exact:true}).filter({hasText:'Afl. 375.00'}).waitFor();assert.equal(await page.getByRole('button',{name:'Descargar PDF',exact:true}).count(),0,'A draft has no PDF export');
await page.getByRole('button',{name:'Transferencia',exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('250');await page.getByLabel('Referencia / comprobante',{exact:false}).fill('OWNER-CASE-250');await page.getByRole('button',{name:'Registrar pago',exact:true}).click();await page.getByRole('status').filter({hasText:'Pago registrado'}).waitFor();
const balance=page.getByText('SALDO ESTIMADO',{exact:true}).locator('..');await balance.getByText('Afl. 125.00',{exact:true}).waitFor();assert.equal(await page.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3');assert.equal(db.read('appointments/apt').jobCharges.final,null);assert.equal(db.read('appointments/apt').jobCharges.originalEstimate,null);assert.equal(db.read('appointments/apt').jobCharges.receivedCents,25000);
await page.getByRole('status').filter({hasText:'Pago registrado'}).waitFor({state:'hidden',timeout:6000});assert.equal(await page.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3','Success feedback disappears; the draft remains');
// A fresh draft must survive a lease-only version change when visiting History.
await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.getAttribute('aria-label')==='Confirmar monto final'&&!button.disabled));
const beforeHistoryVersion=db.read('appointments/apt').jobCharges.version;
await page.getByRole('button',{name:'Historial',exact:true}).click();await page.getByRole('heading',{name:'Historial de importes y pagos',exact:true}).waitFor();
await page.getByRole('button',{name:'Importes y pagos',exact:true}).click();await page.getByText('Edición reservada para ti en esta cita.',{exact:true}).waitFor();
await page.getByText('SALDO ESTIMADO',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();
assert.ok(db.read('appointments/apt').jobCharges.version>beforeHistoryVersion,'History return acquires a fresh edit fence');
assert.equal(await page.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3');assert.equal(await page.getByLabel('Revisé los trabajos realizados',{exact:false}).isChecked(),false,'Lease-only rebase resets scope review');
await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.getAttribute('aria-label')==='Confirmar monto final'&&!button.disabled));
assert.equal(db.read('appointments/apt').jobCharges.final,null);assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,1);
await page.screenshot({path:path.join(evidence,'fresh-draft-after-history.png'),fullPage:true});
// The reported failure: reload AFTER the payment but BEFORE final confirmation.
page.once('dialog',dialog=>dialog.accept());await page.reload();
await page.getByLabel('Cantidad 1',{exact:true}).waitFor();assert.equal(await page.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3','Pending work survives refresh');
await page.getByText('SALDO ESTIMADO',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();
assert.equal(db.read('appointments/apt').jobCharges.final,null);assert.equal(db.read('appointments/apt').jobCharges.receivedCents,25000);
assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,1,'Recovery never records a second payment');
assert.equal(await page.getByLabel('Revisé los trabajos realizados',{exact:false}).isChecked(),false,'Restoring never confirms the work');
// Simulate the server clock reaching the old tab lease deadline, without a production write.
const lease=db.read('appointments/apt/chargeEditing/current');db.store.set('appointments/apt/chargeEditing/current',{...lease,expiresAtMs:Date.now()-1});
await page.getByRole('button',{name:'Recuperar acceso de edición',exact:true}).click();
await page.getByText('SALDO ESTIMADO',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Descargar PDF',exact:true}).count(),0);
await page.screenshot({path:path.join(evidence,'recovered-before-confirming.png'),fullPage:true});

await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.getByText('Saldo por cobrar',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();
const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar PDF',exact:true}).click();const file=await download;await file.saveAs(path.join(evidence,'owner-case-confirmed.pdf'));const pdf=fs.readFileSync(path.join(evidence,'owner-case-confirmed.pdf'),'utf8');for(const value of ['Afl. 375.00','Afl. 250.00','Afl. 125.00','OWNER-CASE-250'])assert.ok(pdf.includes(value));
await page.reload();await page.getByText('Saldo por cobrar',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();assert.equal(db.read('appointments/apt').jobCharges.final.totalCents,37500);assert.equal(db.read('appointments/apt').jobCharges.originalEstimate,null);assert.equal(db.read('workOrders/wo').status,'Confirmada');assert.equal(writes.length,2);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
const beforePreview=JSON.stringify([...db.store]);
await page.getByRole('button',{name:'Vista previa QuickBooks',exact:true}).click();
const qboPreview=page.getByRole('dialog',{name:'Vista previa QuickBooks',exact:true});
await qboPreview.getByText('Saldo operativo del ERP',{exact:true}).waitFor();
for(const value of ['Afl. 375.00','Afl. 250.00','Afl. 125.00','OWNER-CASE-250'])assert.ok((await qboPreview.innerText()).includes(value));
assert.equal(JSON.stringify([...db.store]),beforePreview,'Real guarded preparation read does not change source data');
assert.equal(writes.length,2);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
await qboPreview.getByRole('button',{name:'Cerrar vista previa QuickBooks'}).click();
results.push({name:'owner-case-reload-before-final-no-projection',status:'PASS',finalCents:37500,receivedCents:25000,balanceCents:12500,pdf:true,quickbooksReadOnlyPreview:true});console.log('PASS exact owner case: no projection, 375 work, 250 transfer, 125 balance, persistence, PDF and read-only QuickBooks preview');
}finally{await context.close();}

// Equal amounts alone do not authorize rebasing a fresh draft over another actor.
reset();const changedContext=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block'});
await changedContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const changed=await changedContext.newPage();changed.setDefaultTimeout(12000);
try{
await changed.goto(origin+'/existing');await changed.getByLabel('Añadir servicio o producto',{exact:true}).fill('12KFSSF');await changed.getByRole('button',{name:'Seleccionar 12K BTU Split Unit Standard Service - First Floor · 12KFSSF',exact:true}).click();await changed.getByLabel('Cantidad 1',{exact:true}).fill('3');
await changed.getByText('SALDO ESTIMADO',{exact:true}).locator('..').getByText('Afl. 375.00',{exact:true}).waitFor();
await changed.getByRole('button',{name:'Historial',exact:true}).click();await changed.getByRole('heading',{name:'Historial de importes y pagos',exact:true}).waitFor();
const state=db.read('appointments/apt').jobCharges;
db.store.set('appointments/apt',{...db.read('appointments/apt'),jobCharges:{...state,version:state.version+1,updatedBy:'another-office',updatedAt:'2026-10-13T19:00:00.000Z'}});
await changed.getByRole('button',{name:'Importes y pagos',exact:true}).click();await changed.getByText('Edición reservada para ti en esta cita.',{exact:true}).waitFor();
await changed.getByRole('alert').filter({hasText:'Los importes cambiaron'}).waitFor();
await changed.getByLabel('Revisé los trabajos realizados',{exact:false}).check();assert.equal(await changed.getByRole('button',{name:'Confirmar monto final',exact:true}).isDisabled(),true);
assert.equal(await changed.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3');assert.equal(db.read('appointments/apt').jobCharges.final,null);assert.equal(writes.length,0,'Changed financial evidence is never silently overwritten');
results.push({name:'fresh-draft-history-foreign-baseline-stays-blocked',status:'PASS'});console.log('PASS fresh draft remains blocked after foreign same-amount history change');
}finally{await changedContext.close();}

// Refresh after the server committed a cash receipt but its acknowledgement was lost.
reset();const uncertainContext=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block'});
await uncertainContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const uncertain=await uncertainContext.newPage();uncertain.setDefaultTimeout(12000);
try{
await uncertain.goto(origin+'/existing');await uncertain.getByLabel('Añadir servicio o producto',{exact:true}).fill('12KFSSF');await uncertain.getByRole('button',{name:'Seleccionar 12K BTU Split Unit Standard Service - First Floor · 12KFSSF',exact:true}).click();await uncertain.getByLabel('Cantidad 1',{exact:true}).fill('3');
await uncertain.getByRole('button',{name:'Efectivo',exact:true}).click();await uncertain.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('250');dropNext=true;await uncertain.getByRole('button',{name:'Registrar pago',exact:true}).click();
await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).waitFor();const request=structuredClone(writes.at(-1));
denyNext=true;await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).click();await uncertain.getByRole('alert').filter({hasText:'Synthetic session expired'}).waitFor();assert.equal(await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).isVisible(),true);
await uncertain.evaluate(()=>window.__setChargeUser('another-office'));await uncertain.getByLabel('Añadir servicio o producto',{exact:true}).waitFor();assert.equal(await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).count(),0);assert.equal(await uncertain.getByLabel('Cantidad 1',{exact:true}).count(),0);
await uncertain.evaluate(()=>window.__setChargeUser('synthetic-office'));await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).waitFor();
uncertain.once('dialog',dialog=>dialog.accept());await uncertain.reload();await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).waitFor();
assert.equal(await uncertain.getByLabel('Cantidad 1',{exact:true}).inputValue(),'3');assert.equal(await uncertain.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
await uncertain.getByRole('button',{name:'Reintentar la misma operación',exact:true}).click();await uncertain.getByRole('status').filter({hasText:'Pago registrado; los trabajos'}).waitFor();assert.deepEqual(writes.at(-1),request,'Recovery reuses the exact operation, including request identity');
assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,1);assert.equal(db.read('appointments/apt').jobCharges.receivedCents,25000);assert.equal(db.read('appointments/apt').jobCharges.final,null);
await uncertain.getByText('SALDO ESTIMADO',{exact:true}).locator('..').getByText('Afl. 125.00',{exact:true}).waitFor();
results.push({name:'cash-unknown-outcome-auth-denial-user-isolation-refresh-exact-retry',status:'PASS'});console.log('PASS unknown cash outcome survives refresh without duplicate');
}finally{await uncertainContext.close();}
// A never-submitted uncertain request is released only after a different lease
// fences any old in-flight write, then the authority proves the exact replay absent.
reset();const missingContext=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block'});
await missingContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const missing=await missingContext.newPage();missing.setDefaultTimeout(12000);
try{
await missing.goto(origin+'/existing');await missing.getByRole('button',{name:'Efectivo',exact:true}).click();await missing.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('250');loseNext=true;await missing.getByRole('button',{name:'Registrar pago',exact:true}).click();await missing.getByRole('button',{name:'Reintentar la misma operación',exact:true}).waitFor();
const oldRequest=structuredClone(writes.at(-1)),leasePath='appointments/apt/chargeEditing/current';db.store.get(leasePath).expiresAtMs=0;
await missing.getByRole('button',{name:'Reintentar la misma operación',exact:true}).click();await missing.getByRole('alert').filter({hasText:'sesión de edición venció'}).waitFor();assert.equal(await missing.getByRole('button',{name:'Reintentar la misma operación',exact:true}).isVisible(),true,'Expiry alone never proves the first request absent');
missing.once('dialog',dialog=>dialog.accept());await missing.reload();await missing.getByText('Edición reservada para ti en esta cita.',{exact:true}).waitFor();await missing.waitForFunction(()=>document.querySelector('[data-charge-stage]')?.getAttribute('aria-busy')==='false');
await missing.getByRole('button',{name:'Reintentar la misma operación',exact:true}).click();await missing.getByLabel('Monto recibido (Afl.)',{exact:true}).waitFor();await missing.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Reintentar la misma operación'));assert.equal(await missing.getByRole('button',{name:'Reintentar la misma operación',exact:true}).count(),0);assert.deepEqual(writes.at(-1),oldRequest);assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,0);await missing.waitForFunction(()=>{const input=Array.from(document.querySelectorAll('label')).find(el=>el.textContent==='Monto recibido (Afl.)')?.querySelector('input');return input&&!input.matches(':disabled');});assert.equal(await missing.getByLabel('Monto recibido (Afl.)',{exact:true}).isEnabled(),true);assert.equal(await missing.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true,'Empty form cannot submit after resolving an uncommitted request');
results.push({name:'uncommitted-request-expiry-needs-fresh-fence-before-release',status:'PASS'});console.log('PASS uncommitted request requires fresh fence before resolution');
}finally{await missingContext.close();}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(results,null,2));fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
