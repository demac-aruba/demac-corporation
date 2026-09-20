'use strict';

// A reviewed cumulative scope checkpoint within Projects, never a Field report or a time ledger.
const d = require('./registry-domain');
const { phaseFor, recordedPhaseReview, loadPhaseEvidence, evidenceIssues, signature } = require('./phase-completion');

function normalizeProgress(phase, input) {
  d.allowedKeys(input, ['completedUnits', 'checklistIds']);
  if (!Array.isArray(input.checklistIds) || input.checklistIds.length > 100
      || new Set(input.checklistIds).size !== input.checklistIds.length) {
    throw d.fault('phase_progress_invalid', 'Select each completed checklist item only once.');
  }
  const known = new Set(phase.checklist.map(item => item.id));
  const checklistIds = input.checklistIds.map(id => {
    d.id(id, 'checklist item');
    if (!known.has(id)) throw d.fault('phase_progress_invalid', 'An item no longer belongs to this phase.');
    return id;
  }).sort();
  let completedUnits = null;
  if (phase.progressMethod === 'units') {
    if (!phase.unitsPlanned) throw d.fault('phase_progress_invalid', 'Define planned units before reviewing unit progress.');
    completedUnits = d.integer(input.completedUnits, 'cumulative verified units', 0, phase.unitsPlanned);
  } else if (input.completedUnits !== null) {
    throw d.fault('phase_progress_invalid', 'Unit progress does not apply to this phase.');
  }
  if (phase.progressMethod === 'checklist' && !phase.checklist.some(item => item.required !== false)) {
    throw d.fault('phase_progress_invalid', 'Define required checklist scope before reviewing checklist progress.');
  }
  return { completedUnits, checklistIds };
}
function progressMeasure(phase, progress) {
  const normalized = normalizeProgress(phase, progress);
  if (phase.progressMethod === 'units') return {
    basis: 'reviewed_units', numerator: normalized.completedUnits, denominator: phase.unitsPlanned,
    percent: normalized.completedUnits / phase.unitsPlanned * 100,
  };
  if (phase.progressMethod === 'checklist') {
    const required = phase.checklist.filter(item => item.required !== false);
    const done = required.filter(item => normalized.checklistIds.includes(item.id)).length;
    return { basis: 'reviewed_required_checklist', numerator: done, denominator: required.length, percent: done / required.length * 100 };
  }
  // Time spent or a subjective unweighted average does not establish physical scope.
  return { basis: 'explicit_scope_review_only', numerator: null, denominator: null, percent: null };
}
function reducedProgress(prior, current) {
  return (prior.completedUnits !== null && current.completedUnits !== null && current.completedUnits < prior.completedUnits)
    || prior.checklistIds.some(id => !current.checklistIds.includes(id));
}

