const crypto = require('node:crypto');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');

const FIELD_VISIT_ASSET_STORAGE_VERSION = 1;
const VISIT_ASSET_COLLECTION = 'visitAssets';
const VISIT_ASSET_MUTABLE_VISIT_STATUSES = new Set(['on_site', 'in_progress']);
const VISIT_ASSET_SOURCES = new Set(['scheduled', 'existing_asset', 'qr_scan', 'registered_on_site']);
const VISIT_ASSET_STATUSES = new Set(['identified', 'in_progress', 'completed', 'pending', 'not_performed']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

function consistentRequiredReference(record, names, label) {
  const values = names.map((name) => text(record?.[name], 180)).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length !== 1) {
    throw fieldError('visit_asset_identity_conflict', `Persisted Visit Asset ${label} identity is missing or conflicting.`, 409);
  }
  return uniqueValues[0];
}

function assertExpectedReference(actual, expected, label) {
  const normalizedExpected = text(expected, 180);
  if (normalizedExpected && actual !== normalizedExpected) {
    throw fieldError('visit_asset_identity_conflict', `Persisted Visit Asset ${label} identity does not match its authorized visit context.`, 409);
  }
}

function requireEquipmentIdentity(record, customerId, propertyId) {
  const customerRefs = [
    ['clientId', text(record?.clientId, 180)],
    ['customerId', text(record?.customerId, 180)],
  ].filter(([, value]) => value);
  if (!customerRefs.length || customerRefs.some(([, value]) => value !== customerId)) {
    throw fieldError('asset_not_available_for_visit', 'The selected A/C is not available for this visit.', 409);
  }

  const propertyRefs = [
    ['propertyId', text(record?.propertyId, 180)],
    ['siteId', text(record?.siteId, 180)],
  ].filter(([, value]) => value);
  if (!propertyRefs.length || propertyRefs.some(([, value]) => value !== propertyId)) {
    throw fieldError('asset_not_available_for_visit', 'The selected A/C is not available for this visit.', 409);
  }
  if (record?.active === false) {
    throw fieldError('asset_not_available_for_visit', 'The selected A/C is not available for this visit.', 409);
  }
}

function canonicalSequence(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw fieldError('invalid_visit_asset_sequence', 'Persisted Visit Asset sequence is invalid.', 409);
  }
  return number;
}

function canonicalVisitAssetVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_visit_asset_version', 'Persisted Visit Asset version is invalid.', 409);
  }
  return value;
}

function projectVisitAsset(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_VISIT_ASSET_STORAGE_VERSION) {
    throw fieldError(
      'invalid_visit_asset_schema',
      `Unsupported Visit Asset storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`,
      409,
    );
  }
  const source = text(record?.source, 80);
  const status = text(record?.status, 80);
  if (!VISIT_ASSET_SOURCES.has(source)) {
    throw fieldError('invalid_visit_asset_source', `Unknown persisted Visit Asset source: ${source || 'missing'}.`, 409);
  }
  if (!VISIT_ASSET_STATUSES.has(status)) {
    throw fieldError('invalid_visit_asset_status', `Unknown persisted Visit Asset status: ${status || 'missing'}.`, 409);
  }
  const id = text(record?.id, 180);
  const visitId = consistentRequiredReference(record, ['visitId'], 'Work Visit');
  const workOrderId = consistentRequiredReference(record, ['workOrderId'], 'Work Order');
  const customerId = consistentRequiredReference(record, ['clientId', 'customerId'], 'Customer');
  const propertyId = consistentRequiredReference(record, ['propertyId', 'siteId'], 'Property');
  const assetId = consistentRequiredReference(record, ['assetId'], 'Asset');
  if (!id) throw fieldError('visit_asset_identity_conflict', 'Persisted Visit Asset record id is missing.', 409);
  assertExpectedReference(visitId, expectedContext.visitId, 'Work Visit');
  assertExpectedReference(workOrderId, expectedContext.workOrderId, 'Work Order');
  assertExpectedReference(customerId, expectedContext.customerId, 'Customer');
  assertExpectedReference(propertyId, expectedContext.propertyId, 'Property');
  if (typeof record?.addedOnSite !== 'boolean') {
    throw fieldError('invalid_visit_asset_added_on_site', 'Persisted Visit Asset addedOnSite flag is invalid.', 409);
  }
  return {
    id,
    visitId,
    assetId,
    sequence: canonicalSequence(record?.sequence),
    locationLabel: text(record?.locationLabel, 240),
    source,
    status,
    addedOnSite: record.addedOnSite,
    addedReason: text(record?.addedReason, 1000) || undefined,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalVisitAssetVersion(record?.version),
  };
}

async function loadVisitAssets(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(VISIT_ASSET_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return snapshotRecords(snapshot)
    .map((record) => projectVisitAsset(record, { ...expectedContext, visitId: normalizedVisitId }))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

function canAttachExistingAsset(job) {
  return Boolean(
    job?.fieldVisit
    && VISIT_ASSET_MUTABLE_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))
    && Array.isArray(job.allowedActions)
    && job.allowedActions.includes('asset.add'),
  );
}

