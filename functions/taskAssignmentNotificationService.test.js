'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assignmentEventId,
  assignmentNotificationMessage,
  assignmentQueueId,
  compactRequirements,
} = require('./taskAssignmentNotificationService');

function task(overrides = {}) {
  return {
    id: 'task-abc',
    taskNumber: 'TSK-ABC123',
    title: 'Delta Blue Report',
    description: 'Prepare the Delta Blue report with the requested photos and final notes.',
    priority: 'important',
    dueAt: '2026-09-12T14:00:00.000Z',
    assigneeNameSnapshot: 'Scarlett',
    ...overrides,
  };
}

test('new task message uses approved clean WhatsApp format', () => {
  const text = assignmentNotificationMessage(task(), 'Scarlett');
  assert.match(text, /Hi Scarlett, you have a new DEMAC task\./);
  assert.match(text, /TSK-ABC123\n\*Delta Blue Report\*/);
  assert.match(text, /\*Deadline:\*/);
  assert.match(text, /\*Requirements:\*\nPrepare the Delta Blue report/);
  assert.match(text, /────────────/);
  assert.match(text, /review and acknowledge/i);
  assert.doesNotMatch(text, /Priority:/);
  assert.doesNotMatch(text, /Aruba time/i);
});

test('assignment queue and event ids are deterministic for trigger retries', () => {
  assert.equal(assignmentQueueId('task-abc'), assignmentQueueId('task-abc'));
  assert.equal(assignmentEventId('task-abc'), assignmentEventId('task-abc'));
  assert.notEqual(assignmentQueueId('task-abc'), assignmentQueueId('task-other'));
});

test('long requirements remain readable and bounded without collapsing intentional lines', () => {
  const compacted = compactRequirements('Line one\nLine two\n' + 'x'.repeat(500), 100);
  assert.equal(compacted.length, 100);
  assert.match(compacted, /^Line one\nLine two\n/);
  assert.match(compacted, /…$/);
});

test('creation trigger is gated, canonical-phone based and transactionally deduplicated', () => {
  const source = fs.readFileSync(path.join(__dirname, 'taskAssignmentNotifications.js'), 'utf8');
  assert.match(source, /backendEnabled === true/);
  assert.match(source, /staffProfiles/);
  assert.match(source, /transaction\.get\(queueRef\)/);
  assert.match(source, /transaction\.create\(queueRef/);
  assert.match(source, /reason: 'task_assigned'/);
  assert.match(source, /onDocumentCreated/);
});
