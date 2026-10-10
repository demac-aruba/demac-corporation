'use strict';

// Independent review regressions. All persistence uses the synthetic MVCC store;
// no Firebase app, credentials, production connection or customer data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { createBookingAuthority, BOOKING_CREATE_MODES } = require('./bookingAuthorityFirestore');
const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
const { createAfterHoursAuthority } = require('./bookingAfterHours');
const { plannedWorkItems } = require('./fieldOperationsAuthorityCore');
const { buildScheduledScopeSnapshot } = require('./fieldOperationsAuthorityWorkVisit');
const { BOOKING_ERROR_CODES } = require('./bookingAuthorityCore');

const DATE = '2026-10-13';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const actor = { id: 'review-office', name: 'Synthetic dispatcher', source: 'office-scheduling' };
const recipients = [{ recipientType: 'client', sourceId: 'review-customer', name: 'Synthetic customer',
  whatsapp: '+2975600000', sendConfirmation: true, sendReminder: true }];
const mixed = [{ id: 'standard', presetId: 'standard_service', quantity: 2 },
  { id: 'deep', presetId: 'deep_cleaning', quantity: 1 }];
const other = minutes => [{ id: 'other', presetId: 'other', quantity: 1, manualDurationMinutes: minutes }];
const standard = quantity => [{ id: 'standard', presetId: 'standard_service', quantity }];
function seed(extra = {}) {
  const value = {
    'clients/review-customer': { id: 'review-customer', name: 'Synthetic customer', active: true },
    'properties/review-property': { id: 'review-property', clientId: 'review-customer', name: 'Synthetic property',
      address: 'Synthetic Santa Cruz property', operationalZone: 'Santa Cruz', active: true },
    'businessSettings/business-calendar': { id: 'business-calendar', closedWeekdays: [0] },
  };
  for (let index = 1; index <= 3; index++) {
    value[`vans/VAN-${index}`] = { id: `VAN-${index}`, name: `Van ${index}`, active: true,
      status: 'Disponible', responsibleStaffId: `review-driver-${index}` };
    value[`staffProfiles/review-driver-${index}`] = { id: `review-driver-${index}`, name: `Synthetic driver ${index}`,
      active: true, availability: 'Disponible', canDriveVan: true };
  }
  return { ...value, ...extra };
}
function fixture(extra = {}) {
  const db = new TransactionalFirestore(seed(extra));
  const provider = createSchedulingProvider({ db });
  const clock = () => NOW;
  const serverTimestamp = () => 'SYNTHETIC_TIMESTAMP';
  return { db, provider,
    authority: createBookingAuthority({ db, availabilityProvider: provider, clock, serverTimestamp }),
    lifecycle: createBookingAppointmentLifecycle({ db, schedulingProvider: provider, clock, serverTimestamp }),
    overtime: createAfterHoursAuthority({ db, clock, serverTimestamp }) };
}
function request(workLines = mixed, time = '13:30') {
  return { customerId: 'review-customer', propertyId: 'review-property', workLines,
    constraints: { requestedDate: DATE, requestedTime: time } };
}
function context(extra = {}) {
  return { channel: 'office', requiredPrimaryVanId: 'VAN-1', notificationRecipients: recipients, ...extra };
}
async function check(f, workLines = mixed, time = '13:30', extra = {}) {
  return f.authority.checkAvailability({ request: request(workLines, time), actor, context: context(extra) });
}
async function selectedOffer(f, workLines = mixed, time = '13:30', extra = {}, choose) {
  const initial = await check(f, workLines, time, extra);
  const candidates = initial.metadata.supportSlotCandidates || [];
  const selected = choose ? choose(candidates, initial) : candidates.slice(0, initial.metadata.supportMinSlots);
  assert.ok(selected.length > 0, JSON.stringify(initial));
  const offer = await check(f, workLines, time, { ...extra, requestedSupportSlotIds: selected.map(item => item.id) });
  assert.equal(offer.available, true, JSON.stringify(offer));
  return offer;
}
function commitInput(offer, key = 'independent-review-booking', createMode = BOOKING_CREATE_MODES.CONFIRMED) {
  return { offerId: offer.offer.id, offerVersion: offer.offer.version, optionId: offer.options[0].id,
    idempotencyKey: key, actor, context: context(), createMode };
}
function collection(f, name) { return [...f.db.store].filter(([path]) => path.startsWith(`${name}/`)).map(([, value]) => value); }
function reservation(vanId, time, durationMinutes = 60) {
  return { id: 'synthetic-existing', appointmentId: 'synthetic-existing-appointment', date: DATE, time,
    vanId, status: 'Confirmada', appointmentDurationMinutes: durationMinutes, scheduledSlots: Math.ceil(durationMinutes / 60) };
}

