'use strict';

const { fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { projectStoredReportTemplateSnapshot } = require('./fieldOperationsReportTemplates');
const {
  REPORT_EVIDENCE_TARGET_TYPE,
  projectReportPhotoEvidence,
} = require('./fieldOperationsReportEvidence');
const { loadFieldMeasurements } = require('./fieldOperationsMeasurements');
const { loadFieldFindings } = require('./fieldOperationsFindings');
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
    measurements: [],
    findings: [],
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

async function attachReportMeasurements(db, job, reports) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId || reports.length === 0) return reports;
  const measurements = await loadFieldMeasurements(db, visitId, {
    workOrderId: text(job.workOrderId, 180),
    customerId: text(job.customerId, 180),
    propertyId: text(job.propertyId, 180),
  });
  const reportByInterventionId = new Map(reports.map((report) => [report.interventionId, report]));
  for (const measurement of measurements) {
    const report = reportByInterventionId.get(measurement.interventionId);
    if (!report) {
      throw fieldError('field_measurement_identity_conflict', 'Persisted Field Measurement references an intervention without a canonical report projection.', 409);
    }
    const section = report.template.sections.find((candidate) => candidate.id === measurement.sectionId);
    if (!section || section.type !== 'measurement_table') {
      throw fieldError('field_measurement_identity_conflict', 'Persisted Field Measurement references an invalid report section.', 409);
    }
    if (measurement.visitAssetId !== report.visitAssetId || measurement.assetId !== report.assetId) {
      throw fieldError('field_measurement_identity_conflict', 'Persisted Field Measurement does not match its Work Intervention equipment identity.', 409);
    }
    report.measurements.push(measurement);
  }
  for (const report of reports) {
    report.measurements.sort((left, right) => left.measuredAt.localeCompare(right.measuredAt) || left.id.localeCompare(right.id));
  }
  return reports;
}

async function attachReportFindings(db, job, reports) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId || reports.length === 0) return reports;
  const findings = await loadFieldFindings(db, visitId, {
    workOrderId: text(job.workOrderId, 180),
    customerId: text(job.customerId, 180),
    propertyId: text(job.propertyId, 180),
  });
  const reportByInterventionId = new Map(reports.map((report) => [report.interventionId, report]));
  for (const finding of findings) {
    const report = reportByInterventionId.get(finding.interventionId);
    if (!report) {
      throw fieldError('field_finding_identity_conflict', 'Persisted Field Finding references an intervention without a canonical report projection.', 409);
    }
    const section = report.template.sections.find((candidate) => candidate.id === finding.sectionId);
    if (!section || section.type !== 'findings') {
      throw fieldError('field_finding_identity_conflict', 'Persisted Field Finding references an invalid report section.', 409);
    }
    if (finding.visitAssetId !== report.visitAssetId || finding.assetId !== report.assetId) {
      throw fieldError('field_finding_identity_conflict', 'Persisted Field Finding does not match its Work Intervention equipment identity.', 409);
    }
    report.findings.push(finding);
  }
  for (const report of reports) {
    report.findings.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
  }
  return reports;
}

function reportSectionOptions(job, reports, action, sectionType) {
  if (text(job?.fieldVisit?.status, 80) !== 'in_progress') return [];
  if (!Array.isArray(job?.allowedActions) || !job.allowedActions.includes(action)) return [];
  const interventionById = new Map((job?.workInterventions || []).map((intervention) => [intervention.id, intervention]));
  return reports.map((report) => {
    const intervention = interventionById.get(report.interventionId);
    if (!intervention || intervention.status !== 'in_progress') return null;
    const sectionIds = report.template.sections
      .filter((section) => section.type === sectionType)
      .filter((section) => report.sectionStatus?.[section.id] !== 'completed')
      .map((section) => section.id);
    return sectionIds.length > 0 ? { interventionId: report.interventionId, sectionIds } : null;
  }).filter(Boolean);
}

function reportPhotoOptions(job, reports) {
  return reportSectionOptions(job, reports, 'evidence.add', 'photos');
}

function reportMeasurementOptions(job, reports) {
  return reportSectionOptions(job, reports, 'measurement.add', 'measurement_table');
}

function reportFindingOptions(job, reports) {
  return reportSectionOptions(job, reports, 'finding.add', 'findings');
}

async function attachInterventionReportsToJob(db, job) {
  let reports = await loadInterventionReportRecords(db, job);
  reports = await attachReportEvidence(db, job, reports);
  reports = await attachReportMeasurements(db, job, reports);
  reports = await attachReportFindings(db, job, reports);
  const photoOptions = reportPhotoOptions(job, reports);
  const measurementOptions = reportMeasurementOptions(job, reports);
  const findingOptions = reportFindingOptions(job, reports);
  return {
    ...job,
    interventionReports: reports,
    reportPhotoOptions: photoOptions,
    canAddReportPhoto: photoOptions.length > 0,
    reportMeasurementOptions: measurementOptions,
    canAddReportMeasurement: measurementOptions.length > 0,
    reportFindingOptions: findingOptions,
    canAddReportFinding: findingOptions.length > 0,
  };
}

module.exports.REPORT_SECTION_STATUSES = REPORT_SECTION_STATUSES;
module.exports.attachInterventionReportsToJob = attachInterventionReportsToJob;
module.exports.attachReportEvidence = attachReportEvidence;
module.exports.attachReportFindings = attachReportFindings;
module.exports.attachReportMeasurements = attachReportMeasurements;
module.exports.loadInterventionReportRecords = loadInterventionReportRecords;
module.exports.projectReportSectionStatus = projectReportSectionStatus;
module.exports.reportFindingOptions = reportFindingOptions;
module.exports.reportMeasurementOptions = reportMeasurementOptions;
module.exports.reportPhotoOptions = reportPhotoOptions;
module.exports.reportProjectionFromStored = reportProjectionFromStored;
module.exports.reportSectionOptions = reportSectionOptions;