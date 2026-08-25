const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { equipmentTechnicalProjection, fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectVisitAsset, requireEquipmentIdentity } = require('./fieldOperationsVisitAssets');
const {
  FIELD_WORK_INTERVENTION_STORAGE_VERSION,
  WORK_INTERVENTION_COLLECTION,
  WORK_INTERVENTION_MUTABLE_VISIT_STATUSES,
  loadFieldServiceCatalog,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');
const { normalizeCatalogService } = require('./serviceCatalog');
const { resolveServicePriceSnapshot } = require('./servicePricingAuthority');

const FIELD_SCOPE_CHANGE_STORAGE_VERSION = 1;
const SCOPE_CHANGE_COLLECTION = 'scopeChanges';
const TECHNICIAN_SCOPE_CHANGE_ORIGINS = new Set([
  'client_requested_additional_work',
  'technician_discovered_additional_need',
]);
const SCOPE_CHANGE_ORIGINS = new Set([
  ...TECHNICIAN_SCOPE_CHANGE_ORIGINS,
  'office_updated_scope',
  'safety_requirement',
  'other',
]);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function requiredReference(record, names, label) {
  const values = names.map((name) => text(record?.[name], 180)).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length !== 1) {
    throw fieldError('scope_change_identity_conflict', `Persisted Scope Change ${label} identity is missing or conflicting.`, 409);
  }
  return uniqueValues[0];
}

function assertExpectedReference(actual, expected, label) {
  const normalizedExpected = text(expected, 180);
  if (normalizedExpected && actual !== normalizedExpected) {
    throw fieldError('scope_change_identity_conflict', `Persisted Scope Change ${label} identity does not match its authorized visit context.`, 409);
  }
}

function canonicalVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_scope_change_version', 'Persisted Scope Change version is invalid.', 409);
  }
  return value;
}

function projectScopeChange(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_SCOPE_CHANGE_STORAGE_VERSION) {
    throw fieldError(
      'invalid_scope_change_schema',
      `Unsupported Scope Change storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`,
      409,
    );
  }
  const id = text(record?.id, 180);
  if (!id) throw fieldError('scope_change_identity_conflict', 'Persisted Scope Change record id is missing.', 409);
  const visitId = requiredReference(record, ['visitId'], 'Work Visit');
  const workOrderId = requiredReference(record, ['workOrderId'], 'Work Order');
  const customerId = requiredReference(record, ['clientId', 'customerId'], 'Customer');
  const propertyId = requiredReference(record, ['propertyId', 'siteId'], 'Property');
  const visitAssetId = requiredReference(record, ['visitAssetId'], 'Visit Asset');
  const interventionId = requiredReference(record, ['interventionId'], 'Work Intervention');
  const origin = text(record?.origin, 80);
  if (!SCOPE_CHANGE_ORIGINS.has(origin)) {
    throw fieldError('invalid_scope_change_origin', `Unknown persisted Scope Change origin: ${origin || 'missing'}.`, 409);
  }
  const reason = text(record?.reason, 1500);
  if (!reason) throw fieldError('invalid_scope_change_reason', 'Persisted Scope Change reason is missing.', 409);
  const requestedAt = text(record?.requestedAt, 80);
  if (!requestedAt || Number.isNaN(Date.parse(requestedAt))) {
    throw fieldError('invalid_scope_change_timestamp', 'Persisted Scope Change requestedAt is invalid.', 409);
  }
  const requestedByStaffId = text(record?.requestedByStaffId, 180) || undefined;
  const resolvedAt = text(record?.resolvedAt, 80) || undefined;
  if (resolvedAt && Number.isNaN(Date.parse(resolvedAt))) {
    throw fieldError('invalid_scope_change_timestamp', 'Persisted Scope Change resolvedAt is invalid.', 409);
  }
  assertExpectedReference(visitId, expectedContext.visitId, 'Work Visit');
  assertExpectedReference(workOrderId, expectedContext.workOrderId, 'Work Order');
  assertExpectedReference(customerId, expectedContext.customerId, 'Customer');
  assertExpectedReference(propertyId, expectedContext.propertyId, 'Property');
  return {
    id,
    visitId,
    visitAssetId,
    interventionId,
    origin,
    reason,
    plannedWorkLineId: text(record?.plannedWorkLineId, 180) || undefined,
    requestedByStaffId,
    requestedAt,
    resolvedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalVersion(record?.version),
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

function additionalOrigin(scopeOrigin) {
  if (scopeOrigin === 'client_requested_additional_work') {
    return { interventionOrigin: 'added_on_site_client_request', requestedBy: 'client' };
  }
  if (scopeOrigin === 'technician_discovered_additional_need') {
    return { interventionOrigin: 'added_on_site_technician_discovery', requestedBy: 'technician' };
  }
  throw fieldError('invalid_scope_change_origin', 'This Technician Portal command supports only client-requested or technician-discovered additional work.', 400);
}

function pricingFieldError(error) {
  const code = text(error?.code, 120);
  if (!code.startsWith('service_pricing_')) return error;
  return fieldError(
    code,
    text(error?.message, 500) || 'The governed service price is not available for this additional work.',
    409,
  );
}

function scopeChangeAuditEvent({ requestId, scopeChange, intervention, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:scope_change_created:${scopeChange.id}`),
    type: 'scope_change_created',
    entityType: 'ScopeChange',
    entityId: scopeChange.id,
    visitId: scopeChange.visitId,
    interventionId: intervention.id,
    assetId: intervention.assetId,
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
      origin: scopeChange.origin,
      reason: scopeChange.reason,
      visitAssetId: scopeChange.visitAssetId,
      interventionId: intervention.id,
    },
  };
}

function additionalInterventionAuditEvent({ requestId, scopeChange, intervention, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:additional_work_intervention_proposed:${intervention.id}`),
    type: 'additional_work_intervention_proposed',
    entityType: 'WorkIntervention',
    entityId: intervention.id,
    visitId: intervention.visitId,
    interventionId: intervention.id,
    assetId: intervention.assetId,
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
      origin: intervention.origin,
      status: intervention.status,
      serviceCatalogItemId: intervention.serviceCatalogItemId,
      scopeChangeId: scopeChange.id,
      priceSnapshot: intervention.priceSnapshot ? {
        currency: intervention.priceSnapshot.currency,
        unitPrice: intervention.priceSnapshot.unitPrice,
        sourceCatalogItemId: intervention.priceSnapshot.sourceCatalogItemId,
        pricingVersion: intervention.priceSnapshot.pricingVersion,
        capturedAt: intervention.priceSnapshot.capturedAt,
      } : undefined,
    },
  };
}

