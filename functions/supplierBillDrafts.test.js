'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createSupplierBillDraftService } = require('./supplierBillDraftsService');
const { createSupplierBillDraftsHandler } = require('./supplierBillDraftsHttp');
const { blankBill, blankLine } = require('./supplierBillCosting');
const actor = { active: true, role: 'admin', name: 'Test Owner' };
const fixed = () => Date.parse('2026-11-09T14:00:00Z');
const make = (extra = {}) => {
  const db = new TransactionalFirestore({ 'users/owner': actor, 'users/warehouse': { active: true, role: 'inventory', name: 'Warehouse' }, 'users/finance': { active: true, role: 'accounting' }, ...extra });
  return { db, service: createSupplierBillDraftService({ db, enabled: true, now: fixed }) };
};
const command = (patch = {}) => ({ action: 'save', id: 'draft-000000000001', requestId: 'request-000000001', expectedVersion: 0, reason: '', draft: {
  ...blankBill(), supplier: 'Example Supplier', invoiceNumber: 'TEST-001', generalImport: '50', lines: [
    { ...blankLine(), description: 'Split', quantity: '4', unitCost: '250', marketing: '5', profit: '15', operations: '22', finalPrice: '1199', confirmed: true },
    { ...blankLine(), use: 'consumable', description: 'Tape', unitCost: '20', importOverride: '30' },
  ],
}, ...patch });
const fails = (work, code) => assert.rejects(work, error => error.safeCode === code);

