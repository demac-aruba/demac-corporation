const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachOfficeReviewSubmissionReadiness,
  createDecideOfficeReviewCommand,
  createSubmitOfficeReviewCommand,
  loadOfficeReviewQueue,
  officeReviewDocumentId,
  officeReviewRevisionDocumentId,
} = require('./fieldOperationsOfficeReview');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, structuredClone(item)]))]),
  );
  const commits = [];
  const ensure = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const matches = (value, filter) => {
    if (filter.op !== '==') throw new Error(`Unsupported fake query operator ${filter.op}`);
    return value?.[filter.field] === filter.expected;
  };
  const documentRef = (collectionName, id) => ({
    kind: 'document', collectionName, id,
    async get() { return snapshot(id, ensure(collectionName).get(id)); },
  });
  const queryRef = (collectionName, filters = []) => ({
    kind: 'query', collectionName, filters,
    where(field, op, expected) { return queryRef(collectionName, [...filters, { field, op, expected }]); },
    async get() {
      return {
        docs: [...ensure(collectionName).entries()]
          .filter(([, value]) => filters.every((filter) => matches(value, filter)))
          .map(([id, value]) => snapshot(id, value)),
      };
    },
  });

  const db = {
    collection(name) {
      return {
        doc(id) { return documentRef(name, id); },
        where(field, op, expected) { return queryRef(name, [{ field, op, expected }]); },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(target) {
          if (target.kind === 'query') return target.get();
          return snapshot(target.id, ensure(target.collectionName).get(target.id));
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'create', ref, value: structuredClone(value) });
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: structuredClone(patch) });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'create') ensure(write.ref.collectionName).set(write.ref.id, write.value);
        else ensure(write.ref.collectionName).set(write.ref.id, { ...ensure(write.ref.collectionName).get(write.ref.id), ...write.patch });
      }
      commits.push(writes);
      return result;
    },
  };

  return {
    db,
    commits,
    all(name) { return [...ensure(name).values()].map((value) => structuredClone(value)); },
    get(name, id) { const value = ensure(name).get(id); return value && structuredClone(value); },
  };
}

function scope() {
  return {
    appointmentId: 'APT-1', capturedAt: '2026-08-25T10:00:00.000Z', estimatedUnitCount: 1,
    workLines: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    customerFacingDescription: 'Service one A/C.', technicianInstructions: 'Complete standard checklist.',
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', scheduledScopeSnapshot: scope(), status: 'in_progress',
    leadTechnicianStaffId: 'staff-1', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:10:00.000Z', startedAt: '2026-08-25T10:15:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T11:00:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'En proceso', date: '2026-08-25', technicianIds: ['staff-1'], ...overrides,
  };
}

