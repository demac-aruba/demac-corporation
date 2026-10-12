'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const toolsRoot = process.env.CATALOG_RULES_TEST_TOOLS;
if (!toolsRoot) throw Error('Set CATALOG_RULES_TEST_TOOLS to isolated test dependencies.');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require(path.join(toolsRoot, 'node_modules/@firebase/rules-unit-testing'));
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require(path.join(toolsRoot, 'node_modules/firebase/firestore'));
const PROJECT = 'demo-demac-charges';
if(process.env.GCLOUD_PROJECT!==PROJECT || process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8404' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Requires isolated loopback demo Firestore with no production credentials.');
const app=initializeApp({projectId:PROJECT},'catalog-tests'),db=getFirestore(app);
const api=createOfficeBookingAuthorityFacade({db,verifyIdToken:async uid=>({uid})});
const call=(action,data={},uid='office')=>api.handle({method:'POST',headers:{authorization:`Bearer ${uid}`},body:{action,data}});
const service={name:'Synthetic service',itemType:'Servicio',durationMinutes:60,basePrice:null,active:true,serviceDefinition:{version:1,bookingCode:'synthetic',duration:{minutes:60}}};
let environment;
beforeEach(async()=>{
 if (!environment) environment=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8404,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 await environment.clearFirestore();
 await Promise.all(Object.entries({'users/office':{active:true,role:'office',name:'Synthetic office'},'users/other':{active:true,role:'office'},'users/admin':{active:true,role:'admin'},'users/reader':{active:true,role:'technician'},'users/inactive':{active:false,role:'office'}}).map(([ref,data])=>db.doc(ref).set(data)));
});
after(async()=>{await environment?.cleanup();await db.terminate();await deleteApp(app);});
test('real transactions serialize duplicate booking codes and stale editor saves; exact retries do not duplicate audit',async()=>{
 const created=await Promise.all(['one','two'].map((id,i)=>call('save_catalog_item',{id,expectedToken:null,patch:service},i?'other':'office')));
 assert.deepEqual(created.map(r=>r.status).sort(),[200,409]);
 const item=created.find(r=>r.status===200).body.item;
 const edits=await Promise.all(['office','other'].map(uid=>call('save_catalog_item',{id:item.id,expectedToken:item.catalogToken,patch:{name:uid}},uid)));
 assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
 const winner=edits.find(r=>r.status===200).body.item;
 const retry=await call('save_catalog_item',{id:item.id,expectedToken:item.catalogToken,patch:{name:winner.name}},winner.name);
 assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);
 assert.equal((await db.doc(`services/${item.id}`).collection('catalogEvents').get()).size,2);
 assert.equal(winner.basePrice,null);
 await db.doc(`users/${winner.name}`).update({active:false});
 assert.equal((await call('save_catalog_item',{id:item.id,expectedToken:item.catalogToken,patch:{name:winner.name}},winner.name)).status,403);
});
test('real delete retains audit/identity and rejects reuse by another operator',async()=>{
 const created=await call('save_catalog_item',{id:'one',expectedToken:null,patch:service});assert.equal(created.status,200);
 const removed=await call('delete_catalog_item',{id:'one',expectedToken:created.body.item.catalogToken},'admin');assert.equal(removed.status,200);
 const reused=await call('save_catalog_item',{id:'one',expectedToken:null,patch:service},'other');assert.equal(reused.status,409);assert.equal(reused.body.error.code,'catalog_identity_retired');
 assert.equal((await db.doc('services/one/catalogIdentity/current').get()).exists,true);
});
test('rules preserve staff reads but deny direct writes and all private coordination/audit access',async()=>{
 await db.doc('services/one').set(service);
 for(const uid of ['office','admin','reader']) {
  const client=environment.authenticatedContext(uid).firestore();
  await assertSucceeds(getDoc(doc(client,'services/one')));
  await assertFails(setDoc(doc(client,'services/new'),service));
  await assertFails(updateDoc(doc(client,'services/one'),{basePrice:0}));
  await assertFails(deleteDoc(doc(client,'services/one')));
  for(const ref of ['services/one/catalogEvents/private','services/one/catalogIdentity/current','businessSettings/service-catalog/codeClaims/private','appointments/one/chargeEditing/current']) {
   await assertFails(getDoc(doc(client,ref)));await assertFails(setDoc(doc(client,ref),{ownerId:uid}));
  }
 }
 for(const client of [environment.authenticatedContext('inactive').firestore(),environment.unauthenticatedContext().firestore()]) await assertFails(getDoc(doc(client,'services/one')));
});
test('real pagination reads beyond a full page and detects a duplicate on the last page',async()=>{
 const batch=db.batch();for(let i=0;i<205;i++)batch.set(db.doc(`services/s${String(i).padStart(3,'0')}`),{...service,serviceDefinition:{...service.serviceDefinition,bookingCode:`synthetic_${i}`}});await batch.commit();
 const first=await call('list_managed_catalog');assert.equal(first.status,200);assert.equal(first.body.items.length,200);
 const second=await call('list_managed_catalog',{cursor:first.body.nextCursor});assert.equal(second.body.items.length,5);assert.equal(second.body.nextCursor,null);
 const duplicate=await call('save_catalog_item',{id:'new',expectedToken:null,patch:{...service,serviceDefinition:{...service.serviceDefinition,bookingCode:'synthetic_204'}}});assert.equal(duplicate.status,409);
});
