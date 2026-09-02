'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');

const FIELD_EVIDENCE_STORAGE_VERSION = 1;
const FIELD_EVIDENCE_COLLECTION = 'fieldEvidence';
const MAX_FIELD_IMAGE_BYTES = 12 * 1024 * 1024;
const EQUIPMENT_REGISTRATION_EVIDENCE_KINDS = Object.freeze([
  'equipment_reference',
  'indoor_nameplate',
  'outdoor_nameplate',
]);
const EQUIPMENT_REGISTRATION_EVIDENCE_KIND_SET = new Set(EQUIPMENT_REGISTRATION_EVIDENCE_KINDS);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function requiredReference(record, names, label) {
  const values = names.map((name) => text(record?.[name], 180)).filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    throw fieldError('field_evidence_identity_conflict', `Persisted Field Evidence ${label} identity is missing or conflicting.`, 409);
  }
  return unique[0];
}

function assertExpectedReference(actual, expected, label) {
  const normalizedExpected = text(expected, 180);
  if (normalizedExpected && actual !== normalizedExpected) {
    throw fieldError('field_evidence_identity_conflict', `Persisted Field Evidence ${label} identity does not match its authorized context.`, 409);
  }
}

function canonicalImageMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError('equipment_evidence_unavailable', 'Required A/C registration photo is unavailable.', 409);
  }
  const contentType = text(value.contentType, 120).toLowerCase();
  const sizeBytes = Number(value.sizeBytes ?? value.size);
  if (!contentType.startsWith('image/')) {
    throw fieldError('invalid_equipment_evidence', 'A/C registration evidence must be an image.', 409);
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FIELD_IMAGE_BYTES) {
    throw fieldError('invalid_equipment_evidence', 'A/C registration image size is invalid.', 409);
  }
  return { contentType, sizeBytes };
}

function fieldEvidenceDocumentId(assetId, kind) {
  const normalizedAssetId = text(assetId, 180);
  const normalizedKind = text(kind, 80);
  if (!normalizedAssetId || !EQUIPMENT_REGISTRATION_EVIDENCE_KIND_SET.has(normalizedKind)) {
    throw new Error('A canonical Asset id and equipment-registration evidence kind are required.');
  }
  return deterministicId('EVID', `${normalizedAssetId}:${normalizedKind}`);
}

function buildEquipmentRegistrationEvidence({
  assetId,
  kind,
  storagePath,
  storageMetadata,
  context,
  identity,
  occurredAt,
} = {}) {
  const normalizedAssetId = text(assetId, 180);
  const normalizedKind = text(kind, 80);
  const normalizedStoragePath = text(storagePath, 1000);
  if (!normalizedAssetId) throw fieldError('asset_required', 'A canonical A/C Asset id is required.', 400);
  if (!EQUIPMENT_REGISTRATION_EVIDENCE_KIND_SET.has(normalizedKind)) {
    throw fieldError('invalid_equipment_evidence_kind', 'Unknown A/C registration evidence kind.', 400);
  }
  if (!normalizedStoragePath.startsWith(`field-evidence/${text(context?.canonicalVisit?.id, 180)}/`)) {
    throw fieldError('invalid_equipment_evidence_path', 'A/C registration photo does not belong to this Work Visit.', 409);
  }
  const image = canonicalImageMetadata(storageMetadata);
  const now = text(occurredAt, 80);
  if (!now || Number.isNaN(Date.parse(now))) throw new Error('Clock returned an invalid timestamp.');
  return fieldFirestoreData({
    id: fieldEvidenceDocumentId(normalizedAssetId, normalizedKind),
    fieldAuthorityVersion: FIELD_EVIDENCE_STORAGE_VERSION,
    visitId: text(context.canonicalVisit.id, 180),
    workOrderId: text(context.workOrderId, 180),
    clientId: text(context.customerId, 180),
    propertyId: text(context.propertyId, 180),
    assetId: normalizedAssetId,
    evidenceKind: normalizedKind,
    targetType: 'equipment_registration',
    storagePath: normalizedStoragePath,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
    capturedAt: now,
    createdAt: now,
    createdByUserId: text(identity?.uid, 180),
    createdByStaffId: text(identity?.staffId, 180) || undefined,
    createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    updatedAt: now,
    updatedByUserId: text(identity?.uid, 180),
    updatedByStaffId: text(identity?.staffId, 180) || undefined,
    updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    version: 1,
  }, 'fieldEvidence');
}

