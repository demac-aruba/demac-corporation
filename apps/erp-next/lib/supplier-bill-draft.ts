import type { Currency } from './finance';

export type ItemUse = 'product' | 'material' | 'consumable' | 'tool';
export type BillLine = {
  description: string; use: ItemUse; quantity: string; unitCost: string;
  importOverride: string | null; marketing: string; profit: string;
  operations: string; finalPrice: string; confirmed: boolean;
};
export type BillDraft = {
  version: 1; supplier: string; invoiceNumber: string; origin: string;
  currency: Currency; generalImport: string; wire: string; lines: BillLine[];
};

export const MAX_LINES = 100;
export const sellable = (use: ItemUse) => use === 'product' || use === 'material';
export const blankLine = (): BillLine => ({
  description: '', use: 'product', quantity: '1', unitCost: '', importOverride: null,
  marketing: '', profit: '', operations: '', finalPrice: '', confirmed: false,
});
export const blankBill = (): BillDraft => ({
  version: 1, supplier: '', invoiceNumber: '', origin: '', currency: 'USD',
  generalImport: '', wire: '2', lines: [blankLine()],
});

// Decimal text goes straight to minor units. Each displayed charge rounds once,
// half up, per unit. Commas are accepted as decimal separators, never as grouping.
function decimal(raw: string, places: number, label: string): bigint {
  const value = raw.trim().replace(',', '.');
  const [whole, fraction = ''] = value.split('.');
  if (!/^\d{1,9}(?:\.\d+)?$/.test(value) || fraction.length > places) {
    throw new Error('Revisa ' + label + ' (hasta ' + places + ' decimales).');
  }
  return BigInt(whole + fraction.padEnd(places, '0'));
}
function roundedRatio(value: bigint, numerator: bigint, denominator: bigint) {
  return (value * numerator + denominator / 2n) / denominator;
}
export function amount(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents;
  return (cents < 0n ? '−' : '') + (absolute / 100n).toLocaleString('en-US') + '.' + (absolute % 100n).toString().padStart(2, '0');
}

export function purchaseCost(bill: BillDraft, line: BillLine) {
  const cost = decimal(line.unitCost, 2, 'el costo por unidad');
  const fractional = line.use === 'material' || line.use === 'consumable';
  const quantity = decimal(line.quantity, 3, 'la cantidad');
  if (quantity === 0n || (!fractional && quantity % 1000n !== 0n)) throw new Error('Revisa la cantidad para este tipo de artículo.');
  const imported = bill.currency === 'USD';
  const converted = imported ? roundedRatio(cost, 180n, 100n) : cost;
  const wire = imported ? roundedRatio(converted, decimal(bill.wire, 2, 'el wire'), 10000n) : 0n;
  let shipping = 0n;
  if (imported) {
    const general = decimal(bill.generalImport, 2, 'el porcentaje general de importación');
    const rate = line.importOverride === null ? general : decimal(line.importOverride, 2, 'la importación del artículo');
    shipping = roundedRatio(converted + wire, rate, 10000n);
  }
  const landed = converted + wire + shipping;
  return { cost, converted, wire, shipping, landed, supplierTotal: roundedRatio(cost, quantity, 1000n), landedTotal: roundedRatio(landed, quantity, 1000n) };
}

export function saleQuote(landed: bigint, line: BillLine) {
  if (!sellable(line.use)) return null;
  const tax = 700n;
  const marketing = decimal(line.marketing, 2, 'marketing');
  const profit = decimal(line.profit, 2, 'ganancia');
  const operationsTarget = decimal(line.operations, 2, 'operaciones objetivo');
  const costShare = 10000n - tax - marketing - profit - operationsTarget;
  if (costShare <= 0n) throw new Error('Impuesto, marketing, ganancia y operaciones deben sumar menos de 100%.');
  const recommended = roundedRatio(landed, 10000n, costShare);
  if (!line.finalPrice.trim()) return { recommended, allocation: null };
  const price = decimal(line.finalPrice, 2, 'el precio final');
  const taxes = roundedRatio(price, tax, 10000n);
  const marketingFund = roundedRatio(price, marketing, 10000n);
  const profitFund = roundedRatio(price, profit, 10000n);
  return { recommended, allocation: { price, taxes, marketing: marketingFund, profit: profitFund, restock: landed,
    operations: price - landed - taxes - marketingFund - profitFund } };
}

export function evaluateLine(bill: BillDraft, line: BillLine) {
  let cost: ReturnType<typeof purchaseCost> | null = null;
  try {
    cost = purchaseCost(bill, line);
    return { cost, quote: saleQuote(cost.landed, line), error: '' };
  } catch (error) {
    return { cost, quote: null, error: error instanceof Error ? error.message : 'Revisa el artículo.' };
  }
}

export function changeRate(bill: BillDraft, generalImport: string): BillDraft {
  if (generalImport === bill.generalImport) return bill;
  return { ...bill, generalImport, lines: bill.lines.map(line => line.importOverride === null ? { ...line, confirmed: false } : line) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shortText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240;
}

// Allow incomplete drafts. Restore only known fields; a file is never authority
// for catalog pricing. The operator reviews sellable lines again after opening.
export function openDraft(json: string): BillDraft {
  const data: unknown = JSON.parse(json);
  if (!record(data) || data.version !== 1 || (data.currency !== 'USD' && data.currency !== 'AWG')
    || ![data.supplier, data.invoiceNumber, data.origin, data.generalImport, data.wire].every(shortText)
    || !Array.isArray(data.lines) || !data.lines.length || data.lines.length > MAX_LINES) {
    throw new Error('Archivo de borrador inválido.');
  }
  const lines = data.lines.map((row: unknown) => {
    if (!record(row) || (typeof row.use !== 'string' || !['product', 'material', 'consumable', 'tool'].includes(row.use))) throw new Error('Tipo de artículo inválido.');
    const line = blankLine();
    for (const name of ['description', 'quantity', 'unitCost', 'marketing', 'profit', 'operations', 'finalPrice'] as const) {
      const value = row[name];
      if (!shortText(value)) throw new Error('Artículo inválido.');
      line[name] = value;
    }
    if (row.importOverride !== null && !shortText(row.importOverride)) throw new Error('Porcentaje inválido.');
    return { ...line, use: row.use as ItemUse, importOverride: row.importOverride };
  });
  return { version: 1, supplier: String(data.supplier), invoiceNumber: String(data.invoiceNumber),
    origin: String(data.origin), currency: data.currency as Currency, generalImport: String(data.generalImport), wire: String(data.wire), lines };
}
