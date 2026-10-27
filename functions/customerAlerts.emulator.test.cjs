'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const tooling = process.env.CUSTOMER_ALERT_TEST_TOOLS;
if (!tooling || !path.isAbsolute(tooling)) throw Error('Isolated absolute CUSTOMER_ALERT_TEST_TOOLS required');
const { initializeTestEnvironment, assertFails } = require(path.join(tooling,'node_modules/@firebase/rules-unit-testing'));
const { doc, setDoc, getDoc, getDocs, collection } = require(path.join(tooling,'node_modules/firebase/firestore'));
const PROJECT = 'demo-demac-customer-alerts';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8431' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Loopback demo emulator without production credentials required');
const app = initializeApp({projectId:PROJECT}, 'customer-alert-test'), db = getFirestore(app);
const facade = createOfficeBookingAuthorityFacade({db, verifyIdToken:async token=>({uid:token})});
const call = (action,data,uid='operator')=>facade.handle({method:'POST',headers:{authorization:'Bearer '+uid},body:{action,data}});
const records = {'users/operator':{active:true,role:'office'},'users/admin':{active:true,role:'admin'},'users/technician':{active:true,role:'technician'},'clients/old':{name:'Ejemplo A',phone:'+2970000001'},'clients/new':{name:'Ejemplo B',phone:'+2970000002'},'properties/old-home':{clientId:'old',address:'Dirección ficticia 10'},'properties/new-home':{clientId:'new',address:'Dirección ficticia 10'},'appointments/synthetic':{customerId:'old',status:'confirmed'},'payments/synthetic':{amount:99},'whatsappOutboundQueue/synthetic':{status:'pending'}};
const input = {id:'test-alert',requestId:'create-one',customerId:'old',propertyId:'old-home',category:'debt',comment:'Comentario ficticio de prueba.',matchPhone:true,matchAddress:true};
let environment;
before(async()=>{environment=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8431,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
beforeEach(async()=>{await environment.clearFirestore();const batch=db.batch();for(const [ref,value] of Object.entries(records))batch.set(db.doc(ref),value);await batch.commit();});
after(async()=>{await environment.cleanup();await db.terminate();await deleteApp(app);});
test('real transaction retries, exact indexed matching, occupant exception and immutable existing data',async()=>{
 const created=await Promise.all([call('create_customer_alert',input),call('create_customer_alert',input)]);assert.deepEqual(created.map(r=>r.status),[200,200]);assert.equal(created.filter(r=>r.body.replayed).length,1);
 const context={customerId:'new',propertyId:'new-home'};
 const matched=await call('match_customer_alerts',context);assert.equal(matched.status,200);assert.equal(matched.body.matches[0].matchKind,'address');
 const decision={id:input.id,requestId:'different-one',expectedVersion:1,context,contextToken:matched.body.contextToken,decision:'different_customer',reason:'Otra identidad verificada en prueba.'};
 assert.equal((await call('review_customer_alert',decision)).status,200);assert.equal((await call('review_customer_alert',decision)).body.replayed,true);
 assert.equal((await call('match_customer_alerts',context)).body.matches.length,0);assert.equal((await call('match_customer_alerts',{customerId:'old'})).body.matches.length,1);
 const changed=await Promise.all(['resolved','invalidated'].map((status,i)=>call('set_customer_alert_status',{id:input.id,requestId:'status-'+i,expectedVersion:1,status,reason:'Cambio concurrente de prueba.'})));assert.deepEqual(changed.map(r=>r.status).sort(),[200,409]);
 const history=await call('customer_alert_history',{id:input.id});assert.equal(history.body.events.length,3);
 for(const [ref,value] of Object.entries(records))assert.deepEqual((await db.doc(ref).get()).data(),value,ref);
});
test('current and old browser sessions cannot directly read or forge incidents, events or exceptions',async()=>{
 assert.equal((await call('create_customer_alert',input)).status,200);
 for(const uid of ['operator','admin','technician',null]){
  const client=(uid?environment.authenticatedContext(uid):environment.unauthenticatedContext()).firestore();
  await assertFails(getDocs(collection(client,'customerAlerts')));
  for(const ref of ['customerAlerts/test-alert','customerAlerts/test-alert/events/forged','customerAlerts/test-alert/exceptions/forged']){
   await assertFails(getDoc(doc(client,ref)));await assertFails(setDoc(doc(client,ref),{comment:'forged'}));
  }
 }
 await db.doc('users/operator').update({active:false});assert.equal((await call('list_customer_alerts',{customerId:'old'})).status,403);
 assert.equal((await call('list_customer_alerts',{customerId:'old'},'technician')).status,403);
});
