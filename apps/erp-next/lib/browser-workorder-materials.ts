import type { BrowserFieldExecutionRecord } from './browser-field';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from './browser-inventory-ledger';
import { deriveBrowserLocationBalances, loadBrowserInventoryOpeningBalances, type BrowserLocationBalance, type InventoryPreviewLocationId } from './browser-inventory-readiness';
import { loadBrowserInventoryTransfers, type BrowserInventoryTransfer } from './browser-inventory-transfers';
import type { BrowserWorkOrderRecord } from './browser-operational';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_WORKORDER_MATERIALS_KEY = 'demac.erp-next.operations.work-order-materials.v1';

export type WorkOrderMaterialPlanMode = 'not_required' | 'requirements';

export type WorkOrderMaterialRequirementLine = {
  id: string;
  itemCode: string;
  itemName: string;
  unit: 'ea' | 'lb';
  quantity: number;
  assignedLocationId: Exclude<InventoryPreviewLocationId, 'WH-MAIN'>;
};

export type BrowserWorkOrderMaterialPlan = {
  workOrderId: string;
  mode: WorkOrderMaterialPlanMode;
  lines: WorkOrderMaterialRequirementLine[];
  updatedAt: string;
  updatedBy: string;
};

export type MaterialLineReadiness = WorkOrderMaterialRequirementLine & {
  onHand: number;
  reservedAhead: number;
  availableForJob: number;
  inboundIssued: number;
  inboundPlanned: number;
  shortage: number;
  status: 'ready' | 'at_risk' | 'blocked';
  explanation: string;
};

export type WorkOrderMaterialReadiness = {
  workOrderId: string;
  status: 'ready' | 'at_risk' | 'blocked';
  planState: 'not_checked' | WorkOrderMaterialPlanMode;
  lines: MaterialLineReadiness[];
  reason: string;
};

export function loadWorkOrderMaterialPlans() {
  return loadBrowserValue<BrowserWorkOrderMaterialPlan[]>(BROWSER_WORKORDER_MATERIALS_KEY, []);
}

export function saveWorkOrderMaterialPlan(plan: BrowserWorkOrderMaterialPlan) {
  const current = loadWorkOrderMaterialPlans();
  const normalized: BrowserWorkOrderMaterialPlan = {
    ...plan,
    lines: plan.mode === 'not_required' ? [] : plan.lines.filter((line) => line.quantity > 0),
    updatedAt: new Date().toISOString(),
  };
  const next = current.some((item) => item.workOrderId === plan.workOrderId)
    ? current.map((item) => item.workOrderId === plan.workOrderId ? normalized : item)
    : [...current, normalized];
  saveBrowserValue(BROWSER_WORKORDER_MATERIALS_KEY, next);
  return normalized;
}

export function inventorySnapshotForMaterialPlanning() {
  const opening = loadBrowserInventoryOpeningBalances();
  const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  return deriveBrowserLocationBalances(opening, movements);
}

function scheduleKey(order: BrowserWorkOrderRecord) {
  return `${order.scheduledDate}T${order.scheduledStart}`;
}

