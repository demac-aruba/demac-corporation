const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildEquipmentRegistrationEvidence,
  canonicalImageMetadata,
  fieldEvidenceDocumentId,
  projectFieldEvidence,
} = require('./fieldOperationsEvidence');

function context() {
  return {
    canonicalVisit: { id: 'visit-WO-1' },
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
  };
}

function identity() {
  return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One' };
}

test('equipment registration evidence is bound to canonical visit/customer/property/asset identity', () => {
  const evidence = buildEquipmentRegistrationEvidence({
    assetId: 'AC-1',
    kind: 'equipment_reference',
    storagePath: 'field-evidence/visit-WO-1/register-001/equipment_reference.jpg',
    storageMetadata: { contentType: 'image/jpeg', sizeBytes: 123456 },
    context: context(),
    identity: identity(),
    occurredAt: '2026-08-25T19:15:00.000Z',
  });

  assert.equal(evidence.id, fieldEvidenceDocumentId('AC-1', 'equipment_reference'));
  assert.equal(evidence.visitId, 'visit-WO-1');
  assert.equal(evidence.workOrderId, 'WO-1');
  assert.equal(evidence.clientId, 'CLIENT-1');
  assert.equal(evidence.propertyId, 'PROPERTY-1');
  assert.equal(evidence.assetId, 'AC-1');
  assert.equal(evidence.evidenceKind, 'equipment_reference');
  assert.equal(evidence.contentType, 'image/jpeg');
  assert.equal(evidence.sizeBytes, 123456);
  assert.equal(projectFieldEvidence(evidence, {
    visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-1',
  }).id, evidence.id);
});

test('all three required equipment registration evidence kinds are accepted while unknown kinds fail closed', () => {
  for (const kind of ['equipment_reference', 'indoor_nameplate', 'outdoor_nameplate']) {
    assert.doesNotThrow(() => buildEquipmentRegistrationEvidence({
      assetId: 'AC-1',
      kind,
      storagePath: `field-evidence/visit-WO-1/register-001/${kind}.jpg`,
      storageMetadata: { contentType: 'image/jpeg', sizeBytes: 1000 },
      context: context(),
      identity: identity(),
      occurredAt: '2026-08-25T19:15:00.000Z',
    }));
  }

  assert.throws(() => buildEquipmentRegistrationEvidence({
    assetId: 'AC-1',
    kind: 'optional_photo',
    storagePath: 'field-evidence/visit-WO-1/register-001/optional.jpg',
    storageMetadata: { contentType: 'image/jpeg', sizeBytes: 1000 },
    context: context(),
    identity: identity(),
    occurredAt: '2026-08-25T19:15:00.000Z',
  }), (error) => error?.code === 'invalid_equipment_evidence_kind');
});

test('evidence must be an image within the governed size limit', () => {
  assert.deepEqual(canonicalImageMetadata({ contentType: 'image/webp', sizeBytes: 2048 }), {
    contentType: 'image/webp', sizeBytes: 2048,
  });
  for (const invalid of [
    { contentType: 'application/pdf', sizeBytes: 1000 },
    { contentType: 'image/jpeg', sizeBytes: 0 },
    { contentType: 'image/jpeg', sizeBytes: 13 * 1024 * 1024 },
    { contentType: 'image/jpeg', sizeBytes: 12.5 },
  ]) {
    assert.throws(() => canonicalImageMetadata(invalid));
  }
});

test('evidence path is scoped to the exact current Work Visit and cross-visit paths are rejected', () => {
  assert.throws(() => buildEquipmentRegistrationEvidence({
    assetId: 'AC-1',
    kind: 'indoor_nameplate',
    storagePath: 'field-evidence/visit-OTHER/register-001/indoor_nameplate.jpg',
    storageMetadata: { contentType: 'image/jpeg', sizeBytes: 1000 },
    context: context(),
    identity: identity(),
    occurredAt: '2026-08-25T19:15:00.000Z',
  }), (error) => error?.code === 'invalid_equipment_evidence_path' && error?.status === 409);
});

test('projection rejects corrupted schema, identity aliases, storage metadata and version', () => {
  const valid = buildEquipmentRegistrationEvidence({
    assetId: 'AC-1',
    kind: 'outdoor_nameplate',
    storagePath: 'field-evidence/visit-WO-1/register-001/outdoor_nameplate.jpg',
    storageMetadata: { contentType: 'image/jpeg', sizeBytes: 1000 },
    context: context(),
    identity: identity(),
    occurredAt: '2026-08-25T19:15:00.000Z',
  });
  const expected = { visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-1' };
  const corruptions = [
    { fieldAuthorityVersion: 999 },
    { customerId: 'CLIENT-OTHER' },
    { siteId: 'PROPERTY-OTHER' },
    { contentType: 'text/plain' },
    { sizeBytes: 0 },
    { version: 0 },
  ];
  for (const patch of corruptions) {
    assert.throws(() => projectFieldEvidence({ ...valid, ...patch }, expected));
  }
});
