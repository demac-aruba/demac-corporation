const assert = require('node:assert/strict');
const test = require('node:test');
const { FIELD_ACTIONS, createFieldOperationsApi, publicJobProjection } = require('./fieldOperationsAuthority');
const { normalizeFieldIdentity } = require('./fieldOperationsAuthorityCore');

function authDb(profile) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return {
            async get() {
              return {
                id: uid,
                exists: profile !== undefined,
                data: () => profile,
              };
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
    'attach_visit_asset',
    'create_additional_intervention',
    'create_planned_intervention',
    'get_job',
    'get_schedule',
    'prepare_visit',
    'record_additional_intervention_decision',
    'register_visit_asset',
    'transition_visit',
  ]);

  const api = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
  });

  await assert.rejects(
    () => api.execute({ action: 'prepare_visit', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'transition_visit', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'attach_visit_asset', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'register_visit_asset', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'create_planned_intervention', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'create_additional_intervention', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'record_additional_intervention_decision', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'start_visit', data: {}, identity: { operations: false } }),
    /Unsupported Field Operations action/,
  );
});

test('public Field DTO does not expose Legacy mixed-namespace technicianIds', () => {
  const projected = publicJobProjection({
    workOrderId: 'WO-1',
    technicianIds: ['uid-legacy', 'staff-1'],
    responsibility: 'technician',
    allowedActions: ['read'],
  });
  assert.equal('technicianIds' in projected, false);
  assert.equal(projected.workOrderId, 'WO-1');
  assert.equal(projected.responsibility, 'technician');
  assert.deepEqual(projected.allowedActions, ['read']);
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
    verifyIdToken: async (token) => {
      assert.equal(token, 'valid-token');
      return { uid: 'uid-1', role: 'super_admin', email: 'token@example.invalid' };
    },
    prepareWorkVisit: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        visit: { id: 'visit-WO-1', status: 'scheduled' },
        allowedActions: ['execute'],
      };
    },
  });

  const result = await api.handle(request({
    token: 'valid-token',
    action: 'prepare_visit',
    data: { workOrderId: ' WO-1 ', requestId: ' prepare-WO-1-001 ' },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.version, 1);
  assert.deepEqual(result.body.visit.availableTransitions, ['en_route']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workOrderId, 'WO-1');
  assert.equal(calls[0].requestId, 'prepare-WO-1-001');
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician', 'token role must not override governed profile role');
});

test('transition_visit authenticates and forwards optimistic concurrency inputs without trusting client authority', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    transitionWorkVisit: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        visit: { id: 'visit-WO-1', status: 'en_route', version: 2, availableTransitions: ['on_site'] },
        allowedActions: ['read', 'execute'],
      };
    },
  });

  const result = await api.handle(request({
    token: 'valid-token',
    action: 'transition_visit',
    data: {
      visitId: ' visit-WO-1 ',
      to: ' en_route ',
      expectedVersion: 1,
      requestId: ' transition-route-001 ',
      allowedActions: ['execute', 'price.override'],
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].to, 'en_route');
  assert.equal(calls[0].expectedVersion, 1);
  assert.equal(calls[0].requestId, 'transition-route-001');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal('allowedActions' in calls[0], false, 'client action projection must not be forwarded as authority');
});

test('attach_visit_asset authenticates and forwards only canonical visit/asset identity plus request id', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    attachExistingVisitAsset: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        visitAsset: {
          id: 'VA-1',
          visitId: 'visit-WO-1',
          assetId: 'AC-1',
          sequence: 1,
          locationLabel: 'Sala',
          source: 'existing_asset',
          status: 'identified',
          addedOnSite: true,
          createdAt: '2026-08-25T10:00:00.000Z',
          createdBy: 'uid-1',
          updatedAt: '2026-08-25T10:00:00.000Z',
          updatedBy: 'uid-1',
          version: 1,
        },
        allowedActions: ['read', 'execute', 'asset.add'],
      };
    },
  });

  const result = await api.handle(request({
    token: 'valid-token',
    action: 'attach_visit_asset',
    data: {
      visitId: ' visit-WO-1 ',
      assetId: ' AC-1 ',
      requestId: ' attach-asset-001 ',
      source: 'registered_on_site',
      allowedActions: ['price.override'],
      customerId: 'CLIENT-OTHER',
    },
  }));

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

test('create_planned_intervention authenticates and forwards only canonical intervention inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    createPlannedWorkIntervention: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        workIntervention: {
          id: 'WI-1',
          visitId: 'visit-WO-1',
          visitAssetId: 'VA-1',
          assetId: 'AC-1',
          plannedWorkLineId: 'line-standard',
          serviceCatalogItemId: 'service-standard',
          interventionType: '12K Standard Service',
          origin: 'planned',
          requestedBy: 'office',
          status: 'confirmed',
          performedByStaffIds: ['staff-1'],
          createdAt: '2026-08-25T10:30:00.000Z',
          createdBy: 'uid-1',
          updatedAt: '2026-08-25T10:30:00.000Z',
          updatedBy: 'uid-1',
          version: 1,
        },
        allowedActions: ['read', 'execute', 'intervention.add'],
      };
    },
  });

  const result = await api.handle(request({
    token: 'valid-token',
    action: 'create_planned_intervention',
    data: {
      visitId: ' visit-WO-1 ',
      visitAssetId: ' VA-1 ',
      plannedWorkLineId: ' line-standard ',
      serviceCatalogItemId: ' service-standard ',
      requestId: ' planned-intervention-001 ',
      origin: 'office_added',
      status: 'completed',
      assetId: 'AC-OTHER',
      allowedActions: ['price.override'],
    },
  }));

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

