const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FIELD_ACTIONS,
  createFieldOperationsApi,
  fieldJobAvailableForCurrentDay,
  publicJobProjection,
  resolveFieldScheduleDateRange,
} = require('./fieldOperationsAuthority');
const { normalizeFieldIdentity } = require('./fieldOperationsAuthorityCore');

function authDb(profile) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return {
            async get() {
              return { id: uid, exists: profile !== undefined, data: () => profile };
            },
          };
        },
      };
    },
  };
}

function request({ method = 'POST', token = '', action = 'get_schedule', data = {} } = {}) {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method,
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action, data },
  };
}

test('inactive Field principals fail closed before assignment resolution', () => {
  assert.throws(() => normalizeFieldIdentity({
    uid: 'uid-inactive',
    profile: { active: false, role: 'technician', staffId: 'staff-inactive' },
    decoded: {},
  }), /inactive or not provisioned/);
});

test('Field HTTP authority exposes only governed reads and activated audited mutations', async () => {
  assert.deepEqual([...FIELD_ACTIONS].sort(), [
    'add_report_finding',
    'add_report_measurement',
    'add_report_photo_evidence',
    'add_report_voice_evidence',
    'attach_visit_asset',
    'attach_visit_asset_by_qr',
    'create_additional_intervention',
    'create_field_sale_line',
    'create_planned_intervention',
    'create_return_visit',
    'decide_field_sale_line',
    'decide_office_review',
    'get_job',
    'get_office_review_queue',
    'get_schedule',
    'prepare_visit',
    'record_additional_intervention_decision',
    'record_customer_report_acknowledgement',
    'record_planned_work_disposition',
    'register_visit_asset',
    'set_report_checklist_item',
    'set_report_free_text',
    'submit_visit_for_office_review',
    'transition_field_sale_line',
    'transition_intervention',
    'transition_visit',
  ]);

  const api = createFieldOperationsApi({ db: { collection() { return {}; } }, verifyIdToken: async () => ({ uid: 'unused' }) });
  for (const action of [
    'prepare_visit', 'create_return_visit', 'transition_visit', 'attach_visit_asset', 'attach_visit_asset_by_qr', 'register_visit_asset',
    'create_planned_intervention', 'record_planned_work_disposition', 'create_additional_intervention', 'record_additional_intervention_decision',
    'create_field_sale_line', 'decide_field_sale_line', 'transition_field_sale_line',
    'transition_intervention', 'add_report_photo_evidence', 'add_report_voice_evidence', 'add_report_measurement', 'add_report_finding',
    'set_report_checklist_item', 'set_report_free_text', 'record_customer_report_acknowledgement',
    'submit_visit_for_office_review', 'decide_office_review',
  ]) {
    await assert.rejects(
      () => api.execute({ action, data: {}, identity: { operations: false } }),
      (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
    );
  }
  await assert.rejects(() => api.execute({ action: 'start_visit', data: {}, identity: { operations: false } }), /Unsupported Field Operations action/);
});

test('public Field DTO does not expose Legacy mixed-namespace technicianIds', () => {
  const projected = publicJobProjection({
    workOrderId: 'WO-1',
    technicianIds: ['uid-legacy', 'staff-1'],
    _fieldVisitChainIds: ['visit-initial', 'visit-return'],
    responsibility: 'technician',
    allowedActions: ['read'],
  });
  assert.equal('technicianIds' in projected, false);
  assert.equal('_fieldVisitChainIds' in projected, false, 'server composition metadata must not leak into the public Field contract');
  assert.equal(projected.workOrderId, 'WO-1');
  assert.equal(projected.responsibility, 'technician');
  assert.deepEqual(projected.allowedActions, ['read']);
});

test('technician Field reads are server-owned and limited to the current Aruba workday', () => {
  const clock = new Date('2026-09-03T02:00:00.000Z');
  assert.deepEqual(
    resolveFieldScheduleDateRange({ role: 'technician', operations: false }, { startDate: '2026-09-03', endDate: '2026-09-09' }, clock),
    { startDate: '2026-09-02', endDate: '2026-09-02' },
  );
  assert.equal(fieldJobAvailableForCurrentDay({ operations: false }, { date: '2026-09-02' }, clock), true);
  assert.equal(fieldJobAvailableForCurrentDay({ operations: false }, { date: '2026-09-03' }, clock), false);
  assert.deepEqual(
    resolveFieldScheduleDateRange({ role: 'super_admin', operations: true }, { startDate: '2026-09-01', endDate: '2026-09-07' }, clock),
    { startDate: '2026-09-01', endDate: '2026-09-07' },
    'office authorities retain their governed read range outside the technician portal',
  );
  assert.equal(fieldJobAvailableForCurrentDay({ operations: true }, { date: '2026-09-03' }, clock), true);
});

test('Field executor forwards only Aruba today to technician schedule reads and rejects a future job before composition', async () => {
  const scheduleCalls = [];
  const api = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
    now: () => new Date('2026-09-03T02:00:00.000Z'),
    loadSchedule: async (_db, _identity, startDate, endDate) => {
      scheduleCalls.push({ startDate, endDate });
      return [];
    },
    loadJob: async () => ({ workOrderId: 'WO-FUTURE', date: '2026-09-03' }),
  });
  const schedule = await api.execute({
    action: 'get_schedule',
    data: { startDate: '2026-09-03', endDate: '2026-09-09' },
    identity: { role: 'technician', operations: false },
  });
  assert.equal(schedule.success, true);
  assert.deepEqual(scheduleCalls, [{ startDate: '2026-09-02', endDate: '2026-09-02' }]);
  await assert.rejects(
    () => api.execute({ action: 'get_job', data: { workOrderId: 'WO-FUTURE' }, identity: { role: 'technician', operations: false } }),
    (error) => error?.code === 'work_order_not_available_today' && error?.status === 404,
  );
});

