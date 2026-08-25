const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachFieldApprovalsToJob,
  createRecordAdditionalWorkDecisionCommand,
  projectFieldApproval,
} = require('./fieldOperationsApprovals');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map((values || []).map((item) => [item.id, { ...item }]))]),
  );
  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  function docRef(collectionName, id) {
    return { kind: 'document', collectionName, id };
  }
  function queryRef(collectionName, filters = []) {
    return {
      kind: 'query', collectionName, filters,
      where(field, op, expected) {
        assert.equal(op, '==');
        return queryRef(collectionName, [...filters, { field, expected }]);
      },
      async get() {
        return {
          docs: [...ensure(collectionName).entries()]
            .filter(([, value]) => filters.every((filter) => value?.[filter.field] === filter.expected))
            .map(([id, value]) => snapshot(id, value)),
        };
      },
    };
  }
  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = docRef(name, id);
          return { ...ref, async get() { return snapshot(id, ensure(name).get(id)); } };
        },
        where(field, op, expected) {
          assert.equal(op, '==');
          return queryRef(name, [{ field, expected }]);
        },
        async get() {
          return { docs: [...ensure(name).entries()].map(([id, value]) => snapshot(id, value)) };
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(target) {
          if (target.kind === 'query') {
            return {
              docs: [...ensure(target.collectionName).entries()]
                .filter(([, value]) => target.filters.every((filter) => value?.[filter.field] === filter.expected))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, ensure(target.collectionName).get(target.id));
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'create', ref, value: { ...value } });
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Document missing: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, value: { ...patch } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        const map = ensure(write.ref.collectionName);
        if (write.type === 'create') map.set(write.ref.id, { ...write.value });
        else map.set(write.ref.id, { ...map.get(write.ref.id), ...write.value });
      }
      return result;
    },
  };
  return {
    db,
    all(name) { return [...ensure(name).entries()].map(([id, value]) => ({ id, ...value })); },
    get(name, id) { return ensure(name).get(id); },
    set(name, id, value) { ensure(name).set(id, { ...value }); },
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1', capturedAt: '2026-08-25T10:00:00.000Z', estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1 }],
    },
    status: 'on_site', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:15:00.000Z', createdAt: '2026-08-25T10:00:00.000Z',
    createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:15:00.000Z', updatedByUserId: 'uid-1', version: 3,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'En el sitio', date: '2026-08-25', technicianIds: ['staff-1'],
    ...overrides,
  };
}

