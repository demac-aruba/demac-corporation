'use strict';

const { fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { projectCanonicalWorkVisit } = require('./fieldOperationsAuthorityWorkVisit');
const { projectFieldApproval } = require('./fieldOperationsApprovals');
const { projectFieldFinding } = require('./fieldOperationsFindings');
const { projectFieldSaleLine } = require('./fieldOperationsSaleLines');
const { projectWorkIntervention } = require('./fieldOperationsVisitInterventions');

const FIELD_HISTORY_PROJECTION_VERSION = 1;

function text(value, limit = 1000) { return String(value ?? '').trim().slice(0, limit); }
function snapshotRecords(snapshot) { return (snapshot?.docs || []).map(fieldSnapshotRecord); }
function historyTime(record) { return record.completedAt || record.observedAt || record.updatedAt || record.startedAt || record.createdAt; }
function newestFirst(left, right) { return historyTime(right).localeCompare(historyTime(left)) || left.id.localeCompare(right.id); }

function canonicalTimestamp(value, label) {
  const normalized = text(value, 80);
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw fieldError('field_history_identity_conflict', `Canonical Field history ${label} timestamp is invalid.`, 409);
  }
  return normalized;
}

function childVisit(visitById, record, label) {
  const visit = visitById.get(text(record.visitId, 180));
  if (!visit || visit.workOrderId !== text(record.workOrderId, 180) || visit.propertyId !== text(record.propertyId, 180)) {
    throw fieldError('field_history_identity_conflict', `${label} does not resolve to its canonical Work Visit.`, 409);
  }
  return visit;
}