function openInboundQuantity(transfers: BrowserInventoryTransfer[], args: { locationId: string; itemCode: string; states: Array<BrowserInventoryTransfer['status']> }) {
  return transfers
    .filter((transfer) => args.states.includes(transfer.status) && transfer.destinationLocationId === args.locationId)
    .flatMap((transfer) => transfer.lines)
    .filter((line) => line.itemCode === args.itemCode)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function earlierReservationQuantity(args: {
  targetOrder: BrowserWorkOrderRecord;
  line: WorkOrderMaterialRequirementLine;
  allOrders: BrowserWorkOrderRecord[];
  allPlans: BrowserWorkOrderMaterialPlan[];
  executions: BrowserFieldExecutionRecord[];
}) {
  const submittedIds = new Set(args.executions.filter((execution) => execution.technicianStatus === 'submitted').map((execution) => execution.workOrderId));
  const targetKey = scheduleKey(args.targetOrder);
  return args.allPlans
    .filter((plan) => plan.mode === 'requirements' && plan.workOrderId !== args.targetOrder.id && !submittedIds.has(plan.workOrderId))
    .flatMap((plan) => {
      const order = args.allOrders.find((candidate) => candidate.id === plan.workOrderId);
      if (!order || scheduleKey(order) >= targetKey) return [];
      return plan.lines;
    })
    .filter((candidate) => candidate.assignedLocationId === args.line.assignedLocationId && candidate.itemCode === args.line.itemCode)
    .reduce((sum, candidate) => sum + candidate.quantity, 0);
}

function lineReadiness(args: {
  targetOrder: BrowserWorkOrderRecord;
  line: WorkOrderMaterialRequirementLine;
  balances: BrowserLocationBalance[];
  transfers: BrowserInventoryTransfer[];
  allOrders: BrowserWorkOrderRecord[];
  allPlans: BrowserWorkOrderMaterialPlan[];
  executions: BrowserFieldExecutionRecord[];
}): MaterialLineReadiness {
  const balance = args.balances.find((item) => item.locationId === args.line.assignedLocationId && item.itemCode === args.line.itemCode);
  const onHand = balance?.current ?? 0;
  const reservedAhead = earlierReservationQuantity(args);
  const availableForJob = Math.max(0, onHand - reservedAhead);
  const inboundIssued = openInboundQuantity(args.transfers, { locationId: args.line.assignedLocationId, itemCode: args.line.itemCode, states: ['issued'] });
  const inboundPlanned = openInboundQuantity(args.transfers, { locationId: args.line.assignedLocationId, itemCode: args.line.itemCode, states: ['requested', 'approved'] });
  const shortage = Math.max(0, args.line.quantity - availableForJob);

  if (availableForJob >= args.line.quantity) {
    return { ...args.line, onHand, reservedAhead, availableForJob, inboundIssued, inboundPlanned, shortage: 0, status: 'ready', explanation: `Required quantity is physically on ${args.line.assignedLocationId} after earlier Work Order reservations.` };
  }
  if (availableForJob + inboundIssued >= args.line.quantity) {
    return { ...args.line, onHand, reservedAhead, availableForJob, inboundIssued, inboundPlanned, shortage, status: 'at_risk', explanation: `Physical on-hand is short, but issued stock already in transit can cover the requirement after receipt.` };
  }
  if (availableForJob + inboundIssued + inboundPlanned >= args.line.quantity) {
    return { ...args.line, onHand, reservedAhead, availableForJob, inboundIssued, inboundPlanned, shortage, status: 'at_risk', explanation: `Shortage is covered only by requested/approved transfer commitments that have not been physically issued/received yet.` };
  }
  return { ...args.line, onHand, reservedAhead, availableForJob, inboundIssued, inboundPlanned, shortage, status: 'blocked', explanation: `Explicit requirement cannot be covered by current stock or open inbound transfer commitments.` };
}

export function deriveWorkOrderMaterialReadiness(order: BrowserWorkOrderRecord, options?: {
  plans?: BrowserWorkOrderMaterialPlan[];
  balances?: BrowserLocationBalance[];
  transfers?: BrowserInventoryTransfer[];
  orders?: BrowserWorkOrderRecord[];
  executions?: BrowserFieldExecutionRecord[];
}): WorkOrderMaterialReadiness {
  const plans = options?.plans ?? loadWorkOrderMaterialPlans();
  const plan = plans.find((item) => item.workOrderId === order.id);
  if (!plan) return { workOrderId: order.id, status: 'at_risk', planState: 'not_checked', lines: [], reason: 'Material requirements have not been explicitly checked for this Work Order.' };
  if (plan.mode === 'not_required') return { workOrderId: order.id, status: 'ready', planState: 'not_required', lines: [], reason: 'Office explicitly confirmed no additional tracked materials are required.' };

  const balances = options?.balances ?? inventorySnapshotForMaterialPlanning();
  const transfers = options?.transfers ?? loadBrowserInventoryTransfers();
  const orders = options?.orders ?? loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
  const executions = options?.executions ?? loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const lines = plan.lines.map((line) => lineReadiness({ targetOrder: order, line, balances, transfers, allOrders: orders, allPlans: plans, executions }));
  if (!lines.length) return { workOrderId: order.id, status: 'at_risk', planState: 'requirements', lines: [], reason: 'Requirements mode is active but no material lines have been defined.' };
  if (lines.some((line) => line.status === 'blocked')) return { workOrderId: order.id, status: 'blocked', planState: 'requirements', lines, reason: 'One or more explicit material requirements are not covered by stock or committed inbound transfers.' };
  if (lines.some((line) => line.status === 'at_risk')) return { workOrderId: order.id, status: 'at_risk', planState: 'requirements', lines, reason: 'Materials are not physically ready yet; inbound transfer commitments are required.' };
  return { workOrderId: order.id, status: 'ready', planState: 'requirements', lines, reason: 'All explicit material requirements are physically available after earlier Work Order reservations.' };
}