test('mixed overflow commits one canonical work scope and nonbillable resource support, with exact retry', async () => {
  const f = fixture();
  const offer = await selectedOffer(f);
  const option = offer.options[0];
  assert.equal(option.workloadSupport, true);
  assert.equal(option.assignments.reduce((sum, item) => sum + item.durationMinutes, 0), 240);
  assert.equal(option.assignments.reduce((sum, item) => sum + item.slots, 0), 4);
  const saved = await f.authority.createAppointment(commitInput(offer));
  const appointment = f.db.read(`appointments/${saved.appointmentId}`);
  const orders = saved.workOrderIds.map(id => f.db.read(`workOrders/${id}`));
  assert.equal(appointment.workloadSupport, true);
  assert.deepEqual(orders[0].appointmentWorkItems, appointment.workItems);
  assert.equal(orders[0].airConditionerCount, 3);
  assert.equal(orders[0].appointmentDurationMinutes, 180);
  assert.equal(orders[0].notificationRecipients.length, 1);
  assert.equal(orders[1].workloadSupport, true);
  assert.equal(orders[1].supportAssignmentKind, 'adhoc_rescue');
  assert.equal(orders[1].supportNonBillable, true);
  assert.equal(orders[1].parentWorkOrderId, orders[0].id);
  assert.equal(orders[1].serviceId, '');
  assert.deepEqual(orders[1].appointmentWorkItems, []);
  assert.deepEqual(orders[1].notificationRecipients, []);
  assert.equal(orders[1].whatsappNotificationsEnabled, false);
  assert.deepEqual(plannedWorkItems(orders[1], appointment), []);
  assert.deepEqual(buildScheduledScopeSnapshot(orders[1], appointment, NOW.toISOString()).workLines, []);
  assert.equal(plannedWorkItems({ ...orders[1], workloadSupport: undefined }, appointment).length, 2,
    'historical ad-hoc helpers retain their previous projection');
  assert.equal(plannedWorkItems({ ...orders[1], supportNonBillable: false }, appointment).length, 2,
    'the new marker must not hide billable planned scope');
  assert.equal(plannedWorkItems(orders[0], appointment).reduce((sum, line) => sum + line.quantity, 0), 3);
  assert.equal(appointment.capacityLockIds.length, 4);
  const before = structuredClone([...f.db.store]);
  assert.equal((await f.authority.createAppointment(commitInput(offer))).replayed, true);
  assert.deepEqual([...f.db.store], before);
});

test('fractional manual work reserves whole spots but preserves exact workload minutes and one customer unit', async () => {
  for (const minutes of [90, 150]) {
    const f = fixture();
    const offer = await selectedOffer(f, other(minutes), '15:30');
    const allocations = offer.options[0].assignments;
    assert.equal(allocations[0].durationMinutes, 30);
    assert.equal(allocations.reduce((sum, value) => sum + value.durationMinutes, 0), minutes);
    assert.equal(allocations.reduce((sum, value) => sum + value.slots, 0), Math.ceil(minutes / 60));
    const saved = await f.authority.createAppointment(commitInput(offer, `manual-review-${minutes}`));
    const primary = f.db.read(`workOrders/${saved.workOrderIds[0]}`);
    assert.equal(primary.appointmentWorkItems[0].durationMinutes, minutes);
    assert.equal(primary.appointmentWorkItems[0].quantity, 1);
  }
});

