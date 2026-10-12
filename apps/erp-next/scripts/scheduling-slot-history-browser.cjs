// Real board, history loader/projection, notes and dialog; isolated synthetic read boundaries.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.SCHEDULING_TEST_TOOLS, output = process.env.SCHEDULING_TEST_OUTPUT;
if (![tooling, output].every(v => v && path.isAbsolute(v))) throw Error('Absolute isolated tooling/output paths required');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
const retained = require('./scheduling-refresh-browser.cjs');
const stubs = { ...retained.stubs };
delete stubs['use-schedule-history'];
stubs['live-operational-capacity'] += `\nexport function liveVanIsHalfDay(){return false;}`;
stubs['live-scheduling-fast'] += `\nexport async function loadLiveSchedulingReferenceData(){return {clients:[{id:'SYNTHETIC-CUSTOMER',name:'Cliente de ejemplo'}],properties:[{id:'SYNTHETIC-PROPERTY',name:'Propiedad de ejemplo'}],vans:[]};}`;
stubs['shared-projects'] = `export const PROJECTS_CHANGED_EVENT='projects-changed';export async function loadSchedulingProjects(){return [];}export async function loadSharedProjects(){return {projects:[]};}`;
stubs['office-booking-authority'] = `
export async function listOfficeAppointmentAttribution(){return [];}
export function createOfficeLifecycleRequestId(){return 'synthetic-request';}
export async function prepareOfficeAppointmentMove(){throw Error('Write forbidden in history fixture');}
export async function moveOfficeAppointment(){throw Error('Write forbidden in history fixture');}
export async function callOfficeBookingAuthority(action,data,timeout,signal){
 if(action!=='list_schedule_history')throw Error('Unexpected write: '+action);
 window.historyReads.push({action,data});await new Promise(resolve=>setTimeout(resolve,window.historyDelay));
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 if(window.historyDenied)throw Error('permission-denied');
 if(window.historyFail)throw Error('Synthetic history read failed');
 if(window.historyPageFail&&data.cursor)throw Error('Synthetic second page failed');
 const all=structuredClone(window.historyRecords);
 return {appointments:window.historyPaged&&!data.cursor?all.slice(0,1):window.historyPaged?all.slice(1):all,nextCursor:window.historyPaged&&!data.cursor?{phase:'cancellations',checkpoint:'2026-09-23T11:59:00.000Z'}:null,checkpoint:'2026-09-23T11:59:00.000Z'};
}`;
const entry = retained.entry.replace("const root=createRoot", `
window.historyReads=[];window.historyDelay=1000;
const from={dateKey:date,primaryVanId:'VAN-3',primaryStart:'09:30',primaryEnd:'11:30'};
const base={appointmentId:'HISTORY-APT',customerId:'SYNTHETIC-CUSTOMER',propertyId:'SYNTHETIC-PROPERTY',status:'confirmed',date:'2026-09-24',startTime:'08:30',primaryVanId:'VAN-1',workLabel:'Standard Service'};
window.historyRecords=[{...base,events:[{id:'MOVE-1',kind:'customer_reschedule',at:'2026-09-23T13:00:00.000Z',actorName:'Operadora de ejemplo',reason:'Cliente solicitó otra fecha',note:'Confirmado por teléfono',from,to:{...from,dateKey:'2026-09-24',primaryStart:'08:30'}}]},
{...base,appointmentId:'CANCELLED-APT',status:'cancelled',events:[{id:'CANCEL-1',kind:'cancelled',at:'2026-09-23T14:00:00.000Z',actorName:'Operador de ejemplo',reason:'Cliente no disponible',note:'',from:{...from,primaryVanId:'VAN-1',primaryStart:'08:30',primaryEnd:'09:30'},to:null}]},
{...base,appointmentId:'MULTIPLE-APT',events:[{id:'MOVE-2',kind:'operational_move',at:'2026-09-23T15:00:00.000Z',actorName:'Operador de ejemplo',reason:'Cambio de van',note:'',from,to:{...from,primaryVanId:'VAN-2'}}]},
{...base,appointmentId:'AFTERHOURS-APT',events:[{id:'CANCEL-LATE',kind:'cancelled',at:'2026-09-23T15:00:00.000Z',actorName:'Operador de ejemplo',reason:'Emergencia cancelada',note:'',from:{...from,primaryVanId:'VAN-1',primaryStart:'18:00',primaryEnd:'19:00'},to:null}]}];
const root=createRoot`);
async function main() {
 fs.mkdirSync(output,{recursive:true});
 await build({absWorkingDir:APP,tsconfig:path.join(APP,'tsconfig.json'),stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-demac-history'})},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{const key=path.basename(args.path);if(stubs[key])return {path:key,namespace:'synthetic'};});b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:APP}));}}]});
 const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px;font:16px Arial,sans-serif;background:var(--canvas);--brand:#006ba6;--brand-soft:#e8f2fa;--canvas:#f5f7fb;--surface:#fff;--surface-2:#f3f6f9;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--warning:#986300;--success:#148158}*{box-sizing:border-box}</style></head><body><p>VISTA DE PRUEBA · Datos ficticios</p><div id="app"></div><script src="/app.js"></script></body></html>';
 const preview = html.replace('<link rel="stylesheet" href="/app.css">', () => '<style>'+fs.readFileSync(path.join(output,'app.css'),'utf8')+'</style>')
  .replace('<script src="/app.js"></script>', () => '<script>'+fs.readFileSync(path.join(output,'app.js'),'utf8').replaceAll('</script', '<\\/script')+'</script>')
  .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src data:">')
  .replace('VISTA DE PRUEBA · Datos ficticios', 'DEMAC · Vista de prueba con datos ficticios. Pulsa las notas para ver el historial. Book abre un ejemplo; no guarda citas.');
 fs.writeFileSync(path.join(output,'DEMAC-historial-cupos.html'),preview);
 const server=http.createServer((req,res)=>{if(['/app.js','/app.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,req.url.slice(1))));}res.setHeader('Content-Type','text/html');res.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});const results=[];
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();const errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
   await page.clock.install({time:new Date('2026-09-23T12:00:00.000Z')});await page.goto(origin);
   await page.locator('[data-schedule-job]').first().waitFor();
   const metrics=await page.locator('[data-schedule-metrics]').innerText();
   await page.locator('[data-slot-history]').first().waitFor();
   assert.equal(await page.locator('[data-schedule-metrics]').innerText(),metrics,'History must not change occupancy/confirmed counts');
   const van3=page.locator('[data-van-lane]').nth(2);const open=van3.locator('[data-schedule-slot="open"]').first();
   assert.match(await open.innerText(),/Available[\s\S]*Movida de cupo · \+1/);
   const occupied=page.locator('[data-schedule-slot="occupied"]').first();assert.match(await occupied.innerText(),/Synthetic test customer[\s\S]*Cancelada/);
   assert.equal(await page.locator('[data-slot-history]').count(),4,'Two open source slots, one reoccupied block and one after-hours audit');
   if(width===390)await page.getByRole('button',{name:'Show Van 3',exact:true}).click();
   await open.locator('[data-slot-history]').click();
   await page.getByRole('heading',{name:'Lo que ocurrió en este cupo'}).waitFor();
   assert.equal(await page.getByRole('dialog').locator('article').count(),2);
   assert.match(await page.getByRole('dialog').innerText(),/Cliente solicitó otra fecha[\s\S]*Confirmado por teléfono/);
   assert.equal(await page.getByText('Synthetic create boundary; no write').count(),0,'History click must not create a booking');
   await page.screenshot({path:path.join(output,`history-dialog-${width}.png`),fullPage:true});
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
   await open.getByRole('button',{name:'BOOK',exact:true}).click();await page.getByText('Synthetic create boundary; no write').waitFor();
   await page.getByRole('button',{name:'Close fixture'}).click();
   await page.screenshot({path:path.join(output,`history-board-${width}.png`),fullPage:true});
   // Delta refresh uses the saved server checkpoint and deduplicates the same events.
   await page.evaluate(()=>{window.historyDelay=0;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>window.historyReads.some(read=>read.data.since));
   await page.waitForTimeout(100);assert.equal(await page.locator('[data-slot-history]').count(),4);
   await page.evaluate(()=>{window.historyFail=true;window.dispatchEvent(new Event('focus'));});await page.getByRole('button',{name:'Reintentar historial'}).waitFor();
   assert.equal(await page.locator('[data-schedule-metrics]').innerText(),metrics);assert.equal(await open.getByRole('button',{name:'BOOK',exact:true}).isEnabled(),true);
   await page.evaluate(()=>{window.historyFail=false;window.historyPaged=true;window.historyPageFail=true;});
   await page.getByRole('button',{name:'Reintentar historial'}).click();await page.getByText(/No se pudo completar el historial/).waitFor();
   const failedSince=await page.evaluate(()=>window.historyReads.at(-1).data.since);assert.equal(failedSince,'');
   await page.evaluate(()=>window.historyPageFail=false);await page.getByRole('button',{name:'Reintentar historial'}).click();
   await page.getByText('Historial de cancelaciones y cambios disponible · las notas no ocupan cupos.').waitFor();assert.equal(await page.locator('[data-slot-history]').count(),4);
   await page.evaluate(()=>{window.historyDenied=true;window.dispatchEvent(new Event('focus'));});await page.getByText('Scheduling access is unavailable.').waitFor();
   assert.equal(await page.locator('[data-slot-history]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   results.push({width,result:'PASS',checks:['free slots','reused slots','multiple events','after hours','modal/keyboard','Book handoff','occupancy parity','delta/dedupe','partial failure/retry','revoked session'],externalRequests:0});await context.close();
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
