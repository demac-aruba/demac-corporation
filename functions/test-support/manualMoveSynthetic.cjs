const { hashId, arubaDateParts } = require('../bookingSchedulingPrimitives');
const PROJECT = 'demo-demac-overtime';
function assertIsolated() {
  if (process.env.GCLOUD_PROJECT !== PROJECT || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('This fixture only runs against the loopback demo-demac-overtime emulator.');
}
function seedRecords(date = arubaDateParts(new Date()).date) {
  const records = {
    'users/demo-office': { name: 'Operador de prueba', role: 'office', active: true },
    'users/demo-technician': { name: 'Técnico de prueba', role: 'technician', active: true },
    'clients/DEMO-CUSTOMER': { name: 'Cliente sintético · 3 cupos', active: true },
    'properties/DEMO-PROPERTY': { clientId: 'DEMO-CUSTOMER', name: 'Propiedad de prueba', address: 'Dirección sintética', operationalZone: 'Santa Cruz', active: true },
    'businessSettings/business-calendar': { closedWeekdays: [0] },
    'businessSettings/appointment-work-presets': { presets: [{ id: 'standard_service', label: 'Servicio sintético', durationMinutesPerUnit: 60, active: true }] },
    'services/SYNTHETIC-SERVICE': { name: 'Servicio sintético', durationMinutes: 60, active: true },
  };
  for (let i = 1; i <= 4; i++) {
    records[`vans/VAN-${i}`] = { name: `Van ${i}`, active: true, status: 'Disponible', responsibleStaffId: `DRIVER-${i}`, regularHelperId: `HELPER-${i}` };
    records[`staffProfiles/DRIVER-${i}`] = { name: `Técnico ${i}`, active: true, availability: 'Disponible', canDriveVan: true };
    records[`staffProfiles/HELPER-${i}`] = { name: `Ayudante ${i}`, active: true, availability: 'Disponible' };
  }
  const sourceSlots = ['08:30', '09:30', '10:30'];
  const locks = sourceSlots.map((slot) => `BAL-${hashId(`${date}|VAN-1|${slot}`, 32).toUpperCase()}`);
  records['appointments/DEMO-APT'] = {
    appointmentId: 'DEMO-APT', customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', status: 'confirmed', source: 'office-scheduling', date,
    startTime: '08:30', endTime: '11:30', primaryVanId: 'VAN-1', createdByName: 'Operador de prueba',
    assignments: [{ vanId: 'VAN-1', vanName: 'Van 1', time: '08:30', endTime: '11:30', slots: 3, quantity: 3, role: 'primary' }],
    workOrderIds: ['DEMO-WO'], capacityLockIds: locks, lifecycleHistory: [],
  };
  records['workOrders/DEMO-WO'] = {
    appointmentId: 'DEMO-APT', clientId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', date, time: '08:30', vanId: 'VAN-1',
    status: 'Confirmada', appointmentAssignmentRole: 'primary', scheduledSlots: 3, appointmentDurationMinutes: 180, appointmentEndTime: '11:30',
    serviceId: 'SYNTHETIC-SERVICE', appointmentWorkType: 'standard_service', appointmentWorkLabel: 'Servicio sintético · tres cupos',
    airConditionerCount: 3, technicianIds: ['DRIVER-1', 'HELPER-1'], customerCommunicationOwner: true, whatsappNotificationsEnabled: false,
  };
  locks.forEach((id, index) => { records[`bookingCapacityLocks/${id}`] = { date, vanId: 'VAN-1', slot: sourceSlots[index], active: true, appointmentId: 'DEMO-APT' }; });
  return records;
}
async function resetSynthetic(db, date) {
  assertIsolated();
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Synthetic reset failed');
  const batch = db.batch();
  for (const [path, value] of Object.entries(seedRecords(date))) batch.set(db.doc(path), value);
  await batch.commit();
}
module.exports = { PROJECT, assertIsolated, resetSynthetic, seedRecords };