test('remaining capacity distinguishes all free spots from reachable primary capacity and respects holds', async () => {
  const f = fixture({ 'workOrders/middle-hold': { ...reservation('VAN-1', '09:30'), status: 'Reserva temporal' } });
  const result = await check(f, mixed, '08:30');
  assert.equal(result.metadata.capacitySummary.availableSpots, 5);
  assert.equal(result.metadata.capacitySummary.primarySpots, 1);
  assert.equal(result.metadata.supportMinSlots, 3);
  assert.equal(result.metadata.capacitySummary.availableStarts.includes('09:30'), false);
  assert.equal(result.metadata.supportSlotCandidates.some(item => item.vanId === 'VAN-1'), false);
  assert.equal(result.metadata.supportSlotCandidates.some(item => ['11:30', '12:30'].includes(item.time)), false);
});

test('new support policy rejects Project, closure, occupied primary and shared-driver candidate capacity', async () => {
  const f = fixture({ 'vans/VAN-2': { id: 'VAN-2', name: 'Shared crew van', active: true,
    responsibleStaffId: 'review-driver-1' } });
  const result = await check(f);
  assert.equal(result.metadata.supportSlotCandidates.some(item => item.vanId === 'VAN-2'), false);
  const project = await f.provider.checkAvailability({ request: { ...request(), project: { id: 'synthetic-project', version: 1 } }, context: context(), now: NOW });
  assert.notEqual(project.metadata.workloadSupport, true);
  for (const extra of [
    { 'calendarClosures/closed': { date: DATE, active: true } },
    { 'workOrders/occupied-primary': reservation('VAN-1', '13:30') },
  ]) {
    const denied = await check(fixture(extra));
    assert.equal(denied.available, false);
    assert.notEqual(denied.metadata.workloadSupport, true);
  }
});

test('Standard seven-unit exception and morning 7+N remain intact; afternoon overload can choose sufficient help', async () => {
  const f = fixture();
  const seven = await check(f, standard(7), '08:30');
  assert.equal(seven.available, true);
  assert.equal(seven.options[0].assignments.length, 1);
  assert.equal(seven.options[0].assignments[0].slots, 6);
  assert.equal(seven.options[0].assignments[0].quantity, 7);
  const morning = await selectedOffer(f, standard(8), '08:30');
  assert.notEqual(morning.options[0].workloadSupport, true);
  assert.equal(morning.options[0].assignments[0].quantity, 7);
  const afternoon = await selectedOffer(f, standard(8), '13:30');
  assert.equal(afternoon.metadata.supportMinSlots, 5);
  assert.equal(afternoon.options[0].workloadSupport, true);
  assert.equal(afternoon.options[0].assignments.reduce((sum, item) => sum + item.durationMinutes, 0), 480);
});

test('stale helper selection and new transaction-time reservation fail without partial booking writes', async () => {
  const f = fixture();
  const initial = await check(f);
  const selected = initial.metadata.supportSlotCandidates[0];
  f.db.write('workOrders/taken-helper', reservation(selected.vanId, selected.time));
  const stale = await check(f, mixed, '13:30', { requestedSupportSlotIds: [selected.id] });
  assert.equal(stale.available, false);
  assert.equal(stale.reason, 'support-selection-unavailable');
  assert.equal(collection(f, 'appointments').length, 0);

  const next = fixture();
  const offer = await selectedOffer(next);
  const helper = offer.options[0].assignments[1];
  const revalidate = next.provider.revalidateSelection.bind(next.provider);
  next.provider.revalidateSelection = async args => {
    const result = await revalidate(args);
    next.db.write('workOrders/concurrent-helper', reservation(helper.vanId, helper.time));
    return result;
  };
  await assert.rejects(next.authority.createAppointment(commitInput(offer)), error =>
    [BOOKING_ERROR_CODES.SLOT_CONFLICT, BOOKING_ERROR_CODES.AVAILABILITY_CHANGED].includes(error.code));
  assert.equal(collection(next, 'appointments').length, 0);
  assert.equal(collection(next, 'bookingCapacityLocks').length, 0);
  assert.equal(collection(next, 'workOrders').length, 1);
});

