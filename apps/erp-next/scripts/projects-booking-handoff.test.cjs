'use strict';
// Runs the actual TypeScript client contract; Node strips types, full typecheck remains separate.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { bindCentralProjectBooking, prepareCentralProjectConfirmation, verifyCentralProjectBooking } = require('../lib/projects/booking-handoff.ts');
function fixture() {
  const project = { id: 'P-TEST', schemaVersion: 1, version: 2, customerId: 'C-TEST', propertyId: 'PROP-TEST', phases: [{ id: 'PH-TEST' }], budget: { currentMinutes: 3960 }, actualMinutes: null };
  const input = { requestId: 'CHECK-TEST-123', customerId: 'C-TEST', propertyId: 'PROP-TEST', requestedDate: '2099-09-18', requestedTime: '08:30', requiredVanId: 'VAN-A', workLines: [{ id: 'WORK', presetId: 'other', quantity: 1, manualDurationMinutes: 360 }], supportSlotSelections: ['VAN-B-AM', 'VAN-B-PM', 'VAN-C-AM'], technicianInstructions: 'Synthetic instructions', recipientSelections: [{ id: 'RECIPIENT', sendConfirmation: true }] };
  const bound = bindCentralProjectBooking(project, 'PH-TEST', input);
  const context = { schemaVersion: 1, ...bound.projectSelection, actorId: 'USER-TEST' };
  const availability = { success: true, available: true, offer: { id: 'OFFER-TEST', version: 1, status: 'open', projectContext: context, request: { customerId: input.customerId, propertyId: input.propertyId } }, options: [{ id: 'OPTION-TEST', assignments: [] }] };
  return { project, input, bound, context, availability };
}
function prepare(f = fixture(), mode = 'confirmed') {
  return prepareCentralProjectConfirmation({ input: f.bound, availability: f.availability, actorId: 'USER-TEST', optionId: 'OPTION-TEST', requestId: 'CONFIRM-SAME-123', mode });
}
function receipt(f = fixture(), mode = 'confirmed') {
  const workOrderIds = ['WO-PRIMARY', 'WO-SUPPORT-AM', 'WO-SUPPORT-PM', 'WO-SUPPORT-C'];
  return { success: true, replayed: false, createMode: mode, appointmentId: 'APT-TEST', workOrderIds, appointment: { appointmentId: 'APT-TEST', customerId: 'C-TEST', propertyId: 'PROP-TEST', projectContext: f.context, workOrderIds: [...workOrderIds], status: mode, offerId: 'OFFER-TEST', offerVersion: 1, selectedOptionId: 'OPTION-TEST' } };
}
function assertUnknown(fn) { assert.throws(fn, error => error.outcomeUncertain === true && /same request ID/.test(error.message)); }

