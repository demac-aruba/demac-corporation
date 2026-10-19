'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { category, summarize } = require('./whatsapp-incident-audit-20261019.cjs');
test('audit does not disclose recipients, body or raw diagnostic error', () => {
  const record = { provider: 'wacli', notificationType: 'appointment-confirmation', status: 'queued',
    to: 'PRIVATE-RECIPIENT', text: 'PRIVATE-MESSAGE', errorMessage: 'PRIVATE-ERROR', createdAtIso: '2026-10-19T12:00:00Z' };
  const value = summarize([{data:()=>record}], 1);
  assert.equal(value.limitReached, true);
  assert.equal(value.counts['wacli/appointment-confirmation/queued'], 1);
  assert.equal(value.oldestPending, '2026-10-19T12:00:00Z');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
});
test('errors remain diagnostic categories without raw content', () => {
  for (const [message, expected] of [['Unauthorized HTTP 401 PRIVATE-TOKEN','unauthorized'],['not connected PRIVATE-PHONE','session_disconnected'],['requires an index PRIVATE-QUERY','index_required'],['permission denied PRIVATE-IDENTITY','permission_denied'],['deadline exceeded PRIVATE-BODY','timeout']]) assert.equal(category(message), expected);
});
