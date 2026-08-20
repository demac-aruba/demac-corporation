'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { invalidateOfficeBookingPresetCache } from '@/lib/office-booking-authority';
import {
  bookingCodeFromName,
  catalogItemType,
  catalogMigrationState,
  createCatalogItem,
  draftFromCatalogItem,
  listCanonicalCatalog,
  materializeCatalogDraft,
  newCatalogItemId,
  setCatalogItemActive,
  updateCatalogItem,
  type CatalogDraft,
  type CatalogItem,
  type CatalogItemType,
  type CatalogPriceTier,
  type CatalogPricingMode,
  type ServiceAllocationMode,
  type ServiceDurationMode,
} from '@/lib/service-catalog';
import type { AuthPrincipal } from '@/lib/security';
import styles from './service-catalog-workspace.module.css';

const filters = ['Todos', 'Servicio', 'Producto'] as const;
type CatalogFilter = typeof filters[number];

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'AWG', minimumFractionDigits: 2 }).format(value);
}

function durationLabel(item: CatalogItem) {
  const definition = item.serviceDefinition;
  if (!definition) return item.durationMinutes ? `${item.durationMinutes} min · legacy` : 'Not configured';
  const mode = definition.duration.mode === 'fixed' ? 'fixed' : 'per unit';
  return `${definition.duration.minutes} min · ${mode}`;
}

function pricingLabel(item: CatalogItem) {
  const pricing = item.pricingDefinition;
  if (!pricing) return money(item.basePrice || 0);
  if (pricing.mode === 'quote') return 'Quote required';
  if (pricing.mode === 'tiered_btu') return `${pricing.tiers?.length ?? 0} BTU tiers`;
  return `${money(item.basePrice || 0)} · ${pricing.mode === 'per_unit' ? 'per unit' : 'fixed'}`;
}

function canEdit(principal: AuthPrincipal | null) {
  return Boolean(principal && ['super_admin', 'operations', 'office_operator'].includes(principal.role));
}

function migrationPill(item: CatalogItem) {
  const state = catalogMigrationState(item);
  if (state === 'canonical') return <span className={`${styles.pill} ${styles.canonical}`}>Canonical</span>;
  if (state === 'legacy_service') return <span className={`${styles.pill} ${styles.legacy}`}>Needs migration</span>;
  return <span className={`${styles.pill} ${styles.product}`}>Product</span>;
}

function fieldNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function ServiceCatalogWorkspace() {
  const [principal, setPrincipal] = useState<AuthPrincipal | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('Todos');
  const [selectedId, setSelectedId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogDraft>(() => draftFromCatalogItem());
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [actor, catalog] = await Promise.all([loadFirebasePrincipal(), listCanonicalCatalog()]);
      setPrincipal(actor);
      setItems(catalog);
      setSelectedId((current) => current && catalog.some((item) => item.id === current) ? current : catalog[0]?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The service catalog could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const type = catalogItemType(item);
      if (filter !== 'Todos' && type !== filter) return false;
      if (!needle) return true;
      return `${item.name} ${item.category} ${item.sku ?? ''} ${item.description ?? ''} ${item.serviceDefinition?.bookingCode ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, items, query]);

  const selected = items.find((item) => item.id === selectedId) ?? filtered[0];
  const editable = canEdit(principal);
  const canonicalServices = items.filter((item) => catalogMigrationState(item) === 'canonical').length;
  const legacyServices = items.filter((item) => catalogMigrationState(item) === 'legacy_service').length;
  const products = items.filter((item) => catalogItemType(item) === 'Producto').length;

  const openNew = (type: CatalogItemType) => {
    const next = draftFromCatalogItem();
    next.itemType = type;
    next.category = type;
    next.featured = type === 'Servicio';
    next.serviceDefinition = type === 'Servicio' ? next.serviceDefinition : undefined;
    setDraft(next);
    setEditingId(null);
    setEditorError('');
    setEditorOpen(true);
  };

  const openEdit = (item: CatalogItem) => {
    setDraft(draftFromCatalogItem(item));
    setEditingId(item.id);
    setEditorError('');
    setEditorOpen(true);
  };

  const updateName = (name: string) => {
    setDraft((current) => {
      const previousAuto = bookingCodeFromName(current.name);
      const nextCode = bookingCodeFromName(name);
      const definition = current.serviceDefinition;
      const canReplaceCode = !editingId && definition && (!definition.bookingCode || definition.bookingCode === previousAuto);
      return {
        ...current,
        name,
        serviceDefinition: definition
          ? { ...definition, bookingCode: canReplaceCode ? nextCode : definition.bookingCode }
          : undefined,
      };
    });
  };

  const updateItemType = (itemType: CatalogItemType) => {
    setDraft((current) => ({
      ...current,
      itemType,
      featured: itemType === 'Servicio' ? current.featured : false,
      category: current.category === 'Servicio' || current.category === 'Producto' ? itemType : current.category,
      serviceDefinition: itemType === 'Servicio'
        ? current.serviceDefinition ?? draftFromCatalogItem().serviceDefinition
        : undefined,
    }));
  };

  const updateDuration = (key: 'mode' | 'minutes', value: ServiceDurationMode | number) => {
    setDraft((current) => {
      if (!current.serviceDefinition) return current;
      return {
        ...current,
        serviceDefinition: {
          ...current.serviceDefinition,
          duration: { ...current.serviceDefinition.duration, [key]: value },
        },
      };
    });
  };

  const updateAllocationMode = (mode: ServiceAllocationMode) => {
    setDraft((current) => {
      if (!current.serviceDefinition) return current;
      const existing = current.serviceDefinition.allocation;
      return {
        ...current,
        serviceDefinition: {
          ...current.serviceDefinition,
          allocation: mode === 'primary_with_support'
            ? {
              mode,
              differentPropertyDailyMaxUnits: existing.differentPropertyDailyMaxUnits ?? 6,
              primaryMaxUnits: existing.primaryMaxUnits ?? 7,
              supportSelection: 'operator',
            }
            : { mode, supportSelection: 'none' },
        },
      };
    });
  };

  const updateAllocationNumber = (key: 'differentPropertyDailyMaxUnits' | 'primaryMaxUnits', value: number) => {
    setDraft((current) => {
      if (!current.serviceDefinition) return current;
      return {
        ...current,
        serviceDefinition: {
          ...current.serviceDefinition,
          allocation: { ...current.serviceDefinition.allocation, [key]: Math.max(1, Math.round(value)) },
        },
      };
    });
  };

  const updatePricingMode = (mode: CatalogPricingMode) => {
    setDraft((current) => ({
      ...current,
      pricingDefinition: {
        version: 1,
        mode,
        currency: 'AWG',
        ...(mode === 'tiered_btu' ? { tiers: current.pricingDefinition.tiers ?? [] } : {}),
      },
    }));
  };

  const updateTier = (index: number, changes: Partial<CatalogPriceTier>) => {
    setDraft((current) => {
      const tiers = [...(current.pricingDefinition.tiers ?? [])];
      tiers[index] = { ...tiers[index], ...changes };
      return { ...current, pricingDefinition: { ...current.pricingDefinition, tiers } };
    });
  };

  const addTier = () => {
    setDraft((current) => {
      const tiers = current.pricingDefinition.tiers ?? [];
      const next: CatalogPriceTier = {
        id: `tier-${tiers.length + 1}`,
        label: `Tier ${tiers.length + 1}`,
        amount: 0,
      };
      return { ...current, pricingDefinition: { ...current.pricingDefinition, tiers: [...tiers, next] } };
    });
  };

  const removeTier = (index: number) => {
    setDraft((current) => ({
      ...current,
      pricingDefinition: {
        ...current.pricingDefinition,
        tiers: (current.pricingDefinition.tiers ?? []).filter((_, tierIndex) => tierIndex !== index),
      },
    }));
  };

  const save = async () => {
    if (!principal || !editable || saving) return;
    const name = draft.name.trim();
    if (!name) return setEditorError('Name is required.');
    if (draft.itemType === 'Servicio') {
      const definition = draft.serviceDefinition;
      if (!definition?.bookingCode.trim()) return setEditorError('Booking code is required for a service.');
      if (definition.duration.minutes < 30) return setEditorError('Service duration must be at least 30 minutes.');
      if (definition.allocation.mode === 'primary_with_support') {
        const regular = Number(definition.allocation.differentPropertyDailyMaxUnits || 0);
        const primary = Number(definition.allocation.primaryMaxUnits || 0);
        if (regular < 1 || primary < regular) return setEditorError('Primary maximum must be equal to or greater than the regular daily maximum.');
      }
    }
    if (draft.pricingDefinition.mode === 'tiered_btu' && !(draft.pricingDefinition.tiers?.length)) {
      return setEditorError('Add at least one BTU price tier or choose another pricing model.');
    }

    setSaving(true);
    setEditorError('');
    try {
      const existing = editingId ? items.find((item) => item.id === editingId) : undefined;
      const id = editingId ?? newCatalogItemId(draft.itemType);
      const item = materializeCatalogDraft({
        id,
        draft,
        existing,
        actorId: principal.userId,
        actorName: principal.displayName,
      });
      const saved = existing ? await updateCatalogItem(item) : await createCatalogItem(item);
      invalidateOfficeBookingPresetCache();
      setItems((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]
        .sort((left, right) => `${catalogItemType(left)}-${left.name}`.localeCompare(`${catalogItemType(right)}-${right.name}`)));
      setSelectedId(saved.id);
      setEditorOpen(false);
      setMessage(existing ? `${saved.name} updated in the canonical Firestore catalog.` : `${saved.name} created in the canonical Firestore catalog.`);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : 'The catalog item could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: CatalogItem) => {
    if (!principal || !editable || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await setCatalogItemActive(item.id, item.active === false, principal.userId, principal.displayName);
      invalidateOfficeBookingPresetCache();
      setItems((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      setMessage(`${saved.name} is now ${saved.active === false ? 'inactive' : 'active'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The catalog item could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.head}>
        <div>
          <div className={styles.eyebrow}>Canonical Firestore Master Data</div>
          <h1>Services & Products</h1>
          <p>One commercial catalog for DEMAC. Service price, duration and service-specific allocation rules live here; Scheduling only decides where that work fits. Product stock remains in Inventory rather than being duplicated in this record.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => void refresh()} disabled={loading || saving}>Refresh</button>
          {editable ? <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => openNew('Servicio')}>+ Service</button> : null}
          {editable ? <button className={styles.button} type="button" onClick={() => openNew('Producto')}>+ Product</button> : null}
        </div>
      </section>

      <section className={styles.summary}>
        <article><span>Total catalog</span><strong>{items.length}</strong></article>
        <article><span>Canonical services</span><strong>{canonicalServices}</strong></article>
        <article><span>Legacy services to review</span><strong>{legacyServices}</strong></article>
        <article><span>Products</span><strong>{products}</strong></article>
      </section>

      {error ? <div className={`${styles.notice} ${styles.error}`}>{error}</div> : null}
      {message ? <div className={styles.notice}>{message}</div> : null}
      {!editable && principal ? <div className={styles.notice}>You have read-only catalog access with role <strong>{principal.role}</strong>. Operations / Office or Super Admin can change canonical definitions.</div> : null}
      {legacyServices > 0 ? <div className={styles.notice}><strong>{legacyServices} legacy service{legacyServices === 1 ? '' : 's'}</strong> still have price/duration data but no canonical <code>serviceDefinition</code>. Editing and saving one in this workspace migrates it in place — no duplicate service record is created.</div> : null}

      <section className={styles.toolbar}>
        <div className={styles.search}><input className={styles.input} placeholder="Search name, category, SKU or booking code…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className={styles.filters}>{filters.map((value) => <button key={value} className={`${styles.filter} ${filter === value ? styles.filterActive : ''}`} type="button" onClick={() => setFilter(value)}>{value}</button>)}</div>
      </section>

      <section className={styles.layout}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><strong>Catalog</strong><span>{loading ? 'Loading…' : `${filtered.length} visible`}</span></header>
          <div className={styles.list}>
            {!loading && filtered.length === 0 ? <div className={styles.empty}>No catalog items match this view.</div> : null}
            {filtered.map((item) => (
              <button key={item.id} className={`${styles.row} ${selected?.id === item.id ? styles.rowActive : ''}`} type="button" onClick={() => setSelectedId(item.id)}>
                <div>
                  <div className={styles.rowTitle}><strong>{item.name}</strong>{item.active === false ? <span className={`${styles.pill} ${styles.inactive}`}>Inactive</span> : null}</div>
                  <div className={styles.rowMeta}>{catalogItemType(item)} · {item.category}{item.sku ? ` · ${item.sku}` : ''}</div>
                </div>
                <div className={styles.rowRight}><strong>{pricingLabel(item)}</strong>{migrationPill(item)}</div>
              </button>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          {selected ? (
            <div className={styles.detail}>
              <div className={styles.detailTop}>
                <div><div className={styles.eyebrow}>{catalogItemType(selected)}</div><h2>{selected.name}</h2><p>{selected.category}{selected.sku ? ` · SKU ${selected.sku}` : ''}</p></div>
                <div className={styles.detailActions}>
                  {editable ? <button className={styles.button} type="button" onClick={() => openEdit(selected)}>Edit</button> : null}
                  {editable ? <button className={`${styles.button} ${selected.active === false ? '' : styles.danger}`} type="button" disabled={saving} onClick={() => void toggleActive(selected)}>{selected.active === false ? 'Activate' : 'Deactivate'}</button> : null}
                </div>
              </div>

              <div className={styles.facts}>
                <div className={styles.fact}><span>Pricing</span><strong>{pricingLabel(selected)}</strong></div>
                <div className={styles.fact}><span>Duration</span><strong>{catalogItemType(selected) === 'Servicio' ? durationLabel(selected) : 'Not applicable'}</strong></div>
                <div className={styles.fact}><span>Definition</span><strong>{catalogMigrationState(selected) === 'canonical' ? 'Canonical v1' : catalogMigrationState(selected) === 'legacy_service' ? 'Legacy / review required' : 'Commercial product'}</strong></div>
              </div>

              {selected.description ? <section className={styles.section}><h3>Description</h3><p>{selected.description}</p></section> : null}

              {catalogItemType(selected) === 'Servicio' && selected.serviceDefinition ? (
                <section className={styles.section}>
                  <h3>Service definition</h3>
                  <p>This definition is consumed by Booking Authority. General calendar and van availability rules remain owned by Scheduling.</p>
                  <div className={styles.ruleGrid}>
                    <div><span>Booking code</span><strong>{selected.serviceDefinition.bookingCode}</strong></div>
                    <div><span>Quantity unit</span><strong>{selected.serviceDefinition.quantityUnit}</strong></div>
                    <div><span>Duration model</span><strong>{selected.serviceDefinition.duration.mode === 'fixed' ? 'Fixed per visit' : 'Per unit'} · {selected.serviceDefinition.duration.minutes} min</strong></div>
                    <div><span>Allocation</span><strong>{selected.serviceDefinition.allocation.mode === 'primary_with_support' ? 'Primary + operator-selected support' : 'Single van'}</strong></div>
                    {selected.serviceDefinition.allocation.mode === 'primary_with_support' ? <div><span>Regular daily max</span><strong>{selected.serviceDefinition.allocation.differentPropertyDailyMaxUnits}</strong></div> : null}
                    {selected.serviceDefinition.allocation.mode === 'primary_with_support' ? <div><span>Primary van max</span><strong>{selected.serviceDefinition.allocation.primaryMaxUnits}</strong></div> : null}
                  </div>
                </section>
              ) : null}

              {selected.pricingDefinition?.mode === 'tiered_btu' ? (
                <section className={styles.section}>
                  <h3>BTU pricing</h3>
                  <div className={styles.tierTable}>{(selected.pricingDefinition.tiers ?? []).map((tier) => <div key={tier.id} className={styles.tierRow}><span>{tier.label}</span><span>{tier.minBtu ? `${tier.minBtu.toLocaleString()} min` : '—'}</span><span>{tier.maxBtu ? `${tier.maxBtu.toLocaleString()} max` : '—'}</span><strong>{money(tier.amount)}</strong></div>)}</div>
                </section>
              ) : null}

              {catalogItemType(selected) === 'Producto' ? <section className={styles.section}><h3>Inventory boundary</h3><p>This record owns product identity and commercial pricing only. On-hand, reserved and physical location stock are managed by Inventory / commercial product stock so quantities are not duplicated here.</p></section> : null}
            </div>
          ) : <div className={styles.empty}>Select or create a catalog item.</div>}
        </article>
      </section>

      {editorOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditorOpen(false); }}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Catalog editor">
            <header className={styles.drawerHeader}>
              <div><div className={styles.eyebrow}>{editingId ? 'Edit canonical record' : 'New canonical record'}</div><h2>{editingId ? 'Edit catalog item' : 'Create catalog item'}</h2><p>Saving writes directly to the existing Firestore <code>services</code> collection. No parallel catalog is created.</p></div>
              <button className={styles.close} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>×</button>
            </header>
            <div className={styles.drawerBody}>
              {editorError ? <div className={`${styles.notice} ${styles.error}`}>{editorError}</div> : null}

              <section className={styles.formSection}>
                <header><strong>Identity</strong><span>Commercial identity shared by sales, booking and work orders.</span></header>
                <div className={styles.grid2}>
                  <label className={styles.field}><span>Type</span><select className={styles.select} value={draft.itemType} onChange={(event) => updateItemType(event.target.value as CatalogItemType)}><option value="Servicio">Service</option><option value="Producto">Product</option></select></label>
                  <label className={styles.field}><span>Name</span><input className={styles.input} value={draft.name} onChange={(event) => updateName(event.target.value)} /></label>
                  <label className={styles.field}><span>Category</span><input className={styles.input} value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /></label>
                  <label className={styles.field}><span>SKU / Code</span><input className={styles.input} value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} /></label>
                </div>
                <label className={styles.field} style={{ marginTop: 9 }}><span>Description</span><textarea className={styles.textarea} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <div style={{ display: 'flex', gap: 18, marginTop: 9 }}><label className={styles.checkbox}><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />Active</label>{draft.itemType === 'Servicio' ? <label className={styles.checkbox}><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft((current) => ({ ...current, featured: event.target.checked }))} />Common booking service</label> : null}</div>
              </section>

              <section className={styles.formSection}>
                <header><strong>Pricing</strong><span>The price model belongs to the catalog. Inventory quantities do not.</span></header>
                <div className={styles.grid2}>
                  <label className={styles.field}><span>Pricing model</span><select className={styles.select} value={draft.pricingDefinition.mode} onChange={(event) => updatePricingMode(event.target.value as CatalogPricingMode)}><option value="fixed">Fixed</option><option value="per_unit">Per unit</option><option value="tiered_btu">BTU tiers</option><option value="quote">Quote required</option></select></label>
                  <label className={styles.field}><span>Base / reference price (AWG)</span><input className={styles.input} type="number" min="0" step="0.01" value={draft.basePrice} onChange={(event) => setDraft((current) => ({ ...current, basePrice: fieldNumber(event.target.value) }))} /><small>Keep a reference price even when detailed BTU tiers are used.</small></label>
                </div>
                {draft.pricingDefinition.mode === 'tiered_btu' ? <div className={styles.tierEditor} style={{ marginTop: 10 }}>
                  {(draft.pricingDefinition.tiers ?? []).map((tier, index) => <div className={styles.tierEditorRow} key={`${tier.id}-${index}`}>
                    <label className={styles.field}><span>Label</span><input className={styles.input} value={tier.label} onChange={(event) => updateTier(index, { label: event.target.value })} /></label>
                    <label className={styles.field}><span>Min BTU</span><input className={styles.input} type="number" min="0" value={tier.minBtu ?? ''} onChange={(event) => updateTier(index, { minBtu: event.target.value ? fieldNumber(event.target.value) : undefined })} /></label>
                    <label className={styles.field}><span>Max BTU</span><input className={styles.input} type="number" min="0" value={tier.maxBtu ?? ''} onChange={(event) => updateTier(index, { maxBtu: event.target.value ? fieldNumber(event.target.value) : undefined })} /></label>
                    <label className={styles.field}><span>AWG</span><input className={styles.input} type="number" min="0" step="0.01" value={tier.amount} onChange={(event) => updateTier(index, { amount: fieldNumber(event.target.value) })} /></label>
                    <button className={styles.remove} type="button" onClick={() => removeTier(index)}>×</button>
                  </div>)}
                  <div><button className={styles.button} type="button" onClick={addTier}>+ Add BTU tier</button></div>
                </div> : null}
              </section>

              {draft.itemType === 'Servicio' && draft.serviceDefinition ? <>
                <section className={styles.formSection}>
                  <header><strong>Service duration</strong><span>This describes how long the service itself requires. The agenda does not keep a second duration copy.</span></header>
                  <div className={styles.grid3}>
                    <label className={styles.field}><span>Booking code</span><input className={styles.input} value={draft.serviceDefinition.bookingCode} onChange={(event) => setDraft((current) => current.serviceDefinition ? ({ ...current, serviceDefinition: { ...current.serviceDefinition, bookingCode: bookingCodeFromName(event.target.value) } }) : current)} /><small>Stable machine code used by Booking Authority.</small></label>
                    <label className={styles.field}><span>Duration model</span><select className={styles.select} value={draft.serviceDefinition.duration.mode} onChange={(event) => updateDuration('mode', event.target.value as ServiceDurationMode)}><option value="per_unit">Per unit</option><option value="fixed">Fixed per visit</option></select></label>
                    <label className={styles.field}><span>Minutes</span><input className={styles.input} type="number" min="30" max="720" step="15" value={draft.serviceDefinition.duration.minutes} onChange={(event) => updateDuration('minutes', fieldNumber(event.target.value))} /></label>
                    <label className={styles.field}><span>Quantity unit</span><input className={styles.input} value={draft.serviceDefinition.quantityUnit} onChange={(event) => setDraft((current) => current.serviceDefinition ? ({ ...current, serviceDefinition: { ...current.serviceDefinition, quantityUnit: event.target.value } }) : current)} /><small>Example: ac_unit, visit, installation.</small></label>
                  </div>
                </section>

                <section className={styles.formSection}>
                  <header><strong>Service allocation policy</strong><span>Service-specific resource requirement only. Workday, van availability, conflicts, closures and staff remain Scheduling rules.</span></header>
                  <div className={styles.grid2}>
                    <label className={styles.field}><span>Allocation</span><select className={styles.select} value={draft.serviceDefinition.allocation.mode} onChange={(event) => updateAllocationMode(event.target.value as ServiceAllocationMode)}><option value="single_van">Single van</option><option value="primary_with_support">Primary van + support when threshold exceeded</option></select></label>
                    {draft.serviceDefinition.allocation.mode === 'primary_with_support' ? <label className={styles.field}><span>Support selection</span><input className={styles.input} value="Operator chooses van + arrival time" disabled /><small>Booking Authority validates the operator's choice against live capacity.</small></label> : null}
                    {draft.serviceDefinition.allocation.mode === 'primary_with_support' ? <label className={styles.field}><span>Regular daily max units</span><input className={styles.input} type="number" min="1" max="24" value={draft.serviceDefinition.allocation.differentPropertyDailyMaxUnits ?? 6} onChange={(event) => updateAllocationNumber('differentPropertyDailyMaxUnits', fieldNumber(event.target.value))} /><small>Example Standard Service: 6 individual services in a normal van schedule.</small></label> : null}
                    {draft.serviceDefinition.allocation.mode === 'primary_with_support' ? <label className={styles.field}><span>Primary van max at one property</span><input className={styles.input} type="number" min="1" max="48" value={draft.serviceDefinition.allocation.primaryMaxUnits ?? 7} onChange={(event) => updateAllocationNumber('primaryMaxUnits', fieldNumber(event.target.value))} /><small>Above this number, support is required. No separate 8–10 or 11+ hard-coded rule.</small></label> : null}
                  </div>
                </section>
              </> : null}
            </div>
            <footer className={styles.drawerFooter}><button className={styles.button} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</button><button className={`${styles.button} ${styles.primary}`} type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save canonical item'}</button></footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