async function previewPhaseProgress({ db, transaction, project, phaseId }) {
  const phase = phaseFor(project, phaseId);
  const saved = recordedPhaseReview(project, phaseId);
  const { proofs, rows, issues, complete } = await loadPhaseEvidence({ db, transaction, project, phaseId });
  const blockers = issues.map(issue => issue.code);
  if (!complete) blockers.push('phase_evidence_incomplete');
  const approvedRows = rows.filter(row => !row.cancelled && evidenceIssues([row], [], true).length === 0);
  if (!approvedRows.length) blockers.push('phase_no_approved_progress_source');
  if (saved?.status === 'approved') blockers.push('project_phase_closed');
  if (!d.PROJECT_OPEN_STATES.has(project.planningStatus) && project.planningStatus !== 'On Hold') blockers.push('project_not_open');
  const orderedProofs = [...proofs.values()].sort((a,b) => a.path.localeCompare(b.path));
  const digest = signature(phase, orderedProofs, []);
  let previous = null;
  if (saved?.status === 'progress_recorded') {
    const snapshot = await transaction.get(db.collection('projectEvents').doc(saved.eventId));
    const event = snapshot.exists ? snapshot.data() : null;
    const evidence = event?.phaseProgress;
    if (!event || event.action !== 'record_phase_progress' || event.projectId !== project.id
        || event.actorId !== saved.reviewedBy || event.occurredAt !== saved.reviewedAt
        || evidence?.phaseId !== phaseId || evidence.definitionHash !== saved.definitionHash
        || !Array.isArray(evidence.proofs) || !evidence.progress) {
      throw d.fault('phase_review_conflict', 'The prior progress checkpoint needs reconciliation.', 409);
    }
    // Historical progress remains visible as historical, even when the current definition differs.
    d.allowedKeys(evidence.progress, ['completedUnits', 'checklistIds']);
    if (evidence.progress.completedUnits !== null) d.integer(evidence.progress.completedUnits, 'prior units');
    if (!Array.isArray(evidence.progress.checklistIds) || evidence.progress.checklistIds.length > 100) {
      throw d.fault('phase_review_conflict', 'Prior checklist evidence is invalid.', 409);
    }
    const definitionCurrent = saved.definitionHash === d.digest(phase);
    const current = definitionCurrent && evidence.digest === digest && blockers.length === 0;
    previous = {
      eventId: saved.eventId, reviewedAt: saved.reviewedAt, reviewedBy: saved.reviewedBy,
      progress: evidence.progress, current,
      measure: definitionCurrent ? progressMeasure(phase, evidence.progress) : null,
      reason: typeof evidence.reason === 'string' ? evidence.reason : '',
    };
  }
  return {
    mode: 'phase_progress_review', projectId: project.id, projectVersion: project.version,
    phaseId, phase, digest, canRecord: blockers.length === 0, blockers: [...new Set(blockers)],
    previous, proofs: orderedProofs,
    sources: approvedRows.map(row => ({ workOrderId: row.workOrderId, appointmentId: row.appointmentId,
      vanId: row.vanId, reviewStatus: row.review.status, revisionId: row.review.revisionId })),
    semantics: 'cumulative_reviewed_scope_not_field_actuals',
  };
}
async function preparePhaseProgress({ db, transaction, project, input, principal, occurredAt, eventId }) {
  const data = input.data;
  d.allowedKeys(data, ['projectId', 'expectedVersion', 'phaseId', 'previewDigest', 'progress', 'reason', 'correctsEventId'],
    ['projectId', 'expectedVersion', 'phaseId', 'previewDigest', 'progress', 'reason']);
  const preview = await previewPhaseProgress({ db, transaction, project, phaseId: data.phaseId });
  if (!preview.canRecord) throw d.fault('phase_progress_not_ready', 'Review approved Field sources before recording progress.', 409);
  if (data.previewDigest !== preview.digest) throw d.fault('phase_preview_changed', 'The phase evidence changed. Review it again.', 409);
  const progress = normalizeProgress(preview.phase, data.progress);
  const reason = d.text(data.reason, 'progress review or correction reason', 1000);
  if (data.correctsEventId !== undefined && data.correctsEventId !== preview.previous?.eventId) {
    throw d.fault('phase_correction_conflict', 'The correction must reference the current recorded checkpoint.', 409);
  }
  if (preview.previous && reducedProgress(preview.previous.progress, progress) && data.correctsEventId !== preview.previous.eventId) {
    throw d.fault('phase_correction_reference_required', 'A reduction needs an explicit reference to the checkpoint being corrected.', 409);
  }
  const definitionHash = d.digest(preview.phase);
  const evidence = {
    phaseId: data.phaseId, definitionHash, digest: preview.digest, proofs: preview.proofs,
    sources: preview.sources, progress, reason, measure: progressMeasure(preview.phase, progress),
    previousEventId: preview.previous?.eventId || null, correctsEventId: data.correctsEventId || null,
  };
  const review = { phaseId: data.phaseId, status: 'progress_recorded', eventId, definitionHash,
    reviewedAt: occurredAt, reviewedBy: principal.uid };
  return {
    next: { ...project, phaseReviews: [...(project.phaseReviews || []).filter(row => row.phaseId !== data.phaseId), review] },
    evidence,
  };
}
module.exports = { normalizeProgress, progressMeasure, reducedProgress, previewPhaseProgress, preparePhaseProgress };
