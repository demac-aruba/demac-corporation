'use client';

import { useEffect, useState } from 'react';
import { listChargeServices, type ChargeCatalogItem, type ChargeLineInput } from '../../lib/appointment-charges';
import { ChargeCatalogPicker } from './charge-catalog-picker';

export function ChargeAddSearch({ disabled, onAdd }: { disabled: boolean; onAdd: (line: ChargeLineInput) => void }) {
  const [items, setItems] = useState<ChargeCatalogItem[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void listChargeServices().then(result => { if (active) setItems(result.services); })
      .catch(() => { if (active) setError('No se pudo cargar el catálogo. Reintenta; tus trabajos se conservan.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <ChargeCatalogPicker inline index={0} items={items} disabled={disabled} loading={loading} error={error}
    fallbackLabel="" onRetry={() => setRevision(value => value + 1)} onSelect={item => {
      if (item) onAdd({ id: `actual-${crypto.randomUUID()}`, label: item.name, quantity: 1, serviceId: item.id });
    }}/>;
}
