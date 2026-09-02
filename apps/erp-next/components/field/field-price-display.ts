import type { FieldPriceSnapshot } from '@/lib/field-authority';

export function presentedFieldPriceLabel(price: Pick<FieldPriceSnapshot, 'currency' | 'unitPrice'>) {
  const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(price.unitPrice);
  return price.currency === 'AWG' ? `Afl. ${amount}` : `${price.currency} ${amount}`;
}
