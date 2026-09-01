export type VanMasterDataIdentity = {
  id: string;
};

/**
 * Closed compatibility registry for Van document IDs that predate stable lane IDs.
 * New Vans use their master-data document ID directly; display names never become IDs.
 */
export const LEGACY_MASTER_DATA_VAN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'v1': 'VAN-1',
  'van1': 'VAN-1',
  'van 1': 'VAN-1',
  'van_1': 'VAN-1',
  'v2': 'VAN-2',
  'van2': 'VAN-2',
  'van 2': 'VAN-2',
  'van_2': 'VAN-2',
  'v3': 'VAN-3',
  'van3': 'VAN-3',
  'van 3': 'VAN-3',
  'van_3': 'VAN-3',
  'v4': 'VAN-4',
  'van4': 'VAN-4',
  'van 4': 'VAN-4',
  'van_4': 'VAN-4',
  'van-1783800405341': 'VAN-4',
  'van-1783801335935': 'VAN-2',
  'van-1783801335936': 'VAN-4',
  'van-1783801335937': 'VAN-1',
  'van-1783801335938': 'VAN-3',
});

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function explicitLegacyVanAlias(value: unknown) {
  const raw = text(value);
  return raw ? LEGACY_MASTER_DATA_VAN_ALIASES[raw.toLowerCase()] ?? '' : '';
}

/** Normalize only the canonical VAN-N ID shape. Human labels are intentionally excluded. */
export function canonicalVanReferenceId(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const legacy = explicitLegacyVanAlias(raw);
  if (legacy) return legacy;
  const match = raw.match(/^VAN-([1-9]\d*)$/i);
  return match ? `VAN-${Number(match[1])}` : '';
}

export function stableVanIdFromMasterData(record: VanMasterDataIdentity | null | undefined) {
  const raw = text(record?.id);
  return explicitLegacyVanAlias(raw) || canonicalVanReferenceId(raw) || raw;
}

export function resolveStableVanId(value: unknown, vans: VanMasterDataIdentity[] = []) {
  const raw = text(value);
  if (!raw) return '';
  const exactRecord = vans.find((van) => van.id === raw);
  if (exactRecord) return stableVanIdFromMasterData(exactRecord);
  return explicitLegacyVanAlias(raw) || canonicalVanReferenceId(raw) || raw;
}