async function loadScopeChanges(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(SCOPE_CHANGE_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map((document) => projectScopeChange(fieldSnapshotRecord(document), { ...expectedContext, visitId: normalizedVisitId }))
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id));
}

function additionalInterventionBaseEligible(job) {
  return Boolean(
    job?.fieldVisit
    && WORK_INTERVENTION_MUTABLE_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))
    && Array.isArray(job.allowedActions)
    && job.allowedActions.includes('intervention.add')
    && Array.isArray(job.visitAssets)
    && job.visitAssets.length > 0,
  );
}

function validateAdditionalLinks(job, scopeChanges) {
  const byId = new Map(scopeChanges.map((change) => [change.id, change]));
  const visitAssetIds = new Set((job.visitAssets || []).map((asset) => text(asset?.id, 180)));
  const interventions = Array.isArray(job.workInterventions) ? job.workInterventions : [];
  const interventionById = new Map(interventions.map((intervention) => [intervention.id, intervention]));

  for (const scopeChange of scopeChanges) {
    if (!visitAssetIds.has(scopeChange.visitAssetId)) {
      throw fieldError('scope_change_identity_conflict', 'Scope Change references a Visit Asset outside the authorized visit.', 409);
    }
    const intervention = interventionById.get(scopeChange.interventionId);
    if (!intervention || intervention.scopeChangeId !== scopeChange.id || intervention.visitAssetId !== scopeChange.visitAssetId) {
      throw fieldError('scope_change_identity_conflict', 'Scope Change and Work Intervention linkage is inconsistent.', 409);
    }
    if (!intervention.priceSnapshot) {
      throw fieldError('work_intervention_price_snapshot_required', 'Additional Work Intervention is missing its governed price snapshot.', 409);
    }
  }
  for (const intervention of interventions) {
    if (intervention.origin === 'planned') continue;
    const scopeChange = byId.get(intervention.scopeChangeId);
    if (!scopeChange || scopeChange.interventionId !== intervention.id) {
      throw fieldError('scope_change_identity_conflict', 'Additional Work Intervention is missing its canonical Scope Change linkage.', 409);
    }
  }
}

async function attachScopeChangesToJob(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) {
    return {
      ...job,
      scopeChanges: [],
      additionalInterventionVisitAssetIds: [],
      canAddAdditionalIntervention: false,
    };
  }
  const expectedContext = {
    workOrderId: text(job?.workOrderId, 180),
    customerId: text(job?.customerId, 180),
    propertyId: text(job?.propertyId, 180),
  };
  const scopeChanges = await loadScopeChanges(db, visitId, expectedContext);
  validateAdditionalLinks(job, scopeChanges);
  const eligible = additionalInterventionBaseEligible(job);
  const availableFieldServices = eligible && (!Array.isArray(job.availableFieldServices) || job.availableFieldServices.length === 0)
    ? await loadFieldServiceCatalog(db)
    : (job.availableFieldServices || []);
  const additionalInterventionVisitAssetIds = eligible && availableFieldServices.length > 0
    ? job.visitAssets.map((asset) => text(asset?.id, 180)).filter(Boolean)
    : [];
  return {
    ...job,
    availableFieldServices,
    scopeChanges,
    additionalInterventionVisitAssetIds,
    canAddAdditionalIntervention: additionalInterventionVisitAssetIds.length > 0,
  };
}

