import assert from 'node:assert/strict';
import { historyForSlots, projectSlotHistory, type ScheduleHistoryAppointment } from '../lib/scheduling-slot-history';

const from = { dateKey: '2026-10-12', primaryVanId: 'legacy-van', primaryStart: '08:30', primaryEnd: '10:30', primaryCapacityEnd: '11:30', supportVanId: 'VAN-2', supportStart: '09:30' };
const appointment: ScheduleHistoryAppointment = { appointmentId: 'A', customerId: 'C', propertyId: 'P', status: 'cancelled', date: '2026-11-01', startTime: '13:30', primaryVanId: 'VAN-3', workLabel: 'Service', events: [
  { id: 'E1', kind: 'customer_reschedule', at: '2026-10-12T12:00:00.000Z', actorName: 'Office', reason: 'Customer request', note: '', from, to: { ...from, dateKey: '2026-11-01' } },
  { id: 'E2', kind: 'cancelled', at: '2026-10-13T12:00:00.000Z', actorName: 'Office', reason: 'Cancelled', note: '', from: { ...from, dateKey: '2026-11-01' }, to: null },
] };
const references = { clients: [{ id: 'C', name: 'Customer' }], properties: [{ id: 'P', name: 'Property' }], vans: [{ id: 'legacy-van', name: 'Van 1' }] };
const untouched = JSON.stringify(appointment);
const items = projectSlotHistory([appointment, appointment], references);
assert.equal(items.length, 4, 'Duplicate responses deduplicate by appointment/event/role');
const original = items.filter(item => item.date === '2026-10-12');
const primary = original.filter(item => item.role === 'primary');
assert.equal(primary[0].vanId, 'VAN-1'); assert.equal(primary[0].customer, 'Customer');
assert.equal(historyForSlots(primary, ['10:30']).length, 1, 'Use saved capacity end rather than estimated work end');
assert.equal(historyForSlots(primary, ['11:30']).length, 0, 'End is exclusive');
assert.equal(historyForSlots(primary, ['08:30', '09:30', '10:30']).length, 1, 'Grouped active card gets one note per event');
const support = original.filter(item => item.role === 'support');
assert.equal(historyForSlots(support, ['09:30']).length, 1);
assert.equal(historyForSlots(support, ['10:30']).length, 0, 'Do not fabricate missing support duration from current assignments');
const noOp = structuredClone(appointment); noOp.events = [{ ...noOp.events[0], to: from }];
assert.equal(projectSlotHistory([noOp], references).length, 0, 'No-op is not a freed placement');
noOp.events[0].to = { ...from, supportVanId: 'VAN-3' };
const supportMove = projectSlotHistory([noOp], references);
assert.equal(supportMove.length, 1); assert.equal(supportMove[0].role, 'support');
const unknown = structuredClone(appointment); unknown.events[0].from.primaryStart = 'missing';
assert.equal(projectSlotHistory([unknown], references).filter(item => item.date === '2026-10-12' && item.role === 'primary').length, 0);
assert.equal(JSON.stringify(appointment), untouched, 'The projection never mutates canonical input');
assert.equal(projectSlotHistory([{ ...appointment, events: [] }], references).length, 0);
console.log('PASS slot history: original dates, repeat moves/cancel, identity/dedupe, multi-slot capacity, support gaps, no-op exclusion and read-only projection');
