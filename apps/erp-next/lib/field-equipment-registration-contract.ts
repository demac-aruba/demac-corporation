import {
  FIELD_AUTHORITY_API_VERSION,
  parseFieldAttachVisitAssetResponse,
  type FieldAllowedAction,
  type FieldVisitAsset,
} from './field-authority-contract';

export const FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS = [
  'equipment_reference',
  'indoor_nameplate',
  'outdoor_nameplate',
] as const;
export type FieldEquipmentRegistrationEvidenceKind = (typeof FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS)[number];

const EVIDENCE_KINDS = new Set<string>(FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS);

export type FieldRegisteredEquipment = {
  id: string;
  qrCode?: string;
  locationLabel: string;
  systemType: string;
  brand: string;
  btu: number;
  refrigerant: string;
  voltage: string;
  active: true;
  evidenceIds: Record<FieldEquipmentRegistrationEvidenceKind, string>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldEquipmentRegistrationEvidence = {
  id: string;
  visitId: string;
  assetId: string;
  evidenceKind: FieldEquipmentRegistrationEvidenceKind;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  capturedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldRegisterVisitAssetResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  registrationReplayed: boolean;
  attachReplayed: boolean;
  equipment: FieldRegisteredEquipment;
  evidence: FieldEquipmentRegistrationEvidence[];
  visitAsset: FieldVisitAsset;
  allowedActions: FieldAllowedAction[];
  auditEventIds: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function timestamp(value: unknown) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function positiveFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function evidenceIdsValid(value: unknown): value is FieldRegisteredEquipment['evidenceIds'] {
  const ids = record(value);
  if (!ids) return false;
  const keys = Object.keys(ids).sort();
  if (keys.length !== FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.length
    || !FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.every((kind) => keys.includes(kind))) return false;
  return FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.every((kind) => nonEmptyString(ids[kind]));
}

function registeredEquipmentValid(value: unknown): value is FieldRegisteredEquipment {
  const equipment = record(value);
  return Boolean(equipment)
    && nonEmptyString(equipment!.id)
    && optionalString(equipment!.qrCode)
    && nonEmptyString(equipment!.locationLabel)
    && nonEmptyString(equipment!.systemType)
    && nonEmptyString(equipment!.brand)
    && positiveSafeInteger(equipment!.btu)
    && nonEmptyString(equipment!.refrigerant)
    && nonEmptyString(equipment!.voltage)
    && equipment!.active === true
    && evidenceIdsValid(equipment!.evidenceIds)
    && timestamp(equipment!.createdAt)
    && nonEmptyString(equipment!.createdBy)
    && timestamp(equipment!.updatedAt)
    && nonEmptyString(equipment!.updatedBy)
    && positiveSafeInteger(equipment!.version);
}

function registrationEvidenceValid(value: unknown): value is FieldEquipmentRegistrationEvidence {
  const evidence = record(value);
  return Boolean(evidence)
    && nonEmptyString(evidence!.id)
    && nonEmptyString(evidence!.visitId)
    && nonEmptyString(evidence!.assetId)
    && nonEmptyString(evidence!.evidenceKind)
    && EVIDENCE_KINDS.has(evidence!.evidenceKind as string)
    && nonEmptyString(evidence!.storagePath)
    && typeof evidence!.contentType === 'string'
    && evidence!.contentType.toLowerCase().startsWith('image/')
    && positiveSafeInteger(evidence!.sizeBytes)
    && timestamp(evidence!.capturedAt)
    && timestamp(evidence!.createdAt)
    && nonEmptyString(evidence!.createdBy)
    && timestamp(evidence!.updatedAt)
    && nonEmptyString(evidence!.updatedBy)
    && positiveSafeInteger(evidence!.version);
}

function uniqueNonEmptyStrings(value: unknown) {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length;
}

export function parseFieldRegisterVisitAssetResponse(value: unknown): FieldRegisterVisitAssetResponse {
  const payload = record(value);
  if (!payload || payload.success !== true || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || typeof payload.registrationReplayed !== 'boolean'
    || typeof payload.attachReplayed !== 'boolean'
    || !registeredEquipmentValid(payload.equipment)
    || !Array.isArray(payload.evidence)
    || payload.evidence.length !== FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.length
    || !payload.evidence.every(registrationEvidenceValid)
    || !uniqueNonEmptyStrings(payload.auditEventIds)) {
    throw new Error('Field Operations returned malformed A/C registration data. Refresh and try again.');
  }

  const equipment = payload.equipment as FieldRegisteredEquipment;
  const evidence = payload.evidence as FieldEquipmentRegistrationEvidence[];
  const kinds = new Set(evidence.map((item) => item.evidenceKind));
  if (kinds.size !== FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.length
    || !FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS.every((kind) => kinds.has(kind))) {
    throw new Error('Field Operations returned incomplete A/C registration evidence. Refresh and try again.');
  }

  const parsedAttach = parseFieldAttachVisitAssetResponse({
    success: true,
    version: FIELD_AUTHORITY_API_VERSION,
    replayed: payload.attachReplayed,
    visitAsset: payload.visitAsset,
    allowedActions: payload.allowedActions,
  });
  if (parsedAttach.visitAsset.assetId !== equipment.id || parsedAttach.visitAsset.source !== 'registered_on_site') {
    throw new Error('Field Operations returned conflicting A/C registration identity. Refresh and try again.');
  }
  for (const item of evidence) {
    if (item.assetId !== equipment.id || item.visitId !== parsedAttach.visitAsset.visitId
      || equipment.evidenceIds[item.evidenceKind] !== item.id) {
      throw new Error('Field Operations returned conflicting A/C registration evidence. Refresh and try again.');
    }
  }

  return payload as FieldRegisterVisitAssetResponse;
}
