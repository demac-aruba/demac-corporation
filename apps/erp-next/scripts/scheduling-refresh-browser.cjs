// Real Scheduling React view + real attribution cache/projection; synthetic read adapters.
// This is component simulation, NOT Firebase integration or the requested complete preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const APP = path.resolve(__dirname, '..');
const tools = process.env.SCHEDULING_TEST_TOOLS;
const output = process.env.SCHEDULING_TEST_OUTPUT;
if (!tools || !output || !path.isAbsolute(tools) || !path.isAbsolute(output)) throw Error('Absolute isolated tooling and output directories required');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium } = require(path.join(tools, 'node_modules/playwright'));
fs.mkdirSync(output, { recursive: true });
const stubs = {
  'auth-provider': `import {useSyncExternalStore} from 'react';
    const listeners=new Set();let principal={userId:'synthetic-operator',displayName:'Viewer',active:true,capabilities:new Set(['scheduling.view','scheduling.manage','projects.view'])};
    window.switchPrincipal=(value)=>{principal={...principal,...value};for(const fn of listeners)fn();};
    const refreshPrincipal=async()=>window.switchPrincipal({active:false});
    export function useAuth(){return {principal:useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>principal),refreshPrincipal};}`,
  'live-scheduling-fast': `import {createSchedulingAttributionCache} from './lib/scheduling-attribution';
    import {bookingActorLabel} from './lib/live-scheduling';
    export function invalidateLiveSchedulingReferenceCache(){}
    export async function loadLiveSchedulingAppointmentsFast(range){window.reads++;const records=structuredClone(window.records).filter(x=>x.dateKey>=range.startDate&&x.dateKey<=range.endDate);await new Promise(r=>setTimeout(r,window.readDelay));return records;}
    export function createLiveSchedulingAttributionCache(){return createSchedulingAttributionCache(async ids=>{
      window.attributionReads++;const name=window.creatorName;await new Promise(r=>setTimeout(r,window.attributionDelay));
      if(window.denyAttribution)throw Error('Access revoked (permission-denied)');
      if(window.failAttribution)throw Error('Synthetic attribution failure');
      return ids.map(appointmentId=>({appointmentId,createdBy:'original-creator',createdByName:name,source:'office-scheduling'}));
    },bookingActorLabel,()=>Date.now()+window.clockOffset);}`,
  'live-operational-capacity': `
    export async function loadLiveOperationalCapacityState(){return {vans:new Map(['VAN-1','VAN-2','VAN-3'].map(id=>[id,{id,active:true,status:'Disponible'}])),staffProfiles:[],dailyAssignments:[],halfDaySchedules:[],calendarClosures:[],closedWeekdays:[0]};}
    export function liveCompanyClosureReason(){return '';}
    export function liveOperationalStartTimes(state,van,date,starts){return starts;}
    export function liveOperationalWindowAllows(){return true;}
    export function liveVanCrew(){return {label:'Synthetic crew',technicianIds:[]};}
    export function liveVanHalfDaySchedule(){return null;}
    export function liveVanOperationallyAvailable(){return true;}`,
  'live-appointment-create-drawer': `export function LiveAppointmentCreateDrawer({onClose}){return <div role="dialog"><p>Synthetic create boundary; no write</p><button onClick={onClose}>Close fixture</button></div>;}`,
  'live-appointment-details-drawer': `export function LiveAppointmentDetailsDrawer({appointment,onChanged,onClose}){return <div role="dialog"><p>{appointment.bookedByName}</p><button onClick={()=>{window.records=[];onChanged();onClose();}}>Synthetic cancel</button><button onClick={onClose}>Close fixture</button></div>;}`,
  'adhoc-support-drawer': `export function AdhocSupportDrawer(){return null;}`,
  'after-hours-emergency-panel': `export function AfterHoursEmergencyDrawer(){return null;}`,
  'drag-move-confirmation': `export function DragMoveConfirmation(){return null;}`,
};
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {LiveSchedulingOverview} from './components/scheduling/live-scheduling-overview';
import {projectLiveSchedulingAppointments} from './lib/live-scheduling';
import {currentArubaDateKey} from './lib/scheduling-capacity';
import readable from './components/scheduling/scheduling-readable-type.module.css';
import shell from './components/scheduling/scheduling-page-shell.module.css';
const date=currentArubaDateKey();
window.creatorName='Synthetic original booking operator with an intentionally long name for desktop and mobile accessibility';
window.readDelay=50;window.attributionDelay=1800;window.reads=0;window.attributionReads=0;window.clockOffset=0;
window.records=projectLiveSchedulingAppointments(['VAN-1','VAN-2'].map((vanId,i)=>({
 id:'SYNTHETIC-WO-'+i,appointmentId:'SYNTHETIC-APT',date,time:'08:30',vanId,status:'confirmed',
 appointmentPresetId:'other',appointmentWorkLabel:'Other',appointmentDurationMode:'manual',
 appointmentDurationMinutes:360,appointmentEndTime:'14:30',appointmentCapacityEndTime:'16:30',scheduledSlots:6,fullDaySingleProperty:true,
 appointmentWorkItems:[{id:'synthetic-line',presetId:'other',label:'Other',quantity:1,durationMode:'manual'}],
 clientId:'SYNTHETIC-CUSTOMER',propertyId:'SYNTHETIC-PROPERTY'
})),[{id:'SYNTHETIC-CUSTOMER',name:'Synthetic test customer'}],[{id:'SYNTHETIC-PROPERTY',name:'Synthetic test site'}]);
window.records.push(...projectLiveSchedulingAppointments([{id:'SYNTHETIC-SINGLE-WO',appointmentId:'SYNTHETIC-SINGLE-APT',date,time:'08:30',vanId:'VAN-3',status:'confirmed',appointmentPresetId:'standard_service',appointmentWorkLabel:'Standard service',appointmentDurationMode:'per_unit',appointmentDurationMinutes:60,scheduledSlots:1,quantity:1}],[],[]));
window.originalRecords=structuredClone(window.records);
window.projectKey='demac.erp-next.projects.preview.v1';
window.projectState={version:1,selectedProjectId:'SYNTHETIC-PROJECT',projects:[{
 id:'SYNTHETIC-PROJECT',projectNumber:'SYNTHETIC-001',name:'Synthetic VRF project',
 customerId:'SYNTHETIC-CUSTOMER',siteId:'SYNTHETIC-PROPERTY',
 phases:[{id:'phase-1',name:'Installation',status:'Completed'}],
 assignments:['SYNTHETIC-WO-0','SYNTHETIC-WO-1'].map(workOrderId=>({projectId:'SYNTHETIC-PROJECT',appointmentId:'SYNTHETIC-APT',workOrderId,phaseId:'phase-1'}))
}]};
localStorage.setItem(window.projectKey,JSON.stringify(window.projectState));
window.overtimeRecords=projectLiveSchedulingAppointments([{id:'SYNTHETIC-OT-WO',appointmentId:'SYNTHETIC-OT-APT',date,time:'14:30',vanId:'VAN-2',status:'confirmed',appointmentPresetId:'standard_service',appointmentWorkLabel:'Standard service',appointmentDurationMode:'per_unit',appointmentDurationMinutes:180,appointmentEndTime:'17:30',appointmentCapacityEndTime:'17:30',scheduledSlots:3,quantity:3,operationalMoveOvertime:{accepted:true,capacityEnd:'17:30'}}],[],[]);
const root=createRoot(document.getElementById('app'));window.unmount=()=>root.unmount();root.render(<React.StrictMode><div className={shell.shell+' '+shell.scheduleCompact+' '+readable.readable}><LiveSchedulingOverview/></div></React.StrictMode>);`;

async function runCase(browser, origin, label, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[];const external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(origin+'/'))return route.continue();
    external.push(route.request().url());return route.abort();
  });
  await page.goto(origin);
  const cards=page.locator('[data-schedule-job]');
  await cards.first().waitFor();
  const initial=await cards.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  await page.waitForFunction(()=>document.querySelector('[data-booking-attribution]')?.textContent.includes(window.creatorName));
  const stable=await cards.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  assert.deepEqual(stable,initial,`${label}: initial attribution must not grow blocks`);
  await page.evaluate(()=>{
    window.samples=[];
    window.sampleTimer=setInterval(()=>window.samples.push({heights:[...document.querySelectorAll('[data-schedule-job]')].map(n=>n.getBoundingClientRect().height),names:[...document.querySelectorAll('[data-booking-attribution]')].map(n=>n.textContent)}),100);
  });
  // Actual wall-clock 90 seconds; keep the real 15-second application refresh.
  for(let round=0;round<9;round++){
    if(round===2)await page.evaluate(()=>{window.failAttribution=true;window.clockOffset=301000;window.dispatchEvent(new Event('focus'));});
    if(round===4)await page.evaluate(()=>{window.failAttribution=false;window.attributionDelay=2500;window.dispatchEvent(new Event('focus'));});
    if(round===6)await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});
    await page.waitForTimeout(10000);
  }
  const observation=await page.evaluate(()=>{clearInterval(window.sampleTimer);return {samples:window.samples,reads:window.reads,attributionReads:window.attributionReads};});
  assert(observation.reads>=6,`${label}: multiple actual refreshes`);
  for(const sample of observation.samples){assert.deepEqual(sample.heights,stable);assert(sample.names.every(n=>n.includes('Synthetic original booking operator')));}
  const cardText=await cards.first().innerText();
  assert.match(cardText,/4:30 PM/);assert.match(cardText,/6 slots reserved/);assert.doesNotMatch(cardText,/1 unit|Service-work estimate|2:30 PM/);
  assert.match(cardText,/Project · Synthetic VRF project · Installation/);
  assert.match(await cards.nth(1).innerText(),/Project · Synthetic VRF project · Installation/);
  assert.match(await cards.nth(2).innerText(),/Standard service · 1 unit/);
  await page.screenshot({path:path.join(output,`${label}.png`),fullPage:true});
  // Existing Project edits/removal update the read-only label without an operational write.
  await page.evaluate(()=>{window.projectState.projects[0].name='Renamed synthetic project';localStorage.setItem(window.projectKey,JSON.stringify(window.projectState));window.dispatchEvent(new StorageEvent('storage',{key:window.projectKey}));});
  await page.waitForFunction(()=>document.querySelector('[data-schedule-job]')?.textContent.includes('Renamed synthetic project'));
  await page.evaluate(()=>{localStorage.removeItem(window.projectKey);window.dispatchEvent(new StorageEvent('storage',{key:window.projectKey}));});
  await page.waitForFunction(()=>!document.querySelector('[data-schedule-job]')?.textContent.includes('Project ·'));
  assert.match(await cards.first().innerText(),/Other/);
  await page.evaluate(()=>{localStorage.setItem(window.projectKey,JSON.stringify(window.projectState));window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>document.querySelector('[data-schedule-job]')?.textContent.includes('Renamed synthetic project'));
  await page.evaluate(()=>window.switchPrincipal({capabilities:new Set(['scheduling.view','scheduling.manage'])}));
  await cards.first().waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(),/Renamed synthetic project|Installation/);
  await page.evaluate(()=>window.switchPrincipal({capabilities:new Set(['scheduling.view','scheduling.manage','projects.view'])}));
  await page.waitForFunction(()=>document.querySelector('[data-schedule-job]')?.textContent.includes('Renamed synthetic project'));
  // Integration with main must preserve its accepted overtime while retaining new card semantics.
  await page.evaluate(()=>{window.records=structuredClone(window.overtimeRecords);window.dispatchEvent(new Event('focus'));});
  await page.getByText(/Posible overtime aceptado/).waitFor();
  assert.equal(await cards.count(),1);
  const overtimeText=await cards.first().innerText();
  assert.match(overtimeText,/3 slots reserved/);assert.match(overtimeText,/5:30 PM/);
  await page.evaluate(()=>{window.records=structuredClone(window.originalRecords);window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>document.querySelectorAll('[data-schedule-job]').length===3);
  // Old-week operational reads and attribution must not repopulate a new week.
  await page.evaluate(()=>{window.readDelay=800;window.clockOffset+=301000;window.attributionDelay=1800;window.dispatchEvent(new Event('focus'));});
  await page.getByRole('button',{name:'›',exact:true}).click();
  await page.waitForTimeout(2100);
  assert.equal(await cards.count(),0);
  await page.evaluate(()=>{window.readDelay=50;});
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await cards.first().waitFor();
  // A completed cancellation while an attribution response is still in flight cannot reappear.
  await page.evaluate(()=>{window.clockOffset+=301000;window.attributionDelay=2000;window.dispatchEvent(new Event('focus'));});
  await page.waitForTimeout(200);
  await cards.first().click();
  await page.getByRole('button',{name:'Synthetic cancel'}).click();
  await page.waitForTimeout(2300);
  assert.equal(await cards.count(),0);
  await page.evaluate(()=>{window.records=structuredClone(window.originalRecords);window.attributionDelay=2000;window.dispatchEvent(new Event('focus'));});
  await cards.first().waitFor();
  await page.evaluate(()=>window.switchPrincipal({active:false}));
  await page.waitForTimeout(2300);
  assert.equal(await cards.count(),0);
  assert.match(await page.locator('body').innerText(),/Scheduling access is unavailable/);
  await page.evaluate(()=>{window.creatorName='Second-session creator';window.attributionDelay=1200;window.switchPrincipal({active:true,userId:'second-operator'});});
  await cards.first().waitFor();
  assert.doesNotMatch(await cards.first().innerText(),/Synthetic original booking operator/);
  await page.waitForFunction(()=>document.querySelector('[data-booking-attribution]')?.textContent.includes('Second-session creator'));
  await page.evaluate(()=>{window.denyAttribution=true;window.clockOffset+=301000;window.dispatchEvent(new Event('focus'));});
  await page.getByText('Scheduling access is unavailable.',{exact:true}).waitFor();
  assert.equal(await cards.count(),0);
  await page.evaluate(()=>{window.denyAttribution=false;window.switchPrincipal({active:true,userId:'third-operator'});});
  await cards.first().waitFor();
  await page.evaluate(()=>{window.clockOffset+=301000;window.dispatchEvent(new Event('focus'));});
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.unmount());
  await page.waitForTimeout(1400);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await context.close();
  return {label,realObservationSeconds:90,samples:observation.samples.length,operationalReads:observation.reads,attributionReads:observation.attributionReads,externalRequests:external.length,result:'PASS'};
}

async function main(){
  await build({absWorkingDir:APP,tsconfig:path.join(APP,'tsconfig.json'),stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-demac-scheduling',NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED:'false'})},
    plugins:[{name:'synthetic-read-boundary',setup(b){b.onResolve({filter:/.*/},args=>{
      if(!args.importer.endsWith('live-scheduling-overview.tsx'))return;
      const key=path.basename(args.path);if(stubs[key])return {path:key,namespace:'synthetic'};
    });b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:APP}));}}]});
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,req.url.slice(1))));}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial,sans-serif;--brand:#006ba6;--brand-soft:#e8f2fa;--canvas:#f5f7fb;--surface:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--success:#148158}*{box-sizing:border-box}</style></head><body><p>ISOLATED COMPONENT SIMULATION · synthetic adapters · no Firebase connection</p><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch();
  try { const results=await Promise.all([runCase(browser,origin,'desktop',{width:1440,height:1000}),runCase(browser,origin,'mobile',{width:390,height:844})]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
