'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  EQUIPMENT_REGISTRATION_EVIDENCE_KINDS,
  FIELD_EVIDENCE_COLLECTION,
  buildEquipmentRegistrationEvidence,
  equipmentEvidenceAuditEvent,
  fieldEvidenceFromSnapshot,
} = require('./fieldOperationsEvidence');

const FIELD_EQUIPMENT_REGISTRATION_VERSION = 1;
const EQUIPMENT_COLLECTION = 'equipmentSystems';
const EQUIPMENT_REGISTRATION_VISIT_STATUSES = new Set(['on_site', 'in_progress']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function positiveBtu(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1000 || number > 500000) {
    throw fieldError('equipment_btu_required', 'A valid A/C capacity in BTU is required before registering the equipment.', 400);
  }
  return number;
}

function requiredText(value, code, message, limit) {
  const normalized = text(value, limit);
  if (!normalized) throw fieldError(code, message, 400);
  return normalized;
}

function optionalQr(value) {
  const qrCode = text(value, 512);
  if (!qrCode) return '';
  if (qrCode.length < 3) throw fieldError('invalid_equipment_qr', 'QR code is invalid.', 400);
  return qrCode;
}

function normalizeEvidencePaths(value) {
  const evidence = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const paths = {
    equipment_reference: text(evidence.equipment_reference, 1000),
    indoor_nameplate: text(evidence.indoor_nameplate, 1000),
    outdoor_nameplate: text(evidence.outdoor_nameplate, 1000),
  };
  for (const kind of EQUIPMENT_REGISTRATION_EVIDENCE_KINDS) {
    if (!paths[kind]) {
      throw fieldError('equipment_evidence_required', 'Reference, indoor nameplate and outdoor nameplate photos are required before registering the A/C.', 400, { missingKind: kind });
    }
  }
  return paths;
}

function normalizeRegistrationInput(input = {}) {
  return {
    locationLabel: requiredText(input.locationLabel, 'equipment_location_required', 'A room/location title is required for the A/C.', 240),
    systemType: requiredText(input.systemType, 'equipment_type_required', 'A/C system type is required.', 120),
    brand: requiredText(input.brand, 'equipment_brand_required', 'A/C brand is required.', 120),
    btu: positiveBtu(input.btu),
    refrigerant: requiredText(input.refrigerant, 'equipment_refrigerant_required', 'A/C refrigerant is required.', 80),
    voltage: requiredText(input.voltage, 'equipment_voltage_required', 'A/C voltage is required.', 80),
    qrCode: optionalQr(input.qrCode),
    evidencePaths: normalizeEvidencePaths(input.evidencePaths),
  };
}

function registrationFingerprint(normalized) {
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function equipmentDocumentId(visitId, requestId) {
  return deterministicId('AC', `${text(visitId, 180)}:${text(requestId, 240)}`);
}

function canonicalRegistrationVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_equipment_registration_version', 'Persisted on-site A/C registration version is invalid.', 409);
  }
  return value;
}

