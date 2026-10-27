// Real Vans form, mutations, capacity reader and Scheduling board; synthetic storage/API only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.SCHEDULING_TEST_TOOLS, output = process.env.SCHEDULING_TEST_OUTPUT;
if (![tooling, output].every(v => v && path.isAbsolute(v))) throw Error('Absolute isolated tooling/output paths required');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
const retained = require('./scheduling-refresh-browser.cjs');
const stubs = { ...retained.stubs };
delete stubs['live-operational-capacity'];
stubs['shared-projects'] = `export const PROJECTS_CHANGED_EVENT='projects-changed';export async function loadSchedulingProjects(){return [];}export async function loadSharedProjects(){return {projects:[]};}`;
stubs['van-roster'] = `export async function loadVanRoster(){return {rows:[],staff:[],token:'synthetic',effectiveDate:'2026-10-27'};}export function rosterCrewChanged(){return false;}export async function saveVanRoster(){throw Error('Unexpected crew write');}`;
stubs['firestore-rest'] = `
export async function listFirestoreCollection(name){if(window.failCapacity&&name==='vans')throw Error('Synthetic fleet read unavailable');window.capacityReads[name]=(window.capacityReads[name]||0)+1;return structuredClone(window.raw[name]||[]);}
export async function queryFirestoreCollectionDateRange({collectionId}){return listFirestoreCollection(collectionId);}
export async function getFirestoreDocument(name,id){return structuredClone((window.raw[name]||[]).find(item=>item.id===id)||null);}
export async function saveFirestoreDocument(name,item){if((window.raw[name]||[]).some(x=>x.id===item.id))throw Error('Already exists');(window.raw[name]??=[]).push(structuredClone(item));window.writes.push({name,item});return item;}
export async function updateFirestoreDocument(name,id,changes){const item=(window.raw[name]||[]).find(x=>x.id===id);if(!item)throw Error('Missing record');Object.assign(item,structuredClone(changes));window.writes.push({name,id,changes});return structuredClone(item);}
`;
const initialization = `
window.raw={vans:[1,2,3,4,5,12].map(n=>({id:n===5?'VAN-1783801335935':'VAN-'+n,name:'Van '+n,plate:'SYNTHETIC-'+n,active:true,status:n>=5?'Fuera de servicio':'Disponible',responsibleStaffId:'driver-'+n,regularHelperId:n===5?'':'helper-'+n,technicianIds:n===5?['driver-'+n]:['driver-'+n,'helper-'+n]})),
staffProfiles:[1,2,3,4,5,12].flatMap(n=>[{id:'driver-'+n,name:'Synthetic driver '+n,employeeType:'Técnico',canDriveVan:true,active:true},{id:'helper-'+n,name:'Synthetic helper '+n,employeeType:'Técnico',active:true}]),
vanHalfDaySchedules:[{id:'partial-5',vanId:'VAN-5',weekday:5,active:true,workdayStart:'08:00',workdayEnd:'13:00',extraMorningSlot:'11:30'}],dailyVanAssignments:[],businessSettings:[{id:'business-calendar',closedWeekdays:[0]}]};
window.capacityReads={};window.writes=[];window.readDelay=0;window.attributionDelay=0;window.clockOffset=0;window.reads=0;window.attributionReads=0;window.creatorName='Synthetic operator';
window.records=projectLiveSchedulingAppointments([{id:'synthetic-order',appointmentId:'synthetic-booking',date:'2026-10-27',time:'10:30',vanId:'VAN-5',status:'confirmed',appointmentPresetId:'standard_service',appointmentWorkLabel:'Standard Service',appointmentDurationMinutes:60,scheduledSlots:1,quantity:1}],[],[]);
`;
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AdvancedVansWorkspace} from './components/vans/advanced-vans-workspace';import {LiveSchedulingOverview} from './components/scheduling/live-scheduling-overview';
import {projectLiveSchedulingAppointments} from './lib/live-scheduling';
${initialization}
function App(){const [view,setView]=useState('schedule');return <><nav><button onClick={()=>setView('vans')}>Test Vans</button><button onClick={()=>setView('schedule')}>Test Schedule</button></nav>{view==='vans'?<AdvancedVansWorkspace/>:<LiveSchedulingOverview/>}</>;}
createRoot(document.getElementById('app')).render(<App/>);`;
async function main(){
 fs.mkdirSync(output,{recursive:true});
 await build({absWorkingDir:APP,tsconfig:path.join(APP,'tsconfig.json'),stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-dynamic-fleet'})},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{const key=path.basename(args.path);if(stubs[key])return {path:key,namespace:'synthetic'};});b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:APP}));}}]});
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px;font:16px Arial,sans-serif;background:#f5f7fb;--brand:#006ba6;--brand-soft:#e8f2fa;--canvas:#f5f7fb;--surface:#fff;--surface-1:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--warning:#986300;--success:#148158;--danger:#bd3333}*{box-sizing:border-box}</style></head><body><p>DEMAC · Synthetic fleet verification</p><div id="app"></div><script src="/app.js"></script></body></html>';
 const server=http.createServer((req,res)=>{if(['/app.js','/app.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,req.url.slice(1))));}res.setHeader('Content-Type','text/html');res.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});const results=[];
 try {for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage();const errors=[],external=[],groupWrites=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();if(url==='https://us-central1-demo-dynamic-fleet.cloudfunctions.net/officeBookingAuthority'){const req=route.request().postDataJSON();if(req.action==='save_van_schedule_groups')groupWrites.push(req.data);assert.ok(['get_van_schedule_groups','save_van_schedule_groups'].includes(req.action));return route.fulfill({json:{success:true,version:1,groups:[]}});}external.push(url);return route.abort();});
  await page.clock.install({time:new Date('2026-10-27T12:00:00Z')});await page.goto(origin);
  await page.locator('[data-van-lane]').nth(3).waitFor();
  assert.equal(await page.locator('[data-van-lane]').count(),4);
  assert.match(await page.locator('[data-unavailable-van-jobs]').innerText(),/Van 5/);
  await page.locator('[data-unavailable-van-jobs] button').click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Close fixture'}).click();
  await page.getByRole('button',{name:'Test Vans',exact:true}).click();
  await page.getByRole('button',{name:/SYNTHETIC-5 Van 5/}).click();await page.getByRole('button',{name:'Profile',exact:true}).click();
  await page.locator('label').filter({has:page.getByText('Operational status',{exact:true})}).locator('select').selectOption('Disponible');
  await page.getByRole('button',{name:'Save Van Profile',exact:true}).click();
  await page.getByText(/profile saved. Available for light work/).waitFor();
  assert.equal(await page.evaluate(()=>window.raw.vans.find(v=>v.name==='Van 5').status),'Trabajo liviano');
  assert.equal(await page.evaluate(()=>window.writes.some(w=>w.name==='vanHalfDaySchedules')),false,'Status save must preserve the Friday rule');
  await page.getByRole('button',{name:'Test Schedule',exact:true}).click();
  await page.locator('[data-van-lane][aria-label="Van 5 schedule"]').waitFor();
  assert.equal(await page.locator('[data-van-lane]').count(),5);
  assert.match(await page.locator('[data-schedule-metrics]').innerText(),/29[\s\S]*1\/30/);
  assert.equal(await page.locator('[data-unavailable-van-jobs]').count(),0);
  if(width===390)await page.getByRole('button',{name:'Show Van 5',exact:true}).click();
  await page.screenshot({path:path.join(output,`fleet-active-${width}.png`),fullPage:true});
  await page.locator('[data-schedule-day]').filter({hasText:'FRI'}).click();
  assert.match(await page.locator('[data-schedule-metrics]').innerText(),/0\/28/);
  assert.match(await page.locator('[data-van-lane][aria-label="Van 5 schedule"]').innerText(),/HALF-DAY/);
  await page.locator('[data-schedule-day]').filter({hasText:'TUE'}).click();
  // Focus refresh bypasses the cache, even within the same minute in another operator tab.
  await page.evaluate(()=>{window.raw.vans.find(v=>v.name==='Van 12').status='Disponible';window.dispatchEvent(new Event('focus'));});
  await page.locator('[data-van-lane][aria-label="Van 12 schedule"]').waitFor();assert.equal(await page.locator('[data-van-lane]').count(),6);
  await page.evaluate(()=>{window.raw.dailyVanAssignments=[{id:'dated-off',date:'2026-10-27',vanId:'VAN-12',status:'Sin personal'}];window.dispatchEvent(new Event('focus'));});
  await page.locator('[data-van-lane][aria-label="Van 12 schedule"]').waitFor({state:'detached'});
  assert.match(await page.locator('[data-schedule-day]').filter({hasText:'WED'}).textContent(),/0\/36/,'Selected-date unavailability must not remove other days capacity');
  await page.evaluate(()=>{window.raw.dailyVanAssignments[0].status='Cancelled';window.dispatchEvent(new Event('focus'));});
  await page.locator('[data-van-lane][aria-label="Van 12 schedule"]').waitFor();
  await page.evaluate(()=>{window.raw.vans.find(v=>v.name==='Van 5').status='Fuera de servicio';window.dispatchEvent(new Event('focus'));});
  await page.locator('[data-unavailable-van-jobs]').waitFor();assert.equal(await page.locator('[data-van-lane][aria-label="Van 5 schedule"]').count(),0);
  // New numeric identity follows canonical names, not the legacy timestamp source ID.
  await page.getByRole('button',{name:'Test Vans',exact:true}).click();await page.getByRole('button',{name:'＋ Add Van',exact:true}).first().click();
  assert.equal(await page.getByLabel('Canonical ID',{exact:true}).inputValue(),'VAN-13');
  await page.getByRole('button',{name:'Save Van Profile',exact:true}).click();await page.getByText(/Van 13 profile and schedule saved/).waitFor();
  await page.getByRole('button',{name:'Test Schedule',exact:true}).click();await page.locator('[data-van-lane]').first().waitFor();
  assert.equal(await page.locator('[data-van-lane][aria-label="Van 13 schedule"]').count(),0);
  await page.evaluate(()=>{window.raw.vans.forEach(v=>v.status='Fuera de servicio');window.dispatchEvent(new Event('focus'));});
  await page.getByText('No available Vans for this date.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-van-lane]').count(),0);
  assert.match(await page.locator('[data-schedule-metrics]').innerText(),/0\/0/);
  await page.evaluate(()=>{window.failCapacity=true;window.dispatchEvent(new Event('focus'));});
  await page.getByText(/Canonical operating-capacity policy could not be loaded/).waitFor();
  await page.locator('[data-unavailable-van-jobs] button').click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Close fixture'}).click();
  assert.equal(await page.locator('[data-van-lane]').count(),0,'No invented fallback fleet or open capacity on failed read');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({width,result:'PASS',checks:['hide inactive lanes','existing booking access','driver-only activation','capacity 24 to 30','preserve partial day','immediate navigation/focus refresh','VAN-12','safe VAN-13 creation'],externalRequests:0});
  await context.close();
 }} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
