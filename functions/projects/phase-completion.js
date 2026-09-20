'use strict';

// Project scope acceptance, not a Field report/time writer. Existing registry commands
// own mutation, authorization, receipts and audit. Only current approved Field evidence
// can support acceptance; programmed time never establishes physical completion.
const d = require('./registry-domain');
const { loadProjectActivity } = require('./registry-activity');
const { selectCurrentWorkVisit } = require('../fieldOperationsVisitRead');
const MAX_PAGES = 5;
const MAX_PROOFS = 400;
const PROOF_COLLECTIONS = new Set([
  'projectAppointmentLinks', 'appointments', 'workOrders', 'workVisits',
  'fieldOfficeReviews', 'fieldOfficeReviewRevisions',
]);

function phaseFor(project, phaseId) {
  d.id(phaseId, 'phaseId');
  const phase = project.phases.find(row => row.id === phaseId);
  if (!phase) throw d.fault('unknown_project_phase', 'The phase does not belong to this project.', 409);
  return phase;
}
function recordedPhaseReview(project, phaseId) {
  const reviews = project.phaseReviews;
  if (reviews === undefined) return null;
  if (!Array.isArray(reviews) || reviews.length > d.normalizePhases(project.phases).length
      || new Set(reviews.map(row => row?.phaseId)).size !== reviews.length) {
    throw d.fault('phase_review_conflict', 'Phase review history requires reconciliation.', 409);
  }
  for (const row of reviews) {
    d.allowedKeys(row, ['phaseId', 'status', 'eventId', 'definitionHash', 'reviewedAt', 'reviewedBy']);
    phaseFor(project, row.phaseId);
    if (!['approved', 'reopened', 'progress_recorded'].includes(row.status) || !/^[a-f0-9]{64}$/.test(row.definitionHash)) {
      throw d.fault('phase_review_conflict', 'Phase review history requires reconciliation.', 409);
    }
    d.id(row.eventId); d.id(row.reviewedBy); d.stamp(row.reviewedAt);
  }
  return reviews.find(row => row.phaseId === phaseId) || null;
}
function sourceVersion(snapshot) {
  const path = snapshot.ref?.path;
  const parts = typeof path === 'string' ? path.split('/') : [];
  const time = snapshot.updateTime;
  if (!snapshot.exists || parts.length !== 2 || !PROOF_COLLECTIONS.has(parts[0])
      || !Number.isSafeInteger(time?.seconds) || !Number.isSafeInteger(time?.nanoseconds)
      || time.nanoseconds < 0 || time.nanoseconds >= 1000000000) {
    throw d.fault('phase_source_version_missing', 'A source has no verifiable database version.', 409);
  }
  d.id(parts[1]);
  return { path, seconds: time.seconds, nanoseconds: time.nanoseconds };
}
function assertProof(proof) {
  d.allowedKeys(proof, ['path', 'seconds', 'nanoseconds']);
  const [collection, id, extra] = typeof proof.path === 'string' ? proof.path.split('/') : [];
  if (!PROOF_COLLECTIONS.has(collection) || extra !== undefined || !Number.isSafeInteger(proof.seconds)
      || !Number.isSafeInteger(proof.nanoseconds) || proof.nanoseconds < 0 || proof.nanoseconds >= 1000000000) {
    throw d.fault('phase_review_conflict', 'Phase evidence references require reconciliation.', 409);
  }
  d.id(id);
}
function signature(phase, proofs, prerequisites) {
  return d.digest({ phase, proofs: [...proofs].sort((a,b) => a.path.localeCompare(b.path)), prerequisites });
}
function completionConfirmation(phase, input) {
  d.allowedKeys(input, ['criteriaConfirmed', 'verifiedUnits', 'checklistIds']);
  if (input.criteriaConfirmed !== true) throw d.fault('phase_confirmation_required', 'Explicitly confirm the scope and completion criteria.');
  if (!Array.isArray(input.checklistIds) || new Set(input.checklistIds).size !== input.checklistIds.length) {
    throw d.fault('phase_checklist_incomplete', 'Review each required checklist item once.');
  }
  const known = new Set(phase.checklist.map(row => row.id));
  input.checklistIds.forEach(id => { d.id(id); if (!known.has(id)) throw d.fault('phase_checklist_incomplete', 'The checklist contains an unknown item.'); });
  if (phase.progressMethod === 'units') {
    if (!phase.unitsPlanned || input.verifiedUnits !== phase.unitsPlanned) throw d.fault('phase_units_incomplete', 'Verify all planned units before approving completion.');
  } else if (input.verifiedUnits !== null) throw d.fault('phase_units_incomplete', 'Unit confirmation is not applicable to this phase.');
  // A required checklist applies regardless of the progress display method.
  if (phase.checklist.some(row => row.required !== false && !input.checklistIds.includes(row.id))) {
    throw d.fault('phase_checklist_incomplete', 'Required checklist items remain unconfirmed.');
  }
  if (phase.progressMethod === 'checklist' && !phase.checklist.length) throw d.fault('phase_checklist_incomplete', 'Define the checklist before closing its phase.');
  return { criteriaConfirmed: true, verifiedUnits: input.verifiedUnits, checklistIds: [...input.checklistIds].sort() };
}
function evidenceIssues(rows, issues, complete) {
  const result = issues.map(row => row.code);
  if (!complete) result.push('phase_evidence_incomplete');
  const active = rows.filter(row => !row.cancelled);
  if (!active.length) result.push('phase_no_completed_work');
  for (const row of active) {
    if (row.temporaryHold) result.push('phase_temporary_hold_pending');
    if (row.review?.status !== 'approved') result.push('phase_office_approval_pending');
    // Reuse Field's chain resolver; an old completed visit cannot hide a newer
    // return visit or a disconnected/branched history.
    try {
      const tip = selectCurrentWorkVisit(row.visits.map(visit => ({ ...visit, workOrderId: row.workOrderId })), row.workOrderId);
      if (!tip || tip.status !== 'completed' || row.review?.visitId !== tip.id) result.push('phase_execution_pending');
    } catch { result.push('phase_visit_chain_conflict'); }
  }
  return [...new Set(result)];
}

