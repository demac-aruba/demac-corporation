const crypto = require('node:crypto');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectVisitAsset } = require('./fieldOperationsVisitAssets');
const { catalogServicePresets, normalizeCatalogService } = require('./serviceCatalog');

const FIELD_WORK_INTERVENTION_STORAGE_VERSION = 1;
const WORK_INTERVENTION_COLLECTION = 'workInterventions';
const WORK_INTERVENTION_MUTABLE_VISIT_STATUSES = new Set(['on_site', 'in_progress']);
const WORK_INTERVENTION_ORIGINS = new Set([
  'planned',
  'added_on_site_client_request',
  'added_on_site_technician_discovery',
  'converted_on_site',
  'office_added',
]);
const WORK_INTERVENTION_STATUSES = new Set([
  'planned',
  'confirmed',
  'in_progress',
  'pending_authorization',
  'pending_part',
  'not_performed',
  'declined',
  'cancelled',
  'completed',
]);
const WORK_INTERVENTION_REQUESTED_BY = new Set(['office', 'client', 'technician']);
const NON_COVERING_INTERVENTION_STATUSES = new Set(['cancelled', 'declined', 'not_performed']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

function requiredReference(record, names, label) {
  const values = names.map((name) => text(record?.[name], 180)).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length !== 1) {
    throw fieldError('work_intervention_identity_conflict', `Persisted Work Intervention ${label} identity is missing or conflicting.`, 409);
  }
  return uniqueValues[0];
}

function assertExpectedReference(actual, expected, label) {
  const normalizedExpected = text(expected, 180);
  if (normalizedExpected && actual !== normalizedExpected) {
    throw fieldError('work_intervention_identity_conflict', `Persisted Work Intervention ${label} identity does not match its authorized visit context.`, 409);
  }
}

function canonicalVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_work_intervention_version', 'Persisted Work Intervention version is invalid.', 409);
  }
  return value;
}

function canonicalStaffIds(value) {
  if (!Array.isArray(value)) {
    throw fieldError('invalid_work_intervention_staff', 'Persisted Work Intervention staff assignment is invalid.', 409);
  }
  const normalized = value.map((item) => text(item, 180));
  if (normalized.some((item) => !item) || normalized.length !== new Set(normalized).size) {
    throw fieldError('invalid_work_intervention_staff', 'Persisted Work Intervention staff assignment is invalid.', 409);
  }
  return normalized;
}

function projectWorkIntervention(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_WORK_INTERVENTION_STORAGE_VERSION) {
    throw fieldError(
      'invalid_work_intervention_schema',
      `Unsupported Work Intervention storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`,
      409,
    );
  }
  const id = text(record?.id, 180);
  if (!id) throw fieldError('work_intervention_identity_conflict', 'Persisted Work Intervention record id is missing.', 409);
  const visitId = requiredReference(record, ['visitId'], 'Work Visit');
  const workOrderId = requiredReference(record, ['workOrderId'], 'Work Order');
  const customerId = requiredReference(record, ['clientId', 'customerId'], 'Customer');
  const propertyId = requiredReference(record, ['propertyId', 'siteId'], 'Property');
  const visitAssetId = requiredReference(record, ['visitAssetId'], 'Visit Asset');
  const assetId = requiredReference(record, ['assetId'], 'Asset');
  const serviceCatalogItemId = requiredReference(record, ['serviceCatalogItemId'], 'Service');
  const origin = text(record?.origin, 80);
  const status = text(record?.status, 80);
  const requestedBy = text(record?.requestedBy, 80);
  if (!WORK_INTERVENTION_ORIGINS.has(origin)) {
    throw fieldError('invalid_work_intervention_origin', `Unknown persisted Work Intervention origin: ${origin || 'missing'}.`, 409);
  }
  if (!WORK_INTERVENTION_STATUSES.has(status)) {
    throw fieldError('invalid_work_intervention_status', `Unknown persisted Work Intervention status: ${status || 'missing'}.`, 409);
  }
  if (requestedBy && !WORK_INTERVENTION_REQUESTED_BY.has(requestedBy)) {
    throw fieldError('invalid_work_intervention_requester', `Unknown persisted Work Intervention requestedBy: ${requestedBy}.`, 409);
  }
  const plannedWorkLineId = text(record?.plannedWorkLineId, 180) || undefined;
  const scopeChangeId = text(record?.scopeChangeId, 180) || undefined;
  if (origin === 'planned' && !plannedWorkLineId) {
    throw fieldError('work_intervention_identity_conflict', 'A planned Work Intervention must reference its planned work line.', 409);
  }
  if (origin !== 'planned' && !scopeChangeId) {
    throw fieldError('work_intervention_identity_conflict', 'An added-on-site Work Intervention must reference its Scope Change.', 409);
  }
  assertExpectedReference(visitId, expectedContext.visitId, 'Work Visit');
  assertExpectedReference(workOrderId, expectedContext.workOrderId, 'Work Order');
  assertExpectedReference(customerId, expectedContext.customerId, 'Customer');
  assertExpectedReference(propertyId, expectedContext.propertyId, 'Property');
  return {
    id,
    visitId,
    visitAssetId,
    assetId,
    plannedWorkLineId,
    serviceCatalogItemId,
    interventionType: text(record?.interventionType, 240),
    origin,
    requestedBy: requestedBy || undefined,
    status,
    templateId: text(record?.templateId, 180) || undefined,
    templateVersion: record?.templateVersion,
    scopeChangeId,
    startedAt: text(record?.startedAt, 80) || undefined,
    completedAt: text(record?.completedAt, 80) || undefined,
    performedByStaffIds: canonicalStaffIds(record?.performedByStaffIds),
    resultCode: text(record?.resultCode, 120) || undefined,
    resultNotes: text(record?.resultNotes, 1500) || undefined,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalVersion(record?.version),
  };
}

