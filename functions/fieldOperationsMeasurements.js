'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  projectStoredReportTemplateSnapshot,
  requireReportTemplateSection,
} = require('./fieldOperationsReportTemplates');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const FIELD_MEASUREMENT_STORAGE_VERSION = 1;
const FIELD_MEASUREMENT_COLLECTION = 'fieldMeasurements';
const FIELD_MEASUREMENT_MOMENTS = new Set(['before', 'during', 'after', 'diagnostic', 'general']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function canonicalMeasurementValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw fieldError('invalid_field_measurement_value', 'Measurement value must be finite.', 400);
    return value;
  }
  const normalized = text(value, 240);
  if (!normalized) throw fieldError('invalid_field_measurement_value', 'Measurement value is required.', 400);
  return normalized;
}

function measurementId(interventionId, sectionId, requestId) {
  const intervention = text(interventionId, 180);
  const section = text(sectionId, 120);
  const stable = text(requestId, 240);
  if (!intervention || !section || !stable) throw new Error('Intervention, section and request identity are required.');
  return deterministicId('MEAS', `${intervention}:${section}:${stable}`);
}

function projectFieldMeasurement(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_MEASUREMENT_STORAGE_VERSION) {
    throw fieldError('invalid_field_measurement_schema', 'Persisted Field Measurement storage version is invalid.', 409);
  }
  const required = {
    id: text(record?.id, 180),
    visitId: text(record?.visitId, 180),
    workOrderId: text(record?.workOrderId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId || record?.siteId, 180),
    visitAssetId: text(record?.visitAssetId, 180),
    assetId: text(record?.assetId, 180),
    interventionId: text(record?.interventionId, 180),
    sectionId: text(record?.sectionId, 120),
  };
  if (Object.values(required).some((value) => !value)) {
    throw fieldError('field_measurement_identity_conflict', 'Persisted Field Measurement identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const normalizedExpected = text(expected, key === 'sectionId' ? 120 : 180);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('field_measurement_identity_conflict', 'Persisted Field Measurement does not match its authorized context.', 409, { key });
    }
  }
  const metric = text(record?.metric, 160);
  const unit = text(record?.unit, 80);
  const moment = text(record?.moment, 40);
  const technicianStaffId = text(record?.technicianStaffId, 180);
  const measuredAt = text(record?.measuredAt, 80);
  if (!metric || !unit || !FIELD_MEASUREMENT_MOMENTS.has(moment) || !technicianStaffId) {
    throw fieldError('invalid_field_measurement', 'Persisted Field Measurement metadata is invalid.', 409);
  }
  const value = canonicalMeasurementValue(record?.value);
  if (!measuredAt || Number.isNaN(Date.parse(measuredAt))) {
    throw fieldError('invalid_field_measurement_timestamp', 'Persisted Field Measurement measuredAt is invalid.', 409);
  }
  const version = Number(record?.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw fieldError('invalid_field_measurement_version', 'Persisted Field Measurement version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    metric,
    value,
    unit,
    moment,
    technicianStaffId,
    measuredAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function measurementAuditEvent({ requestId, measurement, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:field_measurement_recorded:${measurement.id}`),
    type: 'field_measurement_recorded',
    entityType: 'FieldMeasurement',
    entityId: measurement.id,
    visitId: measurement.visitId,
    visitAssetId: measurement.visitAssetId,
    assetId: measurement.assetId,
    interventionId: measurement.interventionId,
    sectionId: measurement.sectionId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    after: {
      sectionId: measurement.sectionId,
      metric: measurement.metric,
      unit: measurement.unit,
      moment: measurement.moment,
    },
  };
}

function createAddFieldMeasurementCommand({
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

  return async function addFieldMeasurement({
    identity,
    visitId,
    interventionId,
    sectionId,
    metric,
    value,
    unit,
    moment,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    const normalizedMetric = text(metric, 160);
    const normalizedUnit = text(unit, 80);
    const normalizedMoment = text(moment, 40);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    if (!normalizedMetric) throw fieldError('field_measurement_metric_required', 'A measurement metric is required.', 400);
    if (!normalizedUnit) throw fieldError('field_measurement_unit_required', 'A measurement unit is required.', 400);
    if (!FIELD_MEASUREMENT_MOMENTS.has(normalizedMoment)) {
      throw fieldError('invalid_field_measurement_moment', 'Measurement moment is invalid.', 400);
    }
    const normalizedValue = canonicalMeasurementValue(value);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'measurement.add',
        deniedMessage: 'This assignment cannot add measurements to the visit.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('field_measurement_not_allowed', 'Measurements can only be recorded while the physical visit is in progress.', 409, {
          visitStatus: context.canonicalVisit.status,
        });
      }
      const staffId = text(identity?.staffId, 180);
      if (!staffId) throw fieldError('technician_staff_required', 'Field measurements require a DEMAC staff identity.', 403);
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      const interventionRef = db.collection(WORK_INTERVENTION_COLLECTION).doc(normalizedInterventionId);
      const interventionSnapshot = await transaction.get(interventionRef);
      if (!interventionSnapshot.exists) {
        throw fieldError('work_intervention_not_found', 'The selected Work Intervention is not available for this visit.', 404);
      }
      const storedIntervention = fieldSnapshotRecord(interventionSnapshot);
      const intervention = projectWorkIntervention(storedIntervention, expectedContext);
      if (intervention.status !== 'in_progress') {
        throw fieldError('field_measurement_not_allowed', 'Measurements require an in-progress Work Intervention.', 409, {
          interventionStatus: intervention.status,
        });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      requireReportTemplateSection(template, normalizedSectionId, 'measurement_table');

      const id = measurementId(normalizedInterventionId, normalizedSectionId, stable);
      const measurementRef = db.collection(FIELD_MEASUREMENT_COLLECTION).doc(id);
      const exactContext = {
        ...expectedContext,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
      };
      const existingSnapshot = await transaction.get(measurementRef);
      if (existingSnapshot.exists) {
        const existing = projectFieldMeasurement(fieldSnapshotRecord(existingSnapshot), exactContext);
        if (
          existing.metric !== normalizedMetric
          || existing.value !== normalizedValue
          || existing.unit !== normalizedUnit
          || existing.moment !== normalizedMoment
        ) {
          throw fieldError('field_measurement_request_conflict', 'This requestId was already used for different measurement input.', 409);
        }
        result = {
          success: true,
          replayed: true,
          measurement: existing,
          workInterventionVersion: intervention.version,
          allowedActions: context.allowedActions,
        };
        return;
      }

      if (!Number.isSafeInteger(intervention.version) || intervention.version >= Number.MAX_SAFE_INTEGER) {
        throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409);
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const record = fieldFirestoreData({
        id,
        fieldAuthorityVersion: FIELD_MEASUREMENT_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        metric: normalizedMetric,
        value: normalizedValue,
        unit: normalizedUnit,
        moment: normalizedMoment,
        technicianStaffId: staffId,
        measuredAt: occurredAt,
        createdAt: occurredAt,
        createdByUserId: text(identity?.uid, 180),
        createdByStaffId: staffId,
        createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: 1,
      }, 'fieldMeasurement');
      const measurement = projectFieldMeasurement(record, exactContext);
      const currentSectionStatus = storedIntervention.reportSectionStatus && typeof storedIntervention.reportSectionStatus === 'object'
        ? { ...storedIntervention.reportSectionStatus }
        : {};
      currentSectionStatus[normalizedSectionId] = 'in_progress';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus: currentSectionStatus,
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: intervention.version + 1,
      }, 'workInterventionMeasurement');
      const event = measurementAuditEvent({ requestId: stable, measurement, context, identity, occurredAt });

      transaction.create(measurementRef, record);
      transaction.update(interventionRef, interventionPatch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        measurement,
        workInterventionVersion: intervention.version + 1,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

async function loadFieldMeasurements(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const context = { ...expectedContext, visitId: normalizedVisitId };
  const snapshot = await db.collection(FIELD_MEASUREMENT_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map(fieldSnapshotRecord)
    .map((record) => projectFieldMeasurement(record, context))
    .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt) || left.id.localeCompare(right.id));
}

module.exports.FIELD_MEASUREMENT_COLLECTION = FIELD_MEASUREMENT_COLLECTION;
module.exports.FIELD_MEASUREMENT_MOMENTS = FIELD_MEASUREMENT_MOMENTS;
module.exports.FIELD_MEASUREMENT_STORAGE_VERSION = FIELD_MEASUREMENT_STORAGE_VERSION;
module.exports.canonicalMeasurementValue = canonicalMeasurementValue;
module.exports.createAddFieldMeasurementCommand = createAddFieldMeasurementCommand;
module.exports.loadFieldMeasurements = loadFieldMeasurements;
module.exports.measurementAuditEvent = measurementAuditEvent;
module.exports.measurementId = measurementId;
module.exports.projectFieldMeasurement = projectFieldMeasurement;