function visitAsset(overrides = {}) {
  return {
    id: 'VA-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-1', sequence: 1,
    locationLabel: 'Sala', source: 'existing_asset', status: 'identified', addedOnSite: false,
    createdAt: '2026-08-25T10:20:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function reportTemplate() {
  return {
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [{
      id: 'condition', title: 'Condition', type: 'checklist', required: true,
      checklistItems: [{ id: 'filter-clean', label: 'Filter cleaned' }],
    }],
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1',
    plannedWorkLineId: 'line-1', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'completed', templateId: 'standard-report', templateVersion: 2,
    reportTemplateSnapshot: reportTemplate(), reportSectionStatus: { condition: 'completed' },
    startedAt: '2026-08-25T10:25:00.000Z', completedAt: '2026-08-25T10:55:00.000Z',
    performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T10:20:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:55:00.000Z', updatedByUserId: 'uid-1', version: 3,
    ...overrides,
  };
}

function checklistResponse(overrides = {}) {
  return {
    id: 'CHECK-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1',
    interventionId: 'WI-1', sectionId: 'condition', itemId: 'filter-clean', checked: true,
    technicianStaffId: 'staff-1', respondedAt: '2026-08-25T10:45:00.000Z', lastRequestId: 'check-filter-001',
    createdAt: '2026-08-25T10:45:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:45:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function saleLine(overrides = {}) {
  return {
    id: 'FSL-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-1', catalogItemId: 'product-switch',
    descriptionSnapshot: '220V Switch', quantity: 2, unit: 'ea',
    priceSnapshot: { currency: 'AWG', unitPrice: 75, lineTotal: 150, sourceCatalogItemId: 'product-switch', pricingVersion: 'service-catalog:product-switch:fixed', capturedAt: '2026-08-25T10:30:00.000Z' },
    status: 'sold', soldByStaffId: 'staff-1', requiresCustomerApproval: true, customerApprovalId: 'FA-SALE-1',
    nonCatalog: false, officeReviewRequired: false,
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:50:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function saleApproval(overrides = {}) {
  return {
    id: 'FA-SALE-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'approved', method: 'verbal',
    affected: [{ type: 'sale_line', id: 'FSL-1' }], receiverName: 'Maria Client',
    decidedAt: '2026-08-25T10:35:00.000Z', technicianStaffId: 'staff-1',
    createdAt: '2026-08-25T10:35:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:35:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

const technician = {
  uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', email: 'tech@example.invalid', role: 'technician', operations: false,
};
const reviewer = {
  uid: 'office-1', staffId: 'office-staff-1', name: 'Office One', email: 'office@example.invalid', role: 'operations', operations: true,
};

function fixture(options = {}) {
  const store = createDb({
    workOrders: [options.order || order()],
    workVisits: options.visits || [options.visit || visit()],
    visitAssets: options.visitAssets || [visitAsset()],
    workInterventions: options.interventions || [intervention()],
    plannedWorkDispositions: options.dispositions || [],
    scopeChanges: options.scopeChanges || [],
    fieldApprovals: options.approvals || [],
    fieldSaleLines: options.saleLines || [],
    fieldOfficeReviews: options.reviews || [],
    fieldOfficeReviewRevisions: options.revisions || [],
    fieldInventoryHandoffs: options.inventoryHandoffs || [],
    fieldBillingCandidates: options.billingCandidates || [],
    fieldEvidence: options.evidence || [],
    fieldMeasurements: options.measurements || [],
    fieldFindings: options.findings || [],
    fieldChecklistResponses: options.checklistResponses === undefined ? [checklistResponse()] : options.checklistResponses,
    fieldFreeTextResponses: options.freeTextResponses || [],
    fieldCustomerAcknowledgements: options.customerAcknowledgements || [],
  });
  const auditEvents = [];
  const appendAuditInTransaction = options.appendAuditInTransaction || (async ({ event }) => auditEvents.push(event));
  const resolveAssignment = options.resolveAssignment || (async () => ({
    assigned: true, responsibility: 'lead', source: 'direct_staff', readOnly: false,
    leadTechnicianStaffId: 'staff-1', participatingStaffIds: ['staff-1'],
  }));
  const submit = createSubmitOfficeReviewCommand({
    db: store.db, resolveAssignment, appendAuditInTransaction,
    now: options.submitNow || (() => '2026-08-25T11:10:00.000Z'),
  });
  const decide = createDecideOfficeReviewCommand({
    db: store.db, appendAuditInTransaction,
    now: options.decideNow || (() => '2026-08-25T11:20:00.000Z'),
  });
  return { store, auditEvents, submit, decide };
}

const submitInput = {
  identity: technician, visitId: 'visit-WO-1', expectedVersion: 4, requestId: 'office-review-submit-001',
};

test('submits canonical field truth as one immutable Office Review revision and locks technician transitions', async () => {
  const { store, auditEvents, submit } = fixture();
  const result = await submit(submitInput);
  const reviewId = officeReviewDocumentId('WO-1');
  const revisionId = officeReviewRevisionDocumentId(reviewId, 1);

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.review.id, reviewId);
  assert.equal(result.review.status, 'pending');
  assert.equal(result.revision.id, revisionId);
  assert.equal(result.revision.snapshot.source, 'canonical_field_truth');
  assert.equal(result.revision.snapshot.professionalReportPreview.status, 'field_complete');
  assert.deepEqual(result.revision.snapshot.visitAssets.map((item) => item.id), ['VA-1']);
  assert.deepEqual(result.revision.snapshot.interventions.map((item) => item.id), ['WI-1']);
  assert.deepEqual(result.revision.snapshot.plannedWorkDispositions, []);
  assert.deepEqual(result.revision.snapshot.scopeChanges, []);
  assert.deepEqual(result.revision.snapshot.approvals, []);
  assert.equal(result.revision.snapshot.reports[0].template.name, 'Standard Report');
  assert.deepEqual(result.revision.snapshot.reports[0].sectionStatus, { condition: 'completed' });
  assert.equal(result.revision.snapshot.reports[0].checklistResponses[0].itemId, 'filter-clean');
  assert.equal(result.revision.snapshot.reports[0].checklistResponses[0].checked, true);
  assert.equal(result.visit.status, 'ready_for_office_review');
  assert.deepEqual(result.visit.availableTransitions, []);
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'ready_for_office_review');
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 5);
  assert.equal(store.all('fieldOfficeReviews').length, 1);
  assert.equal(store.all('fieldOfficeReviewRevisions').length, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, 'office_review_submitted');
});

test('Office Review refuses a completed report section whose canonical content is missing', async () => {
  const ghostCompletion = fixture({ checklistResponses: [] });
  await assert.rejects(
    () => ghostCompletion.submit(submitInput),
    (error) => error?.code === 'office_review_report_content_conflict' && error?.status === 409,
  );
});

test('Office Review refuses duplicate canonical responses for one frozen checklist item', async () => {
  const duplicate = fixture({
    checklistResponses: [checklistResponse(), checklistResponse({ id: 'CHECK-DUPLICATE', lastRequestId: 'check-filter-duplicate-001' })],
  });
  await assert.rejects(
    () => duplicate.submit(submitInput),
    (error) => error?.code === 'office_review_report_content_conflict' && error?.status === 409,
  );
});

test('exact submission retry replays without duplicate review, revision or audit', async () => {
  const { store, auditEvents, submit } = fixture();
  const first = await submit(submitInput);
  const replay = await submit(submitInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.review.id, first.review.id);
  assert.equal(store.all('fieldOfficeReviews').length, 1);
  assert.equal(store.all('fieldOfficeReviewRevisions').length, 1);
  assert.equal(store.commits[1].length, 0);
  assert.equal(auditEvents.length, 1);
  await assert.rejects(
    () => submit({ ...submitInput, requestId: 'office-review-submit-002', expectedVersion: 5 }),
    (error) => error?.code === 'office_review_already_pending',
  );
});

test('Office Review freezes terminal catalog sales, blocks active sales, and accepts unpriced non-catalog drafts', async () => {
  const completed = fixture({ saleLines: [saleLine()], approvals: [saleApproval()] });
  const frozen = await completed.submit(submitInput);
  assert.equal(frozen.revision.snapshot.fieldSaleLines.length, 1);
  assert.equal(frozen.revision.snapshot.fieldSaleLines[0].status, 'sold');
  assert.equal(frozen.revision.snapshot.fieldSaleLines[0].requiresCustomerApproval, true);
  assert.equal(frozen.revision.snapshot.fieldSaleLines[0].priceSnapshot.lineTotal, 150);

  const active = fixture({ saleLines: [saleLine({ status: 'customer_approved', version: 2 })], approvals: [saleApproval()] });
  await assert.rejects(
    () => active.submit(submitInput),
    (error) => error?.code === 'office_review_submission_blocked'
      && error?.details?.blockers?.some((item) => item.code === 'field_sale_line_not_terminal'),
  );

  const customDraft = saleLine({
    id: 'FSL-CUSTOM', assetId: undefined, catalogItemId: undefined, descriptionSnapshot: 'Custom mounting bracket',
    quantity: 1, priceSnapshot: undefined, status: 'proposed', requiresCustomerApproval: false,
    customerApprovalId: undefined, nonCatalog: true, officeReviewRequired: true, version: 1,
  });
  const custom = fixture({ saleLines: [customDraft] });
  const submitted = await custom.submit(submitInput);
  assert.equal(submitted.revision.snapshot.fieldSaleLines[0].nonCatalog, true);
  assert.equal(submitted.revision.snapshot.fieldSaleLines[0].priceSnapshot, undefined);
});

test('server readiness blocks active work, incomplete required reports and unreconciled planned work', async () => {
  const active = fixture({ interventions: [intervention({ status: 'in_progress', completedAt: undefined })] });
  await assert.rejects(
    () => active.submit(submitInput),
    (error) => error?.code === 'office_review_submission_blocked'
      && error?.details?.blockers?.some((item) => item.code === 'intervention_not_terminal'),
  );

  const incomplete = fixture({
    interventions: [intervention({ status: 'in_progress', completedAt: undefined, reportSectionStatus: { condition: 'pending' } })],
    checklistResponses: [],
  });
  await assert.rejects(
    () => incomplete.submit(submitInput),
    (error) => error?.details?.blockers?.some((item) => item.code === 'required_report_section_incomplete'),
  );

  const unreconciled = fixture({ interventions: [], checklistResponses: [] });
  await assert.rejects(
    () => unreconciled.submit(submitInput),
    (error) => error?.details?.blockers?.some((item) => item.code === 'planned_work_unreconciled'),
  );
});

test('get_job readiness is derived server-side and locks once a pending revision exists', async () => {
  const { store, submit } = fixture();
  const job = {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    allowedActions: ['read', 'execute', 'visit.complete'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
  };
  const ready = await attachOfficeReviewSubmissionReadiness(store.db, job);
  assert.deepEqual(ready.officeReviewSubmission, {
    allowed: true, status: 'ready', reviewId: undefined, revisionNumber: undefined,
    correctionRequired: false, reviewerNote: undefined, blockers: [],
  });

  const submitted = await submit(submitInput);
  const locked = await attachOfficeReviewSubmissionReadiness(store.db, {
    ...job, fieldVisit: { id: 'visit-WO-1', status: 'ready_for_office_review' },
  });
  assert.equal(locked.officeReviewSubmission.allowed, false);
  assert.equal(locked.officeReviewSubmission.status, 'pending');
  assert.equal(locked.officeReviewSubmission.reviewId, submitted.review.id);
  assert.equal(locked.officeReviewSubmission.revisionNumber, 1);
});

test('a visit requiring another physical return cannot be submitted as final Office Review', async () => {
  const current = fixture({
    visit: visit({
      status: 'requires_return_visit', requiresSecondVisit: true,
      secondVisitRequiredAt: '2026-08-25T11:00:00.000Z', secondVisitReason: 'Return with capacitor.',
    }),
    interventions: [intervention({ status: 'pending_part', completedAt: undefined, resultNotes: 'Capacitor required.' })],
  });
  await assert.rejects(
    () => current.submit(submitInput),
    (error) => error?.details?.blockers?.some((item) => item.code === 'visit_status_not_submittable'),
  );
});

test('only accountable lead authority may submit; helpers and direct technicians fail closed', async () => {
  for (const responsibility of ['helper', 'technician']) {
    const current = fixture({ resolveAssignment: async () => ({ assigned: true, responsibility, source: 'crew', readOnly: responsibility === 'helper' }) });
    await assert.rejects(() => current.submit(submitInput), (error) => error?.code === 'permission_denied' && error?.status === 403);
  }
});

test('office return requires reviewer authority and correction note, preserves revision, and reopens the visit', async () => {
  const { store, auditEvents, submit, decide } = fixture();
  const submitted = await submit(submitInput);
  await assert.rejects(
    () => decide({ identity: technician, reviewId: submitted.review.id, decision: 'return', note: 'Fix report.', expectedVersion: 1, requestId: 'review-return-001' }),
    (error) => error?.code === 'permission_denied',
  );
  await assert.rejects(
    () => decide({ identity: reviewer, reviewId: submitted.review.id, decision: 'return', note: '', expectedVersion: 1, requestId: 'review-return-001' }),
    (error) => error?.code === 'office_review_note_required',
  );
  const returned = await decide({
    identity: reviewer, reviewId: submitted.review.id, decision: 'return', note: 'Clarify the final condition.',
    expectedVersion: 1, requestId: 'review-return-001',
  });
  assert.equal(returned.review.status, 'returned');
  assert.equal(returned.review.version, 2);
  assert.equal(returned.review.reviewerNote, 'Clarify the final condition.');
  assert.equal(returned.visit.status, 'in_progress');
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'in_progress');
  assert.equal(store.all('fieldOfficeReviewRevisions').length, 1);
  assert.equal(auditEvents.at(-1).type, 'office_review_returned');
  const readiness = await attachOfficeReviewSubmissionReadiness(store.db, {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    allowedActions: ['read', 'execute', 'visit.complete'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
  });
  assert.equal(readiness.officeReviewSubmission.allowed, true);
  assert.equal(readiness.officeReviewSubmission.correctionRequired, true);
  assert.equal(readiness.officeReviewSubmission.reviewerNote, 'Clarify the final condition.');
});

test('corrected resubmission requires an amendment note and freezes both sides of correction context in revision 2', async () => {
  const { store, submit, decide } = fixture();
  const first = await submit(submitInput);
  await decide({
    identity: reviewer, reviewId: first.review.id, decision: 'return', note: 'Clarify condition.',
    expectedVersion: 1, requestId: 'review-return-001',
  });
  await assert.rejects(
    () => submit({ ...submitInput, expectedVersion: 6, requestId: 'office-review-submit-002' }),
    (error) => error?.code === 'office_review_correction_note_required',
  );
  const correctionNote = 'Clarified the final equipment condition and customer-facing conclusion.';
  const correctedInput = {
    ...submitInput, expectedVersion: 6, requestId: 'office-review-submit-002', correctionNote,
  };
  const second = await submit(correctedInput);
  const replay = await submit(correctedInput);

  assert.equal(second.review.id, first.review.id);
  assert.equal(second.review.status, 'pending');
  assert.equal(second.review.currentRevisionNumber, 2);
  assert.equal(second.review.reviewedAt, undefined);
  assert.equal(second.review.reviewerNote, undefined);
  assert.equal(store.all('fieldOfficeReviews').length, 1);
  assert.equal(store.all('fieldOfficeReviewRevisions').length, 2);
  assert.equal(store.get('fieldOfficeReviewRevisions', first.revision.id).requestId, 'office-review-submit-001');
  assert.equal(second.revision.id, officeReviewRevisionDocumentId(first.review.id, 2));
  assert.equal(second.revision.correctionOfRevisionId, first.revision.id);
  assert.equal(second.revision.officeReturnNote, 'Clarify condition.');
  assert.equal(second.revision.technicianCorrectionNote, correctionNote);
  assert.equal(replay.replayed, true);
  assert.equal(store.all('fieldOfficeReviewRevisions').length, 2);
});

test('office approval completes the visit, locks the approved review, and exact retry is idempotent', async () => {
  const { store, auditEvents, submit, decide } = fixture();
  const submitted = await submit(submitInput);
  const input = {
    identity: reviewer, reviewId: submitted.review.id, decision: 'approve', note: 'Verified.',
    expectedVersion: 1, requestId: 'review-approve-001',
  };
  const approved = await decide(input);
  const replay = await decide(input);
  assert.equal(approved.review.status, 'approved');
  assert.equal(approved.visit.status, 'completed');
  assert.equal(approved.inventoryHandoff, null);
  assert.equal(approved.billingCandidate.status, 'needs_pricing_review');
  assert.deepEqual(approved.billingCandidate.blockers.map((item) => item.code), ['completed_intervention_price_required']);
  assert.equal(replay.replayed, true);
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'completed');
  assert.equal(auditEvents.filter((event) => event.type === 'office_review_approved').length, 1);
  await assert.rejects(
    () => submit({ ...submitInput, expectedVersion: 6, requestId: 'office-review-submit-after-approval' }),
    (error) => error?.code === 'office_review_approved_immutable',
  );
});

test('office approval emits one immutable Inventory handoff candidate for sold catalog Products without changing stock', async () => {
  const { store, auditEvents, submit, decide } = fixture({
    order: order({ vanId: 'VAN-1' }),
    saleLines: [saleLine()],
    approvals: [saleApproval()],
  });
  const submitted = await submit(submitInput);
  const input = {
    identity: reviewer, reviewId: submitted.review.id, decision: 'approve', note: 'Verified inventory evidence.',
    expectedVersion: 1, requestId: 'review-approve-inventory-001',
  };
  const approved = await decide(input);
  const replay = await decide(input);

  assert.equal(approved.inventoryHandoff.status, 'ready_for_inventory_authority');
  assert.equal(approved.inventoryHandoff.sourceLocationId, 'VAN-1');
  assert.deepEqual(approved.inventoryHandoff.lines.map((line) => [line.sourceSaleLineId, line.itemId, line.quantity]), [
    ['FSL-1', 'product-switch', 2],
  ]);
  assert.deepEqual(approved.inventoryHandoff.inventoryMovementIds, []);
  assert.equal(replay.inventoryHandoff.id, approved.inventoryHandoff.id);
  assert.equal(store.all('fieldInventoryHandoffs').length, 1);
  assert.equal(store.all('inventoryMovements').length, 0);
  assert.equal(store.all('commercialProductStock').length, 0);
  assert.equal(auditEvents.at(-1).after.inventoryHandoffId, approved.inventoryHandoff.id);
});

test('office approval emits actual priced work as one immutable Billing candidate without creating invoice lines', async () => {
  const servicePrice = { currency: 'AWG', unitPrice: 150, lineTotal: 150, sourceCatalogItemId: 'service-standard', pricingVersion: 'service-standard:fixed', capturedAt: '2026-08-25T10:20:00.000Z' };
  const { store, auditEvents, submit, decide } = fixture({
    interventions: [intervention({ priceSnapshot: servicePrice })], saleLines: [saleLine()], approvals: [saleApproval()],
  });
  const submitted = await submit(submitInput);
  const input = { identity: reviewer, reviewId: submitted.review.id, decision: 'approve', note: 'Verified Billing evidence.', expectedVersion: 1, requestId: 'review-approve-billing-001' };
  const approved = await decide(input);
  const replay = await decide(input);
  assert.equal(approved.billingCandidate.status, 'ready_for_billing_review');
  assert.deepEqual(approved.billingCandidate.lines.map((line) => [line.sourceType, line.sourceId, line.lineTotal]), [['intervention', 'WI-1', 150], ['sale_line', 'FSL-1', 150]]);
  assert.deepEqual(approved.billingCandidate.invoiceLineIds, []);
  assert.equal(replay.billingCandidate.id, approved.billingCandidate.id);
  assert.equal(store.all('fieldBillingCandidates').length, 1);
  assert.equal(store.all('invoices').length, 0);
  assert.equal(auditEvents.at(-1).after.billingCandidateId, approved.billingCandidate.id);
});

test('Inventory handoff records review blockers instead of guessing a missing source location', async () => {
  const { submit, decide } = fixture({ saleLines: [saleLine()], approvals: [saleApproval()] });
  const submitted = await submit(submitInput);
  const approved = await decide({
    identity: reviewer, reviewId: submitted.review.id, decision: 'approve', note: '',
    expectedVersion: 1, requestId: 'review-approve-inventory-review-001',
  });
  assert.equal(approved.inventoryHandoff.status, 'needs_inventory_review');
  assert.equal(approved.inventoryHandoff.sourceLocationId, undefined);
  assert.deepEqual(approved.inventoryHandoff.blockers.map((item) => item.code), ['inventory_source_location_required']);
});

test('Office Review aggregates a linear physical-return chain and fails closed on branching or scope drift', async () => {
  const first = visit({
    id: 'visit-WO-1', status: 'requires_return_visit', requiresSecondVisit: true,
    secondVisitRequiredAt: '2026-08-25T11:00:00.000Z', secondVisitReason: 'Return with capacitor.', version: 5,
  });
  const second = visit({
    id: 'visit-WO-2', previousVisitId: 'visit-WO-1', status: 'in_progress',
    createdAt: '2026-08-26T09:00:00.000Z', updatedAt: '2026-08-26T10:00:00.000Z', version: 4,
  });
  const chain = fixture({
    visits: [first, second],
    visitAssets: [visitAsset(), visitAsset({ id: 'VA-2', visitId: 'visit-WO-2' })],
    interventions: [
      intervention({ status: 'pending_part', completedAt: undefined, resultNotes: 'Capacitor required.', reportSectionStatus: { condition: 'pending' } }),
      intervention({ id: 'WI-2', visitId: 'visit-WO-2', visitAssetId: 'VA-2' }),
    ],
    checklistResponses: [checklistResponse({ id: 'CHECK-2', visitId: 'visit-WO-2', visitAssetId: 'VA-2', interventionId: 'WI-2' })],
  });
  const result = await chain.submit({ ...submitInput, visitId: 'visit-WO-2' });
  assert.equal(result.revision.snapshot.visitChain.length, 2);
  assert.equal(result.revision.snapshot.professionalReportPreview.status, 'field_complete');
  assert.equal(result.revision.snapshot.professionalReportPreview.interventionCount, 1);

  const drift = fixture({
    visits: [first, visit({ ...second, scheduledScopeSnapshot: { ...scope(), technicianInstructions: 'Changed.' } })],
    visitAssets: [visitAsset(), visitAsset({ id: 'VA-2', visitId: 'visit-WO-2' })],
    interventions: [intervention(), intervention({ id: 'WI-2', visitId: 'visit-WO-2', visitAssetId: 'VA-2', plannedWorkLineId: undefined, origin: 'planned' })],
    checklistResponses: [checklistResponse(), checklistResponse({ id: 'CHECK-2', visitId: 'visit-WO-2', visitAssetId: 'VA-2', interventionId: 'WI-2' })],
  });
  await assert.rejects(
    () => drift.submit({ ...submitInput, visitId: 'visit-WO-2' }),
    (error) => error?.code === 'visit_scope_conflict' && error?.status === 409,
  );

  const branch = fixture({ visits: [first, second, visit({ id: 'visit-WO-3', previousVisitId: 'visit-WO-1' })] });
  await assert.rejects(
    () => branch.submit({ ...submitInput, visitId: 'visit-WO-3' }),
    (error) => error?.code === 'work_visit_history_ambiguous'
      && error?.details?.reason === 'multiple_or_missing_chain_tip',
  );
});

test('operations queue returns canonical pending and returned reviews with their current immutable revisions', async () => {
  const { store, submit, decide } = fixture();
  const submitted = await submit(submitInput);
  let queue = await loadOfficeReviewQueue(store.db, reviewer);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, submitted.review.id);
  assert.equal(queue[0].currentRevision.id, submitted.revision.id);
  await decide({
    identity: reviewer, reviewId: submitted.review.id, decision: 'return', note: 'Correct summary.',
    expectedVersion: 1, requestId: 'review-return-queue-001',
  });
  queue = await loadOfficeReviewQueue(store.db, reviewer);
  assert.equal(queue[0].status, 'returned');
  await assert.rejects(() => loadOfficeReviewQueue(store.db, technician), (error) => error?.code === 'permission_denied');
});

test('audit failure rolls back Office Review submission and decision atomically', async () => {
  const submitFailure = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => submitFailure.submit(submitInput), /audit unavailable/);
  assert.equal(submitFailure.store.all('fieldOfficeReviews').length, 0);
  assert.equal(submitFailure.store.get('workVisits', 'visit-WO-1').version, 4);
  assert.equal(submitFailure.store.commits.length, 0);

  const decisionFixture = fixture({
    order: order({ vanId: 'VAN-1' }),
    saleLines: [saleLine()],
    approvals: [saleApproval()],
  });
  const submitted = await decisionFixture.submit(submitInput);
  const failingDecision = createDecideOfficeReviewCommand({
    db: decisionFixture.store.db,
    now: () => '2026-08-25T11:20:00.000Z',
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(
    () => failingDecision({ identity: reviewer, reviewId: submitted.review.id, decision: 'approve', note: '', expectedVersion: 1, requestId: 'review-approve-fail' }),
    /audit unavailable/,
  );
  assert.equal(decisionFixture.store.get('fieldOfficeReviews', submitted.review.id).status, 'pending');
  assert.equal(decisionFixture.store.get('workVisits', 'visit-WO-1').status, 'ready_for_office_review');
  assert.equal(decisionFixture.store.all('fieldInventoryHandoffs').length, 0);
  assert.equal(decisionFixture.store.all('fieldBillingCandidates').length, 0);
});