test('HTTP method and truly unsupported action fail before protected business execution', async () => {
  let verified = false;
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => { verified = true; return { uid: 'uid-1' }; },
  });
  const wrongMethod = await api.handle(request({ method: 'GET', token: 'token' }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  const unsupported = await api.handle(request({ token: 'token', action: 'start_visit' }));
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, 'unsupported_action');
  assert.equal(verified, false);
});

test('prepare_visit authenticates first and returns the same versioned contract as Field reads', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async (token) => { assert.equal(token, 'valid-token'); return { uid: 'uid-1', role: 'super_admin', email: 'token@example.invalid' }; },
    prepareWorkVisit: async (input) => { calls.push(input); return { success: true, replayed: false, visit: { id: 'visit-WO-1', status: 'scheduled' }, allowedActions: ['execute'] }; },
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'prepare_visit', data: { workOrderId: ' WO-1 ', requestId: ' prepare-WO-1-001 ' } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.version, 1);
  assert.deepEqual(result.body.visit.availableTransitions, ['en_route', 'no_access', 'cancelled']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workOrderId, 'WO-1');
  assert.equal(calls[0].requestId, 'prepare-WO-1-001');
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
});

test('transition_visit authenticates and forwards optimistic concurrency inputs without trusting client authority', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    transitionWorkVisit: async (input) => { calls.push(input); return { success: true, replayed: false, visit: { id: 'visit-WO-1', status: 'en_route', version: 2, availableTransitions: ['on_site'] }, allowedActions: ['read', 'execute'] }; },
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'transition_visit', data: { visitId: ' visit-WO-1 ', to: ' pending ', expectedVersion: 1, pendingReason: ' Waiting for part ', pendingAction: ' Office orders it ', noAccessReason: ' Locked gate ', cancellationReason: ' Customer cancelled ', secondVisitReason: ' Return with part ', requestId: ' transition-route-001 ', allowedActions: ['execute', 'price.override'] } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].to, 'pending');
  assert.equal(calls[0].expectedVersion, 1);
  assert.equal(calls[0].pendingReason, 'Waiting for part');
  assert.equal(calls[0].pendingAction, 'Office orders it');
  assert.equal(calls[0].noAccessReason, 'Locked gate');
  assert.equal(calls[0].cancellationReason, 'Customer cancelled');
  assert.equal(calls[0].secondVisitReason, 'Return with part');
  assert.equal(calls[0].requestId, 'transition-route-001');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal('allowedActions' in calls[0], false);
});

