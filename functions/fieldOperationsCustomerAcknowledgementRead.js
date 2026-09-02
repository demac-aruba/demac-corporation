'use strict';

const { fieldError } = require('./fieldOperationsAuthorityCore');
const { loadCustomerAcknowledgements } = require('./fieldOperationsCustomerAcknowledgements');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function customerAcknowledgementOptions(job, reports) {
  if (text(job?.fieldVisit?.status, 80) !== 'in_progress') return [];
  if (!Array.isArray(job?.allowedActions) || !job.allowedActions.includes('execute')) return [];
  const interventionById = new Map((job?.workInterventions || []).map((intervention) => [intervention.id, intervention]));
  return reports.map((report) => {
    const intervention = interventionById.get(report.interventionId);
    if (!intervention || intervention.status !== 'in_progress') return null;
    const acknowledged = new Set((report.customerAcknowledgements || []).map((item) => item.sectionId));
    const sectionIds = report.template.sections
      .filter((section) => section.type === 'customer_acknowledgement')
      .filter((section) => report.sectionStatus?.[section.id] !== 'completed' && !acknowledged.has(section.id))
      .map((section) => section.id);
    return sectionIds.length ? { interventionId: report.interventionId, sectionIds } : null;
  }).filter(Boolean);
}

async function attachCustomerAcknowledgementsToJob(db, job) {
  const reports = Array.isArray(job?.interventionReports)
    ? job.interventionReports.map((report) => ({ ...report, customerAcknowledgements: [] }))
    : [];
  const visitId = text(job?.fieldVisit?.id, 180);
  if (visitId && reports.length) {
    const acknowledgements = await loadCustomerAcknowledgements(db, visitId, {
      workOrderId: text(job.workOrderId, 180),
      customerId: text(job.customerId, 180),
      propertyId: text(job.propertyId, 180),
    });
    const reportByInterventionId = new Map(reports.map((report) => [report.interventionId, report]));
    const keys = new Set();
    for (const acknowledgement of acknowledgements) {
      const report = reportByInterventionId.get(acknowledgement.interventionId);
      if (!report) {
        throw fieldError('customer_acknowledgement_identity_conflict', 'Persisted customer acknowledgement references an intervention without a canonical report projection.', 409);
      }
      const section = report.template.sections.find((candidate) => candidate.id === acknowledgement.sectionId);
      if (!section || section.type !== 'customer_acknowledgement') {
        throw fieldError('customer_acknowledgement_identity_conflict', 'Persisted customer acknowledgement references an invalid frozen report section.', 409);
      }
      if (acknowledgement.visitAssetId !== report.visitAssetId || acknowledgement.assetId !== report.assetId) {
        throw fieldError('customer_acknowledgement_identity_conflict', 'Persisted customer acknowledgement does not match its Work Intervention equipment identity.', 409);
      }
      const key = `${acknowledgement.interventionId}:${acknowledgement.sectionId}`;
      if (keys.has(key)) {
        throw fieldError('customer_acknowledgement_identity_conflict', 'More than one acknowledgement exists for the same report section.', 409);
      }
      keys.add(key);
      report.customerAcknowledgements.push(acknowledgement);
    }
    for (const report of reports) {
      report.customerAcknowledgements.sort((left, right) => left.sectionId.localeCompare(right.sectionId));
      const acknowledgedSectionIds = new Set(report.customerAcknowledgements.map((item) => item.sectionId));
      for (const section of report.template.sections.filter((candidate) => candidate.type === 'customer_acknowledgement')) {
        const acknowledged = acknowledgedSectionIds.has(section.id);
        const completed = report.sectionStatus?.[section.id] === 'completed';
        if (acknowledged !== completed) {
          throw fieldError('customer_acknowledgement_report_state_conflict', 'Customer acknowledgement evidence does not match the persisted report section completion state.', 409, {
            interventionId: report.interventionId,
            sectionId: section.id,
          });
        }
      }
    }
  }
  const options = customerAcknowledgementOptions(job, reports);
  return {
    ...job,
    interventionReports: reports,
    reportCustomerAcknowledgementOptions: options,
    canRecordCustomerAcknowledgement: options.length > 0,
  };
}

module.exports.attachCustomerAcknowledgementsToJob = attachCustomerAcknowledgementsToJob;
module.exports.customerAcknowledgementOptions = customerAcknowledgementOptions;
