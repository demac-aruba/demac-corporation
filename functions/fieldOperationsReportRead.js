'use strict';

const { fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { projectStoredReportTemplateSnapshot } = require('./fieldOperationsReportTemplates');
const {
  REPORT_EVIDENCE_TARGET_TYPE,
  projectReportPhotoEvidence,
} = require('./fieldOperationsReportEvidence');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const REPORT_SECTION_STATUSES = new Set(['pending', 'in_progress', 'completed']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map(fieldSnapshotRecord);
}

function projectReportSectionStatus(value, template) {
  if (!template) {
    if (value !== undefined && value !== null) {
      throw fieldError('work_intervention_report_state_conflict', 'Work Intervention has report section state without a frozen report template.', 409);
    }
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section state is missing or invalid.', 409);
  }
  const expectedIds = template.sections.map((section) => section.id);
  const actualIds = Object.keys(value);
  if (actualIds.length !== expectedIds.length || expectedIds.some((id) => !Object.prototype.hasOwnProperty.call(value, id))) {
    throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section state does not match its frozen template.', 409);
  }
  const result = {};
  for (const id of expectedIds) {
    const status = text(value[id], 40);
    if (!REPORT_SECTION_STATUSES.has(status)) {
      throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section status is invalid.', 409, { sectionId: id, status: status || null });
    }
    result[id] = status;
  }
  return result;
}

function reportProjectionFromStored(storedRecord, projectedIntervention) {
  const template = projectStoredReportTemplateSnapshot(
    storedRecord?.reportTemplateSnapshot,
    projectedIntervention.serviceCatalogItemId,
  );
  const sectionStatus = projectReportSectionStatus(storedRecord?.reportSectionStatus, template);
  if (!template) {
    if (projectedIntervention.templateId || projectedIntervention.templateVersion !== undefined) {
      throw fieldError('work_intervention_report_state_conflict', 'Work Intervention template identity exists without a frozen report template.', 409);
    }
    return undefined;
  }
  if (projectedIntervention.templateId !== template.id || projectedIntervention.templateVersion !== template.version) {
    throw fieldError('work_intervention_template_identity_conflict', 'Work Intervention template identity does not match its frozen report template.', 409);
  }
  return {
    interventionId: projectedIntervention.id,
    visitAssetId: projectedIntervention.visitAssetId,
    assetId: projectedIntervention.assetId,
    serviceCatalogItemId: projectedIntervention.serviceCatalogItemId,
    template,
    sectionStatus,
    evidence: [],
  };
}

async function loadInterventionReportRecords(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) return [];
  const expectedContext = {
    visitId,
    workOrderId: text(job?.workOrderId, 180),
    customerId: text(job?.customerId, 180),
    propertyId: text(job?.propertyId, 180),
  };
  const rawSnapshot = await db.collection(WORK_INTERVENTION_COLLECTION).where('visitId', '==', visitId).get();
  const rawById = new Map(snapshotRecords(rawSnapshot).map((record) => [record.id, record]));
  const reports = [];
  for (const intervention of job?.workInterventions || []) {
    const raw = rawById.get(intervention.id);
    if (!raw) {
      throw fieldError('work_intervention_identity_conflict', 'Projected Work Intervention is missing from canonical persistence.', 409);
    }
    const current = projectWorkIntervention(raw, expectedContext);
    if (current.id !== intervention.id || current.version !== intervention.version) {
      throw fieldError('work_intervention_identity_conflict', 'Work Intervention report projection does not match the canonical job projection.', 409);
    }
    const report = reportProjectionFromStored(raw, current);
    if (report) reports.push(report);
  }
  return reports;
}

async function attachReportEvidence(db, job, reports) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId || reports.length === 0) return reports;
  const snapshot = await db.collection('fieldEvidence').where('visitId', '==', visitId).get();
  const reportByInterventionId = new Map(reports.map((report) => [report.interventionId, report]));
  for (const record of snapshotRecords(snapshot)) {
    if (text(record?.targetType, 80) !== REPORT_EVIDENCE_TARGET_TYPE) continue;
    const interventionId = text(record?.interventionId, 180);
    const report = reportByInterventionId.get(interventionId);
    if (!report) {
      throw fieldError('report_evidence_identity_conflict', 'Persisted report evidence references an intervention without a canonical report projection.', 409);
    }
    const section = report.template.sections.find((candidate) => candidate.id === text(record?.sectionId, 120));
    if (!section || section.type !== 'photos') {
      throw fieldError('report_evidence_identity_conflict', 'Persisted report photo references an invalid report section.', 409);
    }
    report.evidence.push(projectReportPhotoEvidence(record, {
      visitId,
      workOrderId: text(job.workOrderId, 180),
      customerId: text(job.customerId, 180),
      propertyId: text(job.propertyId, 180),
      visitAssetId: report.visitAssetId,
      assetId: report.assetId,
      interventionId,
      sectionId: section.id,
    }));
  }
  for (const report of reports) {
    report.evidence.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id));
  }
  return reports;
}

function reportPhotoOptions(job, reports) {
  if (text(job?.fieldVisit?.status, 80) !== 'in_progress') return [];
  if (!Array.isArray(job?.allowedActions) || !job.allowedActions.includes('evidence.add')) return [];
  const interventionById = new Map((job?.workInterventions || []).map((intervention) => [intervention.id, intervention]));
  return reports.map((report) => {
    const intervention = interventionById.get(report.interventionId);
    if (!intervention || intervention.status !== 'in_progress') return null;
    const sectionIds = report.template.sections
      .filter((section) => section.type === 'photos')
      .filter((section) => report.sectionStatus?.[section.id] !== 'completed')
      .map((section) => section.id);
    return sectionIds.length > 0 ? { interventionId: report.interventionId, sectionIds } : null;
  }).filter(Boolean);
}

async function attachInterventionReportsToJob(db, job) {
  const reports = await attachReportEvidence(db, job, await loadInterventionReportRecords(db, job));
  const options = reportPhotoOptions(job, reports);
  return {
    ...job,
    interventionReports: reports,
    reportPhotoOptions: options,
    canAddReportPhoto: options.length > 0,
  };
}

module.exports.REPORT_SECTION_STATUSES = REPORT_SECTION_STATUSES;
module.exports.attachInterventionReportsToJob = attachInterventionReportsToJob;
module.exports.attachReportEvidence = attachReportEvidence;
module.exports.loadInterventionReportRecords = loadInterventionReportRecords;
module.exports.projectReportSectionStatus = projectReportSectionStatus;
module.exports.reportPhotoOptions = reportPhotoOptions;
module.exports.reportProjectionFromStored = reportProjectionFromStored;