function createAdditionalWorkInterventionCommand({
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

  return async function createAdditionalWorkIntervention({
    identity,
    visitId,
    visitAssetId,
    serviceCatalogItemId,
    origin,
    reason,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedVisitAssetId = text(visitAssetId, 180);
    const normalizedServiceId = text(serviceCatalogItemId, 180);
    const normalizedOrigin = text(origin, 80);
    const normalizedReason = text(reason, 1500);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedVisitAssetId) throw fieldError('visit_asset_required', 'A Visit Asset id is required.', 400);
    if (!normalizedServiceId) throw fieldError('service_required', 'A canonical Service id is required.', 400);
    if (!TECHNICIAN_SCOPE_CHANGE_ORIGINS.has(normalizedOrigin)) {
      throw fieldError('invalid_scope_change_origin', 'Additional work must identify whether it was requested by the client or discovered by the technician.', 400);
    }
    if (normalizedReason.length < 3) {
      throw fieldError('scope_change_reason_required', 'A short reason for the additional work is required.', 400);
    }
    const mappedOrigin = additionalOrigin(normalizedOrigin);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'intervention.add',
        deniedMessage: 'This assignment cannot add work interventions to the visit.',
      });
      if (!WORK_INTERVENTION_MUTABLE_VISIT_STATUSES.has(context.canonicalVisit.status)) {
        throw fieldError(
          'work_intervention_add_not_allowed',
          'Additional work can only be proposed after arrival and while the visit is active.',
          409,
          { visitStatus: context.canonicalVisit.status },
        );
      }
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      const scopeChangeId = deterministicId('SC', `${normalizedVisitId}:${stable}`);
      const interventionId = deterministicId('WI', `${normalizedVisitId}:additional:${stable}`);
      const scopeChangeRef = db.collection(SCOPE_CHANGE_COLLECTION).doc(scopeChangeId);
      const interventionRef = db.collection(WORK_INTERVENTION_COLLECTION).doc(interventionId);
      const [existingScopeSnapshot, existingInterventionSnapshot] = await Promise.all([
        transaction.get(scopeChangeRef),
        transaction.get(interventionRef),
      ]);
      if (existingScopeSnapshot.exists || existingInterventionSnapshot.exists) {
        if (!existingScopeSnapshot.exists || !existingInterventionSnapshot.exists) {
          throw fieldError('scope_change_request_conflict', 'This requestId has incomplete persisted additional-work state.', 409);
        }
        const existingScope = projectScopeChange(
          fieldSnapshotRecord(existingScopeSnapshot),
          expectedContext,
        );
        const existingIntervention = projectWorkIntervention(
          fieldSnapshotRecord(existingInterventionSnapshot),
          expectedContext,
        );
        if (
          existingScope.visitAssetId !== normalizedVisitAssetId
          || existingScope.interventionId !== existingIntervention.id
          || existingScope.origin !== normalizedOrigin
          || existingScope.reason !== normalizedReason
          || existingIntervention.visitAssetId !== normalizedVisitAssetId
          || existingIntervention.serviceCatalogItemId !== normalizedServiceId
          || existingIntervention.scopeChangeId !== existingScope.id
          || existingIntervention.origin !== mappedOrigin.interventionOrigin
          || existingIntervention.status !== 'pending_authorization'
          || !existingIntervention.priceSnapshot
        ) {
          throw fieldError('scope_change_request_conflict', 'This requestId was already used for different additional-work input.', 409);
        }
        result = {
          success: true,
          replayed: true,
          scopeChange: existingScope,
          workIntervention: existingIntervention,
          allowedActions: context.allowedActions,
        };
        return;
      }

      const visitAssetSnapshot = await transaction.get(db.collection('visitAssets').doc(normalizedVisitAssetId));
      if (!visitAssetSnapshot.exists) {
        throw fieldError('visit_asset_not_found', 'The selected Visit Asset is not available for this visit.', 404);
      }
      const visitAsset = projectVisitAsset(
        fieldSnapshotRecord(visitAssetSnapshot),
        expectedContext,
      );

      const serviceSnapshot = await transaction.get(db.collection('services').doc(normalizedServiceId));
      if (!serviceSnapshot.exists) {
        throw fieldError('service_not_available', 'The selected Service is not available in the canonical catalog.', 404);
      }
      const serviceRecord = fieldSnapshotRecord(serviceSnapshot);
      const canonicalService = normalizeCatalogService(serviceRecord);
      if (!canonicalService || canonicalService.serviceId !== normalizedServiceId) {
        throw fieldError('service_not_available', 'The selected Service is not an active canonical Field service.', 409);
      }

      const equipmentRef = db.collection('equipmentSystems').doc(visitAsset.assetId);
      const pricingRulesRef = db.collection('businessSettings').doc('company-service-pricing-rules');
      const [equipmentSnapshot, pricingRulesSnapshot] = await Promise.all([
        transaction.get(equipmentRef),
        transaction.get(pricingRulesRef),
      ]);
      if (!equipmentSnapshot.exists) {
        throw fieldError('asset_not_available_for_visit', 'The A/C linked to this Visit Asset is no longer available in canonical CRM.', 409);
      }
      const equipment = fieldSnapshotRecord(equipmentSnapshot);
      requireEquipmentIdentity(equipment, context.customerId, context.propertyId);
      const technical = equipmentTechnicalProjection(equipment);

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      let priceSnapshot;
      try {
        priceSnapshot = resolveServicePriceSnapshot({
          service: serviceRecord,
          pricingSettings: pricingRulesSnapshot.exists ? fieldSnapshotRecord(pricingRulesSnapshot) : null,
          btu: technical.btu,
          capturedAt: occurredAt,
        });
      } catch (error) {
        throw pricingFieldError(error);
      }

      const commonActor = actorFields(identity, occurredAt);
      const storedScopeChange = fieldFirestoreData({
        id: scopeChangeId,
        fieldAuthorityVersion: FIELD_SCOPE_CHANGE_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: normalizedVisitAssetId,
        interventionId,
        origin: normalizedOrigin,
        reason: normalizedReason,
        requestedByStaffId: text(identity.staffId, 180) || undefined,
        requestedAt: occurredAt,
        ...commonActor,
      }, 'scopeChange');
      const scopeChange = projectScopeChange(storedScopeChange, expectedContext);
      const storedIntervention = fieldFirestoreData({
        id: interventionId,
        fieldAuthorityVersion: FIELD_WORK_INTERVENTION_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: normalizedVisitAssetId,
        assetId: visitAsset.assetId,
        serviceCatalogItemId: normalizedServiceId,
        interventionType: canonicalService.label,
        origin: mappedOrigin.interventionOrigin,
        requestedBy: mappedOrigin.requestedBy,
        status: 'pending_authorization',
        priceSnapshot,
        scopeChangeId,
        performedByStaffIds: [],
        ...commonActor,
      }, 'workIntervention');
      const workIntervention = projectWorkIntervention(storedIntervention, expectedContext);

      transaction.create(scopeChangeRef, storedScopeChange);
      transaction.create(interventionRef, storedIntervention);
      await appendAuditInTransaction({
        transaction,
        event: scopeChangeAuditEvent({ requestId: stable, scopeChange, intervention: workIntervention, context, identity, occurredAt }),
        visit: context.storedVisit,
        identity,
      });
      await appendAuditInTransaction({
        transaction,
        event: additionalInterventionAuditEvent({ requestId: stable, scopeChange, intervention: workIntervention, context, identity, occurredAt }),
        visit: context.storedVisit,
        identity,
      });
      result = {
        success: true,
        replayed: false,
        scopeChange,
        workIntervention,
        allowedActions: context.allowedActions,
      };
    });

    return result;
  };
}

module.exports.FIELD_SCOPE_CHANGE_STORAGE_VERSION = FIELD_SCOPE_CHANGE_STORAGE_VERSION;
module.exports.SCOPE_CHANGE_COLLECTION = SCOPE_CHANGE_COLLECTION;
module.exports.SCOPE_CHANGE_ORIGINS = SCOPE_CHANGE_ORIGINS;
module.exports.TECHNICIAN_SCOPE_CHANGE_ORIGINS = TECHNICIAN_SCOPE_CHANGE_ORIGINS;
module.exports.additionalInterventionBaseEligible = additionalInterventionBaseEligible;
module.exports.additionalOrigin = additionalOrigin;
module.exports.attachScopeChangesToJob = attachScopeChangesToJob;
module.exports.createAdditionalWorkInterventionCommand = createAdditionalWorkInterventionCommand;
module.exports.loadScopeChanges = loadScopeChanges;
module.exports.pricingFieldError = pricingFieldError;
module.exports.projectScopeChange = projectScopeChange;
module.exports.validateAdditionalLinks = validateAdditionalLinks;
