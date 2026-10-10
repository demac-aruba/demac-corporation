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
 if(action==='quote_appointment_charges')return {success:true,quote:{...window.__record.state.estimate,quoteToken:'synthetic-quote'}};
 if(action==='list_charge_services')return {success:true,services:[]};
 window.__writes.push({action,data:structuredClone(data)});
 if(window.__unknown)throw Object.assign(Error('Synthetic unknown outcome'),{unknown:true});
 if(data.expectedVersion!==window.__record.state.version)throw Error('Synthetic version conflict');
 window.__record.state.version++;return {success:true,state:window.__record.state};
}`;
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LiveAppointmentDetailsDrawer} from './components/scheduling/live-appointment-details-drawer';import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';
function Harness(){const [open,setOpen]=useState(true),[id,setId]=useState('APPOINTMENT-TEST'),[session,setSession]=useState(1);window.__select=setId;window.__session=()=>setSession(n=>n+1);return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}>{open?<LiveAppointmentDetailsDrawer key={session} appointment={{...${JSON.stringify(appointment)},id}} canManage onClose={()=>setOpen(false)} onChanged={()=>{}}/>:<p>Cita cerrada</p>}</div>}createRoot(document.getElementById('app')).render(<React.StrictMode><Harness/></React.StrictMode>);`;
const quote={lines:[{id:'line-1',label:'CheckUp de ejemplo',quantityMillis:1000,unitCents:15000,totalCents:15000,baseUnitCents:15000,pendingReason:'',manualPrice:false}],totalCents:15000,knownTotalCents:15000,currency:'AWG',capturedAt:'2026-10-10T12:00:00Z',quoteToken:'synthetic-quote'};
const record={success:true,state:{schemaVersion:1,version:1,originalEstimate:quote,estimate:quote,final:null,receivedCents:0,paymentCount:0},history:[],payments:[],blocker:'',appointmentStatus:'confirmed',candidateEvidence:{fingerprint:'field-v1',records:[{id:'field',revisionNumber:1,lines:[{description:'Revisión de ejemplo',quantity:1,lineTotal:150}],blockers:[]}]}};
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
 async function run(name,test,flags={},viewport=desktop){const context=await browser.newContext({viewport,serviceWorkers:'block'}),errors=[],external=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});await context.addInitScript(({record,flags})=>{Object.assign(window,{__sequence:0,__referenceReads:[],__referenceWrites:[],__commReads:[],__commWrites:[],__lifecycle:[],__uploads:[],__mediaReads:[],__record:record,__reads:[],__writes:[],__release:[],__delay:0,__offset:0,...flags});const now=Date.now;Date.now=()=>now()+window.__offset;},{record,flags});const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));try{await page.goto(origin);await test(page);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){await page.screenshot({path:path.join(artifacts,name+'-failure.png'),fullPage:true});console.error({name,errors,text:(await page.locator('body').innerText()).slice(0,5000)});throw error;}finally{await context.close();}}
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
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({results,externalRequests:0,productionWrites:0},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(output,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
