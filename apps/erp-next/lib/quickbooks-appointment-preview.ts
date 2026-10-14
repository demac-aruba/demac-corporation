import type { ChargeRecord } from './appointment-charges';

export type PreparationIssue = { code: string; message: string };
export type AppointmentQuickBooksPreview = {
  canSend: false;
  sourceVersion: number | null;
  sourceIssues: PreparationIssue[];
  setupIssues: PreparationIssue[];
  invoice: null | { currency: 'AWG'; totalCents: number; lines: { id: string; serviceId: string; label: string; description: string; quantityMillis: number; unitCents: number; totalCents: number }[] };
  receipts: { id: string; amountCents: number; method: string; reference: string; receivedDate: string }[];
  receivedCents: number | null;
  operationalBalanceCents: number | null;
  voidedReceiptCount: number;
};

const SETUP: PreparationIssue[] = [
  { code: 'company', message: 'Verificar la compañía y la configuración vigente de QuickBooks.' },
  { code: 'customer', message: 'Relacionar el cliente de la cita con su cliente en QuickBooks.' },
  { code: 'catalog', message: 'Relacionar los artículos y verificar cuáles son servicios o productos de inventario.' },
  { code: 'tax', message: 'Confirmar impuestos, moneda y redondeo sin cambiar el importe acordado.' },
  { code: 'accounts', message: 'Relacionar los métodos de cobro con las cuentas de destino.' },
  { code: 'existing', message: 'Comprobar operaciones ya registradas y la fecha de inicio para evitar duplicados.' },
];
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 240;
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

// A read-only projection of the guarded appointment read. It never builds an API
// payload, assumes QBO mappings, changes source records, or authorizes a write.
export function prepareAppointmentQuickBooksPreview(record: ChargeRecord): AppointmentQuickBooksPreview {
  const result: AppointmentQuickBooksPreview = { canSend: false, sourceVersion: null, sourceIssues: [],
    setupIssues: SETUP.map(issue => ({ ...issue })), invoice: null, receipts: [], receivedCents: null,
    operationalBalanceCents: null, voidedReceiptCount: 0 };
  const block = (code: string, message: string) => { result.sourceIssues.push({ code, message }); return result; };
  if (record?.success !== true || record.blocker) return block('reconciliation', 'Los registros de esta cita requieren conciliación antes de preparar la integración.');
  const state = record.state;
  if (!state || state.schemaVersion !== 1 || !integer(state.version)) return block('source_state', 'No hay una versión válida de los importes guardados.');
  result.sourceVersion = state.version;
  if (['cancelled', 'canceled', 'temporary_hold'].includes(record.appointmentStatus)) return block('appointment_status', 'Esta cita no está disponible para preparar una factura.');
  const final = state.final;
  if (!final) return block('final_missing', 'Confirma los trabajos realizados y su importe final antes de preparar la integración.');
  if (final.currency !== 'AWG') return block('currency', 'La moneda requiere revisión; esta primera fase contempla AWG.');
  if (!integer(final.totalCents) || !Array.isArray(final.lines) || !final.lines.length || final.lines.length > 60 ||
    final.lines.some(line => !line || !identity(line.id) || typeof line.label !== 'string' || !line.label.trim() ||
      (line.description != null && (typeof line.description !== 'string' || line.description.length > 1000)) ||
      !integer(line.unitCents) || !integer(line.totalCents) || !integer(line.quantityMillis) || line.quantityMillis === 0 ||
      line.projectionOnly || line.pendingReason || !Number.isSafeInteger(line.unitCents * line.quantityMillis) ||
      Math.round(line.unitCents * line.quantityMillis / 1000) !== line.totalCents) ||
    new Set(final.lines.map(line => line.id)).size !== final.lines.length ||
    final.lines.reduce((sum, line) => sum + line.totalCents!, 0) !== final.totalCents) {
    return block('confirmed_lines', 'Las líneas confirmadas y su total necesitan revisión. No se usan estimaciones ni importes incompletos.');
  }
  const currentEvidence = record.candidateEvidence;
  const savedEvidence = final.candidateEvidence;
  if ([currentEvidence, savedEvidence].some(evidence => evidence != null &&
    (!Array.isArray(evidence.records) || typeof evidence.fingerprint !== 'string'))) {
    return block('field_evidence', 'La evidencia de Field está incompleta y requiere revisión.');
  }
  if ((currentEvidence?.records.length || savedEvidence?.records.length) &&
    (!currentEvidence?.fingerprint || currentEvidence.fingerprint !== savedEvidence?.fingerprint)) {
    return block('field_changed', 'La revisión de Field cambió o falta conciliarla con el cierre confirmado.');
  }
  if (!Array.isArray(record.payments) || record.payments.length > 300 || !integer(state.receivedCents) ||
    !integer(state.paymentCount) || state.paymentCount !== record.payments.length ||
    record.payments.some(payment => !payment || !identity(payment.id) || payment.source !== 'appointment-operational' ||
      !['recorded', 'voided'].includes(payment.status) || !integer(payment.amountCents) || payment.amountCents === 0 ||
      !['cash', 'transfer', 'pos', 'suave'].includes(payment.method) || !validDate(payment.receivedAt) ||
      (payment.method !== 'cash' && (typeof payment.reference !== 'string' || !payment.reference.trim()))) ||
    new Set(record.payments.map(payment => payment.id)).size !== record.payments.length) {
    return block('receipts', 'El historial de pagos necesita revisión antes de mostrar una preparación.');
  }
  const receipts = record.payments.filter(payment => payment.status === 'recorded');
  if (receipts.reduce((sum, payment) => sum + payment.amountCents, 0) !== state.receivedCents) {
    return block('receipt_total', 'El total recibido no coincide con los recibos guardados. Actualiza y concilia los importes.');
  }
  result.invoice = { currency: 'AWG', totalCents: final.totalCents, lines: final.lines.map(line => ({
    id: line.id, serviceId: line.serviceId || '', label: line.label, description: line.description || '', quantityMillis: line.quantityMillis,
    unitCents: line.unitCents!, totalCents: line.totalCents!,
  })) };
  result.receipts = receipts.map(payment => ({ id: payment.id, amountCents: payment.amountCents, method: payment.method,
    reference: payment.reference || '', receivedDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Aruba',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(payment.receivedAt)) }));
  result.receivedCents = state.receivedCents;
  result.operationalBalanceCents = final.totalCents - state.receivedCents;
  result.voidedReceiptCount = record.payments.length - receipts.length;
  if (final.lines.some(line => !identity(line.serviceId))) result.sourceIssues.push({ code: 'article_identity', message: 'Hay conceptos sin artículo canónico relacionado; requieren revisión de catálogo.' });
  if (result.operationalBalanceCents < 0) result.sourceIssues.push({ code: 'overpayment', message: 'Los cobros superan el importe confirmado. El saldo a favor requiere un flujo de revisión.' });
  return result;
}
