'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { STORAGE_KEYS, MAX_BACKUP_BYTES, captureLocalBackup, verifyLocalBackup, inspectLocalBackup } = require('./recovery');
const context = { capturedAt: '2026-09-01T12:00:00.000Z', origin: 'https://example.test' };
const record = { id: 'P-TEST', projectNumber: 'PRJ-TEST', phases: [], assignments: [], unknownField: { preserved: true } };
function storageFor(raw = JSON.stringify({ version: 1, projects: [record] }), templates = '[]') {
  const data = new Map([[STORAGE_KEYS[0], raw], [STORAGE_KEYS[1], templates], ['session-token', 'must-not-be-read']]);
  const reads = [];
  return {
    data, reads,
    getItem(key) { assert.ok(STORAGE_KEYS.includes(key)); reads.push(key); return data.get(key) ?? null; },
    setItem() { assert.fail('Recovery must not write storage'); },
    removeItem() { assert.fail('Recovery must not remove storage'); },
    clear() { assert.fail('Recovery must not clear storage'); },
  };
}
async function backup(raw, templates) { return captureLocalBackup(storageFor(raw, templates), context); }

test('capture reads only exact Projects keys; raw content and unknown fields survive round trip', async () => {
  const storage = storageFor(' {"version":1,"projects":[]}\n', '[{"extra":"keep"}]');
  const before = JSON.stringify([...storage.data]);
  const value = await captureLocalBackup(storage, context);
  const verified = await verifyLocalBackup(JSON.stringify(value));
  assert.equal(verified.body.entries[0].raw, ' {"version":1,"projects":[]}\n');
  assert.equal(verified.body.entries[1].raw, '[{"extra":"keep"}]');
  assert.deepEqual(storage.reads, [...STORAGE_KEYS, ...STORAGE_KEYS]);
  assert.equal(JSON.stringify([...storage.data]), before);
});
test('checksums match the independent Node SHA-256 implementation', async () => {
  const value = await backup();
  assert.equal(value.integrity.digest, createHash('sha256').update(JSON.stringify(value.body)).digest('hex'));
});
test('inspection preserves the original project identity and all unknown values', async () => {
  const value = await backup();
  const inspection = inspectLocalBackup(await verifyLocalBackup(JSON.stringify(value)));
  assert.deepEqual(inspection.projects, [record]);
  assert.equal(inspection.projectCount, 1); assert.equal(inspection.templateCount, 0);
  assert.equal(inspection.migrationAllowed, false);
});
test('malformed legacy JSON is preserved, not discarded by a sanitizer', async () => {
  const value = await backup('{corrupt but recoverable', 'broken');
  const verified = await verifyLocalBackup(JSON.stringify(value));
  assert.equal(verified.body.entries[0].raw, '{corrupt but recoverable');
  assert.equal(inspectLocalBackup(verified).issues.filter((row) => row.code === 'malformed_source_json').length, 2);
});
test('missing keys and empty valid arrays remain distinguishable', async () => {
  const missing = await captureLocalBackup(storageFor(null, null), context);
  assert.equal(inspectLocalBackup(missing).projectCount, null);
  const empty = await backup('{"version":1,"projects":[]}', '[]');
  assert.equal(inspectLocalBackup(empty).projectCount, 0);
});
test('duplicate IDs and case-insensitive numbers are reported without deleting records', async () => {
  const value = await backup(JSON.stringify({ version: 1, projects: [record, { ...record, projectNumber: 'prj-test' }] }));
  const result = inspectLocalBackup(value);
  assert.equal(result.projectCount, 2);
  assert.ok(result.issues.some((row) => row.code === 'duplicate_project_id'));
  assert.ok(result.issues.some((row) => row.code === 'duplicate_project_number'));
});
test('unsupported source schema does not silently become an empty project list', async () => {
  const result = inspectLocalBackup(await backup('{"version":99,"projects":[]}', '{}'));
  assert.equal(result.projectCount, null);
  assert.ok(result.issues.some((row) => row.code === 'unsupported_project_state'));
  assert.ok(result.issues.some((row) => row.code === 'unsupported_templates'));
});
test('tampering with raw data, origin or capture timestamp rejects verification', async () => {
  for (const change of [
    (b) => { b.body.entries[0].raw = '{}'; },
    (b) => { b.body.origin = 'https://changed.test'; },
    (b) => { b.body.capturedAt = '2026-09-02T12:00:00.000Z'; },
  ]) {
    const value = await backup(); change(value);
    await assert.rejects(verifyLocalBackup(JSON.stringify(value)), { code: 'checksum_mismatch' });
  }
});
test('unexpected storage keys, duplicate entries or unexpected envelope fields reject verification', async () => {
  for (const change of [
    (b) => { b.body.entries[0].key = 'firebase:authUser'; },
    (b) => { b.body.entries[1] = b.body.entries[0]; },
    (b) => { b.extra = 'not-allowed'; },
    (b) => { b.body.entries[0].extra = 'not-allowed'; },
  ]) {
    const value = await backup(); change(value);
    await assert.rejects(verifyLocalBackup(JSON.stringify(value)));
  }
});
test('invalid capture timestamps are rejected', async () => {
  for (const capturedAt of ['2026-02-30T00:00:00.000Z', '2026-09-01', '', null]) {
    await assert.rejects(captureLocalBackup(storageFor(), { ...context, capturedAt }), { code: 'invalid_timestamp' });
  }
});
test('credential-bearing, path, non-http and query origins are rejected', async () => {
  for (const origin of ['https://user:pass@example.test', 'https://example.test/path', 'file:///a', 'https://example.test?a=secret']) {
    await assert.rejects(captureLocalBackup(storageFor(), { ...context, origin }), { code: 'invalid_origin' });
  }
});
test('unreadable storage fails without swallowing an error or producing a false backup', async () => {
  await assert.rejects(captureLocalBackup({ getItem() { throw new Error('blocked'); } }, context), /blocked/);
});
test('changing storage during capture blocks backup rather than mixing snapshots', async () => {
  let calls = 0;
  await assert.rejects(captureLocalBackup({ getItem() { return String(++calls); } }, context), { code: 'storage_changed' });
});
test('oversized backup file is refused before JSON parsing', async () => {
  await assert.rejects(verifyLocalBackup('x'.repeat(MAX_BACKUP_BYTES + 1)), { code: 'backup_too_large' });
});
test('invalid JSON and checksum metadata are refused', async () => {
  await assert.rejects(verifyLocalBackup('{bad'), { code: 'invalid_backup' });
  const value = await backup(); value.integrity.algorithm = 'MD5';
  await assert.rejects(verifyLocalBackup(JSON.stringify(value)), { code: 'invalid_backup' });
});
test('JSON null source values are invalid data, not missing storage or a clean empty backup', async () => {
  const result = inspectLocalBackup(await backup('null', 'null'));
  assert.ok(result.issues.some((row) => row.code === 'unsupported_project_state'));
  assert.ok(result.issues.some((row) => row.code === 'unsupported_templates'));
});