test('advisory budget cannot trim the requested work or silently increase the original estimate', () => {
  const f = fixture(); const source = structuredClone(f);
  f.project.budget.currentMinutes = 180;
  const bound = bindCentralProjectBooking(f.project, null, f.input);
  assert.equal(bound.workLines[0].manualDurationMinutes, 360);
  assert.equal(f.project.budget.currentMinutes, 180);
  assert.equal(bound.projectSelection.phaseId, null);
  assert.equal(f.project.actualMinutes, null);
  assert.deepEqual(bound.supportSlotSelections, source.input.supportSlotSelections);
  assert.equal('budget' in bound.projectSelection, false);
});
test('binding preserves instructions, recipients and multiple non-consecutive support slots', () => {
  const f = fixture();
  assert.deepEqual(f.bound, { ...f.input, projectSelection: { projectId: 'P-TEST', phaseId: 'PH-TEST', expectedVersion: 2 } });
  f.input.workLines[0].manualDurationMinutes = 60; f.input.supportSlotSelections.pop();
  assert.equal(f.bound.workLines[0].manualDurationMinutes, 360);
  assert.equal(f.bound.supportSlotSelections.length, 3);
});
test('unknown phases, invalid versions and non-central records cannot be silently converted', () => {
  const f = fixture();
  for (const patch of [{ schemaVersion: 0 }, { version: 0 }, { version: 2.5 }, { version: Number.MAX_SAFE_INTEGER }, { id: '../wrong' }]) {
    assert.throws(() => bindCentralProjectBooking({ ...f.project, ...patch }, null, f.input));
  }
  assert.throws(() => bindCentralProjectBooking(f.project, 'PH-OTHER', f.input));
});
test('customer/property mismatches are rejected, never fixed by replacing their identity', () => {
  const f = fixture();
  for (const key of ['customerId', 'propertyId']) assert.throws(() => bindCentralProjectBooking(f.project, null, { ...f.input, [key]: 'OTHER' }));
});
test('existing-appointment lifecycle inputs must not accidentally create a new Project booking', () => {
  const f = fixture();
  for (const patch of [{ appointmentId: 'APT-EXISTS' }, { changeKind: 'operational_move' }]) {
    assert.throws(() => bindCentralProjectBooking(f.project, null, { ...f.input, ...patch }), /lifecycle/);
  }
});
test('confirmation uses the exact existing Office command shape and caller-owned retry ID', () => {
  const prepared = prepare();
  assert.deepEqual(prepared.command, { requestId: 'CONFIRM-SAME-123', offerId: 'OFFER-TEST', offerVersion: 1, optionId: 'OPTION-TEST' });
  assert.equal(prepared.expectation.selection.projectId, 'P-TEST');
  assert.deepEqual(prepare(), prepared);
});
test('an ordinary offer without a server-bound project context is not a Project offer', () => {
  const f = fixture(); delete f.availability.offer.projectContext;
  assert.throws(() => prepare(f), /Availability does not confirm/);
});
test('different operator, project, phase and version reject the offer', () => {
  for (const [key, value] of [['actorId', 'OTHER'], ['projectId', 'OTHER'], ['phaseId', null], ['expectedVersion', 3], ['schemaVersion', 2]]) {
    const f = fixture(); f.availability.offer.projectContext[key] = value;
    assert.throws(() => prepare(f));
  }
});
test('extra bound-context fields do not silently change its contract', () => {
  const f = fixture(); f.availability.offer.projectContext.override = true;
  assert.throws(() => prepare(f));
});
test('unavailable, closed and malformed offers never enable confirmation', () => {
  for (const patch of [{ success: false }, { available: false }, { offer: null }, { options: [] }, { options: [{ id: 'OPTION-TEST' }, { id: 'OPTION-TEST' }] }]) {
    const f = fixture(); Object.assign(f.availability, patch); assert.throws(() => prepare(f));
  }
  const f = fixture(); f.availability.offer.status = 'booked'; assert.throws(() => prepare(f));
});
test('offer customer/property must agree even when its project context matches', () => {
  const f = fixture(); f.availability.offer.request.propertyId = 'OTHER'; assert.throws(() => prepare(f));
});
test('backdated acknowledgement is preserved and cannot become a hold', () => {
  const f = fixture(); f.bound.bookingMode = 'backdated'; f.bound.backdatingAcknowledged = true;
  assert.equal(prepare(f).command.backdatingAcknowledged, true);
  assert.equal(prepare(f).command.bookingMode, 'backdated');
  assert.throws(() => prepare(f, 'temporary_hold'), /Backdated/);
});
test('successful confirmation retains all primary/support Work Orders without any local posting', () => {
  const f = fixture(); const response = receipt(f); const before = structuredClone(response);
  const result = verifyCentralProjectBooking(response, prepare(f).expectation);
  assert.equal(result.workOrderIds.length, 4); assert.equal(result.projectId, 'P-TEST');
  assert.equal(result.phaseId, 'PH-TEST'); assert.equal(result.mode, 'confirmed');
  result.workOrderIds.pop(); assert.deepEqual(response, before);
});
test('omitted support, duplicates, empty or contradictory Work Order lists remain uncertain', () => {
  for (const mutate of [r => r.workOrderIds.pop(), r => r.workOrderIds.push(r.workOrderIds[0]), r => r.workOrderIds = [], r => r.appointment.workOrderIds[1] = 'UNRELATED', r => r.appointment.workOrderIds.push('EXTRA')]) {
    const f = fixture(); const response = receipt(f); mutate(response);
    assertUnknown(() => verifyCentralProjectBooking(response, prepare(f).expectation));
  }
});
test('wrong appointment, offer, option, actor, customer or phase cannot certify a commit', () => {
  for (const mutate of [r => r.appointment.appointmentId = 'OTHER', r => r.appointment.offerId = 'OTHER', r => r.appointment.offerVersion = 7, r => r.appointment.selectedOptionId = 'OTHER', r => r.appointment.projectContext = { ...r.appointment.projectContext, actorId: 'OTHER' }, r => r.appointment.customerId = 'OTHER', r => r.appointment.projectContext = { ...r.appointment.projectContext, phaseId: null }]) {
    const f = fixture(); const response = receipt(f); mutate(response);
    assertUnknown(() => verifyCentralProjectBooking(response, prepare(f).expectation));
  }
});
test('unknown or non-success result never claims that no booking was created', () => {
  for (const response of [null, {}, { success: false }, { ...receipt(), appointmentId: '' }]) {
    assertUnknown(() => verifyCentralProjectBooking(response, prepare().expectation));
  }
});
test('hold and confirmed results remain distinct; promoted hold replay is not recreated', () => {
  const f = fixture();
  assert.equal(verifyCentralProjectBooking(receipt(f, 'temporary_hold'), prepare(f, 'temporary_hold').expectation).mode, 'temporary_hold');
  assertUnknown(() => verifyCentralProjectBooking(receipt(f), prepare(f, 'temporary_hold').expectation));
  const replay = { ...receipt(f), replayed: true };
  assert.equal(verifyCentralProjectBooking(replay, prepare(f, 'temporary_hold').expectation).mode, 'confirmed');
});
test('selection and commands are snapshots; later form mutation cannot alter the prepared expectation', () => {
  const f = fixture(); const prepared = prepare(f);
  f.bound.projectSelection.phaseId = null;
  assert.equal(prepared.expectation.selection.phaseId, 'PH-TEST');
  assert.equal(prepared.command.requestId, 'CONFIRM-SAME-123');
});