test('saved draft reopens with server costs, rates and no inventory or accounting changes', async () => {
  const { db, service } = make({ 'warehouseInventory/item': { quantity: 5 }, 'services/item': { price: 699 } });
  const input = command();
  const receipt = await service.execute('owner', input);
  assert.deepEqual(receipt, { accepted: true, id: input.id, version: 1 });
  const { record } = await service.execute('owner', { action: 'read', id: input.id });
  assert.equal(record.calculations[0].cost.landed, '68850');
  assert.equal(record.calculations[1].cost.landed, '4774');
  assert.equal(record.draft.lines[0].confirmed, true);
  assert.equal(record.draft.lines[1].importOverride, '30');
  assert.equal(record.catalogLinks, 'pending'); assert.equal(record.inventoryStatus, 'not-received'); assert.equal(record.accountingStatus, 'not-sent');
  assert.deepEqual(db.read('warehouseInventory/item'), { quantity: 5 }); assert.deepEqual(db.read('services/item'), { price: 699 });
  assert.equal(db.read(`supplierBillDrafts/${input.id}/revisions/0000000001`).version, 1);
});
test('same request resolves once even with simultaneous retries; changed content conflicts', async () => {
  const { db, service } = make(), input = command();
  const receipts = await Promise.all([service.execute('owner', input), service.execute('owner', input)]);
  assert.equal(receipts.filter(row => row.replayed).length, 1); assert.ok(db.retries > 0);
  assert.equal(db.read(`supplierBillDrafts/${input.id}`).version, 1);
  const changed = structuredClone(input); changed.draft.lines[0].unitCost = '300';
  await fails(service.execute('owner', changed), 'request-payload-conflict');
  assert.equal((await service.execute('owner', input)).version, 1);
});
test('two concurrent edits keep one version and append immutable history with actor and reason', async () => {
  const { db, service } = make(), input = command(); await service.execute('owner', input);
  const first = command({ expectedVersion: 1, requestId: 'request-000000002', reason: 'Revised quote' });
  first.draft.lines[0].unitCost = '300';
  const second = command({ expectedVersion: 1, requestId: 'request-000000003', reason: 'Other quote' });
  const outcomes = await Promise.all([service.execute('owner', first), service.execute('warehouse', second)]);
  assert.equal(outcomes.filter(row => row.accepted).length, 1);
  assert.equal(outcomes.find(row => !row.accepted).code, 'draft-version-conflict');
  assert.equal(db.read(`supplierBillDrafts/${input.id}/revisions/0000000001`).draft.lines[0].unitCost, '250');
  const history = await service.execute('finance', { action: 'history', id: input.id, beforeVersion: null });
  assert.deepEqual(history.rows.map(row => row.version), [2, 1]); assert.ok(history.rows[0].reason);
});
test('duplicate reference is fenced, including simultaneous inserts with normalized supplier label', async () => {
  const { service, db } = make(), a = command(), b = command({ id: 'draft-000000000002', requestId: 'request-000000002' });
  b.draft.supplier = '  example  supplier '; b.draft.invoiceNumber = 'test-001';
  const results = await Promise.all([service.execute('owner', a), service.execute('warehouse', b)]);
  assert.equal(results.filter(row => row.accepted).length, 1);
  assert.equal(results.find(row => !row.accepted).code, 'duplicate-draft-reference');
  // Even after the matching draft changes its reference, the rejected request cannot later commit.
  const rename = command({ expectedVersion: 1, requestId: 'request-000000004', reason: 'Correct invoice number' }); rename.draft.invoiceNumber = 'TEST-NEW';
  await service.execute('owner', rename);
  assert.equal((await service.execute('warehouse', b)).accepted, false);
  assert.equal(db.read('supplierBillDrafts/draft-000000000002'), undefined);
});
test('fresh authorization, read-only finance, disabled service and denied exact retry', async () => {
  const { service, db } = make(), input = command();
  for (const role of ['office', 'technician', 'auditor', 'unknown']) {
    db.write('users/denied', { active: true, role });
    await fails(service.execute('denied', input), 'draft-access-denied');
  }
  await fails(service.execute('finance', input), 'draft-access-denied');
  await service.execute('owner', input); db.write('users/owner', { ...actor, active: false });
  await fails(service.execute('owner', input), 'draft-access-denied');
  await fails(service.execute('missing', { action: 'list', after: null }), 'draft-access-denied');
  const disabled = createSupplierBillDraftService({ db });
  assert.equal((await disabled.execute('warehouse', { action: 'status' })).enabled, false);
  await fails(disabled.execute('warehouse', input), 'drafts-not-active');
});
test('unverified costs remain incomplete, explicit zero works and invalid schema cannot enter storage', async () => {
  const { service, db } = make(); const empty = command(); empty.draft.generalImport = '';
  await service.execute('owner', empty);
  const value = db.read(`supplierBillDrafts/${empty.id}`);
  assert.equal(value.calculations[0].cost, null); assert.ok(value.calculations[0].error); assert.equal(value.draft.lines[0].confirmed, false);
  const zero = command({ expectedVersion: 1, requestId: 'request-000000005', reason: 'Known exemption' }); zero.draft.lines[0].importOverride = '0';
  await service.execute('owner', zero); assert.equal(db.read(`supplierBillDrafts/${zero.id}`).calculations[0].cost.shipping, '0');
  for (const change of [{ expectedVersion: -1 }, { expectedVersion: 1, reason: '' }, { role: 'admin' }, { id: '../../evil' }]) await assert.rejects(service.execute('owner', command(change)));
  const bad = command(); bad.draft.lines[0].unitCost = 5; await fails(service.execute('owner', bad), 'invalid-draft');
  assert.equal(db.read(`supplierBillDrafts/${zero.id}`).version, 2);
});
test('history and list pagination keep bounded results without losing versions', async () => {
  const { service, db } = make(); const initial = command(); await service.execute('owner', initial);
  for (let version = 1; version < 22; version++) await service.execute('owner', command({ expectedVersion: version, requestId: `request-version-${String(version).padStart(5,'0')}`, reason: 'Draft change' }));
  const history = await service.execute('owner', { action: 'history', id: initial.id, beforeVersion: null });
  assert.equal(history.rows.length, 20); assert.equal(history.next, 3);
  assert.deepEqual((await service.execute('owner', { action: 'history', id: initial.id, beforeVersion: history.next })).rows.map(x => x.version), [2, 1]);
  const sample = db.read(`supplierBillDrafts/${initial.id}`);
  for (let i = 2; i <= 22; i++) { const id = `draft-${String(i).padStart(12,'0')}`; db.write(`supplierBillDrafts/${id}`, { ...sample, id }); }
  const page1 = await service.execute('owner', { action: 'list', after: null });
  const page2 = await service.execute('owner', { action: 'list', after: page1.next });
  assert.equal(page1.rows.length, 20); assert.equal(page2.rows.length, 2); assert.equal(page2.next, null);
  assert.equal(new Set([...page1.rows, ...page2.rows].map(x => x.id)).size, 22);
});
test('corrupt prior revision and missing claim cannot overwrite immutable evidence', async () => {
  const { service, db } = make(); const input = command(); await service.execute('owner', input);
  db.write(`supplierBillDrafts/${input.id}/revisions/0000000002`, { evidence: 'must retain' });
  await fails(service.execute('owner', command({ expectedVersion: 1, requestId: 'request-000000006', reason: 'Correction' })), 'draft-needs-review');
  assert.deepEqual(db.read(`supplierBillDrafts/${input.id}/revisions/0000000002`), { evidence: 'must retain' });
  const missing = make(); await missing.service.execute('owner', input);
  const claim = [...missing.db.store.keys()].find(key => key.startsWith('supplierBillDraftClaims/'));
  missing.db.store.delete(claim);
  await fails(missing.service.execute('owner', command({ expectedVersion: 1, requestId: 'request-000000006', reason: 'Correction' })), 'draft-needs-review');
  assert.equal(missing.db.read(`supplierBillDrafts/${input.id}`).version, 1);
});
async function http(patch = {}, revoked = false, enabled = true) {
  const { db } = make(); const calls = [];
  const handler = createSupplierBillDraftsHandler({ db, enabled, now: fixed, verifyIdToken: async (token, checkRevoked) => { calls.push(checkRevoked); if (revoked) throw Error('revoked'); return { uid: 'owner' }; } });
  const req = { method: 'POST', path: '/', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', origin: 'https://demac-aruba.com' }, body: command(), ...patch };
  req.get = key => req.headers[key];
  const res = { code: 200, headers: {}, set(key,value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; }, send(data) { this.body = data; return this; } };
  await handler(req, res); return { res, calls, db };
}
test('HTTP enforces CORS, token revocation, path, method, size and fail-closed activation', async () => {
  const good = await http(); assert.equal(good.res.body.accepted, true); assert.deepEqual(good.calls, [true]);
  for (const [patch, code] of [
    [{ headers: { origin: 'https://evil.example' } },403], [{ headers: {} },401], [{ path: '/other' },404], [{ method: 'GET' },405],
    [{ rawBody: Buffer.alloc(300001) },400], [{ body: null },400],
  ]) { const result = await http(patch); assert.equal(result.res.code, code); assert.equal([...result.db.store.keys()].some(key => key.startsWith('supplierBillDrafts/')), false); }
  assert.equal((await http({}, true)).res.code, 401);
  assert.equal((await http({}, false, false)).res.body.error, 'drafts-not-active');
  assert.equal((await http({ method: 'OPTIONS' })).res.code, 204);
});
