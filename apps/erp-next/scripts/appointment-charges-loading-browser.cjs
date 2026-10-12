// Real drawer, finance component and read hook; synthetic authority with controlled
// latency and concurrency. External requests and production mutations are forbidden.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {appointment,stubs:detailStubs}=require('./appointment-detail-browser.cjs');
const APP=path.resolve(__dirname,'..'),tooling=process.env.BOOKING_MODAL_TEST_TOOLS,artifacts=process.env.BOOKING_MODAL_TEST_OUTPUT;
const {build}=require(path.join(tooling,'node_modules/esbuild')),{chromium}=require(path.join(tooling,'node_modules/playwright'));
const output=fs.mkdtempSync(path.join(os.tmpdir(),'demac-charges-loading-'));fs.mkdirSync(artifacts,{recursive:true});
const stubs={...detailStubs};delete stubs['appointment-charges'];
stubs['office-booking-authority']+=`
export const officeBookingOutcomeUnknown=error=>error.unknown===true;
export async function callOfficeBookingAuthority(action,data){
 if(action==='get_appointment_charges'){
  const index=window.__reads.push({id:data.appointmentId,at:performance.now()})-1;
  const result=structuredClone(window.__record),failure=window.__readError;
  if(window.__holdReads)await new Promise(resolve=>window.__release[index]=resolve);
  else await new Promise(resolve=>setTimeout(resolve,window.__delay));
  if(failure)throw Error(failure);return result;
 }
 if(action==='quote_appointment_charges')window.__quoteReads=(window.__quoteReads||0)+1;
 if(action==='quote_appointment_charges'){
  window.__lastQuoteInput=structuredClone(data);
  const saved=window.__record.state.final||window.__record.state.estimate;
  const lines=data.lines.map(line=>{const old=saved.lines.find(x=>x.id===line.id&&(x.serviceId||'')===(line.serviceId||'')&&(x.presetId||'')===(line.presetId||'')&&(x.btu||null)===(line.btu||null));const unitCents=old?old.unitCents:line.serviceId?5500:null;return {...line,quantityMillis:Number(line.quantity)*1000,unitCents,baseUnitCents:unitCents,totalCents:unitCents===null?null:Math.round(unitCents*Number(line.quantity)),pendingReason:unitCents===null?'Selecciona un servicio con tarifa':'',manualPrice:!!old?.manualPrice};});
  const knownTotalCents=lines.reduce((n,line)=>n+(line.totalCents||0),0);
  return {success:true,quote:{...saved,lines,totalCents:lines.every(l=>l.unitCents!==null)?knownTotalCents:null,knownTotalCents,quoteToken:'synthetic-quote'}};
 }
 if(action.endsWith('_appointment_charge_edit')){
  (window.__leaseCalls||=[]).push({action,data});
  if(window.__leaseHold&&action==='acquire_appointment_charge_edit')await new Promise(resolve=>window.__leaseRelease=resolve);
  if(window.__leaseError)throw Error('Synthetic lease unavailable');
  const mine=!window.__leaseOther&&action!=='release_appointment_charge_edit';
  return {success:true,edit:{held:true,mine,ownerName:mine?'Operador de prueba':'Scarlet de prueba',token:mine?'synthetic-lease':undefined,financialVersion:window.__leaseVersion||window.__record.state?.version||1,serverTime:new Date().toISOString(),expiresAt:window.__badExpiry?'invalid':new Date(Date.now()+(window.__leaseTtl||90000)).toISOString(),ttlMs:window.__leaseTtl||90000}};
 }
 if(action==='list_charge_services'){window.__catalogReads=(window.__catalogReads||0)+1;if(window.__catalogHold)await new Promise(resolve=>window.__catalogRelease=resolve);if(window.__catalogError)throw Error('Synthetic catalog read failed');return {success:true,services:structuredClone(window.__catalogItems||[])};}
 window.__writes.push({action,data:structuredClone(data)});
 if(window.__unknown)throw Object.assign(Error('Synthetic unknown outcome'),{unknown:true});
 if(data.expectedVersion!==window.__record.state.version)throw Error('Synthetic version conflict');
 window.__record.state.version++;return {success:true,state:window.__record.state};
}`;
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LiveAppointmentDetailsDrawer} from './components/scheduling/live-appointment-details-drawer';import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';
function Harness(){const [open,setOpen]=useState(true),[id,setId]=useState('APPOINTMENT-TEST'),[session,setSession]=useState(1);window.__select=setId;window.__session=()=>setSession(n=>n+1);return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}>{open?<LiveAppointmentDetailsDrawer key={session} appointment={{...${JSON.stringify(appointment)},id}} canManage={window.__canManage!==false} onClose={()=>setOpen(false)} onChanged={()=>{}}/>:<p>Cita cerrada</p>}</div>}createRoot(document.getElementById('app')).render(<React.StrictMode><Harness/></React.StrictMode>);`;
const quote={lines:[{id:'line-1',label:'CheckUp de ejemplo',quantityMillis:1000,unitCents:15000,totalCents:15000,baseUnitCents:15000,pendingReason:'',manualPrice:false}],totalCents:15000,knownTotalCents:15000,currency:'AWG',capturedAt:'2026-10-10T12:00:00Z',quoteToken:'synthetic-quote'};
const record={success:true,state:{schemaVersion:1,version:1,originalEstimate:quote,estimate:quote,final:null,receivedCents:0,paymentCount:0},history:[],payments:[],blocker:'',appointmentStatus:'confirmed',candidateEvidence:{fingerprint:'field-v1',records:[{id:'field',revisionNumber:1,lines:[{description:'Revisión de ejemplo',quantity:1,lineTotal:150}],blockers:[]}]}};
// Synthetic final snapshot exercises agreed prices, changed scope, add-ons and voids.
const premium=structuredClone(record);
const work=(id,label,cents,btu)=>({...quote.lines[0],id,label,baseUnitCents:12500,unitCents:cents,totalCents:cents,btu});
premium.state.originalEstimate={...quote,lines:[work('ac-1','Standard service',12500,12000),work('ac-2','Standard service',13500,18000)],totalCents:26000,knownTotalCents:26000};
premium.state.estimate=structuredClone(premium.state.originalEstimate);
premium.state.final={...quote,lines:[work('ac-1','Standard service',12500,12000),{...work('ac-2','Deep cleaning',23500,18000),manualPrice:true,reason:'Limpieza profunda autorizada'},work('addon','Tratamiento antibacterial',7000)],totalCents:43000,knownTotalCents:43000,note:'Se autorizó limpieza profunda y tratamiento antibacterial.'};
premium.state.receivedCents=20000;premium.state.paymentCount=3;
premium.payments=[{id:'p1',method:'transfer',amountCents:15000,status:'recorded',createdAt:'2026-10-10T10:00:00Z',receivedAt:'2026-10-10T10:00:00Z',createdByName:'Operador de prueba',reference:'REF-DEMO-01'},{id:'p2',method:'cash',amountCents:5000,status:'recorded',createdAt:'2026-10-10T11:00:00Z',receivedAt:'2026-10-10T11:00:00Z',createdByName:'Operador de prueba'},{id:'p3',method:'pos',amountCents:1000,status:'voided',createdAt:'2026-10-10T11:30:00Z',receivedAt:'2026-10-10T11:30:00Z',voidReason:'Referencia duplicada de prueba'}];
premium.candidateEvidence={fingerprint:'field-v1',records:[]};
const catalogItems=[{id:'line-service',name:'Deep cleaning',itemType:'Servicio',description:'Limpieza profunda con desmontaje del equipo',category:'Mantenimiento',sku:'DEEP-DEMO',durationMinutes:120},{id:'gas',name:'Refrigerante de prueba',itemType:'Producto',description:'Aplicación y revisión por libra',category:'Refrigerantes',sku:'R410A-DEMO',durationMinutes:null},{id:'other-gas',name:'Refrigerante de prueba',itemType:'Producto',description:'Otro producto con identidad diferente',category:'Refrigerantes',sku:'R32-DEMO',durationMinutes:null}];
// Upper-bound synthetic catalog and charge-line count. No live catalog is read.
const largeCatalog=Array.from({length:1000},(_,index)=>({id:`perf-${index}`,name:`Artículo de prueba ${String(index).padStart(4,'0')} `.padEnd(220,'n'),itemType:index%2?'Producto':'Servicio',description:'Descripción sintética para buscar aplicación '.padEnd(600,'d'),category:'Categoría de prueba '.padEnd(120,'c'),sku:`SKU-PERF-${String(index).padStart(4,'0')} `.padEnd(120,'s'),durationMinutes:index%2?null:60}));
const largeRecord=structuredClone(premium);largeRecord.state.final.lines=Array.from({length:60},(_,index)=>({...work(`perf-line-${index}`,`Concepto de prueba ${index+1}`,12500),serviceId:`perf-${index}`}));largeRecord.state.final.totalCents=750000;largeRecord.state.final.knownTotalCents=750000;
const catalogPerformanceOnly=process.argv.includes('--catalog-performance-only');
const desktop={width:1440,height:1000};
const tab=(page,name)=>page.getByRole('navigation',{name:'Secciones de la cita'}).getByRole('button',{name,exact:true});
const finance=page=>page.locator('[data-charge-stage]');
async function loaded(page){await page.waitForFunction(()=>document.querySelector('[data-charge-stage]')?.getAttribute('aria-busy')==='false');}
async function openFinance(page){await tab(page,'Importes y pagos').click();await loaded(page);}
async function reads(page){return page.evaluate(()=>window.__reads.length);}
async function focus(page,age=31_000){await page.evaluate(age=>{window.__offset+=age;window.dispatchEvent(new Event('focus'));},age);}
async function main(){
 await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'development'})},plugins:[{name:'synthetic-authority',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=path.basename(args.path);if(key==='booking-visit-references'&&args.path.includes('/lib/'))return {path:'booking-reference-data',namespace:'fixture'};if(stubs[key])return {path:key,namespace:'fixture'};});builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:APP}));}}]});
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;if(['/app.js','/app.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,name.slice(1))));}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.BOOKING_MODAL_CHROMIUM?{executablePath:process.env.BOOKING_MODAL_CHROMIUM}:{})});const results=[];
 async function run(name,test,flags={},viewport=desktop){if(catalogPerformanceOnly&&name!=='catalog-1000-items-bounded-local-search')return;const context=await browser.newContext({viewport,serviceWorkers:'block'}),errors=[],external=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});await context.addInitScript(({record,flags})=>{Object.assign(window,{__sequence:0,__referenceReads:[],__referenceWrites:[],__commReads:[],__commWrites:[],__lifecycle:[],__uploads:[],__mediaReads:[],__record:record,__reads:[],__writes:[],__release:[],__delay:0,__offset:0,...flags});const now=Date.now;Date.now=()=>now()+window.__offset;},{record,flags});const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));try{await page.goto(origin);await test(page);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){await page.screenshot({path:path.join(artifacts,name+'-failure.png'),fullPage:true});console.error({name,errors,text:(await page.locator('body').innerText()).slice(0,5000)});throw error;}finally{await context.close();}}
 try{
  for(const viewport of [desktop,{width:390,height:844}])await run('preload-retention-'+viewport.width,async page=>{
   await page.waitForFunction(()=>window.__reads.length===1);assert.equal(await tab(page,'Resumen').getAttribute('aria-current'),'page');await loaded(page);
   const start=Date.now();await openFinance(page);const clickToVisibleMs=Date.now()-start;assert.ok(clickToVisibleMs<600,'Preloaded tab should not wait for the synthetic 1200ms server delay');
   for(const name of ['Resumen','Importes y pagos','Historial','Importes y pagos']){await tab(page,name).click();assert.equal(await tab(page,name).evaluate(node=>getComputedStyle(node).cursor),'pointer');}
   assert.equal(await reads(page),1,'StrictMode and tab changes share one initial read');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
   await page.screenshot({path:path.join(artifacts,'loaded-'+viewport.width+'.png'),fullPage:true});results.push({name:'latency-'+viewport.width,syntheticServerMs:1200,clickToVisibleMs});
  },{__delay:1200},viewport);
  await run('slow-first-load-skeleton-dedupe',async page=>{
   await page.waitForFunction(()=>window.__reads.length===1);await tab(page,'Importes y pagos').click();await page.getByText('Cargando importes y pagos…',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Cerrar cita'}).isEnabled(),true);assert.doesNotMatch(await page.locator('[aria-busy="true"]').innerText(),/Afl\. 0/);
   const height=await page.getByRole('dialog').evaluate(node=>node.getBoundingClientRect().height);assert.ok(height>650);
   await focus(page);await tab(page,'Historial').click();await tab(page,'Resumen').click();await tab(page,'Importes y pagos').click();assert.equal(await reads(page),1);
   await page.screenshot({path:path.join(artifacts,'loading-desktop.png'),fullPage:true});await page.evaluate(()=>window.__release[0]());await loaded(page);
  },{__holdReads:true});
  await run('refresh-retains-data-error-blocks-writes-recovers',async page=>{
   await openFinance(page);await page.evaluate(()=>{window.__holdReads=true;window.__readError='Synthetic read unavailable';});await focus(page);await page.waitForFunction(()=>window.__reads.length===2);
   assert.match(await finance(page).innerText(),/CheckUp de ejemplo/);assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
   await focus(page);assert.equal(await reads(page),2);await page.evaluate(()=>window.__release[1]());await page.getByRole('alert').filter({hasText:'Synthetic read unavailable'}).waitFor();
   assert.match(await finance(page).innerText(),/última consulta/);assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
   await page.evaluate(()=>{window.__readError='';window.__holdReads=false;});await page.getByRole('button',{name:'Actualizar importes',exact:true}).click();await loaded(page);assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isEnabled(),true);
  });
  await run('draft-version-fingerprint-and-cross-tab-preservation',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Alcance de prueba');await page.getByLabel('Concilié los conceptos Field',{exact:false}).check();await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();
   await tab(page,'Resumen').click();await focus(page);await tab(page,'Importes y pagos').click();assert.equal(await reads(page),1);assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).inputValue(),'Alcance de prueba');
   await page.evaluate(()=>{window.__record.state.version=2;window.__record.candidateEvidence.fingerprint='field-v2';});await page.getByRole('button',{name:'Actualizar importes',exact:true}).click();await loaded(page);
   await page.getByRole('alert').filter({hasText:'Los importes cambiaron'}).waitFor();assert.equal(await page.getByLabel('Concilié los conceptos Field',{exact:false}).isChecked(),false);assert.equal(await page.getByRole('button',{name:'Confirmar monto final',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Revisión actualizada');await page.getByLabel('Concilié los conceptos Field',{exact:false}).check();await page.getByLabel('Revisé los trabajos realizados',{exact:false}).check();await page.getByRole('button',{name:'Confirmar monto final',exact:true}).click();await page.waitForFunction(()=>window.__writes.length===1);
   const write=await page.evaluate(()=>window.__writes[0]);assert.equal(write.data.expectedVersion,2);assert.equal(write.data.candidateFingerprint,'field-v2');
  });
  await run('payment-conflict-cannot-adopt-new-version',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Registrar pago',exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('50');await page.evaluate(()=>window.__record.state.version=2);await page.getByRole('button',{name:'Actualizar importes',exact:true}).click();await loaded(page);assert.equal(await page.getByRole('button',{name:'Guardar pago',exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Monto recibido (Afl.)',{exact:true}).inputValue(),'50');await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  });
  await run('unknown-payment-preserves-exact-retry',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Registrar pago',exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('50');await page.getByRole('button',{name:'Guardar pago',exact:true}).click();await page.getByRole('button',{name:'Reintentar la misma operación'}).waitFor();await focus(page);assert.equal(await reads(page),1);assert.equal(await page.getByRole('button',{name:'Cerrar cita'}).isDisabled(),true);await page.evaluate(()=>window.__unknown=false);await page.getByRole('button',{name:'Reintentar la misma operación'}).click();await page.waitForFunction(()=>window.__writes.length===2&&window.__reads.length===2);assert.deepEqual(await page.evaluate(()=>window.__writes[0]),await page.evaluate(()=>window.__writes[1]));
  },{__unknown:true});
  await run('appointment-session-isolation-late-response',async page=>{
   await page.waitForFunction(()=>window.__reads.length===1);await page.evaluate(()=>{window.__record.state.estimate.lines[0].label='Segunda cita de ejemplo';window.__select('APPOINTMENT-SECOND');});await page.waitForFunction(()=>window.__reads.length===2);await page.evaluate(()=>window.__release[1]());await openFinance(page);await page.evaluate(()=>window.__release[0]());assert.match(await finance(page).innerText(),/Segunda cita de ejemplo/);assert.doesNotMatch(await finance(page).innerText(),/CheckUp de ejemplo/);
   await page.evaluate(()=>{window.__record.state.estimate.lines[0].label='Nueva sesión de ejemplo';window.__session();});await page.waitForFunction(()=>window.__reads.length===3);await tab(page,'Importes y pagos').click();assert.equal(await finance(page).count(),0);await page.evaluate(()=>window.__release[2]());await loaded(page);assert.match(await finance(page).innerText(),/Nueva sesión de ejemplo/);
  },{__holdReads:true});
  for(const error of ['', 'Synthetic permission denied'])await run(error?'prefetch-denial-keeps-overview-usable':'close-during-read',async page=>{
   await page.waitForFunction(()=>window.__reads.length===1);assert.equal(await page.getByRole('button',{name:'Editar cita',exact:true}).isEnabled(),true);assert.equal(await page.getByRole('button',{name:'Cerrar cita'}).isEnabled(),true);if(error){await tab(page,'Importes y pagos').click();await page.getByRole('alert').filter({hasText:error}).waitFor();await tab(page,'Resumen').click();}await page.getByRole('button',{name:'Cerrar cita'}).click();await page.getByText('Cita cerrada').waitFor();if(!error)await page.evaluate(()=>window.__release[0]());assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__holdReads:!error,__readError:error});
  for(const viewport of [desktop,{width:1366,height:768},{width:390,height:844}])await run('premium-final-'+viewport.width,async page=>{
   await openFinance(page);const text=await finance(page).innerText();
   assert.match(text,/Importe final confirmado/);assert.doesNotMatch(text,/Trabajo completado/);assert.match(text,/2 pagos vigentes/);assert.match(text,/Anulado · Referencia duplicada de prueba/);
   for(const value of ['Afl. 260.00','Afl. 430.00','Afl. 200.00','Afl. 230.00','+ Afl. 170.00','18,000 BTU','Servicio cambiado','Concepto añadido'])assert.ok(text.includes(value),value);
   const row=page.getByRole('row').filter({hasText:'Deep cleaning'});assert.match(await row.innerText(),/235.00/);assert.doesNotMatch(await row.innerText(),/125.00/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
   await page.screenshot({path:path.join(artifacts,'premium-final-'+viewport.width+'.png'),fullPage:true});
   await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Corrección pendiente');
   await page.getByRole('button',{name:'Ver movimientos',exact:true}).click();await page.getByRole('heading',{name:'Historial de importes y pagos'}).waitFor();await tab(page,'Importes y pagos').click();assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).inputValue(),'Corrección pendiente');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium},viewport);
  await run('method-shortcuts-preserve-payment-draft',async page=>{
   await openFinance(page);
   for(const method of ['Efectivo','Transferencia','POS','SUAVE']){
    await page.getByRole('button',{name:method,exact:true}).click();assert.equal(await page.getByRole('button',{name:method,exact:true}).getAttribute('aria-pressed'),'true');await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('25');
    await page.getByRole('button',{name:'Ver movimientos',exact:true}).click();await tab(page,'Importes y pagos').click();assert.equal(await page.getByLabel('Monto recibido (Afl.)',{exact:true}).inputValue(),'25');assert.equal(await page.getByRole('button',{name:method,exact:true}).getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'Cancelar',exact:true}).click();
   }assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  });
  for(const scenario of ['read-only','blocker','hold','cancelled'])await run('premium-restriction-'+scenario,async page=>{
   await openFinance(page);if(scenario==='blocker'){assert.match(await finance(page).innerText(),/Pagos pendientes de conciliación/);assert.match(await finance(page).innerText(),/Por conciliar/);assert.doesNotMatch(await finance(page).innerText(),/0 pagos vigentes|✓ Pagado/);}assert.equal(await page.getByRole('button',{name:'Editar trabajos',exact:true}).isDisabled(),true);
   for(const name of ['Efectivo','Transferencia','POS','SUAVE','Registrar pago'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),scenario!=='cancelled','Cancelled visits retain authorized outstanding-payment behavior');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__canManage:scenario!=='read-only',__record:{...premium,blocker:scenario==='blocker'?'Synthetic legacy blocker':'',appointmentStatus:scenario==='hold'?'temporary_hold':scenario==='cancelled'?'cancelled':'confirmed'}});
  for(const scenario of ['unknown','zero','credit','empty','fractional','final-only'])await run('premium-amount-'+scenario,async page=>{
   await openFinance(page);const text=await finance(page).innerText();
   if(scenario==='final-only'){assert.match(text,/El importe final queda registrado en el historial/);assert.doesNotMatch(text,/El estimado original se conserva en el historial/);assert.doesNotMatch(text,/vs. estimado/);}
   if(scenario==='unknown'){assert.match(text,/Por confirmar/);assert.doesNotMatch(text,/✓ Pagado/);assert.match(text,/BTU pendiente/);}
   if(scenario==='zero'){assert.match(text,/Afl. 0.00/);assert.match(text,/Sin saldo pendiente/);assert.match(text,/✓ Pagado/);}
   if(scenario==='credit'){assert.match(text,/SALDO A FAVOR/);assert.match(text,/Afl. 20.00/);assert.doesNotMatch(text,/✓ Pagado/);}
   if(scenario==='empty'){assert.match(text,/Sin registrar/);assert.match(text,/todavía no tiene importes registrados/);assert.doesNotMatch(text,/✓ Pagado/);}
   if(scenario==='fractional'){const row=page.getByRole('row').filter({hasText:'Hora adicional'});assert.match(await row.innerText(),/1.5/);assert.match(await row.innerText(),/45.00/);assert.match(await row.innerText(),/67.50/);}
  },{__record:(()=>{const r=structuredClone(premium);if(scenario==='final-only')r.state.originalEstimate=null;if(scenario==='empty')r.state=null;if(scenario==='unknown'){r.state.final=null;r.state.estimate.totalCents=null;r.state.estimate.lines[0].unitCents=null;r.state.estimate.lines[0].totalCents=null;r.state.estimate.lines[0].pendingReason='BTU pendiente';}if(scenario==='zero'){r.state.final.totalCents=0;r.state.final.lines=[];r.state.receivedCents=0;r.payments=[];}if(scenario==='credit')r.state.receivedCents=45000;if(scenario==='fractional'){r.state.final.lines=[{...work('extra','Hora adicional',4500),quantityMillis:1500,totalCents:6750}];r.state.final.totalCents=6750;}return r;})()});

  await run('lease-fence-discards-stale-prefetch-and-preserves-expired-draft',async page=>{
   await page.waitForFunction(()=>window.__reads.length===1);await loaded(page);
   await page.evaluate(()=>{window.__holdReads=true;window.__leaseVersion=2;});
   await focus(page);await tab(page,'Importes y pagos').click();await page.waitForFunction(()=>window.__reads.length===2&&window.__leaseCalls?.length>0);
   assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
   await page.evaluate(()=>{window.__record.state.version=2;window.__release[1]();});
   await page.waitForFunction(()=>window.__reads.length===3);
   assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
   await page.evaluate(()=>{window.__holdReads=false;window.__release[2]();});
   await page.getByRole('button',{name:'Registrar pago',exact:true}).click();await page.getByLabel('Monto recibido (Afl.)',{exact:true}).fill('42');
   await tab(page,'Resumen').click();await page.evaluate(()=>{window.__record.state.version=3;window.__leaseVersion=3;});await tab(page,'Importes y pagos').click();
   await page.getByRole('alert').filter({hasText:'Los importes cambiaron'}).waitFor();
   assert.equal(await page.getByLabel('Monto recibido (Afl.)',{exact:true}).inputValue(),'42');
   assert.equal(await page.getByRole('button',{name:'Guardar pago',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  });
  await run('lease-other-operator-read-only-and-recovery-preserves-draft',async page=>{
   await openFinance(page);await page.getByText(/Scarlet de prueba está editando/).waitFor();
   assert.equal(await page.getByRole('button',{name:'Editar trabajos',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__leaseOther=false);await page.getByRole('button',{name:'Recuperar acceso de edición'}).click();
   await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Borrador que se conserva');
   await tab(page,'Resumen').click();await page.evaluate(()=>window.__leaseOther=true);await tab(page,'Importes y pagos').click();
   await page.getByText(/Scarlet de prueba está editando/).waitFor();assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).inputValue(),'Borrador que se conserva');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium,__leaseOther:true});
  await run('lease-unknown-acquire-retries-same-session-and-invalid-expiry-blocks',async page=>{
   await openFinance(page);await page.getByText('Synthetic lease unavailable',{exact:true}).waitFor();
   const original=await page.evaluate(()=>window.__leaseCalls.find(c=>c.action==='acquire_appointment_charge_edit').data.editSessionId);
   await page.evaluate(()=>{window.__leaseError=false;window.__badExpiry=true;});await page.getByRole('button',{name:'Recuperar acceso de edición'}).click();
   await page.getByText('El servidor no confirmó el vencimiento del acceso de edición.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Editar trabajos',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__badExpiry=false);await page.getByRole('button',{name:'Recuperar acceso de edición'}).click();await page.getByText('Edición reservada para ti en esta cita.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(id=>window.__leaseCalls.filter(c=>c.action==='acquire_appointment_charge_edit').every(c=>c.data.editSessionId===id),original),true);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium,__leaseError:true});
  await run('lease-late-acquire-after-leaving-tab-releases-its-own-session',async page=>{
   await openFinance(page);await page.waitForFunction(()=>!!window.__leaseRelease);
   await tab(page,'Resumen').click();await page.evaluate(()=>window.__leaseRelease());
   await page.waitForFunction(()=>window.__leaseCalls.some(c=>c.action==='release_appointment_charge_edit'));
   const calls=await page.evaluate(()=>window.__leaseCalls);assert.equal(calls[0].data.editSessionId,calls.at(-1).data.editSessionId);assert.equal(calls.at(-1).data.editToken,'synthetic-lease');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium,__leaseHold:true});
  await run('lease-hidden-focus-resumes-renewal-and-expiry-keeps-draft',async page=>{
   await page.clock.install();await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Conservar al vencer');
   await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__visibility||'visible'}));
   await page.evaluate(()=>window.__visibility='hidden');await page.clock.fastForward(26000);
   assert.equal(await page.evaluate(()=>window.__leaseCalls.filter(c=>c.action==='renew_appointment_charge_edit').length),0);
   await page.evaluate(()=>{window.__visibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>window.__leaseCalls.filter(c=>c.action==='renew_appointment_charge_edit').length===1);
   await page.clock.fastForward(26000);await page.waitForFunction(()=>window.__leaseCalls.filter(c=>c.action==='renew_appointment_charge_edit').length===2);
   await page.evaluate(()=>window.__visibility='hidden');await page.clock.fastForward(91000);await page.getByText(/La sesión de edición venció. Tu borrador se conserva/).waitFor();
   assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).inputValue(),'Conservar al vencer');assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium});
  for(const viewport of [desktop,{width:390,height:844}])await run('catalog-search-no-mutations-'+viewport.width,async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Deep cleaning · DEEP-DEMO',exact:true}).waitFor();await page.getByLabel('Buscar producto o servicio 1',{exact:true}).fill('desmontaje profunda');assert.equal(await page.getByRole('button',{name:'Seleccionar Deep cleaning · DEEP-DEMO',exact:true}).count(),1);
   const catalogReads=await page.evaluate(()=>window.__catalogReads);await page.getByLabel('Buscar producto o servicio 1',{exact:true}).fill('R410A aplicacion');await page.getByRole('button',{name:'Productos',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Seleccionar Refrigerante de prueba · R410A-DEMO',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Seleccionar Refrigerante de prueba · R32-DEMO',exact:true}).count(),0);
   assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Standard service');await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();assert.equal(await page.getByLabel('Precio unitario 1',{exact:true}).textContent(),'Afl. 125.00');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);assert.equal(await page.evaluate(()=>window.__catalogReads),catalogReads);
   await page.screenshot({path:path.join(artifacts,'catalog-search-'+viewport.width+'.png'),fullPage:true});await page.getByRole('button',{name:'Seleccionar Refrigerante de prueba · R410A-DEMO',exact:true}).click();assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Refrigerante de prueba');assert.equal(await page.locator('input[aria-label="Precio unitario 1"]').count(),0);
   await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 55.00'}).waitFor();await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Refrigerante de prueba · R410A-DEMO',exact:true}).click();assert.equal(await page.getByLabel('Precio unitario 1',{exact:true}).textContent(),'Afl. 55.00');

   await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByLabel('Buscar producto o servicio 1',{exact:true}).press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).evaluate(node=>node===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  },{__record:premium,__catalogItems:catalogItems},viewport);
  await run('catalog-error-retry-and-missing-saved-item',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Reintentar catálogo',exact:true}).waitFor();await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();assert.equal(await page.getByLabel('Precio unitario 1',{exact:true}).textContent(),'Afl. 125.00');await page.evaluate(()=>window.__catalogError=false);await page.getByRole('button',{name:'Reintentar catálogo',exact:true}).click();await page.getByText('El artículo guardado ya no está disponible en el catálogo activo. El concepto y su precio se conservan.').waitFor();assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Standard service');await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();assert.equal(await page.getByLabel('Precio unitario 1',{exact:true}).textContent(),'Afl. 125.00');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:(()=>{const r=structuredClone(premium);r.state.final.lines[0].serviceId='retired';return r;})(),__catalogItems:catalogItems,__catalogError:true});
  await run('catalog-old-response-empty-and-refresh-lock',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Legacy item',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Productos',exact:true}).count(),0);await page.getByLabel('Buscar producto o servicio 1',{exact:true}).fill('nothing');await page.getByText('No hay coincidencias. Prueba otro nombre o código.').waitFor();await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Afl. 125.00'}).waitFor();assert.equal(await page.getByLabel('Precio unitario 1',{exact:true}).textContent(),'Afl. 125.00');
   await page.evaluate(()=>window.__holdReads=true);await page.getByRole('button',{name:'Actualizar importes',exact:true}).click();await page.waitForFunction(()=>window.__reads.length===2);assert.equal(await page.getByLabel('Buscar producto o servicio 1',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).isDisabled(),true);await page.evaluate(()=>window.__release[1]());await loaded(page);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium,__catalogItems:[{id:'legacy',name:'Legacy item'}]});
  await run('catalog-refresh-new-product-retains-draft',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByLabel('Cantidad 1',{exact:true}).fill('2');await page.getByLabel('Motivo / detalle del alcance',{exact:false}).fill('Alcance que no debe perderse');await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Deep cleaning · DEEP-DEMO',exact:true}).waitFor();await page.evaluate(()=>window.__catalogItems.push({id:'new-product',name:'Producto recién creado',itemType:'Producto',sku:'NEW'}));await page.getByRole('button',{name:'Actualizar catálogo',exact:true}).click();await page.getByRole('button',{name:'Seleccionar Producto recién creado · NEW',exact:true}).waitFor();assert.equal(await page.getByLabel('Cantidad 1',{exact:true}).inputValue(),'2');assert.equal(await page.getByLabel('Motivo / detalle del alcance',{exact:false}).inputValue(),'Alcance que no debe perderse');assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:premium,__catalogItems:catalogItems});
  await run('catalog-failure-keeps-unpriced-without-manual-override',async page=>{
   await openFinance(page);await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();await page.getByRole('button',{name:'Reintentar catálogo',exact:true}).waitFor();await page.getByRole('button',{name:'Dejar concepto por cotizar',exact:true}).click();assert.equal(await page.getByLabel('Concepto 1',{exact:true}).textContent(),'Standard service');assert.equal(await page.locator('input[aria-label="Precio unitario 1"]').count(),0);await page.getByLabel('Precio unitario 1',{exact:true}).filter({hasText:'Por confirmar'}).waitFor();assert.equal(await page.getByLabel('Motivo del precio 1',{exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  },{__record:(()=>{const r=structuredClone(premium);r.state.final.lines[0].serviceId='retired';return r;})(),__catalogError:true});
  await run('catalog-1000-items-bounded-local-search',async page=>{
   await openFinance(page);
   const editorStart=await page.evaluate(()=>performance.now());
   await page.getByRole('button',{name:'Editar trabajos',exact:true}).click();
   await page.getByRole('button',{name:'Tarifa del catálogo 60',exact:true}).waitFor();
   await page.waitForFunction(()=>window.__catalogReads>0);
   await page.getByRole('button',{name:'Tarifa del catálogo 1',exact:true}).click();
   await page.getByText('1000 resultados · Mostrando los primeros 40; precisa la búsqueda',{exact:true}).waitFor();
   const editorReadyMs=await page.evaluate(start=>performance.now()-start,editorStart);
   const panel=page.getByRole('region',{name:'Buscar en catálogo 1',exact:true});
   assert.equal(await panel.getByRole('button',{name:/^Seleccionar /}).count(),40);
   // Wait for the existing draft quote before isolating local search traffic.
   await page.waitForFunction(()=>window.__quoteReads>0);
   const before=await page.evaluate(()=>({catalog:window.__catalogReads,charge:window.__reads.length,quote:window.__quoteReads,writes:window.__writes.length,resources:performance.getEntriesByType('resource').length}));
   await page.evaluate(()=>{window.__searchFrames=[];document.addEventListener('input',event=>{if(event.target.getAttribute('aria-label')!=='Buscar producto o servicio 1')return;const started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__searchFrames.push(performance.now()-started)));},true);});
   const input=page.getByLabel('Buscar producto o servicio 1',{exact:true});
   const queries=['sku-perf-0999','sku-perf-0000','aplicacion categoria','missing-perf-result',''];
   for(let sample=0;sample<15;sample++){
    const query=queries[sample%queries.length];await input.fill(query);
    await page.waitForFunction(count=>window.__searchFrames.length===count,sample+1);
    assert.equal(await panel.getByRole('button',{name:/^Seleccionar /}).count(),query.startsWith('sku-')?1:query.startsWith('missing')?0:40);
   }
   const after=await page.evaluate(()=>({catalog:window.__catalogReads,charge:window.__reads.length,quote:window.__quoteReads,writes:window.__writes.length,resources:performance.getEntriesByType('resource').length}));
   assert.deepEqual(after,before,'Typing must not read the authority, quote, fetch, or write');
   assert.equal(after.writes,0);
   const samples=await page.evaluate(()=>window.__searchFrames),sorted=[...samples].sort((a,b)=>a-b);
   const metrics={name:'catalog-1000-synthetic-performance',catalogItems:1000,chargeLines:60,renderedResultsLimit:40,payloadBytes:Buffer.byteLength(JSON.stringify({success:true,services:largeCatalog})),editorReadyMs,inputToTwoAnimationFramesMs:{samples:samples.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)},authorityRequestsWhileTyping:0,networkRequestsWhileTyping:0,productionWrites:0};
   results.push(metrics);console.log(JSON.stringify(metrics));
  },{__record:largeRecord,__catalogItems:largeCatalog});
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({results,externalRequests:0,productionWrites:0},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(output,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
