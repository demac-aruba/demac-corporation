import {
  buildFieldOfflineDraft,
  buildFieldOutboxRecord,
  fieldOutboxFailureRecord,
} from '../lib/field-offline';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD OFFLINE ACCEPTANCE FAILED: ${message}`);
}

function assertThrows(action: () => unknown, message: string) {
  try { action(); } catch { return; }
  throw new Error(`FIELD OFFLINE ACCEPTANCE FAILED: ${message}`);
}

const clock = () => new Date('2026-08-28T12:00:00.000Z');
const original = buildFieldOutboxRecord('uid-tech-1', 'set_report_free_text', {
  visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Compressor condition recorded.',
  expectedVersion: 2, requestId: 'report-free-text-WO-1-001',
}, clock);
const exactRetry = buildFieldOutboxRecord('uid-tech-1', 'set_report_free_text', {
  expectedVersion: 2, value: 'Compressor condition recorded.', sectionId: 'notes', interventionId: 'WI-1',
  requestId: 'report-free-text-WO-1-001', visitId: 'visit-WO-1',
}, clock);
assert(original.id === exactRetry.id && original.payloadSignature === exactRetry.payloadSignature, 'exact retry must retain one stable outbox identity independent of object key order');

const changedPayload = buildFieldOutboxRecord('uid-tech-1', 'set_report_free_text', {
  visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Changed content',
  expectedVersion: 2, requestId: 'report-free-text-WO-1-001',
}, clock);
assert(changedPayload.id === original.id && changedPayload.payloadSignature !== original.payloadSignature, 'same request id with changed payload must be detectable as a conflict');
assertThrows(() => buildFieldOutboxRecord('uid-tech-1', 'get_job', { workOrderId: 'WO-1', requestId: 'read-1' }, clock), 'read actions must never enter the mutation outbox');
assertThrows(() => buildFieldOutboxRecord('uid-tech-1', 'transition_visit', { visitId: 'visit-WO-1' }, clock), 'queued mutation must retain a stable request id');

const deferred = fieldOutboxFailureRecord(original, { ok: false, retryable: true, code: 'unavailable', message: 'Network unavailable' }, clock);
assert(deferred.status === 'pending' && deferred.attempts === 1, 'transport uncertainty must stay pending for exact retry');
const blocked = fieldOutboxFailureRecord(original, { ok: false, retryable: false, code: 'version_conflict', message: 'Canonical version changed' }, clock);
assert(blocked.status === 'blocked' && blocked.attempts === 1, 'authoritative conflict must stop retry and require review');

const draft = buildFieldOfflineDraft({
  ownerUserId: 'uid-tech-1', workOrderId: 'WO-1', interventionId: 'WI-1', sectionId: 'notes', baseVersion: 2, value: 'Local draft',
}, clock);
const otherOwnerDraft = buildFieldOfflineDraft({ ...draft, ownerUserId: 'uid-tech-2' }, clock);
assert(draft.id !== otherOwnerDraft.id && draft.baseVersion === 2, 'drafts must be user-scoped and retain the canonical base version');
assertThrows(() => buildFieldOfflineDraft({ ...draft, baseVersion: -1 }, clock), 'drafts with invalid canonical base version must fail closed');

console.log('Field offline cache/draft/outbox contract acceptance passed.');
