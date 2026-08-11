import type { BrowserFieldExecutionRecord } from './browser-field';
import type { BrowserWorkOrderRecord } from './browser-operational';

export const BROWSER_INVENTORY_MOVEMENTS_KEY = 'demac.erp-next.inventory.movements.v1';

export type BrowserInventoryMovement = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: 'ea' | 'lb';
  sourceLocation: string;
  destination: string;
  movementType: 'job_consumption';
  source: 'field_execution';
  occurredAt: string;
};

type MovementTemplate = {
  suffix: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: BrowserInventoryMovement['unit'];
};

export function deriveFieldConsumption(order: BrowserWorkOrderRecord, execution: BrowserFieldExecutionRecord): BrowserInventoryMovement[] {
  if (execution.technicianStatus !== 'submitted' || !execution.submittedAt) return [];

  const templates: MovementTemplate[] = [
    { suffix: 'switch', itemCode: 'SW-220V', itemName: '220V Switch', quantity: execution.addons.switches, unit: 'ea' },
    { suffix: 'bracket', itemCode: 'BRACKET', itemName: 'A/C Bracket', quantity: execution.addons.brackets, unit: 'ea' },
    { suffix: 'armaflex', itemCode: 'ARMAFLEX', itemName: 'Armaflex / Insulation', quantity: execution.addons.armaflex, unit: 'ea' },
    { suffix: 'refrigerant', itemCode: 'REFRIGERANT', itemName: 'Refrigerant', quantity: execution.addons.refrigerantLb, unit: 'lb' },
  ];

  return templates
    .filter((template) => template.quantity > 0)
    .map((template) => ({
      id: `MOV-${order.id}-${template.suffix}`,
      workOrderId: order.id,
      appointmentId: order.appointmentId,
      itemCode: template.itemCode,
      itemName: template.itemName,
      quantity: template.quantity,
      unit: template.unit,
      sourceLocation: order.primaryVanId,
      destination: `JOB:${order.id}`,
      movementType: 'job_consumption',
      source: 'field_execution',
      occurredAt: execution.submittedAt!,
    }));
}

export function mergeInventoryMovements(existing: BrowserInventoryMovement[], incoming: BrowserInventoryMovement[]) {
  const byId = new Map(existing.map((movement) => [movement.id, movement]));
  for (const movement of incoming) byId.set(movement.id, movement);
  return [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
