'use client';
import { useEffect, useState } from 'react';
import { linkAccessLost, linkFailureMessage, readCatalogLinks } from '@/lib/firebase/quickbooks-links';
import { qboLinkHash, type CatalogLink, type CatalogLinkMap, type LinkEntity } from '@/lib/quickbooks-links';
import type { CatalogCollection } from '@/lib/quickbooks-catalog-scan';
import type { CatalogEntity } from '@/lib/quickbooks-catalog';
type Collections = Partial<Record<CatalogEntity, CatalogCollection>>;
export function useQuickBooksLinks(uid: string, values: Collections, readBusy: boolean, unavailable: (message: string) => void) {
  const [result, setResult] = useState<{ uid: string; values: Collections; links: CatalogLinkMap; error: string | null; loading: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    if (readBusy || (!values.Customer && !values.Item)) return;
    setResult({ uid, values, links: {}, error: null, loading: true });
    void (async () => {
      try {
        const links: CatalogLinkMap = {};
        for (const entity of ['Customer', 'Item'] as LinkEntity[]) {
          const collection = values[entity]; if (!collection) continue;
          const byId = new Map(collection.records.map(row => [row.id, row])); links[entity] = Object.create(null);
          for (let start = 0; start < collection.source.length; start += 100) {
            if (!live) return;
            const rows = await readCatalogLinks(uid, entity, collection.source.slice(start, start + 100).map(row => row.id));
            if (!live) return;
            for (const row of rows) {
              const target = row.qboId ? byId.get(row.qboId) : undefined;
              links[entity]![row.erpId] = row.status === 'confirmed' ? { ...row, needsReview: row.needsReview || !target || !target.active || await qboLinkHash(target) !== row.targetHash } : row;
            }
          }
        }
        if (live) setResult({ uid, values, links, error: null, loading: false });
      } catch (error) {
        if (!live) return;
        const message = linkFailureMessage(error); setResult({ uid, values, links: {}, error: message, loading: false });
        if (linkAccessLost(error)) unavailable(message);
      }
    })();
    return () => { live = false; };
  }, [uid, values, readBusy, revision, unavailable]);
  const active = result?.uid === uid && result.values === values ? result : null;
  return { links: active?.links || {}, loading: readBusy || !active || active.loading, error: active?.error,
    refresh: () => setRevision(value => value + 1),
    changed: (link: CatalogLink) => setResult(previous => previous?.uid === uid && previous.values === values ? {
      ...previous, links: { ...previous.links, [link.entity]: { ...previous.links[link.entity], [link.erpId]: link } },
    } : previous) };
}
