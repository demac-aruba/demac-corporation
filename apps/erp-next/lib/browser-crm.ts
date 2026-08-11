import { browserKeys, loadBrowserValue } from './browser-store';

export type BrowserCrmCustomerIdentity = {
  id: string;
  name: string;
  type?: string;
  location?: string;
  phone?: string;
  email?: string;
};

export type BrowserCrmSiteIdentity = {
  id: string;
  name: string;
  address: string;
  sector?: string;
  gac?: string;
  access?: string;
};

export type BrowserCrmAssetIdentity = {
  id: string;
  site: string;
  type: string;
  name: string;
  brand?: string;
  capacity?: string;
  serial?: string;
  status?: string;
};

export type BrowserCustomerMasterSnapshot = {
  contacts?: unknown[];
  sites?: BrowserCrmSiteIdentity[];
  assets?: BrowserCrmAssetIdentity[];
};

export function loadBrowserCrmCustomers(): BrowserCrmCustomerIdentity[] {
  return loadBrowserValue<BrowserCrmCustomerIdentity[]>(browserKeys.customers, []);
}

export function loadBrowserCustomerMaster(customerId: string): BrowserCustomerMasterSnapshot {
  if (!customerId) return { sites: [], assets: [] };
  return loadBrowserValue<BrowserCustomerMasterSnapshot>(browserKeys.customerMaster(customerId), { sites: [], assets: [] });
}

export function sectorFromCrm(customer?: BrowserCrmCustomerIdentity, site?: BrowserCrmSiteIdentity) {
  const allowed = new Set(['Noord', 'Palm Beach', 'Oranjestad', 'Santa Cruz', 'Paradera', 'San Nicolas', 'Savaneta']);
  if (site?.sector && allowed.has(site.sector)) return site.sector;
  if (customer?.location && allowed.has(customer.location)) return customer.location;
  return undefined;
}