test('changed canonical work-type or service duration invalidates support before preflight and again inside commit', async () => {
  const canonicalService = { id: 'review-service', itemType: 'Servicio', name: 'Synthetic Standard Service',
    active: true, featured: true, serviceDefinition: { version: 1, bookingCode: 'standard_service',
      duration: { minutes: 60 } } };
  for (const source of ['work-type', 'service']) {
    for (const stage of ['before-preflight', 'after-preflight']) {
      const f = fixture(source === 'service' ? { 'services/review-service': canonicalService } : {});
      const lines = source === 'service'
        ? [{ ...mixed[0], serviceId: canonicalService.id }, mixed[1]] : mixed;
      const offer = await selectedOffer(f, lines);
      assert.equal(offer.options[0].assignments.reduce((sum, item) => sum + item.durationMinutes, 0), 240);
      const changeDuration = () => source === 'service'
        ? f.db.write('services/review-service', { ...canonicalService, serviceDefinition: {
          ...canonicalService.serviceDefinition, duration: { minutes: 90 } } })
        : f.db.write('businessSettings/appointment-work-presets', { id: 'appointment-work-presets', workTypesVersion: 2,
          presets: [{ id: 'standard_service', active: true, durationMinutesPerUnit: 90 }] });
      if (stage === 'before-preflight') changeDuration();
      else {
        const revalidate = f.provider.revalidateSelection.bind(f.provider);
        f.provider.revalidateSelection = async args => {
          const result = await revalidate(args);
          assert.equal(result.available, true, 'the race must occur only after successful preflight');
          changeDuration();
          return result;
        };
      }
      await assert.rejects(f.authority.createAppointment(commitInput(offer)), error =>
        error.code === (stage === 'before-preflight' ? BOOKING_ERROR_CODES.AVAILABILITY_CHANGED : BOOKING_ERROR_CODES.SLOT_CONFLICT)
        && error.details?.reason === 'support-workload-changed', `${source}: ${stage}`);
      assert.equal(collection(f, 'appointments').length, 0);
      assert.equal(collection(f, 'workOrders').length, 0);
      assert.equal(collection(f, 'bookingCapacityLocks').length, 0);
    }
  }
});

test('workload-support hold confirms and cancels every allocation with silent helpers and complete lock release', async () => {
  const f = fixture();
  const offer = await selectedOffer(f);
  const saved = await f.authority.createAppointment(commitInput(offer, 'independent-review-hold', BOOKING_CREATE_MODES.TEMPORARY_HOLD));
  for (const id of saved.workOrderIds) {
    const order = f.db.read(`workOrders/${id}`);
    assert.equal(order.status, 'Reserva temporal');
    assert.equal(order.whatsappNotificationsEnabled, false);
  }
  await f.lifecycle.confirmTemporaryHold({ appointmentId: saved.appointmentId, actor, context: context() });
  assert.equal(f.db.read(`appointments/${saved.appointmentId}`).workloadSupport, true);
  assert.equal(f.db.read(`workOrders/${saved.workOrderIds[0]}`).whatsappNotificationsEnabled, true);
  assert.equal(f.db.read(`workOrders/${saved.workOrderIds[1]}`).whatsappNotificationsEnabled, false);
  await f.lifecycle.cancelAppointment({ appointmentId: saved.appointmentId, actor, reason: 'Synthetic cancellation' });
  for (const id of saved.workOrderIds) assert.equal(f.db.read(`workOrders/${id}`).status, 'Cancelada');
  assert.ok(collection(f, 'bookingCapacityLocks').every(lock => lock.active === false));
});

