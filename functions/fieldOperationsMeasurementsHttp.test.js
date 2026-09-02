const assert = require('node:assert/strict');
const test = require('node:test');
const { createFieldOperationsApi } = require('./fieldOperationsAuthority');

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

function request(data, token = 'valid-token') {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST',
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'add_report_measurement', data },
  };
}

test('add_report_measurement authenticates and forwards only governed measurement inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    addFieldMeasurement: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        measurement: {
          id: 'MEAS-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
          sectionId: 'measurements', metric: 'Supply temperature', value: 18.5, unit: '°C', moment: 'after',
          technicianStaffId: 'staff-1', measuredAt: '2026-08-25T20:30:00.000Z',
          createdAt: '2026-08-25T20:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T20:30:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        workInterventionVersion: 3,
        allowedActions: ['read', 'measurement.add'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ',
    interventionId: ' WI-1 ',
    sectionId: ' measurements ',
    metric: ' Supply temperature ',
    value: 18.5,
    unit: ' °C ',
    moment: ' after ',
    requestId: ' report-measurement-001 ',
    assetId: 'AC-ATTACKER',
    visitAssetId: 'VA-ATTACKER',
    technicianStaffId: 'staff-attacker',
    measuredAt: '2000-01-01T00:00:00.000Z',
    templateId: 'fake-template',
    reportSectionStatus: { measurements: 'completed' },
    allowedActions: ['price.override'],
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'measurements');
  assert.equal(calls[0].metric, 'Supply temperature');
  assert.equal(calls[0].value, 18.5);
  assert.equal(calls[0].unit, '°C');
  assert.equal(calls[0].moment, 'after');
  assert.equal(calls[0].requestId, 'report-measurement-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'identity', 'interventionId', 'metric', 'moment', 'requestId', 'sectionId', 'unit', 'value', 'visitId',
  ]);
  for (const forbidden of ['assetId', 'visitAssetId', 'technicianStaffId', 'measuredAt', 'templateId', 'reportSectionStatus', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('add_report_measurement preserves governed numeric zero and bounded text values', async () => {
  const values = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    addFieldMeasurement: async (input) => {
      values.push(input.value);
      return { success: true, replayed: false, measurement: {}, allowedActions: [] };
    },
  });
  assert.equal((await api.handle(request({ visitId: 'v', interventionId: 'i', sectionId: 's', metric: 'm', value: 0, unit: 'A', moment: 'general', requestId: 'zero' }))).status, 200);
  assert.equal((await api.handle(request({ visitId: 'v', interventionId: 'i', sectionId: 's', metric: 'm', value: 'OL', unit: 'ohm', moment: 'diagnostic', requestId: 'text' }))).status, 200);
  assert.deepEqual(values, [0, 'OL']);
});

test('add_report_measurement cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      addFieldMeasurement: {},
    }),
    /addFieldMeasurement must be a function/,
  );
});