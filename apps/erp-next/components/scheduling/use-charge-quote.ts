'use client';

import { useEffect, useMemo, useState } from 'react';
import { quoteAppointmentCharges, type ChargeLineInput, type ChargeQuote } from '../../lib/appointment-charges';
import { previewChargeQuote, rememberChargePrices, type ChargePriceCache } from '../../lib/appointment-charge-preview';

type QuoteResult = { key: string; scope: string; quote: ChargeQuote | null; error: string; loading: boolean; prices: ChargePriceCache };
export function useChargeQuote(lines: ChargeLineInput[], revision = 0, appointmentId?: string, expectedVersion?: number, purpose: 'projection' | 'final' = 'final') {
  // Descriptions are invoice text, not tariff inputs.
  const signature = JSON.stringify(lines.map(({ description: _description, ...line }) => line));
  const scope = JSON.stringify([revision, appointmentId, expectedVersion, purpose]);
  const key = JSON.stringify([signature, scope]);
  const [result, setResult] = useState<QuoteResult>({ key: '', scope: '', quote: null, error: '', loading: false, prices: new Map() });
  useEffect(() => {
    let active = true;
    const inputs: ChargeLineInput[] = JSON.parse(signature);
    setResult(previous => ({ key, scope, quote: null, error: '', loading: Boolean(inputs.length), prices: previous.scope === scope ? previous.prices : new Map() }));
    if (!inputs.length) return;
    // Coalesce rapid typing without delaying the display calculation.
    const timer = window.setTimeout(() => {
      void quoteAppointmentCharges(inputs, appointmentId ? { appointmentId, expectedVersion: expectedVersion ?? 0 } : undefined, purpose).then(response => {
        if (active) setResult(previous => ({ key, scope, quote: response.quote, error: '', loading: false,
          prices: rememberChargePrices(previous.scope === scope ? previous.prices : new Map(), inputs, response.quote) }));
      }).catch(cause => {
        if (active) setResult({ key, scope, quote: null, error: cause instanceof Error ? cause.message : 'No se pudo consultar el precio.', loading: false, prices: new Map() });
      });
    }, purpose === 'final' ? 150 : 300);
    return () => { active = false; window.clearTimeout(timer); };
    // Immutable signature scopes requests; cleanup rejects every superseded response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, scope]);
  const current = result.key === key;
  const quote = current ? result.quote : null;
  const error = current ? result.error : '';
  const loading = current ? result.loading : Boolean(lines.length);
  const preview = useMemo(() => purpose === 'final' && result.scope === scope && !error
    ? previewChargeQuote(JSON.parse(signature), result.prices) : null, [purpose, scope, signature, result.scope, result.prices, error]);
  // Only quote has an authority-issued token for this exact input. displayQuote
  // can be a partial provisional calculation and must never enable confirmation.
  return { quote, displayQuote: quote || preview, error, loading };
}
