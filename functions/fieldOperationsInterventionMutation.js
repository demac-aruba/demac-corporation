const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  activatedWorkInterventionTransitions,
  requiredFieldActionForInterventionTarget,
} = require('./fieldOperationsInterventionTransitions');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicEventId(requestId, interventionId, target) {
  return `FE-${crypto.createHash('sha256').update(`${requestId}:work_intervention_transition:${interventionId}:${target}`).digest('hex').slice(0, 24)}`;
}

function uniqueStaffIds(values = [], currentStaffId = '') {
  const normalized = Array.isArray(values) ? values.map((value) => text(value, 180)).filter(Boolean) : [];
  const actor = text(currentStaffId, 180);
  return [...new Set(actor ? [...normalized, actor] : normalized)];
}

function transitionPatch({ stored, projected, target, note, identity, requestId, occurredAt }) {
  if (!Number.isSafeInteger(projected.version) || projected.version < 1 || projected.version >= Number.MAX_SAFE_INTEGER) {
    throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409, {
      version: projected.version,
    });
  }
  const normalizedNote = text(note, 1500);
  if ((target === 'pending_part' || target === 'not_performed') && normalizedNote.length < 3) {
    throw fieldError(
      'work_intervention_reason_required',
      'A short reason is required when work is pending for a part or will not be performed.',
      400,
      { target },
    );
  }

  const patch = {
    status: target,
    updatedAt: occurredAt,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: projected.version + 1,
    lastExecutionRequestId: requestId,
    lastExecutionTarget: target,
  };

  if (target === 'in_progress') {
    const staffId = text(identity.staffId, 180);
    if (!staffId) throw fieldError('technician_staff_required', 'Actual intervention execution requires a DEMAC staff identity.', 403);
    patch.startedAt = projected.startedAt || occurredAt;
    patch.performedByStaffIds = uniqueStaffIds(projected.performedByStaffIds, staffId);
  } else if (target === 'completed' || target === 'pending_part') {
    const staffId = text(identity.staffId, 180);
    if (!staffId) throw fieldError('technician_staff_required', 'Actual intervention resolution requires a DEMAC staff identity.', 403);
    if (!projected.startedAt || !projected.performedByStaffIds.length) {
      throw fieldError('work_intervention_execution_not_started', 'This intervention must be started before resolving performed work.', 409);
    }
    patch.performedByStaffIds = uniqueStaffIds(projected.performedByStaffIds, staffId);
    patch.resultCode = target;
    if (normalizedNote) patch.resultNotes = normalizedNote;
    if (target === 'completed') patch.completedAt = projected.completedAt || occurredAt;
  } else if (target === 'not_performed') {
    if (projected.startedAt || projected.performedByStaffIds.length) {
      throw fieldError('work_intervention_already_started', 'Started work cannot be resolved as not performed.', 409);
    }
    patch.resultCode = 'not_performed';
    patch.resultNotes = normalizedNote;
    patch.performedByStaffIds = [];
  }

  return fieldFirestoreData(patch, 'workInterventionTransition');
}

function transitionAuditEvent({ requestId, before, after, context, identity, occurredAt, note }) {
  return {
    id: deterministicEventId(requestId, before.id, after.status),
    type: 'work_intervention_status_changed',
    entityType: 'WorkIntervention',
    entityId: before.id,
    visitId: before.visitId,
    visitAssetId: before.visitAssetId,
    assetId: before.assetId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    before: { status: before.status, version: before.version },
    after: {
      status: after.status,
      version: after.version,
      resultCode: after.resultCode,
      note: text(note, 500) || undefined,
    },
  };
}

function createTransitionWorkInterventionCommand({
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

  return async function transitionWorkIntervention({
    identity,
    visitId,
    interventionId,
    to,
    expectedVersion,
    note,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const target = text(to, 80);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    const requiredAction = requiredFieldActionForInterventionTarget(target);
    if (!requiredAction) {
      throw fieldError('work_intervention_transition_not_activated', `Work Intervention transition is not activated: ${target || 'missing'}.`, 400);
    }
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw fieldError('expected_version_required', 'A positive safe-integer expectedVersion is required.', 400);
    }
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: requiredAction,
        deniedMessage: requiredAction === 'execute'
          ? 'This assignment cannot start actual Work Intervention execution.'
          : 'This assignment cannot resolve actual Work Intervention execution.',
      });
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
      const stored = fieldSnapshotRecord(interventionSnapshot);
      const current = projectWorkIntervention(stored, expectedContext);

      if (current.status === target) {
        if (text(stored.lastExecutionRequestId, 240) === stable && text(stored.lastExecutionTarget, 80) === target) {
          result = {
            success: true,
            replayed: true,
            workIntervention: current,
            allowedActions: context.allowedActions,
          };
          return;
        }
        throw fieldError('work_intervention_transition_already_applied', 'This Work Intervention is already in the requested status. Refresh before trying again.', 409, {
          status: current.status,
        });
      }

      if (current.version !== expectedVersion) {
        throw fieldError('version_conflict', 'This Work Intervention changed on another device. Refresh before trying again.', 409, {
          expectedVersion,
          actualVersion: current.version,
        });
      }

      const allowedTargets = activatedWorkInterventionTransitions({
        status: current.status,
        visitStatus: context.canonicalVisit.status,
        allowedActions: context.allowedActions,
      });
      if (!allowedTargets.includes(target)) {
        throw fieldError('work_intervention_transition_not_allowed', 'This Work Intervention transition is not allowed in the current visit state.', 409, {
          interventionStatus: current.status,
          visitStatus: context.canonicalVisit.status,
          target,
          allowedTargets,
        });
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const patch = transitionPatch({
        stored,
        projected: current,
        target,
        note,
        identity,
        requestId: stable,
        occurredAt,
      });
      const nextStored = { ...stored, ...patch };
      const next = projectWorkIntervention(nextStored, expectedContext);
      const event = transitionAuditEvent({
        requestId: stable,
        before: current,
        after: next,
        context,
        identity,
        occurredAt,
        note,
      });

      transaction.update(interventionRef, patch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        workIntervention: next,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.createTransitionWorkInterventionCommand = createTransitionWorkInterventionCommand;
module.exports.transitionAuditEvent = transitionAuditEvent;
module.exports.transitionPatch = transitionPatch;