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
function Harness(){const [draft,setDraft]=useState(null),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[history,setHistory]=useState(false),[error,setError]=useState('');
window.__chargeDraft=draft;
async function book(){const result=await fetch('/initial',{method:'POST',body:JSON.stringify(draft)});const data=await result.json();if(!result.ok){setError(data.error);return;}setSaved(true);}
return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><div style={{background:'#0c203e',width:210,height:'100vh',padding:24,color:'white'}}><h2>DEMAC</h2><p>ERP · CORPORATION</p><p>Dashboard</p><p>Customers</p><p style={{background:'#1268ff',padding:10,borderRadius:8}}>Schedule</p><p>Work orders</p><p>Accounting</p></div><div className={styles.modalOverlay}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Synthetic appointment"><header className={styles.modalHeader}><div><span>DEMAC · SCHEDULING</span><h2>{saved?'Detalle de la cita':'Crear cita'}</h2><p>Datos sintéticos de verificación · Noord</p></div><button aria-label="Cerrar cita" disabled={busy}>×</button></header><div className={styles.context}>{[['calendar','FECHA','10 octubre 2026'],['van','VAN','Van 1'],['clock','HORARIO','08:30 – 10:30'],['person','CLIENTE','Cliente de prueba']].map(([icon,label,text])=><div key={label}><ChargeIcon name={icon}/><div><small>{label}</small><strong>{text}</strong></div></div>)}</div><nav className={styles.modalTabs}><button>Datos de la cita</button><button className={!history?styles.active:''} disabled={busy} onClick={()=>setHistory(false)}><ChargeIcon name="receipt"/>Importes y pagos</button>{saved?<button className={history?styles.active:''} disabled={busy} onClick={()=>setHistory(true)}><ChargeIcon name="history"/>Historial</button>:null}</nav><div className={styles.modalBody}>{error?<p role="alert">{error}</p>:null}{saved?<AppointmentChargesWorkspace appointmentId="apt" seeds={seeds} canManage showHistory={history} onBusyChange={setBusy} onChanged={()=>{}}/>:<><BookingChargesEditor seeds={seeds} value={draft} onChange={setDraft} disabled={busy}/><div className={styles.workspace}><div className={styles.footer}><span>2 equipos · 2 horas reservadas</span><button className={styles.primary} disabled={!draft?.quoteToken} onClick={book}>Confirmar cita de prueba</button></div></div></>}</div></section></div></div>}
createRoot(document.getElementById('app')).render(<Harness/>);`;
async function main(){
await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(folder,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production'})},plugins:[{name:'isolated-identity-and-routing',setup(builder){builder.onResolve({filter:/firebase\/(session|client-config|isolated-preview)$/},args=>({path:path.basename(args.path),namespace:'identity'}));builder.onLoad({filter:/.*/,namespace:'identity'},args=>({contents:args.path==='session'?"export async function requireFirebaseWebSession(){return {idToken:'synthetic-office'};}" : args.path==='client-config'?"export const firebaseClientConfig={projectId:'demo-demac-charges'};":"export const firebaseTransportUrl=()=>'/authority';",loader:'js'}));}}]});
let db, facade, dropNext = false, writes = [];
function reset(){db=new TransactionalFirestore({'users/synthetic-office':{active:true,role:'office',name:'Oficina de prueba'},'appointments/apt':{customerId:'customer',propertyId:'property',workOrderIds:['wo'],status:'confirmed'},'workOrders/wo':{status:'Confirmada',scheduledSlots:2},'services/time':{name:'Tiempo adicional de prueba',basePrice:45,active:true},'businessSettings/company-service-pricing-rules':{version:1,deepCleaningSplit:[{btu:36000,price:250}],standardServiceSplit:[{btu:12000,price:125},{btu:18000,price:135}]},'services/check':{name:'Check up',active:true,basePrice:55,description:'Diagnóstico y revisión del equipo',sku:'CHECK-DEMO',durationMinutes:60},'services/gas':{name:'Refrigerante de prueba',itemType:'Producto',active:true,basePrice:55,sku:'GAS-DEMO',description:'Aplicación por libra',category:'Refrigerantes'}});facade=createOfficeBookingAuthorityFacade({db,verifyIdToken:async token=>{if(token!=='synthetic-office')throw Error('Bad token');return {uid:token};}});dropNext=false;writes=[];}
reset();
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;
if(pathname==='/authority'||pathname==='/initial'){let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);
if(pathname==='/initial'){await db.runTransaction(async transaction=>{const commit=await prepareInitialCharges({db,transaction,input,actor:{id:'synthetic-office',source:'office-scheduling'},appointmentId:'apt',appointment:db.read('appointments/apt')});transaction.update(db.collection('appointments').doc('apt'),{jobCharges:commit.value});commit.write();});writes.push('initial');res.setHeader('Content-Type','application/json');return res.end('{}');}
const result=await facade.handle({method:'POST',headers:req.headers,body:input});if(['save_appointment_estimate','finalize_appointment_charges','record_appointment_payment','void_appointment_payment'].includes(input.action))writes.push(input);
res.setHeader('Content-Type','application/json');if(dropNext&&input.action==='record_appointment_payment'&&result.status===200){dropNext=false;res.statusCode=503;return res.end(JSON.stringify({error:{message:'Synthetic response lost after commit'}}));}res.statusCode=result.status;return res.end(JSON.stringify(result.body));}
if(pathname==='/app.js'||pathname==='/app.css'){res.setHeader('Content-Type',pathname.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(folder,pathname.slice(1))));}
res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
}catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.BOOKING_MODAL_CHROMIUM?{executablePath:process.env.BOOKING_MODAL_CHROMIUM}:{})});
const results=[];
try{for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:390,height:844}]){
reset();const context=await browser.newContext({viewport,serviceWorkers:'block'}),errors=[],external=[];
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
await add('standard','Seleccionar Standard service');
await page.getByLabel('BTU 1',{exact:true}).fill('12000');
await add('deep','Seleccionar Deep cleaning');
await page.getByLabel('BTU 2',{exact:true}).fill('36000');
// A receipt saved alongside the work draft must preserve line identities and BTU.
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('10');
await page.getByRole('button',{name:'Guardar pago',exact:true}).click();
await page.getByText('Registro guardado con su historial.',{exact:true}).waitFor();
assert.equal(await page.getByLabel('BTU 1',{exact:true}).inputValue(),'12000');
assert.equal(await page.getByLabel('BTU 2',{exact:true}).inputValue(),'36000');
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();
await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('20');
page.once('dialog',dialog=>dialog.accept('Synthetic correction'));
await page.getByRole('button',{name:'Anular registro',exact:true}).last().click();
await page.getByText('Anulado · Synthetic correction',{exact:true}).waitFor();
assert.equal(await page.getByLabel('Monto recibido (Afl.)',{exact:true}).inputValue(),'20');
await page.getByRole('button',{name:'Guardar pago',exact:true}).click();
await page.getByRole('button',{name:'Registrar pago',exact:true}).waitFor();
assert.equal(await page.getByLabel('BTU 1',{exact:true}).inputValue(),'12000');
await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Refrigerante de prueba · GAS-DEMO',exact:true}).click();assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Refrigerante de prueba');
await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Volver a tarifa del trabajo / BTU',exact:true}).click();assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Standard service');await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();
await page.getByLabel('Servicio realizado 2',{exact:true}).selectOption('deep_cleaning');await page.getByLabel('BTU 2',{exact:true}).fill('36000');
await add('diagnostico','Seleccionar Check up · CHECK-DEMO');assert.equal(await page.getByLabel('Concepto 3',{exact:true}).textContent(),'Check up');
await page.getByLabel('Precio unitario 3',{exact:true}).filter({hasText:'Afl. 55.00'}).waitFor();assert.equal(await page.locator('input[aria-label="Precio unitario 3"]').count(),0,'Unit prices cannot be edited');await page.getByRole('button',{name:'Tarifa del catálogo 3',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Check up · CHECK-DEMO',exact:true}).click();assert.equal(await page.getByLabel('Concepto 3',{exact:true}).textContent(),'Check up');
await add('Tiempo adicional','Seleccionar Tiempo adicional de prueba');await page.getByLabel('Cantidad 4',{exact:true}).fill('1.5');
await add('GAS-DEMO','Seleccionar Refrigerante de prueba · GAS-DEMO');await page.getByLabel('Cantidad 5',{exact:true}).fill('1.5');await page.getByText('Afl. 580.00',{exact:true}).first().waitFor();assert.equal(await page.getByLabel('Concepto 5',{exact:true}).textContent(),'Refrigerante de prueba');await page.getByRole('button',{name:'Eliminar concepto 5',exact:true}).click();
await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Deep cleaning, chequeo y 1.5 horas adicionales acordadas');await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();await page.getByText('Afl. 497.50',{exact:true}).first().waitFor();
await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.getByText('Registro guardado con su historial.',{exact:true}).waitFor();
assert.equal(db.read('appointments/apt').jobCharges.final.totalCents,49750);assert.equal(db.read('workOrders/wo').status,'Confirmada');
for(const [method,amount,reference] of [['Efectivo','180',''],['POS','150','POS-TEST-150'],['SUAVE','47.50','SUAVE-TEST-47']]){
await page.getByRole('button',{name:'Registrar pago',exact:true}).click();await page.getByRole('button',{name:method,exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill(amount);if(reference)await page.getByLabel('Referencia / comprobante',{exact:false}).fill(reference);
if(method==='SUAVE')dropNext=true;
await page.getByRole('button',{name:'Guardar pago',exact:true}).click();
if(method==='SUAVE'){await page.getByRole('button',{name:'Reintentar la misma operación'}).waitFor();assert.equal(await page.getByRole('button',{name:'Cerrar cita'}).isDisabled(),true);await page.getByRole('button',{name:'Reintentar la misma operación'}).click();}
await page.getByText('Registro guardado con su historial.',{exact:true}).waitFor();await page.getByRole('button',{name:'Registrar pago',exact:true}).waitFor();
}
assert.equal(db.read('appointments/apt').jobCharges.receivedCents,49750);assert.equal([...db.store.keys()].filter(key=>key.startsWith('payments/')).length,6);
await page.getByText('✓ Pagado',{exact:true}).waitFor();
await page.screenshot({path:path.join(evidence,`final-${viewport.width}.png`),fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No document horizontal overflow');
assert.ok(await page.locator('svg').count()>=12,'Visual icons retained');
await page.getByRole('button',{name:'Historial',exact:true}).click();await page.getByText('Monto final confirmado',{exact:true}).waitFor();assert.equal(await page.getByText('Pago registrado',{exact:true}).count(),5);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
results.push({viewport,status:'PASS',receiptCount:6,finalCents:49750});console.log('PASS financial flow '+viewport.width);
}catch(error){await page.screenshot({path:path.join(evidence,`failure-${viewport.width}.png`),fullPage:true});console.error((await page.locator('body').innerText()).slice(0,6000));throw error;}finally{await context.close();}
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(results,null,2));fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
