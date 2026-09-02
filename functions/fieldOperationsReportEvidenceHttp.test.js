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
    body: { action: 'add_report_photo_evidence', data },
  };
}

test('add_report_photo_evidence authenticates and forwards only governed report-photo inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    addReportPhotoEvidence: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        evidence: {
          id: 'EVID-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
          sectionId: 'photos', kind: 'photo', storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg',
          contentType: 'image/jpeg', sizeBytes: 1024, capturedAt: '2026-08-25T20:30:00.000Z',
          createdAt: '2026-08-25T20:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T20:30:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        workInterventionVersion: 3,
        allowedActions: ['read', 'evidence.add'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ',
    interventionId: ' WI-1 ',
    sectionId: ' photos ',
    storagePath: ' field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg ',
    caption: ' Before service ',
    requestId: ' report-photo-001 ',
    assetId: 'AC-ATTACKER',
    visitAssetId: 'VA-ATTACKER',
    contentType: 'application/pdf',
    sizeBytes: 1,
    templateId: 'fake-template',
    reportSectionStatus: { photos: 'completed' },
    staffId: 'staff-attacker',
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
  assert.equal(calls[0].sectionId, 'photos');
  assert.equal(calls[0].storagePath, 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg');
  assert.equal(calls[0].caption, 'Before service');
  assert.equal(calls[0].requestId, 'report-photo-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'caption', 'identity', 'interventionId', 'requestId', 'sectionId', 'storagePath', 'visitId',
  ]);
  for (const forbidden of ['assetId', 'visitAssetId', 'contentType', 'sizeBytes', 'templateId', 'reportSectionStatus', 'staffId', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('add_report_photo_evidence cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      addReportPhotoEvidence: {},
    }),
    /addReportPhotoEvidence must be a function/,
  );
});