test('helper maintenance and shared crew introduced after preflight are rejected by the atomic transaction', async () => {
  for (const mutation of ['maintenance', 'shared-crew']) {
    const f = fixture();
    const offer = await selectedOffer(f);
    const helper = offer.options[0].assignments[1];
    const revalidate = f.provider.revalidateSelection.bind(f.provider);
    f.provider.revalidateSelection = async args => {
      const result = await revalidate(args);
      const path = `vans/${helper.vanId}`;
      f.db.write(path, { ...f.db.read(path), ...(mutation === 'maintenance'
        ? { status: 'Mantenimiento' } : { responsibleStaffId: 'review-driver-1' }) });
      return result;
    };
    await assert.rejects(f.authority.createAppointment(commitInput(offer)), undefined, mutation);
    assert.equal(collection(f, 'appointments').length, 0);
    assert.equal(collection(f, 'workOrders').length, 0);
    assert.equal(collection(f, 'bookingCapacityLocks').length, 0);
  }
});

test('lifecycle keeps financial state and clears resource-helper markers when reusing a Work Order for service allocation', async () => {
  const f = fixture();
  const offer = await selectedOffer(f);
  const saved = await f.authority.createAppointment(commitInput(offer));
  const primaryPath = `workOrders/${saved.workOrderIds[0]}`;
  f.db.write(primaryPath, { ...f.db.read(primaryPath), amount: 777, paid: 123, invoiceId: 'synthetic-invoice',
    createdAt: 'immutable-created-at', customerDeliveryReceipt: 'immutable-receipt' });
  const next = await selectedOffer(f, standard(8), '08:30', { excludeAppointmentId: saved.appointmentId });
  const changed = await f.lifecycle.rescheduleAppointment({ appointmentId: saved.appointmentId,
    offerId: next.offer.id, offerVersion: next.offer.version, optionId: next.options[0].id,
    reason: 'Synthetic allocation transition', actor, context: context({ excludeAppointmentId: saved.appointmentId }) });
  const primary = f.db.read(primaryPath);
  assert.equal(primary.amount, 777);
  assert.equal(primary.paid, 123);
  assert.equal(primary.invoiceId, 'synthetic-invoice');
  assert.equal(primary.createdAt, 'immutable-created-at');
  assert.equal(primary.customerDeliveryReceipt, 'immutable-receipt');
  assert.equal(changed.appointment.workloadSupport, false);
  const reused = f.db.read(`workOrders/${saved.workOrderIds[1]}`);
  assert.notEqual(reused.workloadSupport, true);
  assert.notEqual(reused.supportNonBillable, true);
  assert.notEqual(reused.supportAssignmentKind, 'adhoc_rescue');
  assert.equal(reused.appointmentWorkItems[0].quantity, 1);
  assert.equal(plannedWorkItems(reused, changed.appointment)[0].quantity, 1);
});

function overtimeInput(workLines, time = '08:30', extra = {}) {
  return { requestId: 'independent-review-overtime', customerId: 'review-customer', propertyId: 'review-property',
    workLines, requestedDate: DATE, requestedTime: time, requiredVanId: 'VAN-1', actor, ...extra };
}
async function accepted(f, input) {
  const { proposal } = await f.overtime.prepareCapacityOvertime(input);
  return { ...input, overtimeConsent: { accepted: true, confirmationToken: proposal.confirmationToken } };
}

