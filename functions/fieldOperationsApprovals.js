const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectScopeChange } = require('./fieldOperationsScopeChanges');
const { projectWorkIntervention } = require('./fieldOperationsVisitInterventions');

const FIELD_APPROVAL_STORAGE_VERSION = 1;
const FIELD_APPROVAL_COLLECTION = 'fieldApprovals';
const ADDITIONAL_DECISION_VISIT_STATUSES = new Set(['on_site', 'in_progress']);
const FIELD_APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const FIELD_APPROVAL_METHODS = new Set(['signature', 'verbal', 'whatsapp', 'email', 'office_recorded', 'other']);
const FIELD_APPROVAL_REFERENCE_TYPES = new Set(['intervention', 'sale_line', 'scope_change']);
const ADDITIONAL_INTERVENTION_ORIGINS = new Set([
  'added_on_site_client_request',
  'added_on_site_technician_discovery',
]);
const ADDITIONAL_APPROVED_STATUSES = new Set(['confirmed', 'in_progress', 'pending_part', 'completed']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function requiredReference(record, names, label) {
  const values = names.map((name) => text(record?.[name], 180)).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length !== 1) {
    throw fieldError('field_approval_identity_conflict', `Persisted Field Approval ${label} identity is missing or conflicting.`, 409);
  }
  return uniqueValues[0];
}

function assertExpectedReference(actual, expected, label) {
  const normalizedExpected = text(expected, 180);
  if (normalizedExpected && actual !== normalizedExpected) {
    throw fieldError('field_approval_identity_conflict', `Persisted Field Approval ${label} identity does not match its authorized visit context.`, 409);
  }
}

function canonicalVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_field_approval_version', 'Persisted Field Approval version is invalid.', 409);
  }
  return value;
}

function canonicalAffected(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw fieldError('invalid_field_approval_affected', 'Persisted Field Approval affected references are missing.', 409);
  }
  const seen = new Set();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw fieldError('invalid_field_approval_affected', 'Persisted Field Approval affected reference is invalid.', 409);
    }
    const type = text(candidate.type, 80);
    const id = text(candidate.id, 180);
    if (!FIELD_APPROVAL_REFERENCE_TYPES.has(type) || !id) {
      throw fieldError('invalid_field_approval_affected', 'Persisted Field Approval affected reference is invalid.', 409);
    }
    const key = `${type}:${id}`;
    if (seen.has(key)) {
      throw fieldError('invalid_field_approval_affected', 'Persisted Field Approval contains duplicate affected references.', 409);
    }
    seen.add(key);
    return { type, id };
  });
}

function projectFieldApproval(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_APPROVAL_STORAGE_VERSION) {
    throw fieldError(
      'invalid_field_approval_schema',
      `Unsupported Field Approval storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`,
      409,
    );
  }
  const id = text(record?.id, 180);
  if (!id) throw fieldError('field_approval_identity_conflict', 'Persisted Field Approval record id is missing.', 409);
  const visitId = requiredReference(record, ['visitId'], 'Work Visit');
  const workOrderId = requiredReference(record, ['workOrderId'], 'Work Order');
  const customerId = requiredReference(record, ['clientId', 'customerId'], 'Customer');
  const propertyId = requiredReference(record, ['propertyId', 'siteId'], 'Property');
  const status = text(record?.status, 80);
  const method = text(record?.method, 80);
  if (!FIELD_APPROVAL_STATUSES.has(status)) {
    throw fieldError('invalid_field_approval_status', `Unknown persisted Field Approval status: ${status || 'missing'}.`, 409);
  }
  if (!FIELD_APPROVAL_METHODS.has(method)) {
    throw fieldError('invalid_field_approval_method', `Unknown persisted Field Approval method: ${method || 'missing'}.`, 409);
  }
  const receiverName = text(record?.receiverName, 180);
  if (!receiverName) throw fieldError('invalid_field_approval_receiver', 'Persisted Field Approval receiverName is missing.', 409);
  const decidedAt = text(record?.decidedAt, 80) || undefined;
  if ((status === 'approved' || status === 'rejected') && (!decidedAt || Number.isNaN(Date.parse(decidedAt)))) {
    throw fieldError('invalid_field_approval_timestamp', 'Persisted decided Field Approval decidedAt is invalid.', 409);
  }
  if (decidedAt && Number.isNaN(Date.parse(decidedAt))) {
    throw fieldError('invalid_field_approval_timestamp', 'Persisted Field Approval decidedAt is invalid.', 409);
  }
  assertExpectedReference(visitId, expectedContext.visitId, 'Work Visit');
  assertExpectedReference(workOrderId, expectedContext.workOrderId, 'Work Order');
  assertExpectedReference(customerId, expectedContext.customerId, 'Customer');
  assertExpectedReference(propertyId, expectedContext.propertyId, 'Property');
  return {
    id,
    visitId,
    status,
    method,
    affected: canonicalAffected(record?.affected),
    receiverName,
    decidedAt,
    technicianStaffId: text(record?.technicianStaffId, 180) || undefined,
    signatureEvidenceId: text(record?.signatureEvidenceId, 180) || undefined,
    note: text(record?.note, 1000) || undefined,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalVersion(record?.version),
  };
}