function projectRegisteredEquipment(record, expectedContext = {}) {
  if (record?.fieldRegistrationVersion !== FIELD_EQUIPMENT_REGISTRATION_VERSION) {
    throw fieldError('invalid_equipment_registration_schema', 'Persisted on-site A/C registration schema is unsupported.', 409);
  }
  const id = text(record?.id, 180);
  const clientId = text(record?.clientId, 180);
  const propertyId = text(record?.propertyId, 180);
  const sourceVisitId = text(record?.sourceVisitId, 180);
  const sourceWorkOrderId = text(record?.sourceWorkOrderId, 180);
  if (!id || !clientId || !propertyId || !sourceVisitId || !sourceWorkOrderId) {
    throw fieldError('equipment_registration_identity_conflict', 'Persisted on-site A/C registration identity is incomplete.', 409);
  }
  const checks = [
    ['Customer', clientId, text(expectedContext.customerId, 180)],
    ['Property', propertyId, text(expectedContext.propertyId, 180)],
    ['Work Visit', sourceVisitId, text(expectedContext.visitId, 180)],
    ['Work Order', sourceWorkOrderId, text(expectedContext.workOrderId, 180)],
  ];
  for (const [label, actual, expected] of checks) {
    if (expected && actual !== expected) {
      throw fieldError('equipment_registration_identity_conflict', `Persisted on-site A/C registration ${label} does not match its authorized context.`, 409);
    }
  }
  const locationLabel = text(record?.locationLabel, 240);
  const systemType = text(record?.systemType, 120);
  const brand = text(record?.brand, 120);
  const refrigerant = text(record?.refrigerant, 80);
  const voltage = text(record?.voltage, 80);
  const btu = positiveBtu(record?.btu);
  const qrCode = optionalQr(record?.qrCode);
  if (!locationLabel || !systemType || !brand || !refrigerant || !voltage || record?.active !== true) {
    throw fieldError('invalid_equipment_registration', 'Persisted on-site A/C registration is incomplete.', 409);
  }
  const evidenceIds = record?.registrationEvidenceIds;
  if (!evidenceIds || typeof evidenceIds !== 'object' || Array.isArray(evidenceIds)) {
    throw fieldError('invalid_equipment_registration', 'Persisted on-site A/C registration evidence links are missing.', 409);
  }
  for (const kind of EQUIPMENT_REGISTRATION_EVIDENCE_KINDS) {
    if (!text(evidenceIds[kind], 180)) {
      throw fieldError('invalid_equipment_registration', 'Persisted on-site A/C registration evidence links are incomplete.', 409);
    }
  }
  return {
    id,
    qrCode: qrCode || undefined,
    locationLabel,
    systemType,
    brand,
    btu,
    refrigerant,
    voltage,
    active: true,
    evidenceIds: Object.fromEntries(EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.map((kind) => [kind, text(evidenceIds[kind], 180)])),
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalRegistrationVersion(record?.version),
  };
}

function ensureMutableVisit(context) {
  if (!EQUIPMENT_REGISTRATION_VISIT_STATUSES.has(text(context?.canonicalVisit?.status, 80))) {
    throw fieldError('equipment_registration_not_allowed', 'A/C equipment can only be registered after arrival and while the visit is active.', 409, {
      visitStatus: text(context?.canonicalVisit?.status, 80) || null,
    });
  }
}

function validateStoragePathForVisit(storagePath, visitId, kind) {
  const normalized = text(storagePath, 1000);
  const prefix = `field-evidence/${text(visitId, 180)}/`;
  if (!normalized.startsWith(prefix) || !normalized.includes(`/${kind}.`)) {
    throw fieldError('invalid_equipment_evidence_path', 'A/C registration photo does not belong to this Work Visit or evidence type.', 409);
  }
  return normalized;
}

async function verifyRegistrationImages({ verifyStoredImage, evidencePaths, visitId }) {
  const verified = {};
  for (const kind of EQUIPMENT_REGISTRATION_EVIDENCE_KINDS) {
    const storagePath = validateStoragePathForVisit(evidencePaths[kind], visitId, kind);
    try {
      const metadata = await verifyStoredImage(storagePath);
      verified[kind] = { storagePath, metadata };
    } catch (cause) {
      if (cause?.code && String(cause.code).startsWith('invalid_')) throw cause;
      const error = fieldError('equipment_evidence_unavailable', 'A required A/C registration photo could not be verified.', 409, { evidenceKind: kind });
      error.cause = cause;
      throw error;
    }
  }
  return verified;
}

