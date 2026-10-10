// Real booking, property, contact, reference and support components with synthetic
// authority adapters. Tests presentation/state/command parity, not production APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.BOOKING_MODAL_TEST_TOOLS;
const artifacts = process.env.BOOKING_MODAL_TEST_OUTPUT;
if (![tooling, artifacts].every(value => value && path.isAbsolute(value))) throw Error('Absolute isolated tooling and evidence directories are required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-booking-modal-'));
fs.mkdirSync(artifacts, { recursive: true });
const customer = { id: 'CUSTOMER-TEST', name: 'Synthetic customer', phone: '+2970000000', active: true };
const property = { id: 'PROPERTY-TEST', clientId: customer.id, name: 'Synthetic site', address: 'Synthetic site 1', zone: 'Noord', active: true, hasIndependentDwellings: false, locationVersion: 0 };
const contact = { id: 'CONTACT-TEST', clientId: customer.id, name: 'Synthetic access contact', phone: '+2970000001', active: true };
const project = {
  id: 'PROJECT-TEST', projectNumber: 'PRJ-TEST', name: 'Synthetic project', customerId: customer.id, customerName: customer.name, siteId: property.id,
  location: property.address, type: 'VRF Project', status: 'Planned', serverVersion: 1,
  technicianInstructions: 'Keep synthetic access instructions', estimatedSlots: 6, slotsPerWorkDay: 6, slotDurationMinutes: 60,
  estimatedLaborHours: 6, scheduledFutureHours: 5, actualLaborHours: 0, phases: [], assignments: [],
};
const stubs = {
  'auth-provider': `const principal={userId:'ACTOR-TEST',active:true,capabilities:new Set(['scheduling.manage','projects.schedule'])};export function useAuth(){return {principal};}`,
  'live-scheduling-booking-data': `
    export async function loadBookingMasterReferenceData(){return {clients:[${JSON.stringify(customer)}],properties:[${JSON.stringify(property)}]};}
    export async function loadBookingContactReferenceData(){return {contacts:[${JSON.stringify(contact)}],contactAssignments:[]};}
    export async function createBookingCustomerWithProperty(input){window.__masterWrites.push(input);throw Error('Unexpected customer write');}
    export async function createBookingProperty(...input){window.__masterWrites.push(input);throw Error('Unexpected property write');}`,
  'live-scheduling-fast': `export function primeLiveSchedulingReferenceCache(){};`,
  'live-operational-capacity': `export async function loadLiveOperationalCapacityState(){return {};}export function liveVanCrew(){return {label:'Synthetic crew'};}`,
  'shared-projects': `export const PROJECTS_CHANGED_EVENT='synthetic-projects-changed';
    export async function loadSchedulingProjects(){return [${JSON.stringify(project)}];}
    export async function loadSharedProjects(){throw Error('Scheduling-only actor must not read full planning');}
    export async function commitSharedProjects(){throw Error('Scheduling-only actor must not write planning');}`,
  'office-booking-authority': `
    export class OfficeBookingRequestError extends Error {}
    export function createOfficeLifecycleRequestId(prefix='request'){return prefix+'-'+(++window.__requests);}
    export function officeBookingOutcomeUnknown(error){return error.message==='Synthetic response lost';}
    export async function callOfficeBookingAuthority(action,input){
      if(action!=='list_property_locations')throw Error('Unexpected authority operation '+action);
      window.__locationReads.push(input);
      return {success:true,property:${JSON.stringify(property)},dwellings:[],areas:[],assignments:[]};
    }
    export async function updateOfficeProperty(input){window.__masterWrites.push(input);throw Error('Unexpected property edit');}
    export async function saveOfficeContactAssignment(input){window.__masterWrites.push(input);throw Error('Unexpected contact save');}
    export async function deactivateOfficeContactAssignment(input){window.__masterWrites.push(input);throw Error('Unexpected contact remove');}
    export async function listOfficeBookingPresets(){return {presets:[
      {id:'standard',label:'Standard service',active:true,serviceId:'SERVICE-STANDARD',durationMinutesPerUnit:60},
      {id:'deep',label:'Deep cleaning',active:true,serviceId:'SERVICE-DEEP',durationMinutesPerUnit:120},
      {id:'other',label:'Other',active:true,serviceId:'SERVICE-OTHER',durationMode:'manual',durationMinutesPerUnit:60}]};}
    export async function checkOfficeCreateAvailability(input){
      window.__checks.push(input);await new Promise(resolve=>setTimeout(resolve,30));
      const minutes=input.workLines.reduce((sum,line)=>sum+(line.manualDurationMinutes||line.quantity*(line.presetId==='deep'?120:60)),0);
      return {available:true,offer:{id:'OFFER-TEST',version:window.__checks.length},options:[{id:'OPTION-TEST',date:input.requestedDate,time:input.requestedTime,endTime:'12:30',assignments:[
        {role:'primary',vanId:input.requiredVanId,vanName:'Test Van',time:input.requestedTime,endTime:'12:30',capacityEndTime:'12:30',durationMinutes:minutes,slots:minutes/60,quantity:input.workLines.reduce((sum,line)=>sum+line.quantity,0)}]}]};
    }
    async function commit(input,hold){
      const calls=hold?window.__holds:window.__commits;calls.push(input);
      if(window.__pendingCommit)await new Promise(resolve=>{window.__finishCommit=resolve;});
      window.__records[input.requestId]||={appointmentId:hold?'HOLD-TEST':'APPOINTMENT-TEST',workOrderIds:['WO-TEST']};
      if(window.__loseResponse&&calls.length===1)throw Error('Synthetic response lost');
      return window.__records[input.requestId];
    }
    export async function confirmOfficeAppointment(input){return commit(input,false);}
    export async function createOfficeTemporaryHold(input){return commit(input,true);}
    export async function addOfficeAdhocSupport(input){window.__supportWrites.push(input);return {supportWorkOrderId:'SUPPORT-WO-TEST',supportWorkOrder:{}};}`,
  'after-hours-booking': `export class SpecialBookingError extends Error {} export async function prepareCapacityOvertime(){throw Error('Unexpected capacity overtime');} export async function createCapacityOvertime(){throw Error('Unexpected capacity overtime write');} export async function prepareRestDayOvertime(){throw Error('Unexpected rest overtime');} export async function createRestDayOvertime(){throw Error('Unexpected rest overtime write');} export async function createAfterHoursEmergency(){throw Error('Unexpected emergency write');}`,
  'booking-reference-data': `
    export const emptyVisitReferences=()=>({notes:'',location:null,files:[],version:0});
    export const hasVisitReferences=value=>Boolean(value.notes.trim()||value.location?.url||value.files.length);
    export const visitReferenceRequestId=()=> 'REFERENCE-'+(++window.__requests);
    export async function uploadVisitReference(file,id){window.__uploads.push({name:file.name,id});if(window.__pendingUpload)await new Promise(resolve=>{window.__finishUpload=resolve;});return {id,fileName:file.name,kind:'image',mimeType:file.type,size:file.size,description:''};}
    export async function readVisitReference(file,context){window.__referenceReads.push({file,context});return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});}
    export async function loadVisitReferences(){throw Error('Unexpected saved-reference read');}
    export async function saveVisitReferences(){throw Error('Unexpected saved-reference mutation');}`,
};
const entry = `
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {LiveAppointmentCreateDrawer} from './components/scheduling/live-appointment-create-drawer';
import {AdhocSupportDrawer} from './components/scheduling/adhoc-support-drawer';
import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';
function Harness(){
 const [open,setOpen]=useState(true),[support,setSupport]=useState(false),[created,setCreated]=useState(null);
 // Mirrors the agenda listener's modal guard (also checked against owning source below).
 useEffect(()=>{const listener=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[data-booking-modal]')){window.__agendaEscapes++;setOpen(false);setSupport(false);}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
 const target={dateKey:window.__backdate?'2020-09-18':'2099-09-18',vanId:'VAN-TEST',vanName:'Test Van',start:'08:30',end:'12:30'};
 return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><button onClick={()=>setOpen(true)}>Synthetic agenda slot</button>{created?<h1>Synthetic booking result</h1>:open?<LiveAppointmentCreateDrawer target={target} onClose={()=>{window.__closes++;setOpen(false);}} onCreated={value=>{window.__created=value;setCreated(value);setOpen(false);}} onSendSupport={()=>{setOpen(false);setSupport(true);}}/>:null}
 {support?<AdhocSupportDrawer target={{...target,durationOptions:[{slots:1,end:'09:30'},{slots:2,end:'10:30'},{slots:3,end:'11:30'}]}} appointments={[{id:'EXISTING-TEST',dateKey:target.dateKey,status:'confirmed',customer:'Synthetic receiving customer',site:'Synthetic site',workLabel:'Existing service',assignments:[{isPrimaryAssignment:true,vanId:'VAN-OTHER',start:'08:30',end:'11:30'}]}]} onClose={()=>{window.__closes++;setSupport(false);}} onCreated={()=>{setCreated({support:true});}}/>:null}</div>;
}createRoot(document.getElementById('app')).render(<Harness/>);`;

