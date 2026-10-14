import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChargeLineInput, ChargeRecord, ChargeQuote } from '../lib/appointment-charges';
import { appointmentChargeBalance } from '../lib/appointment-charge-balance';
import { chargeQuantityMillis, previewChargeQuote, rememberChargePrices } from '../lib/appointment-charge-preview';
import { buildAppointmentChargesPdf } from '../lib/appointment-charges-pdf';

const quote: ChargeQuote = { currency: 'AWG', capturedAt: '2026-10-13T15:00:00Z', quoteToken: 'synthetic', totalCents: 37500, knownTotalCents: 37500,
  lines: [{ id: 'service', serviceId: 'std12', label: 'Servicio estándar - 12 mil BTU', description: 'Limpieza interior y exterior de sala', btu: 12000, quantity: 3, quantityMillis: 3000, unitCents: 12500, totalCents: 37500, baseUnitCents: 12500, manualPrice: false, pendingReason: '', pricingVersion: 'synthetic', overrideCents: null }] };
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
check('instant preview matches server decimal limits, rounding and totals without a token', () => {
  const input: ChargeLineInput = { id: 'service', serviceId: 'std12', label: '12k', quantity: 3 };
  const prices = rememberChargePrices(new Map(), [input], quote);
  for (const [quantity, expected] of [[1, 12500], ['1.333', 16663], ['0.001', 13], ['0002.5', 31250]] as const) {
    const preview = previewChargeQuote([{ ...input, quantity }], prices)!;
    assert.equal(preview.totalCents, expected); assert.equal(preview.quoteToken, '');
    assert.equal(preview.lines[0].unitCents, 12500);
  }
  for (const quantity of ['', 0, -1, '1.', '1e3', '1,5', '0.0001', '10000.001', NaN, Infinity]) {
    assert.equal(chargeQuantityMillis(quantity), null);
    assert.equal(previewChargeQuote([{ ...input, quantity }], prices)!.totalCents, null);
  }
  assert.equal(chargeQuantityMillis(10000), 10000000);
  assert.equal(previewChargeQuote([{ ...input, quantity: 10000 }], prices)!.totalCents, null, 'Per-appointment maximum is enforced');
  assert.equal(previewChargeQuote([input, input], prices)!.totalCents, null, 'Duplicate identities are invalid');
  assert.equal(previewChargeQuote([], prices), null);
});
check('preview identity, repeated catalog selection and agreed price isolation', () => {
  const input: ChargeLineInput = { id: 'service', serviceId: 'std12', label: '12k', quantity: 1 };
  const prices = rememberChargePrices(new Map(), [input], quote);
  assert.equal(previewChargeQuote([{ ...input, id: 'another' }], prices)!.totalCents, 12500);
  for (const changed of [{ serviceId: 'std18' }, { btu: 18000 }, { workLineId: 'other' }, { presetId: 'deep_cleaning' }, { unitPrice: '20' }]) {
    assert.equal(previewChargeQuote([{ ...input, ...changed }], prices)!.totalCents, null);
  }
  for (const protection of [{ retainedPrice: true }, { manualPrice: true }, { projectionOnly: true }]) {
    const guarded = rememberChargePrices(new Map(), [input], { ...quote, lines: [{ ...quote.lines[0], ...protection }] });
    assert.equal(previewChargeQuote([{ ...input, id: 'another' }], guarded)!.totalCents, null);
    assert.equal(previewChargeQuote([input], guarded)!.lines[0].unitCents, 12500);
  }
});
check('partial preview never invents a full total and missing tariff replaces known rate', () => {
  const input: ChargeLineInput = { id: 'service', serviceId: 'std12', label: '12k', quantity: 1 };
  const prices = rememberChargePrices(new Map(), [input], quote);
  const partial = previewChargeQuote([input, { ...input, id: 'unknown', serviceId: 'unknown' }], prices)!;
  assert.equal(partial.lines.length, 1); assert.equal(partial.knownTotalCents, 12500); assert.equal(partial.totalCents, null);
  const unavailable = rememberChargePrices(prices, [input], { ...quote, lines: [{ ...quote.lines[0], unitCents: null, totalCents: null }] });
  assert.equal(previewChargeQuote([input], unavailable)!.totalCents, null);
  assert.equal(previewChargeQuote([{ ...input, id: 'new' }], unavailable)!.totalCents, null);
  let bounded = prices;
  for (let n = 0; n < 200; n++) bounded = rememberChargePrices(bounded, [{ ...input, id: 'n' + n }], { ...quote, lines: [{ ...quote.lines[0], id: 'n' + n }] });
  assert.ok(bounded.size <= 180);
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
  assert.match(source, /Limpieza interior y exterior de sala/);assert.match(source, /Comprobante operativo/); assert.match(source, /QuickBooks/); assert.match(source, /PRUEBA-250/);
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
const longQuote = { ...quote, totalCents: 2250000, lines: Array.from({ length: 60 }, (_, index) => ({ ...quote.lines[0], id: `line-${index}`, description: 'Detalle extenso '.repeat(60) + `DESC-${index + 1}`, label: `Concepto ${index + 1}: ${'Servicio de limpieza y mantenimiento con descripción extensa. '.repeat(6)}FIN-${index + 1}` })) };
const longPdf = buildAppointmentChargesPdf({ ...options, customer: 'Cliente de prueba (paréntesis) \\ María «Prueba» 😀', record: { ...confirmed, state: { ...confirmed.state, final: longQuote } } });
check('60 long concepts wrap across pages; special text is escaped, never truncated', () => {
  const value = new TextDecoder().decode(longPdf);
  assert.ok((value.match(/\/Type \/Page /g) || []).length > 1); assert.match(value, /FIN-60/);assert.match(value,/DESC-60/);
  assert.match(value, /Afl\. 22,500.00/); assert.match(value, /U\+1F600/); assert.match(value, /\\\(par/);
});
check('continuation appointment reference is above the table background', () => {
  const value = new TextDecoder().decode(longPdf);
  const matches = [...value.matchAll(/1 0 0 1 36 ([\d.]+) Tm \(Cita:[^\n]+\n[\s\S]*?0\.93 0\.96 1 rg 36 ([\d.]+) 523 24 re f/g)];
  assert.ok(matches.length > 1);
  for (const match of matches) assert.ok(Number(match[1]) > Number(match[2]) + 26, 'Table fill cannot cover the appointment reference');
});
if (process.env.CHARGE_PDF_TEST_OUTPUT) {
  mkdirSync(process.env.CHARGE_PDF_TEST_OUTPUT, { recursive: true });
  writeFileSync(join(process.env.CHARGE_PDF_TEST_OUTPUT, 'confirmed-charges.pdf'), pdf);
  writeFileSync(join(process.env.CHARGE_PDF_TEST_OUTPUT, 'long-confirmed-charges.pdf'), longPdf);
}
console.log(`${checks} appointment balance/PDF checks passed; no network or production data.`);
