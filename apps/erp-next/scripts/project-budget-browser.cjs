// Real React drawer + budget components; synthetic authority adapters. NOT a live/backend test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const tools = process.env.BUDGET_TEST_TOOLS;
if (!tools || !path.isAbsolute(tools)) throw Error('An isolated absolute tooling directory is required.');
const { build } = require(path.join(tools, 'node_modules/esbuild'));
const { chromium, webkit } = require(path.join(tools, 'node_modules/playwright'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-budget-browser-'));
const artifacts = path.resolve(APP, '../../project-budget-browser-evidence');
fs.mkdirSync(artifacts, { recursive: true });
const fixture = {
  id: 'PROJECT-BROWSER-TEST', projectNumber: 'PRJ-BROWSER-TEST', name: 'Synthetic project',
  customerId: 'CUSTOMER-BROWSER-TEST', customerName: 'Synthetic customer', siteId: 'PROPERTY-BROWSER-TEST',
  location: 'Synthetic site', contactPerson: 'Synthetic contact', type: 'VRF Project', description: 'Synthetic test scope',
  status: 'Planned', priority: 'Normal', managerId: '', managerName: 'Synthetic manager',
  startsOn: '2099-09-01', estimatedCompletionOn: '2099-10-01', totalUnits: 10, completedUnits: 0,
  unitType: 'Units', estimatedWorkDays: 11, slotsPerWorkDay: 6, slotDurationMinutes: 60,
  estimatedSlots: 66, estimatedLaborHours: 66, scheduledFutureHours: 63, actualLaborHours: 0,
  materialBudget: null, materialActual: 0, assignedVans: [], phases: [], assignments: [], materials: [], expenses: [], costEntries: [],
};
const stubs = {
  'auth-provider': `const principal = {userId:'SYNTHETIC-ACTOR',active:true, role:'operations', displayName:'Synthetic operator', capabilities:new Set(window.__readOnly ? ['projects.view'] : ['projects.view','projects.manage'])}; export function useAuth(){return {principal};}`,
  'live-scheduling-booking-data': `
    export async function loadBookingMasterReferenceData(){return {clients:[{id:'CUSTOMER-BROWSER-TEST',name:'Synthetic customer',active:true}],properties:[{id:'PROPERTY-BROWSER-TEST',clientId:'CUSTOMER-BROWSER-TEST',name:'Synthetic site',address:'Synthetic site',active:true}]};}
    export async function loadBookingContactReferenceData(){return {contacts:[],contactAssignments:[]};}
    export async function createBookingCustomerWithProperty(){throw Error('Unexpected customer write');}
    export async function createBookingProperty(){throw Error('Unexpected property write');}`,
  'live-operational-capacity': `export async function loadLiveOperationalCapacityState(){return {};} export function liveVanCrew(){return {label:'Synthetic crew'};}`,
  'aruba-address-directory': `export async function suggestArubaAddresses(){return [];}`,
  'property-communication-editor': `export function PropertyCommunicationPanel(){return null;} export function PropertyContactDraftEditor(){return null;}`,
  'after-hours-booking': `export async function createAfterHoursEmergency(){throw Error('Unexpected after-hours write');}`,
  'office-booking-authority': `
    export async function updateOfficeProperty(){throw Error('Unexpected property edit in budget acceptance');}
    export class OfficeBookingRequestError extends Error {}
    export async function callOfficeBookingAuthority(action,input){
      if(action!=='list_property_locations'||input.customerId!=='CUSTOMER-BROWSER-TEST'||input.propertyId!=='PROPERTY-BROWSER-TEST')throw Error('Unexpected property location operation');
      window.__locationReads.push(input);
      return {success:true,property:{id:input.propertyId,clientId:input.customerId,name:'Synthetic site',address:'Synthetic site',active:true,hasIndependentDwellings:false,locationVersion:0},dwellings:[],areas:[],assignments:[]};
    }
    export function officeBookingOutcomeUnknown(error){return error.message==='Synthetic response lost';}
    export function createOfficeLifecycleRequestId(){return 'synthetic-request-'+(++window.__requests);}
    export async function listOfficeBookingPresets(){return {presets:[{id:'other',label:'Other',active:true,serviceId:'SERVICE-TEST',durationMode:'manual',durationMinutesPerUnit:60}]};}
    export async function checkOfficeCreateAvailability(input){
      window.__checks.push(input);
      await new Promise(resolve=>setTimeout(resolve,80));
      if(window.__unavailable) return {available:false,options:[],reason:'required-primary-target-unavailable'};
      const minutes=input.workLines[0].manualDurationMinutes;
      if(window.__support) return {available:true,offer:{id:'SYNTHETIC-OFFER',version:1},options:[{id:'SYNTHETIC-OPTION',date:input.requestedDate,time:input.requestedTime,assignments:[
        {role:'primary',vanId:input.requiredVanId,vanName:'Test Van',time:input.requestedTime,endTime:'13:30',capacityEndTime:'13:30',durationMinutes:240,slots:4,quantity:1},
        {role:'support',vanId:'SUPPORT-VAN',vanName:'Support Van',time:'08:30',endTime:'10:30',capacityEndTime:'10:30',durationMinutes:120,slots:2,quantity:1}]}]};
      return {available:true,offer:{id:'SYNTHETIC-OFFER',version:1},options:[{id:'SYNTHETIC-OPTION',date:input.requestedDate,time:input.requestedTime,endTime:'15:30',capacityEndTime:'15:30',durationMinutes:minutes,durationMode:'manual',quantity:1,assignments:[{role:'primary',vanId:input.requiredVanId,vanName:'Test Van',time:input.requestedTime,endTime:'15:30',capacityEndTime:'15:30',durationMinutes:minutes,slots:minutes/60,quantity:1}]}]};
    }
    async function commit(input,hold){
      const calls=hold?window.__holds:window.__commits;calls.push(input);
      if(window.__failCommit) throw Error('Synthetic final capacity conflict');
      window.__records[input.requestId] ||= {appointmentId:hold?'SYNTHETIC-HOLD':'SYNTHETIC-APT',workOrderIds:window.__support?['SYNTHETIC-WO','SUPPORT-WO']:[hold?'SYNTHETIC-HOLD-WO':'SYNTHETIC-WO']};
      if(window.__loseResponse && calls.length===1) throw Error('Synthetic response lost');
      return window.__records[input.requestId];
    }
    export async function confirmOfficeAppointment(input){return commit(input,false);}
    export async function createOfficeTemporaryHold(input){return commit(input,true);}`,
};
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LiveAppointmentCreateDrawer} from './components/scheduling/live-appointment-create-drawer';
import {ProjectLaborBudgetSummary} from './components/projects/project-labor-budget-status';
function Harness(){
 const [created,setCreated]=useState(null);
 if(created) return <main><h1>Synthetic booking result</h1><ProjectLaborBudgetSummary project={JSON.parse(localStorage.getItem('demac.erp-next.projects.preview.v1')).projects[0]} /></main>;
 return <LiveAppointmentCreateDrawer target={{dateKey:'2099-09-18',vanId:'VAN-TEST',vanName:'Test Van',start:'08:30',end:'09:30'}} onClose={()=>{}} onCreated={value=>{window.__created=value;setCreated(value);}} />;
}
createRoot(document.getElementById('app')).render(<Harness/>);`;
async function main() {
  await build({
    absWorkingDir: APP, stdin: {contents:entry,loader:'tsx',resolveDir:APP}, outfile:path.join(output,'app.js'),
    bundle:true, platform:'browser', format:'iife', jsx:'automatic', define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_PROJECTS_REGISTRY_ENABLED:'false',NEXT_PUBLIC_PROJECTS_BOOKING_ENABLED:'false',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-demac-projects'})},
    plugins:[{name:'synthetic-authority-boundary',setup(builder){
      builder.onResolve({filter:/.*/}, args=>{
        const key=path.basename(args.path);
        const locationAuthority=key==='office-booking-authority'&&(args.importer.endsWith('property-locations.ts')||args.importer.endsWith('property-locations.tsx'));
        if(!args.importer.endsWith('live-appointment-create-drawer.tsx')&&!locationAuthority)return;
        if(stubs[key])return {path:key,namespace:'budget-test-stub'};
      });
      builder.onLoad({filter:/.*/,namespace:'budget-test-stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:APP}));
    }}],
  });
  const server = http.createServer((req,res)=>{
    const name = new URL(req.url,'http://local').pathname;
    if(name==='/app.js'||name==='/app.css') {
      res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/css');
      return res.end(fs.readFileSync(path.join(output,name.slice(1))));
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font:16px Arial,sans-serif;background:#f5f7fb;color:#13233b}*{box-sizing:border-box}main{padding:20px;max-width:1000px;margin:auto}button,input,select,textarea{font:inherit}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true});
      try {
        for(const scenario of ['confirmed','hold','cancel','selection-change','forecast-change','forecast-70','support','within-budget','lost-response','lost-hold-response','availability-conflict','commit-conflict','read-only']) {
          const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
          const unexpected=[];const errors=[];
          await context.route('**/*',route=>{
            if(new URL(route.request().url()).origin===url)return route.continue();
            unexpected.push(route.request().url());return route.abort();
          });
          await context.addInitScript(({project,scenario})=>{
            localStorage.setItem('demac.erp-next.projects.preview.v1',JSON.stringify({version:1,selectedProjectId:project.id,projects:[project]}));
            window.__checks=[];window.__commits=[];window.__holds=[];window.__requests=0;window.__records={};window.__locationReads=[];
            window.__loseResponse=scenario==='lost-response'||scenario==='lost-hold-response';
            window.__support=scenario==='support';
            window.__readOnly=scenario==='read-only';window.__unavailable=scenario==='availability-conflict';window.__failCommit=scenario==='commit-conflict';
          },{project:{...fixture,scheduledFutureHours:['forecast-70','support'].includes(scenario)?64:63},scenario});
          const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
          try {
            await page.goto(url);
            await page.getByRole('button',{name:/^Project Find a Project/i}).click();
            await page.getByRole('button',{name:/PRJ-BROWSER-TEST/}).click();
            await page.getByLabel(/Planned Project slots/i).fill(scenario==='within-budget'?'3':'6');
            if(scenario!=='within-budget') {
              await page.locator('[data-project-budget-warning]').first().waitFor();
              assert.match(await page.locator('[data-project-budget-warning]').first().innerText(),['forecast-70','support'].includes(scenario)?/\+4h/:/\+3h/);
            }
            const confirm=page.getByRole('button',{name:'Confirm appointment',exact:true});
            if(scenario==='availability-conflict') {
              await page.getByText(/no longer has the complete requested capacity/).waitFor();
              assert.equal(await confirm.isDisabled(),true);
            } else if(scenario==='read-only') {
              assert.equal(await confirm.isDisabled(),true);
            } else {
              await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Confirm appointment'&&!button.disabled));
              const isHold=scenario==='hold'||scenario==='lost-hold-response';
              if(isHold)await page.getByRole('button',{name:'Temporary hold',exact:true}).click();else await confirm.click();
              if(scenario!=='within-budget') {
                const decision=page.getByRole('dialog',{name:'La reserva supera el presupuesto estimado',exact:true});
                await decision.waitFor();
                assert.match(await decision.innerText(),['forecast-70','support'].includes(scenario)?/Presupuesto: 66 h · Total previsto: 70 h · Exceso: 4 h/:/Presupuesto: 66 h · Total previsto: 69 h · Exceso: 3 h/);
                assert.equal(await page.evaluate(()=>window.__commits.length+window.__holds.length),0);
                if(['cancel','selection-change'].includes(scenario)) {
                  await decision.getByRole('button',{name:'Cancelar',exact:true}).click();
                  assert.equal(await page.evaluate(()=>window.__commits.length+window.__holds.length),0);
                  if(scenario==='selection-change') {
                    await page.getByLabel(/Planned Project slots/i).fill('5');
                    await confirm.click();await decision.waitFor();
                    assert.match(await decision.innerText(),/Total previsto: 68 h · Exceso: 2 h/);
                  }
                } else if(scenario==='forecast-change') {
                  await page.evaluate(()=>{
                    const key='demac.erp-next.projects.preview.v1';const state=JSON.parse(localStorage.getItem(key));
                    state.projects[0].scheduledFutureHours=64;localStorage.setItem(key,JSON.stringify(state));
                    window.dispatchEvent(new StorageEvent('storage',{key}));
                  });
                  await decision.waitFor({state:'hidden'});
                  await page.waitForFunction(()=>document.querySelector('[data-project-budget-warning]')?.textContent.includes('Projected total: 70'));
                  // Let React retire the old forecast decision before clicking its replacement.
                  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                  assert.equal(await page.evaluate(()=>window.__commits.length),0);
                  await confirm.click();await decision.waitFor();
                  assert.match(await decision.innerText(),/Total previsto: 70 h · Exceso: 4 h/);
                }
                if(scenario!=='cancel') {
                  await page.setViewportSize({width:390,height:844});
                  assert.ok(await decision.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
                  if(scenario==='confirmed')await page.screenshot({path:path.join(artifacts,`${name}-acknowledgement-mobile.png`),fullPage:true});
                  await decision.getByRole('button',{name:'Sí, estoy consciente; continuar',exact:true}).click();
                }
              }
              if(scenario==='commit-conflict') {
                await page.getByText('Synthetic final capacity conflict',{exact:true}).waitFor();
                assert.equal(await page.evaluate(()=>window.__created),undefined);
              } else if(scenario!=='cancel') {
                if(scenario==='lost-response'||scenario==='lost-hold-response') {
                  await page.getByRole('button',{name:'Recuperar reserva original'}).click();
                }
                await page.getByRole('heading',{name:'Synthetic booking result'}).waitFor();
                const data=await page.evaluate(()=>({state:JSON.parse(localStorage.getItem('demac.erp-next.projects.preview.v1')),created:window.__created,checks:window.__checks,commits:window.__commits,holds:window.__holds,records:window.__records}));
                const scheduled=scenario==='within-budget'?66:scenario==='selection-change'?68:['forecast-70','forecast-change','support'].includes(scenario)?70:69;
                assert.equal(data.state.projects[0].estimatedLaborHours,66);
                assert.equal(data.state.projects[0].scheduledFutureHours,scheduled);
                assert.equal(data.state.projects[0].actualLaborHours,0);
                assert.equal(data.state.projects[0].assignments.length,scenario==='support'?2:1);
                assert.equal(data.state.projects[0].assignments.at(-1).laborBudgetAtScheduling.overBudgetHoursAfter,scheduled-66);
                assert.equal(data.created.project.syncStatus,'linked');
                const calls=isHold?data.holds:data.commits;
                assert.equal(calls.length,scenario==='lost-response'||scenario==='lost-hold-response'?2:1);
                if(calls.length===2)assert.deepEqual(calls[0],calls[1]);
                assert.equal(Object.keys(data.records).length,1);
                if(scenario!=='within-budget') {
                  await page.getByText('Recorded allocation warnings ('+(scenario==='support'?2:1)+')',{exact:true}).click();
                  await page.getByText(new RegExp('Project forecast at scheduling: '+scheduled+'h / 66h')).waitFor();
                }
                await page.setViewportSize({width:390,height:844});
                assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
                await page.screenshot({path:path.join(artifacts,`${name}-${scenario}-mobile.png`),fullPage:true});
              }
            }
            if(['cancel','availability-conflict','commit-conflict','read-only'].includes(scenario)) {
              const local=await page.evaluate(()=>JSON.parse(localStorage.getItem('demac.erp-next.projects.preview.v1')).projects[0]);
              assert.equal(local.scheduledFutureHours,63);assert.equal(local.assignments.length,0);
            }
            assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
            const locationReads=await page.evaluate(()=>window.__locationReads);
            assert.ok(locationReads.length>0,'Real location panel must load its canonical property before availability');
            for(const read of locationReads)assert.deepEqual(read,{customerId:'CUSTOMER-BROWSER-TEST',propertyId:'PROPERTY-BROWSER-TEST'});
            console.log(`PASS ${name}: ${scenario}; real drawer, synthetic backend, zero external requests.`);
          } catch(error) {
            console.error('BUDGET_BROWSER_FAILURE',name,scenario,JSON.stringify({errors,text:(await page.locator('body').innerText()).slice(0,9000)}));
            await page.screenshot({path:path.join(artifacts,`${name}-${scenario}-failure.png`),fullPage:true});throw error;
          } finally {await context.close();}
        }
      } finally {await browser.close();}
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));
    const tempRoot=path.resolve(os.tmpdir());const relative=path.relative(tempRoot,path.resolve(output));
    if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.startsWith('demac-budget-browser-'))throw Error('Unsafe test cleanup target');
    fs.rmSync(output,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