test('create_return_visit authenticates and forwards only governed prior visit identity, version and request id', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    createReturnWorkVisit: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, visit: { id: 'visit-return-1', status: 'scheduled', version: 1 }, allowedActions: ['read', 'execute'] };
    },
  });
  const result = await api.handle(request({
    token: 'valid-token',
    action: 'create_return_visit',
    data: {
      previousVisitId: ' visit-WO-1 ', expectedVersion: 5, requestId: ' return-visit-001 ',
      workOrderId: 'WO-OTHER', status: 'completed', allowedActions: ['price.override'],
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].previousVisitId, 'visit-WO-1');
  assert.equal(calls[0].expectedVersion, 5);
  assert.equal(calls[0].requestId, 'return-visit-001');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['expectedVersion', 'identity', 'previousVisitId', 'requestId']);
});

test('attach_visit_asset authenticates and forwards only canonical visit/asset identity plus request id', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    attachExistingVisitAsset: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, visitAsset: { id: 'VA-1', visitId: 'visit-WO-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala', source: 'existing_asset', status: 'identified', addedOnSite: true, createdAt: '2026-08-25T10:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T10:00:00.000Z', updatedBy: 'uid-1', version: 1 }, allowedActions: ['read', 'execute', 'asset.add'] };
    },
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'attach_visit_asset', data: { visitId: ' visit-WO-1 ', assetId: ' AC-1 ', requestId: ' attach-asset-001 ', source: 'registered_on_site', allowedActions: ['price.override'], customerId: 'CLIENT-OTHER' } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].assetId, 'AC-1');
  assert.equal(calls[0].requestId, 'attach-asset-001');
  assert.equal(calls[0].source, 'existing_asset');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal('allowedActions' in calls[0], false);
  assert.equal('customerId' in calls[0], false);
});

test('attach_visit_asset_by_qr hardcodes QR provenance and forwards only the presented QR and canonical identities', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    attachExistingVisitAsset: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, visitAsset: { id: 'VA-QR', visitId: 'visit-WO-1', assetId: 'AC-QR', sequence: 1, locationLabel: 'Sala', source: 'qr_scan', status: 'identified', addedOnSite: true, createdAt: '2026-08-25T10:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T10:00:00.000Z', updatedBy: 'uid-1', version: 1 }, allowedActions: ['read', 'execute', 'asset.add'] };
    },
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'attach_visit_asset_by_qr', data: { visitId: ' visit-WO-1 ', assetId: ' AC-QR ', qrCode: ' DEMAC-QR-001 ', requestId: ' attach-qr-001 ', source: 'existing_asset', customerId: 'CLIENT-OTHER' } }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['assetId', 'identity', 'qrCode', 'requestId', 'source', 'visitId']);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].assetId, 'AC-QR');
  assert.equal(calls[0].qrCode, 'DEMAC-QR-001');
  assert.equal(calls[0].source, 'qr_scan');
});

test('create_planned_intervention authenticates and forwards only canonical intervention inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    createPlannedWorkIntervention: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, workIntervention: { id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: '12K Standard Service', origin: 'planned', requestedBy: 'office', status: 'confirmed', performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T10:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z', updatedBy: 'uid-1', version: 1 }, allowedActions: ['read', 'execute', 'intervention.add'] };
    },
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'create_planned_intervention', data: { visitId: ' visit-WO-1 ', visitAssetId: ' VA-1 ', plannedWorkLineId: ' line-standard ', serviceCatalogItemId: ' service-standard ', requestId: ' planned-intervention-001 ', origin: 'office_added', status: 'completed', assetId: 'AC-OTHER', allowedActions: ['price.override'] } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].visitAssetId, 'VA-1');
  assert.equal(calls[0].plannedWorkLineId, 'line-standard');
  assert.equal(calls[0].serviceCatalogItemId, 'service-standard');
  assert.equal(calls[0].requestId, 'planned-intervention-001');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal('origin' in calls[0], false);
  assert.equal('status' in calls[0], false);
  assert.equal('assetId' in calls[0], false);
  assert.equal('allowedActions' in calls[0], false);
});

