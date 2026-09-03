export const browserKeys = {
  customers: 'demac.erp-next.crm.customers.v1',
  customerMaster: (customerId: string) => `demac.erp-next.crm.master.${customerId}.v1`,
  businessSettings: 'demac.erp-next.settings.business-rules.v1',
  appointments: 'demac.erp-next.operations.appointments.v1',
  workOrders: 'demac.erp-next.operations.work-orders.v1',
  fieldExecutions: 'demac.erp-next.field.executions.v1',
  officeReviews: 'demac.erp-next.office.reviews.v1',
  dispatchAssignments: 'demac.erp-next.operations.dispatch-assignments.v2',
  dispatchEvents: 'demac.erp-next.operations.dispatch-events.v1',
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

export function saveBrowserValue<T>(key: string, value: T): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
    return window.localStorage.getItem(key) === serialized;
  } catch {
    // Browser preview persistence must never block the business UI.
    return false;
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
