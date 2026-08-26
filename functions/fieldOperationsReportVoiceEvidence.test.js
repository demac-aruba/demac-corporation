const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachReportVoiceEvidenceToJob,
  createAddReportVoiceEvidenceCommand,
  projectReportVoiceEvidence,
  reportVoiceEvidenceId,
  reportVoiceMetadata,
  validateReportVoiceStoragePath,
} = require('./fieldOperationsReportVoiceEvidence');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]));
  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  function queryRef(name, filters = []) {
    return {
      kind: 'query', collectionName: name, filters,
      where(field, op, expected) { return queryRef(name, [...filters, { field, op, expected }]); },
      async get() {
        return {
          docs: [...ensure(name).entries()]
            .filter(([, value]) => filters.every((filter) => filter.op === '==' && value?.[filter.field] === filter.expected))
            .map(([id, value]) => snapshot(id, value)),
        };
      },
    };
  }
  function documentRef(name, id) { return { kind: 'document', collectionName: name, id }; }
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
          writes.push({ type: 'create', ref, value: { ...value } });
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: { ...patch } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'create') ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
        else ensure(write.ref.collectionName).set(write.ref.id, { ...ensure(write.ref.collectionName).get(write.ref.id), ...write.patch });
      }
      return result;
    },
  };
  return { db, get: (name, id) => ensure(name).get(id), values: (name) => [...ensure(name).values()] };
}

function template() {
  return {
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [
      { id: 'voice', title: 'Voice note', type: 'voice_note', required: false },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 1 },
    ],
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-26T10:00:00.000Z', estimatedUnitCount: 1, workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }] },
    status: 'in_progress', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-26T10:10:00.000Z', startedAt: '2026-08-26T10:15:00.000Z', createdAt: '2026-08-26T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-26T10:15:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function order(overrides = {}) {
  return { id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'En proceso', date: '2026-08-26', technicianIds: ['staff-1'], ...overrides };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: template(),
    reportSectionStatus: { voice: 'pending', photos: 'pending' }, startedAt: '2026-08-26T10:20:00.000Z', performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-26T10:18:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-26T10:20:00.000Z', updatedByUserId: 'uid-1', version: 2,
    ...overrides,
  };
}

function identity(overrides = {}) { return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false, ...overrides }; }
function assignment(overrides = {}) { return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides }; }

function fixture(options = {}) {
  const store = createDb({
    workVisits: [options.visit || visit()],
    workOrders: [options.order || order()],
    workInterventions: [options.intervention || intervention()],
    fieldEvidence: options.evidence || [],
  });
  const events = [];
  let verifyCalls = 0;
  const command = createAddReportVoiceEvidenceCommand({
    db: store.db,
    now: () => '2026-08-26T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    verifyStoredAudio: options.verifyStoredAudio || (async () => {
      verifyCalls += 1;
      return { contentType: 'audio/webm', sizeBytes: 2048 };
    }),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
  });
  return { store, events, command, verifyCalls: () => verifyCalls };
}

function input(overrides = {}) {
  return {
    identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'voice',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm', durationSeconds: 42.25,
    requestId: 'report-voice-001', ...overrides,
  };
}

test('voice note is canonical immutable evidence and completes its frozen report section', async () => {
  const { store, events, command, verifyCalls } = fixture();
  const result = await command(input());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.evidence.kind, 'voice_note');
  assert.equal(result.evidence.durationSeconds, 42.25);
  assert.equal(result.workInterventionVersion, 3);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.voice, 'completed');
  assert.equal(store.values('fieldEvidence').length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'report_voice_note_recorded');
  assert.equal(verifyCalls(), 1);
});

