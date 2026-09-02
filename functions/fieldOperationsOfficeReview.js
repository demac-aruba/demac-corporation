'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { activeWorkOrder, fieldError } = require('./fieldOperationsAuthorityCore');
const {
  assertExistingVisitCompatible,
  projectCanonicalWorkVisit,
  stableRequestId,
  storageStatusFromCanonical,
} = require('./fieldOperationsAuthorityWorkVisit');
const { transitionCanonicalWorkVisit } = require('./fieldOperationsAuthorityTransitions');
const { projectActivatedVisit } = require('./fieldOperationsVisitActions');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  orderedWorkVisitChain,
  selectCurrentWorkVisit,
  workVisitScopeSignature,
} = require('./fieldOperationsVisitRead');
const { projectVisitAsset } = require('./fieldOperationsVisitAssets');
const {
  coveringIntervention,
  effectiveChainInterventions,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');
const {
  projectPlannedWorkDisposition,
} = require('./fieldOperationsPlannedWorkDispositions');
const { projectScopeChange } = require('./fieldOperationsScopeChanges');
const {
  projectFieldApproval,
  validateApprovalLinks,
} = require('./fieldOperationsApprovals');
const { reportProjectionFromStored } = require('./fieldOperationsReportRead');
const {
  REPORT_EVIDENCE_TARGET_TYPE,
  projectReportPhotoEvidence,
} = require('./fieldOperationsReportEvidence');
const {
  REPORT_VOICE_TARGET_TYPE,
  projectReportVoiceEvidence,
} = require('./fieldOperationsReportVoiceEvidence');
const { projectFieldMeasurement } = require('./fieldOperationsMeasurements');
const { projectFieldFinding } = require('./fieldOperationsFindings');
const { projectFieldChecklistResponse } = require('./fieldOperationsChecklistResponses');
const { projectFieldFreeTextResponse } = require('./fieldOperationsFreeTextResponses');
const { projectCustomerAcknowledgement } = require('./fieldOperationsCustomerAcknowledgements');
const { buildProfessionalReportPreview } = require('./fieldOperationsProfessionalReport');
const { projectFieldSaleLine } = require('./fieldOperationsSaleLines');
const {
  prepareInventoryHandoffInTransaction,
  loadInventoryHandoffInTransaction,
} = require('./fieldOperationsInventoryHandoffs');
const {
  prepareBillingCandidateInTransaction,
  loadBillingCandidateInTransaction,
} = require('./fieldOperationsBillingCandidates');

const FIELD_OFFICE_REVIEW_COLLECTION = 'fieldOfficeReviews';
const FIELD_OFFICE_REVIEW_REVISION_COLLECTION = 'fieldOfficeReviewRevisions';
const FIELD_OFFICE_REVIEW_STORAGE_VERSION = 1;
const FIELD_OFFICE_REVIEW_REVISION_VERSION = 1;
const OFFICE_REVIEW_STATUSES = new Set(['pending', 'returned', 'approved']);
const OFFICE_REVIEW_DECISIONS = new Set(['approve', 'return']);
const SUBMITTABLE_VISIT_STATUSES = new Set(['in_progress', 'pending']);
const TERMINAL_INTERVENTION_STATUSES = new Set(['completed', 'pending_part', 'not_performed', 'declined', 'cancelled']);
const TERMINAL_SALE_LINE_STATUSES = new Set(['sold', 'declined', 'voided']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function validTimestamp(value, field) {
  const result = text(value, 80);
  if (!result || Number.isNaN(Date.parse(result))) {
    throw fieldError('office_review_state_conflict', `Office Review ${field} is invalid.`, 409);
  }
  return result;
}

function positiveVersion(value, code = 'invalid_office_review_version') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError(code, 'Office Review version is invalid.', 409);
  }
  return value;
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map(fieldSnapshotRecord);
}

function officeReviewDocumentId(workOrderId) {
  const normalized = text(workOrderId, 180);
  if (!normalized) throw fieldError('work_order_required', 'A Work Order id is required.', 400);
  return deterministicId('FOR', normalized);
}

function officeReviewRevisionDocumentId(reviewId, revisionNumber) {
  const normalized = text(reviewId, 180);
  if (!normalized || !Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
    throw fieldError('office_review_revision_required', 'A valid Office Review revision identity is required.', 400);
  }
  return deterministicId('FORR', `${normalized}:${revisionNumber}`);
}

function projectOfficeReview(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_OFFICE_REVIEW_STORAGE_VERSION) {
    throw fieldError('invalid_office_review_schema', 'Persisted Office Review schema is invalid.', 409);
  }
  const projected = {
    id: text(record?.id, 180),
    workOrderId: text(record?.workOrderId, 180),
    appointmentId: text(record?.appointmentId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId, 180),
    visitId: text(record?.visitId, 180),
    status: text(record?.status, 80),
    currentRevisionId: text(record?.currentRevisionId, 180),
    currentRevisionNumber: positiveVersion(record?.currentRevisionNumber, 'invalid_office_review_revision'),
    submittedAt: validTimestamp(record?.submittedAt, 'submittedAt'),
    submittedBy: text(record?.submittedByUserId || record?.submittedBy, 180),
    reviewedAt: text(record?.reviewedAt, 80) || undefined,
    reviewedBy: text(record?.reviewedByUserId || record?.reviewedBy, 180) || undefined,
    reviewerName: text(record?.reviewerName, 180) || undefined,
    reviewerNote: text(record?.reviewerNote, 1500) || undefined,
    createdAt: validTimestamp(record?.createdAt, 'createdAt'),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: validTimestamp(record?.updatedAt, 'updatedAt'),
    version: positiveVersion(record?.version),
  };
  if (!projected.id || !projected.workOrderId || !projected.appointmentId || !projected.customerId
    || !projected.propertyId || !projected.visitId || !projected.currentRevisionId || !projected.submittedBy
    || !projected.createdBy) {
    throw fieldError('office_review_identity_conflict', 'Persisted Office Review identity is incomplete.', 409);
  }
  if (!OFFICE_REVIEW_STATUSES.has(projected.status)) {
    throw fieldError('invalid_office_review_status', 'Persisted Office Review status is invalid.', 409);
  }
  if (projected.reviewedAt && Number.isNaN(Date.parse(projected.reviewedAt))) {
    throw fieldError('office_review_state_conflict', 'Office Review reviewedAt is invalid.', 409);
  }
  if ((projected.status === 'approved' || projected.status === 'returned')
    && (!projected.reviewedAt || !projected.reviewedBy)) {
    throw fieldError('office_review_state_conflict', 'A decided Office Review is missing reviewer audit evidence.', 409);
  }
  for (const field of ['workOrderId', 'appointmentId', 'customerId', 'propertyId', 'visitId']) {
    const wanted = text(expected?.[field], 180);
    if (wanted && projected[field] !== wanted) {
      throw fieldError('office_review_identity_conflict', `Office Review ${field} does not match canonical Field truth.`, 409);
    }
  }
  return projected;
}

