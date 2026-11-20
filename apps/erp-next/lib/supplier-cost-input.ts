// Input convenience only: the costing engine still receives one decimal amount.
// Match its existing limits (nine integer digits, two decimals, no grouping).
export function totalSupplierCostInput(raw: string): string {
  if (!raw.includes('+')) return raw;
  if (raw.length > 240) throw new Error('La suma es demasiado larga (máximo 240 caracteres).');
  let cents = 0n;
  for (const part of raw.split('+')) {
    const value = part.trim().replace(',', '.');
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) {
      throw new Error('Completa cada importe separado por +, con hasta 2 decimales y sin separadores de miles.');
    }
    const [whole, fraction = ''] = value.split('.');
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }
  if (cents > 99999999999n) throw new Error('El total no puede superar 999999999.99.');
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}
