import type { BrowserReplenishmentSuggestion, ReplenishmentPriority } from './browser-inventory-replenishment';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_PURCHASE_REQUIREMENTS_KEY = 'demac.erp-next.purchasing.requirements.v1';

export type PurchaseRequirementStatus = 'open' | 'reviewed' | 'approved_for_sourcing' | 'closed' | 'cancelled';

export type PurchaseDemandLocation = {
  locationId: string;
  quantity: number;
};

export type BrowserPurchaseRequirement = {
  id: string;
  itemCode: string;
  itemName: string;
  unit: 'ea' | 'lb';
  quantityRequested: number;
  demandLocations: PurchaseDemandLocation[];
  priority: ReplenishmentPriority;
  status: PurchaseRequirementStatus;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  closedAt?: string;
  note?: string;
};

export type AggregatedPurchaseNeed = {
  id: string;
  itemCode: string;
  itemName: string;
  unit: 'ea' | 'lb';
  totalQuantity: number;
  demandLocations: PurchaseDemandLocation[];
  priority: ReplenishmentPriority;
  reason: string;
};

const priorityRank: Record<ReplenishmentPriority, number> = { critical: 0, warning: 1, routine: 2 };

export function aggregatePurchaseNeeds(suggestions: BrowserReplenishmentSuggestion[]): AggregatedPurchaseNeed[] {
  const grouped = new Map<string, AggregatedPurchaseNeed>();
  for (const suggestion of suggestions.filter((item) => item.action === 'purchase_required' && item.suggestedQuantity > 0)) {
    const current = grouped.get(suggestion.itemCode);
    if (!current) {
      grouped.set(suggestion.itemCode, {
        id: `PURCHASE-NEED-${suggestion.itemCode}`,
        itemCode: suggestion.itemCode,
        itemName: suggestion.itemName,
        unit: suggestion.unit,
        totalQuantity: suggestion.suggestedQuantity,
        demandLocations: [{ locationId: suggestion.destinationLocationId, quantity: suggestion.suggestedQuantity }],
        priority: suggestion.priority,
        reason: suggestion.reason,
      });
      continue;
    }
    current.totalQuantity += suggestion.suggestedQuantity;
    current.demandLocations.push({ locationId: suggestion.destinationLocationId, quantity: suggestion.suggestedQuantity });
    if (priorityRank[suggestion.priority] < priorityRank[current.priority]) current.priority = suggestion.priority;
  }
  return [...grouped.values()].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.itemName.localeCompare(b.itemName));
}

export function loadBrowserPurchaseRequirements() {
  return loadBrowserValue<BrowserPurchaseRequirement[]>(BROWSER_PURCHASE_REQUIREMENTS_KEY, []);
}

function saveRequirements(requirements: BrowserPurchaseRequirement[]) {
  saveBrowserValue(BROWSER_PURCHASE_REQUIREMENTS_KEY, requirements);
  return requirements;
}

export function openRequirementForItem(itemCode: string, requirements = loadBrowserPurchaseRequirements()) {
  return requirements.find((requirement) => requirement.itemCode === itemCode && requirement.status !== 'closed' && requirement.status !== 'cancelled');
}

export function createPurchaseRequirement(need: AggregatedPurchaseNeed, actor = 'Operations') {
  const existing = loadBrowserPurchaseRequirements();
  const open = openRequirementForItem(need.itemCode, existing);
  if (open) throw new Error(`${need.itemName} already has open purchase requirement ${open.id}.`);
  const requirement: BrowserPurchaseRequirement = {
    id: `PRQ-${Date.now().toString().slice(-8)}`,
    itemCode: need.itemCode,
    itemName: need.itemName,
    unit: need.unit,
    quantityRequested: need.totalQuantity,
    demandLocations: need.demandLocations,
    priority: need.priority,
    status: 'open',
    reason: need.reason,
    requestedBy: actor,
    requestedAt: new Date().toISOString(),
  };
  saveRequirements([requirement, ...existing]);
  return requirement;
}

export function advancePurchaseRequirement(id: string, actor = 'Operations') {
  const current = loadBrowserPurchaseRequirements();
  const requirement = current.find((item) => item.id === id);
  if (!requirement) throw new Error('Purchase requirement not found.');
  const now = new Date().toISOString();
  let updated: BrowserPurchaseRequirement;
  if (requirement.status === 'open') updated = { ...requirement, status: 'reviewed', reviewedBy: actor, reviewedAt: now };
  else if (requirement.status === 'reviewed') updated = { ...requirement, status: 'approved_for_sourcing', approvedBy: actor, approvedAt: now };
  else throw new Error('This requirement has no next review step in Purchasing Readiness.');
  saveRequirements(current.map((item) => item.id === id ? updated : item));
  return updated;
}

export function cancelPurchaseRequirement(id: string, actor = 'Operations') {
  const current = loadBrowserPurchaseRequirements();
  const requirement = current.find((item) => item.id === id);
  if (!requirement || requirement.status === 'closed' || requirement.status === 'cancelled') throw new Error('Purchase requirement cannot be cancelled from its current state.');
  if (requirement.status === 'approved_for_sourcing') throw new Error('Approved-for-sourcing requirements require a governed reversal/closure reason rather than silent cancellation.');
  const updated: BrowserPurchaseRequirement = { ...requirement, status: 'cancelled', note: `Cancelled by ${actor}`, closedAt: new Date().toISOString() };
  saveRequirements(current.map((item) => item.id === id ? updated : item));
  return updated;
}