function projectOfficeReviewRevision(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_OFFICE_REVIEW_REVISION_VERSION) {
    throw fieldError('invalid_office_review_revision_schema', 'Persisted Office Review revision schema is invalid.', 409);
  }
  const projected = {
    id: text(record?.id, 180),
    reviewId: text(record?.reviewId, 180),
    revisionNumber: positiveVersion(record?.revisionNumber, 'invalid_office_review_revision'),
    workOrderId: text(record?.workOrderId, 180),
    appointmentId: text(record?.appointmentId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId, 180),
    visitId: text(record?.visitId, 180),
    sourceVisitVersion: positiveVersion(record?.sourceVisitVersion, 'invalid_office_review_source_version'),
    submittedAt: validTimestamp(record?.submittedAt, 'revision submittedAt'),
    submittedBy: text(record?.submittedByUserId || record?.submittedBy, 180),
    requestId: text(record?.requestId, 240),
    correctionOfRevisionId: text(record?.correctionOfRevisionId, 180) || undefined,
    officeReturnNote: text(record?.officeReturnNote, 1500) || undefined,
    technicianCorrectionNote: text(record?.technicianCorrectionNote, 1500) || undefined,
    snapshot: record?.snapshot,
    version: positiveVersion(record?.version, 'invalid_office_review_revision'),
  };
  if (!projected.id || !projected.reviewId || !projected.workOrderId || !projected.appointmentId
    || !projected.customerId || !projected.propertyId || !projected.visitId || !projected.submittedBy
    || projected.requestId.length < 8 || !projected.snapshot || typeof projected.snapshot !== 'object'
    || Array.isArray(projected.snapshot)) {
    throw fieldError('office_review_revision_identity_conflict', 'Persisted Office Review revision identity is incomplete.', 409);
  }
  const expectedRevisionId = officeReviewRevisionDocumentId(projected.reviewId, projected.revisionNumber);
  if (projected.id !== expectedRevisionId) {
    throw fieldError('office_review_revision_identity_conflict', 'Office Review revision id does not match its immutable sequence.', 409);
  }
  if (projected.revisionNumber === 1 && (projected.correctionOfRevisionId || projected.officeReturnNote || projected.technicianCorrectionNote)) {
    throw fieldError('office_review_revision_identity_conflict', 'The first Office Review revision cannot be a correction.', 409);
  }
  if (projected.revisionNumber > 1) {
    const priorRevisionId = officeReviewRevisionDocumentId(projected.reviewId, projected.revisionNumber - 1);
    if (projected.correctionOfRevisionId !== priorRevisionId || !projected.officeReturnNote || !projected.technicianCorrectionNote) {
      throw fieldError('office_review_revision_identity_conflict', 'Corrected Office Review revision is missing immutable correction context.', 409);
    }
  }
  for (const field of ['reviewId', 'workOrderId', 'appointmentId', 'customerId', 'propertyId', 'visitId']) {
    const wanted = text(expected?.[field], 180);
    if (wanted && projected[field] !== wanted) {
      throw fieldError('office_review_revision_identity_conflict', `Office Review revision ${field} does not match canonical truth.`, 409);
    }
  }
  return projected;
}

