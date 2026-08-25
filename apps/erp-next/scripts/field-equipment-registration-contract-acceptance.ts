import assert from 'node:assert/strict';
import { parseFieldRegisterVisitAssetResponse } from '../lib/field-equipment-registration-contract';

function validResponse() {
  const capturedAt = '2026-08-25T19:15:00.000Z';
  return {
    success: true,
    version: 1,
    replayed: false,
    registrationReplayed: false,
    attachReplayed: false,
    equipment: {
      id: 'AC-1',
      locationLabel: 'Cuarto principal',
      systemType: 'Split wall mounted',
      brand: 'Adina',
      btu: 12000,
      refrigerant: 'R32',
      voltage: '220V',
      active: true,
      evidenceIds: {
        equipment_reference: 'EVID-REF',
        indoor_nameplate: 'EVID-IN',
        outdoor_nameplate: 'EVID-OUT',
      },
      createdAt: capturedAt,
      createdBy: 'uid-1',
      updatedAt: capturedAt,
      updatedBy: 'uid-1',
      version: 1,
    },
    evidence: [
      ['EVID-REF', 'equipment_reference'],
      ['EVID-IN', 'indoor_nameplate'],
      ['EVID-OUT', 'outdoor_nameplate'],
    ].map(([id, evidenceKind]) => ({
      id,
      visitId: 'visit-WO-1',
      assetId: 'AC-1',
      evidenceKind,
      storagePath: `field-evidence/visit-WO-1/register-001/${evidenceKind}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 123456,
      capturedAt,
      createdAt: capturedAt,
      createdBy: 'uid-1',
      updatedAt: capturedAt,
      updatedBy: 'uid-1',
      version: 1,
    })),
    visitAsset: {
      id: 'VA-1',
      visitId: 'visit-WO-1',
      assetId: 'AC-1',
      sequence: 1,
      locationLabel: 'Cuarto principal',
      source: 'registered_on_site',
      status: 'identified',
      addedOnSite: true,
      addedReason: 'A/C registered during this Work Visit.',
      createdAt: capturedAt,
      createdBy: 'uid-1',
      updatedAt: capturedAt,
      updatedBy: 'uid-1',
      version: 1,
    },
    allowedActions: ['read', 'execute', 'asset.add'],
    auditEventIds: ['FE-1', 'FE-2', 'FE-3', 'FE-4', 'FE-5'],
  };
}

const withoutQr = parseFieldRegisterVisitAssetResponse(validResponse());
assert.equal(withoutQr.equipment.qrCode, undefined, 'QR must be optional in the canonical client contract');
assert.equal(withoutQr.equipment.locationLabel, 'Cuarto principal');
assert.equal(withoutQr.evidence.length, 3);
assert.equal(withoutQr.visitAsset.source, 'registered_on_site');

const withQr = validResponse();
withQr.equipment = { ...withQr.equipment, qrCode: 'DEMAC-QR-0001' };
assert.equal(parseFieldRegisterVisitAssetResponse(withQr).equipment.qrCode, 'DEMAC-QR-0001');

const corruptions: Array<(value: ReturnType<typeof validResponse>) => void> = [
  (value) => { value.equipment = { ...value.equipment, brand: '' }; },
  (value) => { value.equipment = { ...value.equipment, btu: 0 }; },
  (value) => { value.equipment = { ...value.equipment, refrigerant: '' }; },
  (value) => { value.equipment = { ...value.equipment, voltage: '' }; },
  (value) => { value.equipment = { ...value.equipment, evidenceIds: { ...value.equipment.evidenceIds, equipment_reference: '' } }; },
  (value) => { value.evidence = value.evidence.slice(0, 2); },
  (value) => { value.evidence[0] = { ...value.evidence[0], evidenceKind: 'optional_photo' }; },
  (value) => { value.evidence[0] = { ...value.evidence[0], assetId: 'AC-OTHER' }; },
  (value) => { value.evidence[0] = { ...value.evidence[0], visitId: 'visit-OTHER' }; },
  (value) => { value.evidence[0] = { ...value.evidence[0], contentType: 'application/pdf' }; },
  (value) => { value.visitAsset = { ...value.visitAsset, assetId: 'AC-OTHER' }; },
  (value) => { value.visitAsset = { ...value.visitAsset, source: 'existing_asset' }; },
  (value) => { value.allowedActions = ['client-invented-action']; },
];

for (const corrupt of corruptions) {
  const value = validResponse();
  corrupt(value);
  assert.throws(() => parseFieldRegisterVisitAssetResponse(value));
}

console.log('Field equipment registration contract acceptance passed.');
