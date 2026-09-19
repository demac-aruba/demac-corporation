'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const PROJECT='demo-demac-projects';
for (const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name]||'')) throw Error('Loopback emulators required.');
}
if (process.env.GCLOUD_PROJECT!==PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo-only fixtures; production credentials prohibited.');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createProjectRegistryService}=require('./registry-service');
const {requirePhasePrerequisites}=require('./phase-completion');
const {officeReviewDocumentId,officeReviewRevisionDocumentId}=require('../fieldOperationsOfficeReview');
const app=initializeApp({projectId:PROJECT},'phase-scope-acceptance');const db=getFirestore(app);const auth=getAuth(app);
const api=createProjectRegistryService({db,verifyIdToken:(token,revoked)=>auth.verifyIdToken(token,revoked),enabled:true});
const actors={};let seq=0;
const stamp='2026-09-19T12:00:00.000Z';
const protectedCollections=['clients','properties','appointments','workOrders','workVisits','fieldOfficeReviews','fieldOfficeReviewRevisions','bookingCapacityLocks','warehouseInventory','whatsappOutboundQueue','invoices','payments'];
const base={name:'Synthetic phase lifecycle',type:'VRF Project',customerId:'PHASE-CUSTOMER',propertyId:'PHASE-PROPERTY',startsOn:'2026-09-01',estimatedCompletionOn:'2026-10-01',budgetedVanMinutes:60};
const phase=id=>({id,name:id,scopeOfWork:'Synthetic installation',completionCriteria:'Verified complete scope',plannedVanMinutes:30,dependencies:id==='PH-B'?['PH-A']:[],progressMethod:'units',unitsPlanned:2,checklist:[{id:'CL-TEST',label:'Pressure checked',required:true}]});
const confirmation={criteriaConfirmed:true,verifiedUnits:2,checklistIds:['CL-TEST']};
async function run(action,data,who='admin',requestId=`PHASE-REQUEST-${++seq}`,service=api){return service.execute({idToken:actors[who].token,command:{action,data,requestId}});}
async function read(id){return (await run('get_plan',{projectId:id})).project;}
async function status(id,phaseId='PH-A'){return run('get_phase_completion',{projectId:id,phaseId});}
async function protectedState(){const state={};for(const name of protectedCollections){const result=await db.collection(name).get();state[name]=result.docs.map(row=>[row.id,row.data()]).sort((a,b)=>a[0].localeCompare(b[0]));}return state;}
async function fixture(support=false){
 const created=await run('create_plan',{...base,phases:[phase('PH-A'),phase('PH-B')]});
 const appointmentId=`PHASE-APT-${++seq}`;const ids=[`PHASE-WO-${seq}`,...(support?[`PHASE-SUPPORT-${seq}`]:[])];
 await db.collection('appointments').doc(appointmentId).set({appointmentId,customerId:base.customerId,propertyId:base.propertyId,status:'completed',workOrderIds:ids});
 for(const id of ids){
  await db.collection('workOrders').doc(id).set({appointmentId,clientId:base.customerId,propertyId:base.propertyId,status:'Completada',appointmentDurationMinutes:360,scheduledSlots:6,vanId:id===ids[0]?'VAN-A':'VAN-B',date:'2026-09-19',time:'08:30'});
  const visitId=`VISIT-${id}`;await db.collection('workVisits').doc(visitId).set({id:visitId,workOrderId:id,appointmentId,clientId:base.customerId,propertyId:base.propertyId,status:'completed',startedAt:stamp,completedAt:'2026-09-19T14:00:00.000Z',version:2});
  const identity={workOrderId:id,appointmentId,clientId:base.customerId,propertyId:base.propertyId,visitId};const reviewId=officeReviewDocumentId(id);const revisionId=officeReviewRevisionDocumentId(reviewId,1);
  await db.collection('fieldOfficeReviews').doc(reviewId).set({fieldAuthorityVersion:1,...identity,status:'approved',currentRevisionId:revisionId,currentRevisionNumber:1,submittedAt:stamp,submittedBy:'TECH-TEST',reviewedAt:stamp,reviewedBy:'REVIEWER-TEST',createdAt:stamp,createdBy:'TECH-TEST',updatedAt:stamp,version:2});
  await db.collection('fieldOfficeReviewRevisions').doc(revisionId).set({fieldAuthorityVersion:1,...identity,reviewId,revisionNumber:1,sourceVisitVersion:2,submittedAt:stamp,submittedBy:'TECH-TEST',requestId:'PHASE-REVIEW-REQUEST',snapshot:{},version:1});
 }
 await run('attach_existing_appointment',{projectId:created.projectId,expectedVersion:1,appointmentId,phaseId:'PH-A',confirmedAssociation:true,reason:'Synthetic source association'});
 return {id:created.projectId,appointmentId,ids};
}
async function approve(f,preview,who='admin',requestId=`APPROVE-PHASE-${++seq}`,service=api){
 preview ??= await status(f.id);
 return run('approve_phase_completion',{projectId:f.id,expectedVersion:preview.projectVersion,phaseId:'PH-A',previewDigest:preview.digest,confirmation,reason:'Reviewed synthetic installation scope'},who,requestId,service);
}
before(async()=>{
 for(const [name,role] of [['admin','admin'],['operations','operations'],['finance','finance'],['technician','technician']]){
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`phase-${name}@example.test`,password:'synthetic-phase-test-password',returnSecureToken:true})});const value=await response.json();assert.ok(value.idToken);actors[name]={uid:value.localId,token:value.idToken};await db.collection('users').doc(value.localId).set({role,active:true});
 }
 await db.collection('businessSettings').doc('projects-registry').set({backendEnabled:true});await db.collection('clients').doc(base.customerId).set({name:'Synthetic client',active:true});await db.collection('properties').doc(base.propertyId).set({clientId:base.customerId,active:true});
});
after(async()=>{await deleteApp(app);});