async function attachFieldHistoriesToJob(db, job) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore db is required.');
  const customerId = text(job?.customerId, 180);
  if (!customerId) throw fieldError('field_history_customer_required', 'Customer identity is required for Field history.', 409);
  const [visitSnapshot, interventionSnapshot, saleSnapshot, findingSnapshot, approvalSnapshot] = await Promise.all([
    db.collection('workVisits').where('clientId', '==', customerId).get(),
    db.collection('workInterventions').where('clientId', '==', customerId).get(),
    db.collection('fieldSaleLines').where('clientId', '==', customerId).get(),
    db.collection('fieldFindings').where('clientId', '==', customerId).get(),
    db.collection('fieldApprovals').where('clientId', '==', customerId).get(),
  ]);

  const visits = snapshotRecords(visitSnapshot).map((record) => {
    const visit = projectCanonicalWorkVisit(record);
    if (!visit.id || !visit.workOrderId || visit.customerId !== customerId || !visit.propertyId) {
      throw fieldError('field_history_identity_conflict', 'Canonical Work Visit history has conflicting identity.', 409);
    }
    return {
      id: visit.id,
      workOrderId: visit.workOrderId,
      propertyId: visit.propertyId,
      status: visit.status,
      startedAt: visit.startedAt,
      completedAt: visit.completedAt,
      requiresSecondVisit: visit.requiresSecondVisit,
      updatedAt: canonicalTimestamp(visit.updatedAt || visit.createdAt, 'Work Visit'),
    };
  }).sort(newestFirst);
  if (new Set(visits.map((visit) => visit.id)).size !== visits.length) {
    throw fieldError('field_history_identity_conflict', 'Canonical Work Visit history contains duplicate identities.', 409);
  }
  const visitById = new Map(visits.map((visit) => [visit.id, visit]));

  const interventions = snapshotRecords(interventionSnapshot).map((record) => {
    const visit = childVisit(visitById, record, 'Work Intervention history');
    const intervention = projectWorkIntervention(record, {
      visitId: visit.id, workOrderId: visit.workOrderId, customerId, propertyId: visit.propertyId,
    });
    return {
      id: intervention.id,
      visitId: intervention.visitId,
      workOrderId: visit.workOrderId,
      propertyId: visit.propertyId,
      assetId: intervention.assetId,
      serviceCatalogItemId: intervention.serviceCatalogItemId,
      interventionType: intervention.interventionType,
      origin: intervention.origin,
      status: intervention.status,
      resultCode: intervention.resultCode,
      resultNotes: intervention.resultNotes,
      startedAt: intervention.startedAt,
      completedAt: intervention.completedAt,
      updatedAt: canonicalTimestamp(intervention.updatedAt || intervention.createdAt, 'Work Intervention'),
    };
  }).sort(newestFirst);

  const saleLines = snapshotRecords(saleSnapshot).map((record) => {
    const visit = childVisit(visitById, record, 'Field Sale Line history');
    const saleLine = projectFieldSaleLine(record, {
      visitId: visit.id, workOrderId: visit.workOrderId, customerId, propertyId: visit.propertyId,
    });
    return {
      id: saleLine.id,
      visitId: saleLine.visitId,
      workOrderId: saleLine.workOrderId,
      propertyId: saleLine.propertyId,
      assetId: saleLine.assetId,
      catalogItemId: saleLine.catalogItemId,
      descriptionSnapshot: saleLine.descriptionSnapshot,
      quantity: saleLine.quantity,
      unit: saleLine.unit,
      priceSnapshot: saleLine.priceSnapshot,
      status: saleLine.status,
      customerApprovalId: saleLine.customerApprovalId,
      nonCatalog: saleLine.nonCatalog,
      updatedAt: canonicalTimestamp(saleLine.updatedAt, 'Field Sale Line'),
    };
  }).sort(newestFirst);

  const saleApprovals = snapshotRecords(approvalSnapshot).map((record) => {
    const visit = childVisit(visitById, record, 'Field Approval history');
    return projectFieldApproval(record, {
      visitId: visit.id, workOrderId: visit.workOrderId, customerId, propertyId: visit.propertyId,
    });
  }).filter((approval) => approval.affected.some((reference) => reference.type === 'sale_line'));
  const approvalBySaleLineId = new Map();
  for (const approval of saleApprovals) {
    const saleReferences = approval.affected.filter((reference) => reference.type === 'sale_line');
    if (saleReferences.length !== 1 || approval.affected.length !== 1 || approvalBySaleLineId.has(saleReferences[0].id)) {
      throw fieldError('field_history_identity_conflict', 'Field Sale history has ambiguous customer decision evidence.', 409);
    }
    approvalBySaleLineId.set(saleReferences[0].id, approval);
  }
  for (const line of saleLines) {
    const approval = approvalBySaleLineId.get(line.id);
    if (line.status === 'proposed' && (approval || line.customerApprovalId)) {
      throw fieldError('field_history_identity_conflict', 'Proposed Field Sale history contains customer decision evidence.', 409);
    }
    if (line.status === 'declined' && (approval?.status !== 'rejected' || approval.id !== line.customerApprovalId)) {
      throw fieldError('field_history_identity_conflict', 'Declined Field Sale history is missing customer rejection evidence.', 409);
    }
    if (['customer_approved', 'installed', 'delivered', 'sold'].includes(line.status)
      && (approval?.status !== 'approved' || approval.id !== line.customerApprovalId)) {
      throw fieldError('field_history_identity_conflict', 'Approved Field Sale history is missing customer approval evidence.', 409);
    }
    if (line.status === 'voided' && (Boolean(approval) !== Boolean(line.customerApprovalId)
      || (approval && approval.id !== line.customerApprovalId))) {
      throw fieldError('field_history_identity_conflict', 'Voided Field Sale history has inconsistent customer decision evidence.', 409);
    }
  }
  if ([...approvalBySaleLineId.keys()].some((saleLineId) => !saleLines.some((line) => line.id === saleLineId))) {
    throw fieldError('field_history_identity_conflict', 'Field Sale approval history references a missing canonical sale line.', 409);
  }

  const findings = snapshotRecords(findingSnapshot).map((record) => {
    const visit = childVisit(visitById, record, 'Field Finding history');
    const finding = projectFieldFinding(record, {
      visitId: visit.id, workOrderId: visit.workOrderId, customerId, propertyId: visit.propertyId,
    });
    return {
      id: finding.id,
      visitId: finding.visitId,
      workOrderId: visit.workOrderId,
      propertyId: visit.propertyId,
      assetId: finding.assetId,
      interventionId: finding.interventionId,
      summary: finding.summary,
      details: finding.details,
      recommendation: finding.recommendation,
      observedAt: finding.observedAt,
    };
  }).sort(newestFirst);

  for (const [label, records] of [['Work Intervention', interventions], ['Field Sale Line', saleLines], ['Field Finding', findings]]) {
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw fieldError('field_history_identity_conflict', `${label} history contains duplicate identities.`, 409);
    }
  }
  const interventionIds = new Set(interventions.map((record) => record.id));
  if (findings.some((finding) => !interventionIds.has(finding.interventionId))) {
    throw fieldError('field_history_identity_conflict', 'Field Finding history does not resolve to its canonical Work Intervention.', 409);
  }

  const locationByAssetId = new Map();
  for (const equipment of job.knownEquipment || []) {
    const assetId = text(equipment.id, 180);
    if (assetId) locationByAssetId.set(assetId, text(equipment.locationLabel, 240));
  }
  for (const visitAsset of job.visitAssets || []) {
    const assetId = text(visitAsset.assetId, 180);
    if (assetId && !locationByAssetId.get(assetId)) locationByAssetId.set(assetId, text(visitAsset.locationLabel, 240));
  }
  const assetIds = new Set([
    ...locationByAssetId.keys(),
    ...interventions.map((record) => record.assetId),
    ...findings.map((record) => record.assetId),
    ...saleLines.map((record) => record.assetId).filter(Boolean),
  ]);
  const equipmentFieldHistories = [...assetIds].sort().map((assetId) => ({
    assetId,
    locationLabel: locationByAssetId.get(assetId) || undefined,
    interventionIds: interventions.filter((record) => record.assetId === assetId).map((record) => record.id),
    findingIds: findings.filter((record) => record.assetId === assetId).map((record) => record.id),
    saleLineIds: saleLines.filter((record) => record.assetId === assetId).map((record) => record.id),
  }));

  return {
    ...job,
    customerFieldHistory: {
      version: FIELD_HISTORY_PROJECTION_VERSION,
      source: 'canonical_field_truth',
      customerId,
      visits,
      interventions,
      saleLines,
      findings,
    },
    equipmentFieldHistories,
  };
}

module.exports.FIELD_HISTORY_PROJECTION_VERSION = FIELD_HISTORY_PROJECTION_VERSION;
module.exports.attachFieldHistoriesToJob = attachFieldHistoriesToJob;