function orderedVisitChain(records, workOrderId) {
  const chain = orderedWorkVisitChain(records, workOrderId);
  if (chain.length === 0) throw fieldError('visit_not_found', 'Office Review requires a physical Work Visit.', 404);
  return chain;
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.entityId || ''}:${blocker.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blocker(code, message, entityId) {
  return { code, message, ...(entityId ? { entityId } : {}) };
}

async function readVisitChildren({ db, read, visitIds }) {
  const collections = [
    'visitAssets', 'workInterventions', 'plannedWorkDispositions', 'scopeChanges', 'fieldSaleLines', 'fieldApprovals',
    'fieldEvidence', 'fieldMeasurements', 'fieldFindings', 'fieldChecklistResponses', 'fieldFreeTextResponses',
    'fieldCustomerAcknowledgements',
  ];
  const snapshots = await Promise.all(collections.flatMap((collection) => (
    visitIds.map((visitId) => read(db.collection(collection).where('visitId', '==', visitId)))
  )));
  const result = Object.fromEntries(collections.map((collection) => [collection, []]));
  let index = 0;
  for (const collection of collections) {
    for (const _visitId of visitIds) result[collection].push(...snapshotRecords(snapshots[index++]));
  }
  return result;
}

function composeOfficeReviewReportContent({ reports, interventions, children, expectedFor }) {
  const projected = reports.map((report) => ({
    ...report,
    evidence: [],
    measurements: [],
    findings: [],
    checklistResponses: [],
    freeTextResponses: [],
    customerAcknowledgements: [],
    voiceNotes: [],
  }));
  const reportByInterventionId = new Map(projected.map((report) => [report.interventionId, report]));
  const interventionById = new Map(interventions.map((intervention) => [intervention.id, intervention]));
  const singletonKeys = new Set();

  function contextFor(record, requiredType, singletonKind) {
    const interventionId = text(record?.interventionId, 180);
    const sectionId = text(record?.sectionId, 120);
    const report = reportByInterventionId.get(interventionId);
    const intervention = interventionById.get(interventionId);
    const section = report?.template.sections.find((candidate) => candidate.id === sectionId);
    if (!report || !intervention || !section || section.type !== requiredType
      || report.visitAssetId !== intervention.visitAssetId || report.assetId !== intervention.assetId) {
      throw fieldError('office_review_report_content_conflict', 'Report content does not resolve to its frozen intervention report section.', 409, {
        interventionId: interventionId || null,
        sectionId: sectionId || null,
        requiredType,
      });
    }
    if (singletonKind) {
      const key = `${singletonKind}:${interventionId}:${sectionId}`;
      if (singletonKeys.has(key)) {
        throw fieldError('office_review_report_content_conflict', 'A singleton report section contains duplicate canonical content.', 409, {
          interventionId,
          sectionId,
          singletonKind,
        });
      }
      singletonKeys.add(key);
    }
    return {
      report,
      section,
      expected: {
        ...expectedFor(intervention.visitId),
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId,
        sectionId,
      },
    };
  }

  for (const record of children.fieldEvidence) {
    const targetType = text(record?.targetType, 80);
    if (targetType === REPORT_EVIDENCE_TARGET_TYPE) {
      const { report, expected } = contextFor(record, 'photos');
      report.evidence.push(projectReportPhotoEvidence(record, expected));
    } else if (targetType === REPORT_VOICE_TARGET_TYPE) {
      const { report, expected } = contextFor(record, 'voice_note', 'voice_note');
      report.voiceNotes.push(projectReportVoiceEvidence(record, expected));
    }
  }
  for (const record of children.fieldMeasurements) {
    const { report, expected } = contextFor(record, 'measurement_table');
    report.measurements.push(projectFieldMeasurement(record, expected));
  }
  for (const record of children.fieldFindings) {
    const { report, expected } = contextFor(record, 'findings');
    report.findings.push(projectFieldFinding(record, expected));
  }
  for (const record of children.fieldChecklistResponses) {
    const { report, section, expected } = contextFor(record, 'checklist');
    const itemId = text(record?.itemId, 120);
    if (!section.checklistItems?.some((item) => item.id === itemId)) {
      throw fieldError('office_review_report_content_conflict', 'Checklist response does not resolve to its frozen checklist item.', 409);
    }
    const key = `checklist:${expected.interventionId}:${section.id}:${itemId}`;
    if (singletonKeys.has(key)) {
      throw fieldError('office_review_report_content_conflict', 'A checklist item contains duplicate canonical responses.', 409, {
        interventionId: expected.interventionId,
        sectionId: section.id,
        itemId,
      });
    }
    singletonKeys.add(key);
    report.checklistResponses.push(projectFieldChecklistResponse(record, { ...expected, itemId }));
  }
  for (const record of children.fieldFreeTextResponses) {
    const { report, expected } = contextFor(record, 'free_text', 'free_text');
    report.freeTextResponses.push(projectFieldFreeTextResponse(record, expected));
  }
  for (const record of children.fieldCustomerAcknowledgements) {
    const { report, expected } = contextFor(record, 'customer_acknowledgement', 'customer_acknowledgement');
    report.customerAcknowledgements.push(projectCustomerAcknowledgement(record, expected));
  }

  for (const report of projected) {
    report.evidence.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
    report.measurements.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt) || a.id.localeCompare(b.id));
    report.findings.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
    report.checklistResponses.sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.itemId.localeCompare(b.itemId));
    report.freeTextResponses.sort((a, b) => a.sectionId.localeCompare(b.sectionId));
    report.customerAcknowledgements.sort((a, b) => a.sectionId.localeCompare(b.sectionId));
    report.voiceNotes.sort((a, b) => a.sectionId.localeCompare(b.sectionId));

    for (const section of report.template.sections) {
      let contentComplete;
      if (section.type === 'checklist') {
        const checked = new Map(report.checklistResponses
          .filter((item) => item.sectionId === section.id)
          .map((item) => [item.itemId, item.checked]));
        contentComplete = section.checklistItems.length > 0
          && section.checklistItems.every((item) => checked.get(item.id) === true);
      } else if (section.type === 'free_text') {
        contentComplete = report.freeTextResponses.some((item) => item.sectionId === section.id && item.value.length > 0);
      } else if (section.type === 'voice_note') {
        contentComplete = report.voiceNotes.some((item) => item.sectionId === section.id);
      } else if (section.type === 'customer_acknowledgement') {
        contentComplete = report.customerAcknowledgements.some((item) => item.sectionId === section.id);
      } else {
        continue;
      }
      if (contentComplete !== (report.sectionStatus[section.id] === 'completed')) {
        throw fieldError('office_review_report_content_conflict', 'Report content does not match its persisted section completion state.', 409, {
          interventionId: report.interventionId,
          sectionId: section.id,
        });
      }
    }
  }
  return projected;
}

