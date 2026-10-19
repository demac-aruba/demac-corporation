'use client';

import { useEffect, useState } from 'react';
import { listChargeServices, type ChargeCatalogItem, type ChargeLineInput } from '../../lib/appointment-charges';
import { ChargeCatalogPicker } from './charge-catalog-picker';

export function ChargeAddSearch({ disabled, active = true, onAdd, onCatalogLoaded }: { disabled: boolean; active?: boolean; onAdd: (line: ChargeLineInput) => void; onCatalogLoaded?: (items: ChargeCatalogItem[]) => void }) {
  const [items, setItems] = useState<ChargeCatalogItem[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void listChargeServices().then(result => { if (active) { setItems(result.services); onCatalogLoaded?.(result.services); } })
      .catch(() => { if (active) setError('No se pudo cargar el catálogo. Reintenta; tus trabajos se conservan.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, onCatalogLoaded]);
  return <ChargeCatalogPicker inline floating active={active} index={0} items={items} disabled={disabled} loading={loading} error={error}
    fallbackLabel="" onRetry={() => setRevision(value => value + 1)} onSelect={item => {
      if (item) onAdd({ id: `actual-${crypto.randomUUID()}`, label: item.name, description: item.description || '', quantity: 1, serviceId: item.id });
    }}/>;
}