function affectedId(approval, type) {
  return approval.affected.find((reference) => reference.type === type)?.id || '';
}

function actorCreateFields(identity, now) {
  return {
    createdAt: now,
    createdByUserId: text(identity.uid, 180),
    createdByStaffId: text(identity.staffId, 180) || undefined,
    createdByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    updatedAt: now,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: 1,
  };
}

function actorUpdateFields(identity, now, version) {
  return {
    updatedAt: now,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version,
  };
}

async function loadFieldApprovals(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(FIELD_APPROVAL_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map((document) => projectFieldApproval(fieldSnapshotRecord(document), { ...expectedContext, visitId: normalizedVisitId }))
    .sort((left, right) => (left.decidedAt || left.createdAt).localeCompare(right.decidedAt || right.createdAt) || left.id.localeCompare(right.id));
}

function approvalForAdditionalIntervention(approvals, interventionId, scopeChangeId) {
  const matches = approvals.filter((approval) => (
    affectedId(approval, 'intervention') === interventionId
    && affectedId(approval, 'scope_change') === scopeChangeId
  ));
  if (matches.length > 1) {
    throw fieldError('field_approval_identity_conflict', 'Additional Work Intervention has multiple customer decision records.', 409);
  }
  return matches[0] || null;
}

function approvalForSaleLine(approvals, saleLineId) {
  const matches = approvals.filter((approval) => affectedId(approval, 'sale_line') === saleLineId);
  if (matches.length > 1) {
    throw fieldError('field_approval_identity_conflict', 'Field Sale Line has multiple customer decision records.', 409);
  }
  return matches[0] || null;
}

function validateApprovalLinks(job, approvals) {
  const interventionById = new Map((job.workInterventions || []).map((intervention) => [intervention.id, intervention]));
  const scopeChangeById = new Map((job.scopeChanges || []).map((scopeChange) => [scopeChange.id, scopeChange]));
  const saleLineById = new Map((job.fieldSaleLines || []).map((saleLine) => [saleLine.id, saleLine]));
  for (const approval of approvals) {
    const saleReferences = approval.affected.filter((reference) => reference.type === 'sale_line');
    if (saleReferences.length && (saleReferences.length !== 1 || approval.affected.length !== 1)) {
      throw fieldError('field_approval_identity_conflict', 'Field Sale customer decisions must reference exactly one Field Sale Line.', 409);
    }
    for (const reference of approval.affected) {
      if (reference.type === 'intervention' && !interventionById.has(reference.id)) {
        throw fieldError('field_approval_identity_conflict', 'Field Approval references a Work Intervention outside the authorized visit.', 409);
      }
      if (reference.type === 'scope_change' && !scopeChangeById.has(reference.id)) {
        throw fieldError('field_approval_identity_conflict', 'Field Approval references a Scope Change outside the authorized visit.', 409);
      }
      if (reference.type === 'sale_line' && !saleLineById.has(reference.id)) {
        throw fieldError('field_approval_identity_conflict', 'Field Approval references a Field Sale Line outside the authorized visit.', 409);
      }
    }
  }

  for (const intervention of job.workInterventions || []) {
    if (!ADDITIONAL_INTERVENTION_ORIGINS.has(intervention.origin)) continue;
    const scopeChange = scopeChangeById.get(intervention.scopeChangeId);
    if (!scopeChange) {
      throw fieldError('field_approval_identity_conflict', 'Additional Work Intervention is missing its Scope Change before approval reconciliation.', 409);
    }
    const approval = approvalForAdditionalIntervention(approvals, intervention.id, scopeChange.id);
    if (intervention.status === 'pending_authorization') {
      if (scopeChange.resolvedAt || approval) {
        throw fieldError('field_approval_identity_conflict', 'Pending additional work already contains resolved approval state.', 409);
      }
      continue;
    }
    if (intervention.status === 'declined') {
      if (!scopeChange.resolvedAt || approval?.status !== 'rejected') {
        throw fieldError('field_approval_identity_conflict', 'Declined additional work is missing its matching customer rejection evidence.', 409);
      }
      continue;
    }
    if (ADDITIONAL_APPROVED_STATUSES.has(intervention.status)) {
      if (!scopeChange.resolvedAt || approval?.status !== 'approved') {
        throw fieldError('field_approval_identity_conflict', 'Approved additional work is missing its matching customer approval evidence.', 409);
      }
      continue;
    }
    throw fieldError('field_approval_identity_conflict', `Additional work status ${intervention.status} is not activated for approval reconciliation.`, 409);
  }

  for (const saleLine of job.fieldSaleLines || []) {
    const approval = approvalForSaleLine(approvals, saleLine.id);
    if (saleLine.status === 'proposed') {
      if (approval || saleLine.customerApprovalId) throw fieldError('field_approval_identity_conflict', 'Proposed Field Sale Line already contains customer decision evidence.', 409);
      continue;
    }
    if (saleLine.status === 'declined') {
      if (approval?.status !== 'rejected' || approval.id !== saleLine.customerApprovalId) throw fieldError('field_approval_identity_conflict', 'Declined Field Sale Line is missing its customer rejection evidence.', 409);
      continue;
    }
    if (['customer_approved', 'installed', 'delivered', 'sold'].includes(saleLine.status)) {
      if (approval?.status !== 'approved' || approval.id !== saleLine.customerApprovalId) throw fieldError('field_approval_identity_conflict', 'Approved Field Sale Line is missing its customer approval evidence.', 409);
      continue;
    }
    if (saleLine.status === 'voided') {
      if (Boolean(approval) !== Boolean(saleLine.customerApprovalId) || (approval && approval.id !== saleLine.customerApprovalId)) {
        throw fieldError('field_approval_identity_conflict', 'Voided Field Sale Line has inconsistent customer decision evidence.', 409);
      }
      continue;
    }
    throw fieldError('field_approval_identity_conflict', `Field Sale Line status ${saleLine.status} is not activated for approval reconciliation.`, 409);
  }
}

function additionalApprovalBaseEligible(job) {
  return Boolean(
    job?.fieldVisit
    && ADDITIONAL_DECISION_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))
    && Array.isArray(job.allowedActions)
    && job.allowedActions.includes('execute'),
  );
}

