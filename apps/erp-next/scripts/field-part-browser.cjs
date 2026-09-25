'use strict';
// Actual client adapter + component + backend commands over loopback HTTP.
// Deterministic DB/auth fixture, not Firebase Emulator, hosted preview or physical-device proof.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const tools=process.env.FIELD_PORTAL_TEST_TOOLS;
if(!tools)throw Error('Expected isolated FIELD_PORTAL_TEST_TOOLS.');
const {chromium,webkit}=require(path.join(tools,'node_modules/playwright'));
const esbuild=require(path.join(tools,'node_modules/esbuild'));
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
const {fixture,lead,helper,office,outsider}=require(path.join(repo,'functions/test-support/fieldProcedureFixture.cjs'));
const {createFieldOperationsApi}=require(path.join(repo,'functions/fieldOperationsAuthority'));
const out=path.resolve(process.env.FIELD_PART_EVIDENCE||path.join(app,'.field-part-browser'));
fs.mkdirSync(out,{recursive:true});
const define={ 'process.env.NEXT_PUBLIC_ISOLATED_PREVIEW':'"true"' };
for(const [key,value] of Object.entries({PROJECT_ID:'demo-demac-dwellings',API_KEY:'synthetic',AUTH_DOMAIN:'demo-demac-dwellings.invalid',STORAGE_BUCKET:'demo-demac-dwellings.appspot.com',MESSAGING_SENDER_ID:'0',APP_ID:'synthetic',MEASUREMENT_ID:''}))define['process.env.NEXT_PUBLIC_FIREBASE_'+key]=JSON.stringify(value);
const compiled=esbuild.buildSync({entryPoints:[path.join(__dirname,'field-part-browser.fixture.tsx')],bundle:true,write:false,outfile:path.join(out,'fixture.js'),jsx:'automatic',tsconfig:path.join(app,'tsconfig.json'),nodePaths:[path.join(tools,'node_modules')],external:['/images/*'],define});
const js=compiled.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=compiled.outputFiles.find(f=>f.path.endsWith('.css')).contents;
// A browser has no Node process global. Fail before navigation if a new public
// Firebase setting was not explicitly replaced in this synthetic-only bundle.
assert.equal(/\bprocess\.env\.NEXT_PUBLIC_FIREBASE_/.test(Buffer.from(js).toString('utf8')),false,'Unresolved Firebase setting in browser fixture');
// Exercise the defensive projection against real backend response shapes too.
const cjs=esbuild.buildSync({entryPoints:[path.join(app,'lib/field-procedure-contract.ts')],bundle:true,write:false,platform:'node',format:'cjs',tsconfig:path.join(app,'tsconfig.json')}).outputFiles[0].text;
const mod={exports:{}};new Function('module','exports','require',cjs)(mod,mod.exports,require);
const {parseFieldProcedureSummary}=mod.exports;
let state,api,calls=[],fault=null;
function reset(){state=fixture();for(const who of [lead,helper,office,outsider])state.store.put('users',{id:who.uid,active:true,role:who.role,staffId:who.staffId,name:who.name});api=createFieldOperationsApi({db:state.store.db,verifyIdToken:async t=>({uid:t}),procedureCommands:state.commands});calls=[];fault=null;}
const html='<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f3f8ff;font-family:Arial,sans-serif}button,textarea{font:inherit}[role=note]{padding:12px;font-size:12px;color:#38465a}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
function send(res,status,body,type='application/json'){if(res.destroyed)return;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);}
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/')return send(res,200,html,'text/html');
  if(url.pathname==='/fixture.js')return send(res,200,js,'application/javascript');
  if(url.pathname==='/fixture.css')return send(res,200,css,'text/css');
  if(url.pathname==='/images/field/tropical-reference.webp')return send(res,200,fs.readFileSync(path.join(app,'public',url.pathname)),'image/webp');
  if(url.pathname==='/favicon.ico')return send(res,204,'','text/plain');
  if(url.pathname!=='/__preview/firebase/us-central1-demo-demac-dwellings.cloudfunctions.net/fieldOperationsAuthority')return send(res,404,{error:'Unexpected test route'});
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw),uid=String(req.headers.authorization||'').replace('Bearer ','');
  calls.push({uid,action:body.action,data:body.data});
  let injected=null;if(fault&&(!fault.uid||fault.uid===uid)&&(!fault.action||fault.action===body.action)){injected=fault;fault=null;}
  if(injected?.status&&!injected.afterCommit)return send(res,injected.status,{error:{code:'injected_test_failure',message:'Fallo sintético de prueba'}});
  const r=await api.handle({method:req.method,headers:req.headers,body});
  if(injected?.hold)await injected.hold;
  if(injected?.status)return send(res,injected.status,{error:{code:'injected_lost_response',message:'Respuesta perdida de prueba'}});
  if(injected?.corrupt)injected.corrupt(r.body);
  return send(res,r.status,r.body);
 }catch(e){send(res,500,{error:{code:'fixture_failure',message:String(e.message)}});}
});
const writes=()=>calls.filter(c=>c.action==='record_procedure_action');
async function loaded(page){await page.getByRole('button',{name:/Evaporadora · Indoor/}).waitFor();await page.getByRole('button',{name:'Actualizar',exact:true}).waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Confirmando asignación')));}
async function refresh(page){await page.getByRole('button',{name:'Actualizar',exact:true}).click();await loaded(page);}
async function choose(page,part='indoor'){await page.getByRole('button',{name:part==='indoor'?/Evaporadora · Indoor/:/Condensadora · Outdoor/}).click();}
(async()=>{
 reset();const raw=await state.read(),target={ownerUserId:lead.uid,visitId:'VISIT-1',interventionId:'WI-1',assetId:'AC-1'};
 assert.deepEqual(parseFieldProcedureSummary(raw,target).parts.map(p=>p.total),[14,9]);
 for(const change of [r=>r.assetId='other',r=>r.visitId='other',r=>r.interventionId='other',r=>r.version=2,r=>r.workflow.protocol.version=2,r=>r.workflow.parts.indoor.version=-1,r=>r.workflow.parts.indoor.steps.I01.status='completed',r=>r.workflow.protocol.parts.indoor.steps.pop(),r=>r.allowedActions.push('admin'),r=>r.workflow.parts.indoor.ownerStaffId='someone']){const changed=structuredClone(raw);change(changed);assert.throws(()=>parseFieldProcedureSummary(changed,target));}
 assert.throws(()=>parseFieldProcedureSummary(raw,{...target,ownerUserId:undefined}));
 assert.equal(parseFieldProcedureSummary({...raw,workflow:null},target).revision,null);
 console.log('PASS defensive exact-context, versioned 14/9 projection and no implicit protocol');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const reports=[];
 try {
  for(const browserName of (process.env.FIELD_PART_BROWSERS||'chromium').split(',')){
   const type=browserName==='webkit'?webkit:chromium;
   const launchOptions={headless:true,...(browserName==='chromium'&&process.env.FIELD_PORTAL_BROWSER_EXECUTABLE?{executablePath:process.env.FIELD_PORTAL_BROWSER_EXECUTABLE}:{}),args:browserName==='chromium'?['--no-sandbox']:[]};
   const browser=await type.launch(launchOptions);let companion;
   try {
    // Two devices, not two tabs competing for foreground visibility. Keep the
    // real hidden-tab/session protections; never force-click a disabled claim.
    companion=await type.launch(launchOptions);
    for(const [label,width,height] of [['mobile-360',360,800],['mobile-390',390,844],['desktop',1365,1000]]){
     reset();const errors=[],outside=[],context=await browser.newContext({viewport:{width,height}});
     const otherContext=await companion.newContext({viewport:{width,height}});
     for(const device of [context,otherContext])await device.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){outside.push(route.request().url());return route.abort();}return route.continue();});
     const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await loaded(page);
     assert.equal(writes().length,0);assert.equal(await page.locator('[aria-pressed=true]').count(),0);
     await choose(page);assert.equal(writes().length,0,'select is not claim');
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
     assert.equal(await page.getByRole('button',{name:/Evaporadora · Indoor/}).evaluate(el=>el.getBoundingClientRect().height>=44),true);
     await page.screenshot({path:path.join(out,`04-partes-${browserName}-${label}.png`),fullPage:true});
     const other=await otherContext.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(origin+'/?actor=test-helper');await loaded(other);await choose(other);
     for(const [actor,devicePage] of [[lead.uid,page],[helper.uid,other]]){
      const state=await devicePage.evaluate(()=>({visibility:document.visibilityState,online:navigator.onLine,status:[...document.querySelectorAll('[role=status],[role=alert]')].map(e=>e.textContent)}));
      const enabled=await devicePage.getByRole('button',{name:'Tomar evaporadora',exact:true}).isEnabled();
      assert.equal(state.visibility,'visible',`${actor} must have its own visible device: ${JSON.stringify(state)}`);
      assert.equal(state.online,true,`${actor} fixture must be online`);
      assert.equal(enabled,true,`${actor} has not received current claim authority: ${JSON.stringify(state)}`);
     }
     const claims=[page,other].map(p=>p.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.action==='record_procedure_action'));
     await Promise.all([page.getByRole('button',{name:'Tomar evaporadora',exact:true}).click(),other.getByRole('button',{name:'Tomar evaporadora',exact:true}).click()]);
     await Promise.all(claims);
     await Promise.all([page,other].map(p=>p.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='Confirmando…'))));
     const owner=state.store.get('workInterventions','WI-1').procedureWorkflow.parts.indoor.ownerUserId;
     assert.ok([lead.uid,helper.uid].includes(owner));assert.equal(state.store.all('fieldOperationEvents').filter(e=>e.type==='procedure_claim_part').length,1,'one claim event');
     await refresh(page);await refresh(other);
     const winner=owner===lead.uid?page:other,loser=owner===lead.uid?other:page;
     await choose(loser);assert.equal(await loser.getByRole('button',{name:/^Asignada a /}).isDisabled(),true);
     await choose(loser,'outdoor');await loser.getByRole('button',{name:'Tomar condensadora',exact:true}).click();await loser.getByText('Tu parte está identificada.',{exact:true}).waitFor();
     let w=state.store.get('workInterventions','WI-1').procedureWorkflow;assert.notEqual(w.parts.indoor.ownerUserId,w.parts.outdoor.ownerUserId);
     // Open the actual procedure workspace through the existing selector. Verify the 14-step
     // list, single anomaly entry point, per-step evidence controls, and that opening is read-only.
     const writesBeforeWorkspace=writes().length;
     await choose(winner);await winner.getByRole('button',{name:'Abrir procedimientos',exact:true}).click();
     await winner.getByRole('heading',{name:'Procedimientos del servicio',exact:true}).waitFor();
     assert.equal(await winner.getByRole('button',{name:/Vista amplia inicial/}).count(),1);
     assert.equal(await winner.getByRole('button',{name:'Reportar anomalía',exact:true}).count(),1,'single anomaly entry on procedure list');
     assert.equal(writes().length,writesBeforeWorkspace,'opening workspace cannot mutate procedure state');
     await winner.getByRole('button',{name:/Vista amplia inicial/}).click();
     await winner.getByRole('heading',{name:'Evidencia por procedimiento',exact:true}).waitFor();
     assert.equal(await winner.getByRole('button',{name:'Reportar anomalía',exact:true}).count(),0,'anomaly entry is not repeated in step detail');
     assert.equal(await winner.getByLabel('Tomar Foto: ANTES').count(),1,'required photo control is tied to the procedure view');
     await winner.getByRole('button',{name:'Volver a procedimientos',exact:true}).click();
     await winner.getByRole('button',{name:'Volver a seleccionar parte',exact:true}).click();
     await winner.getByText('Tu parte está identificada.',{exact:true}).waitFor();
     await winner.getByText('Liberar mi parte',{exact:true}).click();await winner.getByLabel('Motivo de la transferencia').fill('Transferencia sintética registrada');await winner.getByRole('button',{name:'Liberar sin borrar el historial',exact:true}).click();await winner.getByText('Parte liberada. La contribución anterior permanece en el historial.',{exact:true}).waitFor();
     assert.equal(state.store.get('workInterventions','WI-1').procedureWorkflow.parts.indoor.ownerUserId,null);
     // Lose the response after the server commit; explicit retry MUST retain request and body.
     fault={uid:owner,action:'record_procedure_action',status:503,afterCommit:true};
     await winner.getByRole('button',{name:'Tomar evaporadora',exact:true}).click();await winner.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).waitFor();
     const lost=structuredClone(writes().at(-1));const eventCount=state.store.all('fieldOperationEvents').length;
     await winner.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await winner.getByText('Tu parte está identificada.',{exact:true}).waitFor();
     assert.deepEqual(writes().at(-1),lost);assert.equal(state.store.all('fieldOperationEvents').length,eventCount);
     fault={action:'get_procedure_workspace',uid:owner,status:503};await refresh(winner);assert.equal(await winner.getByRole('button',{name:/Evaporadora · Indoor/}).count(),1);await winner.getByText(/Coordinación sin confirmar/).waitFor();
     await winner.getByText('Liberar mi parte',{exact:true}).click();
     assert.equal(await winner.getByRole('button',{name:'Liberar sin borrar el historial',exact:true}).isDisabled(),true);
     await refresh(winner);
     // A response arriving after disconnection/reconnection cannot claim fresh coordination.
     let resume;const interrupted=new Promise(r=>resume=r);fault={uid:owner,action:'record_procedure_action',hold:interrupted};
     await winner.getByLabel('Motivo de la transferencia').fill('Transferencia durante interrupción sintética');
     const interruptedRequest=winner.waitForRequest(r=>r.method()==='POST');
     await winner.getByRole('button',{name:'Liberar sin borrar el historial',exact:true}).click();await interruptedRequest;
     await winner.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});resume();
     await winner.getByText('Parte liberada. La contribución anterior permanece en el historial.',{exact:true}).waitFor();
     await winner.getByText(/Coordinación sin confirmar/).waitFor();
     assert.equal(await winner.getByRole('button',{name:'Tomar evaporadora',exact:true}).isDisabled(),true);
     await refresh(winner);
     // Delayed response must not restore old context or undo a subsequent revocation/account change.
     let release;const hold=new Promise(r=>release=r);fault={action:'get_procedure_workspace',uid:owner,hold};
     const delayed=winner.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.action==='get_procedure_workspace'&&r.request().headers().authorization==='Bearer '+owner);
     const request=winner.waitForRequest(r=>r.method()==='POST');await winner.getByRole('button',{name:'Actualizar',exact:true}).click();await request;
     await winner.evaluate(()=>window.changePartActor('test-other'));await winner.getByRole('alert').waitFor();release();await delayed;
     await winner.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await winner.getByRole('button',{name:/Evaporadora · Indoor/}).count(),0,'new account never inherits old response');
     await winner.evaluate(()=>window.changePartActor('test-tech'));await loaded(winner);
     fault={action:'get_procedure_workspace',uid:lead.uid,corrupt:r=>r.assetId='FOREIGN-ASSET'};
     await winner.getByRole('button',{name:'Actualizar',exact:true}).click();await winner.getByText(/Respuesta de procedimientos inválida/).waitFor();assert.equal(await winner.getByRole('button',{name:/Evaporadora · Indoor/}).count(),0);
     await refresh(winner);state.revoked.add(lead.uid);await winner.getByRole('button',{name:'Actualizar',exact:true}).click();await winner.getByRole('alert').waitFor();assert.equal(await winner.getByRole('button',{name:/Evaporadora · Indoor/}).count(),0);
     assert.equal(state.store.all('workVisits').length,1);assert.equal(state.store.all('workInterventions').length,1);assert.equal(state.store.get('workInterventions','WI-1').status,'in_progress');
     for(const collection of ['fieldEvidence','invoices','stockMovements','whatsappOutboundQueue','fieldOfficeReviews'])assert.equal(state.store.all(collection).length,0);
     assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
     reports.push({browser:browserName,viewport:{width,height},passed:true,checks:['two separate visible browser devices','no implicit claim','two-user contention','other part','release with reason','exact lost-response retry','stale read locked','late write after interruption remains unconfirmed','late account response rejected','foreign context rejected','revocation','no duplicate visit/intervention','no business/media/communication effects','touch targets','no overflow','no external requests','no page errors','actual procedure workspace 14/9 entry','single anomaly entry','per-step photo controls']});
     console.log(`PASS shared parts ${browserName} ${label}`);await Promise.all([context.close(),otherContext.close()]);
    }
   }finally{await Promise.all([browser.close(),companion?.close()]);}
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({sourceHead:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),synthetic:true,backend:'loopback HTTP with deterministic database/auth fixtures',notClaimed:['hosted-preview','real-Firebase-auth','Firestore-emulator','physical-devices','procedure-media-capture-UI'],reports},null,2));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
