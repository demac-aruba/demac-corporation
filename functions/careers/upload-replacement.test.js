'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, COLLECTIONS: N } = require('./service');
const C = require('./core');
const { transactionStore } = require('./test-support/transaction-store');

function setup() {
  const store = transactionStore(), token = 'a'.repeat(64), sessionId = 'replacement-session';
  const original = { id: 'accepted-cv', kind: 'cv', name: 'original.pdf', size: 400, status: 'clean',
    path: 'careers-private/replacement-session/original', generation: '17', mime: 'application/pdf' };
  store.rows.set(`${N.sessions}/${sessionId}`, { id: sessionId, status: 'draft', jobId: 'test-job', jobVersion: 1,
    files: { [original.id]: original }, expiresAt: 9999999, secretHash: C.digest(token) });
  store.rows.set(`${N.jobs}/test-job`, { id: 'test-job', version: 1 });
  let reject = false, pause = null, calls = 0;
  const files = {
    decode: b64 => Buffer.from(b64, 'base64'), publicFile: file => ({ id: file.id, kind: file.kind, status: file.status }),
    prepare: async bytes => { if (pause) await pause; if (reject) throw C.fault('unsafe-file', 'Synthetic scanner rejection', 422); return { bytes, mime: 'application/pdf' }; },
    store: async (session, id, prepared, lease) => { calls++; return { path: `careers-private/${session}/${id}-${lease}`, generation: '23' }; },
    remove: async () => { throw Error('Inline deletion must not be needed for a replacement'); },
  };
  const service = createService({ db: store.db, files, infrastructure: { idDocumentsAllowed: () => false }, now: () => 1000 });
  const request = { sessionId, token, kind: 'cv', name: 'replacement.pdf', base64: Buffer.from('%PDF-1.4 new').toString('base64'), replaceFileId: original.id };
  return { store, service, original, request, state: () => store.rows.get(`${N.sessions}/${sessionId}`),
    failScan: () => { reject = true; }, allowScan: () => { reject = false; }, calls: () => calls,
    blockScan: () => { let resolve; pause = new Promise(r => { resolve = r; }); return () => { resolve(); pause = null; }; } };
}

test('accepted source survives a rejected replacement and is never scheduled for deletion', async () => {
  const x = setup(); x.failScan();
  await assert.rejects(x.service.upload(x.request), { code: 'unsafe-file' });
  assert.deepEqual(x.state().files[x.original.id], x.original);
  assert(!x.store.rows.has(`${N.deletions}/${C.digest(x.original.path)}`));
  assert.equal(x.calls(), 0);
});

test('accepted replacement atomically swaps ownership and schedules only generation-bound source cleanup', async () => {
  const x = setup(), saved = await x.service.upload(x.request);
  assert.equal(saved.status, 'clean'); assert(!x.state().files[x.original.id]);
  assert.equal(x.state().files[saved.id].generation, '23');
  const deletion = x.store.rows.get(`${N.deletions}/${C.digest(x.original.path)}`);
  assert.equal(deletion.generation, '17'); assert.equal(deletion.notBefore, 301000);
  assert.deepEqual(await x.service.upload(x.request), saved, 'retry after source removal reuses the adopted target');
  assert.equal(x.calls(), 1);
});

test('lost post-commit acknowledgement recovers target ownership instead of deleting either accepted object', async () => {
  const x = setup();
  x.store.failAfterCommitOnce(writes => writes.some(([kind, ref, data]) => kind === 'update' && ref.path.startsWith(N.sessions) && data.files && Object.values(data.files).some(f => f.generation === '23')));
  const saved = await x.service.upload(x.request), file = x.state().files[saved.id];
  assert.equal(saved.status, 'clean'); assert.equal(file.generation, '23');
  assert(!x.store.rows.has(`${N.deletions}/${C.digest(file.path)}`));
  assert.equal(x.calls(), 1);
});

test('processing replacement protects its accepted source and rejects a second concurrent replacement', async () => {
  const x = setup(), release = x.blockScan(), uploading = x.service.upload(x.request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.state().files[x.original.id].status, 'clean');
  await assert.rejects(x.service.removeUpload({ ...x.request, fileId: x.original.id }), { code: 'upload-busy' });
  await assert.rejects(x.service.upload({ ...x.request, base64: Buffer.from('different').toString('base64') }), { code: 'upload-busy' });
  release(); assert.equal((await uploading).status, 'clean');
});

test('source replacement conflict preserves the changed source and rejects the orphan target', async () => {
  const x = setup(), release = x.blockScan(), uploading = x.service.upload(x.request);
  await new Promise(resolve => setImmediate(resolve));
  x.state().files[x.original.id].generation = '18'; release();
  await assert.rejects(uploading, { code: 'upload-conflict' });
  assert.equal(x.state().files[x.original.id].generation, '18');
  assert(!x.store.rows.has(`${N.deletions}/${C.digest(x.original.path)}`));
});

test('invalid source identity, other kinds and committed sessions cannot be replaced', async () => {
  for (const kind of ['absent', 'different-kind', 'submitted']) {
    const x = setup();
    if (kind === 'different-kind') x.state().files[x.original.id].kind = 'photo';
    if (kind === 'submitted') x.state().status = 'submitted';
    await assert.rejects(x.service.upload({ ...x.request, replaceFileId: kind === 'absent' ? 'missing' : x.original.id }));
    assert.equal(Object.keys(x.state().files).length, 1); assert.equal(x.calls(), 0);
  }
});

test('quota uses the final accepted set, not both source and replacement as permanent files', async () => {
  const x = setup(); x.state().files[x.original.id].size = 10 * 1024 * 1024;
  x.state().files['large-document'] = { id: 'large-document', kind: 'document', size: C.MAX_TOTAL - 12, status: 'clean' };
  // New bytes replace rather than append the CV; the projected total still must fit.
  const saved = await x.service.upload(x.request); assert.equal(saved.status, 'clean');
  const y = setup(); y.state().files.other = { id: 'other', kind: 'document', size: C.MAX_TOTAL, status: 'clean' };
  await assert.rejects(y.service.upload(y.request), /30 MB/); assert.equal(y.calls(), 0);
});

test('ordinary existing-client slot validation remains unchanged without explicit replacement', async () => {
  const x = setup(), request = { ...x.request }; delete request.replaceFileId;
  await assert.rejects(x.service.upload(request), { code: 'file-slot' });
  assert.deepEqual(x.state().files[x.original.id], x.original);
});
