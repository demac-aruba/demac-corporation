// Test-fixture extension only. Never load this module outside the exact demo emulator.
const { PROJECT, assertIsolated } = require('./dwellingsIsolation.cjs');
assertIsolated();
const fs = require('node:fs');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { arubaDateParts, hashId } = require('../bookingSchedulingPrimitives');
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
const db = getFirestore(), auth = getAuth();
async function main() {
  const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
  const fixture = await db.doc('previewFixtures/dwellings-v1').get();
  if (!fixture.exists) throw new Error('Initialize the existing isolated dwellings fixture first.');
  if ((await db.doc('previewFixtures/technician-portal-v1').get()).exists) { console.log('Existing Field fixture retained.'); return; }
  for (const account of credentials.accounts) {
    if (!account.uid.startsWith('demo-') || !account.email.endsWith('@demac-preview.invalid') || account.password.length < 20) throw new Error('Invalid synthetic account.');
    try { await auth.getUser(account.uid); await auth.updateUser(account.uid, { email: account.email, password: account.password, displayName: account.name, disabled: false }); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; await auth.createUser({ uid: account.uid, email: account.email, password: account.password, displayName: account.name }); }
    await db.doc(`users/${account.uid}`).set({ name: account.name, email: account.email, role: account.role, staffId: account.staffId || '', active: true });
    if (account.staffId) await db.doc(`staffProfiles/${account.staffId}`).set({ name: account.name, active: true, availability: 'Disponible', ...(account.staffId.startsWith('DRIVER') ? { canDriveVan: true } : {}) }, { merge: true });
  }
  const date = arubaDateParts(new Date()).date;
  const locations = fixture.data().records;
  const plan = [
    ['DEMO-FIELD-1', '08:30', '09:30', locations[1], 'Confirmada'],
    ['DEMO-FIELD-2', '09:30', '10:30', locations[2], 'Completada'],
    ['DEMO-FIELD-3', '13:00', '14:00', locations[3], 'Confirmada'],
  ];
  const batch = db.batch();
  batch.set(db.doc('services/SYNTHETIC-SERVICE'), { name: 'DEMO · Standard Service', type: 'Service', category: 'Maintenance', durationMinutes: 60, active: true });
  batch.set(db.doc('vans/VAN-1'), { name: 'DEMO · Van 1' }, { merge: true });
  for (const [id, time, endTime, location, status] of plan) {
    const dwellingId = location.dwellingIds[id.endsWith('3') ? 2 : 1];
    const label = `DEMO · Apartamento ${id.endsWith('1') ? '1' : id.endsWith('2') ? '2' : '3'}`;
    const appointmentId = `${id}-APT`;
    const lockId = `BAL-${hashId(`${date}|VAN-1|${time}`, 32).toUpperCase()}`;
    const locationSnapshot = { locationLabel: label, accessInstructions: 'DEMO · Entrar por el acceso señalado para la prueba.', accessContact: { name: 'DEMO · Contacto de acceso', phone: '' }, requester: { name: 'DEMO · Solicitante' } };
    batch.set(db.doc(`appointments/${appointmentId}`), { appointmentId, customerId: location.customerId, propertyId: location.propertyId, dwellingId, locationSnapshot, status: status === 'Completada' ? 'completed' : 'confirmed', source: 'office-scheduling', date, startTime: time, endTime, primaryVanId: 'VAN-1', createdByName: 'DEMO · Oficina', assignments: [{ vanId: 'VAN-1', vanName: 'DEMO · Van 1', time, endTime, slots: 1, quantity: 1, role: 'primary' }], workOrderIds: [id], capacityLockIds: [lockId], lifecycleHistory: [] });
    batch.set(db.doc(`workOrders/${id}`), { appointmentId, clientId: location.customerId, propertyId: location.propertyId, dwellingId, locationSnapshot, date, time, vanId: 'VAN-1', status, appointmentAssignmentRole: 'primary', scheduledSlots: 1, appointmentDurationMinutes: 60, appointmentEndTime: endTime, serviceId: 'SYNTHETIC-SERVICE', appointmentWorkType: 'standard_service', appointmentWorkLabel: 'DEMO · Standard Service', appointmentWorkItems: [{ id: `${id}-LINE`, serviceId: 'SYNTHETIC-SERVICE', label: 'DEMO · Standard Service', quantity: 1, durationMinutes: 60 }], airConditionerCount: 1, technicianIds: ['DRIVER-1','HELPER-1'], customerCommunicationOwner: false, whatsappNotificationsEnabled: false, customerFacingDescription: 'DEMO · Servicio de prueba · 1 aire', technicianInstructions: 'Entorno sintético. No realizar trabajos reales ni comunicaciones externas.' });
    batch.set(db.doc(`bookingCapacityLocks/${lockId}`), { date, vanId: 'VAN-1', slot: time, active: true, appointmentId });
    batch.set(db.doc(`equipmentSystems/${id}-AC`), { id: `${id}-AC`, clientId: location.customerId, propertyId: location.propertyId, dwellingId, locationLabel: 'DEMO · Sala', systemType: 'Split wall mounted', active: true, components: [{ id: `${id}-INDOOR`, componentType: 'indoor', brand: 'DEMO', model: 'DEMO-12', serialNumber: `${id}-IN`, btu: 12000, refrigerant: 'R32', voltage: '220' }, { id: `${id}-OUTDOOR`, componentType: 'outdoor', brand: 'DEMO', model: 'DEMO-12-OD', serialNumber: `${id}-OUT`, btu: 12000, refrigerant: 'R32', voltage: '220' }] });
  }
  batch.set(db.doc('previewFixtures/technician-portal-v1'), { synthetic: true, date, createdAt: new Date().toISOString(), workOrderIds: plan.map((row) => row[0]), unitCapacityNote: 'Technical values are synthetic fixtures, not verified customer data.' });
  await batch.commit();
  console.log('Synthetic Field accounts, three Work Orders and scoped equipment persisted; no external workers.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
