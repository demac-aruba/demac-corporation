import {
  FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS,
  type FieldEquipmentRegistrationEvidenceKind,
} from './field-equipment-registration-contract';
import { uploadAuthenticatedFirebaseStorageObject } from './firebase/storage-upload';

const MAX_FIELD_IMAGE_BYTES = 12 * 1024 * 1024;
const EVIDENCE_KINDS = new Set<string>(FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS);

function safeSegment(value: string, label: string, limit = 240) {
  const normalized = value.trim().slice(0, limit).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') throw new Error(`${label} is invalid.`);
  return normalized;
}

function imageExtension(file: File) {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  if (byType[file.type.toLowerCase()]) return byType[file.type.toLowerCase()];
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return extension || 'img';
}

export function validateFieldEquipmentImage(file: File) {
  if (!file.type.toLowerCase().startsWith('image/')) throw new Error('Selecciona una imagen válida.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FIELD_IMAGE_BYTES) {
    throw new Error('Cada foto del A/C debe ser una imagen de hasta 12 MB.');
  }
}

export function fieldEquipmentEvidenceStoragePath(
  visitId: string,
  requestId: string,
  kind: FieldEquipmentRegistrationEvidenceKind,
  file: File,
) {
  if (!EVIDENCE_KINDS.has(kind)) throw new Error('Tipo de evidencia de A/C inválido.');
  validateFieldEquipmentImage(file);
  const visit = safeSegment(visitId, 'Work Visit id', 180);
  const request = safeSegment(requestId, 'Registration request id', 240);
  return `field-evidence/${visit}/${request}/${kind}.${imageExtension(file)}`;
}

export async function uploadFieldEquipmentRegistrationImage({
  visitId,
  requestId,
  kind,
  file,
}: {
  visitId: string;
  requestId: string;
  kind: FieldEquipmentRegistrationEvidenceKind;
  file: File;
}) {
  const path = fieldEquipmentEvidenceStoragePath(visitId, requestId, kind, file);
  const stored = await uploadAuthenticatedFirebaseStorageObject(path, file, file.type);
  return stored.path;
}

export { MAX_FIELD_IMAGE_BYTES };