test('record_planned_work_disposition forwards only governed reconciliation inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    recordPlannedWorkDisposition: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, disposition: { id: 'PWD-1' }, allowedActions: ['read', 'intervention.complete'] };
    },
  });
  const result = await api.handle(request({
    token: 'valid-token',
    action: 'record_planned_work_disposition',
    data: {
      visitId: ' visit-WO-1 ', plannedWorkLineId: ' line-standard ', quantity: 1,
      reasonCode: ' customer_cancelled ', note: ' Customer cancelled second unit. ', requestId: ' disposition-001 ',
      customerId: 'CLIENT-OTHER', propertyId: 'PROPERTY-OTHER', status: 'completed', disposedQuantity: 99, allowedActions: ['price.override'],
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].plannedWorkLineId, 'line-standard');
  assert.equal(calls[0].quantity, 1);
  assert.equal(calls[0].reasonCode, 'customer_cancelled');
  assert.equal(calls[0].note, 'Customer cancelled second unit.');
  assert.equal(calls[0].requestId, 'disposition-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['identity', 'note', 'plannedWorkLineId', 'quantity', 'reasonCode', 'requestId', 'visitId']);
});

test('add_report_voice_evidence forwards only governed voice inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    addReportVoiceEvidence: async (input) => { calls.push(input); return { success: true, replayed: false, evidence: { id: 'EVID-1' }, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'] }; },
  });
  const result = await api.handle(request({
    token: 'valid-token',
    action: 'add_report_voice_evidence',
    data: {
      visitId: ' visit-WO-1 ', interventionId: ' WI-1 ', sectionId: ' voice ',
      storagePath: ' field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm ',
      durationSeconds: 42.25, requestId: ' report-voice-001 ',
      contentType: 'audio/fake', sizeBytes: 1, status: 'completed', assetId: 'AC-X', allowedActions: ['price.override'],
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'voice');
  assert.equal(calls[0].storagePath, 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm');
  assert.equal(calls[0].durationSeconds, 42.25);
  assert.equal(calls[0].requestId, 'report-voice-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['durationSeconds', 'identity', 'interventionId', 'requestId', 'sectionId', 'storagePath', 'visitId']);
});

test('record_customer_report_acknowledgement forwards only governed acknowledgement inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    recordCustomerAcknowledgement: async (input) => { calls.push(input); return { success: true, replayed: false, acknowledgement: { id: 'CACK-1' }, workInterventionVersion: 3, allowedActions: ['read', 'execute'] }; },
  });
  const result = await api.handle(request({
    token: 'valid-token',
    action: 'record_customer_report_acknowledgement',
    data: {
      visitId: ' visit-WO-1 ', interventionId: ' WI-1 ', sectionId: ' ack ', receiverName: ' Maria Customer ', note: ' Reviewed on site ', requestId: ' customer-ack-001 ',
      method: 'signature', acknowledgedAt: '2000-01-01T00:00:00.000Z', recordedByStaffId: 'attacker', assetId: 'AC-X', allowedActions: ['price.override'],
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'ack');
  assert.equal(calls[0].receiverName, 'Maria Customer');
  assert.equal(calls[0].note, 'Reviewed on site');
  assert.equal(calls[0].requestId, 'customer-ack-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['identity', 'interventionId', 'note', 'receiverName', 'requestId', 'sectionId', 'visitId']);
});

test('Field Sale API forwards only governed draft, decision and transition inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    createFieldSaleLine: async (input) => { calls.push(['create', input]); return { success: true, replayed: false, fieldSaleLine: { id: 'FSL-1' } }; },
    decideFieldSaleLine: async (input) => { calls.push(['decide', input]); return { success: true, replayed: false, fieldSaleLine: { id: 'FSL-1' }, approval: { id: 'FA-1' } }; },
    transitionFieldSaleLine: async (input) => { calls.push(['transition', input]); return { success: true, replayed: false, fieldSaleLine: { id: 'FSL-1' } }; },
  });
  const created = await api.handle(request({ token: 'valid-token', action: 'create_field_sale_line', data: {
    visitId: ' visit-WO-1 ', catalogItemId: ' product-switch ', description: ' ignored ', quantity: 2,
    unit: ' ea ', interventionId: ' WI-1 ', assetId: ' AC-1 ', notes: ' requested ', requestId: ' field-sale-create-001 ', price: 1,
  } }));
  const decided = await api.handle(request({ token: 'valid-token', action: 'decide_field_sale_line', data: {
    visitId: ' visit-WO-1 ', saleLineId: ' FSL-1 ', decision: ' approved ', receiverName: ' Maria ', note: ' accepted ',
    expectedVersion: 1, requestId: ' field-sale-decision-001 ', customerApprovalId: 'attacker',
  } }));
  const transitioned = await api.handle(request({ token: 'valid-token', action: 'transition_field_sale_line', data: {
    visitId: ' visit-WO-1 ', saleLineId: ' FSL-1 ', to: ' installed ', note: ' done ', expectedVersion: 2,
    requestId: ' field-sale-transition-001 ', inventoryMovementId: 'attacker', invoiceLineId: 'attacker',
  } }));
  assert.equal(created.status, 200);
  assert.equal(decided.status, 200);
  assert.equal(transitioned.status, 200);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['assetId', 'catalogItemId', 'description', 'identity', 'interventionId', 'notes', 'quantity', 'requestId', 'unit', 'visitId']);
  assert.deepEqual(Object.keys(calls[1][1]).sort(), ['decision', 'expectedVersion', 'identity', 'note', 'receiverName', 'requestId', 'saleLineId', 'visitId']);
  assert.deepEqual(Object.keys(calls[2][1]).sort(), ['expectedVersion', 'identity', 'note', 'requestId', 'saleLineId', 'to', 'visitId']);
  assert.equal(calls[0][1].catalogItemId, 'product-switch');
  assert.equal(calls[1][1].receiverName, 'Maria');
  assert.equal(calls[2][1].to, 'installed');
});