async function attachFieldApprovalsToJob(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) {
    return {
      ...job,
      fieldApprovals: [],
      additionalApprovalInterventionIds: [],
      canRecordAdditionalApproval: false,
    };
  }
  const expectedContext = {
    workOrderId: text(job?.workOrderId, 180),
    customerId: text(job?.customerId, 180),
    propertyId: text(job?.propertyId, 180),
  };
  const fieldApprovals = await loadFieldApprovals(db, visitId, expectedContext);
  validateApprovalLinks(job, fieldApprovals);
  const eligible = additionalApprovalBaseEligible(job);
  const scopeChangeById = new Map((job.scopeChanges || []).map((scopeChange) => [scopeChange.id, scopeChange]));
  const additionalApprovalInterventionIds = eligible
    ? (job.workInterventions || [])
      .filter((intervention) => ADDITIONAL_INTERVENTION_ORIGINS.has(intervention.origin))
      .filter((intervention) => intervention.status === 'pending_authorization' && intervention.priceSnapshot)
      .filter((intervention) => {
        const scopeChange = scopeChangeById.get(intervention.scopeChangeId);
        return Boolean(scopeChange && !scopeChange.resolvedAt);
      })
      .map((intervention) => intervention.id)
    : [];
  return {
    ...job,
    fieldApprovals,
    additionalApprovalInterventionIds,
    canRecordAdditionalApproval: additionalApprovalInterventionIds.length > 0,
  };
}

