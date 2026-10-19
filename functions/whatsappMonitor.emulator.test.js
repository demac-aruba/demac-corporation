'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const PROJECT='demo-demac-health';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]||''))throw Error(`Local ${key} required.`);
if(process.env.GCLOUD_PROJECT!==PROJECT)throw Error('Demo project required.');
const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore,Timestamp}=require('firebase-admin/firestore');const {getAuth}=require('firebase-admin/auth');
const {createMessagingMonitor}=require('./whatsappMonitorService');const {createAppointmentNotificationService}=require('./appointmentNotificationService');const C=require('./whatsappMonitorCore');
const app=initializeApp({projectId:PROJECT},'messaging-emulator');const db=getFirestore(app);
async function user(role){const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}-${Date.now()}@example.test`,password:'isolated-monitor-test-only',returnSecureToken:true})});const data=await response.json();assert.ok(data.idToken);await db.collection('users').doc(data.localId).set({role,active:true,name:'Synthetic Operator'});return data;}
test('real Auth/Firestore: roles, correlated generation, ordering, concurrent ACK, recovery, cutoff and no business writes',{timeout:120000},async()=>{
  let at=Date.parse('2026-10-19T14:10:00Z');let cloudAvailable=true;let published=0;
  const monitor=createMessagingMonitor({db,verifyIdToken:(token,revoked)=>getAuth(app).verifyIdToken(token,revoked),timestamp:Timestamp.fromMillis,enabled:true,now:()=>at,readTransport:async()=>{if(!cloudAvailable)throw Error('synthetic provider outage');return{available:true,lastSuccessAtMs:at-10000};},publishSignals:async()=>{published++;}});
  try{
    const operator=await user('office');const technician=await user('technician');
    const call=(action,data={},token=operator.idToken)=>monitor.handle({method:'POST',headers:token?{authorization:`Bearer ${token}`}:{},body:{action,data}});
    await db.doc(C.PATHS.control).set({enabled:true,startedAtMs:at-600000});
    assert.equal((await call('dashboard',{},null)).status,401);assert.equal((await call('dashboard',{},technician.idToken)).status,403);assert.equal((await call('dashboard')).status,200);
    const old={status:'cancelled',cancellationReason:C.DISCARD_REASON,createdAt:Timestamp.fromMillis(at-86400000)};
    await db.collection('whatsappOutboundQueue').doc('discarded-old').set(old);
    const order={id:'monitor-order',clientId:'monitor-client',appointmentId:'monitor-appointment',status:'Confirmada',date:'2026-10-20',time:'09:00',address:'Synthetic address',problem:'Synthetic service',notificationRecipients:[{id:'recipient',whatsapp:'+2975600000',sendConfirmation:true}]};
    await db.collection('clients').doc(order.clientId).set({name:'Synthetic customer'});await db.collection('workOrders').doc(order.id).set(order);
    const version=at-360000+.125;const observe=(sourceAtMs=version,after=order)=>monitor.observeOrder({id:order.id,before:null,after,sourceAtMs});
    const observed=await Promise.all(Array.from({length:8},()=>observe()));assert.equal(observed.filter(x=>x.observed).length,1);
    assert.equal((await observe(version-1)).observed,false,'out-of-order event cannot replace current expectation');
    const evaluations=await Promise.all(Array.from({length:4},()=>monitor.run()));assert.equal(evaluations.filter(x=>x.committed).length,1);
    let stored=(await db.doc(C.PATHS.snapshot).get()).data();assert.equal(stored.incidents.find(x=>x.code==='not_generated').count,1);assert.equal(stored.status,'critical');assert.equal(published,1);
    const incident=stored.incidents.find(x=>x.code==='not_generated');const ackData={incidentId:incident.id,openedAtMs:incident.openedAtMs};
    const ack=await Promise.all(Array.from({length:8},()=>call('acknowledge',ackData)));assert.ok(ack.every(x=>x.status===200));assert.equal(ack.filter(x=>!x.body.replayed).length,1);
    assert.equal((await db.collection(C.PATHS.audit).get()).size,1);assert.equal((await db.collection(C.PATHS.incidents).doc(incident.id).get()).data().open,true);
    assert.equal((await call('acknowledge',{...ackData,openedAtMs:incident.openedAtMs-1})).status,409);
    const producer=createAppointmentNotificationService({db});await db.doc('businessSettings/whatsapp').set({transactionalProvider:'wacli'});
    await producer.queueConfirmationForOrder({order,eventId:'synthetic-event',sourceVersionMs:version,reason:'test-only'});
    const producerOrder=(await db.collection('workOrders').doc(order.id).get()).data();
    const queue=await db.collection('whatsappOutboundQueue').where('monitoringSourceVersionMs','==',version).get();assert.equal(queue.size,1);assert.equal(queue.docs[0].data().monitoringRecipientKey,'recipient');
    await queue.docs[0].ref.set({status:'failed',failedAt:Timestamp.fromMillis(at),createdAt:Timestamp.fromMillis(version)},{merge:true});at+=60000;await monitor.run();
    assert.equal((await db.doc(C.PATHS.snapshot).get()).data().incidents.find(x=>x.code==='send_failed').count,1);
    // A source outage must retain prior open incidents; it cannot report recovery.
    cloudAvailable=false;await queue.docs[0].ref.set({status:'sent',completedAt:Timestamp.fromMillis(at)},{merge:true});at+=60000;await monitor.run();stored=(await db.doc(C.PATHS.snapshot).get()).data();assert.equal(stored.status,'unknown');assert.ok(stored.unverifiedIncidents.some(x=>x.code==='send_failed'));
    cloudAvailable=true;at+=60000;await monitor.run();stored=(await db.doc(C.PATHS.snapshot).get()).data();assert.equal(stored.status,'healthy');assert.equal(stored.counts.confirmed,1);
    assert.equal((await call('acknowledge',ackData)).status,409,'resolved occurrence cannot be acknowledged again');
    assert.deepEqual((await db.collection('whatsappOutboundQueue').doc('discarded-old').get()).data(),old);assert.deepEqual((await db.collection('workOrders').doc(order.id).get()).data(),producerOrder);
    const beforeQueue=(await db.collection('whatsappOutboundQueue').get()).docs.map(x=>[x.id,x.data()]);at+=60000;await monitor.run();assert.deepEqual((await db.collection('whatsappOutboundQueue').get()).docs.map(x=>[x.id,x.data()]),beforeQueue,'monitor performs no queue mutations');
    assert.equal((await call('history')).body.items.length>0,true);assert.equal((await call('resend')).status,400);
    const direct=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${C.PATHS.snapshot}`,{headers:{Authorization:`Bearer ${operator.idToken}`}});assert.equal(direct.status,403,'private projections cannot be read directly');
    await db.collection('users').doc(operator.localId).set({active:false},{merge:true});assert.equal((await call('dashboard')).status,403);
    // Tomorrow's preflight must detect a broken group before dispatch, then reconcile
    // the canonical deterministic plan even when the daily producer never ran.
    at=Date.parse('2026-10-20T11:46:00Z');
    await db.collection('vans').doc('VAN-2').set({name:'Van 2',scheduleDeliveryEnabled:true});
    await db.collection('workOrders').doc(order.id).set({...order,vanId:'VAN-2',appointmentEndTime:'11:00'});
    await monitor.run();stored=(await db.doc(C.PATHS.snapshot).get()).data();
    assert.ok(stored.incidents.some(x=>x.code==='recipient_invalid'),'07:45 configuration failure alerts before dispatch');
    assert.equal(stored.daily.preflight['07:45'].status,'warning');
    await db.collection('vans').doc('VAN-2').set({whatsappScheduleGroupJid:'120000000000000002@g.us'},{merge:true});
    at=Date.parse('2026-10-20T11:56:00Z');await monitor.run();
    assert.equal((await db.doc(C.PATHS.snapshot).get()).data().daily.preflight['07:55'].status,'healthy');
    at=Date.parse('2026-10-20T12:00:00Z');await monitor.run();
    const frozen=(await db.collection(C.PATHS.days).doc('2026-10-20').get()).data();assert.equal(frozen.frozen,true);assert.ok(frozen.entries.some(x=>x.workOrderId===order.id));
    at+=360000;await monitor.run();stored=(await db.doc(C.PATHS.snapshot).get()).data();assert.ok(stored.incidents.some(x=>x.code==='schedule_not_run'));assert.ok(stored.incidents.some(x=>x.code==='not_generated'&&x.flow==='technicians'));
    assert.equal(stored.daily.coverageLate,false,'on-time frozen plan is not reconstructed after failure');
    await db.doc(C.PATHS.control).set({enabled:false},{merge:true});assert.equal((await monitor.run()).disabled,true);
  }finally{await deleteApp(app);}
});
