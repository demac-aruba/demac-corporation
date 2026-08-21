export const WAREHOUSE_LOCATION_ID = 'WH-MAIN';
export const OFFICE_LOCATION_ID = 'OFFICE-MAIN';

export type InventoryClass =
  | 'consumable'
  | 'measured_consumable'
  | 'sellable_part'
  | 'serialized_part'
  | 'hvac_equipment'
  | 'tool'
  | 'ppe'
  | 'warranty_quarantine';

export type InventoryLocationType = 'warehouse' | 'office' | 'van' | 'job_site' | 'warranty' | 'quarantine';
export type InventoryMovementType =
  | 'receive'
  | 'issue_to_job'
  | 'return_from_job'
  | 'transfer'
  | 'adjustment'
  | 'warranty_return'
  | 'quarantine'
  | 'stock_count_adjustment'
  | 'transfer_out'
  | 'transfer_in'
  | 'transfer_variance'
  | 'legacy_location_allocation'
  | 'tool_transfer'
  | 'issue_to_work_order';

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  classification: InventoryClass;
  unitOfMeasure: string;
  trackQuantity: boolean;
  trackSerial: boolean;
  trackToolCustody: boolean;
  reorderable: boolean;
};

export type InventoryLocation = {
  id: string;
  name: string;
  type: InventoryLocationType;
  vanId?: string;
  active: boolean;
};

export type StockBalance = {
  itemId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  inbound: number;
  minimum: number;
  par: number;
  target: number;
};

export type InventoryMovement = {
  id: string;
  itemId: string;
  quantity: number;
  unitOfMeasure: string;
  type: InventoryMovementType;
  sourceLocationId?: string;
  destinationLocationId?: string;
  workOrderId?: string;
  requestedBy: string;
  approvedBy?: string;
  issuedBy?: string;
  receivedBy?: string;
  occurredAt: string;
  reason?: string;
};

// The canonical operational transfer is requested → in_transit → completed.
// Legacy preview statuses remain in this union only until the browser preview
// modules are fully retired; they are not emitted by Inventory Authority.
export type TransferStatus = 'requested' | 'approved' | 'issued' | 'in_transit' | 'received' | 'completed' | 'cancelled';

export type InventoryTransferLine = {
  itemId: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
};

export type InventoryTransfer = {
  id: string;
  sourceLocationId: string;
  destinationLocationId: string;
  status: TransferStatus;
  lines: InventoryTransferLine[];
  requestedBy: string;
  approvedBy?: string;
  issuedBy?: string;
  receivedBy?: string;
  requestedAt: string;
  receivedAt?: string;
  workOrderId?: string;
};

export type ToolAsset = {
  id: string;
  itemId: string;
  assetTag: string;
  serialNumber?: string;
  condition: 'good' | 'attention' | 'damaged' | 'lost';
  locationId: string;
  custodianEmployeeId?: string;
  calibrationDueAt?: string;
};

export type StockProjection = {
  itemId: string;
  locationId: string;
  onHand: number;
  inboundPurchase: number;
  inboundTransfer: number;
  reservedJobs: number;
  expectedConsumption: number;
  projectedAvailable: number;
  recommendedPurchaseQuantity: number;
};

export type JobMaterialRequirement = {
  itemId: string;
  itemName: string;
  quantityRequired: number;
  unitOfMeasure: string;
  locationId: string;
};

export type InventoryReadiness = {
  status: 'ready' | 'at_risk' | 'blocked';
  missing: Array<{ itemId: string; itemName: string; shortage: number; unitOfMeasure: string }>;
  warnings: string[];
};

export function availableStock(balance: Pick<StockBalance, 'onHand' | 'reserved'>) {
  return Math.max(0, balance.onHand - balance.reserved);
}

export function projectedAvailable(input: {
  onHand: number;
  inboundPurchase: number;
  inboundTransfer: number;
  reservedJobs: number;
  expectedConsumption: number;
}) {
  return input.onHand + input.inboundPurchase + input.inboundTransfer - input.reservedJobs - input.expectedConsumption;
}

export function recommendedPurchaseQuantity(args: { projected: number; target: number; minimum: number }) {
  if (args.projected >= args.minimum) return 0;
  return Math.max(0, args.target - args.projected);
}

export function buildStockProjection(args: {
  itemId: string;
  locationId: string;
  onHand: number;
  inboundPurchase?: number;
  inboundTransfer?: number;
  reservedJobs?: number;
  expectedConsumption?: number;
  target: number;
  minimum: number;
}): StockProjection {
  const projected = projectedAvailable({
    onHand: args.onHand,
    inboundPurchase: args.inboundPurchase ?? 0,
    inboundTransfer: args.inboundTransfer ?? 0,
    reservedJobs: args.reservedJobs ?? 0,
    expectedConsumption: args.expectedConsumption ?? 0,
  });
  return {
    itemId: args.itemId,
    locationId: args.locationId,
    onHand: args.onHand,
    inboundPurchase: args.inboundPurchase ?? 0,
    inboundTransfer: args.inboundTransfer ?? 0,
    reservedJobs: args.reservedJobs ?? 0,
    expectedConsumption: args.expectedConsumption ?? 0,
    projectedAvailable: projected,
    recommendedPurchaseQuantity: recommendedPurchaseQuantity({ projected, target: args.target, minimum: args.minimum }),
  };
}

export function evaluateInventoryReadiness(requirements: JobMaterialRequirement[], balances: StockBalance[]): InventoryReadiness {
  const missing: InventoryReadiness['missing'] = [];
  const warnings: string[] = [];
  for (const requirement of requirements) {
    const balance = balances.find((item) => item.itemId === requirement.itemId && item.locationId === requirement.locationId);
    const available = balance ? availableStock(balance) : 0;
    if (available < requirement.quantityRequired) {
      missing.push({ itemId: requirement.itemId, itemName: requirement.itemName, shortage: requirement.quantityRequired - available, unitOfMeasure: requirement.unitOfMeasure });
    } else if (balance && available - requirement.quantityRequired < balance.minimum) {
      warnings.push(`${requirement.itemName} will fall below minimum after this job.`);
    }
  }
  return { status: missing.length ? 'blocked' : warnings.length ? 'at_risk' : 'ready', missing, warnings };
}

export function transferRequiresApproval(lines: InventoryTransferLine[], items: InventoryItem[]) {
  return lines.some((line) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    return item?.classification === 'serialized_part' || item?.classification === 'hvac_equipment' || item?.classification === 'tool';
  });
}

export function nextTransferStatus(status: TransferStatus): TransferStatus {
  const order: TransferStatus[] = ['requested', 'approved', 'issued', 'in_transit', 'received'];
  const index = order.indexOf(status);
  if (index < 0 || index === order.length - 1) return status;
  return order[index + 1];
}

// Inventory truth belongs to physical locations. Warehouse, Office and Vans
// are locations, not separate item catalogs. Accountability may be associated
// with a person while quantity ownership remains with the location.
