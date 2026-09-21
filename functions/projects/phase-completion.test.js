'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./registry-domain');
const p = require('./phase-completion');
const phase = () => ({ id:'PH-A',name:'Installation',scopeOfWork:'Install the defined scope',completionCriteria:'Verify the complete scope',plannedVanMinutes:60,dependencies:[],progressMethod:'units',unitsPlanned:2,checklist:[{id:'CL-A',label:'Verify installation',required:true},{id:'CL-B',label:'Optional',required:false}] });
const plan = () => ({ id:'P-TEST',phases:[phase()],schemaVersion:1,version:1,customerId:'C-TEST',propertyId:'S-TEST',planningStatus:'Planned',budget:{unit:'van_minutes',originalMinutes:60,currentMinutes:60,revision:1} });
const confirm = () => ({ criteriaConfirmed:true,verifiedUnits:2,checklistIds:['CL-A'] });
const row = () => ({ workOrderId:'WO-TEST',cancelled:false,temporaryHold:false,plannedVanMinutes:700,review:{status:'approved',visitId:'V-TEST'},visits:[{id:'V-TEST',status:'completed'}] });
function snapshot(path, seconds=1, nanoseconds=7, value={}) { return { exists:true,ref:{path},id:path.split('/')[1],updateTime:{seconds,nanoseconds},data:()=>structuredClone(value) }; }
function approvedFixture() {
  const project=plan(); const now='2026-09-19T12:00:00.000Z';
  const proofs=[p.sourceVersion(snapshot('projectAppointmentLinks/A-TEST')),p.sourceVersion(snapshot('workOrders/WO-TEST'))];
  const entry={phaseId:'PH-A',status:'approved',eventId:'EV-TEST',definitionHash:d.digest(phase()),reviewedBy:'OWNER-TEST',reviewedAt:now};
  project.phaseReviews=[entry];
  const event={projectId:project.id,action:'approve_phase_completion',actorId:entry.reviewedBy,occurredAt:now,phaseCompletion:{phaseId:'PH-A',proofs,prerequisites:[],confirmation:confirm(),digest:p.signature(phase(),proofs,[])}};
  const docs=new Map([['projectEvents/EV-TEST',snapshot('projectEvents/EV-TEST',1,1,event)],...proofs.map(proof=>[proof.path,snapshot(proof.path)])]);
  const reads=[];
  const db={collection:name=>({doc:id=>({path:`${name}/${id}`}),where:(field,op,value)=>{assert.equal(name,'projectAppointmentLinks');return {where:()=>({limit:n=>({limit:n})})};}})};
  const transaction={getAll:async(...refs)=>{reads.push(...refs.map(ref=>ref.path));return refs.map(ref=>docs.get(ref.path)||{exists:false});},get:async query=>{assert.ok(query.limit<=51);return {docs:[docs.get('projectAppointmentLinks/A-TEST')]};},set(){assert.fail('Reader cannot write');},create(){assert.fail('Reader cannot write');}};
  return {db,transaction,project,event,docs,reads};
}

