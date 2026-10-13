import assert from 'node:assert/strict';
import type { ChargeRecord } from '../lib/appointment-charges';
import { prepareAppointmentQuickBooksPreview as prepare } from '../lib/quickbooks-appointment-preview';
import { reportDiagnosticMessage } from '../lib/quickbooks-report-diagnostics';

function fixture(): ChargeRecord {
  return { success: true, blocker: '', history: [], appointmentStatus: 'confirmed', state: { schemaVersion: 1, version: 4,
    originalEstimate: null, estimate: null, receivedCents: 25000, paymentCount: 1,
    final: { currency: 'AWG', capturedAt: '2026-10-13T16:00:00.000Z', quoteToken: 'synthetic', totalCents: 37500, knownTotalCents: 37500,
      lines: [{ id: 'line-1', serviceId: 'service-12', label: 'Servicio de prueba 12k', quantity: 3, quantityMillis: 3000,
        unitCents: 12500, totalCents: 37500, baseUnitCents: 12500, pendingReason: '', manualPrice: false, pricingVersion: 'test', overrideCents: null }] } },
    payments: [{ id: 'receipt-1', source: 'appointment-operational', amountCents: 25000, method: 'transfer', reference: 'SYNTHETIC',
      receivedAt: '2026-10-13T00:10:00.000Z', createdAt: '2026-10-13T00:10:00.000Z', createdByName: 'Prueba', status: 'recorded' }] };
}
let checks = 0;
function check(name: string, test: () => void) { test(); checks++; console.log(`PASS ${name}`); }
check('confirmed 375 / 250 / 125 is operational only and never sendable', () => {
  const record = fixture(), before = structuredClone(record), p = prepare(record);
  assert.equal(p.invoice?.totalCents, 37500); assert.equal(p.receivedCents, 25000); assert.equal(p.operationalBalanceCents, 12500);
  assert.equal(p.canSend, false); assert.equal(p.sourceVersion, 4); assert.equal(p.sourceIssues.length, 0);
  assert.equal(p.setupIssues.length, 6); assert.deepEqual(record, before); assert.equal(p.receipts[0].receivedDate, '2026-10-12');
});
check('forecasts never replace a confirmed final or make an unconfirmed sale', () => {
  const r = fixture(); r.state!.estimate = { ...r.state!.final!, totalCents: 99999 };
  assert.equal(prepare(r).invoice?.totalCents, 37500); r.state!.final = null;
  assert.equal(prepare(r).invoice, null); assert.equal(prepare(r).sourceIssues[0].code, 'final_missing');
});
check('a blocker or missing state never exposes amounts as prepared', () => {
  for (const r of [{ ...fixture(), blocker: 'Legacy' }, { ...fixture(), state: null }]) {
    const p = prepare(r); assert.equal(p.invoice, null); assert.equal(p.receivedCents, null); assert.equal(p.receipts.length, 0);
  }
});
check('unconfirmed/cancelled statuses stop preparation', () => {
  for (const appointmentStatus of ['temporary_hold', 'cancelled', 'canceled']) assert.equal(prepare({ ...fixture(), appointmentStatus }).invoice, null);
});
check('fractional quantities preserve exact rounded line cents', () => {
  const r = fixture(), final = r.state!.final!; final.lines[0].quantityMillis = 1500; final.lines[0].totalCents = 18750;
  final.totalCents = 18750; r.payments = []; r.state!.receivedCents = 0; r.state!.paymentCount = 0;
  assert.equal(prepare(r).invoice?.lines[0].quantityMillis, 1500); assert.equal(prepare(r).operationalBalanceCents, 18750);
});
check('explicit zero stays zero; null or negative prices do not become free', () => {
  const r = fixture(); r.payments = []; r.state!.paymentCount = 0; r.state!.receivedCents = 0;
  r.state!.final!.totalCents = 0; r.state!.final!.lines[0].unitCents = 0; r.state!.final!.lines[0].totalCents = 0;
  assert.equal(prepare(r).invoice?.totalCents, 0);
  for (const value of [null, -1, NaN]) { r.state!.final!.lines[0].unitCents = value; assert.equal(prepare(r).invoice, null); }
});
check('corrupt line quantities/totals, duplicate IDs and projection-only lines stop', () => {
  for (const patch of [{ quantityMillis: 0 }, { quantityMillis: 1500.5 }, { unitCents: null }, { totalCents: 1 }, { projectionOnly: true }, { pendingReason: 'missing' }]) {
    const r = fixture(); Object.assign(r.state!.final!.lines[0], patch); assert.equal(prepare(r).invoice, null);
  }
  const r = fixture(); r.state!.final!.lines.push({ ...r.state!.final!.lines[0] }); r.state!.final!.totalCents = 75000;
  assert.equal(prepare(r).invoice, null);
});
check('currency and total inconsistencies block, without relabeling data AWG', () => {
  const r = fixture(); (r.state!.final as unknown as { currency: string }).currency = 'USD'; assert.equal(prepare(r).invoice, null);
  const wrong = fixture(); wrong.state!.final!.totalCents = 100; assert.equal(prepare(wrong).invoice, null);
});
check('active receipts are not aggregated into a new synthetic payment', () => {
  const r = fixture(); r.payments[0].amountCents = 10000;
  r.payments.push({ ...r.payments[0], id: 'receipt-2', amountCents: 15000 }); r.state!.paymentCount = 2;
  const p = prepare(r); assert.deepEqual(p.receipts.map(x => x.amountCents), [10000, 15000]); assert.equal(p.operationalBalanceCents, 12500);
});
check('voided receipts remain excluded, without reducing stored history count', () => {
  const r = fixture(); r.payments.push({ ...r.payments[0], id: 'voided', amountCents: 700, status: 'voided' }); r.state!.paymentCount = 2;
  const p = prepare(r); assert.equal(p.receipts.length, 1); assert.equal(p.voidedReceiptCount, 1); assert.equal(p.receivedCents, 25000);
});
check('duplicate, foreign, malformed and unreferenced receipts stop preparation', () => {
  for (const patch of [{ source: 'other' }, { amountCents: 0 }, { amountCents: -1 }, { receivedAt: 'bad' }, { reference: '' }]) {
    const r = fixture(); Object.assign(r.payments[0], patch); assert.equal(prepare(r).invoice, null);
  }
  const r = fixture(); r.payments.push({ ...r.payments[0] }); r.state!.paymentCount = 2; r.state!.receivedCents = 50000;
  assert.equal(prepare(r).invoice, null);
});
check('receipt sums and complete-history counts must match', () => {
  const r = fixture(); r.state!.receivedCents = 24999; assert.equal(prepare(r).invoice, null);
  const count = fixture(); count.state!.paymentCount = 2; assert.equal(prepare(count).invoice, null);
});
check('overpayment is visible but requires review', () => {
  const r = fixture(); r.payments[0].amountCents = 40000; r.state!.receivedCents = 40000;
  const p = prepare(r); assert.equal(p.operationalBalanceCents, -2500); assert.equal(p.sourceIssues[0].code, 'overpayment'); assert.equal(p.canSend, false);
});
check('missing catalog identity is never filled from a label', () => {
  const r = fixture(); delete r.state!.final!.lines[0].serviceId;
  assert.equal(prepare(r).sourceIssues[0].code, 'article_identity'); assert.equal(prepare(r).invoice?.lines[0].serviceId, '');
});
check('Field reconciliation fingerprint must match the confirmed source', () => {
  const r = fixture(); r.candidateEvidence = { fingerprint: 'new', records: [{ id: 'field', revisionNumber: 1, status: 'approved', lines: [], blockers: [] }] };
  assert.equal(prepare(r).invoice, null); r.state!.final!.candidateEvidence = structuredClone(r.candidateEvidence);
  assert.ok(prepare(r).invoice); r.candidateEvidence.fingerprint = 'changed'; assert.equal(prepare(r).sourceIssues[0].code, 'field_changed');
});
check('fixed configuration blockers are not shared mutable data', () => {
  const p = prepare(fixture()); p.setupIssues[0].message = 'changed'; assert.notEqual(prepare(fixture()).setupIssues[0].message, 'changed');
});
check('malformed Field evidence fails closed without exposing figures', () => {
  for (const invalid of [{ fingerprint: 'test' }, { records: [], fingerprint: null }]) {
    const r = fixture(); r.candidateEvidence = invalid as unknown as NonNullable<ChargeRecord['candidateEvidence']>;
    const p = prepare(r); assert.equal(p.invoice, null); assert.equal(p.sourceIssues[0].code, 'field_evidence');
  }
});
check('diagnostics accept only enumerated names and no provider-controlled text', () => {
  assert.match(reportDiagnosticMessage('invalid-report-response', 'header_end_period'), /fecha de corte/);
  for (const issue of ['private-company-value', '__proto__', 'constructor', {}, null]) assert.equal(reportDiagnosticMessage('invalid-report-response', issue), '');
  assert.equal(reportDiagnosticMessage('owner-required', 'header_end_period'), '');
});
console.log(`${checks} QuickBooks preparation/diagnostic checks passed; no provider requests or writes.`);
