import type { ErpMatchRow, QuickBooksCatalogRow } from './quickbooks-catalog';
export type LinkEntity = 'Customer' | 'Item';
export type CatalogLink = { entity: LinkEntity; erpId: string; status: 'unlinked' | 'confirmed' | 'revoked'; version: number;
  qboId?: string; sourceHash?: string; targetHash?: string; updatedAt?: string; verifiedAt?: string; needsReview?: boolean };
export type PreparedLink = { intentId: string; entity: LinkEntity; source: ErpMatchRow; target: QuickBooksCatalogRow;
  expiresAt: string; verifiedAt: string; expectedVersion: number };
export type CatalogLinkMap = Partial<Record<LinkEntity, Record<string, CatalogLink>>>;
async function fingerprint(values: unknown[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export const erpLinkHash = (row: ErpMatchRow) => fingerprint([row.id, row.name, row.active, row.email || null, row.sku || null, row.type || null]);
export const qboLinkHash = (row: QuickBooksCatalogRow) => fingerprint([row.id, row.name, row.active, row.email ?? null, row.company ?? null, row.currency ?? null,
  row.parentId ?? null, row.isJob ?? null, row.type ?? null, row.sku ?? null, row.incomeAccountId ?? null, row.expenseAccountId ?? null, row.assetAccountId ?? null]);
export function validCatalogLink(value: unknown, entity: LinkEntity, erpId: string): value is CatalogLink {
  if (!value || typeof value !== 'object') return false;
  const row = value as CatalogLink;
  if (row.entity !== entity || row.erpId !== erpId || !Number.isSafeInteger(row.version) || row.version < 0) return false;
  if (row.status === 'unlinked') return row.version === 0 && row.qboId === undefined;
  return ['confirmed', 'revoked'].includes(row.status) && row.version > 0 && typeof row.qboId === 'string' && Boolean(row.qboId) && row.qboId.length <= 180 &&
    /^[a-f0-9]{64}$/.test(row.sourceHash || '') && /^[a-f0-9]{64}$/.test(row.targetHash || '') && typeof row.needsReview === 'boolean' &&
    Number.isFinite(Date.parse(row.updatedAt || '')) && Number.isFinite(Date.parse(row.verifiedAt || ''));
}