/** Shared transaction-scoped reader; cache never survives a transaction retry or user. */
function completionReader({ db, transaction, project }) {
  const cache = new Map();
  const documents = new Map();
  async function readMany(paths) {
    const missing = [...new Set(paths)].filter(path => !documents.has(path));
    if (missing.length) {
      const values = await transaction.getAll(...missing.map(path => { const [collection,id] = path.split('/'); return db.collection(collection).doc(id); }));
      values.forEach((snapshot,index) => documents.set(missing[index], snapshot));
    }
    return paths.map(path => documents.get(path));
  }
  async function validate(phaseId, ancestors = []) {
    if (ancestors.includes(phaseId)) throw d.fault('dependency_cycle', 'Phase dependencies contain a cycle.', 409);
    if (cache.has(phaseId)) return cache.get(phaseId);
    const phase = phaseFor(project, phaseId);
    const saved = recordedPhaseReview(project, phaseId);
    const invalid = reason => ({ valid: false, phaseId, reason });
    if (!saved || saved.status !== 'approved') return invalid('phase_not_approved');
    if (saved.definitionHash !== d.digest(phase)) return invalid('phase_definition_changed');
    const eventSnapshot = (await readMany([`projectEvents/${saved.eventId}`]))[0];
    const event = eventSnapshot?.exists ? eventSnapshot.data() : null;
    const evidence = event?.phaseCompletion;
    if (!event || event.projectId !== project.id || event.action !== 'approve_phase_completion'
        || event.actorId !== saved.reviewedBy || event.occurredAt !== saved.reviewedAt
        || evidence?.phaseId !== phaseId || !Array.isArray(evidence.proofs)
        || !evidence.proofs.length || evidence.proofs.length > MAX_PROOFS
        || new Set(evidence.proofs.map(row=>row.path)).size !== evidence.proofs.length
        || !Array.isArray(evidence.prerequisites)) return invalid('phase_review_event_invalid');
    evidence.proofs.forEach(assertProof);
    try { completionConfirmation(phase, evidence.confirmation); }
    catch { return invalid('phase_confirmation_invalid'); }
    const prerequisites = [];
    for (const id of phase.dependencies) {
      const result = await validate(id, [...ancestors, phaseId]);
      if (!result.valid) return invalid('phase_prerequisite_not_current');
      prerequisites.push({ phaseId: id, eventId: result.eventId });
    }
    if (signature(phase, evidence.proofs, prerequisites) !== evidence.digest) return invalid('phase_review_signature_changed');
    const snapshots = await readMany(evidence.proofs.map(row => row.path));
    if (snapshots.some((snapshot,index) => !snapshot?.exists
        || d.canonical(sourceVersion(snapshot)) !== d.canonical(evidence.proofs[index]))) return invalid('phase_source_changed');
    const linkPaths = evidence.proofs.filter(row => row.path.startsWith('projectAppointmentLinks/')).map(row=>row.path).sort();
    const links = await transaction.get(db.collection('projectAppointmentLinks').where('projectId','==',project.id).where('phaseId','==',phaseId).limit(linkPaths.length + 1));
    const actual = links.docs.map(row=>row.ref.path).sort();
    if (d.canonical(actual) !== d.canonical(linkPaths)) return invalid('phase_links_changed');
    const result = { valid: true, phaseId, eventId: saved.eventId };
    cache.set(phaseId, result);
    return result;
  }
  return { validate };
}

/** Collect the same canonical evidence once for scope closure or a partial checkpoint. */
async function loadPhaseEvidence({ db, transaction, project, phaseId }) {
  const proofs = new Map(); const rows = []; const issues = []; let cursor; let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const activity = await loadProjectActivity({ db, transaction, project, afterId: cursor, phaseId,
      observeSource: snapshot => {
        const proof = sourceVersion(snapshot); proofs.set(proof.path, proof);
        if (proofs.size > MAX_PROOFS) throw d.fault('phase_scope_limit', 'Review a smaller phase evidence scope before closing it.', 409);
      } });
    rows.push(...activity.rows); issues.push(...activity.issues);
    if (!activity.nextCursor) { complete = true; break; }
    cursor = activity.nextCursor;
  }
  return { proofs, rows, issues, complete };
}

