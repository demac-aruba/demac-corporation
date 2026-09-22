const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { assertIsolated } = require('./test-support/dwellingsIsolation.cjs');
const { seedRecords } = require('./test-support/manualMoveSynthetic.cjs');
const { createPropertyLocationService, resolvePropertyLocation } = require('./propertyLocations');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { resolveAppointmentRecipients } = require('./customerContactDirectory');
const { createRegisterEquipmentSystemCommand } = require('./fieldOperationsEquipmentRegistration');
const { createAttachExistingVisitAssetCommand } = require('./fieldOperationsVisitAssets');
assertIsolated();
const projectId = 'demo-demac-dwellings-test';
const app = initializeApp({ projectId }, 'dwellings-acceptance');
const db = getFirestore(app);
const locations = createPropertyLocationService({ db });
const identity = { uid: 'demo-office', role: 'office', name: 'Synthetic office' };
const customerId = 'DEMO-CUSTOMER'; const propertyId = 'DEMO-PROPERTY';
const tomorrow = new Date(Date.now() + 3 * 86400_000); while ([0,6].includes(tomorrow.getUTCDay())) tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
const date = tomorrow.toISOString().slice(0,10);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async (token) => { if (!['demo-office','demo-technician'].includes(token)) throw Error('invalid'); return { uid: token }; } });
const api = async (action, data, token='demo-office') => facade.handle({ method:'POST', headers:{authorization: token ? `Bearer ${token}` : ''}, body:{action,data} });
const get = async (path) => (await db.doc(path).get()).data();
const create = (rows, expectedVersion=0, requestId='test-dwellings-create') => locations.save({customerId,propertyId,kind:'dwellings',rows,expectedVersion,requestId},identity);
const apartment = (code='1') => ({code,name:`Apartment ${code}`,type:'apartment'});
beforeEach(async () => {
  const cleared = await fetch(`http://127.0.0.1:8297/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'}); assert.equal(cleared.ok,true);
  const batch=db.batch(); for (const [path,value] of Object.entries(seedRecords(date))) batch.set(db.doc(path),value);
  batch.set(db.doc('contacts/access'),{clientId:customerId,name:'Synthetic Access',email:'access@example.invalid',active:true});
  batch.set(db.doc('contacts/requester'),{clientId:customerId,name:'Synthetic Requester',email:'requester@example.invalid',active:true});
  batch.set(db.doc('equipmentSystems/OLD'),{clientId:customerId,propertyId,locationLabel:'Old unclassified room',active:true});
  await batch.commit();
});
after(()=>deleteApp(app));

test('Unified editor: creates a main office and apartments atomically, exact retries preserve IDs and audit', async () => {
  const input = { requestId: 'premium-office-create', customerId, property: { name: 'DEMO Complex', type: 'Complejo de apartamentos', address: 'Morgenster 88', zone: 'Oranjestad', locations: { expectedVersion: 0, rows: [{ code: 'OF', name: 'Oficina principal', type: 'main_office', contactIds: ['access'] }, apartment('A-01'), apartment('A-02')] } } };
  const results = await Promise.all([api('create_property', input), api('create_property', input)]);
  results.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)));
  const property = results[0].body.property;
  assert.equal(results[1].body.property.id, property.id);
  assert.equal(property.dwellingCount, 3); assert.equal(property.locationVersion, 1);
  const saved = await locations.list({ customerId, propertyId: property.id });
  assert.equal(saved.dwellings.filter(row => row.type === 'main_office').length, 1);
  assert.equal(saved.assignments.length, 1);
  assert.equal((await db.collection('bookingIdempotency').where('propertyId', '==', property.id).get()).size, 1);
  assert.equal((await db.collection('equipmentSystems').get()).size, 1);
});

test('Unified editor: invalid unit rolls back new customer, property, contacts and every child', async () => {
  const before = await Promise.all(['clients','properties','contacts','bookingIdempotency'].map(name => db.collection(name).get().then(s => s.size)));
  const input = { requestId: 'premium-customer-invalid', customer: { name: 'DEMO New Owner', phone: '+2975990011' }, property: { address: 'Noord 55', zone: 'Noord', locations: { expectedVersion: 0, rows: [apartment('1'), apartment(' １ ')] } } };
  const rejected = await api('create_customer_property', input);
  assert.notEqual(rejected.status, 200);
  const after = await Promise.all(['clients','properties','contacts','bookingIdempotency'].map(name => db.collection(name).get().then(s => s.size)));
  assert.deepEqual(after, before);
  input.requestId = 'premium-customer-valid'; input.property.locations.rows = [{ code: 'CP', name: 'Casa principal', type: 'main_house' }, apartment()];
  const created = await api('create_customer_property', input);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await locations.list({ customerId: created.body.customer.id, propertyId: created.body.property.id })).dwellings.length, 2);
});

test('Unified editor: update, area and contacts commit together, stale edits and duplicates preserve original data', async () => {
  const first = await create([apartment('1'), apartment('2')]);
  const original = await get(`properties/${propertyId}`);
  const input = { requestId: 'premium-update-property', customerId, propertyId, expectedUpdatedAt: original.updatedAt, changes: { name: 'DEMO Edited complex', address: original.address, zone: original.zone || 'Noord' }, locations: { expectedVersion: 1, rows: [{ ...apartment('OF'), id: first.ids[0], name: 'Oficina principal', type: 'main_office', contactIds: ['access'] }], areas: [{ name: 'Recepción', code: 'R', dwellingId: first.ids[0] }] } };
  const changed = await api('update_property', input);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await api('update_property', input)).status, 200);
  const saved = await locations.list({ customerId, propertyId });
  assert.equal(saved.property.locationVersion, 2); assert.equal(saved.dwellings.find(row => row.id === first.ids[0]).type, 'main_office');
  assert.equal(saved.areas.length, 1); assert.equal(saved.assignments.length, 1); assert.equal(saved.property.dwellingCount, 2);
  const snapshot = JSON.stringify(saved);
  const stale = await api('update_property', { ...input, requestId: 'premium-stale-version', changes: { name: 'MUST NOT SAVE' } });
  assert.notEqual(stale.status, 200);
  const duplicate = await api('update_property', { ...input, requestId: 'premium-duplicate-unit', expectedUpdatedAt: saved.property.updatedAt, changes: { name: 'MUST NOT SAVE' }, locations: { expectedVersion: 2, rows: [{ ...apartment('2'), id: first.ids[0] }] } });
  assert.notEqual(duplicate.status, 200);
  const invalidArea = await api('update_property', { ...input, requestId: 'premium-invalid-area', expectedUpdatedAt: saved.property.updatedAt, changes: { name: 'MUST NOT SAVE' }, locations: { expectedVersion: 2, rows: [apartment('3')], areas: [{ name: 'Bad', code: 'B', dwellingId: 'foreign' }] } });
  assert.notEqual(invalidArea.status, 200);
  assert.equal(JSON.stringify(await locations.list({ customerId, propertyId })), snapshot);
  assert.equal((await get('equipmentSystems/OLD')).dwellingId, undefined);
});

test('Unified editor: competing property updates accept one complete draft only', async () => {
  const original = await get(`properties/${propertyId}`);
  const results = await Promise.all(['A','B'].map(code => api('update_property', { requestId: `premium-race-${code}`, customerId, propertyId, expectedUpdatedAt: original.updatedAt || '', changes: { name: `DEMO Winner ${code}` }, locations: { expectedVersion: 0, rows: [apartment(code)] } })));
  assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results));
  const saved = await locations.list({ customerId, propertyId });
  assert.equal(saved.dwellings.length, 1); assert.equal(saved.property.name, `DEMO Winner ${saved.dwellings[0].code}`);
});

test('A/B/C/D: existing house plus five dwellings, configurable 23 and 40; property-local codes; no automatic equipment migration',async()=>{
  const before=await get('equipmentSystems/OLD');
  const saved=await create([{code:'MAIN',name:'Main house',type:'main_house'},...Array.from({length:4},(_,i)=>apartment(String(i+1)))]);
  assert.equal(saved.ids.length,5);assert.equal((await get(`properties/${propertyId}`)).dwellingCount,5);
  assert.deepEqual(await get('equipmentSystems/OLD'),before);
  assert.equal((await db.collection('equipmentSystems').get()).size,1);
  for(const quantity of [23,40]) {
    const p=`P-${quantity}`; await db.doc(`properties/${p}`).set({clientId:customerId,active:true});
    await locations.save({customerId,propertyId:p,kind:'dwellings',rows:Array.from({length:quantity},(_,i)=>apartment(String(i+1))),expectedVersion:0,requestId:`test-complex-${quantity}`},identity);
    assert.equal((await locations.list({customerId,propertyId:p})).dwellings.length,quantity);
  }
});

test('K: exact retries and concurrent double submits create one audit; competing stale batches commit only once',async()=>{
  const args=[[apartment()],0,'test-double-submit'];
  const results=await Promise.all([create(...args),create(...args)]);
  assert.equal(results.filter(x=>x.replayed).length,1);
  assert.equal((await db.collection('bookingIdempotency').where('operation','==','save_property_dwellings').get()).size,1);
  await assert.rejects(()=>create([apartment('2')],0,'test-double-submit'),/request ID/);
  const concurrent=await Promise.allSettled([create([apartment('2')],1,'test-race-a'),create([apartment('2')],1,'test-race-b')]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await locations.list({customerId,propertyId})).dwellings.length,2);
});

test('D/K/L: batch duplicates and invalid cross-customer contacts fail atomically; codes normalize without changing IDs',async()=>{
  await assert.rejects(()=>create([apartment('1'),apartment(' １ ')]),/already exists/);
  assert.equal((await locations.list({customerId,propertyId})).dwellings.length,0);
  await db.doc('contacts/foreign').set({clientId:'someone-else',active:true});
  await assert.rejects(()=>create([{...apartment(),contactIds:['foreign']}]),/must belong/);
  assert.equal((await db.collection('bookingIdempotency').get()).size,0);
  const first=await create([apartment()]);
  await create([{...apartment('A'),id:first.ids[0],name:'Renamed'}],1,'test-renaming');
  const current=await locations.list({customerId,propertyId});assert.equal(current.dwellings[0].id,first.ids[0]);assert.equal(current.dwellings[0].name,'Renamed');
});

test('G/L: requester and access contact are visit snapshots; neighboring tenant excluded; no contact, ownership or billing reassignment',async()=>{
  const saved=await create([{...apartment('1'),contactIds:['access']},{...apartment('2'),contactIds:['requester']}]);
  const client={...await get(`clients/${customerId}`),id:customerId};const property={...await get(`properties/${propertyId}`),id:propertyId};
  const snapshot=await db.runTransaction(transaction=>resolvePropertyLocation({db,transaction,customer:client,property,request:{customerId,dwellingId:saved.ids[0],requesterId:'contact:requester',accessContactId:'contact:access'}}));
  assert.equal(snapshot.requester.name,'Synthetic Requester');assert.equal(snapshot.accessContact.name,'Synthetic Access');
  const recipients=await resolveAppointmentRecipients(db,{clientId:customerId,propertyId,dwellingId:saved.ids[0]});
  assert.ok(!recipients.some(r=>r.sourceId==='requester'));assert.ok(recipients.some(r=>r.sourceId==='access'));
  assert.equal((await get(`properties/${propertyId}`)).clientId,customerId);
  assert.equal((await get('contacts/requester')).clientId,customerId);
  await assert.rejects(()=>resolvePropertyLocation({db,customer:client,property,request:{customerId,dwellingId:'neighbor-from-another-property'}}),/does not belong/);
});

test('F/I/L: canonical booking commits location without equipment; missing dwelling fails closed and no capacity records are written',async()=>{
  const saved=await create([apartment()]);
  const booking=createBookingAuthority({db,availabilityProvider:createSchedulingProvider({db})});
  const request={customerId,propertyId,workLines:[{presetId:'standard_service',quantity:2}],constraints:{requestedDate:date,requestedTime:'08:30'}};
  const offer=await booking.checkAvailability({request,context:{requiredPrimaryVanId:'VAN-2'}});
  assert.ok(offer.options.length,JSON.stringify(offer));
  const selection={offerId:offer.offer.id,offerVersion:offer.offer.version,optionId:offer.options[0].id,idempotencyKey:'test-no-dwelling'};
  await assert.rejects(()=>booking.createAppointment(selection),/Select the dwelling/);
  assert.equal((await db.collection('appointments').get()).size,1);
  const correct=await booking.checkAvailability({request:{...request,dwellingId:saved.ids[0],requesterId:'contact:requester',accessContactId:'contact:access'},context:{requiredPrimaryVanId:'VAN-2'}});
  const created=await booking.createAppointment({offerId:correct.offer.id,offerVersion:correct.offer.version,optionId:correct.options[0].id,idempotencyKey:'test-valid-dwelling'});
  assert.equal(created.appointment.dwellingId,saved.ids[0]);assert.equal(created.appointment.locationSnapshot.accessContact.name,'Synthetic Access');
  for(const wo of created.workOrderIds) {assert.equal((await get(`workOrders/${wo}`)).dwellingId,saved.ids[0]);assert.equal((await get(`workOrders/${wo}`)).airConditionerCount,2);}
  assert.equal((await db.collection('equipmentSystems').get()).size,1);
});

test('L: live facade authentication denies technician, invalid token and anonymous location reads/writes',async()=>{
  for(const token of ['','demo-technician','fake']) for(const action of ['list_property_locations','save_property_locations']) {
    const result=await api(action,{customerId,propertyId},token);assert.ok([401,403].includes(result.status),JSON.stringify(result));
  }
  assert.equal((await api('list_property_locations',{customerId,propertyId})).status,200);
  const wrong=await api('list_property_locations',{customerId:'wrong',propertyId});assert.notEqual(wrong.status,200);
});

test('E: field registration creates distinct identical equipment in one area; preserves previous assets; rejects neighboring dwelling attach',async()=>{
  const saved=await create([apartment('1'),apartment('2')]);
  const wo={...await get('workOrders/DEMO-WO'),dwellingId:saved.ids[0],status:'En el sitio'};
  await db.doc('workOrders/DEMO-WO').set(wo);
  const visitId='DEMO-VISIT'; const stamp=new Date().toISOString();
  await db.doc(`workVisits/${visitId}`).set({id:visitId,fieldAuthorityVersion:1,workOrderId:'DEMO-WO',appointmentId:'DEMO-APT',clientId:customerId,propertyId,dwellingId:saved.ids[0],scheduledScopeSnapshot:{appointmentId:'DEMO-APT',capturedAt:stamp,estimatedUnitCount:3,workLines:[]},status:'on_site',participatingStaffIds:['DRIVER-1'],requiresSecondVisit:false,createdAt:stamp,createdByUserId:'demo-tech',updatedAt:stamp,updatedByUserId:'demo-tech',version:1});
  const dependencies={db,resolveAssignment:async()=>({assigned:true,responsibility:'technician',source:'direct_staff',readOnly:false}),appendAuditInTransaction:async()=>{},verifyStoredImage:async()=>({contentType:'image/jpeg',size:128,sizeBytes:128})};
  const register=createRegisterEquipmentSystemCommand(dependencies);const attach=createAttachExistingVisitAssetCommand(dependencies);
  const input={identity:{uid:'demo-tech',staffId:'DRIVER-1',name:'Synthetic Tech',role:'technician'},visitId,locationLabel:'Living room',systemType:'Split',brand:'DEMO',btu:12000,refrigerant:'R32',voltage:'220V',evidencePaths:Object.fromEntries(['equipment_reference','indoor_nameplate','outdoor_nameplate'].map(kind=>[kind,`field-evidence/${visitId}/test/${kind}.jpg`]))};
  const a=await register({...input,requestId:'test-equipment-a'});const b=await register({...input,requestId:'test-equipment-b'});
  assert.notEqual(a.equipment.id,b.equipment.id);
  const aRecord=await get(`equipmentSystems/${a.equipment.id}`);const bRecord=await get(`equipmentSystems/${b.equipment.id}`);
  assert.equal(aRecord.areaId,bRecord.areaId);assert.equal(aRecord.dwellingId,saved.ids[0]);
  await attach({identity:input.identity,visitId,assetId:a.equipment.id,requestId:'test-attach-a'});
  await db.doc('equipmentSystems/NEIGHBOR').set({...aRecord,dwellingId:saved.ids[1]});
  await assert.rejects(()=>attach({identity:input.identity,visitId,assetId:'NEIGHBOR',requestId:'test-attach-neighbor'}),/different dwelling/);
  assert.ok(await get('equipmentSystems/OLD'));
});