test('Office Review API forwards only canonical submission, queue and decision inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'operations', staffId: 'office-1', name: 'Office One' }),
    verifyIdToken: async () => ({ uid: 'office-uid' }),
    submitOfficeReview: async (input) => { calls.push(['submit', input]); return { success: true, review: { id: 'FOR-1' } }; },
    decideOfficeReview: async (input) => { calls.push(['decide', input]); return { success: true, review: { id: 'FOR-1', status: 'approved' } }; },
    listOfficeReviews: async (db, identity) => { calls.push(['queue', { db, identity }]); return [{ id: 'FOR-1', status: 'pending' }]; },
  });
  const submitted = await api.handle(request({
    token: 'valid-token', action: 'submit_visit_for_office_review',
    data: { visitId: ' visit-WO-1 ', expectedVersion: 4, requestId: ' office-review-submit-001 ', correctionNote: ' Clarified service result. ', status: 'approved' },
  }));
  const queue = await api.handle(request({ token: 'valid-token', action: 'get_office_review_queue', data: { status: 'approved' } }));
  const decided = await api.handle(request({
    token: 'valid-token', action: 'decide_office_review',
    data: { reviewId: ' FOR-1 ', decision: ' return ', note: ' Correct summary. ', expectedVersion: 1, requestId: ' office-review-return-001 ', reviewerId: 'attacker' },
  }));

  assert.equal(submitted.status, 200);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.reviews[0].id, 'FOR-1');
  assert.equal(decided.status, 200);
  assert.equal(calls[0][0], 'submit');
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['correctionNote', 'expectedVersion', 'identity', 'requestId', 'visitId']);
  assert.equal(calls[0][1].visitId, 'visit-WO-1');
  assert.equal(calls[0][1].correctionNote, 'Clarified service result.');
  assert.equal(calls[1][0], 'queue');
  assert.equal(calls[1][1].identity.operations, true);
  assert.equal(calls[2][0], 'decide');
  assert.deepEqual(Object.keys(calls[2][1]).sort(), ['decision', 'expectedVersion', 'identity', 'note', 'requestId', 'reviewId']);
  assert.equal(calls[2][1].decision, 'return');
  assert.equal(calls[2][1].note, 'Correct summary.');
});