async function previewPhaseCompletion({ db, transaction, project, phaseId }) {
  const phase = phaseFor(project, phaseId);
  const saved = recordedPhaseReview(project, phaseId);
  const reader = completionReader({ db, transaction, project });
  if (saved?.status === 'approved') {
    const current = await reader.validate(phaseId);
    return { mode: 'phase_completion_review', projectId: project.id, projectVersion: project.version,
      phaseId, phase, status: current.valid ? 'approved' : 'needs_review', canApprove: false,
      blockers: current.valid ? [] : [current.reason], digest: null, saved, sources: [],
      label: 'Scope approval; not payroll or an inferred percentage of labor.' };
  }
  const { proofs, rows, issues, complete } = await loadPhaseEvidence({ db, transaction, project, phaseId });
  const blockers = evidenceIssues(rows, issues, complete);
  const prerequisites = [];
  for (const id of phase.dependencies) {
    const result = await reader.validate(id);
    if (!result.valid) blockers.push('phase_prerequisite_not_current');
    else prerequisites.push({ phaseId: id, eventId: result.eventId });
  }
  if (!d.PROJECT_OPEN_STATES.has(project.planningStatus)) blockers.push('project_not_open');
  const orderedProofs = [...proofs.values()].sort((a,b)=>a.path.localeCompare(b.path));
  return { mode: 'phase_completion_review', projectId: project.id, projectVersion: project.version,
    phaseId, phase, status: saved?.status === 'progress_recorded' ? 'open' : saved?.status || 'open', canApprove: blockers.length === 0,
    blockers: [...new Set(blockers)], digest: signature(phase, orderedProofs, prerequisites), saved,
    sources: rows.filter(row=>!row.cancelled).map(row=>({ workOrderId:row.workOrderId, appointmentId:row.appointmentId, vanId:row.vanId, reviewStatus:row.review?.status||null, revisionId:row.review?.revisionId||null })),
    // Proofs are database metadata, never raw Field snapshots or credentials.
    proofs: orderedProofs, prerequisites,
    label: 'Scope approval; not payroll or an inferred percentage of labor.' };
}
async function preparePhaseCompletion({ db, transaction, project, input, principal, occurredAt, eventId }) {
  const data = input.data;
  const phase = phaseFor(project, data.phaseId);
  const old = recordedPhaseReview(project, phase.id);
  let evidence;
  if (input.action === 'approve_phase_completion') {
    d.allowedKeys(data, ['projectId','expectedVersion','phaseId','previewDigest','confirmation','reason']);
    const preview = await previewPhaseCompletion({ db, transaction, project, phaseId: phase.id });
    if (!preview.canApprove) throw d.fault('phase_not_ready', 'Complete and review the Field work and phase prerequisites first.', 409);
    if (typeof data.previewDigest !== 'string' || preview.digest !== data.previewDigest) throw d.fault('phase_preview_changed', 'Phase evidence changed. Review the current evidence before approving.', 409);
    const confirmation = completionConfirmation(phase, data.confirmation);
    evidence = { phaseId:phase.id, digest:preview.digest, proofs:preview.proofs, prerequisites:preview.prerequisites,
      confirmation, sources:preview.sources, reason:d.text(data.reason,'phase approval reason',1000) };
  } else {
    d.allowedKeys(data, ['projectId','expectedVersion','phaseId','reason']);
    if (!old || old.status !== 'approved') throw d.fault('phase_not_closed', 'Only a recorded approved phase can be reopened.', 409);
    evidence = { phaseId:phase.id, previousEventId:old.eventId, reason:d.text(data.reason,'phase reopening reason',1000) };
  }
  const review = { phaseId:phase.id, status:input.action==='approve_phase_completion'?'approved':'reopened', eventId,
    definitionHash:d.digest(phase), reviewedAt:occurredAt, reviewedBy:principal.uid };
  const phaseReviews = [...(project.phaseReviews||[]).filter(row=>row.phaseId!==phase.id),review];
  return { next:{...project,phaseReviews}, evidence };
}
async function requirePhasePrerequisites({ db, transaction, project, phaseId }) {
  if (phaseId === null) return;
  const phase = phaseFor(project, phaseId);
  if (recordedPhaseReview(project, phaseId)?.status === 'approved') {
    throw d.fault('project_phase_closed', 'Reopen the approved phase before assigning additional work.', 409);
  }
  const reader = completionReader({ db, transaction, project });
  for (const id of phase.dependencies) {
    if (!(await reader.validate(id)).valid) throw d.fault('project_phase_reconciliation_required', 'A phase prerequisite needs current scope approval.', 409);
  }
}
module.exports = { MAX_PROOFS, phaseFor, recordedPhaseReview, sourceVersion, signature, completionConfirmation,
  evidenceIssues, completionReader, loadPhaseEvidence, previewPhaseCompletion, preparePhaseCompletion, requirePhasePrerequisites };
