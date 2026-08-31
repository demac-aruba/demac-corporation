import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type InventoryLocationType = 'warehouse' | 'office' | 'van' | 'legacy';
export type InventoryLocation = {
  id: string;
  name: string;
  type: InventoryLocationType;
  active: boolean;
  vanId?: string;
  readOnly?: boolean;
};
export type InventoryBalance = { onHand: number; reserved: number; minimum: number; target: number };
export type InventoryItemKind = 'product' | 'material';
export type InventoryItem = {
  id: string;
  itemKind: InventoryItemKind;
  name: string;
  sku?: string;
  category: string;
  unit: string;
  sellable: boolean;
  price?: number;
  cost?: number;
  active: boolean;
  balances: Record<string, InventoryBalance>;
};
export type InventoryToolCatalogItem = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  trackingMode?: 'individual' | 'quantity';
  standardCost?: number;
  recommendedQuantity?: number;
  active?: boolean;
};
export type InventoryToolAsset = {
  id: string;
  toolCatalogId?: string;
  assetCode?: string;
  trackingMode?: 'individual' | 'quantity';
  unitNumber?: number;
  quantity?: number;
  quantityExpected?: number;
  quantityPresent?: number;
  purchaseCost?: number;
  vanId?: string;
  locationType?: 'van' | 'warehouse' | 'office';
  locationId?: string;
  inventoryLocationId?: string;
  operationalStatus?: string;
  condition?: string;
  present?: boolean;
  assigned?: boolean;
  active?: boolean;
  latestPhotoUrl?: string;
  latestPhotoStoragePath?: string;
  latestPhotoAt?: string;
  latestThumbnailUrl?: string;
  latestThumbnailStoragePath?: string;
  latestThumbnailSourcePhotoPath?: string;
  latestThumbnailSizeBytes?: number;
  latestThumbnailWidth?: number;
  latestThumbnailHeight?: number;
  maintenanceDueAt?: string;
  calibrationDueAt?: string;
  retiredAt?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type InventoryTransferStatus = 'requested' | 'in_transit' | 'completed' | 'cancelled';
export type InventoryTransferLine = {
  lineId: string;
  itemKind: InventoryItemKind;
  itemId: string;
  itemName: string;
  unit?: string;
  requestedQuantity: number;
  pickedQuantity: number;
  receivedQuantity: number;
  pickupShortfall?: number;
  varianceQuantity?: number;
};
export type InventoryTransfer = {
  id: string;
  version: 1;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  status: InventoryTransferStatus;
  lines: InventoryTransferLine[];
  requestedById?: string;
  requestedByName?: string;
  requestedAt?: string;
  assignedPickupStaffId?: string;
  assignedPickupName?: string;
  pickedUpById?: string;
  pickedUpByName?: string;
  pickedUpAt?: string;
  receivedById?: string;
  receivedByName?: string;
  receivedAt?: string;
  completedAt?: string;
  hasDiscrepancy?: boolean;
  discrepancyNote?: string;
  note?: string;
};
export type InventoryMovement = {
  id: string;
  itemKind: string;
  itemId: string;
  itemName: string;
  quantity: number;
  type: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  transferId?: string;
  workOrderId?: string;
  reason?: string;
  occurredAt?: string;
  performedByName?: string;
};
export type InventoryReplenishment = {
  itemKind: InventoryItemKind;
  itemId: string;
  itemName: string;
  locationId: string;
  onHand: number;
  reserved: number;
  minimum: number;
  target: number;
  needed: number;
};
export type AddInventoryToolToVanInput = {
  requestId: string;
  vanId: string;
  toolCatalogId?: string;
  newCatalog?: {
    name: string;
    description?: string;
    category: string;
    standardCost: number;
    trackingMode: 'individual' | 'quantity';
    recommendedQuantity: number;
  };
  condition: string;
  purchaseCost?: number;
  quantity: number;
  notes?: string;
  photoUrl: string;
  photoStoragePath: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
};
export type AddInventoryToolToVanResult = {
  success: true;
  version: number;
  catalog: InventoryToolCatalogItem;
  asset: InventoryToolAsset;
  movement: InventoryMovement;
  replayed?: boolean;
};
export type InventorySnapshot = {
  success: true;
  version: number;
  locations: InventoryLocation[];
  items: InventoryItem[];
  toolCatalog: InventoryToolCatalogItem[];
  toolAssets: InventoryToolAsset[];
  transfers: InventoryTransfer[];
  movements: InventoryMovement[];
  replenishment: InventoryReplenishment[];
};

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/inventoryAuthority`;
}

async function callInventoryAuthority<T>(action: string, data: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok) {
      const code = payload.error?.code && payload.error.code !== 'internal_error' ? ` (${payload.error.code})` : '';
      throw new Error(`${payload.error?.message ?? 'The inventory operation could not be completed.'}${code}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Inventory Authority took too long to respond. Nothing was saved. Refresh and try again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function createInventoryRequestId(prefix = 'inventory') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export function getInventorySnapshot() {
  return callInventoryAuthority<InventorySnapshot>('get_snapshot', {}, 12_000);
}
export function setInventoryStockLevel(input: { requestId: string; itemKind: InventoryItemKind; itemId: string; locationId: string; onHand: number; reason?: string }) {
  return callInventoryAuthority('set_stock_level', input, 12_000);
}
export function setInventoryLocationPolicy(input: { requestId: string; itemKind: InventoryItemKind; itemId: string; locationId: string; minimum: number; target: number }) {
  return callInventoryAuthority('set_location_policy', input, 12_000);
}
export function updateInventoryLocationState(input: { requestId: string; itemKind: InventoryItemKind; itemId: string; locationId: string; onHand: number; minimum: number; target: number; reason?: string }) {
  return callInventoryAuthority('update_location_inventory_state', input, 12_000);
}
export function allocateLegacyProductStock(input: { requestId: string; itemId: string; allocations: Array<{ locationId: string; quantity: number }> }) {
  return callInventoryAuthority('allocate_legacy_product_stock', input, 12_000);
}
export function createInventoryTransfer(input: { requestId: string; sourceLocationId: string; destinationLocationId: string; assignedPickupStaffId?: string; assignedPickupName?: string; note?: string; lines: Array<{ itemKind: InventoryItemKind; itemId: string; quantity: number }> }) {
  return callInventoryAuthority<{ success: true; transfer: InventoryTransfer; replayed?: boolean }>('create_transfer', input, 15_000);
}
export function pickupInventoryTransfer(input: { requestId: string; transferId: string; note?: string; lines?: Array<{ lineId: string; pickedQuantity: number }> }) {
  return callInventoryAuthority<{ success: true; transfer: InventoryTransfer; replayed?: boolean }>('pickup_transfer', input, 15_000);
}
export function receiveInventoryTransfer(input: { requestId: string; transferId: string; discrepancyNote?: string; lines?: Array<{ lineId: string; receivedQuantity: number }> }) {
  return callInventoryAuthority<{ success: true; transfer: InventoryTransfer; replayed?: boolean }>('receive_transfer', input, 15_000);
}
export function cancelInventoryTransfer(input: { requestId: string; transferId: string; reason?: string }) {
  return callInventoryAuthority<{ success: true; transfer: InventoryTransfer }>('cancel_transfer', input, 12_000);
}
export function moveInventoryTool(input: { requestId: string; assetId: string; destinationLocationId: string; reason: string }) {
  return callInventoryAuthority('move_tool_asset', input, 12_000);
}
export function addInventoryToolToVan(input: AddInventoryToolToVanInput) {
  return callInventoryAuthority<AddInventoryToolToVanResult>('add_tool_to_van', input, 15_000);
}
export function updateInventoryToolDetails(input: { requestId: string; assetId: string; condition?: string; notes?: string; purchaseCost?: number; quantityExpected?: number; quantityPresent?: number }) {
  return callInventoryAuthority<{ success: true; version: number; asset: InventoryToolAsset; movement?: InventoryMovement; replayed?: boolean }>('update_tool_asset_details', input, 12_000);
}
export function issueInventoryToWorkOrder(input: { requestId: string; itemKind: InventoryItemKind; itemId: string; locationId: string; workOrderId: string; quantity: number; reason?: string }) {
  return callInventoryAuthority('issue_to_work_order', input, 12_000);
}
