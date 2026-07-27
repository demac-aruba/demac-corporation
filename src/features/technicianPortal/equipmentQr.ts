function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeEquipmentQrCode(value: string) {
  return value.trim();
}

export function equipmentDocumentIdFromQr(qrCode: string) {
  const normalized = normalizeEquipmentQrCode(qrCode);
  return `equipment-qr-${stableHash(normalized)}-${normalized.length}`;
}

export function isValidEquipmentQrCode(value: string) {
  const normalized = normalizeEquipmentQrCode(value);
  return normalized.length >= 3 && normalized.length <= 512;
}

export function equipmentQrCodesMatch(first: string, second: string) {
  return normalizeEquipmentQrCode(first) === normalizeEquipmentQrCode(second);
}

export function shortEquipmentQrCode(value: string, maximumLength = 34) {
  const normalized = normalizeEquipmentQrCode(value);
  if (normalized.length <= maximumLength) return normalized;
  const edgeLength = Math.max(6, Math.floor((maximumLength - 1) / 2));
  return `${normalized.slice(0, edgeLength)}…${normalized.slice(-edgeLength)}`;
}
