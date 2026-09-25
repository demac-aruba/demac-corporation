'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const crypto=require('node:crypto');
const protocol=require('./fieldOperationsServiceProtocol');
const {fixture,lead,helper,office,outsider,service,seed}=require('./test-support/fieldProcedureFixture.cjs');
const {createTransitionWorkInterventionCommand}=require('./fieldOperationsInterventionMutation');
const {projectedChainState,reviewSnapshot,officeReviewDocumentId}=require('./fieldOperationsOfficeReview');
const {projectCanonicalWorkVisit}=require('./fieldOperationsAuthorityWorkVisit');
const error=code=>e=>e.code===code;
async function initials(f){
 await f.claim('indoor');await f.claim('outdoor');
 for(const [part,who] of [['indoor',lead],['outdoor',helper]]){
  for(const d of (await f.read(who)).workflow.protocol.parts[part].steps.filter(d=>d.stage==='initial')){
   for(const v of d.views)await f.photo(part,d.id,v,who);
   await f.save(part,d.id,{...(d.options.length?{result:d.options[0]}:{}),...(d.competent?{competenceConfirmed:true}:{}),...(d.id==='O02'?{measurement:{value:120,unit:'psi'}}:{})},who);
  }
 }
}
async function isolate(f){await initials(f);const b=await f.read();return f.mutate({action:'confirm_isolation',expectedSafetyRevision:b.workflow.safety.revision,competenceConfirmed:true,note:'Synthetic physical isolation recorded'});}
async function allParts(f){await isolate(f);
 for(const [part,who] of [['indoor',lead],['outdoor',helper]]){
  for(const d of (await f.read(who)).workflow.protocol.parts[part].steps.filter(d=>d.stage!=='initial')){
   for(const view of d.views)await f.photo(part,d.id,view,who);
   await f.save(part,d.id,{...(d.options.length?{result:d.options[0]}:{}),...(d.competent?{competenceConfirmed:true}:{})},who);
  }
  await f.mutate({action:'finish_part',...await f.current(part,who),safeToTest:true},who);
 }
}
async function finalized(f,result='enfria'){await allParts(f);const b=await f.read();return f.mutate({action:'record_final_test',expectedSafetyRevision:b.workflow.safety.revision,partVersions:Object.fromEntries(protocol.PARTS.map(p=>[p,b.workflow.parts[p].version])),competenceConfirmed:true,result,note:result==='enfria'?'':'Synthetic fault remains; office review required'});}
function children(f){const names=['visitAssets','workInterventions','plannedWorkDispositions','scopeChanges','fieldSaleLines','fieldApprovals','fieldEvidence','fieldMeasurements','fieldFindings','fieldChecklistResponses','fieldFreeTextResponses','fieldCustomerAcknowledgements'];return Object.fromEntries(names.map(n=>[n,f.store.all(n)]));}

test('versioned protocol retains exact 14/9 order, O09 indoor component and no default result',()=>{
 const p=protocol.protocolForService(service()),w=protocol.initialWorkflow(p);assert.equal(p.parts.indoor.steps.length,14);assert.equal(p.parts.outdoor.steps.length,9);
 assert.deepEqual(p.parts.indoor.steps.map(s=>s.id),Array.from({length:14},(_,i)=>`I${String(i+1).padStart(2,'0')}`));assert.equal(p.parts.outdoor.steps[8].targetComponent,'indoor');
 for(const part of protocol.PARTS)for(const s of Object.values(w.parts[part].steps))assert.equal(s.result,null);
 p.parts.indoor.steps.pop();assert.throws(()=>protocol.initialWorkflow(p),error('invalid_procedure_workflow'));
});
for(const s of [{name:'Standard Service'},{fieldExecutionDefinition:{version:1,reportTemplate:{id:'legacy'}}},{name:'Deep Cleaning'}])test('no implicit protocol from name or old report-template metadata '+JSON.stringify(s),()=>assert.equal(protocol.protocolForService(s),null));
for(const change of [{version:2,procedureProtocolId:protocol.PROTOCOL_ID},{version:1,procedureProtocolId:'unapproved-protocol'}])test('reject unknown versioned opt-in '+JSON.stringify(change),()=>assert.throws(()=>protocol.protocolForService({...service(),fieldExecutionDefinition:change}),error('unsupported_procedure_protocol')));

