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
  'auth-provider': `const principal={userId:'ACTOR-TEST',active:true,capabilities:new Set(window.__noProjectAccess?['scheduling.manage']:['scheduling.manage','projects.schedule'])};export function useAuth(){return {principal};}`,
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
      if(window.__pauseCheck)await new Promise(resolve=>{window.__finishCheck=resolve;});
      if(window.__conflict)return {available:false,options:[],reason:'required-primary-target-unavailable'};
      const minutes=input.workLines.reduce((sum,line)=>sum+(line.manualDurationMinutes||line.quantity*(line.presetId==='deep'?120:60)),0);
      if(window.__overtime)return {available:false,options:[],reason:'ordinary-capacity-exceeded'};
      if(window.__supportChoices){
        const candidates=[{id:'SUPPORT-A',vanId:'VAN-A',vanName:'Support Van A',time:'08:30',endTime:'09:30',slots:1,durationMinutes:60},{id:'SUPPORT-B',vanId:'VAN-B',vanName:'Support Van B',time:'09:30',endTime:'10:30',slots:1,durationMinutes:60}];
        const ids=input.supportSlotSelections.length?input.supportSlotSelections:['SUPPORT-A'];
        return {available:true,offer:{id:'OFFER-TEST',version:window.__checks.length},metadata:{supportSlotCandidates:candidates,supportMinSlots:1,supportMaxSlots:2,defaultSupportSlotIds:['SUPPORT-A'],selectedSupportSlotIds:ids},options:[{id:'OPTION-'+ids.join('-'),date:input.requestedDate,time:input.requestedTime,endTime:'12:30',assignments:[
          {role:'primary',vanId:input.requiredVanId,vanName:'Test Van',time:input.requestedTime,endTime:'12:30',capacityEndTime:'12:30',durationMinutes:minutes,slots:minutes/60,quantity:3-ids.length},
          ...candidates.filter(candidate=>ids.includes(candidate.id)).map(candidate=>({...candidate,role:'support',quantity:1}))]}]};
      }
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
    export async function addOfficeAdhocSupport(input){
      window.__supportWrites.push(input);
      if(window.__pendingSupport)await new Promise(resolve=>{window.__finishSupport=resolve;});
      window.__supportRecords[input.requestId]||={supportWorkOrderId:'SUPPORT-WO-TEST',supportWorkOrder:{}};
      if(window.__loseSupportResponse&&window.__supportWrites.length===1)throw Error('Synthetic response lost');
      return window.__supportRecords[input.requestId];
    }`,
  'after-hours-booking': `export class SpecialBookingError extends Error {}
    async function prepare(input,kind){if(!window.__overtime&&kind==='capacity')throw Error('Unexpected capacity overtime');window.__specialPrepares.push({kind,input});return {proposal:{vanName:'Test Van',start:input.requestedTime,estimatedEnd:'17:30',capacityEnd:'17:30',requiredSlots:4,ordinarySlots:3,durationMinutes:240,confirmationToken:'SYNTHETIC-CONSENT'}};}
    async function commit(input,kind){window.__specialWrites.push({kind,input});return {appointmentId:'SPECIAL-TEST',workOrderIds:['SPECIAL-WO-TEST']};}
    export async function prepareCapacityOvertime(input){return prepare(input,'capacity');}
    export async function createCapacityOvertime(input){return commit(input,'capacity');}
    export async function prepareRestDayOvertime(input){return prepare(input,'rest');}
    export async function createRestDayOvertime(input){return commit(input,'rest');}
    export async function createAfterHoursEmergency(input){return commit(input,'after-hours');}`,
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
import './app/globals.css';import shell from './components/scheduling/scheduling-page-shell.module.css';import readable from './components/scheduling/scheduling-readable-type.module.css';
function Harness(){
 const target={dateKey:window.__backdate?'2020-09-18':'2099-09-18',vanId:'VAN-TEST',vanName:'Test Van',start:window.__mode==='after_hours'?'17:00':'08:30',end:'12:30'};
 const supportTarget={...target,durationOptions:[{slots:1,end:'09:30'},{slots:2,end:'10:30'},{slots:3,end:'11:30'}]};
 const [open,setOpen]=useState(true),[support,setSupport]=useState(()=>window.__directSupport?supportTarget:null),[created,setCreated]=useState(null);
 // Mirrors the agenda listener's modal guard (also checked against owning source below).
 useEffect(()=>{const listener=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[data-booking-modal]')){window.__agendaEscapes++;setOpen(false);setSupport(false);}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
 const appointments=[{id:'EXISTING-TEST',dateKey:target.dateKey,status:'confirmed',customer:'Synthetic receiving customer',site:'Synthetic site',workLabel:'Existing service',assignments:[{isPrimaryAssignment:true,vanId:'VAN-OTHER',start:'08:30',end:'11:30'}]}];
 return <div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><button onClick={()=>setOpen(true)}>Synthetic agenda slot</button>{created?<h1>Synthetic booking result</h1>:open?<LiveAppointmentCreateDrawer target={target} mode={window.__mode||'standard'} onClose={()=>{window.__closes++;setOpen(false);}} onCreated={value=>{window.__created=value;setCreated(value);setOpen(false);}} onSendSupport={window.__mode?undefined:()=>setSupport(supportTarget)} support={support?{target:support,appointments,onCreated:()=>setCreated({support:true})}:undefined}/>:null}</div>;
}createRoot(document.getElementById('app')).render(<Harness/>);`;

