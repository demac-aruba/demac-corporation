export type ToolCondition = 'Nueva' | 'Poco uso' | 'Uso medio' | 'Muy usada' | 'Requiere reemplazo' | 'No inspeccionada';
export type InventoryCheckStatus = 'draft' | 'completed';
export type InventoryEntryStatus = 'pending' | 'present' | 'missing';

export interface ToolCatalogItem {
  id: string;
  sequence: number;
  name: string;
  category: string;
  standardCost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByName: string;
}

export interface VanToolAsset {
  id: string;
  toolCatalogId: string;
  vanId: string;
  assetCode: string;
  assigned: boolean;
  condition: ToolCondition;
  purchaseCost: number;
  present?: boolean;
  latestPhotoUrl?: string;
  latestPhotoStoragePath?: string;
  latestPhotoAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseInventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minimum: number;
  cost: number;
  location: string;
  active: boolean;
  latestCountAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryCheck {
  id: string;
  scope: 'van' | 'warehouse';
  vanId?: string;
  status: InventoryCheckStatus;
  startedAt: string;
  completedAt?: string;
  startedByUserId: string;
  startedByName: string;
  totalItems: number;
  presentCount?: number;
  missingCount?: number;
  replacementCount?: number;
  varianceCount?: number;
  inventoryValue?: number;
}

export interface InventoryCheckEntry {
  id: string;
  checkId: string;
  scope: 'van' | 'warehouse';
  vanId?: string;
  assetId?: string;
  warehouseItemId?: string;
  label: string;
  assetCode?: string;
  expectedQuantity?: number;
  countedQuantity?: number;
  status: InventoryEntryStatus;
  condition?: ToolCondition;
  photoEvidenceId?: string;
  note?: string;
  updatedAt: string;
}

export interface InventoryEvidence {
  id: string;
  entityType: 'van_tool' | 'warehouse_item';
  entityId: string;
  checkId?: string;
  phase: 'initial' | 'control' | 'discrepancy';
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  capturedAt: string;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedByName: string;
  condition?: ToolCondition;
  note?: string;
}