async function ready(page){await page.locator('[data-booking-modal]').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-booking-modal] button[aria-label="Close"]')?.disabled);}
async function toggleDisclosure(page,name,open){const el=page.locator('[data-booking-disclosure="'+name+'"]');if(await el.evaluate(node=>node.open)!==open)await el.locator(':scope > summary').click();}
async function setupRegular(page){
 await ready(page);
 await page.getByLabel('Search customer').fill('Synthetic');
 await page.getByRole('button',{name:/Synthetic customer.*SELECT/i}).click();
 await page.getByRole('button',{name:/^Standard service/}).click();
 await page.getByRole('button',{name:/^Standard service/}).click();
 await page.getByRole('button',{name:/^Deep cleaning/}).click();
 await page.getByLabel('Customer-facing work description').fill('Synthetic mixed work');
 await page.getByLabel('Technician instructions').fill('Synthetic retained technician instructions');
 await toggleDisclosure(page,'contacts',true);
 await page.getByLabel('Requested by · this visit').selectOption('client:CUSTOMER-TEST');
 await page.getByLabel('Access contact · this visit').selectOption('contact:CONTACT-TEST');
 await page.getByLabel('Confirmation').first().uncheck();
 await page.getByLabel('Reminder').first().uncheck();
 await toggleDisclosure(page,'references',true);
 await page.getByLabel('Indicaciones para el técnico y ayudante').fill('Synthetic retained visit note');
 await page.getByLabel('Ubicación GPS del trabajo').fill('12.5, -70.0');
 await page.getByLabel('Referencia de acceso').fill('Synthetic gate');
 await page.getByRole('button',{name:'Confirm appointment',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Confirm appointment'&&!button.disabled));
}
async function geometry(page,width,label){
 await page.locator('[data-booking-column="identity"]').evaluate(node=>node.parentElement.parentElement.scrollTo(0,0));
 assert.match(await page.locator('[data-booking-modal] > footer').innerText(),/Test Van · 8:30 AM · 4 hours/,'Footer retains visible computed workload');
 const layout=await page.evaluate(()=>{
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const modal=document.querySelector('[data-booking-modal]');
  return {viewport:{width:innerWidth,height:innerHeight},modal:rect(modal),footer:rect(modal.querySelector('footer:last-child')),
   columns:['identity','work','capacity'].map(name=>rect(modal.querySelector('[data-booking-column="'+name+'"]'))),
   pageOverflow:document.documentElement.scrollWidth-innerWidth,modalOverflow:modal.scrollWidth-modal.clientWidth};
 });
 assert.ok(layout.pageOverflow<=2,`${label}: page horizontal overflow ${JSON.stringify(layout)}`);
 assert.ok(layout.modalOverflow<=2,`${label}: modal horizontal overflow ${JSON.stringify(layout)}`);
 assert.ok(layout.modal.x>=-1&&layout.modal.right<=width+1,`${label}: modal fits viewport`);
 assert.ok(layout.footer.y>=0&&layout.footer.bottom<=layout.viewport.height+1,`${label}: footer remains visible`);
 if(width>=1120){
  assert.ok(layout.modal.width>=width*0.85,`${label}: wide centered modal`);
  assert.ok(Math.abs(layout.modal.x-(width-layout.modal.right))<=3,`${label}: horizontally centered`);
  assert.ok(layout.columns[0].x<layout.columns[1].x&&layout.columns[1].x<layout.columns[2].x,`${label}: three ordered columns`);
  assert.ok(Math.max(...layout.columns.map(r=>r.y))-Math.min(...layout.columns.map(r=>r.y))<=3,`${label}: aligned columns`);
 }else{
  assert.ok(layout.columns[0].y<layout.columns[1].y&&layout.columns[1].y<layout.columns[2].y,`${label}: stacked columns`);
 }
 await page.screenshot({path:path.join(artifacts,label+'.png'),fullPage:true});return layout;
}
async function assertNoWrites(page){assert.deepEqual(await page.evaluate(()=>({commits:window.__commits,holds:window.__holds,master:window.__masterWrites,uploads:window.__uploads,support:window.__supportWrites})),{commits:[],holds:[],master:[],uploads:[],support:[]});}

async function main(){
 assert.match(fs.readFileSync(path.join(APP,'components/scheduling/live-scheduling-overview.tsx'),'utf8'),/if \(document\.querySelector\('\[data-booking-modal\]'\)\) return;/,'Agenda must defer Escape to booking modal and its nested dialogs');
 await build({absWorkingDir:APP,stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-demac-booking-modal',NEXT_PUBLIC_PROJECTS_REGISTRY_ENABLED:'false'})},plugins:[{name:'synthetic-booking-boundary',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const key=path.basename(args.path);if(key==='booking-visit-references'&&args.path.includes('/lib/'))return {path:'booking-reference-data',namespace:'fixture'};if(stubs[key])return {path:key,namespace:'fixture'};});
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js',resolveDir:APP}));
 }}]});
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;if(name==='/app.js'||name==='/app.css'){res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,name.slice(1))));}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.BOOKING_MODAL_CHROMIUM?{executablePath:process.env.BOOKING_MODAL_CHROMIUM}:{})}).catch(async error=>{await new Promise(resolve=>server.close(resolve));throw error;});
 const results=[];
 async function run(name,viewport,test,flags={}){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),errors=[],unexpected=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();unexpected.push(route.request().url());return route.abort();});
  await context.addInitScript(flags=>{Object.assign(window,{__checks:[],__commits:[],__holds:[],__masterWrites:[],__uploads:[],__supportWrites:[],__referenceReads:[],__locationReads:[],__records:{},__requests:0,__closes:0,__agendaEscapes:0,...flags});},flags);
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try{await page.goto(origin);await test(page);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(error){await page.screenshot({path:path.join(artifacts,name+'-failure.png'),fullPage:true});console.error(JSON.stringify({name,errors,unexpected,text:(await page.locator('body').innerText()).slice(0,7500)},null,2));throw error;}
  finally{await context.close();}
 }
 try{
  for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:390,height:844}])await run('layout-'+viewport.width,viewport,async page=>{await setupRegular(page);await toggleDisclosure(page,'contacts',false);await toggleDisclosure(page,'references',false);await geometry(page,viewport.width,'layout-'+viewport.width);await assertNoWrites(page);});
  await run('keyboard-focus-stays-in-modal',{width:1366,height:768},async page=>{
   await setupRegular(page);await toggleDisclosure(page,'references',false);await toggleDisclosure(page,'contacts',false);
   await page.getByRole('button',{name:'Confirm appointment',exact:true}).focus();await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close','Tab from final action wraps to first modal control');
   await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent.trim()),'Confirm appointment','Reverse Tab wraps to final modal action');
   await page.getByRole('button',{name:/Create customer/}).click();const editor=page.getByRole('dialog',{name:'Crear propiedad'});await editor.waitFor();
   await editor.getByRole('button',{name:'Cerrar editor de propiedad'}).focus();await page.keyboard.press('Shift+Tab');
   assert.equal(await editor.evaluate(node=>node.contains(document.activeElement)),true,'Nested editor owns its focus trap');
   await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});assert.match(await page.evaluate(()=>document.activeElement?.textContent||''),/Create customer/,'Nested cancel restores initiating control');await assertNoWrites(page);
  });
  await run('disclosure-state-and-nested-editors',{width:1440,height:1000},async page=>{
   await setupRegular(page);
   await page.evaluate(()=>{window.__referenceNode=document.querySelector('[aria-label="Información para la visita"]');window.__contactNode=document.querySelector('[data-booking-disclosure="contacts"] input');});
   await toggleDisclosure(page,'references',false);await toggleDisclosure(page,'contacts',false);
   assert.equal(await page.evaluate(()=>window.__referenceNode.isConnected&&window.__contactNode.isConnected),true,'Disclosures must keep stateful editors mounted');
   await toggleDisclosure(page,'references',true);await toggleDisclosure(page,'contacts',true);
   assert.equal(await page.getByLabel('Indicaciones para el técnico y ayudante').inputValue(),'Synthetic retained visit note');
   assert.equal(await page.getByLabel('Ubicación GPS del trabajo').inputValue(),'12.5, -70.0');
   assert.equal(await page.getByLabel('Access contact · this visit').inputValue(),'contact:CONTACT-TEST');
   assert.equal(await page.getByLabel('Confirmation').first().isChecked(),false);
   for(const opener of [/Create customer/,/Add property/,/Editar propiedad/]){
    await page.getByRole('button',{name:opener}).click();
    const editor=page.getByRole('dialog',{name:/^(Crear|Editar) propiedad$/});await editor.waitFor();
    await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-booking-modal]').count(),1,'Nested Escape preserves parent');
    assert.equal(await page.getByLabel('Technician instructions').inputValue(),'Synthetic retained technician instructions');
   }
   await assertNoWrites(page);
  });
  for(const scenario of ['confirm','hold','confirm-recovery','hold-recovery'])await run(scenario,{width:1440,height:1000},async page=>{
   await setupRegular(page);await toggleDisclosure(page,'references',false);await toggleDisclosure(page,'references',true);await toggleDisclosure(page,'contacts',false);await toggleDisclosure(page,'contacts',true);
   const checks=await page.evaluate(()=>window.__checks);const latest=checks.at(-1);
   assert.equal(latest.customerId,'CUSTOMER-TEST');assert.equal(latest.propertyId,'PROPERTY-TEST');assert.equal(latest.requesterId,'client:CUSTOMER-TEST');assert.equal(latest.accessContactId,'contact:CONTACT-TEST');
   assert.deepEqual(latest.workLines.map(line=>({presetId:line.presetId,quantity:line.quantity})),[{presetId:'standard',quantity:2},{presetId:'deep',quantity:1}]);
   assert.equal(latest.customerFacingDescription,'Synthetic mixed work');assert.equal(latest.technicianInstructions,'Synthetic retained technician instructions');
   assert.deepEqual(latest.recipientSelections,[{recipientType:'client',sourceId:'CUSTOMER-TEST',sendConfirmation:false,sendReminder:false}]);
   const hold=scenario.startsWith('hold');await page.getByRole('button',{name:hold?'Temporary hold':'Confirm appointment',exact:true}).click();
   if(scenario.endsWith('recovery')){
    await page.getByRole('button',{name:'Recuperar reserva original'}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-booking-modal]').count(),1,'Uncertain booking cannot be abandoned by Escape');
    assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Recuperar reserva original'}).click();
   }
   await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   const result=await page.evaluate(()=>({commits:window.__commits,holds:window.__holds,records:window.__records,created:window.__created,master:window.__masterWrites}));
   const calls=hold?result.holds:result.commits;assert.equal(calls.length,scenario.endsWith('recovery')?2:1);assert.equal((hold?result.commits:result.holds).length,0);assert.equal(Object.keys(result.records).length,1);if(calls.length===2)assert.deepEqual(calls[0],calls[1],'Retry preserves exact original command');
   assert.deepEqual(calls[0].visitReferences,{notes:'Synthetic retained visit note',location:{url:'12.5, -70.0',label:'Synthetic gate'},files:[],version:0});assert.equal(calls[0].offerId,'OFFER-TEST');assert.equal(calls[0].optionId,'OPTION-TEST');assert.equal(result.created.status,hold?'temporary_hold':'confirmed');assert.deepEqual(result.master,[]);
  },{__loseResponse:scenario.endsWith('recovery')});
  await run('upload-protects-close',{width:1366,height:768},async page=>{
   await setupRegular(page);await page.getByLabel('Añadir fotos').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])});
   await page.getByText(/Subiendo archivos/).waitFor();await page.keyboard.press('Escape');
   assert.equal(await page.locator('[data-booking-modal]').count(),1,'Escape cannot discard active upload');
   assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Confirm appointment',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__finishUpload());await page.getByLabel('Explicación de esta foto').waitFor();await page.getByLabel('Explicación de esta foto').fill('Synthetic equipment detail');
   await toggleDisclosure(page,'references',false);await toggleDisclosure(page,'references',true);
   assert.equal(await page.getByLabel('Explicación de esta foto').inputValue(),'Synthetic equipment detail');
   assert.equal(await page.evaluate(()=>window.__uploads.length),1);assert.equal(await page.evaluate(()=>window.__commits.length+window.__holds.length),0);
  },{__pendingUpload:true});
  await run('project-budget-nested-escape',{width:1440,height:1000},async page=>{
   await ready(page);await page.getByRole('button',{name:/^Project Find a Project/i}).click();await page.getByRole('button',{name:/PRJ-TEST.*Synthetic project/}).click();await page.getByLabel(/Planned Project slots/).fill('2');
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Confirm appointment'&&!button.disabled));await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();
   const decision=page.getByRole('dialog',{name:'La reserva supera el presupuesto estimado'});await decision.waitFor();await page.keyboard.press('Escape');await decision.waitFor({state:'hidden'});
   assert.equal(await page.locator('[data-booking-modal]').count(),1,'Budget Escape preserves booking');assert.equal(await page.getByLabel(/Planned Project slots/).inputValue(),'2');await assertNoWrites(page);
  });
  await run('support-preserves-existing-flow',{width:1366,height:768},async page=>{
   await ready(page);await page.getByRole('button',{name:/Send van support/}).click();const dialog=page.getByRole('dialog',{name:'Send van support'});await dialog.waitFor();await page.getByLabel('Support duration').selectOption('3');await page.getByRole('button',{name:/Synthetic receiving customer/}).click();await page.getByLabel('Reason').selectOption('Other');await page.getByLabel('Describe support *').fill('Synthetic support note');
   assert.equal(await page.evaluate(()=>window.__supportWrites.length),0);await page.getByRole('button',{name:'Send support',exact:true}).click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();const writes=await page.evaluate(()=>window.__supportWrites);assert.equal(writes.length,1);assert.equal(writes[0].requestedSlots,3);assert.equal(writes[0].appointmentId,'EXISTING-TEST');assert.equal(writes[0].reason,'Synthetic support note');
  });
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({boundary:'Real React components; synthetic backend commands; no production requests.',results},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(output,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
