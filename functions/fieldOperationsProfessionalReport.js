'use strict';

const { fieldError } = require('./fieldOperationsAuthorityCore');

const PROFESSIONAL_REPORT_PREVIEW_VERSION = 1;
const PROFESSIONAL_REPORT_STATUSES = new Set([
  'in_progress',
  'incomplete_report',
  'partial',
  'field_complete',
]);
const TERMINAL_INTERVENTION_STATUSES = new Set(['completed', 'not_performed', 'declined', 'cancelled']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function countPlannedQuantity(job) {
  return (job?.plannedWork || []).reduce((total, line) => {
    const quantity = Number(line?.quantity);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}

function unreconciledPlannedQuantity(job) {
  return (job?.plannedWorkProgress || []).reduce((total, line) => {
    const remainingQuantity = line?.remainingQuantity;
    if (!Number.isSafeInteger(remainingQuantity) || remainingQuantity < 0) {
      throw fieldError(
        'professional_report_state_conflict',
        'Professional Report received invalid planned-work reconciliation state.',
        409,
        { plannedWorkLineId: text(line?.id, 180) || null, remainingQuantity: remainingQuantity ?? null },
      );
    }
    return total + remainingQuantity;
  }, 0);
}

function reportCompletionSummary(job) {
  const reportByInterventionId = new Map((job?.interventionReports || []).map((report) => [report.interventionId, report]));
  let requiredSectionCount = 0;
  let completedRequiredSectionCount = 0;
  const incompleteRequiredSections = [];

  for (const intervention of job?.workInterventions || []) {
    const report = reportByInterventionId.get(intervention.id);
    const hasTemplateIdentity = Boolean(intervention.templateId || intervention.templateVersion !== undefined);
    if (hasTemplateIdentity !== Boolean(report)) {
      throw fieldError('professional_report_identity_conflict', 'Professional Report cannot reconcile Work Intervention report identity.', 409, {
        interventionId: intervention.id,
      });
    }
    if (!report) continue;
    const completion = report.completion;
    if (!completion
      || !Number.isSafeInteger(completion.requiredSectionCount)
      || completion.requiredSectionCount < 0
      || !Number.isSafeInteger(completion.completedRequiredSectionCount)
      || completion.completedRequiredSectionCount < 0
      || completion.completedRequiredSectionCount > completion.requiredSectionCount
      || !Array.isArray(completion.incompleteRequiredSections)
      || typeof completion.complete !== 'boolean') {
      throw fieldError('professional_report_state_conflict', 'Professional Report received invalid canonical report completion state.', 409, {
        interventionId: intervention.id,
      });
    }
    requiredSectionCount += completion.requiredSectionCount;
    completedRequiredSectionCount += completion.completedRequiredSectionCount;
    for (const section of completion.incompleteRequiredSections) {
      incompleteRequiredSections.push({
        interventionId: intervention.id,
        sectionId: text(section?.id, 120),
        title: text(section?.title, 240),
        type: text(section?.type, 80),
        status: text(section?.status, 40),
      });
    }
    if (intervention.status === 'completed' && !completion.complete) {
      throw fieldError('professional_report_state_conflict', 'A completed Work Intervention cannot have incomplete required report sections.', 409, {
        interventionId: intervention.id,
      });
    }
  }

  return { requiredSectionCount, completedRequiredSectionCount, incompleteRequiredSections };
}

function professionalReportStatus({ interventions, incompleteRequiredSections, unreconciledQuantity = 0 }) {
  if (interventions.some((intervention) => intervention.status === 'pending_part')) return 'partial';
  if (incompleteRequiredSections.length > 0) return 'incomplete_report';
  if (unreconciledQuantity > 0) return 'in_progress';
  if (interventions.length > 0 && interventions.every((intervention) => TERMINAL_INTERVENTION_STATUSES.has(intervention.status))) {
    return 'field_complete';
  }
  return 'in_progress';
}

function buildProfessionalReportPreview(job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) return null;
  const workOrderId = text(job?.workOrderId, 180);
  const customerId = text(job?.customerId, 180);
  const propertyId = text(job?.propertyId, 180);
  if (!workOrderId || !customerId || !propertyId) {
    throw fieldError('professional_report_identity_conflict', 'Professional Report requires canonical visit, work-order, customer and property identity.', 409);
  }

  const interventions = Array.isArray(job?.workInterventions) ? job.workInterventions : [];
  const completion = reportCompletionSummary(job);
  const unreconciledQuantity = unreconciledPlannedQuantity(job);
  const status = professionalReportStatus({
    interventions,
    incompleteRequiredSections: completion.incompleteRequiredSections,
    unreconciledQuantity,
  });
  if (!PROFESSIONAL_REPORT_STATUSES.has(status)) throw new Error('Professional Report status projection is invalid.');

  return {
    version: PROFESSIONAL_REPORT_PREVIEW_VERSION,
    source: 'canonical_field_truth',
    visitId,
    workOrderId,
    customerId,
    propertyId,
    status,
    plannedQuantity: countPlannedQuantity(job),
    unreconciledPlannedQuantity: unreconciledQuantity,
    actualAssetCount: Array.isArray(job?.visitAssets) ? job.visitAssets.length : 0,
    interventionCount: interventions.length,
    completedInterventionCount: interventions.filter((item) => item.status === 'completed').length,
    pendingPartInterventionCount: interventions.filter((item) => item.status === 'pending_part').length,
    notPerformedInterventionCount: interventions.filter((item) => item.status === 'not_performed').length,
    activeInterventionCount: interventions.filter((item) => ['planned', 'confirmed', 'in_progress', 'pending_authorization'].includes(item.status)).length,
    requiredSectionCount: completion.requiredSectionCount,
    completedRequiredSectionCount: completion.completedRequiredSectionCount,
    incompleteRequiredSections: completion.incompleteRequiredSections,
  };
}

function attachProfessionalReportPreviewToJob(job) {
  return {
    ...job,
    professionalReportPreview: buildProfessionalReportPreview(job),
  };
}

module.exports.PROFESSIONAL_REPORT_PREVIEW_VERSION = PROFESSIONAL_REPORT_PREVIEW_VERSION;
module.exports.PROFESSIONAL_REPORT_STATUSES = PROFESSIONAL_REPORT_STATUSES;
module.exports.attachProfessionalReportPreviewToJob = attachProfessionalReportPreviewToJob;
module.exports.buildProfessionalReportPreview = buildProfessionalReportPreview;
module.exports.professionalReportStatus = professionalReportStatus;
module.exports.reportCompletionSummary = reportCompletionSummary;
module.exports.unreconciledPlannedQuantity = unreconciledPlannedQuantity;
