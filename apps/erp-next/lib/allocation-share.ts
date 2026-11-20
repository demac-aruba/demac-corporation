import { amount as formatHundredths } from '../../../functions/supplierBillCosting.js';

export function allocationShare(amount: bigint, salePrice: bigint): string {
  if (salePrice <= 0n) return '—';

  // Round the magnitude to the nearest hundredth of a percent before applying its sign.
  const magnitude = amount < 0n ? -amount : amount;
  const hundredths = (magnitude * 10000n + salePrice / 2n) / salePrice;
  return formatHundredths(amount < 0n ? -hundredths : hundredths) + '%';
}
