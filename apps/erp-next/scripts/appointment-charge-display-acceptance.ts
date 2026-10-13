import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChargeRecord, ChargeQuote } from '../lib/appointment-charges';
import { appointmentChargeBalance } from '../lib/appointment-charge-balance';
import { buildAppointmentChargesPdf } from '../lib/appointment-charges-pdf';

const quote: ChargeQuote = { currency: 'AWG', capturedAt: '2026-10-13T15:00:00Z', quoteToken: 'synthetic', totalCents: 37500, knownTotalCents: 37500,
  lines: [{ id: 'service', serviceId: 'std12', label: 'Servicio estándar - 12 mil BTU', btu: 12000, quantity: 3, quantityMillis: 3000, unitCents: 12500, totalCents: 37500, baseUnitCents: 12500, manualPrice: false, pendingReason: '', pricingVersion: 'synthetic', overrideCents: null }] };
const record: ChargeRecord = { success: true, blocker: '', appointmentStatus: 'confirmed', history: [], state: { schemaVersion: 1, version: 2, final: null, originalEstimate: null, estimate: null, receivedCents: 25000, paymentCount: 1 },
  payments: [{ id: 'receipt', source: 'appointment-operational', amountCents: 25000, method: 'transfer', reference: 'PRUEBA-250', receivedAt: '2026-10-13T15:00:00Z', createdAt: '2026-10-13T15:00:00Z', createdByName: 'Oficina de prueba', status: 'recorded' }] };
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
check('missing original and final do not turn a deposit into debt/credit', () => {
  assert.equal(appointmentChargeBalance(record).balanceCents, null);
  assert.equal(appointmentChargeBalance(record).paymentStatus, 'Abonos y cobros');
  const empty = { ...record, state: null, payments: [] };
  assert.equal(appointmentChargeBalance(empty, { quote, unavailable: false }).balanceCents, 37500);
  assert.equal(appointmentChargeBalance({ ...empty, blocker: 'Legacy money' }, { quote, unavailable: false }).balanceCents, null);
});
check('375 draft minus saved 250 is estimated 125, independent of forecast', () => {
  for (const forecast of [null, { ...quote, totalCents: 99999 }]) {
    const value = appointmentChargeBalance({ ...record, state: { ...record.state!, estimate: forecast, originalEstimate: forecast } }, { quote, unavailable: false });
    assert.equal(value.balanceCents, 12500); assert.equal(value.estimated, true); assert.equal(value.paymentStatus, 'Abonos y cobros');
    assert.equal(appointmentChargeBalance({ ...record, state: { ...record.state!, estimate: forecast } }).balanceCents, null);
  }
});
check('loading/error/stale draft never reuses the confirmed or forecast balance', () => {
  for (const draft of [{ quote, unavailable: true }, { quote: null, unavailable: false }, { quote: { ...quote, totalCents: null }, unavailable: false }]) {
    assert.equal(appointmentChargeBalance({ ...record, state: { ...record.state!, final: quote } }, draft).balanceCents, null);
  }
});
const confirmed = { ...record, state: { ...record.state!, final: quote } };
check('confirmed partial, zero, overpayment and exact cents', () => {
  assert.equal(appointmentChargeBalance(confirmed).balanceCents, 12500);
  assert.equal(appointmentChargeBalance(confirmed).paymentStatus, 'Parcial');
  assert.equal(appointmentChargeBalance({ ...confirmed, state: { ...confirmed.state, receivedCents: 37500 } }).paymentStatus, '✓ Pagado');
  assert.equal(appointmentChargeBalance({ ...confirmed, state: { ...confirmed.state, receivedCents: 40000 } }).balanceCents, -2500);
  assert.equal(appointmentChargeBalance(record, { quote: { ...quote, totalCents: 25000 }, unavailable: false }).paymentStatus, 'Abonos y cobros');
  assert.equal(appointmentChargeBalance({ ...confirmed, state: { ...confirmed.state, final: { ...quote, totalCents: 0 }, receivedCents: 0 } }).balanceCents, 0);
  assert.equal(appointmentChargeBalance({ ...confirmed, state: { ...confirmed.state, final: { ...quote, totalCents: 25001 } } }).balanceCents, 1);
});
check('blocked or corrupt values do not invent balances', () => {
  assert.equal(appointmentChargeBalance({ ...confirmed, blocker: 'Reconciliar' }).balanceCents, null);
  assert.equal(appointmentChargeBalance({ ...confirmed, state: { ...confirmed.state, receivedCents: NaN } }).balanceCents, null);
  assert.equal(appointmentChargeBalance({ ...confirmed, state: null }).balanceCents, null);
});
const options = { appointmentId: 'APPOINTMENT-SYNTHETIC', customer: 'Cliente de ejemplo - José Muñoz', dateKey: '2026-10-13', record: confirmed };
const pdf = buildAppointmentChargesPdf(options, '2026-10-13T16:00:00Z');
const source = new TextDecoder().decode(pdf);
check('valid PDF uses only confirmed final and receipt, with no invoice numbering', () => {
  assert.ok(source.startsWith('%PDF-1.4')); assert.ok(source.endsWith('%%EOF'));
  assert.match(source, /Afl\. 375.00/); assert.match(source, /Afl\. 250.00/); assert.match(source, /Afl\. 125.00/);
  assert.match(source, /Comprobante operativo/); assert.match(source, /QuickBooks/); assert.match(source, /PRUEBA-250/);
  assert.doesNotMatch(source, /quoteToken|synthetic-lease|Factura N/);
  const withForecast = buildAppointmentChargesPdf({ ...options, record: { ...confirmed, state: { ...confirmed.state, originalEstimate: { ...quote, totalCents: 99999 }, estimate: { ...quote, totalCents: 99999 } } } }, '2026-10-13T16:00:00Z');
  assert.deepEqual(withForecast, pdf);
});
check('PDF rejects draft, blocker, missing/partial tariff and receipt mismatch', () => {
  for (const bad of [record, { ...confirmed, blocker: 'Legacy invoice' }, { ...confirmed, payments: [] }, { ...confirmed, state: { ...confirmed.state, final: { ...quote, totalCents: null } } }, { ...confirmed, state: { ...confirmed.state, final: { ...quote, lines: [{ ...quote.lines[0], projectionOnly: true }] } } }]) {
    assert.throws(() => buildAppointmentChargesPdf({ ...options, record: bad }), /confirmados y pagos conciliados/);
  }
});
check('voided receipts remain identified without changing recorded total', () => {
  const bytes = buildAppointmentChargesPdf({ ...options, record: { ...confirmed, payments: [...confirmed.payments, { ...confirmed.payments[0], id: 'void', amountCents: 9900, status: 'voided' }] } });
  assert.match(new TextDecoder().decode(bytes), /ANULADO - no incluido en total/);
});
const longQuote = { ...quote, totalCents: 2250000, lines: Array.from({ length: 60 }, (_, index) => ({ ...quote.lines[0], id: `line-${index}`, label: `Concepto ${index + 1}: ${'Servicio de limpieza y mantenimiento con descripción extensa. '.repeat(6)}FIN-${index + 1}` })) };
const longPdf = buildAppointmentChargesPdf({ ...options, customer: 'Cliente de prueba (paréntesis) \\ María «Prueba» 😀', record: { ...confirmed, state: { ...confirmed.state, final: longQuote } } });
check('60 long concepts wrap across pages; special text is escaped, never truncated', () => {
  const value = new TextDecoder().decode(longPdf);
  assert.ok((value.match(/\/Type \/Page /g) || []).length > 1); assert.match(value, /FIN-60/);
  assert.match(value, /Afl\. 22,500.00/); assert.match(value, /U\+1F600/); assert.match(value, /\\\(par/);
});
if (process.env.CHARGE_PDF_TEST_OUTPUT) {
  mkdirSync(process.env.CHARGE_PDF_TEST_OUTPUT, { recursive: true });
  writeFileSync(join(process.env.CHARGE_PDF_TEST_OUTPUT, 'confirmed-charges.pdf'), pdf);
  writeFileSync(join(process.env.CHARGE_PDF_TEST_OUTPUT, 'long-confirmed-charges.pdf'), longPdf);
}
console.log(`${checks} appointment balance/PDF checks passed; no network or production data.`);