function coveringIntervention(intervention) {
  return !NON_COVERING_INTERVENTION_STATUSES.has(intervention.status);
}

function plannedWorkProgress(plannedWork = [], interventions = []) {
  return plannedWork.map((line) => {
    const plannedQuantity = Math.max(0, Number(line?.quantity) || 0);
    const linkedActualQuantity = interventions.filter((intervention) => (
      intervention.plannedWorkLineId === line.id && coveringIntervention(intervention)
    )).length;
    return {
      id: text(line?.id, 180),
      plannedQuantity,
      linkedActualQuantity,
      remainingQuantity: Math.max(0, plannedQuantity - linkedActualQuantity),
    };
  });
}

function plannedInterventionOptions(job, progress, interventions) {
  if (!plannedInterventionBaseEligible(job, progress)) return [];
  return job.visitAssets.map((visitAsset) => {
    const visitAssetId = text(visitAsset?.id, 180);
    const plannedWorkLineIds = progress
      .filter((line) => line.remainingQuantity > 0)
      .filter((line) => !interventions.some((intervention) => (
        intervention.visitAssetId === visitAssetId
        && intervention.plannedWorkLineId === line.id
        && coveringIntervention(intervention)
      )))
      .map((line) => line.id);
    return { visitAssetId, plannedWorkLineIds };
  }).filter((option) => option.visitAssetId && option.plannedWorkLineIds.length > 0);
}

function projectFieldService(preset) {
  return {
    id: text(preset?.serviceId, 180),
    bookingCode: text(preset?.id, 120),
    label: text(preset?.label, 240),
    kind: text(preset?.kind, 120),
    durationMinutesPerUnit: Math.max(0, Number(preset?.durationMinutesPerUnit) || 0),
  };
}

async function loadFieldServiceCatalog(db) {
  const snapshot = await db.collection('services').get();
  return catalogServicePresets(snapshotRecords(snapshot))
    .map(projectFieldService)
    .filter((service) => service.id && service.label);
}

