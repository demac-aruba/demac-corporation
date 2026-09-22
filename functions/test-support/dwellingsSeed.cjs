const { PROJECT, assertIsolated } = require('./dwellingsIsolation.cjs');
assertIsolated();
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { seedRecords } = require('./manualMoveSynthetic.cjs');
const { createOfficeBookingApi } = require('../officeBookingAuthority');
const { createPropertyLocationService } = require('../propertyLocations');
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
const db = getFirestore();
const auth = getAuth();
async function main() {
  if (!process.env.DWELLINGS_PREVIEW_PASSWORD || process.env.DWELLINGS_PREVIEW_PASSWORD.length < 16) throw new Error('Set the private synthetic-account password.');
  if ((await db.doc('previewFixtures/dwellings-v1').get()).exists) { console.log('Existing synthetic preview retained; no reset.'); return; }
  for (const [uid, role, name, staffId] of [['demo-office','super_admin','DEMO Office reviewer',''],['demo-tech','technician','DEMO Field technician','DRIVER-1']]) {
    const email = `${uid}@demac-preview.invalid`;
    try { await auth.getUser(uid); } catch { await auth.createUser({ uid, email, password: process.env.DWELLINGS_PREVIEW_PASSWORD, displayName: name }); }
    await db.doc(`users/${uid}`).set({ name, email, role, staffId, active: true });
  }
  const batch = db.batch();
  for (const [path, value] of Object.entries(seedRecords())) {
    if (['vans','staffProfiles','businessSettings','services'].includes(path.split('/')[0])) batch.set(db.doc(path), value);
  }
  await batch.commit();
  const identity = { uid: 'demo-office', role: 'super_admin', name: 'DEMO Office reviewer' };
  const api = createOfficeBookingApi({ db, verifyIdToken: () => { throw new Error('Seeding has no HTTP authentication bypass.'); } });
  const locations = createPropertyLocationService({ db });
  const result = {};
  for (const [index, name, propertyName] of [[1,'DEMO Owner A','DEMO Garden House'],[2,'DEMO Owner B','DEMO Coral Court'],[3,'DEMO Owner C','DEMO Palm Court']]) {
    const created = await api.execute({ action: 'create_customer_property', identity, data: { requestId: `synthetic-dwellings-owner-${index}`, customer: { name, phone: `+1999555010${index}`, type: 'Residential' }, property: { name: propertyName, address: `DEMO Test Lane ${index}00`, zone: 'Santa Cruz', type: 'Casa' } } });
    result[index] = { customerId: created.customer.id, propertyId: created.property.id };
  }
  await api.execute({ action: 'create_property', identity, data: { ...result[2], requestId: 'synthetic-second-property', property: { name: 'DEMO Second Property', address: 'DEMO Test Lane 250', zone: 'Santa Cruz', type: 'Local comercial' } } });
  for (const [suffix, name] of [['access','DEMO Access contact'],['requester','DEMO Requester']]) {
    const contactId = `DEMO-${suffix}`;
    await db.doc(`contacts/${contactId}`).set({ id: contactId, clientId: result[1].customerId, name, phone: '', email: `${suffix}@demac-preview.invalid`, active: true });
  }
  for (const [index, count] of [[1,4],[2,23],[3,40]]) {
    const rows = [...(index === 1 ? [{ code: 'MAIN', name: 'Main house', type: 'main_house' }] : []), ...Array.from({ length: count }, (_, i) => ({ code: String(i + 1), name: `Apartment ${i + 1}`, type: 'apartment', ...(index === 1 && i === 0 ? { contactIds: ['DEMO-access'] } : {}) }))];
    const saved = await locations.save({ ...result[index], expectedVersion: 0, requestId: `synthetic-dwellings-${index}`, kind: 'dwellings', rows }, identity);
    result[index].dwellingIds = saved.ids;
  }
  await db.doc('equipmentSystems/DEMO-OLD-AC').set({ id: 'DEMO-OLD-AC', clientId: result[1].customerId, propertyId: result[1].propertyId, brand: 'DEMO', btu: 12000, locationLabel: 'Existing unclassified A/C', active: true });
  await locations.save({ ...result[1], expectedVersion: 1, requestId: 'synthetic-area-first-room', kind: 'areas', rows: [{ code: 'LIVING', name: 'Living room', dwellingId: result[1].dwellingIds[1] }] }, identity);
  await db.doc('previewFixtures/dwellings-v1').set({ createdAt: new Date().toISOString(), records: result, synthetic: true });
  console.log('Synthetic customers, 68 dwellings, test roles and one historical unclassified A/C persisted.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