function registrationAuditEvent({ requestId, equipment, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:equipment_registered_on_site:${equipment.id}`),
    type: 'equipment_registered_on_site',
    entityType: 'EquipmentSystem',
    entityId: equipment.id,
    visitId: context.canonicalVisit.id,
    assetId: equipment.id,
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
      locationLabel: equipment.locationLabel,
      systemType: equipment.systemType,
      brand: equipment.brand,
      btu: equipment.btu,
      refrigerant: equipment.refrigerant,
      voltage: equipment.voltage,
      qrAssociated: Boolean(text(equipment.qrCode, 512)),
      evidenceKinds: EQUIPMENT_REGISTRATION_EVIDENCE_KINDS,
    },
  };
}

function createRegisterEquipmentSystemCommand({
  db,
  resolveAssignment,
  appendAuditInTransaction,
  verifyStoredImage,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');
  if (typeof verifyStoredImage !== 'function') throw new Error('verifyStoredImage is required.');

  return async function registerEquipmentSystem({ identity, visitId, requestId, ...rawInput } = {}) {
    const normalizedVisitId = text(visitId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    const stable = stableRequestId(requestId);
    const normalized = normalizeRegistrationInput(rawInput);
    const fingerprint = registrationFingerprint(normalized);

    let authorizedContext;
    await db.runTransaction(async (transaction) => {
      authorizedContext = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'asset.add',
        deniedMessage: 'This assignment cannot register A/C equipment for the visit.',
      });
      ensureMutableVisit(authorizedContext);
    });

    const verifiedImages = await verifyRegistrationImages({
      verifyStoredImage,
      evidencePaths: normalized.evidencePaths,
      visitId: normalizedVisitId,
    });

    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'asset.add',
        deniedMessage: 'This assignment cannot register A/C equipment for the visit.',
      });
      ensureMutableVisit(context);

      const clientSnapshot = await transaction.get(db.collection('clients').doc(context.customerId));
      const propertySnapshot = await transaction.get(db.collection('properties').doc(context.propertyId));
      if (!clientSnapshot.exists || !propertySnapshot.exists) {
        throw fieldError('crm_identity_unavailable', 'The Customer or Property for this visit is no longer available in CRM.', 409);
      }
      const property = fieldSnapshotRecord(propertySnapshot);
      const propertyCustomer = text(property.clientId || property.customerId, 180);
      if (propertyCustomer !== context.customerId || property.active === false) {
        throw fieldError('crm_identity_conflict', 'The Property is not available for this Customer.', 409);
      }

      const assetId = equipmentDocumentId(normalizedVisitId, stable);
      const equipmentRef = db.collection(EQUIPMENT_COLLECTION).doc(assetId);
      const existingSnapshot = await transaction.get(equipmentRef);
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      if (existingSnapshot.exists) {
        const existing = fieldSnapshotRecord(existingSnapshot);
        if (text(existing.registrationRequestId, 240) !== stable || text(existing.registrationFingerprint, 80) !== fingerprint) {
          throw fieldError('equipment_registration_request_conflict', 'This registration request id was already used with different A/C details.', 409);
        }
        const equipment = projectRegisteredEquipment(existing, expectedContext);
        const evidence = [];
        for (const kind of EQUIPMENT_REGISTRATION_EVIDENCE_KINDS) {
          const evidenceSnapshot = await transaction.get(db.collection(FIELD_EVIDENCE_COLLECTION).doc(equipment.evidenceIds[kind]));
          if (!evidenceSnapshot.exists) {
            throw fieldError('equipment_registration_identity_conflict', 'Registered A/C is missing required identification evidence.', 409);
          }
          evidence.push(fieldEvidenceFromSnapshot(evidenceSnapshot, { ...expectedContext, assetId }));
        }
        result = { success: true, replayed: true, equipment, evidence, allowedActions: context.allowedActions };
        return;
      }

      if (normalized.qrCode) {
        const qrSnapshot = await transaction.get(db.collection(EQUIPMENT_COLLECTION).where('qrCode', '==', normalized.qrCode));
        if ((qrSnapshot?.docs || []).length > 0) {
          throw fieldError('equipment_qr_already_assigned', 'This QR is already associated with another A/C.', 409);
        }
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const evidenceRecords = EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.map((kind) => buildEquipmentRegistrationEvidence({
        assetId,
        kind,
        storagePath: verifiedImages[kind].storagePath,
        storageMetadata: verifiedImages[kind].metadata,
        context,
        identity,
        occurredAt,
      }));
      const registrationEvidenceIds = Object.fromEntries(evidenceRecords.map((item) => [item.evidenceKind, item.id]));
      const equipmentRecord = fieldFirestoreData({
        id: assetId,
        fieldRegistrationVersion: FIELD_EQUIPMENT_REGISTRATION_VERSION,
        registrationRequestId: stable,
        registrationFingerprint: fingerprint,
        clientId: context.customerId,
        propertyId: context.propertyId,
        locationLabel: normalized.locationLabel,
        systemType: normalized.systemType,
        brand: normalized.brand,
        btu: normalized.btu,
        refrigerant: normalized.refrigerant,
        voltage: normalized.voltage,
        qrCode: normalized.qrCode || undefined,
        active: true,
        condition: 'registered',
        source: 'field_on_site',
        sourceWorkOrderId: context.workOrderId,
        sourceVisitId: normalizedVisitId,
        referenceEvidenceId: registrationEvidenceIds.equipment_reference,
        registrationEvidenceIds,
        components: [
          {
            id: `${assetId}-indoor`,
            componentType: 'indoor',
            nameplateEvidenceId: registrationEvidenceIds.indoor_nameplate,
          },
          {
            id: `${assetId}-outdoor`,
            componentType: 'outdoor',
            nameplateEvidenceId: registrationEvidenceIds.outdoor_nameplate,
          },
        ],
        createdAt: occurredAt,
        createdByUserId: text(identity?.uid, 180),
        createdByStaffId: text(identity?.staffId, 180) || undefined,
        createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: text(identity?.staffId, 180) || undefined,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: 1,
      }, 'equipmentSystem');

      transaction.create(equipmentRef, equipmentRecord);
      for (const evidence of evidenceRecords) {
        transaction.create(db.collection(FIELD_EVIDENCE_COLLECTION).doc(evidence.id), evidence);
        await appendAuditInTransaction({
          transaction,
          event: equipmentEvidenceAuditEvent({ requestId: stable, evidence, context, identity, occurredAt }),
        });
      }
      await appendAuditInTransaction({
        transaction,
        event: registrationAuditEvent({ requestId: stable, equipment: equipmentRecord, context, identity, occurredAt }),
      });

      result = {
        success: true,
        replayed: false,
        equipment: projectRegisteredEquipment(equipmentRecord, expectedContext),
        evidence: evidenceRecords.map((item) => fieldEvidenceFromSnapshot({ id: item.id, data: () => item }, { ...expectedContext, assetId })),
        allowedActions: context.allowedActions,
        auditEventIds: [
          ...evidenceRecords.map((item) => deterministicId('FE', `${stable}:equipment_registration_evidence:${item.id}`)),
          deterministicId('FE', `${stable}:equipment_registered_on_site:${assetId}`),
        ],
      };
    });

    return result;
  };
}

module.exports.EQUIPMENT_COLLECTION = EQUIPMENT_COLLECTION;
module.exports.EQUIPMENT_REGISTRATION_VISIT_STATUSES = EQUIPMENT_REGISTRATION_VISIT_STATUSES;
module.exports.FIELD_EQUIPMENT_REGISTRATION_VERSION = FIELD_EQUIPMENT_REGISTRATION_VERSION;
module.exports.createRegisterEquipmentSystemCommand = createRegisterEquipmentSystemCommand;
module.exports.equipmentDocumentId = equipmentDocumentId;
module.exports.normalizeRegistrationInput = normalizeRegistrationInput;
module.exports.projectRegisteredEquipment = projectRegisteredEquipment;
module.exports.registrationFingerprint = registrationFingerprint;
module.exports.verifyRegistrationImages = verifyRegistrationImages;