async function loadWorkInterventions(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(WORK_INTERVENTION_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return snapshotRecords(snapshot)
    .map((record) => projectWorkIntervention(record, { ...expectedContext, visitId: normalizedVisitId }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function plannedInterventionBaseEligible(job, progress) {
  return Boolean(
    job?.fieldVisit
    && WORK_INTERVENTION_MUTABLE_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))
    && Array.isArray(job.allowedActions)
    && job.allowedActions.includes('intervention.add')
    && Array.isArray(job.visitAssets)
    && job.visitAssets.length > 0
    && progress.some((line) => line.remainingQuantity > 0),
  );
}

function canAddPlannedIntervention(options, services) {
  return Array.isArray(options) && options.length > 0 && Array.isArray(services) && services.length > 0;
}

async function attachWorkInterventionsToJob(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) {
    return {
      ...job,
      workInterventions: [],
      plannedWorkProgress: plannedWorkProgress(job?.plannedWork || [], []),
      plannedInterventionOptions: [],
      availableFieldServices: [],
      canAddPlannedIntervention: false,
    };
  }
  const expectedContext = {
    workOrderId: text(job?.workOrderId, 180),
    customerId: text(job?.customerId, 180),
    propertyId: text(job?.propertyId, 180),
  };
  const workInterventions = await loadWorkInterventions(db, visitId, expectedContext);
  const progress = plannedWorkProgress(job?.plannedWork || [], workInterventions);
  const options = plannedInterventionOptions(job, progress, workInterventions);
  const availableFieldServices = options.length > 0 ? await loadFieldServiceCatalog(db) : [];
  return {
    ...job,
    workInterventions,
    plannedWorkProgress: progress,
    plannedInterventionOptions: options,
    availableFieldServices,
    canAddPlannedIntervention: canAddPlannedIntervention(options, availableFieldServices),
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

function workInterventionAuditEvent({ requestId, intervention, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:planned_work_intervention_created:${intervention.id}`),
    type: 'planned_work_intervention_created',
    entityType: 'WorkIntervention',
    entityId: intervention.id,
    visitId: intervention.visitId,
    visitAssetId: intervention.visitAssetId,
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
      plannedWorkLineId: intervention.plannedWorkLineId,
      serviceCatalogItemId: intervention.serviceCatalogItemId,
    },
  };
}

function createPlannedWorkInterventionCommand({
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

  return async function createPlannedWorkIntervention({
    identity,
    visitId,
    visitAssetId,
    plannedWorkLineId,
    serviceCatalogItemId,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedVisitAssetId = text(visitAssetId, 180);
    const normalizedPlannedWorkLineId = text(plannedWorkLineId, 180);
    const normalizedServiceId = text(serviceCatalogItemId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedVisitAssetId) throw fieldError('visit_asset_required', 'A Visit Asset id is required.', 400);
    if (!normalizedPlannedWorkLineId) throw fieldError('planned_work_line_required', 'A planned work line id is required.', 400);
    if (!normalizedServiceId) throw fieldError('service_required', 'A canonical Service id is required.', 400);
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
          'Planned work can only be confirmed after arrival and while the visit is active.',
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

      const interventionId = deterministicId('WI', `${normalizedVisitId}:${stable}`);
      const interventionRef = db.collection(WORK_INTERVENTION_COLLECTION).doc(interventionId);
      const existingSnapshot = await transaction.get(interventionRef);
      if (existingSnapshot.exists) {
        const existing = projectWorkIntervention({ id: existingSnapshot.id, ...existingSnapshot.data() }, expectedContext);
        if (
          existing.visitAssetId !== normalizedVisitAssetId
          || existing.plannedWorkLineId !== normalizedPlannedWorkLineId
          || existing.serviceCatalogItemId !== normalizedServiceId
          || existing.origin !== 'planned'
        ) {
          throw fieldError('work_intervention_request_conflict', 'This requestId was already used for different Work Intervention input.', 409);
        }
        result = {
          success: true,
          replayed: true,
          workIntervention: existing,
          allowedActions: context.allowedActions,
        };
        return;
      }

      const plannedLine = context.canonicalVisit.scheduledScopeSnapshot.workLines
        .find((line) => text(line?.id, 180) === normalizedPlannedWorkLineId);
      if (!plannedLine) {
        throw fieldError('planned_work_line_not_found', 'The selected planned work line is not part of this visit snapshot.', 409);
      }
      const plannedQuantity = Math.max(0, Number(plannedLine.quantity) || 0);
      if (!plannedQuantity) {
        throw fieldError('planned_work_line_invalid', 'The selected planned work line has no executable quantity.', 409);
      }

      const visitAssetRef = db.collection('visitAssets').doc(normalizedVisitAssetId);
      const visitAssetSnapshot = await transaction.get(visitAssetRef);
      if (!visitAssetSnapshot.exists) {
        throw fieldError('visit_asset_not_found', 'The selected Visit Asset is not available for this visit.', 404);
      }
      const visitAsset = projectVisitAsset(
        { id: visitAssetSnapshot.id, ...visitAssetSnapshot.data() },
        expectedContext,
      );

      const serviceRef = db.collection('services').doc(normalizedServiceId);
      const serviceSnapshot = await transaction.get(serviceRef);
      if (!serviceSnapshot.exists) {
        throw fieldError('service_not_available', 'The selected Service is not available in the canonical catalog.', 404);
      }
      const service = { id: serviceSnapshot.id, ...serviceSnapshot.data() };
      const canonicalService = normalizeCatalogService(service);
      if (!canonicalService || canonicalService.serviceId !== normalizedServiceId) {
        throw fieldError('service_not_available', 'The selected Service is not an active canonical Field service.', 409);
      }

      const existingInterventionsSnapshot = await transaction.get(
        db.collection(WORK_INTERVENTION_COLLECTION).where('visitId', '==', normalizedVisitId),
      );
      const existingInterventions = snapshotRecords(existingInterventionsSnapshot)
        .map((record) => projectWorkIntervention(record, expectedContext));
      const activeForLine = existingInterventions.filter((intervention) => (
        intervention.plannedWorkLineId === normalizedPlannedWorkLineId && coveringIntervention(intervention)
      ));
      if (activeForLine.some((intervention) => intervention.visitAssetId === normalizedVisitAssetId)) {
        throw fieldError(
          'planned_work_already_linked_to_asset',
          'This planned work line is already linked to this A/C for the current visit.',
          409,
        );
      }
      if (activeForLine.length >= plannedQuantity) {
        throw fieldError(
          'planned_work_fully_linked',
          'The planned quantity is already fully linked to actual A/C work. Additional work must use a Scope Change.',
          409,
          { plannedQuantity, linkedActualQuantity: activeForLine.length },
        );
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const stored = fieldFirestoreData({
        id: interventionId,
        fieldAuthorityVersion: FIELD_WORK_INTERVENTION_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: normalizedVisitAssetId,
        assetId: visitAsset.assetId,
        plannedWorkLineId: normalizedPlannedWorkLineId,
        serviceCatalogItemId: normalizedServiceId,
        interventionType: canonicalService.label,
        origin: 'planned',
        requestedBy: 'office',
        status: 'confirmed',
        // Confirmation records what work is linked to this Asset. Actual performers are recorded
        // only when the intervention execution lifecycle starts/completes; do not pre-claim work.
        performedByStaffIds: [],
        ...actorFields(identity, occurredAt),
      }, 'workIntervention');
      const workIntervention = projectWorkIntervention(stored, expectedContext);
      const event = workInterventionAuditEvent({
        requestId: stable,
        intervention: workIntervention,
        context,
        identity,
        occurredAt,
      });

      transaction.create(interventionRef, stored);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        workIntervention,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.FIELD_WORK_INTERVENTION_STORAGE_VERSION = FIELD_WORK_INTERVENTION_STORAGE_VERSION;
module.exports.WORK_INTERVENTION_COLLECTION = WORK_INTERVENTION_COLLECTION;
module.exports.WORK_INTERVENTION_MUTABLE_VISIT_STATUSES = WORK_INTERVENTION_MUTABLE_VISIT_STATUSES;
module.exports.attachWorkInterventionsToJob = attachWorkInterventionsToJob;
module.exports.canAddPlannedIntervention = canAddPlannedIntervention;
module.exports.coveringIntervention = coveringIntervention;
module.exports.createPlannedWorkInterventionCommand = createPlannedWorkInterventionCommand;
module.exports.loadFieldServiceCatalog = loadFieldServiceCatalog;
module.exports.loadWorkInterventions = loadWorkInterventions;
module.exports.plannedInterventionOptions = plannedInterventionOptions;
module.exports.plannedWorkProgress = plannedWorkProgress;
module.exports.projectWorkIntervention = projectWorkIntervention;
module.exports.workInterventionAuditEvent = workInterventionAuditEvent;
