'use strict';

// Project management decisions do not create/cancel appointments or alter Field/finance truth.
const d = require('./registry-domain');
const { loadPhaseEvidence, evidenceIssues, completionReader } = require('./phase-completion');
const TERMINAL = new Set(['Completed', 'Cancelled']);
function transitionRule(from, to) {
  if (!d.PROJECT_STATES.has(from) || !d.PROJECT_STATES.has(to)) {
    throw d.fault('invalid_project_status', 'Choose a supported Project lifecycle state.');
  }
  if (from === to) return { noop: true, reopening: false, terminal: TERMINAL.has(to) };
  const reopening = TERMINAL.has(from);
  if (reopening && to !== 'Active') {
    throw d.fault('project_reopen_required', 'Explicitly reopen a closed Project to Active before changing its workflow.', 409);
  }
  return { noop: false, reopening, terminal: TERMINAL.has(to) };
}
async function previewProjectLifecycle({ db, transaction, project, targetStatus }) {
  const rule = transitionRule(project.planningStatus, targetStatus);
  const blockers = [];
  let proofs = [];
  const acceptedPhases = [];
  let workOrderCount = null;
  if (project.migration?.status === 'pending_reconciliation' && (rule.terminal || rule.reopening)) {
    blockers.push('legacy_import_requires_reconciliation');
  }
  if (!rule.noop && rule.terminal) {
    const evidence = await loadPhaseEvidence({ db, transaction, project });
    proofs = [...evidence.proofs.values()].sort((a,b) => a.path.localeCompare(b.path));
    workOrderCount = evidence.rows.length;
    blockers.push(...evidence.issues.map(issue => issue.code));
    if (!evidence.complete) blockers.push('project_evidence_incomplete');
    const active = evidence.rows.filter(row => !row.cancelled);
    if (targetStatus === 'Completed') {
      blockers.push(...evidenceIssues(evidence.rows, [], evidence.complete));
      const reader = completionReader({ db, transaction, project });
      for (const phase of project.phases) {
        const result = await reader.validate(phase.id);
        if (!result.valid) blockers.push('project_phase_approval_pending');
        else acceptedPhases.push({ phaseId: phase.id, eventId: result.eventId });
      }
    } else {
      // Cancellation is not a way to silently cancel the real outstanding schedule.
      for (const row of active) {
        if (evidenceIssues([row], [], true).length) blockers.push('project_open_operational_work');
      }
    }
  }
  const unique = [...new Set(blockers)];
  const digest = d.digest({ projectId: project.id, projectVersion: project.version,
    from: project.planningStatus, to: targetStatus, proofs, acceptedPhases });
  return {
    mode: 'project_lifecycle_review', projectId: project.id, projectVersion: project.version,
    currentStatus: project.planningStatus, targetStatus, ...rule,
    canApply: unique.length === 0, blockers: unique, digest, proofs, acceptedPhases, workOrderCount,
    effect: 'project_status_only_existing_appointments_unchanged',
  };
}
async function prepareProjectLifecycle({ db, transaction, project, input, principal, occurredAt, eventId }) {
  const data = input.data;
  d.allowedKeys(data, ['projectId', 'expectedVersion', 'targetStatus', 'previewDigest', 'reason', 'scopeConfirmed', 'reopeningConfirmed']);
  const reason = d.text(data.reason, 'project lifecycle reason', 1000);
  if (typeof data.scopeConfirmed !== 'boolean' || typeof data.reopeningConfirmed !== 'boolean') {
    throw d.fault('project_lifecycle_confirmation_required', 'Use explicit lifecycle confirmation fields.');
  }
  const preview = await previewProjectLifecycle({ db, transaction, project, targetStatus: data.targetStatus });
  if (!preview.canApply) throw d.fault('project_lifecycle_not_ready', 'Resolve outstanding project history and operational work before closing or reopening.', 409);
  if (data.previewDigest !== preview.digest) throw d.fault('project_preview_changed', 'Project evidence changed. Review the current state before applying it.', 409);
  if (data.targetStatus === 'Completed' && !data.scopeConfirmed) {
    throw d.fault('project_completion_confirmation_required', 'An authorized manager must explicitly confirm completed scope.');
  }
  if (preview.reopening && !data.reopeningConfirmed) {
    throw d.fault('project_reopen_confirmation_required', 'Confirm reopening; prior closure history will be retained.');
  }
  return {
    next: preview.noop ? project : { ...project, planningStatus: data.targetStatus,
      lifecycleReview: { eventId, status: data.targetStatus, reviewedAt: occurredAt, reviewedBy: principal.uid } },
    evidence: { from: preview.currentStatus, to: data.targetStatus, reason, proofs: preview.proofs,
      acceptedPhases: preview.acceptedPhases, digest: preview.digest,
      scopeConfirmed: data.scopeConfirmed, reopeningConfirmed: data.reopeningConfirmed,
      previousEventId: project.lifecycleReview?.eventId || null },
  };
}
module.exports = { TERMINAL, transitionRule, previewProjectLifecycle, prepareProjectLifecycle };
