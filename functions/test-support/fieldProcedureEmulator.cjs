'use strict';
// Actual HTTP, Auth, Firestore transactions and Storage in the exact loopback demo.
// No browser/UI acceptance and no hosted preview are claimed by this test.
const {PROJECT,assertIsolated}=require('./dwellingsIsolation.cjs');assertIsolated();
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const sourceFiles=['functions/test-support/fieldProcedureEmulator.cjs','functions/test-support/fieldProcedureFixture.cjs','functions/fieldOperationsAuthority.js','functions/fieldOperationsProcedureWorkflow.js','functions/fieldOperationsServiceProtocol.js','functions/fieldOperationsProcedureMedia.js','functions/fieldOperationsOfficeReview.js'];
const sourceHead=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sourceManifest=sourceFiles.map(file=>{
 const bytes=fs.readFileSync(path.join(root,file));
 assert.deepEqual(bytes,cp.execFileSync('git',['show',`${sourceHead}:${file}`],{cwd:root}),`Executed source differs from checkout: ${file}`);
 return {file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
});
console.log(JSON.stringify({test:'field-procedure-http-v1',sourceHead,sourceManifest}));
const syntheticResults=Object.freeze({I02:'funciona',I03:'enfria',O02:'enfria',O03:'buen_estado',O06:'buen_estado',O07:'buen_estado',O08:'buen_estado'});
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore'),{getStorage}=require('firebase-admin/storage');
const {createFieldOperationsApi}=require('../fieldOperationsAuthority');
const {createFieldAuditAppender}=require('../fieldOperationsAudit');
const {createMutationAssignmentResolver}=require('../fieldOperationsMutationAssignment');
const {createPlannedWorkInterventionCommand}=require('../fieldOperationsVisitInterventions');
const {createTransitionWorkInterventionCommand}=require('../fieldOperationsInterventionMutation');
const {createProcedureWorkflowCommands}=require('../fieldOperationsProcedureWorkflow');
const {createProcedureMediaStore}=require('../fieldOperationsProcedureMedia');
const {createSubmitOfficeReviewCommand,createDecideOfficeReviewCommand}=require('../fieldOperationsOfficeReview');
const {seed,lead,helper,office,outsider}=require('./fieldProcedureFixture.cjs');
const {arubaDateParts}=require('../bookingSchedulingPrimitives');
const app=initializeApp({projectId:PROJECT,storageBucket:`${PROJECT}.appspot.com`},'field-procedure-integration');
const db=getFirestore(app),auth=getAuth(app),bucket=getStorage(app).bucket(),groups=[];let server,stage='start';
function check(name){groups.push(name);console.log('PASS '+name);}
function png(index){
 // An actual synthetic one-pixel PNG, varied per capture. Not a real service photograph.
 const crc=b=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,body)=>{const data=Buffer.concat([Buffer.from(name),body]),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(body.length);checksum.writeUInt32BE(crc(data));return Buffer.concat([length,data,checksum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,index%256,(index*7)%256,(index*13)%256]))),chunk('IEND',Buffer.alloc(0))]);
}
async function main(){
 stage='synthetic-seed';const fixture=seed();delete fixture.workInterventions;fixture.workOrders[0].date=arubaDateParts(new Date()).date;fixture.workOrders[0].vanId='VAN-9';
 const batch=db.batch();for(const [collection,rows] of Object.entries(fixture))for(const row of rows)batch.create(db.doc(`${collection}/${row.id}`),row);
 batch.create(db.doc('vans/VAN-9'),{id:'VAN-9',name:'DEMO Procedure Van 9',responsibleStaffId:lead.staffId,regularHelperId:helper.staffId,technicianIds:[lead.staffId,helper.staffId]});
 const tokens=new Map();
 for(const who of [lead,helper,office,outsider]){
   const password=crypto.randomBytes(24).toString('base64url'),email=`${who.uid}@field-test.invalid`;
   await auth.createUser({uid:who.uid,email,password,displayName:who.name});
   batch.create(db.doc(`users/${who.uid}`),{active:true,role:who.role,name:who.name,staffId:who.staffId||'',email});
   if(who.staffId)batch.create(db.doc(`staffProfiles/${who.staffId}`),{active:true,name:who.name,availability:'Disponible'});
   const r=await fetch('http://127.0.0.1:9297/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});assert.equal(r.status,200);tokens.set(who.uid,(await r.json()).idToken);
 }
 await batch.commit();
 const resolveAssignment=createMutationAssignmentResolver({db}),appendAuditInTransaction=createFieldAuditAppender({db});
 const media=createProcedureMediaStore(bucket),commands=createProcedureWorkflowCommands({db,resolveAssignment,appendAuditInTransaction,verifyStoredMedia:media.verify});
 const api=createFieldOperationsApi({db,verifyIdToken:t=>auth.verifyIdToken(t,true),procedureCommands:commands,procedureMediaStore:media,
   createPlannedWorkIntervention:createPlannedWorkInterventionCommand({db,resolveAssignment,appendAuditInTransaction}),
   transitionWorkIntervention:createTransitionWorkInterventionCommand({db,resolveAssignment,appendAuditInTransaction}),
   submitOfficeReview:createSubmitOfficeReviewCommand({db,resolveAssignment,appendAuditInTransaction}),decideOfficeReview:createDecideOfficeReviewCommand({db,appendAuditInTransaction})});
 server=http.createServer(async(req,res)=>{
  try{const chunks=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>22*1024*1024)throw Error('Request too large');chunks.push(chunk);}const rawBody=Buffer.concat(chunks),u=new URL(req.url,'http://127.0.0.1');
   const request={method:req.method,headers:req.headers,query:Object.fromEntries(u.searchParams),rawBody,body:(req.headers['content-type']||'').includes('application/json')?JSON.parse(rawBody.toString()||'{}'):null};
   const out=await api.handle(request);res.writeHead(out.status,{...out.headers,...(!Buffer.isBuffer(out.body)?{'Content-Type':'application/json'}:{})});res.end(Buffer.isBuffer(out.body)?out.body:JSON.stringify(out.body));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"test_server_error"}');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 let seq=0,interventionId;
 const headers=who=>({'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tokens.get(who.uid)}`}:{})});
 async function raw(action,data,who=lead){const response=await fetch(origin,{method:'POST',headers:headers(who),body:JSON.stringify({action,data})});return{status:response.status,body:await response.json()};}
 async function call(action,data,who=lead){const r=await raw(action,data,who);assert.equal(r.status,200,`${stage}: ${action}: ${r.body.error?.code||'error'}`);return r.body;}
 const data=()=>({visitId:'VISIT-1',interventionId});
 const read=who=>call('get_procedure_workspace',data(),who||lead);
 const mutate=(command,who=lead,requestId)=>call('record_procedure_action',{...data(),command,requestId:requestId||`emulator-procedure-${++seq}`},who);
 stage='create-start';const created=await call('create_planned_intervention',{visitId:'VISIT-1',visitAssetId:'VA-1',plannedWorkLineId:'line-1',serviceCatalogItemId:'service-1',requestId:'emulator-create-service-001'},helper);interventionId=created.workIntervention.id;
 assert.equal(created.workIntervention.status,'confirmed');assert.deepEqual(created.workIntervention.performedByStaffIds,[]);
 await call('transition_intervention',{...data(),to:'in_progress',expectedVersion:created.workIntervention.version,requestId:'emulator-start-service-001'});
 check('helper confirms one canonical service; only responsible starts shared execution');
 stage='actual-contention';const claim={action:'claim_part',part:'indoor',expectedPartVersion:0};const contested=await Promise.all([raw('record_procedure_action',{...data(),command:claim,requestId:'emulator-race-tech'},lead),raw('record_procedure_action',{...data(),command:claim,requestId:'emulator-race-helper'},helper)]);assert.equal(contested.filter(r=>r.status===200).length,1);assert.equal(contested.filter(r=>r.status===409).length,1);
 const owners={indoor:contested[0].status===200?lead:helper,outdoor:contested[0].status===200?helper:lead};await mutate({action:'claim_part',part:'outdoor',expectedPartVersion:0},owners.outdoor);
 assert.equal((await raw('get_procedure_workspace',data(),outsider)).status,403);assert.equal((await raw('get_procedure_workspace',data(),null)).status,401);
 check('real Firestore contention has exactly one winner; outsider and anonymous denied');
 stage='media-procedures';
 async function capture(part,stepId,view){const who=owners[part],b=await read(who),captureId=`emulator-capture-${++seq}`,bytes=png(seq),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  await mutate({action:'prepare_media',part,stepId,expectedPartVersion:b.workflow.parts[part].version,expectedSafetyRevision:b.workflow.safety.revision,captureId,kind:'photo',view,contentType:'image/png',sizeBytes:bytes.length,sha256,source:'camera'},who);
  const u=origin+'/?'+new URLSearchParams({procedureMedia:'upload',...data(),captureId});
  const request={method:'POST',headers:{Authorization:`Bearer ${tokens.get(who.uid)}`,'Content-Type':'image/png'},body:bytes};let response=await fetch(u,request);assert.equal(response.status,200);assert.equal((await response.json()).linked,false);
  response=await fetch(u,request);assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
  const id=`emulator-commit-${seq}`;const linked=await mutate({action:'commit_media',captureId},who,id);assert.equal((await mutate({action:'commit_media',captureId},who,id)).replayed,true);
  const e=linked.evidence.find(e=>e.id===linked.mutationResult.evidenceId),download=origin+'/?'+new URLSearchParams({procedureMedia:'read',...data(),evidenceId:e.id});
  const denied=await fetch(download,{headers:{Authorization:`Bearer ${tokens.get(outsider.uid)}`}});assert.equal(denied.status,403);
  const permitted=await fetch(download,{headers:{Authorization:`Bearer ${tokens.get(who.uid)}`}});assert.equal(permitted.status,200);assert.deepEqual(Buffer.from(await permitted.arrayBuffer()),bytes);
 }
 async function completeStep(part,d){stage=`procedure:${part}:${d.id}`;const who=owners[part];if(d.options.length)assert.ok(d.options.includes(syntheticResults[d.id]),`Synthetic result must be an explicit authorized protocol value: ${d.id}`);for(const view of d.views)await capture(part,d.id,view);const b=await read(who);
  const r=await mutate({action:'save_step',part,stepId:d.id,expectedPartVersion:b.workflow.parts[part].version,expectedSafetyRevision:b.workflow.safety.revision,complete:true,...(d.options.length?{result:syntheticResults[d.id]}:{}),...(d.competent?{competenceConfirmed:true}:{}),...(d.id==='O02'?{measurement:{value:110,unit:'psi'}}:{})},who);assert.equal(r.workflow.parts[part].steps[d.id].status,'documented');
 }
 const definition=(await read()).workflow.protocol;
 for(const part of ['indoor','outdoor'])for(const d of definition.parts[part].steps.filter(d=>d.stage==='initial'))await completeStep(part,d);
 let b=await read();await mutate({action:'confirm_isolation',expectedSafetyRevision:b.workflow.safety.revision,competenceConfirmed:true,note:'Synthetic physical isolation assertion, not real equipment'});
 for(const part of ['indoor','outdoor']){for(const d of definition.parts[part].steps.filter(d=>d.stage==='isolated'))await completeStep(part,d);b=await read(owners[part]);await mutate({action:'finish_part',part,expectedPartVersion:b.workflow.parts[part].version,expectedSafetyRevision:b.workflow.safety.revision,safeToTest:true},owners[part]);}
 b=await read();assert.equal(b.readiness.complete,false);assert.ok(b.readiness.missing.some(m=>m.fields.includes('coordinated_final_test')));
 await mutate({action:'record_final_test',expectedSafetyRevision:b.workflow.safety.revision,partVersions:{indoor:b.workflow.parts.indoor.version,outdoor:b.workflow.parts.outdoor.version},competenceConfirmed:true,result:'no_enfria',note:'Synthetic continued fault, no invented successful repair'});
 b=await read();assert.equal(b.readiness.complete,true);assert.equal(b.workflow.protocol.parts.indoor.steps.length,14);assert.equal(b.workflow.protocol.parts.outdoor.steps.length,9);assert.equal(Object.keys(b.workflow.pendingCaptures).length,0);
 check('all 14/9 results and original private files persist, replay once, and final failure stays documented');
 stage='office-roundtrip';
 await call('transition_intervention',{...data(),to:'completed',expectedVersion:b.interventionVersion,requestId:'emulator-finish-service-001'});
 let visit=(await db.doc('workVisits/VISIT-1').get()).data();const submission={visitId:'VISIT-1',expectedVersion:visit.version,requestId:'emulator-office-submit-001'};
 assert.equal((await raw('submit_visit_for_office_review',submission,helper)).status,403);let sent=await call('submit_visit_for_office_review',submission);
 const frozen=(await db.doc(`fieldOfficeReviewRevisions/${sent.review.currentRevisionId}`).get()).data();assert.equal(frozen.snapshot.interventions[0].procedureWorkflow.safety.finalTest.result,'no_enfria');assert.ok(frozen.snapshot.procedureEvidence.length>20);
 await call('decide_office_review',{reviewId:sent.review.id,decision:'return',note:'Synthetic office correction requested',expectedVersion:sent.review.version,requestId:'emulator-office-return-001'},office);
 visit=(await db.doc('workVisits/VISIT-1').get()).data();sent=await call('submit_visit_for_office_review',{visitId:'VISIT-1',expectedVersion:visit.version,requestId:'emulator-office-resubmit-001',correctionNote:'Clarified that equipment remains faulty; preserved original observations'});
 await call('decide_office_review',{reviewId:sent.review.id,decision:'approve',note:'Synthetic document review only',expectedVersion:sent.review.version,requestId:'emulator-office-approve-001'},office);
 assert.deepEqual((await db.doc(`fieldOfficeReviewRevisions/${frozen.id}`).get()).data(),frozen);assert.equal((await db.collection('workInterventions').get()).size,1);assert.equal((await db.collection('workVisits').get()).size,1);
 for(const c of ['inventoryMovements','invoices','whatsappOutboundQueue'])assert.equal((await db.collection(c).get()).size,0);
 check('responsible submits, office returns/approves immutable revisions, no stock/invoice/message effect');
}
main().then(()=>{const dir=process.env.FIELD_PROCEDURE_TEST_RESULTS;if(dir){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'emulator-report.json'),JSON.stringify({source:sourceHead,trigger:process.env.GITHUB_SHA,sourceManifest,synthetic:true,backend:'loopback-emulators',groups,passed:true,notClaimed:['hosted-preview','browser-UI','physical-device-testing']},null,2));}}).catch(error=>{console.error(JSON.stringify({stage,code:error.code||'assertion',message:error.message}));process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app);});
