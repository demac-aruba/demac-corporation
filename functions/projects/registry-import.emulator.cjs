'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Refusing non-loopback emulator connection.');
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo-only import acceptance; production credentials forbidden.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createProjectRegistryService, COLLECTIONS } = require('./registry-service');
const { IMPORT_COLLECTION } = require('./registry-import-transaction');
const { captureLocalBackup, projectImportCandidate, STORAGE_KEYS } = require('./recovery');
const d = require('./registry-domain');
const app = initializeApp({ projectId: PROJECT }, 'projects-import-acceptance');
const db = getFirestore(app); const auth = getAuth(app);
const api = createProjectRegistryService({ db, verifyIdToken: (t,r) => auth.verifyIdToken(t,r), enabled: true, allowLegacyImport: true });
const noImport = createProjectRegistryService({ db, verifyIdToken: (t,r) => auth.verifyIdToken(t,r), enabled: true });
const actors = {};let sequence=0;const next = label => `IMP-${label}-${++sequence}`;
const settings = db.collection('businessSettings').doc('projects-registry');
const CRM = { customerId:'IMP-CUSTOMER', propertyId:'IMP-PROPERTY' };
const PROTECTED = ['clients','properties','appointments','workOrders','workVisits','bookingCapacityLocks','whatsappOutboundQueue','warehouseInventory','commercialProductStock'];
function source(overrides={}) {
  const id=next('SOURCE');return {
    id,projectNumber:`PRJ-${id}`,name:'Synthetic legacy import',customerId:CRM.customerId,customerName:'Synthetic customer',siteId:CRM.propertyId,
    location:'Synthetic property',contactPerson:'Synthetic contact',type:'VRF Project',description:'Synthetic scope',technicianInstructions:'Synthetic instructions',
    status:'Planned',priority:'High',managerId:'',managerName:'Not assigned',startsOn:'2026-09-01',estimatedCompletionOn:'2026-10-01',
    totalUnits:10,completedUnits:0,unitType:'Units',estimatedWorkDays:11,slotsPerWorkDay:6,slotDurationMinutes:60,estimatedSlots:66,estimatedLaborHours:66,
    actualLaborHours:0,scheduledFutureHours:0,materialBudget:9000,materialActual:0,assignedVans:[],phases:[],assignments:[],materials:[],expenses:[],costEntries:[],...overrides,
  };
}
async function fromSource(raw=source()) {
  const file=JSON.stringify(await captureLocalBackup({getItem:key=>key===STORAGE_KEYS[0]?JSON.stringify({version:1,projects:[raw]}):'[]'}, {capturedAt:'2026-09-18T12:00:00.000Z',origin:'https://erp.example.test'}));
  return { raw, file, candidate:await projectImportCandidate(file,raw.id) };
}
async function run(action,data,who='admin',requestId=next('REQUEST'),service=api) {
  return service.execute({idToken:actors[who].token,command:{action,data,requestId}});
}
async function preview(c) { return run('preview_legacy_import',{candidate:c}); }
async function approval(c) {
  const p=await preview(c);assert.equal(p.canImport,true);
  return {candidate:c,previewHash:p.previewHash,acknowledgedWarnings:p.warnings,backupConfirmed:true,reason:'Verified synthetic file and reviewed exact import preview'};
}
async function apply(c,requestId=next('IMPORT')) { return run('import_legacy_plan',await approval(c),'admin',requestId); }
async function plan(id) { return (await run('get_plan',{projectId:id})).project; }
async function collectionCount(name) { return (await db.collection(name).get()).size; }
function importId(c,projectId) { return `PI-${d.digest({projectId,sourceDigest:d.digest(c)}).slice(0,40)}`; }
before(async()=>{
  for(const [key,role] of [['admin','admin'],['second','super_admin'],['operations','operations'],['finance','finance']]) {
    const res=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`import-${key}@example.test`,password:'synthetic-import-password-1',returnSecureToken:true})});
    const value=await res.json();assert.ok(value.idToken);actors[key]={token:value.idToken,uid:value.localId};
    await db.collection('users').doc(value.localId).set({role,active:true});
  }
  await settings.set({backendEnabled:true,legacyImportEnabled:true});
  await db.collection('clients').doc(CRM.customerId).set({active:true,name:'Synthetic customer'});
  await db.collection('properties').doc(CRM.propertyId).set({active:true,clientId:CRM.customerId});
  for(const name of PROTECTED) await db.collection(name).doc('IMP-PROTECTED').set({unchanged:name});
});
after(async()=>{
  for(const name of PROTECTED) assert.deepEqual((await db.collection(name).doc('IMP-PROTECTED').get()).data(),{unchanged:name});
  await settings.set({backendEnabled:true,legacyImportEnabled:false});await deleteApp(app);
});
test('dry-run is stable and read-only; no plan, number, archive or audit exists after preview',async()=>{
  const c=await fromSource();const counts=await Promise.all([COLLECTIONS.records,COLLECTIONS.numbers,COLLECTIONS.events,IMPORT_COLLECTION].map(collectionCount));
  const a=await preview(c.candidate);const b=await preview(c.candidate);assert.equal(a.previewHash,b.previewHash);assert.equal(a.canImport,true);assert.equal(a.writesPerformed,0);assert.equal(a.projectId,c.raw.id);
  assert.deepEqual(await Promise.all([COLLECTIONS.records,COLLECTIONS.numbers,COLLECTIONS.events,IMPORT_COLLECTION].map(collectionCount)),counts);
});
test('both runtime and server import flags are required; preview can remain read-only',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);
  await assert.rejects(run('import_legacy_plan',data,'admin',next('OFF'),noImport),{code:'legacy_import_not_active'});
  await settings.update({legacyImportEnabled:false});
  try {await assert.rejects(run('import_legacy_plan',data),{code:'legacy_import_not_active'});assert.equal((await preview(c.candidate)).writesPerformed,0);}
  finally{await settings.update({legacyImportEnabled:true});}
});
test('only the provisioned active owner can preview, import or retrieve raw legacy data',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);
  for(const who of ['operations','finance']) {
    await assert.rejects(run('preview_legacy_import',{candidate:c.candidate},who),{code:'import_owner_required'});
    await assert.rejects(run('import_legacy_plan',data,who),{code:who==='finance'?'forbidden':'import_owner_required'});
    await assert.rejects(run('get_import_source',{projectId:c.raw.id},who),{code:'import_owner_required'});
  }
});
test('saved backup confirmation and all exact preview warnings are mandatory',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);
  await assert.rejects(run('import_legacy_plan',{...data,backupConfirmed:false}),{code:'backup_confirmation_required'});
  await assert.rejects(run('import_legacy_plan',{...data,acknowledgedWarnings:[]}),{code:'import_warnings_unacknowledged'});
  assert.equal((await db.collection(COLLECTIONS.records).doc(c.raw.id).get()).exists,false);
});
test('import preserves original IDs and raw source with no inferred execution, bookings or costs',async()=>{
  const c=await fromSource(source({actualLaborHours:8,scheduledFutureHours:69,completedUnits:3,unknownFutureField:{keep:'original'},assignments:[{id:'UNTRUSTED-LINK',workOrderId:'FAKE-WO'}]}));
  const result=await apply(c.candidate);assert.equal(result.projectId,c.raw.id);const p=await plan(c.raw.id);
  assert.equal(p.projectNumber,c.raw.projectNumber);assert.equal(p.budget.originalMinutes,3960);assert.equal(p.budget.currentMinutes,3960);
  assert.equal(p.actualLaborHours,undefined);assert.equal(p.assignments,undefined);assert.equal(p.migration.status,'pending_reconciliation');
  const recovered=await run('get_import_source',{projectId:c.raw.id});assert.equal(recovered.rawProjectJson,c.candidate.rawProjectJson);assert.equal(recovered.restored,false);
  assert.equal(JSON.parse(recovered.rawProjectJson).unknownFutureField.keep,'original');
  assert.equal((await db.collection(COLLECTIONS.links).where('projectId','==',c.raw.id).get()).size,0);
  assert.equal((await db.collection(COLLECTIONS.events).where('projectId','==',c.raw.id).get()).size,1);
});
test('pending imported associations are unknown, never a false zero/healthy project forecast',async()=>{
  const c=await fromSource(source({scheduledFutureHours:63}));await apply(c.candidate);
  const activity=await run('get_activity',{projectId:c.raw.id});assert.equal(activity.projectForecast,null);assert.equal(activity.coverage.importReviewPending,true);assert.equal(activity.pageTotals.plannedVanMinutes,null);
});
test('same exact concurrent import commits one plan, source archive, event and receipt',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);const requestId=next('REPLAY');
  const result=await Promise.all([run('import_legacy_plan',data,'admin',requestId),run('import_legacy_plan',data,'admin',requestId)]);
  assert.equal(result[0].projectId,result[1].projectId);assert.equal(result.filter(x=>x.replayed).length,1);
  for(const name of [COLLECTIONS.events,COLLECTIONS.receipts,IMPORT_COLLECTION])assert.equal((await db.collection(name).where('projectId','==',c.raw.id).get()).size,1);
});
test('the same ID or number cannot overwrite an existing or separately imported project',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);await run('import_legacy_plan',data);
  assert.equal((await preview(c.candidate)).canImport,false);await assert.rejects(run('import_legacy_plan',data),{code:'legacy_import_conflict'});
  const other=await fromSource(source({projectNumber:c.raw.projectNumber.toLowerCase()}));const p=await preview(other.candidate);
  assert.equal(p.canImport,false);assert.ok(p.conflicts.includes('project_number_exists'));
});
test('CRM changes between preview and import invalidate the plan, including subsecond revisions',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);
  await db.collection('properties').doc(CRM.propertyId).update({reviewStamp:next('CRM-CHANGE')});
  await assert.rejects(run('import_legacy_plan',data),{code:'legacy_preview_changed'});
  assert.equal((await db.collection(COLLECTIONS.records).doc(c.raw.id).get()).exists,false);
});
test('a rehashed changed source cannot use an old preview approval',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);const changed=await fromSource({...c.raw,name:'Changed after review'});
  await assert.rejects(run('import_legacy_plan',{...data,candidate:changed.candidate}),{code:'legacy_preview_changed'});
});
test('foreign Customer/Property data and orphan project links block import without deleting anything',async()=>{
  const c=await fromSource(source({siteId:'IMP-MISSING-PROPERTY'}));assert.ok((await preview(c.candidate)).conflicts.includes('crm_identity_conflict'));
  const orphan=await fromSource();await db.collection(COLLECTIONS.links).doc(next('ORPHAN')).set({projectId:orphan.raw.id});
  assert.ok((await preview(orphan.candidate)).conflicts.includes('existing_project_history'));
});
test('different operators racing the same identity cannot duplicate or replace the import',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);
  const results=await Promise.allSettled([run('import_legacy_plan',data,'admin'),run('import_legacy_plan',data,'second')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'legacy_import_conflict');
});
test('audit failure rolls back all staged Project/number/archive writes, not just the last operation',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);const requestId=next('FAIL-AUDIT');
  const protectedDb={collection:db.collection.bind(db),runTransaction:async(callback,options)=>db.runTransaction(async tx=>callback({
    get:tx.get.bind(tx),getAll:tx.getAll.bind(tx),set:tx.set.bind(tx),
    create:(ref,value)=>{if(ref.parent.id===COLLECTIONS.events)throw Error('SYNTHETIC_IMPORT_AUDIT_FAILURE');return tx.create(ref,value);},
  }),options)};
  const broken=createProjectRegistryService({db:protectedDb,verifyIdToken:(t,r)=>auth.verifyIdToken(t,r),enabled:true,allowLegacyImport:true});
  await assert.rejects(run('import_legacy_plan',data,'admin',requestId,broken),/SYNTHETIC_IMPORT_AUDIT_FAILURE/);
  for(const [collection,key] of [[COLLECTIONS.records,c.raw.id],[COLLECTIONS.numbers,c.raw.projectNumber],[IMPORT_COLLECTION,importId(c.candidate,c.raw.id)],[COLLECTIONS.receipts,`PC-${d.digest(`${actors.admin.uid}:${requestId}`).slice(0,40)}`]])assert.equal((await db.collection(collection).doc(key).get()).exists,false);
});
test('the archived raw record can be independently recovered without overwriting the central plan',async()=>{
  const c=await fromSource();await apply(c.candidate);const originalPlan=await plan(c.raw.id);
  const recovered=await run('get_import_source',{projectId:c.raw.id});
  assert.equal(d.digest(recovered.rawProjectJson),c.candidate.source.projectDigest);assert.deepEqual(JSON.parse(recovered.rawProjectJson),c.raw);
  assert.deepEqual(await plan(c.raw.id),originalPlan);
  await db.collection(IMPORT_COLLECTION).doc(originalPlan.migration.importId).update({rawProjectJson:'{}'}); // guarded emulator-only corruption fixture
  await assert.rejects(run('get_import_source',{projectId:c.raw.id}),{code:'import_archive_conflict'});
});
test('revoked owner privilege and disabled import flags are rechecked before replay receipts',async()=>{
  const c=await fromSource();const data=await approval(c.candidate);const requestId=next('REVOKE');await run('import_legacy_plan',data,'admin',requestId);
  await db.collection('users').doc(actors.admin.uid).update({role:'operations'});
  try{await assert.rejects(run('import_legacy_plan',data,'admin',requestId),{code:'import_owner_required'});}finally{await db.collection('users').doc(actors.admin.uid).update({role:'admin'});}
  await settings.update({legacyImportEnabled:false});
  try{await assert.rejects(run('import_legacy_plan',data,'admin',requestId),{code:'legacy_import_not_active'});}finally{await settings.update({legacyImportEnabled:true});}
});
test('unchanged Firestore rules deny direct-client raw archive access and write bypass',async()=>{
  const c=await fromSource();await apply(c.candidate);const p=await plan(c.raw.id);
  const endpoint=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${IMPORT_COLLECTION}/${p.migration.importId}`;
  for(const method of ['GET','PATCH']) {
    const response=await fetch(endpoint,{method,headers:{Authorization:`Bearer ${actors.admin.token}`,'Content-Type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({fields:{rawProjectJson:{stringValue:'bypass'}}})}:{})});
    assert.equal(response.status,403);
  }
  assert.equal((await run('get_import_source',{projectId:c.raw.id})).rawProjectJson,c.candidate.rawProjectJson);
});
test('metadata can change without dropping rich phase details or altering captured budget data',async()=>{
  const originalPhase={id:'PH-IMPORT-META',name:'Synthetic phase',status:'Planned',estimatedLaborHours:6,actualLaborHours:0,unitsPlanned:1,unitsCompleted:0,progress:0,
    sequence:10,objective:'Preserve objective',scopeOfWork:'Preserve scope',outOfScope:'Preserve exclusions',technicianInstructions:'Preserve instructions',completionCriteria:'Verify work',
    startsOn:'2026-09-01',endsOn:'2026-09-02',dependencies:[],priority:'High',responsibleManager:'Synthetic manager',progressMethod:'checklist',
    checklist:[{id:'CHECK-META',label:'Preserve requirement',required:false,done:false}],fieldReports:[]};
  const c=await fromSource(source({phases:[originalPhase]}));await apply(c.candidate);
  await run('edit_metadata',{projectId:c.raw.id,expectedVersion:1,patch:{name:'Updated name',details:{priority:'Normal'}}});
  const p=await plan(c.raw.id);assert.equal(p.details.priority,'Normal');assert.equal(p.details.materialBudget.amountMinor,900000);assert.equal(p.details.scheduleEstimate.estimatedSlots,66);assert.equal(p.budget.currentMinutes,3960);
  assert.equal(p.phases[0].id,originalPhase.id);assert.equal(p.phases[0].details.objective,originalPhase.objective);assert.equal(p.phases[0].details.technicianInstructions,originalPhase.technicianInstructions);assert.equal(p.phases[0].checklist[0].required,false);
});
test('safe-integer revision exhaustion fails without leaving unreadable project history',async()=>{
  const c=await fromSource();await apply(c.candidate);
  await db.collection(COLLECTIONS.records).doc(c.raw.id).update({version:Number.MAX_SAFE_INTEGER-1});
  await assert.rejects(run('edit_metadata',{projectId:c.raw.id,expectedVersion:Number.MAX_SAFE_INTEGER-1,patch:{name:'Cannot advance'}}),{code:'project_version_exhausted'});
  assert.equal((await plan(c.raw.id)).version,Number.MAX_SAFE_INTEGER-1);
});
