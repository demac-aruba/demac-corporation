'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const { prepareInitialCharges } = require('./appointmentCharges');
const PROJECT = 'demo-demac-charges';
if(process.env.GCLOUD_PROJECT!==PROJECT || process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8404' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Requires isolated loopback demo Firestore with no production credentials.');
const app=initializeApp({projectId:PROJECT},'charge-tests'),db=getFirestore(app);
const api=createOfficeBookingAuthorityFacade({db,verifyIdToken:async token=>{if(token==='expired')throw Error('Expired token');return {uid:token};}});
const call=(action,data={},uid='office')=>api.handle({method:'POST',headers:{authorization:`Bearer ${uid}`},body:{action,data:{appointmentId:'apt',editSessionId:'emulator-tab-00000000001',editToken:'emulator-lease',...data}}});
const pay=(requestId,expectedVersion=0)=>({requestId,expectedVersion,payment:{method:'cash',amount:'100'}});
const line={id:'work',label:'Synthetic service',quantity:1,serviceId:'synthetic'};
beforeEach(async()=>{const cleared=await fetch(`http://127.0.0.1:8404/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,{method:'DELETE'});assert.equal(cleared.ok,true);await Promise.all(Object.entries({'services/synthetic':{name:'Synthetic service',basePrice:125,active:true},'appointments/apt/chargeEditing/current':{ownerId:'office',ownerName:'Test office',sessionId:'emulator-tab-00000000001',token:'emulator-lease',expiresAtMs:Date.now()+90000},'users/office':{role:'office',active:true},'users/accounting':{role:'accounting',active:true},'users/tech':{role:'technician',active:true},'appointments/apt':{customerId:'customer',propertyId:'property',status:'confirmed',workOrderIds:['wo']},'workOrders/wo':{status:'Confirmada',scheduledSlots:2}}).map(([path,value])=>db.doc(path).set(value)));});
after(async()=>{await db.terminate();await deleteApp(app);});
test('real Firestore saves capacity-specific catalog selections without a separate BTU confirmation',async()=>{
await db.doc('businessSettings/company-service-pricing-rules').set({version:1,standardServiceSplit:[{btu:12000,price:125},{btu:18000,price:135}]});
await db.doc('services/std18').set({name:'18K Standard',active:true,serviceDefinition:{version:1,bookingCode:'18k_standard_service'}});
const lines=[{id:'selected',serviceId:'std18',label:'18K Standard',quantity:2}];
const quoted=await call('quote_appointment_charges',{expectedVersion:0,lines});assert.equal(quoted.status,200);
assert.equal(quoted.body.quote.lines[0].btu,18000);assert.equal(quoted.body.quote.totalCents,27000);
const request={requestId:'catalog-line-final',expectedVersion:0,lines,scopeReviewed:true,quoteToken:quoted.body.quote.quoteToken};
const saved=await call('finalize_appointment_charges',request);assert.equal(saved.status,200,JSON.stringify(saved.body));
const replay=await call('finalize_appointment_charges',request);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
const read=await call('get_appointment_charges');assert.equal(read.body.state.final.lines[0].serviceId,'std18');assert.equal(read.body.state.final.lines[0].btu,18000);assert.equal(read.body.state.final.totalCents,27000);
assert.equal((await db.doc('appointments/apt').collection('chargeEvents').get()).size,1);
assert.equal((await db.collection('payments').get()).size,0);assert.equal((await db.collection('invoices').get()).size,0);assert.equal((await db.doc('workOrders/wo').get()).data().status,'Confirmada');
});
test('HTTP facade denies missing/expired/tech identities and accepts canonical accounting',async()=>{
assert.equal((await api.handle({method:'POST',headers:{},body:{action:'get_appointment_charges',data:{appointmentId:'apt'}}})).status,401);
for(const [uid,status] of [['expired',401],['missing',403],['tech',403],['accounting',200]])assert.equal((await call('get_appointment_charges',{},uid)).status,status);
assert.equal((await db.collection('payments').get()).size,0);
});
test('real Firestore concurrent requests serialize balances and same retry produces one receipt',async()=>{
const results=await Promise.all([call('record_appointment_payment',pay('different-one')),call('record_appointment_payment',pay('different-two'))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
assert.equal((await db.doc('appointments/apt').get()).data().jobCharges.receivedCents,10000);
const same=pay('same-request',1);const retries=await Promise.all([call('record_appointment_payment',same),call('record_appointment_payment',same)]);assert.deepEqual(retries.map(r=>r.status),[200,200]);assert.equal(retries.filter(r=>r.body.replayed).length,1);assert.equal((await db.collection('payments').get()).size,2);
assert.equal((await db.doc('workOrders/wo').get()).data().scheduledSlots,2);
});
test('real transaction initial charge writes are atomic and missing old state is not backfilled by reads',async()=>{
await call('get_appointment_charges');assert.equal((await db.doc('appointments/apt').get()).data().jobCharges,undefined);
await assert.rejects(db.runTransaction(async transaction=>{const commit=await prepareInitialCharges({db,transaction,input:{lines:[line],payment:{method:'cash',amount:'10'}},actor:{source:'office-scheduling',id:'office'},appointmentId:'apt',appointment:(await transaction.get(db.doc('appointments/apt'))).data()});transaction.update(db.doc('appointments/apt'),{jobCharges:commit.value});commit.write();throw Error('Fail before commit');}));assert.equal((await db.collection('payments').get()).size,0);
const saved=await call('finalize_appointment_charges',{requestId:'final-request',expectedVersion:0,lines:[line],scopeReviewed:true});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal((await db.doc('appointments/apt').get()).data().status,'confirmed');
});
test('deactivated account cannot replay a committed receipt and read snapshot stays consistent',async()=>{
const request=pay('auth-request');assert.equal((await call('record_appointment_payment',request)).status,200);await db.doc('users/office').update({active:false});assert.equal((await call('record_appointment_payment',request)).status,403);
const view=await call('get_appointment_charges',{},'accounting');assert.equal(view.status,200);assert.equal(view.body.state.receivedCents,view.body.payments.reduce((sum,p)=>sum+p.amountCents,0));assert.equal(view.body.history.length,1);
});
test('Field pricing blockers survive canonical projection and final audit without undefined Firestore fields',async()=>{
await db.doc('fieldBillingCandidates/candidate').set({fieldAuthorityVersion:1,officeReviewId:'review',officeReviewRevisionId:'revision',revisionNumber:1,workOrderId:'wo',appointmentId:'apt',clientId:'customer',propertyId:'property',visitId:'visit',status:'needs_pricing_review',lines:[],blockers:[{code:'office_price',message:'Office quote required'}],invoiceLineIds:[],sourceDecisionRequestId:'review-request',createdAt:new Date().toISOString(),createdByUserId:'office',version:1});
const view=await call('get_appointment_charges');assert.equal(view.status,200);assert.equal(view.body.blocker,'');
const result=await call('finalize_appointment_charges',{requestId:'field-final',expectedVersion:0,lines:[line],scopeReviewed:true,candidateReviewed:true,candidateFingerprint:view.body.candidateEvidence.fingerprint,note:'Office priced reviewed work once'});
assert.equal(result.status,200,JSON.stringify(result.body));assert.equal((await db.doc('appointments/apt').get()).data().jobCharges.final.totalCents,12500);
});

test('real Firestore grants one editor across users and tabs; stale release cannot remove the winner',async()=>{
await db.doc('appointments/apt/chargeEditing/current').delete();
await db.doc('users/herlin').set({role:'office',active:true,name:'Herlin synthetic'});
const first={editSessionId:'emulator-race-first-00001'},second={editSessionId:'emulator-race-second-0002'};
const results=await Promise.all([call('acquire_appointment_charge_edit',first),call('acquire_appointment_charge_edit',second,'herlin')]);
assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results.filter(r=>r.body.edit.mine).length,1);
const index=results.findIndex(r=>r.body.edit.mine),uid=index===0?'office':'herlin',session=index===0?first:second;
const token=results[index].body.edit.token;
const denied=await call('acquire_appointment_charge_edit',{editSessionId:'same-user-second-tab-0001'},uid);assert.equal(denied.body.edit.mine,false);assert.equal(denied.body.edit.token,undefined);
await call('release_appointment_charge_edit',{...session,editToken:'stale-token'},uid);
assert.equal((await call('renew_appointment_charge_edit',{...session,editToken:token},uid)).status,200);
assert.deepEqual((await db.doc('appointments/apt').get()).data().jobCharges,{schemaVersion:1,version:1,originalEstimate:null,estimate:null,final:null,receivedCents:0,paymentCount:0});
assert.equal(results.find(result=>result.body.edit.mine).body.edit.financialVersion,1,'Exactly one fresh grant increments the concurrency version');
assert.equal((await db.collection('payments').get()).size,0);
assert.equal((await db.doc('appointments/apt').collection('chargeEvents').get()).size,0);
});
test('real Firestore rejects expired edit but returns an already committed exact receipt retry',async()=>{
const request=pay('expiry-replay');assert.equal((await call('record_appointment_payment',request)).status,200);
await db.doc('appointments/apt/chargeEditing/current').update({expiresAtMs:0});
const replay=await call('record_appointment_payment',request);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
assert.equal((await call('record_appointment_payment',pay('after-expiry',1))).status,409);
assert.equal((await db.collection('payments').get()).size,1);
});

test('real Firestore automatic forecast is atomic and cannot close as an unknown-BTU final price',async()=>{
await db.doc('businessSettings/company-service-pricing-rules').set({version:1,standardServiceSplit:[{btu:9000,price:100},{btu:12000,price:125}]});
await db.runTransaction(async transaction=>{
 const appointment=(await transaction.get(db.doc('appointments/apt'))).data();
 const commit=await prepareInitialCharges({db,transaction,actor:{source:'office-scheduling',id:'office'},appointmentId:'apt',appointment:{...appointment,workItems:[{id:'planned',presetId:'standard_service',label:'Standard',quantity:2}]}});
 transaction.update(db.doc('appointments/apt'),{jobCharges:commit.value});commit.write();
});
const state=(await db.doc('appointments/apt').get()).data().jobCharges;
assert.equal(state.originalEstimate.totalCents,20000);
assert.equal((await db.doc('appointments/apt').collection('chargeEvents').get()).size,1);
const result=await call('finalize_appointment_charges',{requestId:'minimum-not-final',expectedVersion:1,lines:[{id:'planned',workLineId:'planned',presetId:'standard_service',label:'Standard',quantity:2,unitPrice:'100'}],scopeReviewed:true,note:'Review required'});
assert.equal(result.status,400,JSON.stringify(result.body));assert.equal(result.body.error.code,'charge_unpriced');
assert.equal((await db.doc('appointments/apt').get()).data().jobCharges.final,null);
assert.equal((await db.collection('payments').get()).size,0);
});


test('real Firestore correction atomically updates one receipt and audits before/after; concurrent retry applies once',async()=>{
const initial=await call('record_appointment_payment',{...pay('date-only-initial'),payment:{method:'cash',amount:'145',receivedDate:'2026-10-08'}});assert.equal(initial.status,200,JSON.stringify(initial.body));
const paymentId=initial.body.paymentId,original=(await db.doc('payments/'+paymentId).get()).data();
const request={requestId:'correction-emulator-request',expectedVersion:1,paymentId,reason:'Fecha y monto incorrectos',payment:{method:'transfer',reference:'SYNTHETIC-TRANSFER',amount:'250',receivedDate:'2026-10-07'}};
const results=await Promise.all([call('correct_appointment_payment',request),call('correct_appointment_payment',request)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results.filter(r=>r.body.replayed).length,1);
const record=await call('get_appointment_charges');assert.equal(record.body.state.receivedCents,25000);assert.equal(record.body.state.paymentCount,1);assert.equal(record.body.payments.length,1);
const saved=record.body.payments[0];assert.equal(saved.id,paymentId);assert.equal(saved.createdAt,original.createdAt);assert.equal(saved.createdBy,original.createdBy);assert.equal(saved.amount.amount,250);assert.equal(saved.receivedAt,'2026-10-07T04:00:00.000Z');
const audit=record.body.history.find(e=>e.action==='correct_appointment_payment');assert.equal(audit.paymentBefore.amountCents,14500);assert.equal(audit.paymentAfter.amountCents,25000);assert.equal(audit.reason,request.reason);assert.equal(audit.actor.id,'office');
assert.equal((await call('correct_appointment_payment',{...request,requestId:'correction-stale',payment:{...request.payment,amount:'200'}})).status,409);
await db.doc('payment_allocations/test').set({paymentId,invoiceId:'external'});const denied=await call('correct_appointment_payment',{...request,requestId:'correction-allocated',expectedVersion:2,payment:{...request.payment,amount:'200'}});assert.equal(denied.body.error.code,'payment_reconciled');
assert.equal((await db.doc('appointments/apt').get()).data().jobCharges.receivedCents,25000);assert.equal((await db.collection('payments').get()).size,1);
});
