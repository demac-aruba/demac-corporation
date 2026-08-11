import type { BrowserFieldExecutionRecord } from './browser-field';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, deriveFieldConsumption, mergeInventoryMovements, type BrowserInventoryMovement } from './browser-inventory-ledger';
import type { BrowserWorkOrderRecord } from './browser-operational';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_INVENTORY_OPENING_KEY = 'demac.erp-next.inventory.opening-balances.v1';

export type InventoryPreviewLocationId = 'WH-MAIN' | 'VAN-1' | 'VAN-2' | 'VAN-3' | 'VAN-4';

export type BrowserInventoryOpeningBalance = {
  locationId: InventoryPreviewLocationId;
  itemCode: string;
  itemName: string;
  unit: 'ea' | 'lb';
  openingQuantity: number;
  minimum: number;
  par: number;
  target: number;
  essentialForVanReadiness: boolean;
};

export type BrowserLocationBalance = BrowserInventoryOpeningBalance & {
  consumed: number;
  current: number;
  status: 'ok' | 'low' | 'empty';
};

export type BrowserVanReadiness = {
  locationId: Exclude<InventoryPreviewLocationId, 'WH-MAIN'>;
  status: 'ready' | 'at_risk' | 'blocked';
  lowLines: BrowserLocationBalance[];
  emptyEssentialLines: BrowserLocationBalance[];
  currentLines: BrowserLocationBalance[];
};

const previewOpeningBalances: BrowserInventoryOpeningBalance[] = [
  { locationId: 'WH-MAIN', itemCode: 'SW-220V', itemName: '220V Switch', unit: 'ea', openingQuantity: 68, minimum: 30, par: 80, target: 100, essentialForVanReadiness: false },
  { locationId: 'WH-MAIN', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', unit: 'lb', openingQuantity: 41, minimum: 20, par: 45, target: 60, essentialForVanReadiness: false },
  { locationId: 'WH-MAIN', itemCode: 'BRACKET', itemName: 'A/C Bracket', unit: 'ea', openingQuantity: 16, minimum: 6, par: 16, target: 24, essentialForVanReadiness: false },
  { locationId: 'WH-MAIN', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', unit: 'ea', openingQuantity: 40, minimum: 15, par: 35, target: 50, essentialForVanReadiness: false },

  { locationId: 'VAN-1', itemCode: 'SW-220V', itemName: '220V Switch', unit: 'ea', openingQuantity: 10, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-1', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', unit: 'lb', openingQuantity: 9, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-1', itemCode: 'BRACKET', itemName: 'A/C Bracket', unit: 'ea', openingQuantity: 4, minimum: 2, par: 4, target: 6, essentialForVanReadiness: false },
  { locationId: 'VAN-1', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', unit: 'ea', openingQuantity: 12, minimum: 6, par: 12, target: 16, essentialForVanReadiness: false },

  { locationId: 'VAN-2', itemCode: 'SW-220V', itemName: '220V Switch', unit: 'ea', openingQuantity: 3, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-2', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', unit: 'lb', openingQuantity: 6, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-2', itemCode: 'BRACKET', itemName: 'A/C Bracket', unit: 'ea', openingQuantity: 2, minimum: 2, par: 4, target: 6, essentialForVanReadiness: false },
  { locationId: 'VAN-2', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', unit: 'ea', openingQuantity: 7, minimum: 6, par: 12, target: 16, essentialForVanReadiness: false },

  { locationId: 'VAN-3', itemCode: 'SW-220V', itemName: '220V Switch', unit: 'ea', openingQuantity: 8, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-3', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', unit: 'lb', openingQuantity: 7, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-3', itemCode: 'BRACKET', itemName: 'A/C Bracket', unit: 'ea', openingQuantity: 3, minimum: 2, par: 4, target: 6, essentialForVanReadiness: false },
  { locationId: 'VAN-3', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', unit: 'ea', openingQuantity: 10, minimum: 6, par: 12, target: 16, essentialForVanReadiness: false },

  { locationId: 'VAN-4', itemCode: 'SW-220V', itemName: '220V Switch', unit: 'ea', openingQuantity: 4, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-4', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', unit: 'lb', openingQuantity: 5, minimum: 5, par: 10, target: 12, essentialForVanReadiness: true },
  { locationId: 'VAN-4', itemCode: 'BRACKET', itemName: 'A/C Bracket', unit: 'ea', openingQuantity: 2, minimum: 2, par: 4, target: 6, essentialForVanReadiness: false },
  { locationId: 'VAN-4', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', unit: 'ea', openingQuantity: 8, minimum: 6, par: 12, target: 16, essentialForVanReadiness: false },
];

export function loadBrowserInventoryOpeningBalances() {
  const stored = loadBrowserValue<BrowserInventoryOpeningBalance[]>(BROWSER_INVENTORY_OPENING_KEY, []);
  if (stored.length) return stored;
  saveBrowserValue(BROWSER_INVENTORY_OPENING_KEY, previewOpeningBalances);
  return previewOpeningBalances;
}

export function syncSubmittedFieldConsumption() {
  const existing = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  const orders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
  const executions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const derived = executions.flatMap((execution) => {
    const order = orders.find((candidate) => candidate.id === execution.workOrderId);
    return order ? deriveFieldConsumption(order, execution) : [];
  });
  const merged = mergeInventoryMovements(existing, derived);
  saveBrowserValue(BROWSER_INVENTORY_MOVEMENTS_KEY, merged);
  return { movements: merged, newlyPosted: Math.max(0, merged.length - existing.length) };
}

export function deriveBrowserLocationBalances(opening: BrowserInventoryOpeningBalance[], movements: BrowserInventoryMovement[]) {
  return opening.map<BrowserLocationBalance>((line) => {
    const consumed = movements
      .filter((movement) => movement.movementType === 'job_consumption' && movement.sourceLocation === line.locationId && movement.itemCode === line.itemCode)
      .reduce((sum, movement) => sum + movement.quantity, 0);
    const current = Math.max(0, line.openingQuantity - consumed);
    return {
      ...line,
      consumed,
      current,
      status: current <= 0 ? 'empty' : current < line.minimum ? 'low' : 'ok',
    };
  });
}

export function deriveVanReadiness(balances: BrowserLocationBalance[]): BrowserVanReadiness[] {
  const vans: Array<Exclude<InventoryPreviewLocationId, 'WH-MAIN'>> = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'];
  return vans.map((locationId) => {
    const currentLines = balances.filter((line) => line.locationId === locationId);
    const lowLines = currentLines.filter((line) => line.current < line.minimum);
    const emptyEssentialLines = currentLines.filter((line) => line.essentialForVanReadiness && line.current <= 0);
    return {
      locationId,
      status: emptyEssentialLines.length ? 'blocked' : lowLines.length ? 'at_risk' : 'ready',
      lowLines,
      emptyEssentialLines,
      currentLines,
    };
  });
}

export function restockToPar(line: BrowserLocationBalance) {
  return Math.max(0, line.par - line.current);
}
