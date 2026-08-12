import { browserKeys, loadBrowserValue } from './browser-store';

export type BrowserCrmCustomerIdentity = {
  id: string;
  name: string;
  legalName?: string;
  type?: 'Residential' | 'Commercial' | 'Enterprise' | string;
  status?: 'lead' | 'active' | 'inactive' | 'on_hold' | string;
  location?: string;
  phone?: string;
  phoneShared?: boolean;
  previousPhones?: string[];
  email?: string;
  preferredLanguage?: 'Papiamento' | 'English' | 'Spanish' | 'Dutch' | string;
  initials?: string;
  since?: string;
  health?: number;
  lifetimeRevenue?: string;
  outstanding?: string;
  openJobs?: number;
  openProposals?: number;
  assets?: number;
  sites?: number;
  maintenance?: 'Active' | 'Due Soon' | 'None' | string;
  nextAction?: string;
};

export type BrowserCrmContactIdentity = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  primary: boolean;
  preferredLanguage?: 'Papiamento' | 'English' | 'Spanish' | 'Dutch' | string;
  sendConfirmationDefault?: boolean;
  sendReminderDefault?: boolean;
  arrivalContact?: boolean;
  billingContact?: boolean;
};

export type BrowserCrmSiteIdentity = {
  id: string;
  name: string;
  address: string;
  addressCanonicalStreet?: string;
  addressHouseNumber?: string;
  addressSource?: 'DEMAC' | 'OpenStreetMap' | 'manual' | 'unknown';
  sector?: string;
  sectorResolution?: 'address' | 'manual' | 'unresolved';
  gac?: string;
  access?: string;
  latitude?: number;
  longitude?: number;
  locationUrl?: string;
  addressConfidence?: 'verified' | 'suggested' | 'unresolved';
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
  contacts?: BrowserCrmContactIdentity[];
  sites?: BrowserCrmSiteIdentity[];
  assets?: BrowserCrmAssetIdentity[];
};

export function loadBrowserCrmCustomers(): BrowserCrmCustomerIdentity[] {
  return loadBrowserValue<BrowserCrmCustomerIdentity[]>(browserKeys.customers, []);
}

export function loadBrowserCustomerMaster(customerId: string): BrowserCustomerMasterSnapshot {
  if (!customerId) return { contacts: [], sites: [], assets: [] };
  return loadBrowserValue<BrowserCustomerMasterSnapshot>(browserKeys.customerMaster(customerId), { contacts: [], sites: [], assets: [] });
}

export function sectorFromCrm(customer?: BrowserCrmCustomerIdentity, site?: BrowserCrmSiteIdentity) {
  const allowed = new Set(['Noord', 'Palm Beach', 'Oranjestad', 'Santa Cruz', 'Paradera', 'San Nicolas', 'Savaneta']);
  if (site?.sector && allowed.has(site.sector)) return site.sector;
  // Legacy records may not yet have a property-level sector. Keep this compatibility
  // fallback until those records are migrated, but new property flows always persist
  // the sector on the property itself.
  if (!site?.sector && customer?.location && allowed.has(customer.location)) return customer.location;
  return undefined;
}
