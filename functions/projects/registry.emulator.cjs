'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || '')) throw new Error(`Refusing non-local ${name}`);
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Only the isolated demo project without production credentials is allowed.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { COLLECTIONS, createProjectRegistryService } = require('./registry-service');
const { createProjectReconciliationReader } = require('./reconciliation-reader');
const { officeReviewDocumentId, officeReviewRevisionDocumentId } = require('../fieldOperationsOfficeReview');
const app = initializeApp({ projectId: PROJECT }, 'projects-isolated');
const db = getFirestore(app); const auth = getAuth(app);
const api = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
const actors = {};
let seq = 0;
const uid = (prefix) => `${prefix}-${++seq}`;
const PLAN = () => ({ name: 'Synthetic shared project', type: 'VRF Project', customerId: 'REG-TEST-CUSTOMER', propertyId: 'REG-TEST-PROPERTY', startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01', budgetedVanMinutes: 3960, phases: [] });
const PHASE = () => ({ id: 'PH-TEST', name: 'Synthetic phase', scopeOfWork: 'Install', completionCriteria: 'Verify scope', plannedVanMinutes: 360, dependencies: [], progressMethod: 'units', unitsPlanned: 1, checklist: [] });
async function run(action, data, actor = 'admin', requestId = uid('REQ-TEST')) { return api.execute({ idToken: actors[actor].token, command: { action, data, requestId } }); }
async function create(data = PLAN()) { return run('create_plan', data); }
async function read(id) { return (await run('get_plan', { projectId: id })).project; }
async function seedAppointment({ appointmentId = uid('APT-TEST'), duration = 360, support = false } = {}) {
  await db.collection('appointments').doc(appointmentId).set({ appointmentId, customerId: PLAN().customerId, propertyId: PLAN().propertyId, status: 'confirmed', date: '2026-09-18' });
  const order = { appointmentId, clientId: PLAN().customerId, propertyId: PLAN().propertyId, status: 'Confirmada', appointmentDurationMinutes: duration, scheduledSlots: Math.ceil(duration / 60), vanId: 'VAN-TEST', date: '2026-09-18', time: '08:30' };
  const workOrderId = `WO-${appointmentId}`;
  await db.collection('workOrders').doc(workOrderId).set(order);
  if (support) await db.collection('workOrders').doc(`${workOrderId}-SUPPORT`).set({ ...order, vanId: 'VAN-SUPPORT', appointmentDurationMinutes: 120, scheduledSlots: 2 });
  return { appointmentId, workOrderId, order };
}
async function attach(project, appointment, phaseId = null, actor = 'admin') {
  return run('attach_existing_appointment', { projectId: project.projectId, expectedVersion: project.version, appointmentId: appointment.appointmentId, phaseId, confirmedAssociation: true, reason: 'Synthetic reviewed association' }, actor);
}
before(async () => {
  for (const [name, role] of [['admin','admin'],['operations','supervisor'],['manager','project_manager'],['finance','finance'],['operator','office'],['technician','technician'],['disabled','admin']]) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `registry-${name}@example.test`, password: 'synthetic-registry-password-1', returnSecureToken: true }) });
    const value = await response.json(); assert.ok(value.idToken, 'Auth emulator must issue an actual token');
    actors[name] = { token: value.idToken, uid: value.localId };
    await db.collection('users').doc(value.localId).set({ role, active: name !== 'disabled' });
  }
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true });
  await db.collection('clients').doc(PLAN().customerId).set({ name: 'Synthetic customer', active: true });
  await db.collection('properties').doc(PLAN().propertyId).set({ clientId: PLAN().customerId, active: true });
  for (const collection of ['clients','appointments','bookingCapacityLocks','workOrders','workVisits','warehouseInventory','whatsappOutboundQueue']) await db.collection(collection).doc('REG-PROTECTED-SENTINEL').set({ protected: true, unchanged: collection });
});
after(async () => {
  for (const collection of ['clients','appointments','bookingCapacityLocks','workOrders','workVisits','warehouseInventory','whatsappOutboundQueue']) assert.deepEqual((await db.collection(collection).doc('REG-PROTECTED-SENTINEL').get()).data(), { protected: true, unchanged: collection });
  await deleteApp(app);
});