test('morning overtime preserves protected lunch, exact partial finish, all locks and exact replay', async () => {
  const f = fixture();
  const input = overtimeInput(other(450));
  const before = structuredClone([...f.db.store]);
  const prepared = await f.overtime.prepareCapacityOvertime(input);
  assert.deepEqual([...f.db.store], before, 'preparation cannot write');
  assert.deepEqual(prepared.proposal.slotStarts, ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30', '17:30']);
  assert.equal(prepared.proposal.estimatedEnd, '18:00');
  assert.equal(prepared.proposal.capacityEnd, '18:30');
  assert.equal(prepared.proposal.durationMinutes, 450);
  const consent = { ...input, overtimeConsent: { accepted: true, confirmationToken: prepared.proposal.confirmationToken } };
  const saved = await f.overtime.createCapacityOvertime(consent);
  assert.equal(saved.appointment.capacityLockIds.length, 8);
  assert.equal(saved.workOrder.appointmentDurationMinutes, 450);
  assert.equal(saved.workOrder.appointmentWorkItems[0].durationMinutes, 450);
  assert.equal((await f.overtime.createCapacityOvertime(consent)).replayed, true);
  assert.equal(collection(f, 'appointments').length, 1);
  assert.equal(collection(f, 'employeeTimesheets').length, 0);
});

test('morning overtime refuses fitting work including the Standard seven-unit exception', async () => {
  const f = fixture();
  await assert.rejects(f.overtime.prepareCapacityOvertime(overtimeInput(other(360))));
  await assert.rejects(f.overtime.prepareCapacityOvertime(overtimeInput(standard(7))));
});

test('governed Standard duration must physically fit before the seven-unit exception suppresses overtime', async () => {
  const f = fixture({ 'businessSettings/appointment-work-presets': {
    id: 'appointment-work-presets', workTypesVersion: 2, presets: [{ id: 'standard_service', label: 'Standard Service',
      active: true, durationMinutesPerUnit: 90 }],
  } });
  const prepared = await f.overtime.prepareCapacityOvertime(overtimeInput(standard(7)));
  assert.equal(prepared.proposal.durationMinutes, 630);
  assert.equal(prepared.proposal.requiredSlots, 11);
  assert.equal(prepared.proposal.estimatedEnd, '21:00');
  assert.equal(prepared.proposal.capacityEnd, '21:30');
  assert.equal(collection(f, 'appointments').length, 0);
});

test('morning overtime requires exact consent and rejects closure, future reservations, absence and midnight', async () => {
  const f = fixture();
  await assert.rejects(f.overtime.createCapacityOvertime(overtimeInput(other(450))));
  const consent = await accepted(f, overtimeInput(other(450)));
  await assert.rejects(f.overtime.createCapacityOvertime({ ...consent, workLines: other(480) }));
  assert.equal(collection(f, 'appointments').length, 0);
  for (const extra of [
    { 'calendarClosures/closed': { date: DATE, active: true } },
    { 'workOrders/afternoon-reservation': reservation('VAN-1', '14:30') },
    { 'workOrders/evening-reservation': reservation('VAN-1', '17:30') },
    { 'staffAbsences/driver-absence': { staffId: 'review-driver-1', active: true, fromDate: DATE, toDate: DATE } },
  ]) {
    const blocked = fixture(extra);
    await assert.rejects(blocked.overtime.prepareCapacityOvertime(overtimeInput(other(450))), undefined, Object.keys(extra)[0]);
    assert.equal(collection(blocked, 'appointments').length, 0);
  }
  await assert.rejects(f.overtime.prepareCapacityOvertime(overtimeInput(other(720), '15:30')));
});

test('recurring half-day ordinary overflow skips lunch and retains the separate weekly-rest path', async () => {
  const f = fixture({ 'vanHalfDaySchedules/review-half-day': {
    vanId: 'VAN-1', weekday: 2, active: true, workdayStart: '08:00', workdayEnd: '13:00',
  } });
  const prepared = await f.overtime.prepareCapacityOvertime(overtimeInput(other(300)));
  assert.equal(prepared.proposal.ordinarySlots, 4);
  assert.deepEqual(prepared.proposal.slotStarts, ['08:30', '09:30', '10:30', '11:30', '13:30']);
  assert.equal(prepared.proposal.estimatedEnd, '14:30');
  assert.equal(prepared.proposal.capacityEnd, '14:30');
  await assert.rejects(f.overtime.prepareCapacityOvertime(overtimeInput(other(300), '13:30')),
    undefined, 'weekly-rest entry remains separate from ordinary overflow');
  const rest = await f.overtime.prepareRestDayOvertime(overtimeInput(other(300), '13:30'));
  assert.equal(rest.proposal.kind, 'weekly_rest_overtime');
  assert.deepEqual(rest.proposal.slotStarts, ['13:30', '14:30', '15:30', '16:30', '17:30']);
});