function projectedChainState({ visits, children, identity }) {
  const root = visits[0];
  const current = visits[visits.length - 1];
  const scopeSignature = workVisitScopeSignature(root);
  const blockers = [];
  for (const visit of visits.slice(1)) {
    if (workVisitScopeSignature(visit) !== scopeSignature) {
      throw fieldError('office_review_scope_conflict', 'Return Work Visits do not share the same immutable scheduled scope.', 409, { visitId: visit.id });
    }
  }

  const visitById = new Map(visits.map((visit, index) => [visit.id, { visit, index }]));
  const expectedFor = (visitId) => {
    const entry = visitById.get(visitId);
    if (!entry) throw fieldError('office_review_identity_conflict', 'Office Review child record is outside the physical visit chain.', 409);
    return {
      visitId,
      workOrderId: current.workOrderId,
      customerId: current.customerId,
      propertyId: current.propertyId,
    };
  };

  const visitAssets = children.visitAssets.map((record) => projectVisitAsset(record, expectedFor(text(record.visitId, 180))));
  const visitAssetById = new Map(visitAssets.map((asset) => [asset.id, asset]));
  const rawInterventionById = new Map(children.workInterventions.map((record) => [record.id, record]));
  const interventions = children.workInterventions.map((record) => projectWorkIntervention(record, expectedFor(text(record.visitId, 180))));
  let reports = interventions.map((intervention) => (
    reportProjectionFromStored(rawInterventionById.get(intervention.id), intervention)
  )).filter(Boolean);
  reports = composeOfficeReviewReportContent({ reports, interventions, children, expectedFor });
  const dispositions = children.plannedWorkDispositions.map((record) => (
    projectPlannedWorkDisposition(record, expectedFor(text(record.visitId, 180)))
  ));
  const scopeChanges = children.scopeChanges.map((record) => projectScopeChange(record, expectedFor(text(record.visitId, 180))));
  const saleLines = children.fieldSaleLines.map((record) => projectFieldSaleLine(record, expectedFor(text(record.visitId, 180))));
  const approvals = children.fieldApprovals.map((record) => projectFieldApproval(record, expectedFor(text(record.visitId, 180))));

  for (const visit of visits) {
    validateApprovalLinks({
      workInterventions: interventions.filter((item) => item.visitId === visit.id),
      scopeChanges: scopeChanges.filter((item) => item.visitId === visit.id),
      fieldSaleLines: saleLines.filter((item) => item.visitId === visit.id),
    }, approvals.filter((item) => item.visitId === visit.id));
  }

  const interventionById = new Map(interventions.map((item) => [item.id, item]));
  for (const line of saleLines) {
    if (!line.nonCatalog && !TERMINAL_SALE_LINE_STATUSES.has(line.status)) {
      blockers.push(blocker('field_sale_line_not_terminal', `Field Sale Line ${line.id} is still ${line.status}.`, line.id));
    }
    if (line.nonCatalog && (!line.officeReviewRequired || !['proposed', 'voided'].includes(line.status))) {
      blockers.push(blocker('field_sale_non_catalog_state_conflict', `Non-catalog Field Sale Line ${line.id} is not a valid Office Review draft.`, line.id));
    }
    if (line.interventionId) {
      const intervention = interventionById.get(line.interventionId);
      if (!intervention || intervention.visitId !== line.visitId) blockers.push(blocker('field_sale_intervention_conflict', `Field Sale Line ${line.id} does not resolve to its Work Intervention.`, line.id));
    }
    if (line.assetId && !visitAssets.some((asset) => asset.visitId === line.visitId && asset.assetId === line.assetId)) {
      blockers.push(blocker('field_sale_asset_conflict', `Field Sale Line ${line.id} does not resolve to a canonical Visit Asset.`, line.id));
    }
  }

  for (const intervention of interventions) {
    if (!TERMINAL_INTERVENTION_STATUSES.has(intervention.status)) {
      blockers.push(blocker('intervention_not_terminal', `Intervention ${intervention.id} is still ${intervention.status}.`, intervention.id));
    }
    const asset = visitAssetById.get(intervention.visitAssetId);
    if (!asset || asset.visitId !== intervention.visitId || asset.assetId !== intervention.assetId) {
      blockers.push(blocker('intervention_asset_conflict', `Intervention ${intervention.id} does not resolve to its canonical Visit Asset.`, intervention.id));
    }
    if (intervention.status === 'pending_part') {
      const visit = visitById.get(intervention.visitId)?.visit;
      if (!visit?.requiresSecondVisit || !text(visit.secondVisitReason, 1000)) {
        blockers.push(blocker('pending_part_without_return', `Intervention ${intervention.id} requires an explicit return-visit reason.`, intervention.id));
      }
    }
  }

  const effectiveInterventions = effectiveChainInterventions(interventions, visits.map((visit) => visit.id));
  const effectiveIds = new Set(effectiveInterventions.map((item) => item.id));

  for (const report of reports.filter((item) => effectiveIds.has(item.interventionId))) {
    if (!report.completion.complete) {
      for (const section of report.completion.incompleteRequiredSections) {
        blockers.push(blocker(
          'required_report_section_incomplete',
          `${report.interventionId}: required section ${section.title} is ${section.status}.`,
          `${report.interventionId}:${section.id}`,
        ));
      }
    }
  }

  const plannedWork = root.scheduledScopeSnapshot.workLines || [];
  const plannedWorkProgress = plannedWork.map((line) => {
    const plannedQuantity = Number(line.quantity);
    if (!Number.isSafeInteger(plannedQuantity) || plannedQuantity < 1) {
      throw fieldError('office_review_scope_conflict', 'Immutable planned work contains an invalid quantity.', 409, { plannedWorkLineId: line.id });
    }
    const linkedActualQuantity = effectiveInterventions.filter((item) => (
      item.plannedWorkLineId === line.id && coveringIntervention(item)
    )).length;
    const disposedQuantity = dispositions.filter((item) => item.plannedWorkLineId === line.id)
      .reduce((total, item) => total + item.quantity, 0);
    const remainingQuantity = plannedQuantity - linkedActualQuantity - disposedQuantity;
    if (remainingQuantity > 0) {
      blockers.push(blocker('planned_work_unreconciled', `Planned Work Line ${line.id} has ${remainingQuantity} unreconciled unit(s).`, line.id));
    }
    if (remainingQuantity < 0) {
      blockers.push(blocker('planned_work_overlinked', `Planned Work Line ${line.id} is over-linked by ${Math.abs(remainingQuantity)} unit(s).`, line.id));
    }
    return { id: text(line.id, 180), plannedQuantity, linkedActualQuantity, disposedQuantity, remainingQuantity: Math.max(0, remainingQuantity) };
  });

  if (!SUBMITTABLE_VISIT_STATUSES.has(current.status)) {
    blockers.push(blocker('visit_status_not_submittable', `Visit status ${current.status} cannot be submitted to Office Review.`, current.id));
  }
  if (!Array.isArray(identity?.allowedActions) || !identity.allowedActions.includes('visit.complete')) {
    blockers.push(blocker('visit_submission_not_authorized', 'The current assignment cannot submit the visit to Office Review.', current.id));
  }

  const uniqueAssets = [...new Map(visitAssets.map((asset) => [asset.assetId, asset])).values()];
  const professionalReportPreview = buildProfessionalReportPreview({
    workOrderId: current.workOrderId,
    customerId: current.customerId,
    propertyId: current.propertyId,
    fieldVisit: current,
    plannedWork,
    plannedWorkProgress,
    visitAssets: uniqueAssets,
    workInterventions: effectiveInterventions,
    interventionReports: reports.filter((report) => effectiveIds.has(report.interventionId)),
  });

  const finalizedBlockers = uniqueBlockers(blockers);
  return {
    allowed: finalizedBlockers.length === 0,
    blockers: finalizedBlockers,
    current,
    dispositions,
    effectiveInterventions,
    interventions,
    plannedWorkProgress,
    professionalReportPreview,
    reports,
    root,
    saleLines,
    scopeChanges,
    approvals,
    visitAssets,
    visits,
  };
}

async function buildChainState({ db, read, rawVisits, identity }) {
  const workOrderId = text(rawVisits?.[0]?.workOrderId, 180);
  const orderedRaw = orderedVisitChain(rawVisits, workOrderId);
  const visits = orderedRaw.map((record) => projectCanonicalWorkVisit(record));
  const children = await readVisitChildren({ db, read, visitIds: visits.map((visit) => visit.id) });
  return projectedChainState({ visits, children, identity });
}