test('completion confirmation requires explicit scope review, not time allocation',()=>{
 assert.deepEqual(p.completionConfirmation(phase(),confirm()),confirm());
 assert.throws(()=>p.completionConfirmation(phase(),{...confirm(),criteriaConfirmed:false}),{code:'phase_confirmation_required'});
});
test('all planned units must be verified without writing Field unit totals',()=>{
 for(const n of [0,1,3,2.1,'2',null])assert.throws(()=>p.completionConfirmation(phase(),{...confirm(),verifiedUnits:n}),{code:'phase_units_incomplete'});
});
test('non-unit methods cannot silently accept invented unit counts',()=>{
 for(const method of ['checklist','hours','approval']){const ph={...phase(),progressMethod:method};assert.throws(()=>p.completionConfirmation(ph,confirm()),{code:'phase_units_incomplete'});assert.equal(p.completionConfirmation(ph,{...confirm(),verifiedUnits:null}).verifiedUnits,null);}
});
test('required checklist items apply to every phase method; optional items do not block',()=>{
 assert.throws(()=>p.completionConfirmation(phase(),{...confirm(),checklistIds:[]}),{code:'phase_checklist_incomplete'});
 assert.deepEqual(p.completionConfirmation(phase(),confirm()).checklistIds,['CL-A']);
});
test('unknown or repeated checklist identities fail closed',()=>{
 for(const checklistIds of [['CL-OTHER'],['CL-A','CL-A']])assert.throws(()=>p.completionConfirmation(phase(),{...confirm(),checklistIds}),{code:'phase_checklist_incomplete'});
});
test('checklist method with an empty definition cannot claim completed scope',()=>{
 assert.throws(()=>p.completionConfirmation({...phase(),progressMethod:'checklist',checklist:[]},{...confirm(),verifiedUnits:null,checklistIds:[]}),{code:'phase_checklist_incomplete'});
});
test('over-budget approved work is eligible; planned minutes do not become physical evidence',()=>{
 assert.deepEqual(p.evidenceIssues([row()],[],true),[]);
 assert.ok(p.evidenceIssues([{...row(),review:null}],[],true).includes('phase_office_approval_pending'));
});
test('no work and all-cancelled work are not a completed phase',()=>{
 for(const rows of [[],[{...row(),cancelled:true}]])assert.ok(p.evidenceIssues(rows,[],true).includes('phase_no_completed_work'));
});
test('temporary holds and missing office approval block closing, not over-budget scheduling',()=>{
 assert.ok(p.evidenceIssues([{...row(),temporaryHold:true}],[],true).includes('phase_temporary_hold_pending'));
 for(const status of ['pending','returned'])assert.ok(p.evidenceIssues([{...row(),review:{status}}],[],true).includes('phase_office_approval_pending'));
});
test('open visits and absent completion cannot be mistaken for work finished',()=>{
 for(const status of ['not_started','on_the_way','on_site','in_progress','pending','ready_for_office_review'])assert.ok(p.evidenceIssues([{...row(),visits:[{id:'V-TEST',status}]}],[],true).includes('phase_execution_pending'));
 assert.ok(p.evidenceIssues([{...row(),visits:[]}],[],true).includes('phase_execution_pending'));
});
test('a terminal return-visit history is retained when final work is complete and approved',()=>{
 assert.deepEqual(p.evidenceIssues([{...row(),visits:[{id:'V-OLD',status:'requires_return_visit'},{id:'V-TEST',previousVisitId:'V-OLD',status:'completed'}]}],[],true),[]);
});
test('incomplete reads and inherited identity conflicts stay blocking',()=>{
 assert.ok(p.evidenceIssues([row()],[],false).includes('phase_evidence_incomplete'));
 assert.ok(p.evidenceIssues([row()],[{code:'work_identity_conflict'}],true).includes('work_identity_conflict'));
});
test('source versions preserve nanoseconds; no rounding or credentials in proof',()=>{
 assert.deepEqual(p.sourceVersion(snapshot('workOrders/WO-TEST',123,456)),{path:'workOrders/WO-TEST',seconds:123,nanoseconds:456});
 assert.throws(()=>p.sourceVersion({...snapshot('workOrders/WO-TEST'),updateTime:null}),{code:'phase_source_version_missing'});
});
test('only canonical scope collections may enter approval evidence',()=>{
 for(const path of ['users/OWNER','payments/PAY','appointments/A/secret/S','workVisits/../data'])assert.throws(()=>p.sourceVersion(snapshot(path)));
});
test('signature is stable for source order and changes for revisions or criteria',()=>{
 const proofs=[p.sourceVersion(snapshot('appointments/A')),p.sourceVersion(snapshot('workOrders/WO'))];
 assert.equal(p.signature(phase(),proofs,[]),p.signature(phase(),[...proofs].reverse(),[]));
 assert.notEqual(p.signature(phase(),proofs,[]),p.signature({...phase(),completionCriteria:'Changed'},proofs,[]));
 assert.notEqual(p.signature(phase(),proofs,[]),p.signature(phase(),[{...proofs[0],nanoseconds:9},proofs[1]],[]));
});
test('legacy project without acceptance records remains readable and unapproved',()=>{
 assert.equal(p.recordedPhaseReview(plan(),'PH-A'),null);
});
test('duplicate or orphaned phase approval metadata requires reconciliation',()=>{
 const f=approvedFixture();const entry=f.project.phaseReviews[0];
 assert.throws(()=>p.recordedPhaseReview({...f.project,phaseReviews:[entry,entry]},'PH-A'),{code:'phase_review_conflict'});
 assert.throws(()=>p.recordedPhaseReview({...f.project,phaseReviews:[{...entry,phaseId:'PH-MISSING'}]},'PH-A'),{code:'unknown_project_phase'});
});
test('current approval verifies exact source document versions read-only',async()=>{
 const f=approvedFixture();const before=JSON.stringify(f.project);const reader=p.completionReader(f);
 assert.equal((await reader.validate('PH-A')).valid,true);const count=f.reads.length;
 assert.equal((await reader.validate('PH-A')).valid,true);assert.equal(f.reads.length,count,'Cache is transaction-scoped');assert.equal(JSON.stringify(f.project),before);
});
test('a changed source revision, even within the same millisecond, invalidates approval',async()=>{
 const f=approvedFixture();f.docs.set('workOrders/WO-TEST',snapshot('workOrders/WO-TEST',1,8));
 assert.equal((await p.completionReader(f).validate('PH-A')).reason,'phase_source_changed');
});
test('missing event/source and tampered signature never unlock prerequisites',async()=>{
 for(const change of [f=>f.docs.delete('projectEvents/EV-TEST'),f=>f.docs.delete('workOrders/WO-TEST'),f=>{f.event.phaseCompletion.digest='0'.repeat(64);f.docs.set('projectEvents/EV-TEST',snapshot('projectEvents/EV-TEST',1,1,f.event));}]){
 const f=approvedFixture();change(f);assert.equal((await p.completionReader(f).validate('PH-A')).valid,false);}
});
test('new links outside an approval snapshot invalidate its current applicability',async()=>{
 const f=approvedFixture();f.transaction.get=async()=>({docs:[f.docs.get('projectAppointmentLinks/A-TEST'),snapshot('projectAppointmentLinks/A-NEW')]});
 assert.equal((await p.completionReader(f).validate('PH-A')).reason,'phase_links_changed');
});
test('scope edits require renewed acceptance rather than reusing stale evidence',async()=>{
 const f=approvedFixture();f.project.phases[0].scopeOfWork='Different scope';
 assert.equal((await p.completionReader(f).validate('PH-A')).reason,'phase_definition_changed');
});
test('ordinary/general project bookings do not read phase sources',async()=>{
 await p.requirePhasePrerequisites({project:plan(),phaseId:null,db:null,transaction:null});
 await p.requirePhasePrerequisites({project:plan(),phaseId:'PH-A',db:null,transaction:null});
});
test('a closed phase must be explicitly reopened before more bookings',async()=>{
 const f=approvedFixture();await assert.rejects(p.requirePhasePrerequisites({...f,phaseId:'PH-A'}),{code:'project_phase_closed'});
});
test('unapproved dependencies cannot be unlocked with a browser percentage',async()=>{
 const f=approvedFixture();f.project.phaseReviews=[];f.project.physicalCompletionPercent=100;f.project.phases.push({...phase(),id:'PH-B',dependencies:['PH-A']});
 await assert.rejects(p.requirePhasePrerequisites({...f,phaseId:'PH-B'}),{code:'project_phase_reconciliation_required'});
});
test('current approved prerequisites permit the next phase while preserving original planning',async()=>{
 const f=approvedFixture();f.project.phases.push({...phase(),id:'PH-B',dependencies:['PH-A']});
 const before=JSON.stringify(f.project);await p.requirePhasePrerequisites({...f,phaseId:'PH-B'});assert.equal(JSON.stringify(f.project),before);
});
test('reopening is additive history through registry event references, with a required reason',async()=>{
 const f=approvedFixture();const args={...f,principal:{uid:'OWNER-TEST'},occurredAt:'2026-09-19T14:00:00.000Z',eventId:'EV-REOPEN',input:{action:'reopen_phase',data:{projectId:f.project.id,expectedVersion:1,phaseId:'PH-A',reason:'Additional work'}}};
 const result=await p.preparePhaseCompletion(args);assert.equal(result.next.phaseReviews[0].status,'reopened');assert.equal(result.evidence.previousEventId,'EV-TEST');assert.equal(f.project.phaseReviews[0].status,'approved');
 args.input.data.reason='';await assert.rejects(p.preparePhaseCompletion(args),{code:'invalid_text'});
});

test('a newer return visit invalidates completion even when an older visit is completed',()=>{
 const record={...row(),visits:[{id:'V-TEST',status:'completed'},{id:'V-NEW',previousVisitId:'V-TEST',status:'requires_return_visit'}]};
 assert.ok(p.evidenceIssues([record],[],true).includes('phase_execution_pending'));
});
test('disconnected visit histories cannot certify a phase',()=>{
 assert.ok(p.evidenceIssues([{...row(),visits:[{id:'V-TEST',status:'completed'},{id:'V-OTHER',status:'completed'}]}],[],true).includes('phase_visit_chain_conflict'));
});