test('Field mutation actions cannot execute without authentication', async () => {
  const called = new Map();
  const mark = (name) => async () => { called.set(name, true); return { success: true }; };
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    prepareWorkVisit: mark('prepare'), createReturnWorkVisit: mark('return'), transitionWorkVisit: mark('transition'), attachExistingVisitAsset: mark('attach'), registerEquipmentSystem: mark('register'),
    createPlannedWorkIntervention: mark('intervention'), recordPlannedWorkDisposition: mark('disposition'), createAdditionalWorkIntervention: mark('additional'), recordAdditionalWorkDecision: mark('decision'),
    transitionWorkIntervention: mark('interventionTransition'), addReportPhotoEvidence: mark('reportPhoto'), addReportVoiceEvidence: mark('reportVoice'), addFieldMeasurement: mark('reportMeasurement'),
    addFieldFinding: mark('reportFinding'), setFieldChecklistItem: mark('reportChecklist'), setFieldFreeTextResponse: mark('reportFreeText'),
    recordCustomerAcknowledgement: mark('reportCustomerAcknowledgement'), submitOfficeReview: mark('officeReviewSubmit'),
    createFieldSaleLine: mark('fieldSaleCreate'), decideFieldSaleLine: mark('fieldSaleDecision'), transitionFieldSaleLine: mark('fieldSaleTransition'),
    decideOfficeReview: mark('officeReviewDecision'), listOfficeReviews: mark('officeReviewQueue'),
  });
  const cases = [
    ['prepare_visit', { workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' }],
    ['create_return_visit', { previousVisitId: 'visit-WO-1', expectedVersion: 5, requestId: 'return-visit-001' }],
    ['transition_visit', { visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-route-001' }],
    ['attach_visit_asset', { visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-asset-001' }],
    ['attach_visit_asset_by_qr', { visitId: 'visit-WO-1', assetId: 'AC-1', qrCode: 'DEMAC-QR-001', requestId: 'attach-qr-001' }],
    ['register_visit_asset', { visitId: 'visit-WO-1', requestId: 'register-asset-001' }],
    ['create_planned_intervention', { visitId: 'visit-WO-1', visitAssetId: 'VA-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', requestId: 'planned-intervention-001' }],
    ['record_planned_work_disposition', { visitId: 'visit-WO-1', plannedWorkLineId: 'line-standard', quantity: 1, reasonCode: 'customer_cancelled', requestId: 'disposition-001' }],
    ['create_additional_intervention', { visitId: 'visit-WO-1', visitAssetId: 'VA-1', serviceCatalogItemId: 'service-standard', origin: 'client_requested_additional_work', reason: 'Second A/C', requestId: 'additional-intervention-001' }],
    ['record_additional_intervention_decision', { visitId: 'visit-WO-1', interventionId: 'WI-1', decision: 'approved', receiverName: 'Maria', requestId: 'decision-001' }],
    ['transition_intervention', { visitId: 'visit-WO-1', interventionId: 'WI-1', to: 'in_progress', expectedVersion: 1, requestId: 'intervention-start-001' }],
    ['add_report_photo_evidence', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'photos', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg', requestId: 'report-photo-001' }],
    ['add_report_voice_evidence', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'voice', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm', durationSeconds: 42.25, requestId: 'report-voice-001' }],
    ['add_report_measurement', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'measurements', metric: 'Temperature', value: 18, unit: 'C', moment: 'after', requestId: 'report-measurement-001' }],
    ['add_report_finding', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'findings', summary: 'Drain issue', details: 'Standing water observed.', requestId: 'report-finding-001' }],
    ['set_report_checklist_item', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'condition', itemId: 'filter-clean', checked: true, expectedVersion: 0, requestId: 'report-checklist-001' }],
    ['set_report_free_text', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Technical note', expectedVersion: 0, requestId: 'report-free-text-001' }],
    ['record_customer_report_acknowledgement', { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'ack', receiverName: 'Maria', requestId: 'customer-ack-001' }],
    ['create_field_sale_line', { visitId: 'visit-WO-1', catalogItemId: 'product-switch', quantity: 1, requestId: 'field-sale-create-001' }],
    ['decide_field_sale_line', { visitId: 'visit-WO-1', saleLineId: 'FSL-1', decision: 'approved', receiverName: 'Maria', expectedVersion: 1, requestId: 'field-sale-decision-001' }],
    ['transition_field_sale_line', { visitId: 'visit-WO-1', saleLineId: 'FSL-1', to: 'installed', expectedVersion: 2, requestId: 'field-sale-transition-001' }],
    ['submit_visit_for_office_review', { visitId: 'visit-WO-1', expectedVersion: 4, requestId: 'office-review-submit-001' }],
    ['decide_office_review', { reviewId: 'FOR-1', decision: 'approve', expectedVersion: 1, requestId: 'office-review-approve-001' }],
    ['get_office_review_queue', {}],
  ];
  for (const [action, data] of cases) {
    const result = await api.handle(request({ action, data }));
    assert.equal(result.status, 401);
  }
  assert.equal(called.size, 0);
});

test('missing and expired Firebase sessions return controlled unauthenticated errors', async () => {
  const missingTokenApi = createFieldOperationsApi({ db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }), verifyIdToken: async () => ({ uid: 'uid-1' }) });
  const missing = await missingTokenApi.handle(request());
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'unauthenticated');
  const expiredApi = createFieldOperationsApi({ db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }), verifyIdToken: async () => { throw new Error('expired'); } });
  const expired = await expiredApi.handle(request({ token: 'expired-token' }));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'unauthenticated');
});