function reviewSnapshot(state) {
  return {
    version: 1,
    source: 'canonical_field_truth',
    visitChain: state.visits.map((visit) => ({
      id: visit.id,
      previousVisitId: visit.previousVisitId,
      status: visit.status,
      version: visit.version,
      requiresSecondVisit: visit.requiresSecondVisit,
      secondVisitReason: visit.secondVisitReason,
    })),
    plannedWorkProgress: state.plannedWorkProgress,
    professionalReportPreview: state.professionalReportPreview,
    visitAssets: state.visitAssets.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      assetId: item.assetId,
      sequence: item.sequence,
      locationLabel: item.locationLabel,
      source: item.source,
      status: item.status,
      addedOnSite: item.addedOnSite,
      version: item.version,
    })),
    interventions: state.interventions.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      visitAssetId: item.visitAssetId,
      assetId: item.assetId,
      plannedWorkLineId: item.plannedWorkLineId,
      serviceCatalogItemId: item.serviceCatalogItemId,
      interventionType: item.interventionType,
      priceSnapshot: item.priceSnapshot,
      origin: item.origin,
      status: item.status,
      resultCode: item.resultCode,
      resultNotes: item.resultNotes,
      version: item.version,
    })),
    plannedWorkDispositions: state.dispositions.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      plannedWorkLineId: item.plannedWorkLineId,
      quantity: item.quantity,
      reasonCode: item.reasonCode,
      note: item.note,
      version: item.version,
    })),
    scopeChanges: state.scopeChanges.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      visitAssetId: item.visitAssetId,
      interventionId: item.interventionId,
      plannedWorkLineId: item.plannedWorkLineId,
      origin: item.origin,
      reason: item.reason,
      requestedAt: item.requestedAt,
      resolvedAt: item.resolvedAt,
      version: item.version,
    })),
    approvals: state.approvals.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      status: item.status,
      method: item.method,
      affected: item.affected,
      receiverName: item.receiverName,
      decidedAt: item.decidedAt,
      signatureEvidenceId: item.signatureEvidenceId,
      note: item.note,
      version: item.version,
    })),
    fieldSaleLines: state.saleLines.map((item) => ({
      id: item.id,
      visitId: item.visitId,
      interventionId: item.interventionId,
      assetId: item.assetId,
      catalogItemId: item.catalogItemId,
      descriptionSnapshot: item.descriptionSnapshot,
      quantity: item.quantity,
      unit: item.unit,
      priceSnapshot: item.priceSnapshot,
      status: item.status,
      soldByStaffId: item.soldByStaffId,
      requiresCustomerApproval: item.requiresCustomerApproval,
      customerApprovalId: item.customerApprovalId,
      nonCatalog: item.nonCatalog,
      officeReviewRequired: item.officeReviewRequired,
      notes: item.notes,
      version: item.version,
    })),
    reports: state.reports.map((report) => ({
      interventionId: report.interventionId,
      visitAssetId: report.visitAssetId,
      assetId: report.assetId,
      serviceCatalogItemId: report.serviceCatalogItemId,
      template: report.template,
      sectionStatus: report.sectionStatus,
      completion: report.completion,
      evidence: report.evidence,
      measurements: report.measurements,
      findings: report.findings,
      checklistResponses: report.checklistResponses,
      freeTextResponses: report.freeTextResponses,
      customerAcknowledgements: report.customerAcknowledgements,
      voiceNotes: report.voiceNotes,
    })),
    visitAssetCount: state.visitAssets.length,
    distinctAssetCount: new Set(state.visitAssets.map((asset) => asset.assetId)).size,
  };
}

function submissionAuditEvent({ requestId, review, revision, context, identity, occurredAt, priorStatus }) {
  return {
    id: deterministicId('FE', `${requestId}:office_review_submitted:${revision.id}`),
    type: priorStatus === 'returned' ? 'office_review_resubmitted' : 'office_review_submitted',
    entityType: 'OfficeReview',
    entityId: review.id,
    visitId: review.visitId,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customerId: review.clientId,
    propertyId: review.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    before: { visitStatus: context.canonicalVisit.status, reviewStatus: priorStatus || null },
    after: {
      visitStatus: 'ready_for_office_review',
      reviewStatus: 'pending',
      revisionNumber: revision.revisionNumber,
      technicianCorrectionNote: revision.technicianCorrectionNote,
    },
  };
}

function createSubmitOfficeReviewCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function submitOfficeReview({ identity, visitId, expectedVersion, requestId, correctionNote } = {}) {
    const normalizedVisitId = text(visitId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw fieldError('expected_version_required', 'A positive safe-integer expectedVersion is required.', 400);
    }
    const stable = stableRequestId(requestId);
    const normalizedCorrectionNote = text(correctionNote, 1500);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db, transaction, identity, visitId: normalizedVisitId, resolveAssignment,
        action: 'visit.complete',
        deniedMessage: 'Only the accountable Field assignment may submit this visit to Office Review.',
      });
      const reviewId = officeReviewDocumentId(context.workOrderId);
      const reviewRef = db.collection(FIELD_OFFICE_REVIEW_COLLECTION).doc(reviewId);
      const reviewSnapshotRecord = await transaction.get(reviewRef);
      const existingReview = reviewSnapshotRecord.exists
        ? projectOfficeReview(fieldSnapshotRecord(reviewSnapshotRecord), {
          workOrderId: context.workOrderId,
          customerId: context.customerId,
          propertyId: context.propertyId,
        })
        : null;

      if (existingReview?.status === 'pending') {
        const revisionRef = db.collection(FIELD_OFFICE_REVIEW_REVISION_COLLECTION).doc(existingReview.currentRevisionId);
        const revisionSnapshotRecord = await transaction.get(revisionRef);
        if (!revisionSnapshotRecord.exists) throw fieldError('office_review_revision_not_found', 'Current Office Review revision is missing.', 409);
        const revision = projectOfficeReviewRevision(fieldSnapshotRecord(revisionSnapshotRecord), { reviewId, workOrderId: context.workOrderId });
        if (revision.requestId === stable && revision.sourceVisitVersion === expectedVersion
          && existingReview.visitId === normalizedVisitId
          && text(revision.technicianCorrectionNote, 1500) === normalizedCorrectionNote) {
          result = {
            success: true,
            replayed: true,
            review: existingReview,
            revision,
            visit: projectActivatedVisit(context.canonicalVisit, context.allowedActions),
          };
          return;
        }
        throw fieldError('office_review_already_pending', 'This Work Order already has a pending Office Review revision.', 409);
      }
      if (existingReview?.status === 'approved') {
        throw fieldError('office_review_approved_immutable', 'An approved Office Review cannot be silently rewritten.', 409);
      }
      if (existingReview?.status === 'returned' && normalizedCorrectionNote.length < 3) {
        throw fieldError('office_review_correction_note_required', 'Corrected resubmission requires a short technician correction note.', 400);
      }
      if (!existingReview && normalizedCorrectionNote) {
        throw fieldError('office_review_correction_not_allowed', 'An initial Office Review submission cannot claim a prior correction.', 400);
      }
      if (context.canonicalVisit.version !== expectedVersion) {
        throw fieldError('version_conflict', 'This Work Visit changed on another device. Refresh before submitting.', 409, {
          expectedVersion,
          actualVersion: context.canonicalVisit.version,
        });
      }

      const state = await buildChainState({
        db,
        read: (target) => transaction.get(target),
        rawVisits: context.historyRecords,
        identity: { allowedActions: context.allowedActions },
      });
      if (!state.allowed) {
        throw fieldError('office_review_submission_blocked', 'Canonical Field truth is not ready for Office Review.', 409, { blockers: state.blockers });
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const nextVisit = transitionCanonicalWorkVisit({ visit: context.canonicalVisit, to: 'ready_for_office_review', at: occurredAt }).next;
      const revisionNumber = existingReview ? existingReview.currentRevisionNumber + 1 : 1;
      const revisionId = officeReviewRevisionDocumentId(reviewId, revisionNumber);
      const revision = fieldFirestoreData({
        id: revisionId,
        fieldAuthorityVersion: FIELD_OFFICE_REVIEW_REVISION_VERSION,
        reviewId,
        revisionNumber,
        workOrderId: context.workOrderId,
        appointmentId: context.appointmentId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitId: normalizedVisitId,
        sourceVisitVersion: expectedVersion,
        submittedAt: occurredAt,
        submittedByUserId: text(identity.uid, 180),
        submittedByStaffId: text(identity.staffId, 180) || undefined,
        submittedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        requestId: stable,
        correctionOfRevisionId: existingReview?.status === 'returned' ? existingReview.currentRevisionId : undefined,
        officeReturnNote: existingReview?.status === 'returned' ? existingReview.reviewerNote : undefined,
        technicianCorrectionNote: existingReview?.status === 'returned' ? normalizedCorrectionNote : undefined,
        snapshot: reviewSnapshot(state),
        version: 1,
      }, 'officeReviewRevision');
      const storedReview = fieldFirestoreData({
        id: reviewId,
        fieldAuthorityVersion: FIELD_OFFICE_REVIEW_STORAGE_VERSION,
        workOrderId: context.workOrderId,
        appointmentId: context.appointmentId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitId: normalizedVisitId,
        status: 'pending',
        currentRevisionId: revisionId,
        currentRevisionNumber: revisionNumber,
        submittedAt: occurredAt,
        submittedByUserId: text(identity.uid, 180),
        submittedByStaffId: text(identity.staffId, 180) || undefined,
        submittedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        createdAt: existingReview?.createdAt || occurredAt,
        createdByUserId: existingReview?.createdBy || text(identity.uid, 180),
        reviewedAt: null,
        reviewedByUserId: null,
        reviewedByStaffId: null,
        reviewerName: null,
        reviewerNote: null,
        updatedAt: occurredAt,
        updatedByUserId: text(identity.uid, 180),
        version: existingReview ? existingReview.version + 1 : 1,
      }, 'officeReview');
      const visitPatch = fieldFirestoreData({
        status: storageStatusFromCanonical(nextVisit.status),
        submittedAt: nextVisit.submittedAt,
        updatedAt: occurredAt,
        updatedByUserId: text(identity.uid, 180),
        updatedByStaffId: text(identity.staffId, 180) || undefined,
        updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        version: expectedVersion + 1,
        lastOfficeReviewSubmissionRequestId: stable,
      }, 'officeReviewVisitSubmission');

      transaction.update(context.visitRef, visitPatch);
      if (existingReview) transaction.update(reviewRef, storedReview);
      else transaction.create(reviewRef, storedReview);
      transaction.create(db.collection(FIELD_OFFICE_REVIEW_REVISION_COLLECTION).doc(revisionId), revision);
      await appendAuditInTransaction({
        transaction,
        event: submissionAuditEvent({
          requestId: stable,
          review: storedReview,
          revision,
          context,
          identity,
          occurredAt,
          priorStatus: existingReview?.status,
        }),
        visit: context.storedVisit,
        identity,
      });

      result = {
        success: true,
        replayed: false,
        review: projectOfficeReview(storedReview),
        revision: projectOfficeReviewRevision(revision),
        visit: projectActivatedVisit({ ...nextVisit, version: expectedVersion + 1, updatedAt: occurredAt, updatedBy: text(identity.uid, 180) }, context.allowedActions),
      };
    });
    return result;
  };
}

function decisionAuditEvent({ requestId, review, decision, note, identity, occurredAt, beforeVisitStatus, afterVisitStatus, inventoryHandoff, billingCandidate }) {
  return {
    id: deterministicId('FE', `${requestId}:office_review_${decision}:${review.id}:${review.currentRevisionId}`),
    type: decision === 'approve' ? 'office_review_approved' : 'office_review_returned',
    entityType: 'OfficeReview',
    entityId: review.id,
    visitId: review.visitId,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customerId: review.customerId,
    propertyId: review.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    before: { reviewStatus: 'pending', visitStatus: beforeVisitStatus },
    after: {
      reviewStatus: decision === 'approve' ? 'approved' : 'returned',
      visitStatus: afterVisitStatus,
      revisionNumber: review.currentRevisionNumber,
      note: text(note, 500) || undefined,
      inventoryHandoffId: inventoryHandoff?.id,
      inventoryHandoffStatus: inventoryHandoff?.status,
      billingCandidateId: billingCandidate?.id,
      billingCandidateStatus: billingCandidate?.status,
    },
  };
}

