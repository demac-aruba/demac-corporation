'use strict';

// Read projection of existing Field authority events. No clock, writes or payroll inference.
const { assertWorkVisitTransition } = require('../fieldOperationsAuthorityTransitions');
const d = require('./registry-domain');
const { officeReviewDocumentId } = require('../fieldOperationsOfficeReview');
const STATUS_EVENT = 'work_visit_status_changed';
const REVIEW_EVENTS = new Set([
  'office_review_submitted', 'office_review_resubmitted',
  'office_review_approved', 'office_review_returned',
]);
const EVENT_TYPES = new Set([STATUS_EVENT, ...REVIEW_EVENTS]);
function isTimelineEvent(event) {
  return EVENT_TYPES.has(event?.type) || (event?.entityType === 'WorkVisit'
    && typeof event.before?.status === 'string' && typeof event.after?.status === 'string');
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function millis(value) {
  if (typeof value !== 'string' || !ISO.test(value)) throw new Error('Invalid source time');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid source time');
  return time;
}
function normalizeEvent(event, visit) {
  if (!EVENT_TYPES.has(event.type) || event.fieldEventVersion !== 1) throw new Error('Unsupported source schema');
  for (const key of ['id', 'performedByUserId']) d.id(event[key], key);
  if (typeof event.requestId !== 'string' || event.requestId.length < 8 || event.requestId.length > 240
      || event.requestId.trim() !== event.requestId || /[\x00-\x1f]/.test(event.requestId)) throw new Error('Invalid request identity');
  for (const key of ['visitId', 'workOrderId', 'appointmentId', 'customerId', 'propertyId']) {
    const expected = key === 'visitId' ? visit.id : visit[key];
    if (event[key] !== expected) throw new Error('Source identity conflict');
  }
  if (event.clientId !== undefined && event.clientId !== visit.customerId) throw new Error('Customer alias conflict');
  const isStatus = event.type === STATUS_EVENT;
  const from = isStatus ? event.before?.status : event.before?.visitStatus;
  const to = isStatus ? event.after?.status : event.after?.visitStatus;
  if (assertWorkVisitTransition(from, to).noop) throw new Error('Duplicate status change');
  if (isStatus) {
    if (event.entityType !== 'WorkVisit' || event.entityId !== visit.id
        || !Number.isSafeInteger(event.before?.version) || event.before.version < 1
        || !Number.isSafeInteger(event.after?.version) || event.after.version !== event.before.version + 1) {
      throw new Error('Invalid transition identity/version');
    }
  } else {
    if (event.entityType !== 'OfficeReview' || event.entityId !== officeReviewDocumentId(visit.workOrderId)) throw new Error('Invalid review event identity');
    d.id(event.entityId, 'Office Review');
    if (!Number.isSafeInteger(event.after?.revisionNumber) || event.after.revisionNumber < 1) throw new Error('Invalid review revision');
    const expected = event.type === 'office_review_approved' ? ['completed', 'approved']
      : event.type === 'office_review_returned' ? ['in_progress', 'returned']
        : ['ready_for_office_review', 'pending'];
    if (to !== expected[0] || event.after.reviewStatus !== expected[1]) throw new Error('Invalid review transition');
  }
  const assignment = event.metadata?.executionAssignment;
  let vanId = null;
  if (isStatus && to === 'in_progress' && assignment !== undefined) {
    if (!assignment || assignment.version !== 1 || (assignment.vanId !== null
        && (typeof assignment.vanId !== 'string' || !/^VAN-[1-9]\d*$/.test(assignment.vanId)))) {
      throw new Error('Invalid recorded execution assignment');
    }
    vanId = assignment.vanId;
  }
  return { id: event.id, type: event.type, at: event.occurredAt, time: millis(event.occurredAt), from, to, vanId };
}

/**
 * Only CLOSED, explicitly recorded in-progress intervals are measured. Travel, pending
 * periods and waiting for office approval are excluded. An office return is a report
 * correction, not evidence the technician physically resumed work; its time stays unknown.
 */
function deriveVisitExecution({ visit, events, sourceComplete }) {
  const issues = [];
  const result = {
    visitId: visit.id,
    status: visit.status,
    source: 'fieldOperationEvents',
    unit: 'visit_active_minutes',
    closedRecordedMinutes: null,
    hasOpenInterval: false,
    complete: false,
    intervals: [],
    issues,
  };
  if (sourceComplete !== true) issues.push({ code: 'field_event_read_incomplete' });
  const unique = new Map();
  for (const raw of events) {
    if (!isTimelineEvent(raw)) continue;
    try {
      const event = normalizeEvent(raw, visit);
      const prior = unique.get(event.id);
      const signature = d.canonical(raw);
      if (prior && prior.signature !== signature) throw new Error('Conflicting event versions');
      unique.set(event.id, { event, signature });
    } catch { issues.push({ code: 'field_event_invalid', eventId: typeof raw?.id === 'string' ? raw.id : null }); }
  }
  const ordered = [...unique.values()].map(row => row.event).sort((a, b) => a.time - b.time);
  if (issues.length) return result;
  if (!ordered.length) {
    if (visit.status === 'scheduled' && !visit.startedAt && !visit.completedAt) {
      result.closedRecordedMinutes = 0;
      result.complete = true;
    } else issues.push({ code: 'field_timeline_missing' });
    return result;
  }
  let status = 'scheduled';
  let open = null;
  let firstStart = null;
  let finalCompletion = null;
  let correction = false;
  let durationMs = 0;
  // Resolve same-timestamp transitions by their actual status chain, never lexical ID order.
  for (let offset = 0; offset < ordered.length;) {
    let end = offset + 1;
    while (end < ordered.length && ordered[end].time === ordered[offset].time) end++;
    const remaining = ordered.slice(offset, end);
    while (remaining.length) {
      const matches = remaining.filter(event => event.from === status);
      if (matches.length !== 1) {
        issues.push({ code: 'field_timeline_gap_or_ambiguity' });
        return result;
      }
      const event = matches[0];
      remaining.splice(remaining.indexOf(event), 1);
      if (event.type === 'office_review_returned') correction = true;
      if (status === 'in_progress') {
        if (!open) {
          issues.push({ code: 'office_correction_time_unmeasured' });
          return result;
        }
        durationMs += event.time - open.time;
        result.intervals.push({ startedAt: open.at, stoppedAt: event.at, startEventId: open.id, stopEventId: event.id,
          vanId: open.vanId });
        open = null;
      }
      if (event.to === 'in_progress' && !correction) {
        open = event;
        firstStart ??= event.at;
      }
      if (event.to === 'completed') finalCompletion = event.at;
      status = event.to;
    }
    offset = end;
  }
  if (correction) issues.push({ code: 'office_correction_time_unmeasured' });
  if (status !== visit.status) issues.push({ code: 'field_timeline_current_status_mismatch' });
  if ((visit.startedAt || null) !== firstStart) issues.push({ code: 'field_timeline_start_mismatch' });
  if ((visit.completedAt || null) !== finalCompletion) issues.push({ code: 'field_timeline_completion_mismatch' });
  if (issues.length) return result;
  result.closedRecordedMinutes = durationMs / 60000;
  result.hasOpenInterval = Boolean(open);
  result.complete = !open;
  return result;
}

module.exports = { isTimelineEvent, deriveVisitExecution };
