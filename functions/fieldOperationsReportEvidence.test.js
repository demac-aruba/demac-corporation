const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAddReportPhotoEvidenceCommand,
  projectReportPhotoEvidence,
  reportPhotoEvidenceId,
  reportSection,
  validateReportPhotoStoragePath,
} = require('./fieldOperationsReportEvidence');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  const commits = [];
  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  function documentRef(name, id) { return { kind: 'document', collectionName: name, id }; }
  function queryRef(name, filters = []) {
    return {
      kind: 'query', collectionName: name, filters,
      where(field, op, expected) { return queryRef(name, [...filters, { field, op, expected }]); },
    };
  }
  function matches(value, filter) {
    if (filter.op === '==') return value?.[filter.field] === filter.expected;
    throw new Error(`Unsupported fake query operator ${filter.op}`);
  }
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
          const values = ensure(target.collectionName);
          if (target.kind === 'query') {
            return {
              docs: [...values.entries()]
                .filter(([, value]) => target.filters.every((filter) => matches(value, filter)))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, values.get(target.id));
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: { ...patch } });
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'create', ref, value: { ...value } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'update') {
          const current = ensure(write.ref.collectionName).get(write.ref.id);
          ensure(write.ref.collectionName).set(write.ref.id, { ...current, ...write.patch });
        } else {
          ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
        }
      }
      commits.push(writes);
      return result;
    },
  };
  return {
    db,
    commits,
    get(name, id) { return ensure(name).get(id); },
    values(name) { return [...ensure(name).values()]; },
  };
}

function reportTemplate() {
  return {
    id: 'standard-service-report',
    name: 'Standard Service Report',
    serviceId: 'service-standard',
    version: 3,
    sections: [
      { id: 'condition', title: 'Condition', type: 'checklist', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
      { id: 'notes', title: 'Notes', type: 'free_text', required: false },
    ],
  };
}

function baseVisit(overrides = {}) {
  return {
    id: 'visit-WO-1',
    fieldAuthorityVersion: 1,
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-25T10:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
    },
    status: 'in_progress',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: false,
    departedAt: '2026-08-25T10:00:00.000Z',
    arrivedAt: '2026-08-25T10:15:00.000Z',
    startedAt: '2026-08-25T10:20:00.000Z',
    createdAt: '2026-08-25T09:55:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z',
    updatedByUserId: 'uid-1',
    version: 4,
    ...overrides,
  };
}

function baseOrder(overrides = {}) {
  return {
    id: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'En proceso',
    date: '2026-08-25',
    technicianIds: ['staff-1'],
    ...overrides,
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1',
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard',
    interventionType: '12K Standard Service',
    origin: 'planned',
    requestedBy: 'office',
    status: 'in_progress',
    templateId: 'standard-service-report',
    templateVersion: 3,
    reportTemplateSnapshot: reportTemplate(),
    reportSectionStatus: { condition: 'not_started', photos: 'not_started', notes: 'not_started' },
    startedAt: '2026-08-25T10:25:00.000Z',
    performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-25T10:22:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:25:00.000Z',
    updatedByUserId: 'uid-1',
    version: 2,
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', email: 'tech@example.invalid',
    role: 'technician', operations: false, ...overrides,
  };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || baseVisit()],
    workOrders: [options.order || baseOrder()],
    workInterventions: [options.intervention || intervention()],
    fieldEvidence: options.evidence || [],
  });
  const auditEvents = [];
  let verifyCalls = 0;
  const command = createAddReportPhotoEvidenceCommand({
    db: store.db,
    now: () => options.now || '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    verifyStoredImage: options.verifyStoredImage || (async () => {
      verifyCalls += 1;
      return { contentType: 'image/jpeg', sizeBytes: 2048 };
    }),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { auditEvents.push(event); }),
  });
  return { store, auditEvents, command, verifyCalls: () => verifyCalls };
}

function input(overrides = {}) {
  return {
    identity: identity(),
    visitId: 'visit-WO-1',
    interventionId: 'WI-1',
    sectionId: 'photos',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo-001.jpg',
    caption: 'Before service',
    requestId: 'report-photo-001',
    ...overrides,
  };
}

test('report photo evidence is atomically bound to WorkVisit, VisitAsset, WorkIntervention and frozen report section', async () => {
  const { store, auditEvents, command } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const result = await command(input());

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.evidence.visitId, 'visit-WO-1');
  assert.equal(result.evidence.visitAssetId, 'VA-1');
  assert.equal(result.evidence.assetId, 'AC-1');
  assert.equal(result.evidence.interventionId, 'WI-1');
  assert.equal(result.evidence.sectionId, 'photos');
  assert.equal(result.evidence.kind, 'photo');
  assert.equal(result.workInterventionVersion, 3);
  assert.equal(store.values('fieldEvidence').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.photos, 'in_progress');
  assert.equal(store.get('workInterventions', 'WI-1').version, 3);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, 'report_photo_evidence_recorded');
  assert.equal(auditEvents[0].interventionId, 'WI-1');
  assert.equal(auditEvents[0].sectionId, 'photos');
});

