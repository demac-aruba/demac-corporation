import type { ChargeDraft, ChargeState } from './appointment-charges';

/** An old/mismatched backend must never acknowledge a saved deposit by omission. */
export function initialChargesAcknowledged(appointment: Record<string, unknown> | undefined, input: ChargeDraft | undefined) {
  if (!input) return true;
  const state = appointment?.jobCharges as ChargeState | undefined;
  if (state?.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || state.version < 1 || !state.originalEstimate) return false;
  if (input.quoteToken && state.originalEstimate.quoteToken !== input.quoteToken) return false;
  return !input.payment || state.paymentCount >= 1;
}
