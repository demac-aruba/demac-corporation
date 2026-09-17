"use strict";
const test=require('node:test');const assert=require('node:assert/strict');
// Fail closed before initializing any SDK. These tests cannot target a real project.
const PROJECT='demo-demac-health';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error(`Local ${key} is mandatory`);
if(process.env.GCLOUD_PROJECT!==PROJECT)throw Error('Only demo-demac-health is permitted');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');const {getAuth}=require('firebase-admin/auth');
const {createPerformanceTelemetryApi}=require('./performanceTelemetryService');
const C=require('./performanceTelemetryCore');
const app=initializeApp({projectId:PROJECT},'performance-emulator');const db=getFirestore(app);
async function user(role){const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}-${Date.now()}@example.test`,password:'isolated-test-only-123',returnSecureToken:true})});const value=await response.json();assert.ok(value.idToken);await db.collection('users').doc(value.localId).set({role,active:true});return value;}
function batch(id,at=Date.now()){return{version:2,environment:'test',batchId:`emulator_batch_identity_${id}`,sessionId:'emulator_session_identity',release:'a'.repeat(40),visible:true,module:'scheduling',measurements:[{name:'support_slot_validation',module:'scheduling',unit:'ms',value:125,observedAtMs:at}]};}
test('real Auth + Firestore emulator: authorization, atomic replay, concurrency, shutoff and business isolation',{timeout:120000},async()=>{
  const api=createPerformanceTelemetryApi({db,verifyIdToken:(token)=>getAuth(app).verifyIdToken(token),timestamp:Timestamp.fromMillis,enabled:true,environment:'test'});
  const admin=await user('admin');const office=await user('office');
  const call=(action,data,token)=>api.handle({method:'POST',headers:token?{authorization:`Bearer ${token}`}:{},body:{action,data}});
  const sentinels=['clients','appointments','workOrders','properties','capacityLocks'];
  for(const collection of sentinels)await db.collection(collection).doc('do-not-change').set({value:'synthetic-existing-business-record'});
  assert.equal((await call('dashboard',{},undefined)).status,401);
  assert.equal((await call('dashboard',{},office.idToken)).status,403);
  assert.equal((await call('set_collection',{enabled:false,expectedVersion:0},office.idToken)).status,403);
  const input=batch('same');
  const concurrent=await Promise.all(Array.from({length:8},()=>call('ingest',input,office.idToken)));
  assert.ok(concurrent.every((r)=>r.status===200),JSON.stringify(concurrent));
  assert.equal(concurrent.filter((r)=>!r.body.replayed).length,1);
  const dashboard=(await call('dashboard',{rangeMinutes:60},admin.idToken)).body;
  assert.equal(dashboard.metrics.find((m)=>m.name==='support_slot_validation').count,1);
  assert.equal(dashboard.metrics.find((m)=>m.name==='support_slot_validation').p95,150);
  // Simulate an acknowledgement lost AFTER the real database commit.
  await call('ingest',batch('lost-ack'),office.idToken);
  assert.equal((await call('ingest',batch('lost-ack',input.measurements[0].observedAtMs),office.idToken)).status,409); // same ID, changed timestamp => conflict, never counted again
  const paused=await call('set_collection',{enabled:false,expectedVersion:0},admin.idToken);assert.equal(paused.status,200);
  assert.equal((await call('ingest',batch('paused'),office.idToken)).body.error.code,'disabled');
  assert.equal((await call('set_collection',{enabled:true,expectedVersion:1},admin.idToken)).status,200);
  const started=performance.now();
  const senders=await Promise.all(Array.from({length:50},(_,index)=>api.ingest(batch(`sender-${index}`),{uid:`synthetic-sender-${index}`,role:'office_operator'}).then(()=>true).catch((e)=>e.code||e.message)));
  assert.ok(senders.every((value)=>value===true),JSON.stringify(senders));
  console.log(`Telemetry concurrency: 50 isolated senders completed in ${Math.round(performance.now()-started)} ms (emulator, not production).`);
  for(const collection of sentinels)assert.deepEqual((await db.collection(collection).doc('do-not-change').get()).data(),{value:'synthetic-existing-business-record'});
  const direct=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${C.COLLECTIONS.quarter}`,{headers:{Authorization:`Bearer ${office.idToken}`}});
  assert.equal(direct.status,403,'Direct client access to server-only telemetry must remain denied.');
  await deleteApp(app);
});