test('missing or incompletely governed user profile cannot inherit token role authority', async () => {
  const missingProfileApi = createFieldOperationsApi({ db: authDb(undefined), verifyIdToken: async () => ({ uid: 'uid-missing', role: 'technician' }) });
  const missingProfile = await missingProfileApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingProfile.status, 403);
  assert.equal(missingProfile.body.error.code, 'permission_denied');
  const missingRoleApi = createFieldOperationsApi({ db: authDb({ active: true, staffId: 'staff-token-only' }), verifyIdToken: async () => ({ uid: 'uid-token-only', role: 'technician' }) });
  const missingRole = await missingRoleApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingRole.status, 403);
  assert.equal(missingRole.body.error.code, 'permission_denied');
});

test('unexpected internal failures are logged internally and sanitized from the public response', async () => {
  const reports = [];
  const api = createFieldOperationsApi({
    db: { collection(name) { assert.equal(name, 'users'); return { doc() { return { async get() { throw new Error('sensitive Firestore/runtime diagnostic'); } }; } }; } },
    verifyIdToken: async () => ({ uid: 'uid-1' }), reportError: (report) => reports.push(report),
  });
  const result = await api.handle(request({ token: 'valid-token', action: 'get_schedule' }));
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'internal_error');
  assert.equal(result.body.error.message, 'Unexpected Field Operations error.');
  assert.deepEqual(result.body.error.details, {});
  assert.equal(JSON.stringify(result.body).includes('sensitive Firestore/runtime diagnostic'), false);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].action, 'get_schedule');
  assert.equal(reports[0].status, 500);
  assert.equal(reports[0].code, 'internal_error');
  assert.equal(reports[0].error.message, 'sensitive Firestore/runtime diagnostic');
});
