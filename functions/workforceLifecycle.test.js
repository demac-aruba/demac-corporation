const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('./workforceLifecycle');

test('archiveEmailForUid creates deterministic non-reusable identity address', () => {
  assert.equal(_private.archiveEmailForUid('abc_DEF-123'), 'retired-abc_def-123@demac.invalid');
  assert.equal(_private.archiveEmailForUid('uid/with spaces'), 'retired-uid-with-spaces@demac.invalid');
});

test('cleanDate accepts canonical ISO dates', () => {
  assert.equal(_private.cleanDate('2026-08-19'), '2026-08-19');
});

test('cleanDate rejects malformed dates', () => {
  assert.throws(() => _private.cleanDate('19/08/2026'), /fecha válida/i);
  assert.throws(() => _private.cleanDate('2026-8-19'), /fecha válida/i);
});