test('preview is read-only, includes every support order and accepts overruns without changing estimates',async()=>{
 const f=await fixture(true);const before=await protectedState();const preview=await status(f.id);assert.equal(preview.canApprove,true);assert.equal(preview.sources.length,2);assert.ok(preview.proofs.length>8);assert.deepEqual(preview.blockers,[]);assert.equal((await read(f.id)).budget.currentMinutes,60);assert.deepEqual(await protectedState(),before);
});
test('approval, audit and receipt are atomic and an exact retry cannot approve twice',async()=>{
 const f=await fixture();const before=await protectedState();const preview=await status(f.id);const key=`PHASE-REPLAY-${++seq}`;const first=await approve(f,preview,'admin',key);const again=await approve(f,preview,'admin',key);assert.equal(first.version,3);assert.equal(again.replayed,true);assert.equal(again.version,3);assert.equal((await status(f.id)).status,'approved');const project=await read(f.id);assert.equal(project.budget.currentMinutes,60);assert.equal(project.actualLaborHours,undefined);assert.equal(project.phaseReviews.length,1);assert.deepEqual(await protectedState(),before);
});
test('changed source after preview rejects approval without writing a Project review',async()=>{
 const f=await fixture();const preview=await status(f.id);await db.collection('workOrders').doc(f.ids[0]).update({officeNote:'changed after preview'});await assert.rejects(approve(f,preview),{code:'phase_preview_changed'});assert.equal((await read(f.id)).phaseReviews,undefined);
});
test('partial units/checklist and pending support reports cannot close a phase',async()=>{
 const f=await fixture(true);const preview=await status(f.id);await assert.rejects(run('approve_phase_completion',{projectId:f.id,expectedVersion:2,phaseId:'PH-A',previewDigest:preview.digest,confirmation:{...confirmation,verifiedUnits:1},reason:'Not complete'}),{code:'phase_units_incomplete'});
 await db.collection('fieldOfficeReviews').doc(officeReviewDocumentId(f.ids[1])).update({status:'returned'});const next=await status(f.id);assert.equal(next.canApprove,false);assert.ok(next.blockers.includes('phase_office_approval_pending'));await assert.rejects(approve(f,next),{code:'phase_not_ready'});
});
test('only provisioned project managers may approve; client fields and stale versions cannot grant authority',async()=>{
 const f=await fixture();const preview=await status(f.id);for(const role of ['finance','technician'])await assert.rejects(approve(f,preview,role),{code:'forbidden'});
 await run('edit_metadata',{projectId:f.id,expectedVersion:2,patch:{name:'Another operator updated scope'}});await assert.rejects(approve(f,preview),{code:'version_conflict'});assert.equal((await read(f.id)).phaseReviews,undefined);
});
test('simultaneous manager approvals yield one committed review and an explicit conflict',async()=>{
 const f=await fixture();const preview=await status(f.id);const outcomes=await Promise.allSettled([approve(f,preview,'admin'),approve(f,preview,'operations')]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected'&&row.reason.code==='version_conflict').length,1);assert.equal((await read(f.id)).phaseReviews.length,1);
});
test('approved prerequisites unlock subsequent work; closure and reopening never change earlier bookings',async()=>{
 const f=await fixture();await approve(f);const before=await protectedState();let project=await read(f.id);
 await db.runTransaction(tx=>requirePhasePrerequisites({db,transaction:tx,project,phaseId:'PH-B'}),{readOnly:true});
 await assert.rejects(db.runTransaction(tx=>requirePhasePrerequisites({db,transaction:tx,project,phaseId:'PH-A'}),{readOnly:true}),{code:'project_phase_closed'});
 const previousEventId=project.phaseReviews[0].eventId;await run('reopen_phase',{projectId:f.id,phaseId:'PH-A',expectedVersion:project.version,reason:'Approved additional project work'});project=await read(f.id);
 assert.equal(project.phaseReviews[0].status,'reopened');assert.equal((await db.collection('projectEvents').doc(previousEventId).get()).exists,true);
 await assert.rejects(db.runTransaction(tx=>requirePhasePrerequisites({db,transaction:tx,project,phaseId:'PH-B'}),{readOnly:true}),{code:'project_phase_reconciliation_required'});
 await db.runTransaction(tx=>requirePhasePrerequisites({db,transaction:tx,project,phaseId:'PH-A'}),{readOnly:true});assert.deepEqual(await protectedState(),before);
});
test('Field corrections invalidate approval and block dependent bookings until renewed review',async()=>{
 const f=await fixture();await approve(f);await db.collection('fieldOfficeReviewRevisions').doc(officeReviewRevisionDocumentId(officeReviewDocumentId(f.ids[0]),1)).update({correctionTestMarker:true});assert.equal((await status(f.id)).status,'needs_review');const project=await read(f.id);await assert.rejects(db.runTransaction(tx=>requirePhasePrerequisites({db,transaction:tx,project,phaseId:'PH-B'}),{readOnly:true}),{code:'project_phase_reconciliation_required'});
});
test('an injected audit failure leaves no acceptance or receipt partially committed',async()=>{
 const f=await fixture();const preview=await status(f.id);const wrapped={collection:db.collection.bind(db),runTransaction:(callback,options)=>db.runTransaction(tx=>callback({get:tx.get.bind(tx),getAll:tx.getAll.bind(tx),set:tx.set.bind(tx),create:(ref,data)=>{if(ref.parent.id==='projectEvents')throw Error('PHASE_AUDIT_FAILURE');return tx.create(ref,data);}}),options)};
 const failing=createProjectRegistryService({db:wrapped,verifyIdToken:(token,revoked)=>auth.verifyIdToken(token,revoked),enabled:true});await assert.rejects(approve(f,preview,'admin','PHASE-ATOMIC-FAILURE',failing),/PHASE_AUDIT_FAILURE/);const project=await read(f.id);assert.equal(project.version,2);assert.equal(project.phaseReviews,undefined);
});
test('new historical associations cannot be added to an approved phase without reopening',async()=>{
 const f=await fixture();await approve(f);
 const appointmentId=`UNLINKED-PHASE-APT-${++seq}`;const workOrderId=`UNLINKED-WO-${seq}`;
 await db.collection('appointments').doc(appointmentId).set({customerId:base.customerId,propertyId:base.propertyId,status:'confirmed',workOrderIds:[workOrderId]});
 await db.collection('workOrders').doc(workOrderId).set({appointmentId,clientId:base.customerId,propertyId:base.propertyId,status:'Confirmada'});
 await assert.rejects(run('attach_existing_appointment',{projectId:f.id,expectedVersion:3,appointmentId,phaseId:'PH-A',confirmedAssociation:true,reason:'New work after closure'}),{code:'project_phase_closed'});
 assert.equal((await db.collection('projectAppointmentLinks').doc(appointmentId).get()).exists,false);
 await assert.rejects(run('set_phases',{projectId:f.id,expectedVersion:3,phases:[]}),{code:'phase_has_history'});
});
