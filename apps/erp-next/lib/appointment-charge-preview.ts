import type { ChargeLine, ChargeLineInput, ChargeQuote } from './appointment-charges';

// Ephemeral display evidence only. Never persist it, issue a quote token from it,
// or send these calculated amounts to the write authority.
export type ChargePriceCache = Map<string, ChargeLine>;
const priceKey = (line: ChargeLineInput, exact: boolean) => JSON.stringify([
  exact ? line.id : '', line.serviceId || '', line.presetId || '', line.workLineId || '',
  line.btu ?? '', line.unitPrice ?? '',
]);
const shareable = (line: ChargeLineInput) => Boolean(line.serviceId) && !line.workLineId && !line.presetId
  && (line.unitPrice === undefined || line.unitPrice === null || line.unitPrice === '');

export function rememberChargePrices(previous: ChargePriceCache, inputs: ChargeLineInput[], quote: ChargeQuote): ChargePriceCache {
  const next = new Map(previous), byId = new Map(quote.lines.map(line => [line.id, line]));
  for (const input of inputs) {
    const priced = byId.get(input.id);
    if (!priced) continue;
    next.set(priceKey(input, true), priced);
    // A previous agreement belongs to its line. Only a fresh canonical catalog
    // rate may be reused to preview another selection of that same item.
    if (shareable(input) && !priced.retainedPrice && !priced.manualPrice && !priced.projectionOnly) next.set(priceKey(input, false), priced);
  }
  while (next.size > 180) next.delete(next.keys().next().value!);
  return next;
}

export function chargeQuantityMillis(value: number | string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const millis = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(millis) && millis > 0 && millis <= 10000000 ? millis : null;
}

export function previewChargeQuote(inputs: ChargeLineInput[], prices: ChargePriceCache): ChargeQuote | null {
  if (!inputs.length) return null;
  const lines: ChargeLine[] = [];
  for (const input of inputs) {
    const priced = prices.get(priceKey(input, true)) || (shareable(input) ? prices.get(priceKey(input, false)) : undefined);
    if (!priced) continue;
    const quantityMillis = chargeQuantityMillis(input.quantity);
    const validPrice = Number.isSafeInteger(priced.unitCents) && priced.unitCents !== null && priced.unitCents >= 0 && priced.unitCents <= 100000000;
    lines.push({ ...priced, id: input.id, quantity: input.quantity, quantityMillis: quantityMillis ?? 0,
      totalCents: validPrice && quantityMillis !== null ? Math.round(priced.unitCents! * quantityMillis / 1000) : null });
  }
  const knownTotalCents = lines.reduce((total, line) => total + (line.totalCents ?? 0), 0);
  const complete = lines.length === inputs.length && lines.every(line => line.totalCents !== null)
    && new Set(inputs.map(line => line.id)).size === inputs.length && inputs.length <= 60
    && Number.isSafeInteger(knownTotalCents) && knownTotalCents <= 100000000;
  return { lines, totalCents: complete ? knownTotalCents : null, knownTotalCents, currency: 'AWG', capturedAt: '', quoteToken: '' };
}
