// Real REST transaction transport, synthetic token and fetch responses only.
const assert = require('node:assert/strict');
for (const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID']) process.env['NEXT_PUBLIC_FIREBASE_' + key] = 'demo-demac-transaction';
const root = '../.employee-attendance-test/apps/erp-next/lib/firebase/';
require(root + 'session').requireFirebaseWebSession = async () => ({ idToken: 'synthetic-token' });
const storage = require(root + 'firestore-rest');
const prefix = 'projects/demo-demac-transaction/databases/(default)/documents/employeeTimesheets/';
let mode = 'success', calls = [], writes = [];
global.fetch = async (url, init) => {
  assert.match(url, /^https:\/\/firestore.googleapis.com\/v1\/projects\/demo-demac-transaction\//);
  assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
  const action = url.split(':').at(-1), body = JSON.parse(init.body);
  calls.push(action);
  if (action === 'beginTransaction') return Response.json(mode === 'denied' ? { error: { message: 'Denied' } } : { transaction: 'synthetic-tx' }, { status: mode === 'denied' ? 403 : 200 });
  assert.equal(body.transaction, 'synthetic-tx');
  if (action === 'batchGet') {
    const rows = body.documents.map(name => name === prefix + 'target' ? { found: { name, fields: storage.encodeFirestoreFields({ notes: 'Preserved', unknown: { nested: 42 } }) } } : { missing: name }).reverse();
    return Response.json(mode === 'incomplete' ? rows.slice(1) : rows);
  }
  if (action === 'commit') {
    writes.push(body.writes);
    return Response.json(mode === 'conflict' ? { error: { message: 'Concurrent edit' } } : { writeResults: [{}] }, { status: mode === 'conflict' ? 409 : 200 });
  }
  assert.equal(action, 'rollback'); return Response.json({});
};
async function main() {
  const result = await storage.mutateFirestoreDocumentWithReads('employeeTimesheets', 'target', ['previous','next'], (current, records) => {
    assert.deepEqual(current.unknown, { nested: 42 }); assert.equal(records.previous, null);
    return { overtimePayAllocations: [{ rate: 200, minutes: 570 }] };
  });
  assert.equal(result.notes, 'Preserved'); assert.deepEqual(result.unknown, { nested: 42 });
  assert.deepEqual(writes[0][0].updateMask.fieldPaths, ['overtimePayAllocations']);
  assert.deepEqual(writes[0][0].currentDocument, { exists: true }); assert.equal(writes[0].length, 1);
  assert.deepEqual(calls, ['beginTransaction','batchGet','commit']);
  for (const scenario of ['denied','incomplete','conflict']) {
    mode = scenario; calls = []; writes = [];
    await assert.rejects(storage.mutateFirestoreDocumentWithReads('employeeTimesheets','target',['next'], () => ({ notes: 'Explicit edit' })));
    if (scenario !== 'conflict') assert.equal(writes.length, 0);
    if (scenario !== 'denied') assert.equal(calls.at(-1), 'rollback');
  }
  mode = 'success'; calls = []; writes = [];
  await storage.mutateFirestoreDocumentWithReads('employeeTimesheets','target',[], () => null);
  assert.equal(writes.length, 0); assert.equal(calls.at(-1), 'rollback');
  console.log('PASS authenticated transaction: exact adjacent reads, field mask, opaque data preservation, denial, incomplete reads, concurrent abort and no-op rollback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