async function ready(page){await page.locator('[data-booking-modal]').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-booking-modal] button[aria-label="Close"]')?.disabled);}
async function toggleDisclosure(page,name,open){const el=page.locator('[data-booking-disclosure="'+name+'"]');if(await el.evaluate(node=>node.open)!==open)await el.locator(':scope > summary').click();}
async function source(page,name){
 await page.getByRole('button',{name:new RegExp('^'+name)}).click();
 // Mode changes can commit after the click finishes; wait for the operator-visible destination.
 const dialog=page.getByRole('dialog',{name:name==='Send van support'?'Send van support':'Create appointment',exact:true});
 await dialog.waitFor();
 await dialog.getByRole('button',{name:new RegExp('^'+name),pressed:true}).waitFor();
}
async function assertSourceBlocked(page,name){
 const button=page.locator('button[aria-label^="'+name+'"]:visible');
 assert.equal(await button.evaluate(node=>node.disabled||Boolean(node.closest('[inert]'))),true,'Pending work blocks '+name+' switching');
}
async function supportDraft(page){
 await source(page,'Send van support');await page.getByRole('dialog',{name:'Send van support',exact:true}).waitFor();
 await page.getByLabel('Support duration').selectOption('3');await page.getByRole('button',{name:/Synthetic receiving customer/}).click();
 await page.getByRole('dialog',{name:'Send van support',exact:true}).getByLabel('Reason').selectOption('Other');await page.getByLabel('Describe support *').fill('Synthetic support note');
}
async function assertSingleActiveDialog(page){
 assert.equal(await page.locator('[data-booking-modal]:visible').count(),1,'Only the selected booking mode is visible');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','Active modal retains page scroll lock');
 const last=page.locator('[data-booking-modal]:visible').getByRole('button').last();await last.focus();await page.keyboard.press('Tab');
 assert.equal(await page.locator('[data-booking-modal]:visible').evaluate(node=>node.contains(document.activeElement)),true,'Tab stays in active mode');
}
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
   columns:['identity','work','details'].map(name=>rect(modal.querySelector('[data-booking-column="'+name+'"]'))),
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
async function assertNoWrites(page){assert.deepEqual(await page.evaluate(()=>({commits:window.__commits,holds:window.__holds,master:window.__masterWrites,uploads:window.__uploads,support:window.__supportWrites,special:window.__specialWrites})),{commits:[],holds:[],master:[],uploads:[],support:[],special:[]});}

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
  await context.addInitScript(flags=>{Object.assign(window,{__checks:[],__commits:[],__holds:[],__masterWrites:[],__uploads:[],__supportWrites:[],__specialPrepares:[],__specialWrites:[],__referenceReads:[],__locationReads:[],__records:{},__supportRecords:{},__requests:0,__closes:0,__agendaEscapes:0,...flags});},flags);
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try{await page.goto(origin);await test(page);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(error){await page.screenshot({path:path.join(artifacts,name+'-failure.png'),fullPage:true});console.error(JSON.stringify({name,errors,unexpected,text:(await page.locator('body').innerText()).slice(0,7500)},null,2));throw error;}
  finally{await context.close();}
 }
 try{
  for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:390,height:844}])await run('layout-'+viewport.width,viewport,async page=>{
   await ready(page);
   for(const name of [
    'Regular Booking Choose customer, property and work from Services & Products.',
    'Project Find a Project and reserve whole Van capacity slots against it.',
    'Send van support Use this open slot to help another Van with an existing appointment.',
   ])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true,`${viewport.width}: preserve complete source-button accessible name`);
   await setupRegular(page);await toggleDisclosure(page,'contacts',false);await toggleDisclosure(page,'references',false);await geometry(page,viewport.width,'layout-'+viewport.width);
   assert.match(await page.locator('[data-booking-column="identity"]').innerText(),/Customer|Property/);
   assert.match(await page.locator('[data-booking-column="work"]').innerText(),/Work & allocation/);
   assert.equal(await page.locator('[data-booking-column="work"]').getByLabel('Technician instructions').count(),0,'Center column is reserved for work selection');
   for(const label of ['Customer-facing work description','Technician instructions'])assert.equal(await page.locator('[data-booking-column="details"]').getByLabel(label).count(),1,'Right column owns '+label);
   assert.equal(await page.locator('[data-booking-column="details"] [data-booking-disclosure="references"]').count(),1);
   assert.equal(await page.locator('[data-booking-modal] > footer [data-booking-capacity]').count(),1,'Capacity moved into persistent footer');
   assert.equal(await page.locator('[data-booking-capacity]').evaluate(node=>node.open),false,'Ordinary successful capacity stays compact');
   await assertNoWrites(page);});
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
    for(const name of ['Regular Booking','Project','Send van support'])await assertSourceBlocked(page,name);
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
   for(const name of ['Regular Booking','Project','Send van support'])await assertSourceBlocked(page,name);
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
  for(const viewport of [{width:1366,height:768},{width:390,height:844}])await run('regular-support-roundtrip-'+viewport.width,viewport,async page=>{
   await setupRegular(page);await supportDraft(page);await assertSingleActiveDialog(page);
   await source(page,'Regular Booking');await assertSingleActiveDialog(page);
   assert.equal(await page.getByLabel('Technician instructions').inputValue(),'Synthetic retained technician instructions');
   assert.equal(await page.getByLabel('Customer-facing work description').inputValue(),'Synthetic mixed work');
   assert.equal(await page.getByLabel('Indicaciones para el técnico y ayudante').inputValue(),'Synthetic retained visit note');
   assert.equal(await page.getByLabel('Ubicación GPS del trabajo').inputValue(),'12.5, -70.0');
   assert.equal(await page.getByLabel('Access contact · this visit').inputValue(),'contact:CONTACT-TEST');
   assert.equal(await page.getByLabel('Confirmation').first().isChecked(),false);
   assert.match(await page.locator('[data-booking-column="details"]').innerText(),/2 lines · 3 items/);
   await source(page,'Send van support');await assertSingleActiveDialog(page);
   assert.equal(await page.getByLabel('Support duration').inputValue(),'3');assert.equal(await page.getByLabel('Describe support *').inputValue(),'Synthetic support note');
   assert.equal(await page.getByRole('button',{name:/Synthetic receiving customer.*SELECTED/}).count(),1);
   await source(page,'Project');assert.equal(await page.getByLabel(/Search Project/).isVisible(),true,'Support can switch directly to Project');
   assert.equal(await page.evaluate(()=>window.__closes),0,'Switching never invokes Cancel');await assertNoWrites(page);
  });
  await run('project-support-roundtrip',{width:1440,height:1000},async page=>{
   await ready(page);await source(page,'Project');await page.getByRole('button',{name:/PRJ-TEST.*Synthetic project/}).click();await page.getByLabel(/Planned Project slots/).fill('2');
   await page.getByLabel('Technician instructions').fill('Synthetic project draft');await supportDraft(page);await source(page,'Project');await assertSingleActiveDialog(page);
   assert.equal(await page.getByLabel(/Planned Project slots/).inputValue(),'2');assert.equal(await page.getByLabel('Technician instructions').inputValue(),'Synthetic project draft');
   await source(page,'Send van support');await source(page,'Regular Booking');assert.equal(await page.getByLabel('Search customer').isVisible(),true,'Support can switch directly to Regular Booking');await assertNoWrites(page);
  });
  for(const kind of ['confirm','hold'])await run('pending-'+kind+'-blocks-source-switch',{width:1366,height:768},async page=>{
   await setupRegular(page);await page.getByRole('button',{name:kind==='hold'?'Temporary hold':'Confirm appointment',exact:true}).click();await page.waitForFunction(()=>Boolean(window.__finishCommit));
   for(const name of ['Regular Booking','Project','Send van support'])await assertSourceBlocked(page,name);
   await page.keyboard.press('Escape');assert.equal(await page.locator('[data-booking-modal]:visible').count(),1);await page.evaluate(()=>window.__finishCommit());await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
  },{__pendingCommit:true});
  await run('support-pending-and-exact-recovery',{width:1366,height:768},async page=>{
   await ready(page);await supportDraft(page);await page.getByRole('button',{name:'Send support',exact:true}).click();await page.waitForFunction(()=>Boolean(window.__finishSupport));
   for(const name of ['Regular Booking','Project'])await assertSourceBlocked(page,name);
   await page.keyboard.press('Escape');assert.equal(await page.locator('[data-booking-modal]:visible').count(),1);
   await page.evaluate(()=>{window.__pendingSupport=false;window.__finishSupport();});
   const recovery=page.getByRole('button',{name:/Recuperar.*original/i});await recovery.waitFor();
   for(const name of ['Regular Booking','Project'])await assertSourceBlocked(page,name);
   await page.keyboard.press('Escape');assert.equal(await page.locator('[data-booking-modal]:visible').count(),1);await recovery.click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   const result=await page.evaluate(()=>({writes:window.__supportWrites,records:window.__supportRecords,commits:window.__commits,holds:window.__holds}));
   assert.equal(result.writes.length,2);assert.deepEqual(result.writes[0],result.writes[1]);assert.equal(Object.keys(result.records).length,1);assert.deepEqual(result.commits,[]);assert.deepEqual(result.holds,[]);
  },{__pendingSupport:true,__loseSupportResponse:true});
  await run('support-project-permission',{width:390,height:844},async page=>{
   await ready(page);assert.equal(await page.getByRole('button',{name:/^Project Find/}).count(),0);await source(page,'Send van support');assert.equal(await page.getByRole('button',{name:/^Project/}).count(),0);await source(page,'Regular Booking');assert.equal(await page.getByRole('button',{name:/^Project Find/}).count(),0);await assertNoWrites(page);
  },{__noProjectAccess:true});
  await run('capacity-footer-pending-ready-conflict',{width:1366,height:768},async page=>{
   await ready(page);const status=page.locator('[data-booking-capacity]');assert.equal(await status.getAttribute('data-tone'),'pending','Incomplete form is never green');
   await setupRegular(page);assert.equal(await status.getAttribute('data-tone'),'success','Only complete current authority result is green');
   const positions=await page.evaluate(()=>{const status=document.querySelector('[data-booking-capacity]').getBoundingClientRect(),cancel=[...document.querySelectorAll('footer button')].find(button=>button.textContent==='Cancel').getBoundingClientRect();return {status:{x:status.x,right:status.right,y:status.y},cancel:{x:cancel.x,y:cancel.y}};});
   assert.ok(positions.status.right<=positions.cancel.x+2&&Math.abs(positions.status.y-positions.cancel.y)<3,'Compact status immediately precedes Cancel');
   await page.evaluate(()=>{window.__pauseCheck=true;});await page.getByLabel('Technician instructions').fill('Metadata changed after approval');
   assert.equal(await status.getAttribute('data-tone'),'pending','A stale metadata offer is not presented as green');
   await page.waitForFunction(()=>Boolean(window.__finishCheck));assert.equal(await status.getAttribute('data-tone'),'pending');
   assert.equal(await page.getByRole('button',{name:'Confirm appointment',exact:true}).isDisabled(),true);
   await page.evaluate(()=>{window.__pauseCheck=false;window.__conflict=true;window.__finishCheck();});await page.waitForFunction(()=>document.querySelector('[data-booking-capacity]')?.dataset.tone==='error');
   assert.equal(await page.getByRole('button',{name:'Confirm appointment',exact:true}).isDisabled(),true);await status.locator(':scope > summary').click();
   assert.match(await status.innerText(),/no longer has the complete requested capacity/);assert.equal(await page.getByRole('button',{name:'Recheck now',exact:true}).isVisible(),true);
   await page.evaluate(()=>{window.__conflict=false;});await page.getByRole('button',{name:'Recheck now',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-booking-capacity]')?.dataset.tone==='success');await assertNoWrites(page);
  });
  await run('capacity-support-choices-retained',{width:1366,height:768},async page=>{
   await setupRegular(page);const panel=page.locator('[data-booking-capacity]');assert.equal(await panel.evaluate(node=>node.open),true,'Required support choices automatically remain discoverable');
   const choice=panel.getByRole('button',{name:/Support Van B · support/});await choice.click();await page.waitForFunction(()=>window.__checks.at(-1)?.supportSlotSelections.includes('SUPPORT-B'));
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Confirm appointment'&&!button.disabled));
   assert.match(await panel.innerText(),/Support Van A/);assert.match(await panel.innerText(),/Support Van B/);assert.match(await panel.innerText(),/PRIMARY \/ RESPONSIBLE/);
   await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   assert.equal(await page.evaluate(()=>window.__commits[0].optionId),'OPTION-SUPPORT-A-SUPPORT-B');assert.equal(await page.evaluate(()=>window.__supportWrites.length),0,'New-booking support allocation remains distinct from coworker support command');
  },{__supportChoices:true});
  await run('capacity-overtime-control-retained',{width:1366,height:768},async page=>{
   await ready(page);await page.getByLabel('Search customer').fill('Synthetic');await page.getByRole('button',{name:/Synthetic customer.*SELECT/i}).click();await page.getByRole('button',{name:/^Standard service/}).click();
   const panel=page.locator('[data-booking-capacity]');await page.waitForFunction(()=>document.querySelector('[data-booking-capacity]')?.dataset.tone==='warning');assert.equal(await panel.evaluate(node=>node.open),true);
   await panel.getByRole('button',{name:'Confirmar con posible overtime',exact:true}).click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   const writes=await page.evaluate(()=>window.__specialWrites);assert.equal(writes.length,1);assert.equal(writes[0].kind,'capacity');assert.deepEqual(writes[0].input.overtimeConsent,{accepted:true,confirmationToken:'SYNTHETIC-CONSENT'});assert.equal(await page.evaluate(()=>window.__commits.length+window.__holds.length+window.__supportWrites.length),0);
  },{__overtime:true});
  for(const mode of ['rest_day_overtime','after_hours'])await run('special-mode-'+mode,{width:1366,height:768},async page=>{
   await ready(page);assert.equal(await page.getByRole('button',{name:/^Send van support/}).count(),0,'Special entry keeps original support availability boundary');
   await page.getByLabel('Search customer').fill('Synthetic');await page.getByRole('button',{name:/Synthetic customer.*SELECT/i}).click();await page.getByRole('button',{name:/^Standard service/}).click();
   assert.equal(await page.getByRole('button',{name:'Temporary hold',exact:true}).count(),0);const panel=page.locator('[data-booking-capacity]');assert.equal(await panel.getAttribute('data-tone'),'pending','Special mode waits for authoritative commit validation');await panel.locator(':scope > summary').click();
   assert.match(await panel.innerText(),mode==='rest_day_overtime'?/Overtime durante descanso semanal/:/After-hours operational validation/);
   await page.getByRole('button',{name:mode==='rest_day_overtime'?'Review and confirm overtime':'Create for Test Van',exact:true}).click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   const writes=await page.evaluate(()=>window.__specialWrites);assert.equal(writes.length,1);assert.equal(writes[0].kind,mode==='rest_day_overtime'?'rest':'after-hours');assert.equal(await page.evaluate(()=>window.__commits.length+window.__holds.length+window.__supportWrites.length),0);
  },{__mode:mode});
  await run('historical-support-roundtrip',{width:1366,height:768},async page=>{
   await ready(page);await supportDraft(page);const acknowledgement=page.getByLabel('I confirm this Van actually provided support on the selected date and time.');await acknowledgement.check();await source(page,'Regular Booking');await source(page,'Send van support');assert.equal(await acknowledgement.isChecked(),true);
   await page.getByRole('button',{name:'Save historical support',exact:true}).click();await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
   const writes=await page.evaluate(()=>window.__supportWrites);assert.equal(writes.length,1);assert.equal(writes[0].bookingMode,'backdated');assert.equal(writes[0].backdatingAcknowledged,true);assert.equal(writes[0].requestedSlots,3);
  },{__backdate:true});
  await run('direct-support-entry-and-close',{width:1366,height:768},async page=>{
   await page.getByRole('dialog',{name:'Send van support',exact:true}).waitFor();await assertSingleActiveDialog(page);
   await source(page,'Project');await page.getByLabel('Search Project').waitFor();await assertSingleActiveDialog(page);
   await page.getByRole('button',{name:/PRJ-TEST.*Synthetic project/}).click();await page.getByLabel(/Planned Project slots/).fill('1');await source(page,'Send van support');await source(page,'Project');assert.equal(await page.getByLabel(/Planned Project slots/).inputValue(),'1');
   await page.keyboard.press('Escape');assert.equal(await page.locator('[data-booking-modal]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Closing restores page scroll after multiple mode switches');assert.equal(await page.evaluate(()=>window.__closes),1);await assertNoWrites(page);
  },{__directSupport:true});
  await run('mobile-expanded-capacity-controls',{width:390,height:844},async page=>{
   await setupRegular(page);const details=page.locator('[data-booking-capacity]');assert.equal(await details.evaluate(node=>node.open),true);
   const geometry=await details.locator(':scope > div').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:node.scrollWidth-node.clientWidth};});
   assert.ok(geometry.x>=0&&geometry.right<=geometry.width&&geometry.y>=0&&geometry.bottom<=geometry.height,'Expanded controls fit mobile viewport');assert.ok(geometry.overflow<=2,'Expanded controls do not overflow horizontally');
   await details.getByRole('button',{name:/Support Van B · support/}).click();await page.waitForFunction(()=>window.__checks.at(-1)?.supportSlotSelections.includes('SUPPORT-B'));
   await details.getByRole('button',{name:'Close validation details',exact:true}).click();assert.equal(await details.evaluate(node=>node.open),false);await page.screenshot({path:path.join(artifacts,'mobile-capacity-controls.png'),fullPage:true});await assertNoWrites(page);
  },{__supportChoices:true});
  fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({boundary:'Real React components; synthetic backend commands; no production requests.',results},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(output,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