function priceSnapshot(overrides = {}) {
  return {
    currency: 'AWG', unitPrice: 125, sourceCatalogItemId: 'service-standard',
    pricingVersion: 'company-service-pricing-rules:v7:standard_service:12000',
    capturedAt: '2026-08-25T10:30:00.000Z',
    ...overrides,
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1',
    serviceCatalogItemId: 'service-standard', interventionType: '12K Standard Service',
    origin: 'added_on_site_client_request', requestedBy: 'client', status: 'pending_authorization',
    priceSnapshot: priceSnapshot(), scopeChangeId: 'SC-1', performedByStaffIds: [],
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function scopeChange(overrides = {}) {
  return {
    id: 'SC-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', interventionId: 'WI-1',
    origin: 'client_requested_additional_work', reason: 'Client requested additional bedroom service.',
    requestedByStaffId: 'staff-1', requestedAt: '2026-08-25T10:30:00.000Z',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function storedApproval(overrides = {}) {
  return {
    id: 'FA-existing', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'approved', method: 'verbal',
    affected: [{ type: 'intervention', id: 'WI-1' }, { type: 'scope_change', id: 'SC-1' }],
    receiverName: 'Maria Customer', decidedAt: '2026-08-25T10:35:00.000Z', technicianStaffId: 'staff-1',
    createdAt: '2026-08-25T10:35:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:35:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function identity() {
  return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: [options.visit || visit()],
    workOrders: [options.order || order()],
    workInterventions: options.workInterventions || [intervention()],
    scopeChanges: options.scopeChanges || [scopeChange()],
    fieldApprovals: options.fieldApprovals || [],
  });
  const events = [];
  const recordDecision = createRecordAdditionalWorkDecisionCommand({
    db: store.db,
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
    now: () => '2026-08-25T10:35:00.000Z',
  });
  return { store, events, recordDecision };
}

function input(overrides = {}) {
  return {
    identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', decision: 'approved',
    receiverName: 'Maria Customer', note: 'Approved verbally on site.', requestId: 'decision-001',
    ...overrides,
  };
}

test('verbal customer approval atomically creates FieldApproval and resolves ScopeChange without changing presented price', async () => {
  const { store, events, recordDecision } = fixture();
  const originalPrice = structuredClone(store.get('workInterventions', 'WI-1').priceSnapshot);
  const result = await recordDecision(input());

  assert.equal(result.replayed, false);
  assert.equal(result.fieldApproval.status, 'approved');
  assert.equal(result.fieldApproval.method, 'verbal');
  assert.equal(result.fieldApproval.receiverName, 'Maria Customer');
  assert.deepEqual(result.fieldApproval.affected, [
    { type: 'intervention', id: 'WI-1' },
    { type: 'scope_change', id: 'SC-1' },
  ]);
  assert.equal(result.workIntervention.status, 'confirmed');
  assert.deepEqual(result.workIntervention.priceSnapshot, originalPrice);
  assert.equal(result.scopeChange.resolvedAt, '2026-08-25T10:35:00.000Z');
  assert.equal(store.all('fieldApprovals').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(store.get('scopeChanges', 'SC-1').version, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'additional_work_customer_decision_recorded');
  assert.equal(events[0].after.priceSnapshot.unitPrice, 125);
});

test('verbal customer rejection preserves proposal history and marks intervention declined', async () => {
  const { store, recordDecision } = fixture();
  const result = await recordDecision(input({ decision: 'rejected', note: 'Customer declined the additional service.' }));
  assert.equal(result.fieldApproval.status, 'rejected');
  assert.equal(result.workIntervention.status, 'declined');
  assert.equal(result.scopeChange.resolvedAt, '2026-08-25T10:35:00.000Z');
  assert.equal(store.get('workInterventions', 'WI-1').priceSnapshot.unitPrice, 125);
});

test('same customer decision replays idempotently and conflicting decision or receiver fails closed', async () => {
  const { store, events, recordDecision } = fixture();
  const first = await recordDecision(input());
  const replay = await recordDecision(input());
  assert.equal(replay.replayed, true);
  assert.equal(replay.fieldApproval.id, first.fieldApproval.id);
  assert.equal(events.length, 1);
  assert.equal(store.all('fieldApprovals').length, 1);

  await assert.rejects(
    () => recordDecision(input({ decision: 'rejected', requestId: 'decision-002' })),
    (error) => error?.code === 'field_approval_request_conflict' && error?.status === 409,
  );
  await assert.rejects(
    () => recordDecision(input({ receiverName: 'Different Person', requestId: 'decision-003' })),
    (error) => error?.code === 'field_approval_request_conflict' && error?.status === 409,
  );
});

test('helper, read-only fallback and unassigned principals cannot record customer decisions', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ source: 'profile_van_fallback', readOnly: true }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const { store, recordDecision } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => recordDecision(input({ requestId: `decision-denied-${denied.source}` })),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.all('fieldApprovals').length, 0);
    assert.equal(store.get('workInterventions', 'WI-1').status, 'pending_authorization');
  }
});

test('decision requires active on-site visit, additional origin, exact price and unresolved pending scope', async () => {
  const preArrival = fixture({ visit: visit({ status: 'scheduled', arrivedAt: undefined }) });
  await assert.rejects(
    () => preArrival.recordDecision(input({ requestId: 'decision-prearrival' })),
    (error) => error?.code === 'approval_not_allowed' && error?.status === 409,
  );

  const planned = fixture({ workInterventions: [intervention({
    origin: 'planned', requestedBy: 'office', plannedWorkLineId: 'line-standard', scopeChangeId: undefined,
  })] });
  await assert.rejects(
    () => planned.recordDecision(input({ requestId: 'decision-planned' })),
    (error) => error?.code === 'approval_not_allowed' && error?.status === 409,
  );

  const noPrice = fixture({ workInterventions: [intervention({ priceSnapshot: undefined })] });
  await assert.rejects(
    () => noPrice.recordDecision(input({ requestId: 'decision-no-price' })),
    (error) => error?.code === 'work_intervention_price_snapshot_required' && error?.status === 409,
  );

  const resolved = fixture({ scopeChanges: [scopeChange({ resolvedAt: '2026-08-25T10:34:00.000Z' })] });
  await assert.rejects(
    () => resolved.recordDecision(input({ requestId: 'decision-resolved' })),
    (error) => error?.code === 'field_approval_request_conflict' && error?.status === 409,
  );
});

