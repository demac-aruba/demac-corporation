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
assert.equal((await db.doc('appointments/apt').get()).data().jobCharges,undefined);
});
test('real Firestore rejects expired edit but returns an already committed exact receipt retry',async()=>{
const request=pay('expiry-replay');assert.equal((await call('record_appointment_payment',request)).status,200);
await db.doc('appointments/apt/chargeEditing/current').update({expiresAtMs:0});
const replay=await call('record_appointment_payment',request);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
assert.equal((await call('record_appointment_payment',pay('after-expiry',1))).status,409);
assert.equal((await db.collection('payments').get()).size,1);
});
