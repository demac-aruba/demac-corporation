'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveVisitExecution } = require('./field-execution');
const { officeReviewDocumentId } = require('../fieldOperationsOfficeReview');

const at = (hour, minute = 0) => `2026-09-18T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
const identity = { id: 'VISIT-TEST', workOrderId: 'WO-TEST', appointmentId: 'APT-TEST', customerId: 'CUSTOMER-TEST', propertyId: 'PROPERTY-TEST' };
function event(from, to, time, n, type = 'work_visit_status_changed') {
  const review = type !== 'work_visit_status_changed';
  return {
    id: `FIELD-EVENT-${n}`, fieldEventVersion: 1, type,
    entityType: review ? 'OfficeReview' : 'WorkVisit',
    entityId: review ? officeReviewDocumentId(identity.workOrderId) : identity.id,
    visitId: identity.id, workOrderId: identity.workOrderId, appointmentId: identity.appointmentId,
    customerId: identity.customerId, propertyId: identity.propertyId,
    requestId: `REQUEST-${n}`, performedByUserId: 'USER-TEST', occurredAt: time,
    before: review ? { visitStatus: from } : { status: from, version: n },
    after: review ? { visitStatus: to, revisionNumber: 1, reviewStatus: type === 'office_review_approved' ? 'approved' : type === 'office_review_returned' ? 'returned' : 'pending' } : { status: to, version: n + 1 },
  };
}
function fixture() {
  return {
    visit: { ...identity, status: 'completed', startedAt: at(8, 10), completedAt: at(12) },
    sourceComplete: true,
    events: [
      event('scheduled', 'en_route', at(8), 1),
      event('en_route', 'on_site', at(8, 5), 2),
      event('on_site', 'in_progress', at(8, 10), 3),
      event('in_progress', 'pending', at(9, 10), 4),
      event('pending', 'in_progress', at(9, 30), 5),
      event('in_progress', 'ready_for_office_review', at(11), 6, 'office_review_submitted'),
      event('ready_for_office_review', 'completed', at(12), 7, 'office_review_approved'),
    ],
  };
}
function has(result, code) { return result.issues.some(row => row.code === code); }

test('intervals use only the immutable Field start assignment, including a different Van after a pause', () => {
  const data = fixture(); data.visit.vanId = 'VAN-99';
  data.events[2].metadata = { executionAssignment: { version: 1, vanId: 'VAN-1' } };
  data.events[4].metadata = { executionAssignment: { version: 1, vanId: 'VAN-2' } };
  const result = deriveVisitExecution(data);
  assert.equal(result.closedRecordedMinutes, 150);
  assert.deepEqual(result.intervals.map(interval => interval.vanId), ['VAN-1', 'VAN-2']);
  delete data.events[2].metadata;
  assert.equal(deriveVisitExecution(data).intervals[0].vanId, null);
  data.events[2].metadata = { executionAssignment: { version: 2, vanId: 'VAN-1' } };
  assert.ok(has(deriveVisitExecution(data), 'field_event_invalid'));
});

test('records 150 closed active minutes, excluding travel, pause and office waiting', () => {
  const result = deriveVisitExecution(fixture());
  assert.equal(result.closedRecordedMinutes, 150);
  assert.equal(result.complete, true);
  assert.equal(result.hasOpenInterval, false);
  assert.equal(result.intervals.length, 2);
  assert.deepEqual(result.issues, []);
  assert.equal(result.actualLaborHours, undefined);
  assert.equal(result.physicalProgressPercent, undefined);
});
test('uses recorded timestamps only, never scheduled slots or caller current time', () => {
  const data = fixture(); data.visit.scheduledSlots = 999; data.visit.actualHours = 500;
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 150);
});
test('unordered events and identical deliveries are deterministic and counted once', () => {
  const data = fixture(); const original = structuredClone(data);
  data.events.reverse(); data.events.push({ ...data.events[0] });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 150);
  assert.deepEqual(deriveVisitExecution(original), deriveVisitExecution(data));
});
test('projection leaves all source records unchanged', () => {
  const data = fixture(); const before = JSON.stringify(data);
  deriveVisitExecution(data); assert.equal(JSON.stringify(data), before);
});
test('same-ID conflicting source versions never become a usable total', () => {
  const data = fixture(); data.events.push({ ...data.events[0], occurredAt: at(7) });
  const result = deriveVisitExecution(data);
  assert.equal(result.closedRecordedMinutes, null); assert.ok(has(result, 'field_event_invalid'));
});
test('an in-progress interval is not extrapolated to now', () => {
  const data = fixture(); data.events = data.events.slice(0, 5);
  Object.assign(data.visit, { status: 'in_progress', completedAt: null });
  const result = deriveVisitExecution(data);
  assert.equal(result.closedRecordedMinutes, 60); assert.equal(result.hasOpenInterval, true);
  assert.equal(result.complete, false);
});
test('submission stops execution time before approval', () => {
  const data = fixture(); data.events.pop();
  Object.assign(data.visit, { status: 'ready_for_office_review', completedAt: null });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 150);
});
test('office return does not start a physical-work timer', () => {
  const data = fixture(); data.events.pop();
  data.events.push(event('ready_for_office_review', 'in_progress', at(12), 7, 'office_review_returned'));
  Object.assign(data.visit, { status: 'in_progress', completedAt: null });
  const result = deriveVisitExecution(data);
  assert.equal(result.closedRecordedMinutes, null); assert.ok(has(result, 'office_correction_time_unmeasured'));
});
test('report resubmission cannot fabricate correction hours', () => {
  const data = fixture(); data.events.pop();
  data.events.push(event('ready_for_office_review', 'in_progress', at(12), 7, 'office_review_returned'));
  data.events.push(event('in_progress', 'ready_for_office_review', at(13), 8, 'office_review_resubmitted'));
  Object.assign(data.visit, { status: 'ready_for_office_review', completedAt: null });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
});
test('missing history and partial reads remain unknown, not zero', () => {
  const data = fixture();
  assert.ok(has(deriveVisitExecution({ ...data, events: [] }), 'field_timeline_missing'));
  assert.ok(has(deriveVisitExecution({ ...data, sourceComplete: false }), 'field_event_read_incomplete'));
});
test('untouched scheduled visit has a genuine zero recorded interval', () => {
  const result = deriveVisitExecution({ visit: { ...identity, status: 'scheduled' }, events: [], sourceComplete: true });
  assert.equal(result.closedRecordedMinutes, 0); assert.equal(result.complete, true);
});
test('identity aliases, foreign review ID, malformed schema and time fail closed', () => {
  for (const patch of [
    { customerId: 'WRONG' }, { visitId: 'WRONG' }, { propertyId: 'WRONG' },
    { appointmentId: 'WRONG' }, { workOrderId: 'WRONG' }, { clientId: 'WRONG' },
    { fieldEventVersion: 2 }, { occurredAt: '2026-02-30T08:00:00.000Z' },
    { occurredAt: 'not-a-date' }, { entityId: 'WRONG' },
  ]) {
    const data = fixture(); Object.assign(data.events[0], patch);
    assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
  }
  const data = fixture(); data.events[6].entityId = officeReviewDocumentId('OTHER-WO');
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
});
test('missing transition, wrong current status or wrong stored timestamps block totals', () => {
  const data = fixture(); data.events.splice(3, 1);
  assert.ok(has(deriveVisitExecution(data), 'field_timeline_gap_or_ambiguity'));
  for (const patch of [{ status: 'pending' }, { startedAt: at(8, 11) }, { completedAt: at(12, 1) }]) {
    const data = fixture(); Object.assign(data.visit, patch);
    assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
  }
});
test('equally timed transitions follow an unambiguous status chain', () => {
  const data = fixture(); data.events[1].occurredAt = at(8);
  [data.events[0], data.events[1]] = [data.events[1], data.events[0]];
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 150);
});
test('contradictory equally timed transitions are not resolved by event ID ordering', () => {
  const data = fixture(); data.events.push(event('on_site', 'cancelled', at(8, 10), 20));
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
});
test('cancellation retains earlier recorded work', () => {
  const data = fixture(); data.events = data.events.slice(0, 3);
  data.events.push(event('in_progress', 'cancelled', at(9, 10), 4));
  Object.assign(data.visit, { status: 'cancelled', completedAt: null });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 60);
});
test('a required physical return closes this visit without waiting for the next visit', () => {
  const data = fixture(); data.events = data.events.slice(0, 3);
  data.events.push(event('in_progress', 'requires_return_visit', at(9, 10), 4));
  Object.assign(data.visit, { status: 'requires_return_visit', completedAt: null });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 60);
});
test('long canonical Field request IDs remain valid and unrelated report events do not affect time', () => {
  const data = fixture(); data.events[0].requestId = 'R'.repeat(240);
  data.events.push({ id: 'NOT-A-STATUS-CHANGE', type: 'field_measurement_recorded' });
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, 150);
});

test('a future unknown WorkVisit transition type is not silently discarded', () => {
  const data = fixture(); data.events[3].type = 'new_visit_transition';
  assert.equal(deriveVisitExecution(data).closedRecordedMinutes, null);
});