async function attachVisitAssetsToJob(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  return {
    ...job,
    visitAssets: visitId ? await loadVisitAssets(db, visitId, {
      workOrderId: text(job?.workOrderId, 180),
      customerId: text(job?.customerId, 180),
      propertyId: text(job?.propertyId, 180),
    }) : [],
    canAddExistingAsset: canAttachExistingAsset(job),
  };
}

function actorFields(identity, now) {
  return {
    createdAt: now,
    createdByUserId: text(identity.uid, 180),
    createdByStaffId: text(identity.staffId, 180) || undefined,
    createdByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    updatedAt: now,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: 1,
  };
}

function visitAssetAuditEvent({ requestId, visitAsset, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:visit_asset_attached:${visitAsset.id}`),
    type: 'visit_asset_attached',
    entityType: 'VisitAsset',
    entityId: visitAsset.id,
    visitId: visitAsset.visitId,
    assetId: visitAsset.assetId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    after: {
      source: visitAsset.source,
      status: visitAsset.status,
      sequence: visitAsset.sequence,
    },
  };
}

function createAttachExistingVisitAssetCommand({
  db,
  resolveAssignment,
  appendAuditInTransaction,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function attachExistingVisitAsset({ identity, visitId, assetId, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedAssetId = text(assetId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedAssetId) throw fieldError('asset_required', 'A canonical A/C Asset id is required.', 400);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'asset.add',
        deniedMessage: 'This assignment cannot add A/C equipment to the visit.',
      });
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };

      if (!VISIT_ASSET_MUTABLE_VISIT_STATUSES.has(context.canonicalVisit.status)) {
        throw fieldError(
          'visit_asset_add_not_allowed',
          'A/C equipment can only be added after arrival and while the visit is active.',
          409,
          { visitStatus: context.canonicalVisit.status },
        );
      }

      const visitAssetId = deterministicId('VA', `${normalizedVisitId}:${normalizedAssetId}`);
      const visitAssetRef = db.collection(VISIT_ASSET_COLLECTION).doc(visitAssetId);
      const existingSnapshot = await transaction.get(visitAssetRef);
      if (existingSnapshot.exists) {
        const existing = { id: existingSnapshot.id, ...existingSnapshot.data() };
        const projected = projectVisitAsset(existing, expectedContext);
        if (projected.assetId !== normalizedAssetId) {
          throw fieldError('visit_asset_identity_conflict', 'The existing Visit Asset identity conflicts with this request.', 409);
        }
        result = {
          success: true,
          replayed: true,
          visitAsset: projected,
          allowedActions: context.allowedActions,
        };
        return;
      }

      const equipmentRef = db.collection('equipmentSystems').doc(normalizedAssetId);
      const equipmentSnapshot = await transaction.get(equipmentRef);
      if (!equipmentSnapshot.exists) {
        throw fieldError('asset_not_available_for_visit', 'The selected A/C is not available for this visit.', 404);
      }
      const equipment = { id: equipmentSnapshot.id, ...equipmentSnapshot.data() };
      requireEquipmentIdentity(equipment, context.customerId, context.propertyId);

      const existingAssetsSnapshot = await transaction.get(
        db.collection(VISIT_ASSET_COLLECTION).where('visitId', '==', normalizedVisitId),
      );
      const existingAssets = snapshotRecords(existingAssetsSnapshot)
        .map((record) => projectVisitAsset(record, expectedContext));
      const duplicate = existingAssets.find((item) => item.assetId === normalizedAssetId);
      if (duplicate) {
        throw fieldError('visit_asset_identity_conflict', 'This A/C is already linked to the visit under a different Visit Asset identity.', 409, {
          visitAssetId: duplicate.id,
        });
      }
      const sequence = existingAssets.reduce((max, item) => Math.max(max, item.sequence), 0) + 1;

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const visitAsset = fieldFirestoreData({
        id: visitAssetId,
        fieldAuthorityVersion: FIELD_VISIT_ASSET_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        assetId: normalizedAssetId,
        sequence,
        locationLabel: text(equipment.locationLabel, 240),
        source: 'existing_asset',
        status: 'identified',
        addedOnSite: true,
        ...actorFields(identity, occurredAt),
      }, 'visitAsset');
      const event = visitAssetAuditEvent({
        requestId: stable,
        visitAsset,
        context,
        identity,
        occurredAt,
      });

      transaction.create(visitAssetRef, visitAsset);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        visitAsset: projectVisitAsset(visitAsset, expectedContext),
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.FIELD_VISIT_ASSET_STORAGE_VERSION = FIELD_VISIT_ASSET_STORAGE_VERSION;
module.exports.VISIT_ASSET_COLLECTION = VISIT_ASSET_COLLECTION;
module.exports.VISIT_ASSET_MUTABLE_VISIT_STATUSES = VISIT_ASSET_MUTABLE_VISIT_STATUSES;
module.exports.attachVisitAssetsToJob = attachVisitAssetsToJob;
module.exports.canAttachExistingAsset = canAttachExistingAsset;
module.exports.createAttachExistingVisitAssetCommand = createAttachExistingVisitAssetCommand;
module.exports.loadVisitAssets = loadVisitAssets;
module.exports.projectVisitAsset = projectVisitAsset;
module.exports.requireEquipmentIdentity = requireEquipmentIdentity;
module.exports.visitAssetAuditEvent = visitAssetAuditEvent;
