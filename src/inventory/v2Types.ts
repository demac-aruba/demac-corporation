export type ToolConditionV2 =
  | 'Nueva'
  | 'Poco uso'
  | 'Uso medio'
  | 'Muy usada'
  | 'Requiere reemplazo'
  | 'No inspeccionada';

export type ToolTrackingMode = 'individual' | 'quantity';

export type ToolOperationalStatus =
  | 'Disponible'
  | 'Prestada'
  | 'En reparación'
  | 'En depósito'
  | 'Faltante'
  | 'Retirada'
  | 'Desechada';

export type AssetLocationType = 'van' | 'warehouse';

export interface ToolCatalogItemV2 {
  id: string;
  sequence: number;
  name: string;
  category: string;
  standardCost: number;
  trackingMode?: ToolTrackingMode;
  recommendedQuantity?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByName: string;
}

export interface VanToolAssetV2 {
  id: string;
  toolCatalogId: string;
  vanId: string;
  assetCode: string;
  assigned: boolean;
  trackingMode?: ToolTrackingMode;
  unitNumber?: number;
  quantityExpected?: number;
  quantityPresent?: number;
  condition: ToolConditionV2;
  operationalStatus?: ToolOperationalStatus;
  purchaseCost: number;
  present?: boolean;
  locationType?: AssetLocationType;
  locationId?: string;
  latestPhotoUrl?: string;
  latestPhotoStoragePath?: string;
  latestPhotoAt?: string;
  notes?: string;
  maintenanceDueAt?: string;
  calibrationDueAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseInventoryItemV2 {
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

export type InventoryCheckStatusV2 = 'draft' | 'completed';
export type InventoryEntryStatusV2 = 'pending' | 'present' | 'missing';

export interface InventoryCheckV2 {
  id: string;
  scope: 'van' | 'warehouse';
  vanId?: string;
  status: InventoryCheckStatusV2;
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

export interface InventoryCheckEntryV2 {
  id: string;
  checkId: string;
  scope: 'van' | 'warehouse';
  vanId?: string;
  assetId?: string;
  warehouseItemId?: string;
  trackingMode?: ToolTrackingMode;
  label: string;
  assetCode?: string;
  expectedQuantity?: number;
  countedQuantity?: number;
  status: InventoryEntryStatusV2;
  condition?: ToolConditionV2;
  operationalStatus?: ToolOperationalStatus;
  photoEvidenceId?: string;
  note?: string;
  updatedAt: string;
}

export interface InventoryEvidenceV2 {
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
  condition?: ToolConditionV2;
  note?: string;
}
