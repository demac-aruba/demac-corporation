'use strict';
// Read-only Inventory evidence for one canonical Project Work Order. No parallel stock or cost ledger.
const d = require('./registry-domain');
const PAGE_SIZE = 40;
function movementRow(snapshot, order) {
  const value = snapshot.data();
  if (value.id !== snapshot.id || value.version !== 1 || value.workOrderId !== order.id
      || value.type !== 'issue_to_work_order' || !['material', 'product'].includes(value.itemKind)) {
    throw d.fault('material_evidence_invalid', 'Inventory evidence requires review.', 409);
  }
  const quantity = value.quantity;
  const scaled = quantity * 1000;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(Math.round(scaled))
      || Math.abs(scaled - Math.round(scaled)) > 0.000001 || (value.itemKind === 'product' && !Number.isInteger(quantity))) {
    throw d.fault('material_evidence_invalid', 'Inventory quantity is invalid.', 409);
  }
  return { movementId: snapshot.id, workOrderId: order.id, itemKind: value.itemKind,
    itemId: d.id(value.itemId), itemName: d.text(value.itemName, 'recorded item name', 240, true),
    quantity, occurredAt: d.stamp(value.occurredAt), sourceLocationId: d.id(value.sourceLocationId),
    workOrderStatus: order.status, source: `inventoryMovements/${snapshot.id}`,
    unitCost: null, totalCost: null, valuationStatus: 'historical_valuation_not_integrated' };
}
async function loadProjectMaterials({ db, transaction, project, workOrderId, afterId }) {
  const orderSnapshot = await transaction.get(db.collection('workOrders').doc(d.id(workOrderId, 'Work Order')));
  const order = orderSnapshot.exists ? { ...orderSnapshot.data(), id: orderSnapshot.id } : null;
  if (!order || order.clientId !== project.customerId || (order.customerId !== undefined && order.customerId !== project.customerId)
      || order.propertyId !== project.propertyId) throw d.fault('material_work_order_forbidden', 'Select a linked Work Order belonging to this Project.', 409);
  const appointmentId = d.id(order.appointmentId, 'appointment');
  const [appointmentSnapshot, linkSnapshot] = await transaction.getAll(db.collection('appointments').doc(appointmentId), db.collection('projectAppointmentLinks').doc(appointmentId));
  const appointment = appointmentSnapshot.exists ? appointmentSnapshot.data() : null;
  const link = linkSnapshot.exists ? linkSnapshot.data() : null;
  if (!appointment || appointment.customerId !== project.customerId || (appointment.clientId !== undefined && appointment.clientId !== project.customerId)
      || appointment.propertyId !== project.propertyId || (appointment.appointmentId && appointment.appointmentId !== appointmentId)
      || !link || link.schemaVersion !== 1 || link.appointmentId !== appointmentId || link.projectId !== project.id
      || link.customerId !== project.customerId || (link.clientId !== undefined && link.clientId !== project.customerId) || link.propertyId !== project.propertyId
      || (link.phaseId !== null && !project.phases.some(p => p.id === link.phaseId))) {
    throw d.fault('material_work_order_forbidden', 'The appointment or Project link needs reconciliation.', 409);
  }
  let query = db.collection('inventoryMovements').where('workOrderId', '==', order.id).orderBy('__name__');
  if (afterId !== undefined) query = query.startAfter(d.id(afterId, 'movement cursor'));
  const result = await transaction.get(query.limit(PAGE_SIZE + 1));
  const documents = result.docs.slice(0, PAGE_SIZE); const rows = []; const issues = [];
  for (const snapshot of documents) {
    try { rows.push(movementRow(snapshot, order)); }
    catch { issues.push({ code: 'material_evidence_requires_review', movementId: snapshot.id }); }
  }
  return { source: 'canonical_inventory_movements', projectId: project.id, projectVersion: project.version,
    workOrderId: order.id, appointmentId, rows, issues,
    nextCursor: result.docs.length > PAGE_SIZE ? documents.at(-1).id : null,
    coverage: { pageValid: issues.length === 0, wholeProjectTotal: false, importReviewPending: project.migration?.status === 'pending_reconciliation' },
    costs: { amount: null, status: 'accounting_cost_source_not_integrated', authority: 'QuickBooks Online' },
    semantics: 'issued_inventory_evidence_not_current_balance_or_automatic_consumption_reversal' };
}
module.exports = { PAGE_SIZE, movementRow, loadProjectMaterials };
