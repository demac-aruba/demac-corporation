import { BROWSER_INVENTORY_MOVEMENTS_KEY, mergeInventoryMovements, type BrowserInventoryMovement } from './browser-inventory-ledger';
import type { BrowserLocationBalance, InventoryPreviewLocationId } from './browser-inventory-readiness';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_INVENTORY_TRANSFERS_KEY = 'demac.erp-next.inventory.transfers.v1';

export type BrowserInventoryTransferStatus = 'requested' | 'approved' | 'issued' | 'received' | 'cancelled';

export type BrowserInventoryTransferLine = {
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: 'ea' | 'lb';
};

export type BrowserInventoryTransfer = {
  id: string;
  sourceLocationId: InventoryPreviewLocationId;
  destinationLocationId: InventoryPreviewLocationId;
  status: BrowserInventoryTransferStatus;
  lines: BrowserInventoryTransferLine[];
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  issuedBy?: string;
  issuedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
};

function now() {
  return new Date().toISOString();
}

function saveAll(transfers: BrowserInventoryTransfer[]) {
  saveBrowserValue(BROWSER_INVENTORY_TRANSFERS_KEY, transfers);
  return transfers;
}

export function loadBrowserInventoryTransfers() {
  return loadBrowserValue<BrowserInventoryTransfer[]>(BROWSER_INVENTORY_TRANSFERS_KEY, []);
}

export function createBrowserInventoryTransfer(input: {
  sourceLocationId: InventoryPreviewLocationId;
  destinationLocationId: InventoryPreviewLocationId;
  lines: BrowserInventoryTransferLine[];
  requestedBy: string;
}) {
  if (input.sourceLocationId === input.destinationLocationId) throw new Error('Source and destination must be different inventory locations.');
  const lines = input.lines.filter((line) => line.quantity > 0);
  if (!lines.length) throw new Error('At least one positive transfer quantity is required.');
  const stamp = Date.now().toString().slice(-8);
  const transfer: BrowserInventoryTransfer = {
    id: `TR-${stamp}`,
    sourceLocationId: input.sourceLocationId,
    destinationLocationId: input.destinationLocationId,
    status: 'requested',
    lines,
    requestedBy: input.requestedBy.trim() || 'Operations',
    requestedAt: now(),
  };
  const current = loadBrowserInventoryTransfers();
  saveAll([transfer, ...current]);
  return transfer;
}

export function approveBrowserInventoryTransfer(id: string, actor = 'Operations') {
  const current = loadBrowserInventoryTransfers();
  const transfer = current.find((item) => item.id === id);
  if (!transfer || transfer.status !== 'requested') throw new Error('Only requested transfers can be approved.');
  const updated: BrowserInventoryTransfer = { ...transfer, status: 'approved', approvedBy: actor, approvedAt: now() };
  saveAll(current.map((item) => item.id === id ? updated : item));
  return updated;
}

export function validateTransferSourceStock(transfer: BrowserInventoryTransfer, balances: BrowserLocationBalance[]) {
  const shortages = transfer.lines.flatMap((line) => {
    const balance = balances.find((item) => item.locationId === transfer.sourceLocationId && item.itemCode === line.itemCode);
    const current = balance?.current ?? 0;
    return current < line.quantity ? [{ itemCode: line.itemCode, itemName: line.itemName, requested: line.quantity, current, shortage: line.quantity - current }] : [];
  });
  return { allowed: shortages.length === 0, shortages };
}

function transferOutMovements(transfer: BrowserInventoryTransfer, occurredAt: string): BrowserInventoryMovement[] {
  return transfer.lines.map((line) => ({
    id: `MOV-${transfer.id}-OUT-${line.itemCode}`,
    transferId: transfer.id,
    itemCode: line.itemCode,
    itemName: line.itemName,
    quantity: line.quantity,
    unit: line.unit,
    sourceLocation: transfer.sourceLocationId,
    destination: `IN-TRANSIT:${transfer.destinationLocationId}`,
    movementType: 'transfer_out',
    source: 'inventory_transfer',
    occurredAt,
  }));
}

function transferInMovements(transfer: BrowserInventoryTransfer, occurredAt: string): BrowserInventoryMovement[] {
  return transfer.lines.map((line) => ({
    id: `MOV-${transfer.id}-IN-${line.itemCode}`,
    transferId: transfer.id,
    itemCode: line.itemCode,
    itemName: line.itemName,
    quantity: line.quantity,
    unit: line.unit,
    sourceLocation: `IN-TRANSIT:${transfer.sourceLocationId}`,
    destination: transfer.destinationLocationId,
    movementType: 'transfer_in',
    source: 'inventory_transfer',
    occurredAt,
  }));
}

export function issueBrowserInventoryTransfer(id: string, balances: BrowserLocationBalance[], actor = 'Warehouse / Office') {
  const current = loadBrowserInventoryTransfers();
  const transfer = current.find((item) => item.id === id);
  if (!transfer || transfer.status !== 'approved') throw new Error('Only approved transfers can be issued.');
  const validation = validateTransferSourceStock(transfer, balances);
  if (!validation.allowed) {
    const first = validation.shortages[0];
    throw new Error(`${first.itemName} has ${first.current} available at ${transfer.sourceLocationId}; ${first.requested} requested.`);
  }
  const issuedAt = now();
  const updated: BrowserInventoryTransfer = { ...transfer, status: 'issued', issuedBy: actor, issuedAt };
  saveAll(current.map((item) => item.id === id ? updated : item));
  const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  saveBrowserValue(BROWSER_INVENTORY_MOVEMENTS_KEY, mergeInventoryMovements(movements, transferOutMovements(updated, issuedAt)));
  return updated;
}

export function receiveBrowserInventoryTransfer(id: string, actor = 'Receiving location') {
  const current = loadBrowserInventoryTransfers();
  const transfer = current.find((item) => item.id === id);
  if (!transfer || transfer.status !== 'issued') throw new Error('Only issued/in-transit transfers can be received.');
  const receivedAt = now();
  const updated: BrowserInventoryTransfer = { ...transfer, status: 'received', receivedBy: actor, receivedAt };
  saveAll(current.map((item) => item.id === id ? updated : item));
  const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  saveBrowserValue(BROWSER_INVENTORY_MOVEMENTS_KEY, mergeInventoryMovements(movements, transferInMovements(updated, receivedAt)));
  return updated;
}

export function cancelBrowserInventoryTransfer(id: string, actor = 'Operations') {
  const current = loadBrowserInventoryTransfers();
  const transfer = current.find((item) => item.id === id);
  if (!transfer || (transfer.status !== 'requested' && transfer.status !== 'approved')) throw new Error('Only requested or approved transfers can be cancelled before issue.');
  const updated: BrowserInventoryTransfer = { ...transfer, status: 'cancelled', cancelledBy: actor, cancelledAt: now() };
  saveAll(current.map((item) => item.id === id ? updated : item));
  return updated;
}