test('receiver and decision vocabulary are validated before any write', async () => {
  const { store, recordDecision } = fixture();
  await assert.rejects(
    () => recordDecision(input({ receiverName: ' ', requestId: 'decision-no-receiver' })),
    (error) => error?.code === 'approval_receiver_required' && error?.status === 400,
  );
  await assert.rejects(
    () => recordDecision(input({ decision: 'completed', requestId: 'decision-invalid' })),
    (error) => error?.code === 'invalid_customer_decision' && error?.status === 400,
  );
  assert.equal(store.all('fieldApprovals').length, 0);
});

test('audit failure rolls back approval, ScopeChange resolution and intervention status', async () => {
  const { store, recordDecision } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(() => recordDecision(input()), /audit unavailable/);
  assert.equal(store.all('fieldApprovals').length, 0);
  assert.equal(store.get('workInterventions', 'WI-1').status, 'pending_authorization');
  assert.equal(store.get('scopeChanges', 'SC-1').resolvedAt, undefined);
});

test('FieldApproval projection fails closed on schema, identity, method, affected refs, receiver, time and version drift', () => {
  const valid = storedApproval();
  assert.equal(projectFieldApproval(valid).status, 'approved');
  assert.throws(() => projectFieldApproval({ ...valid, fieldAuthorityVersion: 2 }), /Unsupported Field Approval storage version/);
  assert.throws(() => projectFieldApproval({ ...valid, propertyId: '' }), /Property identity is missing or conflicting/);
  assert.throws(() => projectFieldApproval({ ...valid, method: 'future_method' }), /Unknown persisted Field Approval method/);
  assert.throws(() => projectFieldApproval({ ...valid, affected: [] }), /affected references are missing/);
  assert.throws(() => projectFieldApproval({ ...valid, receiverName: '' }), /receiverName is missing/);
  assert.throws(() => projectFieldApproval({ ...valid, decidedAt: 'bad-time' }), /decidedAt is invalid/);
  assert.throws(() => projectFieldApproval({ ...valid, version: 1.5 }), /version is invalid/);
});

test('job projection exposes only pending additional interventions eligible for decision and reconciles final decisions', async () => {
  const pendingStore = createDb({ fieldApprovals: [] });
  const pendingJob = {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    fieldVisit: { id: 'visit-WO-1', status: 'on_site' }, allowedActions: ['read', 'execute'],
    workInterventions: [intervention()], scopeChanges: [scopeChange()],
  };
  const pending = await attachFieldApprovalsToJob(pendingStore.db, pendingJob);
  assert.deepEqual(pending.additionalApprovalInterventionIds, ['WI-1']);
  assert.equal(pending.canRecordAdditionalApproval, true);

  const helper = await attachFieldApprovalsToJob(pendingStore.db, { ...pendingJob, allowedActions: ['read'] });
  assert.deepEqual(helper.additionalApprovalInterventionIds, []);
  assert.equal(helper.canRecordAdditionalApproval, false);

  const approvedStore = createDb({ fieldApprovals: [storedApproval()] });
  const approved = await attachFieldApprovalsToJob(approvedStore.db, {
    ...pendingJob,
    workInterventions: [intervention({ status: 'confirmed', version: 2, updatedAt: '2026-08-25T10:35:00.000Z' })],
    scopeChanges: [scopeChange({ resolvedAt: '2026-08-25T10:35:00.000Z', version: 2, updatedAt: '2026-08-25T10:35:00.000Z' })],
  });
  assert.equal(approved.fieldApprovals[0].status, 'approved');
  assert.equal(approved.canRecordAdditionalApproval, false);

  await assert.rejects(
    () => attachFieldApprovalsToJob(approvedStore.db, pendingJob),
    (error) => error?.code === 'field_approval_identity_conflict' && error?.status === 409,
  );
});
