import { callOfficeBookingAuthority } from './office-booking-authority';

export type ChargeLineInput = { id: string; workLineId?: string; presetId?: string; serviceId?: string; label: string; btu?: number | string | null; quantity: number | string; unitPrice?: number | string | null; reason?: string };
export type PaymentMethod = 'cash' | 'transfer' | 'pos' | 'suave';
export type PaymentInput = { method: PaymentMethod; amount: string; reference: string; receivedAt?: string; note?: string };
export type ChargeDraft = { lines: ChargeLineInput[]; quoteToken?: string; note?: string; payment?: PaymentInput | null };
export type ChargeLine = ChargeLineInput & { quantityMillis: number; baseUnitCents: number | null; unitCents: number | null; totalCents: number | null; pendingReason: string; manualPrice: boolean; pricingVersion: string; overrideCents: number | null };
export type ChargeQuote = { lines: ChargeLine[]; totalCents: number | null; knownTotalCents: number; currency: 'AWG'; capturedAt: string; quoteToken: string; note?: string; actor?: { id: string; name: string } };
export type ChargeState = { schemaVersion: 1; version: number; originalEstimate: ChargeQuote | null; estimate: ChargeQuote | null; final: ChargeQuote | null; receivedCents: number; paymentCount: number };
export type AppointmentPayment = { id: string; source: string; amountCents: number; method: PaymentMethod; reference: string; receivedAt: string; createdAt: string; createdByName: string; status: 'recorded' | 'voided'; note?: string; voidReason?: string; voidedAt?: string; voidedByName?: string };
export type ChargeHistory = { id: string; action: string; at: string; actor: { id: string; name: string }; reason?: string; amountCents?: number; after?: ChargeQuote; version: number };
export type ChargeRecord = { success: true; state: ChargeState | null; payments: AppointmentPayment[]; history: ChargeHistory[]; blocker: string; candidateEvidence?: { fingerprint: string; records: { id: string; revisionNumber: number; status: string; lines: { description: string; quantity: number; lineTotal: number }[]; blockers: { message: string }[] }[] }; appointmentStatus: string; workItems?: ChargeLineInput[] };
export const paymentMethods: { id: PaymentMethod; label: string }[] = [{ id: 'cash', label: 'Efectivo' }, { id: 'transfer', label: 'Transferencia' }, { id: 'pos', label: 'POS' }, { id: 'suave', label: 'SUAVE' }];
export const chargeMoney = (cents: number | null | undefined) => cents === null || cents === undefined ? 'Por confirmar' : `Afl. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function chargeInputFromQuote(quote: ChargeQuote | null | undefined): ChargeLineInput[] {
  return (quote?.lines || []).map(line => ({ id: line.id, workLineId: line.workLineId, presetId: line.presetId, serviceId: line.serviceId,
    label: line.label, btu: line.btu, quantity: line.quantityMillis / 1000,
    // Freeze the last agreed price when editing an existing monetary record.
    unitPrice: line.unitCents === null ? '' : (line.unitCents / 100).toFixed(2),
    reason: line.reason || 'Precio conservado del registro anterior' }));
}
export function bookingChargeDraft(seeds: ChargeLineInput[], draft: ChargeDraft | null): ChargeDraft | undefined {
  if (!seeds.length) return undefined;
  const lines = seeds.flatMap<ChargeLineInput>(seed => {
    const saved = draft?.lines.filter(line => line.workLineId === seed.workLineId) || [];
    if (saved.length > 1 && saved.reduce((sum, line) => sum + Number(line.quantity), 0) === Number(seed.quantity)) {
      return saved.map(line => ({ ...line, label: seed.label, presetId: seed.presetId }));
    }
    return [{ ...seed, ...draft?.lines.find(line => line.id === seed.id), quantity: seed.quantity, label: seed.label,
      workLineId: seed.workLineId, presetId: seed.presetId }];
  }).concat(draft?.lines.filter(line => !line.workLineId) || []);
  return { lines, quoteToken: JSON.stringify(lines) === JSON.stringify(draft?.lines) ? draft?.quoteToken : undefined,
    note: draft?.note || '', payment: draft?.payment || null };
}
export function quoteAppointmentCharges(lines: ChargeLineInput[]) { return callOfficeBookingAuthority<{ success: true; quote: ChargeQuote }>('quote_appointment_charges', { lines }); }
export function getAppointmentCharges(appointmentId: string) { return callOfficeBookingAuthority<ChargeRecord>('get_appointment_charges', { appointmentId }); }
export function mutateAppointmentCharges(action: string, data: Record<string, unknown>) { return callOfficeBookingAuthority<{ success: true; state: ChargeState; replayed?: boolean }>(action, data, 20_000); }
export function newChargeRequestId() { return `charge-${crypto.randomUUID()}`; }

export function listChargeServices() { return callOfficeBookingAuthority<{ success: true; services: { id: string; name: string }[] }>('list_charge_services', {}); }