function projectFieldEvidence(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_EVIDENCE_STORAGE_VERSION) {
    throw fieldError('invalid_field_evidence_schema', `Unsupported Field Evidence storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`, 409);
  }
  const id = text(record?.id, 180);
  if (!id) throw fieldError('field_evidence_identity_conflict', 'Persisted Field Evidence record id is missing.', 409);
  const visitId = requiredReference(record, ['visitId'], 'Work Visit');
  const workOrderId = requiredReference(record, ['workOrderId'], 'Work Order');
  const customerId = requiredReference(record, ['clientId', 'customerId'], 'Customer');
  const propertyId = requiredReference(record, ['propertyId', 'siteId'], 'Property');
  const assetId = requiredReference(record, ['assetId'], 'Asset');
  const evidenceKind = text(record?.evidenceKind, 80);
  if (!EQUIPMENT_REGISTRATION_EVIDENCE_KIND_SET.has(evidenceKind)) {
    throw fieldError('invalid_field_evidence_kind', `Unknown persisted Field Evidence kind: ${evidenceKind || 'missing'}.`, 409);
  }
  if (text(record?.targetType, 80) !== 'equipment_registration') {
    throw fieldError('invalid_field_evidence_target', 'Persisted Field Evidence target is invalid.', 409);
  }
  const storagePath = text(record?.storagePath, 1000);
  if (!storagePath) throw fieldError('invalid_field_evidence_storage', 'Persisted Field Evidence storage path is missing.', 409);
  const image = canonicalImageMetadata({ contentType: record?.contentType, sizeBytes: record?.sizeBytes });
  const capturedAt = text(record?.capturedAt, 80);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    throw fieldError('invalid_field_evidence_timestamp', 'Persisted Field Evidence capturedAt is invalid.', 409);
  }
  assertExpectedReference(visitId, expectedContext.visitId, 'Work Visit');
  assertExpectedReference(workOrderId, expectedContext.workOrderId, 'Work Order');
  assertExpectedReference(customerId, expectedContext.customerId, 'Customer');
  assertExpectedReference(propertyId, expectedContext.propertyId, 'Property');
  assertExpectedReference(assetId, expectedContext.assetId, 'Asset');
  const version = Number(record?.version);
  if (!Number.isSafeInteger(version) || version < 1) throw fieldError('invalid_field_evidence_version', 'Persisted Field Evidence version is invalid.', 409);
  return {
    id,
    visitId,
    assetId,
    evidenceKind,
    storagePath,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
    capturedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function equipmentEvidenceAuditEvent({ requestId, evidence, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:equipment_registration_evidence:${evidence.id}`),
    type: 'equipment_registration_evidence_recorded',
    entityType: 'FieldEvidence',
    entityId: evidence.id,
    visitId: evidence.visitId,
    assetId: evidence.assetId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    after: {
      evidenceKind: evidence.evidenceKind,
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
    },
  };
}

function fieldEvidenceFromSnapshot(snapshot, expectedContext) {
  return projectFieldEvidence(fieldSnapshotRecord(snapshot), expectedContext);
}

module.exports.EQUIPMENT_REGISTRATION_EVIDENCE_KINDS = EQUIPMENT_REGISTRATION_EVIDENCE_KINDS;
module.exports.FIELD_EVIDENCE_COLLECTION = FIELD_EVIDENCE_COLLECTION;
module.exports.FIELD_EVIDENCE_STORAGE_VERSION = FIELD_EVIDENCE_STORAGE_VERSION;
module.exports.MAX_FIELD_IMAGE_BYTES = MAX_FIELD_IMAGE_BYTES;
module.exports.buildEquipmentRegistrationEvidence = buildEquipmentRegistrationEvidence;
module.exports.canonicalImageMetadata = canonicalImageMetadata;
module.exports.equipmentEvidenceAuditEvent = equipmentEvidenceAuditEvent;
module.exports.fieldEvidenceDocumentId = fieldEvidenceDocumentId;
module.exports.fieldEvidenceFromSnapshot = fieldEvidenceFromSnapshot;
module.exports.projectFieldEvidence = projectFieldEvidence;
