'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const { seed } = require('./test-support/vanRosterFixture');
const tools = process.env.VAN_ROSTER_TEST_TOOLS;
if (!tools) throw Error('Isolated VAN_ROSTER_TEST_TOOLS required');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require(path.join(tools,'node_modules/@firebase/rules-unit-testing'));
const { doc, updateDoc, setDoc, getDoc } = require(path.join(tools,'node_modules/firebase/firestore'));
const PROJECT = 'demo-demac-van-roster';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8426' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Loopback demo emulator without production credentials required');
const app = initializeApp({projectId:PROJECT},'van-roster-test'), db = getFirestore(app);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async token => { if(token==='invalid') throw Error('Invalid token'); return {uid:token}; } });
const call = (action,data,uid='operator') => facade.handle({method:'POST',headers:uid?{authorization:'Bearer '+uid}:{},body:{action,data}});
let environment;
before(async()=>{ environment=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8426,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}}); });
beforeEach(async()=>{await environment.clearFirestore();const batch=db.batch();for(const [ref,value] of Object.entries(seed())){if(['workOrders/pending','appointments/appointment'].includes(ref))value.date=require('./bookingSchedulingPrimitives').arubaDateParts().date;batch.set(db.doc(ref),value);}await batch.commit();});
after(async()=>{await environment.cleanup();await db.terminate();await deleteApp(app);});
async function request(){const view=await call('get_van_roster');assert.equal(view.status,200);const {rows,token,effectiveDate}=view.body;[rows[0].regularHelperId,rows[1].regularHelperId]=[rows[1].regularHelperId,rows[0].regularHelperId];return {rows,expectedToken:token,effectiveDate,requestId:'emulator-swap-001'};}
test('HTTP boundary rejects anonymous/invalid/technical callers before writes',async()=>{
 for(const uid of [null,'invalid'])assert.equal((await call('save_van_roster',{},uid)).status,401);
 assert.equal((await call('get_van_roster',{},'login-helper-a')).status,403);
});
test('real Firestore query transactions serialize swaps, preserve linked data and permit exact retry',async()=>{
 // Fixture dates use the actual authority business date, with no live data involved.
 const req=await request();
 const results=await Promise.all([call('save_van_roster',req),call('save_van_roster',{...req,requestId:'emulator-swap-002'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const index=results.findIndex(r=>r.status===200),saved=index?{...req,requestId:'emulator-swap-002'}:req;
 assert.equal((await call('save_van_roster',saved)).body.replayed,true);
 assert.equal((await db.doc('vans/legacy-101').get()).data().regularHelperId,'helper-b');
 assert.equal((await db.doc('staffProfiles/helper-a').get()).data().primaryVanId,'VAN-2');
 assert.equal((await db.doc('users/login-helper-a').get()).data().vanId,'VAN-2');
 assert.equal((await db.doc('employeeTimesheets/helper-a_2026-10-19').get()).data().overtimeMinutes,60);
});
test('rules allow vehicle maintenance but reject direct crew/history mutations even for old admin clients',async()=>{
 await db.doc('users/admin').set({active:true,role:'admin'});
 for(const uid of ['operator','admin']){
  const client=environment.authenticatedContext(uid).firestore(),van=doc(client,'vans/legacy-101');
  await assertSucceeds(getDoc(van));await assertSucceeds(updateDoc(van,{odometerKm:5000}));
  for(const patch of [{regularHelperId:'helper-b'},{responsibleStaffId:'tech-b'},{additionalHelperId:'spare'},{technicianIds:['tech-b']},{crewHistory:[]},{crewRevision:'forged'}])await assertFails(updateDoc(van,patch));
  await assertFails(setDoc(doc(client,'vans/forged'),{name:'Van 9',status:'Disponible',responsibleStaffId:'tech-a',regularHelperId:'helper-a'}));
  await assertSucceeds(setDoc(doc(client,'vans/empty-'+uid),{name:'Van 9',status:'Fuera de servicio',technicianIds:[]}));
  await assertFails(setDoc(doc(client,'businessSettings/van-roster/events/forged'),{actor:uid}));
  await assertFails(getDoc(doc(client,'businessSettings/van-roster/events/forged')));
 }
 const tech=environment.authenticatedContext('login-helper-a').firestore();await assertFails(updateDoc(doc(tech,'vans/legacy-101'),{odometerKm:6000}));
});
