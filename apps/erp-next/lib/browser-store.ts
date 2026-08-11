export const browserKeys = {
  customers: 'demac.erp-next.crm.customers.v1',
  customerMaster: (customerId: string) => `demac.erp-next.crm.master.${customerId}.v1`,
  businessSettings: 'demac.erp-next.settings.business-rules.v1',
} as const;

export function loadBrowserValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveBrowserValue<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser preview persistence must never block the business UI.
  }
}

export function removeBrowserValue(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Intentionally ignored for preview-only storage.
  }
}
