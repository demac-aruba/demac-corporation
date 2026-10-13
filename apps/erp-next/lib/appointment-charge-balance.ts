import type { ChargeQuote, ChargeRecord } from './appointment-charges';

// Projections are planning information only. A draft is a preview, never a
// confirmed debt or a receipt; only the server's recorded payments reduce it.
export function appointmentChargeBalance(record: ChargeRecord, draft?: { quote: ChargeQuote | null; unavailable: boolean }) {
  const state = record.state;
  const validMoney = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const receivedCents = state && validMoney(state.receivedCents) ? state.receivedCents
    : !state && !record.blocker && record.payments.length === 0 ? 0 : null;
  const finalCents = !record.blocker && validMoney(state?.final?.totalCents) ? state!.final!.totalCents! : null;
  const totalCents = record.blocker || draft?.unavailable ? null
    : draft ? validMoney(draft.quote?.totalCents) ? draft.quote!.totalCents : null : finalCents;
  const balanceCents = totalCents !== null && receivedCents !== null ? totalCents - receivedCents : null;
  const confirmedBalance = finalCents !== null && receivedCents !== null ? finalCents - receivedCents : null;
  return { totalCents, receivedCents, balanceCents, estimated: Boolean(draft),
    paymentStatus: record.blocker ? 'Por conciliar' : confirmedBalance === null ? 'Abonos y cobros'
      : confirmedBalance < 0 ? 'A favor' : confirmedBalance === 0 ? '✓ Pagado' : receivedCents ? 'Parcial' : 'Por cobrar',
  };
}
