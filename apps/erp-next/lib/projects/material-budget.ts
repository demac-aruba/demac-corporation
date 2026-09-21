// The existing planning contract is AWG cents. No historical valuation or conversion.
export function materialBudgetInput(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw Error('Invalid material planning estimate.');
  const cents = BigInt(amountMinor);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function parseMaterialBudget(raw: string): { currency: 'AWG'; amountMinor: number } | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 32 || !/^\d+(\.\d{1,2})?$/.test(value)) throw Error('Enter a positive material estimate with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents < 1n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Enter a positive material estimate or leave it blank.');
  return { currency: 'AWG', amountMinor: Number(cents) };
}

export function materialBudgetLabel(budget: { currency: 'AWG'; amountMinor: number }): string {
  const [whole, fraction] = materialBudgetInput(budget.amountMinor).split('.');
  return `${budget.currency} ${new Intl.NumberFormat('en').format(BigInt(whole))}.${fraction}`;
}
