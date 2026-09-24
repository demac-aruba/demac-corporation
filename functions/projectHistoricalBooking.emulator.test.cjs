const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createProjectApi } = require('./projectAuthority');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { withProjectBookingLinks } = require('./projectBookingLinks');
const { createOfficeBookingApi } = require('./officeBookingAuthority');
const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
const { lockId } = require('./projectHistoricalBooking');
const { seedRecords } = require('./test-support/manualMoveSynthetic.cjs');
const { initialVisitDocumentId } = require('./fieldOperationsAuthorityWorkVisit');

const PROJECT = 'demo-demac-project-history';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8398'
  || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw Error('Project history tests require the isolated loopback demo emulator without production credentials.');
}
const app = initializeApp({ projectId: PROJECT }, 'project-history-tests');
const db = getFirestore(app);
const clock = () => new Date('2026-09-23T14:00:00Z');
const api = createProjectApi({ db, clock, verifyIdToken: async uid => ({ uid }) });
const call = (action, data = {}, uid = 'demo-owner') => api.handle({ method: 'POST',
  headers: { authorization: `Bearer ${uid}` }, body: { action, data } });
const get = async path => (await db.doc(path).get()).data();
const anchors = ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'];
const correction = (extra = {}) => ({ requestId: 'adjust-request-1', projectId: 'DEMO-HISTORY-PROJECT',
  appointmentId: 'DEMO-OLD', expectedVersion: 1, slots: 4,
  reason: 'Correct unexecuted historical Project slots', noBillingAcknowledged: true, ...extra });
const project = () => ({ id: 'DEMO-HISTORY-PROJECT', projectNumber: 'DEMO-101', name: 'Synthetic Project',
  customerId: 'DEMO-C', siteId: 'DEMO-P', status: 'Planned', estimatedSlots: 6, estimatedLaborHours: 6,
  scheduledFutureHours: 3, actualLaborHours: 0, completedUnits: 0, materialActual: 0,
  phases: [{ id: 'DEMO-PHASE', name: 'Installation', estimatedLaborHours: 6, actualLaborHours: 0,
    actualMaterialCost: 0, unitsCompleted: 0, progress: 0 }], materials: [], expenses: [], costEntries: [],
  assignments: [{ id: 'legacy-link', projectId: 'DEMO-HISTORY-PROJECT', phaseId: 'DEMO-PHASE',
    appointmentId: 'DEMO-OLD', workOrderId: 'DEMO-OLD-WO', actualHours: 0, unitsCompleted: 0 }] });
async function publish() {
  const result = await call('save', { project: project(), expectedVersion: 0, requestId: 'publish-1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.project;
}
beforeEach(async () => {
  const response = await fetch(`http://127.0.0.1:8398/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  const seed = {
    'users/demo-owner': { role: 'admin', active: true, name: 'Synthetic owner' },
    'users/demo-finance': { role: 'accounting', active: true },
    'users/demo-office': { role: 'office', active: true },
    'users/demo-inactive': { role: 'admin', active: false },
    'users/demo-tech': { role: 'technician', active: true },
    'clients/DEMO-C': { name: 'Synthetic customer', active: true },
    'properties/DEMO-P': { clientId: 'DEMO-C', active: true, address: 'Synthetic site' },
    'staffProfiles/DEMO-TECH-OLD': { name: 'Synthetic technician' },
    'appointments/DEMO-OLD': { appointmentId: 'DEMO-OLD', customerId: 'DEMO-C', propertyId: 'DEMO-P',
      date: '2026-09-21', status: 'confirmed', startTime: '08:30', endTime: '11:30', capacityEndTime: '11:30',
      primaryVanId: 'DEMO-VAN', workOrderIds: ['DEMO-OLD-WO'],
      capacityLockIds: anchors.slice(0, 3).map(slot => lockId('2026-09-21', 'DEMO-VAN', slot)),
      assignments: [{ vanId: 'DEMO-VAN', vanName: 'Historical Van', technicianIds: ['DEMO-TECH-OLD'],
        quantity: 1, slots: 3, durationMinutes: 180, time: '08:30', endTime: '11:30',
        capacityEndTime: '11:30', role: 'primary' }] },
    'workOrders/DEMO-OLD-WO': { appointmentId: 'DEMO-OLD', clientId: 'DEMO-C', propertyId: 'DEMO-P',
      date: '2026-09-21', time: '08:30', appointmentEndTime: '11:30', appointmentCapacityEndTime: '11:30',
      appointmentDurationMinutes: 180, vanId: 'DEMO-VAN', technicianIds: ['DEMO-TECH-OLD'],
      status: 'Confirmada', scheduledSlots: 3 },
    'vans/DEMO-VAN': { active: false, driverStaffId: 'DEMO-TECH-TODAY' },
  };
  anchors.slice(0, 3).forEach(slot => { seed[`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', slot)}`] = {
    appointmentId: 'DEMO-OLD', date: '2026-09-21', vanId: 'DEMO-VAN', slot, active: true,
  }; });
  await Promise.all(Object.entries(seed).map(([path, value]) => db.doc(path).set(value)));
});
after(async () => { await db.terminate(); await deleteApp(app); });