test('helper may contribute governed report evidence while read-only and unassigned principals are denied before Storage verification', async () => {
  const helper = fixture({ resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'dated_crew' }) });
  assert.equal((await helper.command(input({ requestId: 'helper-photo' }))).success, true);

  for (const denied of [
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const current = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => current.command(input({ requestId: `denied-${denied.source}` })),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(current.verifyCalls(), 0);
    assert.equal(current.store.values('fieldEvidence').length, 0);
  }
});

test('report photo requires an in-progress visit, in-progress intervention and a frozen photos section', async () => {
  const wrongVisit = fixture({
    visit: baseVisit({ status: 'on_site', startedAt: undefined, version: 3 }),
    order: baseOrder({ status: 'En el sitio' }),
  });
  await assert.rejects(
    () => wrongVisit.command(input({ requestId: 'wrong-visit-state' })),
    (error) => error?.code === 'report_evidence_not_allowed' && error?.details?.visitStatus === 'on_site',
  );

  const wrongIntervention = fixture({ intervention: intervention({ status: 'confirmed', startedAt: undefined, performedByStaffIds: [], version: 1 }) });
  await assert.rejects(
    () => wrongIntervention.command(input({ requestId: 'wrong-intervention-state' })),
    (error) => error?.code === 'report_evidence_not_allowed' && error?.details?.interventionStatus === 'confirmed',
  );

  const noTemplate = fixture({ intervention: intervention({ templateId: undefined, templateVersion: undefined, reportTemplateSnapshot: undefined, reportSectionStatus: undefined }) });
  await assert.rejects(
    () => noTemplate.command(input({ requestId: 'missing-template' })),
    (error) => error?.code === 'report_template_not_available' && error?.status === 409,
  );

  const wrongSection = fixture();
  await assert.rejects(
    () => wrongSection.command(input({ sectionId: 'notes', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/notes/photo.jpg', requestId: 'wrong-section-type' })),
    (error) => error?.code === 'report_section_evidence_type_mismatch' && error?.status === 409,
  );
});

test('report photo path and verified Storage metadata fail closed before persistence', async () => {
  assert.throws(
    () => validateReportPhotoStoragePath('field-evidence/visit-OTHER/interventions/WI-1/photos/photo.jpg', 'visit-WO-1', 'WI-1', 'photos'),
    (error) => error?.code === 'invalid_report_evidence_path' && error?.status === 409,
  );

  const invalidImage = fixture({
    verifyStoredImage: async () => ({ contentType: 'application/pdf', sizeBytes: 1000 }),
  });
  await assert.rejects(() => invalidImage.command(input({ requestId: 'invalid-image' })));
  assert.equal(invalidImage.store.values('fieldEvidence').length, 0);
  assert.equal(invalidImage.store.get('workInterventions', 'WI-1').version, 2);
});

test('same report photo request is idempotent only for exact storage path and caption', async () => {
  const { store, auditEvents, command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(store.values('fieldEvidence').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').version, 3);
  assert.equal(auditEvents.length, 1);

  await assert.rejects(
    () => command(input({ caption: 'Different caption' })),
    (error) => error?.code === 'report_evidence_request_conflict' && error?.status === 409,
  );
});

test('audit failure rolls back both report evidence and WorkIntervention report-section progress', async () => {
  const { store, command } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(() => command(input()), /audit unavailable/);
  assert.equal(store.values('fieldEvidence').length, 0);
  assert.equal(store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.photos, 'not_started');
});

test('report photo projection and report section lookup fail closed on identity/schema/type drift', () => {
  const template = reportTemplate();
  assert.equal(reportSection(template, 'photos').type, 'photos');
  assert.throws(() => reportSection(template, 'condition'), (error) => error?.code === 'report_section_evidence_type_mismatch');

  const record = {
    id: reportPhotoEvidenceId('WI-1', 'photos', 'request-1'),
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    interventionId: 'WI-1',
    sectionId: 'photos',
    evidenceKind: 'photo',
    targetType: 'work_intervention_report',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1000,
    capturedAt: '2026-08-25T10:30:00.000Z',
    createdAt: '2026-08-25T10:30:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
  };
  const expected = {
    visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'photos',
  };
  assert.equal(projectReportPhotoEvidence(record, expected).id, record.id);
  for (const patch of [
    { fieldAuthorityVersion: 99 },
    { clientId: 'CLIENT-OTHER' },
    { targetType: 'equipment_registration' },
    { evidenceKind: 'video' },
    { sectionId: 'condition' },
    { sizeBytes: 0 },
    { version: 0 },
  ]) {
    assert.throws(() => projectReportPhotoEvidence({ ...record, ...patch }, expected));
  }
});