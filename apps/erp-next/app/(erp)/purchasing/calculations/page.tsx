import type { Metadata } from 'next';
import { PriceCalculator } from '../../../../components/finance/price-calculator';

export const metadata: Metadata = { title: 'Cálculo de precios | DEMAC ERP' };

export default function PriceCalculationsPage() {
  return <PriceCalculator />;
}
