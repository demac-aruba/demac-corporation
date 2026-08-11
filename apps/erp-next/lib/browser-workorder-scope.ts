import { loadBrowserCustomerMaster } from './browser-crm';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';
import type { BrowserFieldExecutionRecord, FieldEquipmentProgress } from './browser-field';
import type { BrowserWorkOrderRecord } from './browser-operational';

export const BROWSER_WORK_ORDER_SCOPE_KEY = 'demac.erp-next.operations.work-order-scope.v1';

export type WorkOrderScopeItem = {
  assetId: string;
  name: string;
  type: string;
  capacity?: string;
  serial?: string;
  source: 'registered_asset' | 'temporary_unit';
};

export type BrowserWorkOrderScopeRecord = {
  workOrderId: string;
  customerId?: string;
  siteId?: string;
  expectedQuantity: number;
  items: WorkOrderScopeItem[];
  mode: 'registered_assets' | 'temporary_units';
  status: 'complete' | 'incomplete';
  updatedAt: string;
};

export function loadWorkOrderScopes() {
  return loadBrowserValue<BrowserWorkOrderScopeRecord[]>(BROWSER_WORK_ORDER_SCOPE_KEY, []);
}

export function saveWorkOrderScope(record: BrowserWorkOrderScopeRecord) {
  const current = loadWorkOrderScopes();
  const next = current.some((scope) => scope.workOrderId === record.workOrderId)
    ? current.map((scope) => scope.workOrderId === record.workOrderId ? record : scope)
    : [...current, record];
  saveBrowserValue(BROWSER_WORK_ORDER_SCOPE_KEY, next);
  return next;
}

export function registeredAssetsForWorkOrder(order: BrowserWorkOrderRecord): WorkOrderScopeItem[] {
  if (!order.customerId) return [];
  const master = loadBrowserCustomerMaster(order.customerId);
  const assets = master.assets ?? [];
  return assets
    .filter((asset) => !order.site || asset.site === order.site)
    .map((asset) => ({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      capacity: asset.capacity,
      serial: asset.serial,
      source: 'registered_asset' as const,
    }));
}

export function temporaryScopeItems(order: BrowserWorkOrderRecord): WorkOrderScopeItem[] {
  return Array.from({ length: Math.max(1, order.totalQuantity) }, (_, index) => ({
    assetId: `TEMP-${order.id}-${index + 1}`,
    name: `Planned / Unregistered Unit ${index + 1}`,
    type: 'HVAC Equipment',
    source: 'temporary_unit' as const,
  }));
}

export function scopeStatus(order: BrowserWorkOrderRecord, scope?: BrowserWorkOrderScopeRecord) {
  if (!scope) return { complete: false, reason: `Select exactly ${order.totalQuantity} equipment unit(s) before field execution.` };
  if (scope.items.length !== order.totalQuantity) return { complete: false, reason: `Scope has ${scope.items.length} unit(s); Work Order expects ${order.totalQuantity}.` };
  return { complete: true, reason: `${scope.items.length} exact equipment unit(s) assigned.` };
}

function equipmentProgressFromScope(items: WorkOrderScopeItem[]): FieldEquipmentProgress[] {
  return items.map((item) => ({
    assetId: item.assetId,
    name: item.name,
    type: item.type,
    capacity: item.capacity,
    serial: item.serial,
    status: 'pending',
    beforePhoto: false,
    afterPhoto: false,
    gaugePhoto: false,
    refrigerantState: 'not_checked',
  }));
}

export function applyScopeToFieldExecution(order: BrowserWorkOrderRecord, scope: BrowserWorkOrderScopeRecord) {
  const current = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const existing = current.find((execution) => execution.workOrderId === order.id);
  if (existing?.technicianStatus === 'submitted') {
    throw new Error('This Work Order has already been submitted to Office Review. Its equipment scope is locked.');
  }

  const equipment = equipmentProgressFromScope(scope.items);
  const nextExecution: BrowserFieldExecutionRecord = existing
    ? { ...existing, equipment, updatedAt: new Date().toISOString() }
    : {
        workOrderId: order.id,
        appointmentId: order.appointmentId,
        customerId: order.customerId,
        siteId: order.siteId,
        technicianStatus: 'not_started',
        updatedAt: new Date().toISOString(),
        equipment,
        addons: { switches: 0, brackets: 0, armaflex: 0, refrigerantLb: 0 },
        voiceSeconds: 0,
        voiceTranscriptionStatus: 'none',
        technicianSummary: '',
      };

  const next = existing
    ? current.map((execution) => execution.workOrderId === order.id ? nextExecution : execution)
    : [...current, nextExecution];
  saveBrowserValue(browserKeys.fieldExecutions, next);
  return nextExecution;
}