test('server activation defaults off and kill switch prevents both reads and writes', async()=>{
  const disabled=createProjectRegistryService({db,verifyIdToken:()=>{assert.fail('No authentication work while runtime disabled');}});
  await assert.rejects(disabled.execute({idToken:'x',command:{}}),{code:'projects_not_active'});
  await db.collection('businessSettings').doc('projects-registry').set({backendEnabled:false});
  try{await assert.rejects(run('list_plans',{}),{code:'projects_not_active'});await assert.rejects(create(),{code:'projects_not_active'});}finally{await db.collection('businessSettings').doc('projects-registry').set({backendEnabled:true});}
});
test('invalid, forged and inactive sessions fail before any project mutation',async()=>{
  await assert.rejects(api.execute({idToken:'forged-token',command:{action:'create_plan',requestId:'FORGED-TEST',data:PLAN()}}),{code:'unauthenticated'});
  for(const name of ['disabled','operator','technician','finance'])await assert.rejects(run('create_plan',PLAN(),name),{code:'forbidden'});
});
test('central planning is visible to a second authorized operator, with immutable CRM IDs',async()=>{
  const created=await create();const other=await run('get_plan',{projectId:created.projectId},'operations');
  assert.equal(other.project.name,PLAN().name);assert.equal(other.project.version,1);assert.equal(other.project.customerId,PLAN().customerId);
  const finance=await run('get_plan',{projectId:created.projectId},'finance');assert.equal(finance.project.id,created.projectId);
  await assert.rejects(run('edit_metadata',{projectId:created.projectId,expectedVersion:1,patch:{customerId:'OTHER'}}),{code:'invalid_fields'});
});
test('revoking provisioned role is honored on exact replay, not bypassed by a saved receipt',async()=>{
  const requestId=uid('PRIVILEGE-REPLAY');const command={action:'create_plan',data:PLAN(),requestId};
  const first=await api.execute({idToken:actors.manager.token,command});assert.ok(first.projectId);
  await db.collection('users').doc(actors.manager.uid).set({role:'office',active:true});
  try{await assert.rejects(api.execute({idToken:actors.manager.token,command}),{code:'forbidden'});}finally{await db.collection('users').doc(actors.manager.uid).set({role:'project_manager',active:true});}
});
test('duplicate concurrent requests commit one project, event and receipt',async()=>{
  const requestId=uid('CONCURRENT-CREATE');const commands={idToken:actors.admin.token,command:{action:'create_plan',data:PLAN(),requestId}};
  const [a,b]=await Promise.all([api.execute(commands),api.execute(commands)]);assert.equal(a.projectId,b.projectId);assert.equal(a.version,1);assert.equal(b.version,1);
  assert.equal((await db.collection(COLLECTIONS.events).where('projectId','==',a.projectId).get()).size,1);
  assert.equal((await db.collection(COLLECTIONS.receipts).where('projectId','==',a.projectId).get()).size,1);
});
test('reusing a request ID with different payload is a conflict, not a silently accepted update',async()=>{
  const requestId=uid('EXACT-INTENT');await run('create_plan',PLAN(),'admin',requestId);
  await assert.rejects(run('create_plan',{...PLAN(),name:'different'},'admin',requestId),{code:'request_conflict'});
});
test('two operators with the same version cannot overwrite each other',async()=>{
  const project=await create();const requests=[run('edit_metadata',{projectId:project.projectId,expectedVersion:1,patch:{name:'A'}},'admin'),run('edit_metadata',{projectId:project.projectId,expectedVersion:1,patch:{name:'B'}},'operations')];
  const results=await Promise.allSettled(requests);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'version_conflict');assert.equal((await read(project.projectId)).version,2);
});
test('auth and data validation reject foreign property references without partial records',async()=>{
  const count=(await db.collection(COLLECTIONS.records).get()).size;
  await assert.rejects(create({...PLAN(),propertyId:'OTHER-PROPERTY'}),{code:'crm_identity_conflict'});
  assert.equal((await db.collection(COLLECTIONS.records).get()).size,count);
});
test('estimate revisions preserve original baseline and complete revision evidence',async()=>{
  const project=await create();await run('revise_estimate',{projectId:project.projectId,expectedVersion:1,budgetedVanMinutes:4200,reason:'Explicit revised plan'});
  const plan=await read(project.projectId);assert.equal(plan.budget.originalMinutes,3960);assert.equal(plan.budget.currentMinutes,4200);
  const events=await db.collection(COLLECTIONS.events).where('projectId','==',project.projectId).get();
  const revision=events.docs.map(x=>x.data()).find(x=>x.action==='revise_estimate');assert.equal(revision.beforePlan.budget.currentMinutes,3960);assert.equal(revision.afterPlan.budget.currentMinutes,4200);
  await run('revise_estimate',{projectId:project.projectId,expectedVersion:2,budgetedVanMinutes:4260,reason:'Explicit project manager revision'},'manager');
  assert.equal((await read(project.projectId)).budget.originalMinutes,3960);
  await assert.rejects(run('revise_estimate',{projectId:project.projectId,expectedVersion:3,budgetedVanMinutes:4320,reason:'Test'},'finance'),{code:'forbidden'});
});
test('metadata edits and over-budget existing links do not modify estimates or actual labor',async()=>{
  const project=await create({...PLAN(),budgetedVanMinutes:300});const appointment=await seedAppointment({duration:360});await attach(project,appointment);
  const plan=await read(project.projectId);assert.equal(plan.budget.currentMinutes,300);assert.equal(plan.actualLaborHours,undefined);
  const activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.projectForecast.overBudgetMinutes,60);assert.equal(activity.projectForecast.blocksBooking,false);assert.equal(activity.actualLabor.personMinutes,null);
});
test('association includes all current support Work Orders and newly added support without stale copied counters',async()=>{
  const project=await create();const appointment=await seedAppointment({support:true});await attach(project,appointment);
  let activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.rows.length,2);assert.equal(activity.pageTotals.plannedVanMinutes,480);
  await db.collection('workOrders').doc(`${appointment.workOrderId}-LATER`).set({...appointment.order,vanId:'VAN-LATER',appointmentDurationMinutes:60,scheduledSlots:1});
  activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.rows.length,3);assert.equal(activity.pageTotals.plannedVanMinutes,540);assert.equal((await read(project.projectId)).version,2);
});
test('rescheduling is read from current Work Orders; cancellation removes planned allocation without deleting project history',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  await db.collection('workOrders').doc(appointment.workOrderId).update({date:'2026-09-19',appointmentDurationMinutes:120,scheduledSlots:2});
  let activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.pageTotals.plannedVanMinutes,120);assert.equal(activity.rows[0].date,'2026-09-19');
  await db.collection('appointments').doc(appointment.appointmentId).update({status:'cancelled'});await db.collection('workOrders').doc(appointment.workOrderId).update({status:'Cancelada'});
  activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.pageTotals.plannedVanMinutes,0);assert.equal(activity.rows.length,1);assert.equal(activity.rows[0].cancelled,true);
});
test('association conflicts cannot silently move a booking between projects or phases',async()=>{
  const first=await create();const second=await create();const appointment=await seedAppointment();await attach(first,appointment);
  await assert.rejects(attach(second,appointment),{code:'association_conflict'});
  assert.equal((await read(second.projectId)).version,1);
});
test('one valid Work Order plus a foreign support order blocks association transaction completely',async()=>{
  const project=await create();const appointment=await seedAppointment();await db.collection('workOrders').doc(`${appointment.workOrderId}-BAD`).set({...appointment.order,clientId:'FOREIGN'});
  await assert.rejects(attach(project,appointment),{code:'work_order_identity_conflict'});assert.equal((await db.collection(COLLECTIONS.links).doc(appointment.appointmentId).get()).exists,false);assert.equal((await read(project.projectId)).version,1);
});
test('phase deletion is blocked when operational association exists',async()=>{
  const project=await create({...PLAN(),phases:[PHASE()]});const appointment=await seedAppointment();await attach(project,appointment,'PH-TEST');
  await assert.rejects(run('set_phases',{projectId:project.projectId,expectedVersion:2,phases:[]}),{code:'phase_has_history'});
});
test('General Project Work remains visible after phases are introduced',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  await run('set_phases',{projectId:project.projectId,expectedVersion:2,phases:[PHASE()]});const activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.rows[0].phaseId,null);assert.equal(activity.pageTotals.plannedVanMinutes,360);
});
test('missing records and lifecycle contradictions appear as errors, never a healthy zero',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  await db.collection('appointments').doc(appointment.appointmentId).update({status:'cancelled'});
  let activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.projectForecast,null);assert.equal(activity.pageTotals.plannedVanMinutes,null);assert.ok(activity.issues.some(x=>x.code==='appointment_lifecycle_mismatch'));
  await db.collection('appointments').doc(appointment.appointmentId).delete(); // guarded demo-only source failure fixture
  activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.projectForecast,null);assert.ok(activity.issues.some(x=>x.code==='linked_appointment_missing'));
});
test('real Field Visit and Office Review records are read, not fabricated from slots',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  const visitId=uid('VISIT-TEST');const timestamp='2026-09-18T13:00:00.000Z';
  await db.collection('workVisits').doc(visitId).set({id:visitId,workOrderId:appointment.workOrderId,appointmentId:appointment.appointmentId,clientId:PLAN().customerId,propertyId:PLAN().propertyId,status:'completed',startedAt:timestamp,completedAt:'2026-09-18T15:00:00.000Z',version:2});
  const reviewId=officeReviewDocumentId(appointment.workOrderId);const revisionId=officeReviewRevisionDocumentId(reviewId,1);
  const identity={workOrderId:appointment.workOrderId,appointmentId:appointment.appointmentId,clientId:PLAN().customerId,propertyId:PLAN().propertyId,visitId};
  await db.collection('fieldOfficeReviews').doc(reviewId).set({fieldAuthorityVersion:1,...identity,status:'approved',currentRevisionId:revisionId,currentRevisionNumber:1,submittedAt:timestamp,submittedBy:'TECH-TEST',reviewedAt:timestamp,reviewedBy:'ADMIN-TEST',createdAt:timestamp,createdBy:'TECH-TEST',updatedAt:timestamp,version:2});
  await db.collection('fieldOfficeReviewRevisions').doc(revisionId).set({fieldAuthorityVersion:1,...identity,reviewId,revisionNumber:1,sourceVisitVersion:2,submittedAt:timestamp,submittedBy:'TECH-TEST',requestId:'REVIEW-REQUEST-TEST',snapshot:{},version:1});
  const activity=await run('get_activity',{projectId:project.projectId});assert.deepEqual(activity.issues,[]);assert.equal(activity.pageTotals.visits,1);assert.equal(activity.pageTotals.approvedWorkOrders,1);assert.equal(activity.actualLabor.personMinutes,null);assert.equal(activity.physicalProgress.percent,null);
});
test('a partial activity page is never labeled as the complete project budget',async()=>{
  let project=await create();for(let n=0;n<11;n++){const appointment=await seedAppointment();project=await attach(project,appointment);}
  const activity=await run('get_activity',{projectId:project.projectId});assert.ok(activity.nextCursor);assert.equal(activity.rows.length,10);assert.equal(activity.projectForecast,null);assert.equal(activity.coverage.allProjectLinksIncluded,false);
  const second=await run('get_activity',{projectId:project.projectId,afterId:activity.nextCursor});assert.equal(second.rows.length,1);assert.equal(second.projectForecast,null);
});
test('rule boundary denies direct client writes to the new registry even for an authenticated administrator',async()=>{
  const response=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/projectRecords/DIRECT-CLIENT-TEST`,{method:'PATCH',headers:{Authorization:`Bearer ${actors.admin.token}`,'Content-Type':'application/json'},body:JSON.stringify({fields:{name:{stringValue:'Client bypass'}}})});
  assert.equal(response.status,403);assert.equal((await db.collection(COLLECTIONS.records).doc('DIRECT-CLIENT-TEST').get()).exists,false);
});
test('a transaction failure between Project and audit writes leaves no partial data',async()=>{
  const project=await create();const protectedDb={collection:db.collection.bind(db),runTransaction:async(callback,options)=>db.runTransaction(async transaction=>{
    const wrapped={get:transaction.get.bind(transaction),getAll:transaction.getAll.bind(transaction),set:transaction.set.bind(transaction),create:(ref,data)=>{if(ref.parent.id===COLLECTIONS.events)throw Error('SIMULATED_AUDIT_FAILURE');return transaction.create(ref,data);}};
    return callback(wrapped);
  },options)};
  const broken=createProjectRegistryService({db:protectedDb,verifyIdToken:(token,revoked)=>auth.verifyIdToken(token,revoked),enabled:true});
  await assert.rejects(broken.execute({idToken:actors.admin.token,command:{action:'edit_metadata',requestId:uid('FAILURE-TEST'),data:{projectId:project.projectId,expectedVersion:1,patch:{name:'Must not persist'}}}}),/SIMULATED_AUDIT_FAILURE/);
  assert.equal((await read(project.projectId)).version,1);assert.equal((await read(project.projectId)).name,PLAN().name);
});
test('original read-only reconciliation works with actual Auth and Firestore emulators',async()=>{
  // The initial recovery reader deliberately requires exact super_admin, not UI aliases.
  await db.collection('users').doc(actors.admin.uid).set({active:true,role:'super_admin'});
  try{
    const appointment=await seedAppointment();const reader=createProjectReconciliationReader({db,verifyIdToken:(token,revoked)=>auth.verifyIdToken(token,revoked)});
    const result=await reader({idToken:actors.admin.token,project:{id:'LEGACY-TEST',customerId:PLAN().customerId,siteId:PLAN().propertyId,estimatedLaborHours:66,phases:[],assignments:[{workOrderId:appointment.workOrderId,appointmentId:appointment.appointmentId,phaseId:''}]}});
    assert.equal(result.allocationEvidence.recordedSlots,6);assert.equal(result.actualLaborHours,null);assert.equal(result.canApply,false);
  }finally{await db.collection('users').doc(actors.admin.uid).set({active:true,role:'admin'});}
});

test('a missing declared support Work Order blocks totals instead of undercounting the appointment',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  await db.collection('appointments').doc(appointment.appointmentId).update({workOrderIds:[appointment.workOrderId,'MISSING-SUPPORT']});
  const activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.projectForecast,null);assert.ok(activity.issues.some(x=>x.code==='appointment_work_order_missing'));
});

test('contradictory Field identity aliases are not silently counted as project execution',async()=>{
  const project=await create();const appointment=await seedAppointment();await attach(project,appointment);
  await db.collection('workVisits').doc(uid('FIELD-BAD-ALIAS')).set({workOrderId:appointment.workOrderId,appointmentId:appointment.appointmentId,clientId:PLAN().customerId,customerId:'FOREIGN',propertyId:PLAN().propertyId,status:'completed',version:1});
  const activity=await run('get_activity',{projectId:project.projectId});assert.equal(activity.projectForecast,null);assert.ok(activity.issues.some(x=>x.code==='field_visit_reconciliation_required'));
});
