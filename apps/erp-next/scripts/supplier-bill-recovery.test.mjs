import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'supplier-recovery-'));
function compile(source, output) {
  fs.writeFileSync(path.join(temp, output), ts.transpileModule(fs.readFileSync(new URL(source, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
compile('../lib/supplier-bill-recovery.ts', 'recovery.cjs');
fs.writeFileSync(path.join(temp, 'supplier-bill-draft.js'), `module.exports = require(${JSON.stringify(path.resolve(new URL('../../../functions/supplierBillCosting.js', import.meta.url).pathname))});`);
const { pendingSupplierSaves, retainSupplierSave, releaseSupplierSave } = require(path.join(temp, 'recovery.cjs'));
const { blankBill, blankLine } = require('../../../functions/supplierBillCosting.js');
const recovery = require(path.join(temp, 'recovery.cjs'));
const transportCode = ts.transpileModule(fs.readFileSync(new URL('../lib/firebase/supplier-bill-drafts.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function gatewayFixture() {
  const store = new Store(), state = { uid: 'owner', sends: 0, reply: async () => ({ accepted: true, id: command.id, version: 1 }) }, exports = {};
  vm.runInNewContext(transportCode, { exports, require(key) {
    if (key === './client-config') return { firebaseClientConfig: { projectId: 'demo' } };
    if (key === './isolated-preview') return { firebaseTransportUrl: value => value };
    if (key === './session') return { requireFirebaseWebSession: async () => ({ uid: state.uid, idToken: 'synthetic-token' }), loadFirebaseWebSession: () => ({ uid: state.uid }) };
    if (key === '../supplier-bill-recovery') return recovery;
    throw Error(key);
  }, window: { localStorage: store }, AbortSignal, fetch: async (_, options) => {
    state.sends++;
    assert.equal(pendingSupplierSaves(store, 'demo', 'owner').length, 1);
    assert.deepEqual(JSON.parse(options.body), command);
    return { ok: true, status: 200, json: () => state.reply() };
  } });
  return { gateway: exports.supplierBillGateway, store, state };
}
class Store {
  data = new Map();
  get length() { return this.data.size; }
  key(n) { return [...this.data.keys()][n] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
const command = { action: 'save', id: 'draft-000000000001', requestId: 'request-000000001', expectedVersion: 0, reason: '', draft: { ...blankBill(), supplier: 'Synthetic', invoiceNumber: 'T-1', lines: [blankLine()] } };
test('uncertain request survives reopening and is private to the same project and user', () => {
  const store = new Store(); retainSupplierSave(store, 'demo', 'owner', command);
  assert.deepEqual(pendingSupplierSaves(store, 'demo', 'owner'), [command]);
  assert.deepEqual(pendingSupplierSaves(store, 'demo', 'other'), []);
  assert.deepEqual(pendingSupplierSaves(store, 'production', 'owner'), []);
  assert.equal([...store.data.values()].some(raw => raw.includes('Token')), false);
  retainSupplierSave(store, 'demo', 'owner.extra', command);
  assert.equal(pendingSupplierSaves(store, 'demo', 'owner').length, 1);
});
test('gateway retains uncertain or mismatched receipts and retires only a verified result', async () => {
  const { gateway, store, state } = gatewayFixture();
  state.reply = async () => { throw Error('response lost'); };
  await assert.rejects(gateway.save(command)); assert.equal(store.length, 1);
  state.reply = async () => ({ accepted: true, id: command.id, version: 2 });
  await assert.rejects(gateway.save(command)); assert.equal(store.length, 1);
  state.reply = async () => ({ accepted: true, id: command.id, version: 1, replayed: true });
  assert.equal((await gateway.save(command)).replayed, true); assert.equal(store.length, 0);
  assert.equal(state.sends, 3);
});
test('gateway will not send without recovery storage and keeps the original account recovery after a session change', async () => {
  const unavailable = gatewayFixture(); unavailable.store.setItem = () => { throw Error('quota'); };
  await assert.rejects(unavailable.gateway.save(command)); assert.equal(unavailable.state.sends, 0);
  const changed = gatewayFixture(); changed.state.reply = async () => { changed.state.uid = 'other'; return { accepted: true, id: command.id, version: 1 }; };
  await assert.rejects(changed.gateway.save(command));
  assert.equal(pendingSupplierSaves(changed.store, 'demo', 'owner').length, 1);
  assert.equal((await changed.gateway.pending()).length, 0);
});
test('exact retries preserve identity, cannot replace payload and each operation survives another tab', () => {
  const store = new Store(); retainSupplierSave(store, 'demo', 'owner', command); retainSupplierSave(store, 'demo', 'owner', command);
  assert.equal(store.length, 1);
  assert.throws(() => retainSupplierSave(store, 'demo', 'owner', { ...command, reason: 'Changed' }));
  const second = { ...command, requestId: 'request-000000002' }; retainSupplierSave(store, 'demo', 'owner', second);
  releaseSupplierSave(store, 'demo', 'owner', command);
  assert.deepEqual(pendingSupplierSaves(store, 'demo', 'owner'), [second]);
});
test('quota, corrupt recovery and invalid commands fail before any dispatch', () => {
  const store = new Store(); store.setItem = () => { throw Error('quota'); };
  assert.throws(() => retainSupplierSave(store, 'demo', 'owner', command), /quota/);
  const broken = new Store(); retainSupplierSave(broken, 'demo', 'owner', command); broken.setItem(broken.key(0), 'invalid');
  assert.throws(() => pendingSupplierSaves(broken, 'demo', 'owner'));
  for (const value of [{ ...command, requestId: '../bad' }, { ...command, expectedVersion: -1 }, { ...command, expectedVersion: 1, reason: '' }]) assert.throws(() => retainSupplierSave(new Store(), 'demo', 'owner', value));
});
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
