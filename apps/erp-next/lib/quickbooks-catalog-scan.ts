import { suggestCatalogMatches, validateCatalogResult, type CatalogEntity, type CatalogInput, type CatalogResult, type ErpMatchRow, type QuickBooksCatalogRow } from './quickbooks-catalog';
export type CatalogCollection = { entity: CatalogEntity; companyName: string; fetchedAt: string; source: ErpMatchRow[];
  records: QuickBooksCatalogRow[]; complete: boolean; limited: boolean };
export type ComparisonRow = { key: string; source?: ErpMatchRow; candidates: QuickBooksCatalogRow[];
  status: 'review' | 'ambiguous' | 'not-seen' | 'inactive' | 'qbo-only'; search: string };
export const catalogSearchText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
const INTERVAL_MS = 5100; // Existing server lease/rate gate remains unchanged.
export async function scanCatalogs(options: {
  entities: CatalogEntity[]; readPage: (input: CatalogInput) => Promise<CatalogResult>;
  readErp: (entity: CatalogEntity) => Promise<ErpMatchRow[]>; current: () => boolean;
  progress: (value: CatalogCollection) => void; started: (entity: CatalogEntity) => void;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let requested = false, company: string | null = null;
  for (const entity of options.entities) {
    if (!options.current()) return;
    options.started(entity);
    let position: number | null = 1, source: ErpMatchRow[] | null = null;
    const records: QuickBooksCatalogRow[] = [], ids = new Set<string>();
    while (position !== null) {
      if (requested) await wait(INTERVAL_MS);
      if (!options.current()) return;
      const input: CatalogInput = { entity, startPosition: position };
      const data = await options.readPage(input); requested = true;
      if (!options.current()) return;
      validateCatalogResult(data, input);
      if (company !== null && company !== data.companyName) throw Error('catalog-observation-changed');
      company = data.companyName;
      if (source === null) {
        source = await options.readErp(entity);
        if (!options.current()) return;
        if (new Set(source.map(row => row.id)).size !== source.length) throw Error('duplicate-erp-identity');
      }
      for (const row of data.catalog.records) {
        if (ids.has(row.id)) throw Error('catalog-observation-changed');
        ids.add(row.id); records.push(row);
      }
      options.progress({ entity, companyName: data.companyName, fetchedAt: data.fetchedAt, source,
        records: [...records], complete: data.catalog.endOfCurrentQuery, limited: data.catalog.atLimit });
      position = data.catalog.nextStartPosition;
    }
  }
}
export function comparisonRows(entity: CatalogEntity, collection?: CatalogCollection): ComparisonRow[] {
  if (!collection) return [];
  const matched = new Set<string>();
  const searchable = (source: ErpMatchRow | undefined, candidates: QuickBooksCatalogRow[]) => catalogSearchText([
    source?.name, source?.id, source?.email, source?.sku, ...candidates.flatMap(row => [row.name, row.id, row.email, row.sku, row.company]),
  ].filter(Boolean).join(' '));
  const result: ComparisonRow[] = suggestCatalogMatches(entity, collection.source, collection.records).map(row => {
    row.candidates.forEach(candidate => matched.add(candidate.id));
    return { key: 'erp-' + row.source.id, ...row, search: searchable(row.source, row.candidates) };
  });
  for (const row of collection.records) if (!matched.has(row.id)) result.push({ key: 'qbo-' + row.id, candidates: [row],
    status: row.active ? 'qbo-only' : 'inactive', search: searchable(undefined, [row]) });
  return result.sort((a,b) => (a.source?.name || a.candidates[0]?.name || '').localeCompare(b.source?.name || b.candidates[0]?.name || '', 'es', { sensitivity: 'base', numeric: true }) || a.key.localeCompare(b.key));
}
