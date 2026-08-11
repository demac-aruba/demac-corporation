import type { BrowserFieldExecutionRecord } from './browser-field';
import type { BrowserOfficeReviewRecord } from './browser-field';
import type { BrowserWorkOrderRecord } from './browser-operational';
import { BROWSER_WORK_ORDER_SCOPE_KEY, type BrowserWorkOrderScopeRecord } from './browser-workorder-scope';
import { loadBrowserValue } from './browser-store';

export const BROWSER_BILLING_DRAFTS_KEY = 'demac.erp-next.finance.billing-drafts.v1';

export type BillingLineStatus = 'priced' | 'review_required';

export type BrowserBillingLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  amount?: number;
  status: BillingLineStatus;
  source: 'work_order' | 'asset_scope' | 'field_addon';
  note?: string;
};

export type BrowserBillingDraft = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  reviewId: string;
  customerId?: string;
  customer: string;
  site: string;
  status: 'draft' | 'ready_for_qbo';
  currency: 'AWG';
  lines: BrowserBillingLine[];
  knownSubtotal: number;
  pricingComplete: boolean;
  createdAt: string;
  updatedAt: string;
};

const standardServicePriceByCapacity: Record<string, number> = {
  '9000': 100,
  '12000': 125,
  '18000': 135,
  '24000': 145,
  '36000': 175,
};

function normalizeCapacity(value?: string) {
  if (!value) return '';
  return value.replace(/[^0-9]/g, '');
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function scopeForBilling(workOrderId: string) {
  return loadBrowserValue<BrowserWorkOrderScopeRecord[]>(BROWSER_WORK_ORDER_SCOPE_KEY, []).find((scope) => scope.workOrderId === workOrderId);
}

function serviceLines(order: BrowserWorkOrderRecord, scope?: BrowserWorkOrderScopeRecord): BrowserBillingLine[] {
  if (order.presetId !== 'standard_service') {
    return [{
      id: `${order.id}-work`,
      description: order.customerFacingDescription,
      quantity: 1,
      unit: 'job',
      status: 'review_required',
      source: 'work_order',
      note: 'This work type does not yet have a governed ERP price rule. Use the accepted estimate/pricebook before invoice approval.',
    }];
  }

  if (!scope || scope.items.length !== order.totalQuantity) {
    return [{
      id: `${order.id}-scope-required`,
      description: order.customerFacingDescription,
      quantity: order.totalQuantity,
      unit: 'unit',
      status: 'review_required',
      source: 'work_order',
      note: 'Exact HVAC asset scope is required before standard-service pricing can be calculated by BTU.',
    }];
  }

  return scope.items.map((item, index) => {
    const capacityKey = normalizeCapacity(item.capacity);
    const unitPrice = standardServicePriceByCapacity[capacityKey];
    if (!unitPrice) {
      return {
        id: `${order.id}-service-${index + 1}`,
        description: `Standard Service · ${item.name}${item.capacity ? ` · ${item.capacity}` : ''}`,
        quantity: 1,
        unit: 'unit',
        status: 'review_required',
        source: 'asset_scope',
        note: item.capacity ? `No governed standard-service price is configured for ${item.capacity}.` : 'Equipment capacity is missing, so the BTU price cannot be selected safely.',
      } satisfies BrowserBillingLine;
    }
    return {
      id: `${order.id}-service-${index + 1}`,
      description: `Standard Service · ${item.name} · ${item.capacity}`,
      quantity: 1,
      unit: 'unit',
      unitPrice,
      amount: unitPrice,
      status: 'priced',
      source: 'asset_scope',
    } satisfies BrowserBillingLine;
  });
}

function addonLines(order: BrowserWorkOrderRecord, execution?: BrowserFieldExecutionRecord): BrowserBillingLine[] {
  if (!execution) return [];
  const lines: BrowserBillingLine[] = [];
  if (execution.addons.switches > 0) {
    lines.push({ id: `${order.id}-switches`, description: '220V Switch', quantity: execution.addons.switches, unit: 'ea', unitPrice: 75, amount: money(execution.addons.switches * 75), status: 'priced', source: 'field_addon' });
  }
  if (execution.addons.brackets > 0) {
    lines.push({ id: `${order.id}-brackets`, description: 'A/C Bracket', quantity: execution.addons.brackets, unit: 'ea', status: 'review_required', source: 'field_addon', note: 'No governed sell price is configured for brackets in ERP Next yet.' });
  }
  if (execution.addons.armaflex > 0) {
    lines.push({ id: `${order.id}-armaflex`, description: 'Armaflex / Insulation', quantity: execution.addons.armaflex, unit: 'ea', status: 'review_required', source: 'field_addon', note: 'No governed sell price is configured for armaflex in ERP Next yet.' });
  }
  if (execution.addons.refrigerantLb > 0) {
    lines.push({ id: `${order.id}-refrigerant`, description: 'Refrigerant top-up / charge', quantity: execution.addons.refrigerantLb, unit: 'lb', status: 'review_required', source: 'field_addon', note: 'DEMAC pricing is currently documented as starting from Afl. 75; exact sell-price logic by refrigerant/quantity is not configured, so ERP Next does not guess.' });
  }
  return lines;
}

export function buildBillingDraft(order: BrowserWorkOrderRecord, review: BrowserOfficeReviewRecord, execution?: BrowserFieldExecutionRecord): BrowserBillingDraft {
  const scope = scopeForBilling(order.id);
  const lines = [...serviceLines(order, scope), ...addonLines(order, execution)];
  const knownSubtotal = money(lines.reduce((sum, line) => sum + (line.amount ?? 0), 0));
  const pricingComplete = lines.length > 0 && lines.every((line) => line.status === 'priced');
  const now = new Date().toISOString();
  return {
    id: `BILL-${order.id}`,
    workOrderId: order.id,
    appointmentId: order.appointmentId,
    reviewId: review.id,
    customerId: order.customerId,
    customer: order.customer,
    site: order.site,
    status: 'draft',
    currency: 'AWG',
    lines,
    knownSubtotal,
    pricingComplete,
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveApprovedBillingDrafts(orders: BrowserWorkOrderRecord[], reviews: BrowserOfficeReviewRecord[], executions: BrowserFieldExecutionRecord[]) {
  return reviews
    .filter((review) => review.status === 'approved')
    .flatMap((review) => {
      const order = orders.find((candidate) => candidate.id === review.workOrderId);
      if (!order) return [];
      return [buildBillingDraft(order, review, executions.find((execution) => execution.workOrderId === order.id))];
    });
}

export function mergeBillingDrafts(existing: BrowserBillingDraft[], derived: BrowserBillingDraft[]) {
  const map = new Map(existing.map((draft) => [draft.id, draft]));
  for (const draft of derived) {
    const current = map.get(draft.id);
    map.set(draft.id, current?.status === 'ready_for_qbo'
      ? { ...draft, status: 'ready_for_qbo', createdAt: current.createdAt, updatedAt: current.updatedAt }
      : { ...draft, createdAt: current?.createdAt ?? draft.createdAt });
  }
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
