import type { BrowserWorkOrderRecord } from './browser-operational';
import type { WorkPresetId } from './scheduling';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_COMMERCIAL_POLICIES_KEY = 'demac.erp-next.finance.commercial-policies.v1';
export const BROWSER_COMMERCIAL_CLEARANCES_KEY = 'demac.erp-next.finance.commercial-clearances.v1';

export type CommercialClearanceMode = 'no_preclearance' | 'deposit_required' | 'po_required' | 'finance_approval';

export type BrowserCommercialPolicy = {
  presetId: WorkPresetId;
  mode: CommercialClearanceMode;
  reviewed: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type BrowserCommercialClearanceRecord = {
  workOrderId: string;
  mode: CommercialClearanceMode;
  status: 'not_checked' | 'cleared' | 'blocked';
  requiredAmount?: number;
  confirmedAmount?: number;
  paymentEvidenceRef?: string;
  poReference?: string;
  approvalReason?: string;
  approvedBy?: string;
  note?: string;
  updatedAt: string;
};

export type CommercialClearanceReadiness = {
  status: 'ready' | 'at_risk' | 'blocked';
  reason: string;
  source: string;
  policyMode?: CommercialClearanceMode;
};

export function loadCommercialPolicies() {
  return loadBrowserValue<BrowserCommercialPolicy[]>(BROWSER_COMMERCIAL_POLICIES_KEY, []);
}

export function saveCommercialPolicies(policies: BrowserCommercialPolicy[]) {
  const now = new Date().toISOString();
  const next = policies.map((policy) => ({ ...policy, updatedAt: now, updatedBy: 'Finance / Preview' }));
  saveBrowserValue(BROWSER_COMMERCIAL_POLICIES_KEY, next);
  return next;
}

export function loadCommercialClearances() {
  return loadBrowserValue<BrowserCommercialClearanceRecord[]>(BROWSER_COMMERCIAL_CLEARANCES_KEY, []);
}

export function saveCommercialClearance(record: BrowserCommercialClearanceRecord) {
  const current = loadCommercialClearances();
  const normalized = { ...record, updatedAt: new Date().toISOString() };
  const next = current.some((item) => item.workOrderId === record.workOrderId)
    ? current.map((item) => item.workOrderId === record.workOrderId ? normalized : item)
    : [...current, normalized];
  saveBrowserValue(BROWSER_COMMERCIAL_CLEARANCES_KEY, next);
  return normalized;
}

function amount(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

export function deriveCommercialClearanceReadiness(order: BrowserWorkOrderRecord, options?: {
  policies?: BrowserCommercialPolicy[];
  clearances?: BrowserCommercialClearanceRecord[];
}): CommercialClearanceReadiness {
  const policies = options?.policies ?? loadCommercialPolicies();
  const clearances = options?.clearances ?? loadCommercialClearances();
  const policy = policies.find((item) => item.presetId === order.presetId);

  if (!policy || !policy.reviewed) {
    return { status: 'at_risk', reason: `Commercial pre-dispatch policy has not been reviewed for ${order.presetId.replaceAll('_', ' ')}.`, source: 'Commercial Terms Policy', policyMode: policy?.mode };
  }

  if (policy.mode === 'no_preclearance') {
    return { status: 'ready', reason: 'Reviewed Commercial Terms Policy confirms this Work Order type requires no pre-dispatch financial clearance.', source: `Commercial Terms Policy · ${policy.updatedBy}`, policyMode: policy.mode };
  }

  const record = clearances.find((item) => item.workOrderId === order.id);
  if (!record || record.status === 'not_checked') {
    return { status: 'at_risk', reason: `Commercial policy requires ${policy.mode.replaceAll('_', ' ')}, but this Work Order has no completed clearance evidence.`, source: 'Commercial Clearance Record', policyMode: policy.mode };
  }

  if (record.mode !== policy.mode) {
    return { status: 'at_risk', reason: `Commercial policy changed to ${policy.mode.replaceAll('_', ' ')}, while the saved Work Order clearance was prepared as ${record.mode.replaceAll('_', ' ')}. Re-review is required.`, source: 'Commercial Terms Policy + Clearance Record', policyMode: policy.mode };
  }

  if (record.status === 'blocked') {
    return { status: 'blocked', reason: record.note?.trim() ? `Commercial clearance is blocked: ${record.note.trim()}` : 'Commercial clearance is explicitly blocked by Finance.', source: 'Commercial Clearance Record', policyMode: policy.mode };
  }

  if (policy.mode === 'deposit_required') {
    const requiredAmount = amount(record.requiredAmount);
    const confirmedAmount = amount(record.confirmedAmount);
    if (requiredAmount === undefined || requiredAmount <= 0) {
      return { status: 'at_risk', reason: 'Deposit is required, but the required pre-dispatch amount has not been established from an accepted commercial document.', source: 'Commercial Clearance Record', policyMode: policy.mode };
    }
    if (confirmedAmount === undefined) {
      return { status: 'at_risk', reason: `Deposit requirement is Afl. ${requiredAmount.toLocaleString('en-US')}, but no confirmed received amount is recorded.`, source: 'Commercial Clearance Record', policyMode: policy.mode };
    }
    if (confirmedAmount < requiredAmount) {
      return { status: 'blocked', reason: `Confirmed deposit Afl. ${confirmedAmount.toLocaleString('en-US')} is below required Afl. ${requiredAmount.toLocaleString('en-US')}.`, source: 'Commercial Clearance Record', policyMode: policy.mode };
    }
    if (!record.paymentEvidenceRef?.trim()) {
      return { status: 'at_risk', reason: 'Deposit amount is sufficient, but payment/bank evidence reference has not been linked.', source: 'Commercial Clearance Record', policyMode: policy.mode };
    }
    return { status: 'ready', reason: `Deposit clearance satisfied: Afl. ${confirmedAmount.toLocaleString('en-US')} confirmed against required Afl. ${requiredAmount.toLocaleString('en-US')} with evidence ${record.paymentEvidenceRef.trim()}.`, source: 'Commercial Clearance Record', policyMode: policy.mode };
  }

  if (policy.mode === 'po_required') {
    if (!record.poReference?.trim()) {
      return { status: 'blocked', reason: 'Purchase Order is required, but no PO reference is linked to this Work Order.', source: 'Commercial Clearance Record', policyMode: policy.mode };
    }
    return { status: 'ready', reason: `Required PO clearance confirmed with reference ${record.poReference.trim()}.`, source: 'Commercial Clearance Record', policyMode: policy.mode };
  }

  if (!record.approvedBy?.trim() || !record.approvalReason?.trim()) {
    return { status: 'at_risk', reason: 'Finance approval is required, but approver and approval reason are incomplete.', source: 'Commercial Clearance Record', policyMode: policy.mode };
  }
  return { status: 'ready', reason: `Finance approval recorded by ${record.approvedBy.trim()}: ${record.approvalReason.trim()}`, source: 'Commercial Clearance Record', policyMode: policy.mode };
}