function decisionAuditEvent({ requestId, approval, intervention, scopeChange, context, identity, occurredAt, beforeStatus }) {
  return {
    id: deterministicId('FE', `${requestId}:additional_work_customer_decision:${approval.id}`),
    type: 'additional_work_customer_decision_recorded',
    entityType: 'FieldApproval',
    entityId: approval.id,
    visitId: approval.visitId,
    interventionId: intervention.id,
    assetId: intervention.assetId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    before: {
      interventionStatus: beforeStatus,
      scopeResolved: false,
    },
    after: {
      decision: approval.status,
      method: approval.method,
      interventionStatus: intervention.status,
      scopeResolved: Boolean(scopeChange.resolvedAt),
      priceSnapshot: intervention.priceSnapshot ? {
        currency: intervention.priceSnapshot.currency,
        unitPrice: intervention.priceSnapshot.unitPrice,
        sourceCatalogItemId: intervention.priceSnapshot.sourceCatalogItemId,
        pricingVersion: intervention.priceSnapshot.pricingVersion,
        capturedAt: intervention.priceSnapshot.capturedAt,
      } : undefined,
    },
  };
}

function createRecordAdditionalWorkDecisionCommand({
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

  return async function recordAdditionalWorkDecision({
    identity,
    visitId,
    interventionId,
    decision,
    receiverName,
    note,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedDecision = text(decision, 40);
    const normalizedReceiverName = text(receiverName, 180);
    const normalizedNote = text(note, 1000);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('intervention_required', 'A Work Intervention id is required.', 400);
    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      throw fieldError('invalid_customer_decision', 'Customer decision must be approved or rejected.', 400);
    }
    if (normalizedReceiverName.length < 2) {
      throw fieldError('approval_receiver_required', 'Name of the customer representative making the decision is required.', 400);
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
        action: 'execute',
        deniedMessage: 'This assignment cannot record customer decisions for additional work.',
      });
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      const interventionRef = db.collection('workInterventions').doc(normalizedInterventionId);
      const interventionSnapshot = await transaction.get(interventionRef);
      if (!interventionSnapshot.exists) {
        throw fieldError('work_intervention_not_found', 'The selected Work Intervention is not available for this visit.', 404);
      }
      const currentIntervention = projectWorkIntervention(fieldSnapshotRecord(interventionSnapshot), expectedContext);
      if (!ADDITIONAL_INTERVENTION_ORIGINS.has(currentIntervention.origin)) {
        throw fieldError('approval_not_allowed', 'Only additional on-site work can use this customer-decision command.', 409);
      }
      const scopeChangeId = text(currentIntervention.scopeChangeId, 180);
      const scopeChangeRef = db.collection('scopeChanges').doc(scopeChangeId);
      const scopeChangeSnapshot = await transaction.get(scopeChangeRef);
      if (!scopeChangeSnapshot.exists) {
        throw fieldError('scope_change_not_found', 'The additional work Scope Change is not available for this visit.', 409);
      }
      const currentScopeChange = projectScopeChange(fieldSnapshotRecord(scopeChangeSnapshot), expectedContext);
      if (currentScopeChange.interventionId !== currentIntervention.id || currentScopeChange.visitAssetId !== currentIntervention.visitAssetId) {
        throw fieldError('field_approval_identity_conflict', 'Scope Change and Work Intervention linkage is inconsistent.', 409);
      }

      const approvalId = deterministicId('FA', `${normalizedVisitId}:${normalizedInterventionId}:customer-decision`);
      const approvalRef = db.collection(FIELD_APPROVAL_COLLECTION).doc(approvalId);
      const approvalSnapshot = await transaction.get(approvalRef);
      const expectedApprovalStatus = normalizedDecision;
      const expectedInterventionStatus = normalizedDecision === 'approved' ? 'confirmed' : 'declined';
      if (approvalSnapshot.exists) {
        const existingApproval = projectFieldApproval(fieldSnapshotRecord(approvalSnapshot), expectedContext);
        if (
          existingApproval.status !== expectedApprovalStatus
          || existingApproval.method !== 'verbal'
          || existingApproval.receiverName !== normalizedReceiverName
          || (existingApproval.note || '') !== normalizedNote
          || affectedId(existingApproval, 'intervention') !== currentIntervention.id
          || affectedId(existingApproval, 'scope_change') !== currentScopeChange.id
          || currentIntervention.status !== expectedInterventionStatus
          || !currentScopeChange.resolvedAt
        ) {
          throw fieldError('field_approval_request_conflict', 'This additional work already has a different customer decision record.', 409);
        }
        result = {
          success: true,
          replayed: true,
          fieldApproval: existingApproval,
          scopeChange: currentScopeChange,
          workIntervention: currentIntervention,
          allowedActions: context.allowedActions,
        };
        return;
      }

      if (!ADDITIONAL_DECISION_VISIT_STATUSES.has(context.canonicalVisit.status)) {
        throw fieldError(
          'approval_not_allowed',
          'Customer decision can only be recorded while the technician is actively on site.',
          409,
          { visitStatus: context.canonicalVisit.status },
        );
      }
      if (currentIntervention.status !== 'pending_authorization' || currentScopeChange.resolvedAt) {
        throw fieldError('field_approval_request_conflict', 'This additional work is no longer pending customer authorization.', 409);
      }
      if (!currentIntervention.priceSnapshot) {
        throw fieldError('work_intervention_price_snapshot_required', 'Additional work cannot be authorized without its exact presented price snapshot.', 409);
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const interventionPatch = fieldFirestoreData({
        status: expectedInterventionStatus,
        ...actorUpdateFields(identity, occurredAt, currentIntervention.version + 1),
      }, 'workInterventionDecision');
      const scopePatch = fieldFirestoreData({
        resolvedAt: occurredAt,
        ...actorUpdateFields(identity, occurredAt, currentScopeChange.version + 1),
      }, 'scopeChangeDecision');
      const storedApproval = fieldFirestoreData({
        id: approvalId,
        fieldAuthorityVersion: FIELD_APPROVAL_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        status: expectedApprovalStatus,
        method: 'verbal',
        affected: [
          { type: 'intervention', id: currentIntervention.id },
          { type: 'scope_change', id: currentScopeChange.id },
        ],
        receiverName: normalizedReceiverName,
        decidedAt: occurredAt,
        technicianStaffId: text(identity.staffId, 180) || undefined,
        note: normalizedNote || undefined,
        ...actorCreateFields(identity, occurredAt),
      }, 'fieldApproval');
      const fieldApproval = projectFieldApproval(storedApproval, expectedContext);
      const updatedIntervention = projectWorkIntervention({
        ...fieldSnapshotRecord(interventionSnapshot),
        ...interventionPatch,
      }, expectedContext);
      const updatedScopeChange = projectScopeChange({
        ...fieldSnapshotRecord(scopeChangeSnapshot),
        ...scopePatch,
      }, expectedContext);
      const event = decisionAuditEvent({
        requestId: stable,
        approval: fieldApproval,
        intervention: updatedIntervention,
        scopeChange: updatedScopeChange,
        context,
        identity,
        occurredAt,
        beforeStatus: currentIntervention.status,
      });

      transaction.update(interventionRef, interventionPatch);
      transaction.update(scopeChangeRef, scopePatch);
      transaction.create(approvalRef, storedApproval);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        fieldApproval,
        scopeChange: updatedScopeChange,
        workIntervention: updatedIntervention,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.ADDITIONAL_DECISION_VISIT_STATUSES = ADDITIONAL_DECISION_VISIT_STATUSES;
module.exports.FIELD_APPROVAL_COLLECTION = FIELD_APPROVAL_COLLECTION;
module.exports.FIELD_APPROVAL_STORAGE_VERSION = FIELD_APPROVAL_STORAGE_VERSION;
module.exports.FIELD_APPROVAL_METHODS = FIELD_APPROVAL_METHODS;
module.exports.FIELD_APPROVAL_STATUSES = FIELD_APPROVAL_STATUSES;
module.exports.affectedId = affectedId;
module.exports.approvalForAdditionalIntervention = approvalForAdditionalIntervention;
module.exports.attachFieldApprovalsToJob = attachFieldApprovalsToJob;
module.exports.createRecordAdditionalWorkDecisionCommand = createRecordAdditionalWorkDecisionCommand;
module.exports.loadFieldApprovals = loadFieldApprovals;
module.exports.projectFieldApproval = projectFieldApproval;
module.exports.validateApprovalLinks = validateApprovalLinks;
