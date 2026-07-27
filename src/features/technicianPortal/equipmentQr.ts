const QR_PREFIX = 'DEMAC-AC';

function randomPart(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

export function normalizeEquipmentQrCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-');
}

export function generateEquipmentQrCode(existingCodes: string[] = []) {
  const existing = new Set(existingCodes.map(normalizeEquipmentQrCode));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${QR_PREFIX}-${randomPart()}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${QR_PREFIX}-${Date.now().toString(36).toUpperCase()}`;
}

export function equipmentDocumentIdFromQr(qrCode: string) {
  return `equipment-${normalizeEquipmentQrCode(qrCode).toLowerCase()}`;
}

export function isValidEquipmentQrCode(value: string) {
  return /^DEMAC-AC-[A-Z0-9]{6,16}$/.test(normalizeEquipmentQrCode(value));
}
