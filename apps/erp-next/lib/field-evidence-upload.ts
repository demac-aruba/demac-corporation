import {
  FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS,
  type FieldEquipmentRegistrationEvidenceKind,
} from './field-equipment-registration-contract';
import { uploadAuthenticatedFirebaseStorageObject } from './firebase/storage-upload';

const MAX_FIELD_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REPORT_VOICE_BYTES = 6 * 1024 * 1024;
const MAX_REPORT_VOICE_DURATION_SECONDS = 120;
const EVIDENCE_KINDS = new Set<string>(FIELD_EQUIPMENT_REGISTRATION_EVIDENCE_KINDS);
const STRICT_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeSegment(value: string, label: string, limit = 240) {
  const normalized = value.trim().slice(0, limit).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') throw new Error(`${label} is invalid.`);
  return normalized;
}

function strictPathSegment(value: string, label: string, limit = 240) {
  const normalized = value.trim();
  if (!normalized || normalized.length > limit || !STRICT_PATH_SEGMENT.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${label} is invalid.`);
  }
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

function voiceExtension(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
}

export function validateFieldImage(file: File, message = 'Cada foto debe ser una imagen de hasta 12 MB.') {
  if (!file.type.toLowerCase().startsWith('image/')) throw new Error('Selecciona una imagen válida.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FIELD_IMAGE_BYTES) {
    throw new Error(message);
  }
}

export function validateFieldEquipmentImage(file: File) {
  validateFieldImage(file, 'Cada foto del A/C debe ser una imagen de hasta 12 MB.');
}

export function validateFieldReportVoice(blob: Blob, durationSeconds: number) {
  const contentType = blob.type.toLowerCase();
  if (!(contentType.startsWith('audio/') || contentType === 'video/mp4')) {
    throw new Error('La nota de voz debe ser una grabación de audio compatible.');
  }
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0 || blob.size > MAX_REPORT_VOICE_BYTES) {
    throw new Error('La nota de voz no puede superar 6 MB.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_REPORT_VOICE_DURATION_SECONDS) {
    throw new Error('La nota de voz debe durar entre 1 y 120 segundos.');
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

export function fieldReportPhotoStoragePath(
  visitId: string,
  interventionId: string,
  sectionId: string,
  requestId: string,
  file: File,
) {
  validateFieldImage(file, 'Cada foto del reporte debe ser una imagen de hasta 12 MB.');
  const visit = strictPathSegment(visitId, 'Work Visit id', 180);
  const intervention = strictPathSegment(interventionId, 'Work Intervention id', 180);
  const section = strictPathSegment(sectionId, 'Report section id', 120);
  const request = strictPathSegment(requestId, 'Report photo request id', 240);
  return `field-evidence/${visit}/interventions/${intervention}/${section}/${request}.${imageExtension(file)}`;
}

export async function uploadFieldReportPhoto({
  visitId,
  interventionId,
  sectionId,
  requestId,
  file,
}: {
  visitId: string;
  interventionId: string;
  sectionId: string;
  requestId: string;
  file: File;
}) {
  const path = fieldReportPhotoStoragePath(visitId, interventionId, sectionId, requestId, file);
  const stored = await uploadAuthenticatedFirebaseStorageObject(path, file, file.type);
  return stored.path;
}

export function fieldReportVoiceStoragePath(
  visitId: string,
  interventionId: string,
  sectionId: string,
  requestId: string,
  blob: Blob,
  durationSeconds: number,
) {
  validateFieldReportVoice(blob, durationSeconds);
  const visit = strictPathSegment(visitId, 'Work Visit id', 180);
  const intervention = strictPathSegment(interventionId, 'Work Intervention id', 180);
  const section = strictPathSegment(sectionId, 'Report section id', 120);
  const request = strictPathSegment(requestId, 'Report voice request id', 240);
  return `field-evidence/${visit}/interventions/${intervention}/${section}/voice/${request}.${voiceExtension(blob.type)}`;
}

export async function uploadFieldReportVoice({
  visitId,
  interventionId,
  sectionId,
  requestId,
  blob,
  durationSeconds,
}: {
  visitId: string;
  interventionId: string;
  sectionId: string;
  requestId: string;
  blob: Blob;
  durationSeconds: number;
}) {
  const path = fieldReportVoiceStoragePath(visitId, interventionId, sectionId, requestId, blob, durationSeconds);
  const stored = await uploadAuthenticatedFirebaseStorageObject(path, blob, blob.type);
  return stored.path;
}

export { MAX_FIELD_IMAGE_BYTES, MAX_REPORT_VOICE_BYTES, MAX_REPORT_VOICE_DURATION_SECONDS };
