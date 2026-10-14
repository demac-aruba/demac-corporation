export type CatalogEntity = 'Customer' | 'Item' | 'Account';
export type CatalogInput = { entity: CatalogEntity; startPosition: number };
export type QuickBooksCatalogRow = { id: string; name: string; active: boolean; company?: string | null; email?: string | null;
  currency?: string | null; parentId?: string | null; isJob?: boolean | null; type?: string; sku?: string | null;
  incomeAccountId?: string | null; expenseAccountId?: string | null; assetAccountId?: string | null; subType?: string | null };
export type CatalogResult = { environment: 'production'; realmId: string; companyName: string; fetchedAt: string;
  accountingWritesEnabled: false; syncEnabled: false; request: CatalogInput;
  catalog: { records: QuickBooksCatalogRow[]; pageSize: 100; nextStartPosition: number | null; atLimit: boolean; endOfCurrentQuery: boolean } };
export type ErpMatchRow = { id: string; name: string; email?: string; sku?: string; type?: 'Servicio' | 'Producto'; active: boolean };
export type MatchSuggestion = { source: ErpMatchRow; candidates: QuickBooksCatalogRow[]; status: 'review' | 'ambiguous' | 'not-seen' | 'inactive' };
const normalize = (text?: string | null) => (text || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
export function suggestCatalogMatches(entity: CatalogEntity, source: ErpMatchRow[], records: QuickBooksCatalogRow[]): MatchSuggestion[] {
  if (entity === 'Account') return [];
  return source.map(row => {
    const candidates = records.filter(target => {
      const name = normalize(row.name); const email = normalize(row.email); const sku = normalize(row.sku);
      // Evidence to review only: even an exact email/SKU is not an approved identity mapping.
      return (name && name === normalize(target.name)) || (entity === 'Customer' && email && email === normalize(target.email)) ||
        (entity === 'Item' && sku && sku === normalize(target.sku));
    });
    return { source: row, candidates, status: !row.active ? 'inactive' : candidates.length > 1 ? 'ambiguous' : candidates.length ? 'review' : 'not-seen' };
  });
}

export function validateCatalogResult(value: unknown, input: CatalogInput): CatalogResult {
  const invalid = () => { throw Error('No se pudo verificar el catálogo de QuickBooks. No se muestran datos incompletos.'); };
  if (!value || typeof value !== 'object') return invalid();
  const data = value as CatalogResult;
  const page = data.catalog;
  if (data.environment !== 'production' || data.realmId !== '9130352327074466' || data.accountingWritesEnabled !== false || data.syncEnabled !== false ||
    typeof data.companyName !== 'string' || !data.companyName || data.companyName.length > 1000 || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt)) ||
    data.request?.entity !== input.entity || data.request?.startPosition !== input.startPosition || !page || page.pageSize !== 100 ||
    !Array.isArray(page.records) || page.records.length > 100 || page.endOfCurrentQuery !== (page.records.length < 100) ||
    page.atLimit !== (page.records.length === 100 && input.startPosition === 99901) ||
    page.nextStartPosition !== (page.records.length === 100 && input.startPosition < 99901 ? input.startPosition + 100 : null)) return invalid();
  const ids = new Set<string>();
  for (const row of page.records) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 128 || ids.has(row.id) ||
      typeof row.name !== 'string' || !row.name.trim() || row.name.length > 1000 || typeof row.active !== 'boolean') return invalid();
    ids.add(row.id);
    const fields = input.entity === 'Customer' ? ['company', 'email', 'currency', 'parentId'] as const :
      input.entity === 'Item' ? ['sku', 'incomeAccountId', 'expenseAccountId', 'assetAccountId'] as const : ['subType', 'currency'] as const;
    for (const field of fields) if (row[field] !== null && (typeof row[field] !== 'string' || row[field]!.length > 1000)) return invalid();
    if (input.entity === 'Customer' ? row.isJob !== null && typeof row.isJob !== 'boolean' : typeof row.type !== 'string' || !row.type || row.type.length > 64) return invalid();
  }
  return data;
}