test('anonymous and unassigned cannot read or mutate and never access Storage',async()=>{const f=fixture();for(const who of [undefined,outsider]){
 await assert.rejects(()=>f.commands.read({...f.input(),identity:who}));await assert.rejects(()=>f.commands.mutate({...f.input(),identity:who,command:{action:'commit_media',captureId:'x'},requestId:'auth-test-request'}));
 }assert.equal(f.storageCalls,0);assert.equal(f.store.all('fieldOperationEvents').length,0);
});
test('simultaneous same-part claim has one winner, exact retry is read-only, changed payload conflicts',async()=>{const f=fixture();const cmd={action:'claim_part',part:'indoor',expectedPartVersion:0};const r=await Promise.allSettled([f.mutate(cmd,lead,'claim-tech-001'),f.mutate(cmd,helper,'claim-helper-001')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 const before=f.store.all('fieldOperationEvents').length;assert.equal((await f.mutate(cmd,lead,'claim-tech-001')).replayed,true);assert.equal(f.store.all('fieldOperationEvents').length,before);
 await assert.rejects(()=>f.mutate({...cmd,part:'outdoor'},lead,'claim-tech-001'),error('procedure_request_conflict'));
});
test('different-part edits preserve both authors and do not lose a concurrent update',async()=>{const f=fixture();await Promise.all([f.claim('indoor'),f.claim('outdoor')]);await Promise.all([f.save('indoor','I02',{result:'funciona'}),f.save('outdoor','O02',{result:'enfria',measurement:{value:115,unit:'psi'},competenceConfirmed:true})]);const b=await f.read();assert.equal(b.workflow.parts.indoor.steps.I02.author.userId,lead.uid);assert.equal(b.workflow.parts.outdoor.steps.O02.author.userId,helper.uid);assert.deepEqual(new Set(f.store.get('workInterventions','WI-1').performedByStaffIds),new Set([lead.staffId,helper.staffId]));});
test('claim is not visit start, execution, billing, stock or a second service',async()=>{const f=fixture();const order=f.store.get('workOrders','WO-1'),visit=f.store.get('workVisits','VISIT-1');await f.claim('indoor');assert.deepEqual(f.store.get('workOrders','WO-1'),order);assert.deepEqual(f.store.get('workVisits','VISIT-1'),visit);assert.deepEqual(f.store.get('workInterventions','WI-1').performedByStaffIds,[]);assert.equal(f.store.all('workInterventions').length,1);assert.ok(f.store.commits.flat().every(w=>['workInterventions','fieldOperationEvents'].includes(w.collection)));});
test('stale revision, another owner and revoked assignment block before writes',async()=>{const f=fixture();await f.claim('indoor');await assert.rejects(()=>f.mutate({action:'save_step',part:'indoor',stepId:'I02',expectedPartVersion:0,expectedSafetyRevision:0,result:'funciona'}),error('procedure_version_conflict'));
 await assert.rejects(()=>f.save('indoor','I02',{result:'funciona'},helper),error('procedure_part_owned_by_other'));f.revoked.add(lead.uid);await assert.rejects(()=>f.read());assert.equal(f.store.all('fieldOperationEvents').length,1);
});
test('release/recover preserve prior contribution and cannot auto-promote helper',async()=>{const f=fixture();await f.claim('indoor',helper);await f.save('indoor','I02',{result:'funciona'},helper);const before=(await f.read()).workflow.parts.indoor.steps.I02;
 const c=await f.current('indoor',lead);await assert.rejects(()=>f.mutate({action:'recover_part',part:'indoor',expectedPartVersion:c.expectedPartVersion,note:'Reassign to myself'},helper),error('permission_denied'));
 await f.mutate({action:'recover_part',part:'indoor',expectedPartVersion:c.expectedPartVersion,note:'Assigned responsible technician resumes'});const b=await f.read();assert.equal(b.workflow.parts.indoor.ownerUserId,lead.uid);assert.deepEqual(b.workflow.parts.indoor.steps.I02,before);
});
test('photos missing never become documented; optional audio/video and text are not mandatory',async()=>{const f=fixture();await f.claim('indoor');let b=await f.save('indoor','I01');assert.equal(b.workflow.parts.indoor.steps.I01.status,'needs_information');assert.deepEqual(b.stepReadiness.indoor.I01,['photo:before']);await f.photo('indoor','I01','before');b=await f.save('indoor','I01');assert.equal(b.workflow.parts.indoor.steps.I01.status,'documented');assert.equal(b.workflow.parts.indoor.steps.I01.note,'');assert.ok(b.evidence.every(e=>e.kind==='photo'));});
test('unconfirmed object remains pending and cannot count as evidence; atomic failed commit retries once',async()=>{const f=fixture();await f.claim('indoor');const cap='cap-object-1',sha256='a'.repeat(64);const b=await f.mutate({action:'prepare_media',...await f.current('indoor'),captureId:cap,stepId:'I01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:20,sha256,source:'gallery'});const r=b.workflow.pendingCaptures[cap];assert.equal(b.evidence.length,0);assert.equal(b.stepReadiness.indoor.I01.includes('photo:before'),true);
 f.objects.set(r.storagePath,{sha256,contentType:'image/jpeg',sizeBytes:20,generation:'42'});f.store.failNext();await assert.rejects(()=>f.mutate({action:'commit_media',captureId:cap},lead,'commit-capture-1'),/Injected/);assert.equal(f.store.all('fieldEvidence').length,0);assert.ok((await f.read()).workflow.pendingCaptures[cap]);
 await f.mutate({action:'commit_media',captureId:cap},lead,'commit-capture-1');assert.equal((await f.mutate({action:'commit_media',captureId:cap},lead,'commit-capture-1')).replayed,true);assert.equal(f.store.all('fieldEvidence').length,1);
});
for(const field of ['sha256','sizeBytes','contentType','generation'])test('actual Storage '+field+' mismatch blocks linking',async()=>{const f=fixture();await f.claim('indoor');const cap='cap-'+field,sha256='a'.repeat(64);const b=await f.mutate({action:'prepare_media',...await f.current('indoor'),captureId:cap,stepId:'I01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:20,sha256,source:'camera'});const r=b.workflow.pendingCaptures[cap],m={sha256,contentType:'image/jpeg',sizeBytes:20,generation:'42'};m[field]=field==='sizeBytes'?21:'incorrect';f.objects.set(r.storagePath,m);await assert.rejects(()=>f.mutate({action:'commit_media',captureId:cap}),error('procedure_media_verification_failed'));assert.equal(f.store.all('fieldEvidence').length,0);});
test('asset/context corruption and reused evidence fail closed',async()=>{const f=fixture();await f.claim('indoor');await f.photo('indoor','I01','before');const e=f.store.all('fieldEvidence')[0];f.store.put('fieldEvidence',{...e,assetId:'AC-another'});await assert.rejects(()=>f.read(),error('procedure_evidence_context_mismatch'));f.store.put('fieldEvidence',e);const wi=f.store.get('workInterventions','WI-1');wi.procedureWorkflow.parts.indoor.steps.I02.evidenceIds=[e.id];f.store.put('workInterventions',wi);await assert.rejects(()=>f.read(),error('procedure_evidence_link_conflict'));});
test('safe isolation requires initial procedures and assigned responsible confirmation',async()=>{const f=fixture();await f.claim('indoor');await assert.rejects(()=>f.save('indoor','I04'),error('procedure_isolation_required'));await assert.rejects(()=>f.mutate({action:'confirm_isolation',expectedSafetyRevision:0,competenceConfirmed:true,note:'Observed isolated'}),error('initial_checks_incomplete'));await assert.rejects(()=>f.mutate({action:'confirm_isolation',expectedSafetyRevision:0,competenceConfirmed:true,note:'Observed isolated'},helper),error('permission_denied'));});
test('competence and actually measured pressure are explicit, no invented default',async()=>{const f=fixture();await f.claim('outdoor');await assert.rejects(()=>f.save('outdoor','O02',{result:'enfria'}),error('competence_confirmation_required'));const b=await f.save('outdoor','O02',{result:'enfria',competenceConfirmed:true});assert.ok(b.stepReadiness.outdoor.O02.includes('measured_pressure'));assert.equal(b.workflow.parts.outdoor.steps.O02.measurement,null);await assert.rejects(()=>f.save('outdoor','O02',{result:'enfria',competenceConfirmed:true,measurement:{value:75,unit:'amount of gas'}}),error('invalid_pressure_unit'));});
test('before/after photos stay separate and O09 is linked to same indoor asset',async()=>{const f=fixture();await isolate(f);await assert.rejects(()=>f.photo('outdoor','O09','after'),error('procedure_before_missing'));await f.photo('outdoor','O09','before');await f.photo('outdoor','O09','after');const b=await f.save('outdoor','O09');const e=b.evidence.filter(e=>e.procedureId==='O09');assert.equal(e.length,2);assert.ok(e.every(e=>e.targetComponent==='indoor'&&e.assetId==='AC-1'));assert.notEqual(e[0].storagePath,e[1].storagePath);});
test('high risk with customer refusal remains blocked; helper cannot clear risk',async()=>{const f=fixture();await isolate(f);const b=await f.save('outdoor','O06',{result:'alto_riesgo',customerDecision:'declined',decisionPerson:'Synthetic authorized contact'});assert.equal(b.workflow.risks['risk-outdoor-O06'].status,'open');await assert.rejects(()=>f.save('indoor','I04'),error('procedure_high_risk'));await assert.rejects(()=>f.mutate({action:'resolve_risk',riskId:'risk-outdoor-O06',expectedSafetyRevision:b.workflow.safety.revision,competenceConfirmed:true,reason:'Customer declined',competentPerson:'Helper'},helper),error('permission_denied'));});
test('media survives coordination change with explicit documentary recovery, not safety approval',async()=>{const f=fixture();await f.claim('indoor');const cap='delayed-capture',sha256='a'.repeat(64);const b=await f.mutate({action:'prepare_media',...await f.current('indoor'),captureId:cap,stepId:'I01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:20,sha256,source:'camera'});f.objects.set(b.workflow.pendingCaptures[cap].storagePath,{sha256,contentType:'image/jpeg',sizeBytes:20,generation:'1'});await f.mutate({action:'report_risk',affectedParts:['indoor'],reason:'Unexpected unsafe support'});await assert.rejects(()=>f.mutate({action:'commit_media',captureId:cap}),error('procedure_media_coordination_changed'));const r=await f.mutate({action:'commit_media',captureId:cap,acknowledgeCoordinationChange:true,reason:'Recover unchanged file recorded before risk'});assert.equal(r.evidence.length,1);assert.equal(r.workflow.risks[Object.keys(r.workflow.risks)[0]].status,'open');assert.equal(r.workflow.parts.indoor.safeToTest,false);});
test('only office resolves explicit exception and not_performed is not completed maintenance',async()=>{const f=fixture();await f.claim('indoor');await f.mutate({action:'request_exception',...await f.current('indoor'),stepId:'I01',reason:'Camera unavailable before work'});let c=await f.current('indoor');delete c.expectedSafetyRevision;const cmd={action:'review_exception',...c,stepId:'I01',decision:'approve',reason:'Office recorded missing initial evidence',disposition:'not_performed'};await assert.rejects(()=>f.mutate(cmd),error('permission_denied'));const b=await f.mutate(cmd,office);assert.ok(b.stepReadiness.indoor.I01.includes('procedure_not_performed'));assert.equal(b.readiness.complete,false);});
test('two participants complete 14/9, with physical final failure documented separately',async()=>{const f=fixture();const b=await finalized(f,'no_enfria');assert.equal(b.readiness.complete,true);assert.equal(b.workflow.safety.finalTest.result,'no_enfria');assert.deepEqual(new Set(b.evidence.map(e=>e.createdBy)),new Set([lead.uid,helper.uid]));assert.ok(b.evidence.every(e=>e.kind==='photo'));assert.equal(f.store.all('workInterventions').length,1);});
test('final test is blocked by unfinished companion and stale part revision',async()=>{const f=fixture();await isolate(f);let b=await f.read();await assert.rejects(()=>f.mutate({action:'record_final_test',expectedSafetyRevision:b.workflow.safety.revision,competenceConfirmed:true,result:'enfria',partVersions:{indoor:b.workflow.parts.indoor.version,outdoor:b.workflow.parts.outdoor.version}}),error('procedure_both_parts_required'));});
test('audit failure rolls back the whole procedure update',async()=>{const f=fixture({appendAuditInTransaction:async()=>{throw Error('Injected audit failure');}});const before=f.store.get('workInterventions','WI-1');await assert.rejects(()=>f.claim('indoor'),/audit/);assert.deepEqual(f.store.get('workInterventions','WI-1'),before);});
test('pending/approved office review freezes procedure writes and file authorization',async()=>{const f=fixture();await f.claim('indoor');for(const status of ['pending','approved']){f.store.put('fieldOfficeReviews',{id:officeReviewDocumentId('WO-1'),workOrderId:'WO-1',status});await assert.rejects(()=>f.save('indoor','I02',{result:'funciona'}),error('procedure_review_locked'));}});
test('responsible may finish shared intervention only after procedure and safety completion',async()=>{const f=fixture();const transition=createTransitionWorkInterventionCommand({db:f.store.db,resolveAssignment:f.resolveAssignment,appendAuditInTransaction:f.appender,now:()=>new Date().toISOString()});const go=(who=lead)=>transition({...f.input(who),to:'completed',expectedVersion:f.store.get('workInterventions','WI-1').version,requestId:'finish-service-001'});await assert.rejects(()=>go(),error('service_procedures_incomplete'));await finalized(f);await assert.rejects(()=>go(helper),error('permission_denied'));await go();assert.equal(f.store.get('workInterventions','WI-1').status,'completed');});

module.exports={initials,isolate,allParts,finalized,children};

test('Office readiness rejects forged completed procedure state, even without the transition endpoint',async()=>{
 const f=fixture();const wi=f.store.get('workInterventions','WI-1');f.store.put('workInterventions',{...wi,status:'completed',completedAt:'2026-09-24T13:00:00.000Z',resultCode:'completed'});
 const state=projectedChainState({visits:[projectCanonicalWorkVisit(f.store.get('workVisits','VISIT-1'))],children:children(f),identity:{allowedActions:['read','visit.complete']}});
 assert.equal(state.allowed,false);assert.ok(state.blockers.some(b=>b.code==='service_procedures_incomplete'));
});
test('Office snapshot freezes shared protocol, actual authors and private evidence metadata',async()=>{
 const f=fixture();await finalized(f);const wi=f.store.get('workInterventions','WI-1');f.store.put('workInterventions',{...wi,status:'completed',completedAt:'2026-09-24T13:00:00.000Z',resultCode:'completed'});
 const state=projectedChainState({visits:[projectCanonicalWorkVisit(f.store.get('workVisits','VISIT-1'))],children:children(f),identity:{allowedActions:['read','visit.complete']}});
 assert.equal(state.allowed,true);const snap=reviewSnapshot(state);assert.equal(snap.interventions[0].procedureWorkflow.protocol.id,protocol.PROTOCOL_ID);assert.equal(snap.procedureEvidence.length,f.store.all('fieldEvidence').length);
 const frozen=JSON.stringify(snap);state.interventions[0].procedureWorkflow.parts.indoor.ownerName='Changed later';assert.equal(JSON.stringify(snap),frozen);
});
test('Office return/correction preserves prior revision and resubmits before approval; helper cannot close visit',async()=>{
 const {createSubmitOfficeReviewCommand,createDecideOfficeReviewCommand}=require('./fieldOperationsOfficeReview');
 const f=fixture();await finalized(f);
 const transition=createTransitionWorkInterventionCommand({db:f.store.db,resolveAssignment:f.resolveAssignment,appendAuditInTransaction:f.appender,now:()=>new Date().toISOString()});
 await transition({...f.input(),to:'completed',expectedVersion:f.store.get('workInterventions','WI-1').version,requestId:'close-before-submit-001'});
 const submit=createSubmitOfficeReviewCommand({db:f.store.db,resolveAssignment:f.resolveAssignment,appendAuditInTransaction:f.appender});
 const request={identity:lead,visitId:'VISIT-1',expectedVersion:f.store.get('workVisits','VISIT-1').version,requestId:'office-submit-procedures-001'};
 await assert.rejects(()=>submit({...request,identity:helper}),error('permission_denied'));const sent=await submit(request);assert.equal(sent.review.status,'pending');
 const old=JSON.stringify(f.store.all('fieldOfficeReviewRevisions'));
 const decide=createDecideOfficeReviewCommand({db:f.store.db,appendAuditInTransaction:f.appender});
 await decide({identity:office,reviewId:sent.review.id,decision:'return',note:'Clarify the final functional result',expectedVersion:sent.review.version,requestId:'office-return-procedures-001'});
 await f.mutate({action:'reopen_for_correction',expectedVersion:f.store.get('workInterventions','WI-1').version,note:'Correct returned documentation and reconfirm safe workflow'});
 assert.equal(JSON.stringify(f.store.all('fieldOfficeReviewRevisions')),old);assert.equal(f.store.get('workInterventions','WI-1').status,'in_progress');assert.equal((await f.read()).workflow.safety.finalTest,null);
 assert.equal(f.store.all('fieldBillingCandidates').length,0);assert.equal(f.store.all('fieldInventoryHandoffs').length,0);
});
test('starting a second intervention cannot bypass the same-air unresolved risk',async()=>{
 const f=fixture();await f.mutate({action:'report_risk',affectedParts:['indoor','outdoor'],reason:'Unsafe supply needs inspection'});
 const wi=f.store.get('workInterventions','WI-1');f.store.put('workInterventions',{...wi,id:'WI-2',status:'confirmed',procedureWorkflow:null});
 const transition=createTransitionWorkInterventionCommand({db:f.store.db,resolveAssignment:f.resolveAssignment,appendAuditInTransaction:f.appender});
 await assert.rejects(()=>transition({...f.input(),interventionId:'WI-2',to:'in_progress',expectedVersion:wi.version,requestId:'start-bypass-risk-001'}),error('field_asset_protocol_active'));
});
test('lost companion capture has an office-audited recovery path, not a permanent lock or invented photo',async()=>{
 const f=fixture();await f.claim('outdoor');const captureId='lost-phone-capture';const b=await f.mutate({action:'prepare_media',...await f.current('outdoor'),captureId,stepId:'O01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:20,sha256:'b'.repeat(64),source:'camera'},helper);
 await assert.rejects(()=>f.mutate({action:'recover_part',part:'outdoor',expectedPartVersion:b.workflow.parts.outdoor.version,note:'Companion phone unavailable'}),error('procedure_upload_pending'));
 await assert.rejects(()=>f.mutate({action:'abandon_capture',captureId,expectedSafetyRevision:b.workflow.safety.revision,reason:'Unreachable capture'}),error('permission_denied'));
 const r=await f.mutate({action:'abandon_capture',captureId,expectedSafetyRevision:b.workflow.safety.revision,reason:'Office records unavailable original; documentary exception still required'},office);
 await f.mutate({action:'recover_part',part:'outdoor',expectedPartVersion:r.workflow.parts.outdoor.version,note:'Responsible technician resumes with missing-view notice'});
 assert.equal((await f.read()).workflow.parts.outdoor.ownerUserId,lead.uid);assert.ok((await f.read()).stepReadiness.outdoor.O01.includes('photo:before'));
 assert.equal(f.store.all('fieldEvidence').length,0);const event=f.store.all('fieldOperationEvents').find(e=>e.type==='procedure_abandon_capture');assert.equal(event.after.abandonedCapture.ownerUserId,helper.uid);
});
test('same account relinked to another employee cannot upload an old employee capture',async()=>{
 const f=fixture();await f.claim('indoor');await f.mutate({action:'prepare_media',...await f.current('indoor'),captureId:'identity-capture',stepId:'I01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:20,sha256:'b'.repeat(64),source:'camera'});
 await assert.rejects(()=>f.commands.authorizeUpload({...f.input({...lead,staffId:'replacement-staff'}),captureId:'identity-capture'}),error('permission_denied'));assert.equal(f.storageCalls,0);
});