test('Field mutation actions cannot execute without authentication', async () => {
  let prepareCalled = false;
  let transitionCalled = false;
  let attachCalled = false;
  let registerCalled = false;
  let interventionCalled = false;
  let additionalInterventionCalled = false;
  let decisionCalled = false;
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    prepareWorkVisit: async () => { prepareCalled = true; return { success: true }; },
    transitionWorkVisit: async () => { transitionCalled = true; return { success: true }; },
    attachExistingVisitAsset: async () => { attachCalled = true; return { success: true }; },
    registerEquipmentSystem: async () => { registerCalled = true; return { success: true }; },
    createPlannedWorkIntervention: async () => { interventionCalled = true; return { success: true }; },
    createAdditionalWorkIntervention: async () => { additionalInterventionCalled = true; return { success: true }; },
    recordAdditionalWorkDecision: async () => { decisionCalled = true; return { success: true }; },
  });

  const prepare = await api.handle(request({ action: 'prepare_visit', data: { workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' } }));
  assert.equal(prepare.status, 401);
  assert.equal(prepare.body.error.code, 'unauthenticated');

  const transition = await api.handle(request({ action: 'transition_visit', data: { visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-route-001' } }));
  assert.equal(transition.status, 401);
  assert.equal(transition.body.error.code, 'unauthenticated');

  const attach = await api.handle(request({ action: 'attach_visit_asset', data: { visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-asset-001' } }));
  assert.equal(attach.status, 401);
  assert.equal(attach.body.error.code, 'unauthenticated');

  const registration = await api.handle(request({ action: 'register_visit_asset', data: { visitId: 'visit-WO-1', requestId: 'register-asset-001' } }));
  assert.equal(registration.status, 401);
  assert.equal(registration.body.error.code, 'unauthenticated');

  const intervention = await api.handle(request({ action: 'create_planned_intervention', data: { visitId: 'visit-WO-1', visitAssetId: 'VA-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', requestId: 'planned-intervention-001' } }));
  assert.equal(intervention.status, 401);
  assert.equal(intervention.body.error.code, 'unauthenticated');

  const additional = await api.handle(request({ action: 'create_additional_intervention', data: { visitId: 'visit-WO-1', visitAssetId: 'VA-1', serviceCatalogItemId: 'service-standard', origin: 'client_requested_additional_work', reason: 'Second A/C', requestId: 'additional-intervention-001' } }));
  assert.equal(additional.status, 401);
  assert.equal(additional.body.error.code, 'unauthenticated');

  const decision = await api.handle(request({ action: 'record_additional_intervention_decision', data: { visitId: 'visit-WO-1', interventionId: 'WI-1', decision: 'approved', receiverName: 'Maria', requestId: 'decision-001' } }));
  assert.equal(decision.status, 401);
  assert.equal(decision.body.error.code, 'unauthenticated');

  assert.equal(prepareCalled, false);
  assert.equal(transitionCalled, false);
  assert.equal(attachCalled, false);
  assert.equal(registerCalled, false);
  assert.equal(interventionCalled, false);
  assert.equal(additionalInterventionCalled, false);
  assert.equal(decisionCalled, false);
});

test('missing and expired Firebase sessions return controlled unauthenticated errors', async () => {
  const missingTokenApi = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
  });
  const missing = await missingTokenApi.handle(request());
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'unauthenticated');

  const expiredApi = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => { throw new Error('expired'); },
  });
  const expired = await expiredApi.handle(request({ token: 'expired-token' }));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'unauthenticated');
});

test('missing or incompletely governed user profile cannot inherit token role authority', async () => {
  const missingProfileApi = createFieldOperationsApi({
    db: authDb(undefined),
    verifyIdToken: async () => ({ uid: 'uid-missing', role: 'technician' }),
  });
  const missingProfile = await missingProfileApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingProfile.status, 403);
  assert.equal(missingProfile.body.error.code, 'permission_denied');

  const missingRoleApi = createFieldOperationsApi({
    db: authDb({ active: true, staffId: 'staff-token-only' }),
    verifyIdToken: async () => ({ uid: 'uid-token-only', role: 'technician' }),
  });
  const missingRole = await missingRoleApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingRole.status, 403);
  assert.equal(missingRole.body.error.code, 'permission_denied');
});

test('unexpected internal failures are logged internally and sanitized from the public response', async () => {
  const reports = [];
  const api = createFieldOperationsApi({
    db: {
      collection(name) {
        assert.equal(name, 'users');
        return {
          doc() {
            return {
              async get() {
                throw new Error('sensitive Firestore/runtime diagnostic');
              },
            };
          },
        };
      },
    },
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    reportError: (report) => reports.push(report),
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