test('explicit Project publication is dry-run capable, shared and idempotent', async () => {
  const input = { project: project(), expectedVersion: 0, requestId: 'publish-1' };
  assert.equal((await call('save', { ...input, dryRun: true })).status, 200);
  assert.equal((await db.collection('projectRecords').get()).size, 0);
  await publish();
  assert.equal((await call('save', input)).body.replayed, true);
  assert.equal((await call('list', {}, 'demo-finance')).body.projects[0].assignments[0].scheduledSlots, 3);
  assert.equal((await db.collection('projectBookingClaims').get()).size, 1);
});

test('in-place historical Project adjustment owns the fourth lunch-crossing anchor without a new booking', async () => {
  await publish();
  const sources = await call('history_capacity_sources', { projectId: 'DEMO-HISTORY-PROJECT' });
  assert.equal(sources.status, 200, JSON.stringify(sources.body));
  assert.equal(sources.body.sources[0].eligible, true);
  assert.equal(sources.body.usedSlots, 3);
  assert.deepEqual(sources.body.sources[0].technicianNames, ['Synthetic technician']);
  const result = await call('history_adjust_capacity', correction());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.currentSlots, 4);
  assert.equal(result.body.usedAfter, 4);
  assert.equal((await get('appointments/DEMO-OLD')).capacityEndTime, '14:30');
  assert.equal((await get('workOrders/DEMO-OLD-WO')).appointmentDurationMinutes, 360);
  assert.equal((await get('workOrders/DEMO-OLD-WO')).scheduledSlots, 4);
  assert.equal((await get('projectRecords/DEMO-HISTORY-PROJECT')).scheduledFutureHours, 4);
  assert.equal((await get(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', '13:30')}`)).active, true);
  assert.equal((await db.collection('appointments').get()).size, 1);
  assert.equal((await db.collection('workOrders').get()).size, 1);
  assert.equal((await db.collection('projectCapacityCorrections').get()).size, 1);
  assert.equal((await db.collection('whatsappMessages').get()).size, 0);
});

test('reduction releases own trailing locks; retry after later billing does not rewrite history', async () => {
  await publish();
  const first = await call('history_adjust_capacity', correction());
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await call('history_adjust_capacity', correction({ requestId: 'adjust-request-2', expectedVersion: 2, slots: 2 }));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal((await get(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', '10:30')}`)).active, false);
  assert.equal((await get(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', '13:30')}`)).active, false);
  await db.doc('invoices/DEMO-LATER').set({ workOrderId: 'DEMO-OLD-WO', status: 'paid' });
  const replay = await call('history_adjust_capacity', correction());
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.replayedEntry.currentSlots, 4);
  assert.equal(replay.body.currentSlots, 2);
  assert.equal((await db.collection('projectCapacityCorrections').get()).size, 2);
  assert.equal((await db.collection('appointments').get()).size, 1);
});

test('billing, Field Visit and claim disagreement block in-place writes on the server', async () => {
  await publish();
  const cases = [
    ['invoices/DEMO-INVOICE', { workOrderId: 'DEMO-OLD-WO' }],
    ['payments/DEMO-PAYMENT', { appointmentId: 'DEMO-OLD' }],
    [`workVisits/${initialVisitDocumentId('DEMO-OLD-WO')}`, { status: 'not_started' }],
    ['projectBookingClaims/DEMO-OLD', { projectId: 'OTHER', appointmentId: 'DEMO-OLD' }],
  ];
  const claim = await get('projectBookingClaims/DEMO-OLD');
  for (const [path, value] of cases) {
    await db.doc(path).set(value);
    const response = await call('history_adjust_capacity', correction({ requestId: `blocked-${path.split('/')[0]}` }));
    assert.notEqual(response.status, 200, path);
    assert.equal((await db.collection('projectCapacityCorrections').get()).size, 0);
    assert.equal((await get('workOrders/DEMO-OLD-WO')).scheduledSlots, 3);
    if (path.startsWith('projectBookingClaims/')) await db.doc(path).set(claim);
    else await db.doc(path).delete();
  }
});

test('budget overrun requires explicit acknowledgement; no-billing attestation is always required', async () => {
  await publish();
  await db.doc('projectRecords/DEMO-HISTORY-PROJECT').update({ estimatedSlots: 3 });
  const withoutBilling = await call('history_adjust_capacity', correction({ noBillingAcknowledged: false }));
  assert.notEqual(withoutBilling.status, 200);
  const withoutBudget = await call('history_adjust_capacity', correction());
  assert.notEqual(withoutBudget.status, 200);
  const accepted = await call('history_adjust_capacity', correction({ overBudgetAcknowledged: true }));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.overBudget, 1);
  const audit = (await db.collection('projectCapacityCorrections').get()).docs[0].data();
  assert.equal(audit.noBillingAcknowledged, true);
  assert.equal(audit.overBudgetAcknowledged, true);
});

test('legacy recovery cannot create an offer for a still-confirmed Project booking', async () => {
  await publish();
  const preview = await call('history_preview', { requestId: 'legacy-preview', projectId: 'DEMO-HISTORY-PROJECT',
    sourceAppointmentId: 'DEMO-OLD', phaseId: 'DEMO-PHASE', expectedVersion: 1, start: '08:30', slots: 2,
    reason: 'Recover previously cancelled Project work', backdatingAcknowledged: true, noBillingAcknowledged: true });
  assert.notEqual(preview.status, 200);
  assert.equal((await db.collection('bookingOffers').get()).size, 0);
  assert.equal((await db.collection('appointments').get()).size, 1);
});

test('an already-cancelled clean Project booking can recover with one guarded replacement', async () => {
  await publish();
  await createBookingAppointmentLifecycle({ db, schedulingProvider: createSchedulingProvider({ db }), clock })
    .cancelAppointment({ appointmentId: 'DEMO-OLD', reason: 'Already cancelled historical booking',
      actor: { id: 'demo-owner', name: 'Synthetic owner' } });
  const input = { requestId: 'legacy-recovery-preview', projectId: 'DEMO-HISTORY-PROJECT',
    sourceAppointmentId: 'DEMO-OLD', phaseId: 'DEMO-PHASE', expectedVersion: 1, start: '08:30', slots: 2,
    reason: 'Recover previously cancelled Project work', backdatingAcknowledged: true, noBillingAcknowledged: true };
  assert.notEqual((await call('history_preview', { ...input, noBillingAcknowledged: false })).status, 200);
  const originalProject = await get('projectRecords/DEMO-HISTORY-PROJECT');
  await db.doc('projectRecords/DEMO-HISTORY-PROJECT').update({ assignments: originalProject.assignments.map(link => ({ ...link, scheduledDate: '2026-09-20' })) });
  assert.notEqual((await call('history_preview', input)).status, 200);
  await db.doc('projectRecords/DEMO-HISTORY-PROJECT').update({ assignments: originalProject.assignments });
  const sources = await call('history_sources', { projectId: input.projectId });
  assert.equal(sources.status, 200, JSON.stringify(sources.body));
  assert.equal(sources.body.sources[0].appointmentId, 'DEMO-OLD');
  const preview = await call('history_preview', input);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const confirm = { requestId: 'legacy-recovery-confirm', offerId: preview.body.offer.id,
    offerVersion: preview.body.offer.version, optionId: preview.body.options[0].id,
    backdatingAcknowledged: true, noBillingAcknowledged: true };
  await db.doc('invoices/DEMO-RECOVERY-BILLED').set({ workOrderId: 'DEMO-OLD-WO' });
  const billed = await call('history_confirm', confirm);
  assert.notEqual(billed.status, 200);
  assert.equal((await db.collection('appointments').get()).size, 1);
  await db.doc('invoices/DEMO-RECOVERY-BILLED').delete();
  const result = await call('history_confirm', confirm);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.notEqual(result.body.appointmentId, 'DEMO-OLD');
  assert.equal((await get('appointments/DEMO-OLD')).status, 'cancelled');
  assert.equal((await get('projectRecords/DEMO-HISTORY-PROJECT')).scheduledFutureHours, 2);
  assert.equal((await get('projectHistoricalCorrections/DEMO-OLD')).noBillingAcknowledged, true);
  assert.equal((await db.collection('appointments').get()).size, 2);
  assert.equal((await call('history_confirm', confirm)).body.replayed, true);
  assert.equal((await db.collection('appointments').get()).size, 2);
});

test('fresh roles deny non-managers and direct anonymous writes remain denied', async () => {
  await publish();
  for (const uid of ['demo-office', 'demo-tech', 'demo-inactive', 'missing']) {
    assert.equal((await call('history_adjust_capacity', correction(), uid)).status, 403);
  }
  assert.equal((await call('history_adjust_capacity', correction(), 'demo-finance')).status, 403);
  for (const collection of ['projectRecords', 'projectPlanningAudit', 'projectCapacityCorrections', 'projectBookingClaims']) {
    const response = await fetch(`http://127.0.0.1:8398/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/DEMO-TEST`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { forged: { booleanValue: true } } }),
    });
    assert.equal(response.status, 403, collection);
  }
});

test('ordinary shared Project booking remains atomic and retry-safe', async () => {
  await publish();
  const seed = seedRecords('2026-09-24');
  await Promise.all(Object.entries(seed).filter(([path]) => !path.startsWith('users/')).map(([path, value]) => db.doc(path).set(value)));
  await db.doc('properties/DEMO-P').update({ operationalZone: 'Santa Cruz' });
  const provider = createSchedulingProvider({ db });
  const authority = createBookingAuthority({ db, clock, availabilityProvider: withProjectBookingLinks({ db, provider }) });
  const office = createOfficeBookingApi({ db, verifyIdToken: async uid => ({ uid }), bookingAuthority: authority, schedulingProvider: provider });
  const invoke = (action, data) => office.handle({ method: 'POST', headers: { authorization: 'Bearer demo-owner' }, body: { action, data } });
  const version = (await get('projectRecords/DEMO-HISTORY-PROJECT')).serverVersion;
  const input = { requestId: 'future-preview-1', customerId: 'DEMO-C', propertyId: 'DEMO-P', requestedDate: '2026-09-24',
    requestedTime: '08:30', requiredVanId: 'VAN-2', workLines: [{ presetId: 'standard_service', serviceId: 'SYNTHETIC-SERVICE', quantity: 2 }],
    project: { id: 'DEMO-HISTORY-PROJECT', phaseId: 'DEMO-PHASE', version } };
  const offer = await invoke('check_availability', input);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  const data = { requestId: 'future-confirm-1', offerId: offer.body.offer.id,
    offerVersion: offer.body.offer.version, optionId: offer.body.options[0].id };
  const result = await invoke('create_appointment', data);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await invoke('create_appointment', data)).body.replayed, true);
  const saved = await get('projectRecords/DEMO-HISTORY-PROJECT');
  assert.ok(saved.assignments.find(link => link.appointmentId === result.body.appointmentId));
});
