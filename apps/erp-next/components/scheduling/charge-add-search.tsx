'use client';

import { useEffect, useState } from 'react';
import { listChargeServices, type ChargeCatalogItem, type ChargeLineInput } from '../../lib/appointment-charges';
import { ChargeCatalogPicker } from './charge-catalog-picker';

const governed: ChargeCatalogItem[] = [
  { id: 'matrix:standard_service', presetId: 'standard_service', name: 'Standard service', itemType: 'Servicio', description: 'Mantenimiento estándar · tarifa por BTU', category: 'Servicios por BTU' },
  { id: 'matrix:deep_cleaning', presetId: 'deep_cleaning', name: 'Deep cleaning', itemType: 'Servicio', description: 'Limpieza profunda · tarifa por BTU', category: 'Servicios por BTU' },
  { id: 'matrix:standard_installation', presetId: 'standard_installation', name: 'Instalación estándar back to back', itemType: 'Servicio', description: 'Instalación · tarifa por BTU', category: 'Servicios por BTU' },
];
export function ChargeAddSearch({ disabled, onAdd }: { disabled: boolean; onAdd: (line: ChargeLineInput) => void }) {
  const [items, setItems] = useState<ChargeCatalogItem[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void listChargeServices().then(result => { if (active) setItems([...governed, ...result.services]); })
      .catch(() => { if (active) setError('No se pudo cargar el catálogo. Reintenta; tus trabajos se conservan.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <ChargeCatalogPicker inline index={0} items={items} disabled={disabled} loading={loading} error={error}
    fallbackLabel="" onRetry={() => setRevision(value => value + 1)} onSelect={item => {
      if (item) onAdd({ id: `actual-${crypto.randomUUID()}`, label: item.name, quantity: 1,
        ...(item.presetId ? { presetId: item.presetId } : { serviceId: item.id }) });
    }}/>;
}
