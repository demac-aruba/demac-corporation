'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createOfficeLifecycleRequestId, updateOfficeProperty } from '@/lib/office-booking-authority';
import { loadPropertyLocations, type PropertyLocationData } from '@/lib/property-locations';
import { dwellingTypeLabels } from '@/lib/property-editor-draft';
import type { BookingContact } from '@/lib/customer-contacts';
import { PropertyEditor } from './property-editor';
import { PropertyIcon } from './property-icons';
import styles from './property-locations.module.css';

type Props = {
  customerId: string; propertyId: string; contacts: BookingContact[]; customerName?: string; booking?: boolean; selectedId?: string;
  onSelect?: (id: string) => void; onLoaded?: (data: PropertyLocationData | null) => void;
};
/** Booking selects an existing unit; all editing uses the shared property editor. */
export function PropertyLocations({ customerId, propertyId, customerName = 'Cliente de esta propiedad', contacts, selectedId = '', onSelect, onLoaded }: Props) {
  const [data, setData] = useState<PropertyLocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState('');
  const sequence = useRef(0);
  const loadedCallback = useRef(onLoaded); loadedCallback.current = onLoaded;
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError(''); loadedCallback.current?.(null);
    try {
      const next = await loadPropertyLocations(customerId, propertyId);
      if (current !== sequence.current) return;
      setData(next); loadedCallback.current?.(next);
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la propiedad.'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [customerId, propertyId]);
  useEffect(() => { void reload(); return () => { sequence.current++; }; }, [reload]);
  const rows = data?.dwellings.filter((row) => `${row.code} ${row.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) || [];
  return <section className={styles.panel} aria-label="Property dwellings and areas" aria-busy={loading}>
    <header className={styles.header}><div><PropertyIcon name="building" /><span><strong>{data?.dwellings.length ? 'Seleccionar unidad' : 'Distribución de la propiedad'}</strong><small>{loading ? 'Cargando…' : data?.dwellings.length ? `${data.dwellings.length} unidades · elige el lugar de la visita` : 'Una sola unidad'}</small></span></div><button type="button" disabled={loading || !data} onClick={() => setEditor(createOfficeLifecycleRequestId('booking-property-edit'))}><PropertyIcon name="edit" />Editar propiedad</button></header>
    {error ? <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => void reload()}>Reintentar</button></div> : null}
    {data && data.dwellings.length > 0 ? <><label className={styles.search}><PropertyIcon name="search" /><input aria-label="Buscar unidad para la visita" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o código del apartamento…" /></label><div className={styles.list}>{rows.map((row) => <button type="button" key={row.id} aria-pressed={selectedId === row.id} disabled={loading} onClick={() => onSelect?.(row.id)}><PropertyIcon name={row.type === 'main_office' ? 'office' : row.type === 'apartment' ? 'building' : 'house'} /><span><strong>{row.name}</strong><small>{row.code} · {dwellingTypeLabels[row.type]}</small></span>{selectedId === row.id ? <PropertyIcon name="check" /> : null}</button>)}</div>{!selectedId ? <p className={styles.hint}>Selecciona la unidad donde se realizará el servicio.</p> : null}</> : null}
    {editor && data ? <PropertyEditor mode="edit" requestId={editor} customerId={customerId} customerName={customerName} contacts={contacts}
      initial={{ id: propertyId, name: data.property.name || '', type: data.property.type || 'Casa', address: data.property.address || '', zone: data.property.zone || '', neighborhood: data.property.neighborhood || '', accessInstructions: data.property.accessInstructions || '', notes: data.property.notes || '' }}
      onClose={() => setEditor('')} onSave={async (value) => {
        await updateOfficeProperty({ requestId: editor, customerId, propertyId, expectedUpdatedAt: value.expectedUpdatedAt || '', locations: value.locations, changes: { name: value.name, type: value.type, address: value.address, zone: value.zone, neighborhood: value.neighborhood, accessInstructions: value.accessInstructions, notes: value.notes } });
        await reload();
      }} /> : null}
  </section>;
}
