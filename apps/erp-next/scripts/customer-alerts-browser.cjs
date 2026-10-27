'use strict';
// Real React alert components -> HTTP transport -> production facade -> synthetic
// transactional Firestore. All fixture identities are fictional; external requests fail.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const APP=path.resolve(__dirname,'..'),ROOT=path.resolve(APP,'../..');
const tooling=process.env.BOOKING_MODAL_TEST_TOOLS,artifacts=process.env.BOOKING_MODAL_TEST_OUTPUT;
if(!tooling||!artifacts||!path.isAbsolute(tooling)||!path.isAbsolute(artifacts))throw Error('Absolute tooling and artifact directories required');
const {build}=require(path.join(tooling,'node_modules/esbuild')),{chromium}=require(path.join(tooling,'node_modules/playwright'));
const {TransactionalFirestore}=require(path.join(ROOT,'functions/test-support/transactionalFirestore'));
const {createOfficeBookingAuthorityFacade}=require(path.join(ROOT,'functions/officeBookingAuthorityFacade'));
const {createCustomerAlerts}=require(path.join(ROOT,'functions/customerAlerts'));
const out=fs.mkdtempSync(path.join(os.tmpdir(),'demac-alert-ui-'));fs.mkdirSync(artifacts,{recursive:true});
const seed=()=>({'users/operator':{active:true,role:'office',name:'Operadora Demo'},'clients/old':{name:'Cliente Ejemplo A',phone:'+2970000001'},'clients/new':{name:'Cliente Ejemplo B',phone:'+2970000002'},'properties/old-home':{clientId:'old',address:'Dirección de ejemplo 10',active:true},'properties/new-home':{clientId:'new',address:'Dirección de ejemplo 10',active:true},'appointments/existing':{status:'confirmed',customerId:'old',chargeVersion:7},'payments/existing':{amount:145},'whatsappOutboundQueue/existing':{status:'pending'}});
let db,facade,service,flags={},requests=[];
const input={id:'synthetic-alert',requestId:'create-test',customerId:'old',propertyId:'old-home',category:'debt',comment:'Comentario ficticio para probar la alerta. Verificar antes de agendar.',matchPhone:true,matchAddress:true};
const stubs={
 'auth-provider':`export function useAuth(){return {principal:{userId:'operator',active:true,capabilities:new Set(['scheduling.manage'])}};}`,
 'office-booking-authority':`export function createOfficeLifecycleRequestId(){return crypto.randomUUID();}export async function callOfficeBookingAuthority(action,data){const r=await fetch('/authority',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({action,data})});const v=await r.json();if(!r.ok)throw Error(v.error?.message||'Request failed');return v;}`,
 'property-locations':`export async function loadPropertyLocations(){throw Error('Unexpected dwelling lookup for synthetic single-unit property');}`,
};
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CustomerAlertManager} from './components/crm/customer-alert-manager';import {useCustomerBookingAlerts} from './components/crm/use-customer-booking-alerts';import './app/globals.css';
function Booking(){const [customer,setCustomer]=useState(new URLSearchParams(location.search).get('customer')||'new');const [saved,setSaved]=useState(0);const alerts=useCustomerBookingAlerts({customerId:customer,propertyId:customer+'-home'},'operator',()=>{window.__declined=true;});return <main style={{maxWidth:1000,margin:'30px auto',padding:20}}><h1>Scheduling & Dispatch</h1><label>Cliente de prueba<select aria-label="Cliente de prueba" value={customer} onChange={e=>setCustomer(e.target.value)}><option value="old">Cliente Ejemplo A</option><option value="new">Cliente Ejemplo B</option></select></label>{alerts.notice}<button className="btn primary" onClick={async()=>{if(await alerts.checkBeforeBooking()){window.__confirmed++;setSaved(v=>v+1);}}}>Confirmar cita de prueba</button><p>Citas confirmadas: {saved}</p></main>}
function App(){return new URLSearchParams(location.search).get('mode')==='manager'?<main style={{maxWidth:1000,margin:'30px auto',padding:20}}><h1>CRM · Customer 360</h1><CustomerAlertManager customerId="old" propertyId="old-home" expanded/></main>:<Booking/>}window.__confirmed=0;window.__declined=false;createRoot(document.getElementById('root')).render(<App/>);`;
async function main(){
 await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(out,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-transport',setup(b){b.onResolve({filter:/.*/},a=>stubs[path.basename(a.path)]?{path:path.basename(a.path),namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:APP}));}}]});
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/authority'){
   let body='';for await(const chunk of req)body+=chunk;
   const request=JSON.parse(body);requests.push(request);
   if(flags.lookupError&&request.action==='match_customer_alerts'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Consulta de prueba no disponible'}}));return;}
   const result=await facade.handle({method:'POST',headers:req.headers,body:request});
   if(flags.delayOld&&request.action==='match_customer_alerts'&&request.data.customerId==='old')await new Promise(resolve=>{flags.releaseOld=resolve;});
   if(flags.loseCreate&&request.action==='create_customer_alert'){flags.loseCreate=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Respuesta perdida de prueba'}}));return;}
   res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));return;
  }
  if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(out,req.url.slice(1))));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true}),results=[];
 async function run(name,options,fn){
  db=new TransactionalFirestore(seed());facade=createOfficeBookingAuthorityFacade({db,verifyIdToken:async()=>({uid:'operator'})});service=createCustomerAlerts({db});flags={};requests=[];
  if(options.alert)await service.execute({action:'create_customer_alert',data:input,uid:'operator'});
  const before=new Map([...db.store].filter(([key])=>!key.startsWith('customerAlerts/')));
  const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1440,height:1050}});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await fn(page,origin);
  assert.deepEqual(errors,[],name);for(const [key,value] of before)assert.deepEqual(db.read(key),value,key);
  results.push({name,result:'PASS'});console.log('PASS',name);await context.close();
 }
 try{
  await run('create-from-profile-and-resolve',{ },async(page,url)=>{
   await page.goto(url+'/?mode=manager');await page.getByRole('button',{name:'+ Registrar alerta',exact:true}).click();await page.getByLabel('Comentario *',{exact:true}).fill(input.comment);await page.screenshot({path:path.join(artifacts,'register-alert.png'),fullPage:true});await page.getByRole('button',{name:'Guardar alerta',exact:true}).click();await page.getByText(input.comment,{exact:true}).waitFor();
   const saved=[...db.store].filter(([p])=>/^customerAlerts\/[^/]+$/.test(p));assert.equal(saved.length,1);assert.equal(saved[0][1].customerId,'old');
   await page.getByRole('button',{name:'Resolver',exact:true}).click();await page.getByLabel('Motivo del cambio *',{exact:true}).fill('Prueba de resolución con motivo.');await page.getByRole('button',{name:'Guardar cambio',exact:true}).click();await page.getByText('Resuelta',{exact:true}).waitFor();
   assert.equal((await service.execute({action:'match_customer_alerts',data:{customerId:'old'},uid:'operator'})).matches.length,0);
  });
  await run('new-occupant-keeps-old-customer-alert',{alert:true},async(page,url)=>{
   await page.goto(url);await page.getByRole('dialog',{name:'Alerta al agendar',exact:true}).waitFor();await page.screenshot({path:path.join(artifacts,'booking-alert.png'),fullPage:true});assert.equal(await page.evaluate(()=>window.__confirmed),0);
   await page.getByRole('button',{name:'Es otro cliente / nuevo ocupante',exact:true}).click();await page.getByLabel('Cómo verificaste que es otra persona *',{exact:true}).fill('Verificada la nueva identidad del ocupante.');await page.getByRole('button',{name:'Confirmar otro cliente',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Confirmar cita de prueba',exact:true}).click();await page.getByText('Citas confirmadas: 1',{exact:true}).waitFor();assert.equal(db.read('customerAlerts/synthetic-alert').status,'active');
   await page.reload();await page.getByText('Sin alertas coincidentes',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  });
  await run('direct-owner-warning-and-explicit-continue',{alert:true},async(page,url)=>{
   await page.goto(url+'/?customer=old');await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Es otro cliente / nuevo ocupante',exact:true}).count(),0);await page.getByRole('button',{name:'Revisar y continuar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Confirmar cita de prueba',exact:true}).click();await page.getByText('Citas confirmadas: 1',{exact:true}).waitFor();
  });
  await run('decline-does-not-create-booking',{alert:true},async(page,url)=>{await page.goto(url);await page.getByRole('button',{name:'No agendar',exact:true}).click();await page.waitForFunction(()=>window.__declined);assert.equal(await page.evaluate(()=>window.__confirmed),0);});
  await run('lost-response-retry-does-not-duplicate',{ },async(page,url)=>{
   flags.loseCreate=true;await page.goto(url+'/?mode=manager');await page.getByRole('button',{name:'+ Registrar alerta',exact:true}).click();await page.getByLabel('Comentario *',{exact:true}).fill(input.comment);await page.getByRole('button',{name:'Guardar alerta',exact:true}).click();await page.getByText('Respuesta perdida de prueba',{exact:false}).waitFor();await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();await page.getByText(input.comment,{exact:true}).waitFor();const writes=requests.filter(r=>r.action==='create_customer_alert');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal([...db.store.keys()].filter(p=>/^customerAlerts\/[^/]+$/.test(p)).length,1);
  });
  await run('failed-lookup-visible-and-no-confirmation',{ },async(page,url)=>{flags.lookupError=true;await page.goto(url);await page.getByText('Consulta de prueba no disponible',{exact:false}).waitFor();await page.getByRole('button',{name:'Confirmar cita de prueba',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__confirmed),0);flags.lookupError=false;await page.getByRole('button',{name:'Reintentar consulta',exact:true}).click();await page.getByText('Sin alertas coincidentes',{exact:true}).waitFor();});
  await run('stale-client-response-is-discarded',{alert:true},async(page,url)=>{
   flags.delayOld=true;await page.goto(url+'/?customer=old');await page.waitForTimeout(500);await page.getByLabel('Cliente de prueba',{exact:true}).selectOption('new');await page.getByText('Coincidencia por dirección',{exact:true}).waitFor();assert.ok(flags.releaseOld);flags.releaseOld();await page.waitForTimeout(150);assert.equal(await page.getByText('Coincidencia por cliente',{exact:true}).count(),0);
  });
  await run('mobile-dialog-actions-and-layout',{alert:true,mobile:true},async(page,url)=>{await page.goto(url);await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Revisar y continuar',exact:true}).scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(artifacts,'booking-alert-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Revisar y continuar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});});
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({boundary:'Real UI and facade; synthetic transactional database; no production access',results},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(out,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