test('exact retry is idempotent while a different recording cannot overwrite immutable voice evidence', async () => {
  const { store, events, command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(store.values('fieldEvidence').length, 1);
  assert.equal(events.length, 1);
  await assert.rejects(
    () => command(input({ requestId: 'report-voice-002', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-002.webm' })),
    (error) => error?.code === 'report_voice_already_recorded' && error?.status === 409,
  );
});

test('duration, media metadata, storage scope and section type fail closed', async () => {
  const base = fixture();
  await assert.rejects(() => base.command(input({ durationSeconds: 120.001 })), (error) => error?.code === 'invalid_report_voice_duration');
  await assert.rejects(() => base.command(input({ storagePath: 'field-evidence/other/interventions/WI-1/voice/voice/x.webm' })), (error) => error?.code === 'invalid_report_voice_path');
  await assert.rejects(() => base.command(input({ sectionId: 'photos', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/voice/x.webm' })), (error) => error?.code === 'report_section_type_mismatch');

  const invalidMime = fixture({ verifyStoredAudio: async () => ({ contentType: 'image/jpeg', sizeBytes: 2048 }) });
  await assert.rejects(() => invalidMime.command(input()), (error) => error?.code === 'invalid_report_voice');
  const oversize = fixture({ verifyStoredAudio: async () => ({ contentType: 'audio/webm', sizeBytes: 6 * 1024 * 1024 + 1 }) });
  await assert.rejects(() => oversize.command(input()), (error) => error?.code === 'invalid_report_voice');
});

test('helper may contribute voice evidence while read-only, unassigned and inactive execution remain denied', async () => {
  const helper = fixture({ resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'dated_crew' }) });
  const helperResult = await helper.command(input({ requestId: 'helper-voice-001' }));
  assert.equal(helperResult.success, true);
  assert.equal(helper.store.values('fieldEvidence').length, 1);

  for (const denied of [
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const current = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(() => current.command(input({ requestId: `denied-${denied.source}` })), (error) => error?.code === 'permission_denied');
    assert.equal(current.store.values('fieldEvidence').length, 0);
  }
  const inactive = fixture({ visit: visit({ status: 'on_site', startedAt: undefined }) });
  await assert.rejects(() => inactive.command(input()), (error) => error?.code === 'report_voice_not_allowed');
});

test('audit failure rolls back voice evidence and report completion atomically', async () => {
  const current = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => current.command(input()), /audit unavailable/);
  assert.equal(current.store.values('fieldEvidence').length, 0);
  assert.equal(current.store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(current.store.get('workInterventions', 'WI-1').reportSectionStatus.voice, 'pending');
});

test('voice read projection reconciles exact report identity and server-owned eligibility', async () => {
  const current = fixture();
  await current.command(input());
  const storedIntervention = current.store.get('workInterventions', 'WI-1');
  const job = {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
    allowedActions: ['read', 'execute', 'evidence.add'],
    workInterventions: [{ id: 'WI-1', status: 'in_progress' }],
    interventionReports: [{
      interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
      template: template(), sectionStatus: storedIntervention.reportSectionStatus, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [],
    }],
  };
  const projected = await attachReportVoiceEvidenceToJob(current.store.db, job);
  assert.equal(projected.interventionReports[0].voiceNotes.length, 1);
  assert.equal(projected.reportVoiceNoteOptions.length, 0);
  assert.equal(projected.canAddReportVoiceNote, false);

  const pendingStore = fixture();
  const pendingJob = { ...job, interventionReports: [{ ...job.interventionReports[0], sectionStatus: { voice: 'pending', photos: 'pending' } }] };
  const pending = await attachReportVoiceEvidenceToJob(pendingStore.store.db, pendingJob);
  assert.deepEqual(pending.reportVoiceNoteOptions, [{ interventionId: 'WI-1', sectionIds: ['voice'] }]);
  assert.equal(pending.canAddReportVoiceNote, true);
});

test('persisted voice projection rejects identity/schema/media/duration drift', () => {
  const record = {
    id: reportVoiceEvidenceId('WI-1', 'voice'), fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'voice',
    evidenceKind: 'voice_note', targetType: 'work_intervention_report_voice', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm',
    contentType: 'audio/webm', sizeBytes: 2048, durationSeconds: 42.25, requestId: 'report-voice-001', capturedAt: '2026-08-26T10:30:00.000Z', createdAt: '2026-08-26T10:30:00.000Z', createdByUserId: 'uid-1', version: 1,
  };
  assert.equal(projectReportVoiceEvidence(record, { visitId: 'visit-WO-1', interventionId: 'WI-1' }).durationSeconds, 42.25);
  assert.deepEqual(reportVoiceMetadata({ contentType: 'audio/mp4', sizeBytes: 1024 }), { contentType: 'audio/mp4', sizeBytes: 1024 });
  assert.equal(validateReportVoiceStoragePath(record.storagePath, 'visit-WO-1', 'WI-1', 'voice'), record.storagePath);
  for (const patch of [
    { targetType: 'work_intervention_report' }, { contentType: 'image/png' }, { durationSeconds: 0 }, { durationSeconds: 121 }, { version: 2 }, { assetId: '' },
  ]) assert.throws(() => projectReportVoiceEvidence({ ...record, ...patch }));
});
