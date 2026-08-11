import type { BrowserLocationBalance, InventoryPreviewLocationId } from './browser-inventory-readiness';
import { loadBrowserInventoryTransfers, type BrowserInventoryTransfer } from './browser-inventory-transfers';

export type ReplenishmentPriority = 'critical' | 'warning' | 'routine';
export type ReplenishmentAction = 'transfer' | 'purchase_required';

export type BrowserReplenishmentSuggestion = {
  id: string;
  action: ReplenishmentAction;
  priority: ReplenishmentPriority;
  itemCode: string;
  itemName: string;
  unit: 'ea' | 'lb';
  destinationLocationId: Exclude<InventoryPreviewLocationId, 'WH-MAIN'>;
  sourceLocationId?: InventoryPreviewLocationId;
  current: number;
  effectiveCurrent: number;
  minimum: number;
  par: number;
  deficitToPar: number;
  suggestedQuantity: number;
  remainingUncovered: number;
  reason: string;
};

function openTransferQuantity(transfers: BrowserInventoryTransfer[], args: { itemCode: string; locationId: InventoryPreviewLocationId; direction: 'in' | 'out' }) {
  return transfers
    .filter((transfer) => transfer.status === 'requested' || transfer.status === 'approved' || transfer.status === 'issued')
    .filter((transfer) => args.direction === 'in' ? transfer.destinationLocationId === args.locationId : transfer.sourceLocationId === args.locationId)
    .flatMap((transfer) => transfer.lines)
    .filter((line) => line.itemCode === args.itemCode)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function priorityFor(line: BrowserLocationBalance, effectiveCurrent: number): ReplenishmentPriority {
  if (effectiveCurrent <= 0 && line.essentialForVanReadiness) return 'critical';
  if (effectiveCurrent < line.minimum) return 'warning';
  return 'routine';
}

function donorFloor(line: BrowserLocationBalance) {
  return line.locationId === 'WH-MAIN' ? line.minimum : line.par;
}

export function buildBrowserReplenishmentSuggestions(balances: BrowserLocationBalance[], transfers = loadBrowserInventoryTransfers()) {
  const vans = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'] as const;
  const suggestions: BrowserReplenishmentSuggestion[] = [];
  const committedFromSource = new Map<string, number>();

  const targets = balances
    .filter((line) => vans.includes(line.locationId as (typeof vans)[number]))
    .map((line) => {
      const plannedIncoming = openTransferQuantity(transfers, { itemCode: line.itemCode, locationId: line.locationId, direction: 'in' });
      return { line, plannedIncoming, effectiveCurrent: line.current + plannedIncoming };
    })
    .filter(({ line, effectiveCurrent }) => effectiveCurrent < line.par)
    .sort((a, b) => {
      const priorityRank = { critical: 0, warning: 1, routine: 2 } as const;
      const aRank = priorityRank[priorityFor(a.line, a.effectiveCurrent)];
      const bRank = priorityRank[priorityFor(b.line, b.effectiveCurrent)];
      return aRank - bRank || (a.effectiveCurrent / Math.max(1, a.line.par)) - (b.effectiveCurrent / Math.max(1, b.line.par));
    });

  for (const target of targets) {
    let remaining = Math.max(0, target.line.par - target.effectiveCurrent);
    const priority = priorityFor(target.line, target.effectiveCurrent);
    const donorCandidates = balances
      .filter((line) => line.itemCode === target.line.itemCode && line.locationId !== target.line.locationId)
      .map((line) => {
        const plannedOutbound = openTransferQuantity(transfers, { itemCode: line.itemCode, locationId: line.locationId, direction: 'out' });
        const key = `${line.locationId}:${line.itemCode}`;
        const internallyCommitted = committedFromSource.get(key) ?? 0;
        const free = Math.max(0, line.current - donorFloor(line) - plannedOutbound - internallyCommitted);
        return { line, free, key };
      })
      .filter((candidate) => candidate.free > 0)
      .sort((a, b) => {
        if (a.line.locationId === 'WH-MAIN' && b.line.locationId !== 'WH-MAIN') return -1;
        if (a.line.locationId !== 'WH-MAIN' && b.line.locationId === 'WH-MAIN') return 1;
        return b.free - a.free;
      });

    for (const donor of donorCandidates) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, donor.free);
      if (quantity <= 0) continue;
      suggestions.push({
        id: `REPL-${target.line.locationId}-${target.line.itemCode}-${donor.line.locationId}`,
        action: 'transfer',
        priority,
        itemCode: target.line.itemCode,
        itemName: target.line.itemName,
        unit: target.line.unit,
        destinationLocationId: target.line.locationId as Exclude<InventoryPreviewLocationId, 'WH-MAIN'>,
        sourceLocationId: donor.line.locationId,
        current: target.line.current,
        effectiveCurrent: target.effectiveCurrent,
        minimum: target.line.minimum,
        par: target.line.par,
        deficitToPar: target.line.par - target.effectiveCurrent,
        suggestedQuantity: quantity,
        remainingUncovered: Math.max(0, remaining - quantity),
        reason: donor.line.locationId === 'WH-MAIN' ? 'Warehouse can replenish without falling below its configured minimum.' : `${donor.line.locationId} has surplus above par after existing transfer commitments.`,
      });
      committedFromSource.set(donor.key, (committedFromSource.get(donor.key) ?? 0) + quantity);
      remaining -= quantity;
    }

    if (remaining > 0) {
      suggestions.push({
        id: `REPL-${target.line.locationId}-${target.line.itemCode}-PURCHASE`,
        action: 'purchase_required',
        priority,
        itemCode: target.line.itemCode,
        itemName: target.line.itemName,
        unit: target.line.unit,
        destinationLocationId: target.line.locationId as Exclude<InventoryPreviewLocationId, 'WH-MAIN'>,
        current: target.line.current,
        effectiveCurrent: target.effectiveCurrent,
        minimum: target.line.minimum,
        par: target.line.par,
        deficitToPar: target.line.par - target.effectiveCurrent,
        suggestedQuantity: remaining,
        remainingUncovered: remaining,
        reason: 'No internal location has enough safe surplus to cover the remaining replenishment without violating its own minimum/par policy.',
      });
    }
  }

  return suggestions;
}
