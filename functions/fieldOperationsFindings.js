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

const FIELD_FINDING_STORAGE_VERSION = 1;
const FIELD_FINDING_COLLECTION = 'fieldFindings';

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function findingId(interventionId, sectionId, requestId) {
  const intervention = text(interventionId, 180);
  const section = text(sectionId, 120);
  const stable = text(requestId, 240);
  if (!intervention || !section || !stable) throw new Error('Intervention, section and request identity are required.');
  return deterministicId('FIND', `${intervention}:${section}:${stable}`);
}

function projectFieldFinding(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_FINDING_STORAGE_VERSION) {
    throw fieldError('invalid_field_finding_schema', 'Persisted Field Finding storage version is invalid.', 409);
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
    throw fieldError('field_finding_identity_conflict', 'Persisted Field Finding identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const normalizedExpected = text(expected, key === 'sectionId' ? 120 : 180);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('field_finding_identity_conflict', 'Persisted Field Finding does not match its authorized context.', 409, { key });
    }
  }
  const summary = text(record?.summary, 240);
  const details = text(record?.details, 2000);
  const recommendation = text(record?.recommendation, 1500);
  const technicianStaffId = text(record?.technicianStaffId, 180);
  const observedAt = text(record?.observedAt, 80);
  if (summary.length < 3 || details.length < 3 || !technicianStaffId) {
    throw fieldError('invalid_field_finding', 'Persisted Field Finding content is invalid.', 409);
  }
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
    throw fieldError('invalid_field_finding_timestamp', 'Persisted Field Finding observedAt is invalid.', 409);
  }
  const version = Number(record?.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw fieldError('invalid_field_finding_version', 'Persisted Field Finding version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    summary,
    details,
    recommendation: recommendation || undefined,
    technicianStaffId,
    observedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function findingAuditEvent({ requestId, finding, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:field_finding_recorded:${finding.id}`),
    type: 'field_finding_recorded',
    entityType: 'FieldFinding',
    entityId: finding.id,
    visitId: finding.visitId,
    visitAssetId: finding.visitAssetId,
    assetId: finding.assetId,
    interventionId: finding.interventionId,
    sectionId: finding.sectionId,
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
      sectionId: finding.sectionId,
      summary: finding.summary,
      hasRecommendation: Boolean(finding.recommendation),
    },
  };
}

function createAddFieldFindingCommand({
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

  return async function addFieldFinding({
    identity,
    visitId,
    interventionId,
    sectionId,
    summary,
    details,
    recommendation,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    const normalizedSummary = text(summary, 240);
    const normalizedDetails = text(details, 2000);
    const normalizedRecommendation = text(recommendation, 1500);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    if (normalizedSummary.length < 3) throw fieldError('field_finding_summary_required', 'A short finding summary is required.', 400);
    if (normalizedDetails.length < 3) throw fieldError('field_finding_details_required', 'Technical finding details are required.', 400);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'finding.add',
        deniedMessage: 'This assignment cannot add technical findings to the visit.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('field_finding_not_allowed', 'Findings can only be recorded while the physical visit is in progress.', 409, {
          visitStatus: context.canonicalVisit.status,
        });
      }
      const staffId = text(identity?.staffId, 180);
      if (!staffId) throw fieldError('technician_staff_required', 'Field findings require a DEMAC staff identity.', 403);
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
        throw fieldError('field_finding_not_allowed', 'Findings require an in-progress Work Intervention.', 409, {
          interventionStatus: intervention.status,
        });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      requireReportTemplateSection(template, normalizedSectionId, 'findings');

      const id = findingId(normalizedInterventionId, normalizedSectionId, stable);
      const findingRef = db.collection(FIELD_FINDING_COLLECTION).doc(id);
      const exactContext = {
        ...expectedContext,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
      };
      const existingSnapshot = await transaction.get(findingRef);
      if (existingSnapshot.exists) {
        const existing = projectFieldFinding(fieldSnapshotRecord(existingSnapshot), exactContext);
        if (
          existing.summary !== normalizedSummary
          || existing.details !== normalizedDetails
          || (existing.recommendation || '') !== normalizedRecommendation
        ) {
          throw fieldError('field_finding_request_conflict', 'This requestId was already used for different finding input.', 409);
        }
        result = {
          success: true,
          replayed: true,
          finding: existing,
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
        fieldAuthorityVersion: FIELD_FINDING_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        summary: normalizedSummary,
        details: normalizedDetails,
        recommendation: normalizedRecommendation || undefined,
        technicianStaffId: staffId,
        observedAt: occurredAt,
        createdAt: occurredAt,
        createdByUserId: text(identity?.uid, 180),
        createdByStaffId: staffId,
        createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: 1,
      }, 'fieldFinding');
      const finding = projectFieldFinding(record, exactContext);
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
      }, 'workInterventionFinding');
      const event = findingAuditEvent({ requestId: stable, finding, context, identity, occurredAt });

      transaction.create(findingRef, record);
      transaction.update(interventionRef, interventionPatch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        finding,
        workInterventionVersion: intervention.version + 1,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

async function loadFieldFindings(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const context = { ...expectedContext, visitId: normalizedVisitId };
  const snapshot = await db.collection(FIELD_FINDING_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map(fieldSnapshotRecord)
    .map((record) => projectFieldFinding(record, context))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
}

module.exports.FIELD_FINDING_COLLECTION = FIELD_FINDING_COLLECTION;
module.exports.FIELD_FINDING_STORAGE_VERSION = FIELD_FINDING_STORAGE_VERSION;
module.exports.createAddFieldFindingCommand = createAddFieldFindingCommand;
module.exports.findingAuditEvent = findingAuditEvent;
module.exports.findingId = findingId;
module.exports.loadFieldFindings = loadFieldFindings;
module.exports.projectFieldFinding = projectFieldFinding;