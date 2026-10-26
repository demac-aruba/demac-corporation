// Transport failure injection; real Rules/HTTP behavior is covered by the emulator suite.
const assert = require('node:assert/strict');
for (const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID']) process.env['NEXT_PUBLIC_FIREBASE_' + key] = 'demo-demac-transaction';
const root = '../.employee-attendance-test/apps/erp-next/lib/firebase/';
require(root + 'session').requireFirebaseWebSession = async () => ({ idToken: 'synthetic-token' });
const storage = require(root + 'firestore-rest');
const prefix = 'projects/demo-demac-transaction/databases/(default)/documents/employeeTimesheets/';
const version = '2026-10-25T12:00:00.123456Z';
let mode, calls, writes;
function reset(value = 'success') { mode = value; calls = []; writes = []; }
global.fetch = async (url, init) => {
  assert.match(url, /^https:\/\/firestore.googleapis.com\/v1\/projects\/demo-demac-transaction\//);
  assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
  const action = url.split(':').at(-1), body = JSON.parse(init.body);
  calls.push(action);
  // Web credentials must never need built-in readWrite transactions or rollback.
  assert.ok(['batchGet', 'commit'].includes(action), 'Unsupported web transaction RPC: ' + action);
  assert.equal(body.transaction, undefined); assert.equal(body.newTransaction, undefined);
  if (action === 'batchGet') {
    if (mode === 'denied') return Response.json({ error: { status: 'PERMISSION_DENIED', message: 'Private body must not escape' } }, { status: 403 });
    let rows = body.documents.map(name => (name === prefix + 'target' && mode !== 'create') || name === prefix + 'previous'
      ? { found: { name, updateTime: version, fields: storage.encodeFirestoreFields({ notes: 'Preserved', unknown: { nested: 42 } }) } }
      : { missing: name }).reverse();
    if (mode === 'incomplete') rows.pop();
    if (mode === 'duplicate') rows.push(rows[0]);
    if (mode === 'foreign') rows[0] = { missing: prefix + 'unrequested' };
    if (mode === 'no-version') for (const row of rows) if (row.found) delete row.found.updateTime;
    if (mode === 'invalid-version') for (const row of rows) if (row.found) row.found.updateTime = '';
    if (mode === 'both') rows[0] = { found: { name: prefix + 'next', updateTime: version }, missing: prefix + 'next' };
    if (mode === 'null-row') rows[0] = null;
    return Response.json(mode === 'not-array' ? {} : rows);
  }
  writes.push(body.writes);
  if (mode === 'lost-response') throw new TypeError('Synthetic lost response');
  if (mode === 'conflict') return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 });
  if (mode === 'commit-denied') return Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 });
  return Response.json({ writeResults: [{}] });
};
const save = fn => storage.mutateFirestoreDocumentWithReads('employeeTimesheets', 'target', ['previous','next','next'], fn);
async function main() {
  reset();
  const result = await save((current, records) => {
    assert.deepEqual(current.unknown, { nested: 42 }); assert.equal(records.next, null);
    return { overtimePayAllocations: [{ rate: 200, minutes: 570 }] };
  });
  assert.equal(result.notes, 'Preserved'); assert.deepEqual(result.unknown, { nested: 42 });
  assert.deepEqual(writes[0][0].updateMask.fieldPaths, ['overtimePayAllocations']);
  assert.deepEqual(writes[0][0].currentDocument, { updateTime: version });
  assert.equal(writes[0].filter(w => w.update).length, 1);
  assert.deepEqual(writes[0].filter(w => w.verify).sort((a,b) => a.verify.localeCompare(b.verify)), [
    { verify: prefix + 'next', currentDocument: { exists: false } },
    { verify: prefix + 'previous', currentDocument: { updateTime: version } },
  ]);
  assert.deepEqual(calls, ['batchGet','commit']);
  reset('create'); await save(() => ({ notes: 'New' }));
  assert.deepEqual(writes[0][0].currentDocument, { exists: false });
  for (const scenario of ['denied','incomplete','duplicate','foreign','no-version','invalid-version','both','null-row','not-array']) {
    reset(scenario); await assert.rejects(save(() => ({ notes: 'Explicit edit' })));
    assert.equal(writes.length, 0, scenario); assert.deepEqual(calls, ['batchGet']);
  }
  for (const scenario of ['conflict','commit-denied','lost-response']) {
    reset(scenario); await assert.rejects(save(() => ({ notes: 'Explicit edit' })), error => {
      if (scenario === 'conflict') assert.match(error.message, /Refresh and review/);
      if (scenario === 'commit-denied') assert.match(error.message, /Attendance could not be saved.*PERMISSION_DENIED/);
      return true;
    });
    assert.equal(writes.length, 1); assert.deepEqual(calls, ['batchGet','commit']);
  }
  reset(); await save(() => null); assert.equal(writes.length, 0); assert.deepEqual(calls, ['batchGet']);
  reset(); await assert.rejects(save(() => ({ ignored: undefined }))); assert.equal(writes.length, 0);
  reset(); await assert.rejects(save(() => { throw Error('Overlap'); }), /Overlap/); assert.equal(writes.length, 0);
  reset(); await assert.rejects(storage.mutateFirestoreDocumentWithReads('employeeTimesheets','target',Array.from({length:20},(_,i) => 'n'+i),() => ({}))); assert.equal(calls.length, 0);
  console.log('PASS web transaction: versioned masked commit, verify existing/missing neighbors, create, malformed reads, read/write denial, conflict, lost response, no-op and bounded reads.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
