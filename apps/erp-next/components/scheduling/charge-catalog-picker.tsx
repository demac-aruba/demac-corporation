'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChargeCatalogItem } from '../../lib/appointment-charges';
import { ChargeIcon } from './appointment-charge-icons';
import styles from './charge-catalog-picker.module.css';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
type Filter = 'Todos' | 'Servicio' | 'Producto';

export function ChargeCatalogPicker({ items, selectedId, index, fallbackLabel, disabled, loading, error, onRetry, onSelect, inline = false }: {
  items: ChargeCatalogItem[]; selectedId?: string; index: number; fallbackLabel: string; disabled: boolean;
  loading: boolean; error: string; onRetry: () => void; onSelect: (item: ChargeCatalogItem | null) => void;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('Todos');
  const panelId = useId(), inputRef = useRef<HTMLInputElement>(null), triggerRef = useRef<HTMLButtonElement>(null);
  const selected = items.find(item => item.id === selectedId);
  const searchIndex = useMemo(() => open ? items.map(item => ({ item, text: normalize(`${item.name} ${item.description || ''} ${item.category || ''} ${item.sku || ''}`) })) : [], [items, open]);
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = searchIndex.filter(({ item, text }) => (filter === 'Todos' || item.itemType === filter) && words.every(word => text.includes(word))).map(({ item }) => item);
  const metadataAvailable = items.some(item => item.itemType);
  useEffect(() => { if (open && !disabled && !inline) inputRef.current?.focus(); }, [open, disabled, inline]);
  const choose = (item: ChargeCatalogItem | null) => {
    if (disabled || (item && loading)) return;
    onSelect(item); setQuery(''); setFilter('Todos');
    if (inline) inputRef.current?.focus(); else triggerRef.current?.focus();
    setOpen(false);
  };
  return <div className={styles.picker} data-booking-escape-layer={open || undefined} onKeyDown={event => { if (open && event.key === 'Escape') { event.stopPropagation(); if (inline) inputRef.current?.focus(); else triggerRef.current?.focus(); setOpen(false); } }}>
    {inline ? <div className={styles.addRow}><label className={styles.search}><span>Añadir servicio, adicional o producto</span><input ref={inputRef} type="search" aria-label="Añadir servicio o producto" aria-expanded={open} aria-controls={panelId} value={query} disabled={disabled} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} placeholder="Buscar servicio, producto o código…"/></label><button type="button" className={styles.addButton} disabled={disabled} aria-expanded={open} aria-controls={panelId} onClick={() => { inputRef.current?.focus(); setOpen(true); }}><ChargeIcon name="plus"/>Añadir</button></div> : <><span className={styles.label}>Producto o servicio del catálogo</span>
    <button ref={triggerRef} type="button" className={styles.trigger} aria-label={`Tarifa del catálogo ${index}`} aria-expanded={open} aria-controls={panelId} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <span className={`${styles.icon} ${selected?.itemType === 'Producto' ? styles.product : ''}`}><ChargeIcon name={selected?.itemType === 'Producto' ? 'grid' : 'work'}/></span>
      <span><strong>{selected?.name || (selectedId ? 'Concepto guardado del catálogo' : 'Buscar producto o servicio')}</strong><small>{selected ? [selected.itemType, selected.category, selected.sku].filter(Boolean).join(' · ') : selectedId ? 'Seleccionado en este registro' : 'Selecciona una tarifa para este concepto'}</small></span><ChargeIcon name="chevron"/>
    </button></>}
    {selected && !open ? <div className={styles.selectedInfo}>{selected.description ? <p>{selected.description}</p> : null}{selected.durationMinutes ? <span><ChargeIcon name="clock"/>{selected.durationMinutes} min por servicio</span> : null}</div> : null}
    {selectedId && !selected && !loading && !error ? <p className={styles.empty}>El artículo guardado ya no está disponible en el catálogo activo. El concepto y su precio se conservan.</p> : null}
    {open ? <section id={panelId} className={styles.panel} aria-label={`Buscar en catálogo ${index}`}>
      {!inline ? <label className={styles.search}><span>Buscar por nombre, descripción o código</span><input ref={inputRef} type="search" aria-label={`Buscar producto o servicio ${index}`} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="Ej.: deep cleaning, refrigerante, R410A…"/></label> : null}
      {metadataAvailable ? <div className={styles.filters} aria-label="Tipo de concepto">{(['Todos', 'Servicio', 'Producto'] as const).map(type => <button key={type} type="button" disabled={disabled} aria-pressed={filter === type} onClick={() => setFilter(type)}>{type === 'Todos' ? type : type === 'Servicio' ? 'Servicios' : 'Productos'}</button>)}</div> : null}
      {loading ? <p role="status" className={styles.empty}>Cargando catálogo…</p> : error ? <div role="alert" className={styles.error}>{error}<button type="button" disabled={disabled} onClick={onRetry}>Reintentar catálogo</button></div> : <>
        <div className={styles.resultCount} role="status">{matches.length} {matches.length === 1 ? 'resultado' : 'resultados'}{matches.length > 40 ? ' · Mostrando los primeros 40; precisa la búsqueda' : ''}</div>
        <div className={styles.results}>{matches.slice(0, 40).map(item => <button key={item.id} type="button" className={styles.result} disabled={disabled} aria-label={`Seleccionar ${item.name}${item.sku ? ` · ${item.sku}` : ''}`} onClick={() => choose(item)}>
          <span className={`${styles.icon} ${item.itemType === 'Producto' ? styles.product : ''}`}><ChargeIcon name={item.itemType === 'Producto' ? 'grid' : 'work'}/></span>
          <span><strong>{item.name}</strong><small className={styles.meta}>{[item.itemType, item.category, item.sku, item.durationMinutes ? `${item.durationMinutes} min` : ''].filter(Boolean).join(' · ')}</small>{item.description ? <small className={styles.description}>{item.description}</small> : null}</span><ChargeIcon name="plus"/>
        </button>)}</div>
        {!matches.length ? <p className={styles.empty}>{items.length ? 'No hay coincidencias. Prueba otro nombre o código.' : 'Todavía no hay productos o servicios activos.'}</p> : null}
      </>}
      <div className={styles.footer}>{!inline ? <button type="button" disabled={disabled} onClick={() => choose(null)}>{fallbackLabel}</button> : <button type="button" onClick={() => setOpen(false)}>Cerrar búsqueda</button>}<button type="button" disabled={disabled || loading} onClick={onRetry}>{loading ? 'Actualizando…' : 'Actualizar catálogo'}</button><a href="/catalog/" target="_blank" rel="noopener noreferrer">Abrir catálogo ↗</a></div>
    </section> : null}
  </div>;
}
