import { loadBrowserCustomerMaster } from './browser-crm';
import type { BrowserWorkOrderRecord } from './browser-operational';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_SITE_ACCESS_PLANS_KEY = 'demac.erp-next.operations.site-access-plans.v1';

export type SiteAccessMethod = 'customer_present' | 'open_access' | 'security_desk' | 'key_or_lockbox' | 'gate_or_credential' | 'other';
export type SensitiveCredentialState = 'not_required' | 'confirmed_securely' | 'missing';

export type BrowserSiteAccessPlan = {
  workOrderId: string;
  method: SiteAccessMethod;
  status: 'not_checked' | 'confirmed' | 'blocked';
  contactName?: string;
  contactPhone?: string;
  instructions?: string;
  sensitiveCredentialState: SensitiveCredentialState;
  updatedAt: string;
  updatedBy: string;
};

export type SiteAccessReadiness = {
  status: 'ready' | 'at_risk' | 'blocked';
  reason: string;
  source: string;
  crmAccessContext?: string;
};

export function loadSiteAccessPlans() {
  return loadBrowserValue<BrowserSiteAccessPlan[]>(BROWSER_SITE_ACCESS_PLANS_KEY, []);
}

export function saveSiteAccessPlan(plan: BrowserSiteAccessPlan) {
  const current = loadSiteAccessPlans();
  const normalized = { ...plan, updatedAt: new Date().toISOString(), updatedBy: 'Operations / Preview' };
  const next = current.some((item) => item.workOrderId === plan.workOrderId)
    ? current.map((item) => item.workOrderId === plan.workOrderId ? normalized : item)
    : [...current, normalized];
  saveBrowserValue(BROWSER_SITE_ACCESS_PLANS_KEY, next);
  return normalized;
}

export function crmAccessContext(order: BrowserWorkOrderRecord) {
  if (!order.customerId) return undefined;
  const master = loadBrowserCustomerMaster(order.customerId);
  const site = (master.sites ?? []).find((item) => item.id === order.siteId || item.name === order.site);
  return site?.access?.trim() || undefined;
}

function methodNeedsCredential(method: SiteAccessMethod) {
  return method === 'key_or_lockbox' || method === 'gate_or_credential';
}

export function deriveSiteAccessReadiness(order: BrowserWorkOrderRecord, plans = loadSiteAccessPlans()): SiteAccessReadiness {
  const plan = plans.find((item) => item.workOrderId === order.id);
  const crmContext = crmAccessContext(order);
  if (!plan || plan.status === 'not_checked') {
    return {
      status: 'at_risk',
      reason: crmContext ? `Site access has not been confirmed for this Work Order. CRM context exists: ${crmContext}` : 'Site access has not been confirmed for this Work Order.',
      source: crmContext ? 'Work Order Access Plan + CRM site context' : 'Work Order Access Plan',
      crmAccessContext: crmContext,
    };
  }

  if (plan.status === 'blocked') {
    return { status: 'blocked', reason: plan.instructions?.trim() ? `Site access is explicitly blocked: ${plan.instructions.trim()}` : 'Site access is explicitly blocked by Operations.', source: `Access Plan · ${plan.updatedBy}`, crmAccessContext: crmContext };
  }

  if (methodNeedsCredential(plan.method)) {
    if (plan.sensitiveCredentialState === 'missing') {
      return { status: 'blocked', reason: 'The selected access method requires a key/credential, but Operations marked that credential as missing.', source: `Access Plan · ${plan.updatedBy}`, crmAccessContext: crmContext };
    }
    if (plan.sensitiveCredentialState !== 'confirmed_securely') {
      return { status: 'at_risk', reason: 'The selected access method requires a key/credential, but secure availability has not been confirmed.', source: `Access Plan · ${plan.updatedBy}`, crmAccessContext: crmContext };
    }
  }

  if (plan.method === 'customer_present' && !plan.contactName?.trim()) {
    return { status: 'at_risk', reason: 'Customer-present access is selected, but the on-site contact has not been identified.', source: `Access Plan · ${plan.updatedBy}`, crmAccessContext: crmContext };
  }

  return { status: 'ready', reason: `Site access confirmed via ${plan.method.replaceAll('_', ' ')}.${plan.contactName?.trim() ? ` On-site contact: ${plan.contactName.trim()}.` : ''}`, source: `Access Plan · ${plan.updatedBy}`, crmAccessContext: crmContext };
}
