import assert from 'node:assert/strict';
import { chargeRetryWasNotCommitted, chargeRecoveryBaseline, clearChargeRecovery, decodeChargeRecovery, type ChargeRecovery } from '../lib/appointment-charge-recovery';
import { fillMissingChargeDescriptions, type ChargeLineInput, type ChargeRecord } from '../lib/appointment-charges';
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log('PASS ' + name); };
const empty: ChargeRecord = { success: true, state: null, payments: [], history: [], blocker: '', appointmentStatus: 'confirmed' };
const owned = { ...empty, state: { schemaVersion: 1 as const, version: 7, originalEstimate: null, estimate: null, final: null, receivedCents: 0, paymentCount: 0 } };
const saved: ChargeRecovery = { schema: 1, userId: 'operator', appointmentId: 'apt', savedAt: Date.now(),
  draft: { lines: [{ id: 'line', serviceId: 'std12', label: 'Servicio 12k', quantity: 3 }], note: 'Pendiente', version: 7, baseline: chargeRecoveryBaseline(owned) }, pending: null };
check('old draft descriptions copy by catalog identity without changing source or explicit invoice edits', () => {
  const catalog = [{ id: 'std12', name: 'Servicio 12k', description: 'Descripción original del servicio' },
    { id: 'product', name: 'Producto', description: 'Descripción original del producto' }];
  const lines: ChargeLineInput[] = [...saved.draft!.lines,
    { id: 'edited', serviceId: 'std12', label: 'Servicio 12k', quantity: 1, description: 'Sólo esta factura' },
    { id: 'cleared', serviceId: 'std12', label: 'Servicio 12k', quantity: 1, description: '' },
    { id: 'product', serviceId: 'product', label: 'Producto', quantity: 2 },
    { id: 'missing', serviceId: 'retired', label: 'Servicio 12k', quantity: 1 }];
  const before = structuredClone({ lines, catalog });
  const described = fillMissingChargeDescriptions(lines, catalog);
  assert.deepEqual(described.map(line => line.description), ['Descripción original del servicio', 'Sólo esta factura', '', 'Descripción original del producto', undefined]);
  assert.deepEqual({ lines, catalog }, before);
  assert.equal(fillMissingChargeDescriptions(described, catalog), described);
  assert.equal(fillMissingChargeDescriptions(lines, []), lines);
  assert.equal(described[0].quantity, 3);
  const recovered = decodeChargeRecovery(JSON.stringify({ ...saved, draft: { ...saved.draft, lines: described } }), 'operator', 'apt');
  assert.deepEqual(recovered?.draft?.lines, described);
});
check('only lease version changes preserve the full financial baseline', () => {
  assert.equal(chargeRecoveryBaseline(empty), chargeRecoveryBaseline(owned));
  assert.equal(chargeRecoveryBaseline(owned), chargeRecoveryBaseline({ ...owned, state: { ...owned.state, version: 8 } }));
  assert.notEqual(chargeRecoveryBaseline(owned), chargeRecoveryBaseline({ ...owned, state: { ...owned.state, receivedCents: 25000 } }));
  assert.notEqual(chargeRecoveryBaseline(owned), chargeRecoveryBaseline({ ...owned, candidateEvidence: { fingerprint: 'changed', records: [] } }));
});
check('draft recovery is scoped to exact owner and appointment', () => {
  assert.deepEqual(decodeChargeRecovery(JSON.stringify(saved), 'operator', 'apt'), saved);
  assert.throws(() => decodeChargeRecovery(JSON.stringify(saved), 'another', 'apt'));
  assert.throws(() => decodeChargeRecovery(JSON.stringify(saved), 'operator', 'another'));
});
check('malformed, excessive and corrupt recovery is rejected', () => {
  assert.throws(() => decodeChargeRecovery('corrupt', 'operator', 'apt'));
  assert.throws(() => decodeChargeRecovery(JSON.stringify({ schema: 1, userId: 'operator', appointmentId: 'apt', savedAt: Date.now() }), 'operator', 'apt'));
  assert.throws(() => decodeChargeRecovery(' '.repeat(1_000_001), 'operator', 'apt'));
  for (const draft of [{ ...saved.draft, lines: Array(61).fill(saved.draft!.lines[0]) }, { ...saved.draft, version: -1 }, { ...saved.draft, lines: [{ id: 'x', label: 'x', quantity: null }] }]) {
    assert.throws(() => decodeChargeRecovery(JSON.stringify({ ...saved, draft }), 'operator', 'apt'));
  }
});
check('unknown operation retains exact replay identity and values, without creating a new request', () => {
  const pending = { action: 'record_appointment_payment', data: { appointmentId: 'apt', expectedVersion: 7, editSessionId: 'synthetic-session', editToken: 'synthetic-token', requestId: 'same-request', payment: { method: 'cash', amount: '250', reference: '', receivedAt: '2026-10-13T12:00:00Z' } } };
  assert.deepEqual(decodeChargeRecovery(JSON.stringify({ ...saved, pending }), 'operator', 'apt')?.pending, pending);
  const correction = { ...pending, action: 'correct_appointment_payment', data: { ...pending.data, paymentId: 'receipt', reason: 'Fecha incorrecta' } };
  assert.deepEqual(decodeChargeRecovery(JSON.stringify({ ...saved, pending: correction }), 'operator', 'apt')?.pending, correction);
  assert.throws(() => decodeChargeRecovery(JSON.stringify({ ...saved, pending: { ...pending, action: 'another_action' } }), 'operator', 'apt'));
});
check('receipt identity and equal-total changes do not compare as equivalent', () => {
  const payment = { id: 'receipt', source: 'appointment-operational', amountCents: 25000, status: 'recorded' as const, method: 'cash' as const, reference: '', receivedAt: 'date', createdAt: 'date', createdByName: 'actor' };
  const first = { ...owned, payments: [payment] };
  assert.notEqual(chargeRecoveryBaseline(first), chargeRecoveryBaseline({ ...first, payments: [{ ...payment, id: 'other' }] }));
  assert.notEqual(chargeRecoveryBaseline(first), chargeRecoveryBaseline({ ...first, payments: [{ ...payment, reference: 'other' }] }));
});
check('explicit sign-out clears ordinary drafts but retains uncertain and corrupt copies', () => {
  const prefix = 'demac.erp-next.charge-recovery.v1:';
  const pending = { action: 'record_appointment_payment', data: { appointmentId: 'apt', expectedVersion: 7, editSessionId: 's', editToken: 't', requestId: 'same', payment: { amount: '250', method: 'cash' } } };
  const values = new Map([[prefix + 'operator:apt', JSON.stringify(saved)], [prefix + 'operator:uncertain', JSON.stringify({ ...saved, pending })], [prefix + 'corrupt', 'broken'], ['unrelated', 'keep']]);
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index], getItem: (name: string) => values.get(name) || null, removeItem: (name: string) => { values.delete(name); } } as Storage;
  clearChargeRecovery(storage); assert.equal(values.has(prefix + 'operator:apt'), false);
  assert.equal(values.has(prefix + 'operator:uncertain'), true); assert.equal(values.get(prefix + 'corrupt'), 'broken'); assert.equal(values.get('unrelated'), 'keep');
});
check('a retry rejection resolves uncertainty only after a proved different lease fence', () => {
  const request = { action: 'record_appointment_payment', data: { editSessionId: 'old', expectedVersion: 7 } };
  assert.equal(chargeRetryWasNotCommitted('charge_edit_lost', request, null, 8), false);
  assert.equal(chargeRetryWasNotCommitted('charge_edit_lost', request, { editSessionId: 'old' }, 8), false);
  assert.equal(chargeRetryWasNotCommitted('charge_edit_lost', request, { editSessionId: 'new' }, 7), false);
  for (const code of ['unauthenticated', 'forbidden', 'idempotency_conflict', undefined]) assert.equal(chargeRetryWasNotCommitted(code, request, { editSessionId: 'new' }, 8), false);
  assert.equal(chargeRetryWasNotCommitted('charge_edit_lost', request, { editSessionId: 'new' }, 8), true);
  assert.equal(chargeRetryWasNotCommitted('charge_conflict', request, { editSessionId: 'new' }, 8), true);
});
console.log(`${checks} charge recovery acceptance checks passed`);
