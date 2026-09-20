'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {createCommittedResponseFault,interruptResponse}=require('./projects-central-response-fault.cjs');
const {verifyNavigationEvidence,verifyBrowserErrorControls}=require('./projects-navigation-diagnostics.cjs');
const {indexStaticAssets}=require('./projects-central-static-assets.cjs');
const ROOT=path.resolve(__dirname,'../../..');const PROJECT='demo-demac-projects';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error('Only loopback emulators are allowed.');
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Demo-only browser test; production credentials forbidden.');
const fromFunctions=require('node:module').createRequire(path.join(ROOT,'functions/package.json'));
const {initializeApp,deleteApp}=fromFunctions('firebase-admin/app');const {getFirestore}=fromFunctions('firebase-admin/firestore');const {getAuth}=fromFunctions('firebase-admin/auth');
const {createProjectRegistryService}=require(path.join(ROOT,'functions/projects/registry-service'));
const {createProjectRegistryHttp}=require(path.join(ROOT,'functions/projects/registry-http'));
const {captureLocalBackup,STORAGE_KEYS}=require(path.join(ROOT,'functions/projects/recovery'));
const {chromium,webkit}=require(path.join(process.env.PROJECTS_UI_TOOLS,'node_modules/playwright'));
const app=initializeApp({projectId:PROJECT},'projects-central-browser');const db=getFirestore(app),auth=getAuth(app);
const service=createProjectRegistryService({db,verifyIdToken:(token,revoked)=>auth.verifyIdToken(token,revoked),enabled:true,allowLegacyImport:true});
const OUT=path.join(ROOT,'apps/erp-next/out');const ART=path.join(ROOT,'projects-central-ui-evidence');fs.mkdirSync(ART,{recursive:true});
const staticAssets=indexStaticAssets(OUT,fs);
const protectedCollections=['clients','properties','appointments','workOrders','workVisits','bookingCapacityLocks','whatsappOutboundQueue','warehouseInventory'];
let sequence=0;const actors={};let origin='';let handler;let previewRequests=0;
const responseFault=createCommittedResponseFault();const recoveryEvidence=[];
const CUSTOMER='UI-CUSTOMER',PROPERTY='UI-PROPERTY';
// Native loopback HTTP for both app assets and the isolated backend proxy. No Playwright
// network interception: its WebKit implementation intercepts all URLs when any route exists.
// This is not a test of deployed cross-origin TLS/CORS; registry HTTP CORS contracts are
// tested separately. No production URL is forwarded from this server.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; worker-src 'none'; frame-src 'none'; object-src 'none'";
const server=http.createServer(async(request,response)=>{
  const requested=new URL(request.url,'http://local');
  if(requested.pathname==='/__projects-test-external') {
    try {
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>128*1024){response.writeHead(413).end();return;}chunks.push(chunk);}
      const result=await externalResponse(new URL(requested.searchParams.get('target')),request,Buffer.concat(chunks).toString('utf8'));
      if(result.connectionLost){interruptResponse(response);return;}
      response.writeHead(result.status,result.headers);response.end(result.body??'');
    }catch(error){response.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({success:false,error:{code:'test_transport_error',message:String(error.message),outcome:'unknown'}}));}
    return;
  }
  let pathname;
  try{pathname=decodeURIComponent(requested.pathname);}catch{response.writeHead(400).end();return;}
  let file=staticAssets.get(pathname)||path.resolve(OUT,`.${pathname}`);
  if(!file.startsWith(OUT+path.sep)){response.writeHead(403).end();return;}
  try{
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    response.setHeader('Content-Security-Policy',CSP);
    response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.txt')?'text/plain':'application/octet-stream');
    response.end(fs.readFileSync(file));
  }catch{response.writeHead(404).end();}
});
function field(value){if(value===null)return{nullValue:null};if(typeof value==='boolean')return{booleanValue:value};if(typeof value==='number')return{integerValue:String(value)};if(typeof value==='string')return{stringValue:value};return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,v])=>[key,field(v)]))}};}
function document(id,data){return{name:`projects/${PROJECT}/databases/(default)/documents/${id}`,fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,field(value)]))};}
async function api(action,data,who='admin'){return service.execute({idToken:actors[who].idToken,command:{action,data,requestId:`UI-REQUEST-${++sequence}`}});}
async function snapshotProtected(){const output={};for(const collection of protectedCollections){const values=await db.collection(collection).get();output[collection]=values.docs.map(doc=>[doc.id,doc.data()]).sort((a,b)=>a[0].localeCompare(b[0]));}return output;}
async function externalResponse(url,request,rawBody) {
  assert.equal(url.protocol,'https:','Only expected HTTPS service URLs are mocked');
  const headers={'content-type':'application/json'};
  const json=(body,status=200)=>({status,headers,body:JSON.stringify(body)});
  const body=rawBody?JSON.parse(rawBody):null;
  if(url.hostname.endsWith('.cloudfunctions.net')&&url.pathname==='/projectsRegistry') {
    if(body?.action==='preview_legacy_import')previewRequests++;
    const result=await handler({method:request.method,headers:{...request.headers,origin},body});
    if(responseFault.observe(body,result))return{connectionLost:true};
    return{status:result.status,headers:result.headers,body:result.body===null?'':JSON.stringify(result.body)};
  }
  if(url.hostname==='firestore.googleapis.com') {
    assert.ok(request.method==='GET'||(request.method==='POST'&&url.pathname.endsWith(':runQuery')),'No direct Firestore writes are allowed from the browser test');
    const userId=/\/users\/([^/]+)$/.exec(url.pathname)?.[1];
    if(userId) {
      const who=Object.keys(actors).find(name=>actors[name].localId===userId);
      assert.ok(who,'Only the synthetic provisioned test users may be read');
      return json(document(`users/${userId}`,{role:who==='admin'?'admin':who==='finance'?'finance':'operations',active:true,name:`Synthetic ${who}`}));
    }
    const clients=[document(`clients/${CUSTOMER}`,{name:'Synthetic CRM customer',active:true})];
    const properties=[document(`properties/${PROPERTY}`,{name:'Synthetic CRM property',clientId:CUSTOMER,address:'Synthetic site',active:true})];
    if(url.pathname.endsWith('/clients'))return json({documents:clients});
    if(url.pathname.endsWith('/properties'))return json({documents:properties});
    if(url.pathname.endsWith(':runQuery')){const collection=body?.structuredQuery?.from?.[0]?.collectionId;const docs=collection==='clients'?clients:collection==='properties'?properties:[];return json(docs.map(document=>({document})));}
    return json({documents:[]});
  }
  if(url.hostname.endsWith('.cloudfunctions.net'))return json({error:{code:'test_isolated',message:'No external operational functions in this test'}},503);
  throw Error('Unmocked external service; no request forwarded.');
}
async function verifyPlanningBudgets(page, projectId, engineName) {
  const read = async () => (await api('get_plan', { projectId })).project;
  const original = await read();
  assert.equal(original.details.materialBudget, null, 'Blank optional material budget remains unknown');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  let edit = page.getByRole('dialog', { name: 'Edit project plan' });
  await edit.getByLabel('Material budget (optional)', { exact: true }).fill('1200.35');
  await edit.getByRole('button', { name: 'Save project', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.deepEqual((await read()).details.materialBudget, { currency: 'AWG', amountMinor: 120035 });
  await page.getByText(/Material budget: AWG/).waitFor();

  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  edit = page.getByRole('dialog', { name: 'Edit project plan' });
  await edit.getByLabel('Project type', { exact: true }).selectOption('Service Project');
  assert.equal(await edit.getByLabel('Material budget (optional)', { exact: true }).count(), 0);
  await edit.getByRole('button', { name: 'Save project', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.deepEqual((await read()).details.materialBudget, { currency: 'AWG', amountMinor: 120035 }, 'Hiding Service budget must preserve historical data');
  await page.getByText('Service Project · Planned', { exact: true }).waitFor();
  assert.equal(await page.getByText(/Material budget:/).count(), 0);
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  edit = page.getByRole('dialog', { name: 'Edit project plan' });
  await edit.getByLabel('Project type', { exact: true }).selectOption('VRF Project');
  await edit.getByLabel('Material budget (optional)', { exact: true }).fill('');
  await edit.getByRole('button', { name: 'Save project', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.equal((await read()).details.materialBudget, null);
  assert.deepEqual((await read()).budget, original.budget);

  await page.getByRole('button', { name: 'Revise estimate', exact: true }).click();
  let revision = page.getByRole('dialog', { name: 'Revise project estimate' });
  await revision.getByLabel('Revised Van hours', { exact: true }).fill('70');
  await revision.getByLabel('Additional minutes', { exact: true }).fill('15');
  await revision.getByLabel('Reason for estimate revision', { exact: true }).fill('Reviewed synthetic scope adjustment');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Revision dialog fits mobile');
  await page.screenshot({ path: path.join(ART, `${engineName}-estimate-mobile.png`), fullPage: true });
  const before = await read();
  responseFault.arm(projectId, 'revise_estimate');
  await revision.getByRole('button', { name: 'Save estimate revision', exact: true }).click();
  await page.getByText(/An earlier operation needs confirmation/).waitFor();
  assert.deepEqual((await read()).budget, { unit: 'van_minutes', originalMinutes: 3960, currentMinutes: 4215, revision: 2 });
  const pending = responseFault.pendingCommand();
  assert.equal(pending.data.expectedVersion, before.version);
  assert.equal(pending.data.reason, 'Reviewed synthetic scope adjustment');
  await revision.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: true });
  try {
    page.once('dialog', event => event.accept());
    await page.reload();
    await page.getByText(/Project changes are paused/).waitFor();
    const key = `demac.projects.pending.v1:${actors.admin.localId}`;
    assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).command, key), pending);
    assert.equal(await page.getByRole('button', { name: /Create Project/ }).isDisabled(), true);
    responseFault.releaseForExactRetry();
    await page.getByRole('button', { name: 'Retry the exact request', exact: true }).click();
    await page.getByText(/original request recovered/).waitFor();
    assert.equal((await read()).version, before.version + 1);
    assert.equal((await read()).budget.revision, 2);
    assert.equal(await page.getByRole('button', { name: 'Revise estimate', exact: true }).isDisabled(), true);
    recoveryEvidence.push({ browser: engineName, ...responseFault.finish() });
    const events = await db.collection('projectEvents').where('projectId', '==', projectId).get();
    const revisions = events.docs.map(doc => doc.data()).filter(event => event.action === 'revise_estimate');
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].beforeBudget.currentMinutes, 3960);
    assert.equal(revisions[0].afterBudget.currentMinutes, 4215);
    assert.equal(revisions[0].reason, pending.data.reason);
  } finally {
    await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: false });
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Revise estimate' && !b.disabled));
  await page.getByRole('button', { name: 'Revise estimate', exact: true }).click();
  revision = page.getByRole('dialog', { name: 'Revise project estimate' });
  await revision.getByLabel('Revised Van hours', { exact: true }).fill('71');
  await revision.getByLabel('Reason for estimate revision', { exact: true }).fill('Stale revision must fail');
  const current = await read();
  await api('edit_metadata', { projectId, expectedVersion: current.version, patch: { description: 'Second operator budget review' } }, 'operations');
  await revision.getByRole('button', { name: 'Save estimate revision', exact: true }).click();
  await revision.getByRole('alert').filter({ hasText: /Another operator changed/ }).waitFor();
  assert.equal((await read()).budget.currentMinutes, 4215);
  await revision.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Second operator budget review', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1600, height: 1050 });
}
async function contextFor(browser,who='admin') {
  const context=await browser.newContext({viewport:{width:1600,height:1050},serviceWorkers:'block'});
  const actor=actors[who];
  await context.addInitScript(session=>{
    sessionStorage.setItem('demac.erp-next.firebase.session.v1',JSON.stringify(session));
    // Observe without preventing events, catching promises or altering cancellation.
    // Only synthetic test URLs are recorded; never request bodies or authorization.
    const documentId=crypto.randomUUID();
    let lifecycle='active';
    let ordinal=0;
    const emit=(kind,data={})=>console.debug('__DEMAC_NAV__'+JSON.stringify({
      kind,documentId,lifecycle,ordinal:++ordinal,time:performance.timeOrigin+performance.now(),...data,
    }));
    emit('document-start');
    addEventListener('beforeunload',()=>{lifecycle='beforeunload';emit('beforeunload');});
    addEventListener('pagehide',event=>{lifecycle='pagehide';emit('pagehide',{persisted:event.persisted});});
    addEventListener('pageshow',event=>{lifecycle='active';emit('pageshow',{persisted:event.persisted});});
    addEventListener('error',event=>emit('dom-error',{
      message:String(event.message||'Resource error'),filename:event.filename||'',
      stack:String(event.error?.stack||''),resource:event.target instanceof Element?event.target.tagName:null,
    }),true);
    addEventListener('unhandledrejection',event=>emit('dom-unhandledrejection',{
      message:String(event.reason?.message||event.reason),stack:String(event.reason?.stack||''),
    }));
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const target=new URL(input instanceof Request?input.url:String(input),location.href);
      if(target.origin===location.origin){
        // Keep active-page timing close to the uninstrumented run. Raw errors and
        // all DOM exceptions are always retained by their independent listeners.
        if(lifecycle!=='active'){
          const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
          emit('same-origin-fetch',{
            url:target.href,method:init?.method||(input instanceof Request?input.method:'GET'),
            rsc:headers.get('rsc'),prefetch:headers.get('next-router-prefetch'),
            segment:headers.get('next-router-segment-prefetch'),
          });
        }
        return nativeFetch(input,init);
      }
      const request=new Request(input,init);
      if(request.signal.aborted)throw new DOMException('The request was aborted.','AbortError');
      const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
      // Preserve payload bytes, token header and cancellation while using real native fetch.
      // CSP independently prevents any unmocked network path from reaching production.
      return nativeFetch('/__projects-test-external?target='+encodeURIComponent(target.href),{
        method:request.method,headers:request.headers,body,signal:request.signal,
        credentials:'omit',cache:'no-store',redirect:'error',
      });
    };
  },{uid:actor.localId,email:`ui-${who}@example.test`,idToken:actor.idToken,refreshToken:'NEVER-USE',expiresAt:Date.now()+3600000});
  return context;
}
async function main(){
 for(const [who,role]of[['admin','admin'],['operations','operations'],['finance','finance']]){const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`projects-ui-${who}@example.test`,password:'synthetic-ui-test-password',returnSecureToken:true})});actors[who]=await response.json();assert.ok(actors[who].idToken);await db.collection('users').doc(actors[who].localId).set({role,active:true});}
 await db.collection('businessSettings').doc('projects-registry').set({backendEnabled:true,legacyImportEnabled:true});await db.collection('clients').doc(CUSTOMER).set({name:'Synthetic CRM customer',active:true});await db.collection('properties').doc(PROPERTY).set({clientId:CUSTOMER,name:'Synthetic CRM property',active:true});
 await db.collection('appointments').doc('UI-EXISTING-APT').set({customerId:CUSTOMER,propertyId:PROPERTY,status:'confirmed',workOrderIds:['UI-WO','UI-WO-SUPPORT']});
 for(const [id,van,minutes]of[['UI-WO','VAN-A',360],['UI-WO-SUPPORT','VAN-B',120]])await db.collection('workOrders').doc(id).set({appointmentId:'UI-EXISTING-APT',clientId:CUSTOMER,propertyId:PROPERTY,status:'Confirmada',vanId:van,date:'2026-09-18',time:'08:30',appointmentDurationMinutes:minutes,scheduledSlots:minutes/60});
 await db.collection('workVisits').doc('UI-VISIT').set({id:'UI-VISIT',workOrderId:'UI-WO',appointmentId:'UI-EXISTING-APT',clientId:CUSTOMER,propertyId:PROPERTY,status:'in_progress',startedAt:'2026-09-18T13:00:00.000Z',version:1});
 for(const collection of protectedCollections)await db.collection(collection).doc('UI-PROTECTED').set({protected:true,collection});const before=await snapshotProtected();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;handler=createProjectRegistryHttp({service,allowedOrigins:[origin]});
 for(const [engineName,engine]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});const context=await contextFor(browser);const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];const network=[];const externalNetwork=[];let stage='load';
  page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin)externalNetwork.push(url.origin);});
  page.on('console',event=>{const text=event.text();if(text.startsWith('__DEMAC_NAV__'))network.push({stage,event:'lifecycle',...JSON.parse(text.slice('__DEMAC_NAV__'.length))});});
  page.on('pageerror',error=>{errors.push(error.message);network.push({stage,event:'pageerror',message:error.message,stack:error.stack});});
  page.on('requestfailed',request=>{const url=new URL(request.url());network.push({stage,event:'requestfailed',path:url.origin===origin?url.pathname:url.origin,reason:request.failure()?.errorText});});
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&url.pathname.includes('__next.'))network.push({stage,event:'rsc-response',path:url.pathname,status:response.status()});});
  try{
    const controls=await verifyBrowserErrorControls(browser,origin,engineName);
    fs.writeFileSync(path.join(ART,`${engineName}-exception-controls.json`),JSON.stringify(controls,null,2));
    const name=`Synthetic shared ${engineName}`;await page.goto(origin+'/projects/central/');await page.getByRole('button',{name:/Create Project/}).waitFor();
    stage='create';await page.getByRole('button',{name:/Create Project/}).click();const dialog=page.getByRole('dialog',{name:'Create shared project'});
    await dialog.getByRole('button',{name:'Synthetic CRM customer',exact:true}).click();await dialog.getByLabel('Service property',{exact:true}).selectOption(PROPERTY);
    await dialog.getByLabel('Project name',{exact:true}).fill(name);await dialog.getByLabel('Start date',{exact:true}).fill('2026-09-01');await dialog.getByLabel('Estimated completion',{exact:true}).fill('2026-10-01');await dialog.getByLabel('Estimated Van hours',{exact:true}).fill('66');await dialog.getByLabel('Technician instructions',{exact:true}).fill('Synthetic instructions preserved');await dialog.getByRole('button',{name:'Save project',exact:true}).click();
    await page.getByRole('heading',{name,exact:true}).waitFor();const created=(await api('list_plans',{limit:50})).projects.find(project=>project.name===name);assert.ok(created);
    stage='phase';await page.getByRole('tab',{name:'Plan & phases',exact:true}).click();await page.getByRole('button',{name:'Add phase',exact:true}).click();const phase=page.getByRole('dialog',{name:'Add custom phase'});await phase.getByLabel('Phase name',{exact:true}).fill('Install and test');await phase.getByLabel('Estimated Van hours',{exact:true}).fill('4');await phase.getByLabel('Scope of work',{exact:true}).fill('Synthetic scope');await phase.getByLabel('Completion criteria',{exact:true}).fill('Review the verified installation');await phase.getByRole('button',{name:'Save phase',exact:true}).click();await phase.waitFor({state:'hidden'});
    assert.equal((await api('get_plan',{projectId:created.id})).project.phases.length,1);
    stage='planning budgets and exact revision recovery';await verifyPlanningBudgets(page,created.id,engineName);
    if(engineName==='chromium'){
      stage='associate existing';await page.getByRole('tab',{name:'Scheduling activity',exact:true}).click();await page.getByRole('button',{name:'Associate existing appointment',exact:true}).click();const assoc=page.getByRole('dialog',{name:'Associate existing appointment'});await assoc.getByLabel('Canonical appointment ID',{exact:true}).fill('UI-EXISTING-APT');await assoc.getByLabel('Reason for this association',{exact:true}).fill('Verified synthetic link');await assoc.getByRole('checkbox').check();await assoc.getByRole('button',{name:'Save reviewed association',exact:true}).click();await assoc.waitFor({state:'hidden'});await page.getByRole('tab',{name:'Scheduling activity',exact:true}).click();await page.getByText(/UI-WO-SUPPORT/).waitFor();await page.getByText(/UI-VISIT/).waitFor();await page.screenshot({path:path.join(ART,'central-activity.png'),fullPage:true});
    }
    stage='conflicting operator';await page.getByRole('button',{name:'Edit plan',exact:true}).click();const edit=page.getByRole('dialog',{name:'Edit project plan'});await edit.getByLabel('Project name',{exact:true}).fill('Stale browser edit');const current=(await api('get_plan',{projectId:created.id})).project;await api('edit_metadata',{projectId:created.id,expectedVersion:current.version,patch:{description:'Second operator revision'}},'operations');await edit.getByRole('button',{name:'Save project',exact:true}).click();await edit.getByText(/Another operator changed/).waitFor();assert.equal((await api('get_plan',{projectId:created.id})).project.name,name);await edit.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByText('Second operator revision',{exact:true}).waitFor();
    stage='lost response and reload';
    await page.getByRole('button',{name:'Edit plan',exact:true}).click();
    const lost=page.getByRole('dialog',{name:'Edit project plan'});
    await lost.getByLabel('Scope / description',{exact:true}).fill('Saved once despite lost response');
    responseFault.arm(created.id);
    await lost.getByRole('button',{name:'Save project',exact:true}).click();
    await page.getByText(/An earlier operation needs confirmation/).waitFor();
    const committedWhileUnknown=(await api('get_plan',{projectId:created.id})).project;
    assert.equal(committedWhileUnknown.description,'Saved once despite lost response');
    assert.equal(committedWhileUnknown.version,current.version+2,'Server committed exactly once despite the missing response');
    const journalKey=`demac.projects.pending.v1:${actors.admin.localId}`;
    const readPending=()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),journalKey);
    const pendingBeforeReload=await readPending();
    assert.deepEqual(pendingBeforeReload.command,responseFault.pendingCommand(),'The browser retains the exact submitted command');
    if(await lost.count())await lost.getByRole('button',{name:'Close dialog',exact:true}).click();
    page.once('dialog',event=>event.accept());
    await page.reload();
    await page.getByRole('button',{name:'Retry the exact request',exact:true}).waitFor();
    assert.deepEqual(await readPending(),pendingBeforeReload,'Reload must preserve recovery evidence, not generate another write');
    assert.equal(await page.getByRole('button',{name:/Create Project/}).isDisabled(),true,'Replacement writes stay blocked while outcome is unknown');
    assert.equal(responseFault.snapshot().commits,1);
    responseFault.releaseForExactRetry();
    await page.getByRole('button',{name:'Retry the exact request',exact:true}).click();
    await page.getByText(/original request recovered/).waitFor();
    const afterRetry=(await api('get_plan',{projectId:created.id})).project;
    assert.equal(afterRetry.description,'Saved once despite lost response');
    assert.equal(afterRetry.version,current.version+2);
    assert.equal(await readPending(),null,'Only a verified acknowledgement may clear the journal');
    recoveryEvidence.push({browser:engineName,...responseFault.finish()});
    stage='mobile';await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:/Open project/}).first().waitFor();await page.waitForFunction(()=>{const sidebar=document.querySelector('.erp-sidebar');return !sidebar||sidebar.getBoundingClientRect().right<=1||getComputedStyle(sidebar).display==='none';});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'No mobile page overflow');await page.screenshot({path:path.join(ART,`${engineName}-central-mobile.png`),fullPage:true});
    stage='second user';const second=await contextFor(browser,'operations');const other=await second.newPage();await other.goto(origin+'/projects/central/');await other.getByText(name,{exact:true}).waitFor();await second.close();
    if(engineName==='chromium'){
      stage='read-only role';const finance=await contextFor(browser,'finance');const financePage=await finance.newPage();await financePage.goto(origin+'/projects/central/');await financePage.getByRole('button',{name:/Create Project/}).waitFor();assert.equal(await financePage.getByRole('button',{name:/Create Project/}).isDisabled(),true);await finance.close();
      stage='import preview';await page.setViewportSize({width:1600,height:1050});await page.reload();await page.getByRole('button',{name:'Import & recovery',exact:true}).click();
      const source={id:'UI-LEGACY',projectNumber:'PRJ-UI-LEGACY',name:'Synthetic archived project',customerId:CUSTOMER,customerName:'Synthetic customer',siteId:PROPERTY,location:'Synthetic property',contactPerson:'Synthetic contact',type:'VRF Project',description:'Scope',technicianInstructions:'Instructions',status:'Planned',priority:'High',managerId:'',managerName:'Not assigned',startsOn:'2026-09-01',estimatedCompletionOn:'2026-10-01',totalUnits:10,completedUnits:0,unitType:'Units',estimatedWorkDays:11,slotsPerWorkDay:6,slotDurationMinutes:60,estimatedSlots:66,estimatedLaborHours:66,actualLaborHours:0,scheduledFutureHours:0,materialBudget:null,materialActual:0,assignedVans:[],phases:[],assignments:[],materials:[],expenses:[],costEntries:[]};
      const file=JSON.stringify(await captureLocalBackup({getItem:key=>key===STORAGE_KEYS[0]?JSON.stringify({version:1,projects:[source]}):'[]'},{capturedAt:'2026-09-18T12:00:00.000Z',origin:'https://erp.example.test'}));const priorPreviewCount=previewRequests;
      await page.getByLabel('Saved backup file',{exact:true}).setInputFiles({name:'synthetic-projects.json',mimeType:'application/json',buffer:Buffer.from(file)});await page.getByRole('combobox',{name:/^Select backed-up project/}).selectOption(source.id);assert.equal(previewRequests,priorPreviewCount);await page.getByRole('button',{name:'Review import — no writes',exact:true}).click();await page.getByText('Read-only preview',{exact:true}).waitFor();assert.equal((await db.collection('projectRecords').doc(source.id).get()).exists,false);await page.screenshot({path:path.join(ART,'central-import-preview.png'),fullPage:true});
    }
    assert.equal(network.filter(row=>row.event==='pageerror').length,errors.length,'Every raw error must remain in the evidence ledger');
    const diagnostics=await verifyNavigationEvidence(page,network,{engine:engineName,origin});
    fs.writeFileSync(path.join(ART,`${engineName}-navigation-verdict.json`),JSON.stringify(diagnostics,null,2));
    assert.deepEqual(externalNetwork,[],'No native request may reach an external service');console.log(`PASS ${engineName}: shared create/read, phase, conflicting edit, lost response with reload, exact retry, mobile, cross-user reads.`);
  }catch(error){console.error('CENTRAL_UI_FAILURE',engineName,stage,JSON.stringify({errors,text:(await page.locator('body').innerText().catch(()=>'' )).slice(0,6000)}));await page.screenshot({path:path.join(ART,`${engineName}-failure.png`),fullPage:true}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(ART,`${engineName}-network.json`),JSON.stringify(network,null,2));await context.close();await browser.close();}
 }
 assert.deepEqual(await snapshotProtected(),before,'Operational customer/appointment/Field/capacity/stock/message data must remain unchanged');
 fs.writeFileSync(path.join(ART,'summary.json'),JSON.stringify({emulatorProject:PROJECT,browsers:['chromium','webkit'],recoveryEvidence,externalRequestsForwarded:0,protectedOperationalCollectionsUnchanged:true,tests:'central planning, phase, activity, import preview, cross-user read, stale version, lost response/reload/exact replay, mobile'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{server.close();await deleteApp(app);});