function createDecideOfficeReviewCommand({ db, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function decideOfficeReview({ identity, reviewId, decision, note, expectedVersion, requestId } = {}) {
    if (!identity?.operations) throw fieldError('permission_denied', 'Office Review decisions require an authorized office role.', 403);
    const normalizedReviewId = text(reviewId, 180);
    const normalizedDecision = text(decision, 80);
    const normalizedNote = text(note, 1500);
    if (!normalizedReviewId) throw fieldError('office_review_required', 'An Office Review id is required.', 400);
    if (!OFFICE_REVIEW_DECISIONS.has(normalizedDecision)) throw fieldError('office_review_decision_required', 'Office Review decision must be approve or return.', 400);
    if (normalizedDecision === 'return' && normalizedNote.length < 3) {
      throw fieldError('office_review_note_required', 'Returning Office Review requires a correction note.', 400);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw fieldError('expected_version_required', 'A positive safe-integer expectedVersion is required.', 400);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const reviewRef = db.collection(FIELD_OFFICE_REVIEW_COLLECTION).doc(normalizedReviewId);
      const reviewSnapshotRecord = await transaction.get(reviewRef);
      if (!reviewSnapshotRecord.exists) throw fieldError('office_review_not_found', 'Office Review is not available.', 404);
      const review = projectOfficeReview(fieldSnapshotRecord(reviewSnapshotRecord));
      const visitRef = db.collection('workVisits').doc(review.visitId);
      const orderRef = db.collection('workOrders').doc(review.workOrderId);
      const [visitSnapshotRecord, orderSnapshotRecord, historySnapshot, revisionSnapshotRecord] = await Promise.all([
        transaction.get(visitRef),
        transaction.get(orderRef),
        transaction.get(db.collection('workVisits').where('workOrderId', '==', review.workOrderId)),
        transaction.get(db.collection(FIELD_OFFICE_REVIEW_REVISION_COLLECTION).doc(review.currentRevisionId)),
      ]);
      if (!visitSnapshotRecord.exists) throw fieldError('visit_not_found', 'Office Review Work Visit is not available.', 404);
      if (!orderSnapshotRecord.exists) throw fieldError('work_order_not_found', 'Office Review Work Order is not available.', 404);
      if (!revisionSnapshotRecord.exists) throw fieldError('office_review_revision_not_found', 'Current Office Review revision is missing.', 409);
      const order = fieldSnapshotRecord(orderSnapshotRecord);
      const revision = projectOfficeReviewRevision(fieldSnapshotRecord(revisionSnapshotRecord), {
        reviewId: review.id,
        workOrderId: review.workOrderId,
        visitId: review.visitId,
      });
      const rawVisit = fieldSnapshotRecord(visitSnapshotRecord);
      const history = snapshotRecords(historySnapshot);
      for (const record of history) assertExistingVisitCompatible(record, order);
      const current = selectCurrentWorkVisit(history, review.workOrderId);
      if (!current || current.id !== review.visitId) throw fieldError('visit_not_current', 'Office Review may decide only the current physical Work Visit.', 409);
      const visit = projectCanonicalWorkVisit(rawVisit, { appointmentId: review.appointmentId, propertyId: review.propertyId });
      if (visit.customerId !== review.customerId || visit.propertyId !== review.propertyId || visit.appointmentId !== review.appointmentId) {
        throw fieldError('office_review_identity_conflict', 'Office Review identity does not match its Work Visit.', 409);
      }

      const targetStatus = normalizedDecision === 'approve' ? 'approved' : 'returned';
      if (review.status === targetStatus
        && text(rawVisit.lastOfficeReviewDecisionRequestId, 240) === stable
        && text(rawVisit.lastOfficeReviewDecision, 80) === normalizedDecision
        && text(review.reviewerNote, 1500) === normalizedNote) {
        const inventoryHandoff = normalizedDecision === 'approve'
          ? await loadInventoryHandoffInTransaction({ db, transaction, review })
          : null;
        const billingCandidate = normalizedDecision === 'approve'
          ? await loadBillingCandidateInTransaction({ db, transaction, review })
          : null;
        result = { success: true, replayed: true, review, visit: projectActivatedVisit(visit, ['read', 'office.review']), inventoryHandoff, billingCandidate };
        return;
      }
      if (!activeWorkOrder(order)) throw fieldError('work_order_not_available', 'This Work Order is no longer released for Office Review.', 409);
      if (review.status !== 'pending') throw fieldError('office_review_not_pending', 'Only a pending Office Review may be decided.', 409);
      if (review.version !== expectedVersion) {
        throw fieldError('version_conflict', 'This Office Review changed on another device. Refresh before deciding.', 409, {
          expectedVersion,
          actualVersion: review.version,
        });
      }
      if (visit.status !== 'ready_for_office_review') {
        throw fieldError('office_review_visit_not_ready', 'Office Review Work Visit is not awaiting a decision.', 409);
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const nextStatus = normalizedDecision === 'approve' ? 'completed' : 'in_progress';
      const nextVisit = transitionCanonicalWorkVisit({ visit, to: nextStatus, at: occurredAt }).next;
      const preparedInventoryHandoff = normalizedDecision === 'approve'
        ? await prepareInventoryHandoffInTransaction({
          db, transaction, review, revision, order, identity, requestId: stable, occurredAt,
        })
        : { handoff: null, create: null };
      const preparedBillingCandidate = normalizedDecision === 'approve'
        ? await prepareBillingCandidateInTransaction({
          db, transaction, review, revision, identity, requestId: stable, occurredAt,
        })
        : { candidate: null, create: null };
      if (preparedInventoryHandoff.create) {
        transaction.create(preparedInventoryHandoff.create.ref, preparedInventoryHandoff.create.value);
      }
      if (preparedBillingCandidate.create) {
        transaction.create(preparedBillingCandidate.create.ref, preparedBillingCandidate.create.value);
      }
      const inventoryHandoff = preparedInventoryHandoff.handoff;
      const billingCandidate = preparedBillingCandidate.candidate;
      const reviewPatch = fieldFirestoreData({
        status: targetStatus,
        reviewedAt: occurredAt,
        reviewedByUserId: text(identity.uid, 180),
        reviewedByStaffId: text(identity.staffId, 180) || undefined,
        reviewerName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        reviewerNote: normalizedNote || undefined,
        updatedAt: occurredAt,
        updatedByUserId: text(identity.uid, 180),
        version: review.version + 1,
        lastDecisionRequestId: stable,
        lastDecision: normalizedDecision,
      }, 'officeReviewDecision');
      const visitPatch = fieldFirestoreData({
        status: storageStatusFromCanonical(nextVisit.status),
        completedAt: nextVisit.completedAt,
        officeReviewReturnedAt: normalizedDecision === 'return' ? occurredAt : undefined,
        officeReviewReturnReason: normalizedDecision === 'return' ? normalizedNote : undefined,
        updatedAt: occurredAt,
        updatedByUserId: text(identity.uid, 180),
        updatedByStaffId: text(identity.staffId, 180) || undefined,
        updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        version: visit.version + 1,
        lastOfficeReviewDecisionRequestId: stable,
        lastOfficeReviewDecision: normalizedDecision,
      }, 'officeReviewVisitDecision');
      transaction.update(reviewRef, reviewPatch);
      transaction.update(visitRef, visitPatch);
      await appendAuditInTransaction({
        transaction,
        event: decisionAuditEvent({
          requestId: stable,
          review,
          decision: normalizedDecision,
          note: normalizedNote,
          identity,
          occurredAt,
          beforeVisitStatus: visit.status,
          afterVisitStatus: nextStatus,
          inventoryHandoff,
          billingCandidate,
        }),
        visit: rawVisit,
        identity,
      });
      const projectedReview = projectOfficeReview({
        ...review,
        ...reviewPatch,
        id: review.id,
        fieldAuthorityVersion: FIELD_OFFICE_REVIEW_STORAGE_VERSION,
      });
      result = {
        success: true,
        replayed: false,
        review: projectedReview,
        visit: projectActivatedVisit({ ...nextVisit, version: visit.version + 1, updatedAt: occurredAt, updatedBy: text(identity.uid, 180) }, ['read', 'office.review']),
        inventoryHandoff,
        billingCandidate,
      };
    });
    return result;
  };
}

async function loadOfficeReviewQueue(db, identity) {
  if (!identity?.operations) throw fieldError('permission_denied', 'Office Review queue requires an authorized office role.', 403);
  const snapshots = await Promise.all([
    db.collection(FIELD_OFFICE_REVIEW_COLLECTION).where('status', '==', 'pending').get(),
    db.collection(FIELD_OFFICE_REVIEW_COLLECTION).where('status', '==', 'returned').get(),
  ]);
  const reviews = snapshots.flatMap(snapshotRecords).map((record) => projectOfficeReview(record));
  const revisions = await Promise.all(reviews.map(async (review) => {
    const snapshot = await db.collection(FIELD_OFFICE_REVIEW_REVISION_COLLECTION).doc(review.currentRevisionId).get();
    if (!snapshot.exists) throw fieldError('office_review_revision_not_found', 'Current Office Review revision is missing.', 409);
    return projectOfficeReviewRevision(fieldSnapshotRecord(snapshot), { reviewId: review.id, workOrderId: review.workOrderId, visitId: review.visitId });
  }));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  return reviews.map((review) => ({ ...review, currentRevision: revisionById.get(review.currentRevisionId) }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

async function attachOfficeReviewSubmissionReadiness(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) return { ...job, officeReviewSubmission: null };
  const reviewId = officeReviewDocumentId(job.workOrderId);
  const reviewSnapshotRecord = await db.collection(FIELD_OFFICE_REVIEW_COLLECTION).doc(reviewId).get();
  const existingReview = reviewSnapshotRecord.exists
    ? projectOfficeReview(fieldSnapshotRecord(reviewSnapshotRecord), {
      workOrderId: job.workOrderId,
      customerId: job.customerId,
      propertyId: job.propertyId,
    })
    : null;
  if (existingReview?.status === 'pending' || existingReview?.status === 'approved') {
    return {
      ...job,
      officeReviewSubmission: {
        allowed: false,
        status: existingReview.status,
        reviewId: existingReview.id,
        revisionNumber: existingReview.currentRevisionNumber,
        correctionRequired: false,
        blockers: [],
      },
    };
  }
  if (!SUBMITTABLE_VISIT_STATUSES.has(job.fieldVisit.status)) {
    return {
      ...job,
      officeReviewSubmission: {
        allowed: false,
        status: existingReview?.status || 'blocked',
        reviewId: existingReview?.id,
        revisionNumber: existingReview?.currentRevisionNumber,
        correctionRequired: existingReview?.status === 'returned',
        reviewerNote: existingReview?.status === 'returned' ? existingReview.reviewerNote : undefined,
        blockers: [blocker('visit_status_not_submittable', `Visit status ${job.fieldVisit.status} cannot be submitted to Office Review.`, visitId)],
      },
    };
  }
  const historySnapshot = await db.collection('workVisits').where('workOrderId', '==', job.workOrderId).get();
  const rawVisits = snapshotRecords(historySnapshot);
  const state = await buildChainState({
    db,
    read: (target) => target.get(),
    rawVisits,
    identity: { allowedActions: job.allowedActions },
  });
  if (state.current.id !== visitId) throw fieldError('visit_not_current', 'Office Review readiness does not match the current physical Work Visit.', 409);
  return {
    ...job,
    officeReviewSubmission: {
      allowed: state.allowed,
      status: state.allowed ? 'ready' : existingReview?.status || 'blocked',
      reviewId: existingReview?.id,
      revisionNumber: existingReview?.currentRevisionNumber,
      correctionRequired: existingReview?.status === 'returned',
      reviewerNote: existingReview?.status === 'returned' ? existingReview.reviewerNote : undefined,
      blockers: state.blockers,
    },
  };
}

module.exports = {
  FIELD_OFFICE_REVIEW_COLLECTION,
  FIELD_OFFICE_REVIEW_REVISION_COLLECTION,
  FIELD_OFFICE_REVIEW_REVISION_VERSION,
  FIELD_OFFICE_REVIEW_STORAGE_VERSION,
  OFFICE_REVIEW_DECISIONS,
  OFFICE_REVIEW_STATUSES,
  SUBMITTABLE_VISIT_STATUSES,
  attachOfficeReviewSubmissionReadiness,
  createDecideOfficeReviewCommand,
  createSubmitOfficeReviewCommand,
  loadOfficeReviewQueue,
  officeReviewDocumentId,
  officeReviewRevisionDocumentId,
  orderedVisitChain,
  projectOfficeReview,
  projectOfficeReviewRevision,
  projectedChainState,
  reviewSnapshot,
};
