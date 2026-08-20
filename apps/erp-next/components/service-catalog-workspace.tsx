'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import {
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
} from '@/lib/service-catalog';
import type { AuthPrincipal } from '@/lib/security';
import styles from './service-catalog-workspace.module.css';

const filters = ['Todos', 'Servicio', 'Producto'] as const;
type CatalogFilter = typeof filters[number];

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'AWG', minimumFractionDigits: 2 }).format(value);
}

function formatHours(minutes: number) {
  const hours = Math.max(0, Number(minutes || 0)) / 60;
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
}

function durationLabel(item: CatalogItem) {
  const minutes = item.serviceDefinition?.duration.minutes ?? item.durationMinutes;
  if (!minutes) return 'Not configured';
  return `${formatHours(minutes)}${item.serviceDefinition ? ' per execution' : ' · legacy'}`;
}

function pricingLabel(item: CatalogItem) {
  return money(item.basePrice || 0);
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

function incomeAccountPlaceholder(type: CatalogItemType) {
  return type === 'Servicio' ? 'SERVICES' : 'SALES';
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
      return `${item.name} ${item.category} ${item.sku ?? ''} ${item.description ?? ''}`
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
    next.featured = false;
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

  const updateItemType = (itemType: CatalogItemType) => {
    setDraft((current) => ({
      ...current,
      itemType,
      featured: false,
      category: current.category === 'Servicio' || current.category === 'Producto' ? itemType : current.category,
      serviceDefinition: itemType === 'Servicio'
        ? current.serviceDefinition ?? draftFromCatalogItem().serviceDefinition
        : undefined,
    }));
  };

  const updateDurationHours = (hours: number) => {
    setDraft((current) => {
      if (!current.serviceDefinition) return current;
      const minutes = Math.round((Math.max(0, hours) * 60) / 15) * 15;
      return {
        ...current,
        serviceDefinition: {
          ...current.serviceDefinition,
          duration: { minutes },
        },
      };
    });
  };

  const save = async () => {
    if (!principal || !editable || saving) return;
    const name = draft.name.trim();
    if (!name) return setEditorError('Name is required.');
    if (draft.itemType === 'Servicio') {
      const minutes = Number(draft.serviceDefinition?.duration.minutes || 0);
      if (minutes < 30) return setEditorError('Service duration must be at least 0.5 hours.');
      if (minutes > 720) return setEditorError('Service duration cannot exceed 12 hours.');
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
          <p>DEMAC's detailed commercial catalog for prices, BTU-specific services, estimates and reporting. Appointment Scheduling has a separate operational Work Types configuration so the office can book quickly even when the exact BTU or equipment detail is not known yet.</p>
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
        <div className={styles.search}><input className={styles.input} placeholder="Search name, category, SKU or description…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
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
                <div className={styles.fact}><span>Price</span><strong>{pricingLabel(selected)}</strong></div>
                <div className={styles.fact}><span>Duration</span><strong>{catalogItemType(selected) === 'Servicio' ? durationLabel(selected) : 'Not applicable'}</strong></div>
                <div className={styles.fact}><span>Definition</span><strong>{catalogMigrationState(selected) === 'canonical' ? 'Canonical v1' : catalogMigrationState(selected) === 'legacy_service' ? 'Legacy / review required' : 'Commercial product'}</strong></div>
              </div>

              {selected.description ? <section className={styles.section}><h3>Description</h3><p>{selected.description}</p></section> : null}

              {catalogItemType(selected) === 'Servicio' && selected.serviceDefinition ? (
                <section className={styles.section}>
                  <h3>Commercial service timing</h3>
                  <p>This duration describes one execution of this detailed catalog service. New Appointment uses the separate Scheduling Work Type duration unless an exact catalog service is explicitly referenced later in the workflow.</p>
                  <div className={styles.ruleGrid}>
                    <div><span>Duration per execution</span><strong>{formatHours(selected.serviceDefinition.duration.minutes)}</strong></div>
                    <div><span>Appointment quick types</span><strong>System Settings → Appointment Work Types</strong></div>
                  </div>
                </section>
              ) : null}

              {catalogItemType(selected) === 'Producto' ? <section className={styles.section}><h3>Inventory boundary</h3><p>This record owns product identity and selling price only. On-hand, reserved and physical location stock are managed by Inventory / commercial product stock so quantities are not duplicated here.</p></section> : null}
            </div>
          ) : <div className={styles.empty}>Select or create a catalog item.</div>}
        </article>
      </section>

      {editorOpen ? (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditorOpen(false); }}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Catalog editor">
            <header className={styles.drawerHeader}>
              <div><div className={styles.eyebrow}>{editingId ? 'Edit canonical record' : 'New canonical record'}</div><h2>{editingId ? 'Edit catalog item' : 'Create catalog item'}</h2><p>Saving writes directly to the existing Firestore <code>services</code> collection. No parallel commercial catalog is created.</p></div>
              <button className={styles.close} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>×</button>
            </header>
            <div className={styles.drawerBody}>
              {editorError ? <div className={`${styles.notice} ${styles.error}`}>{editorError}</div> : null}

              <section className={styles.formSection}>
                <header><strong>Basic info</strong><span>Commercial identity shared by sales, estimates, work orders and reporting.</span></header>
                <div className={styles.grid2}>
                  <label className={styles.field}><span>Name</span><input className={styles.input} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className={styles.field}><span>Type</span><select className={styles.select} value={draft.itemType} onChange={(event) => updateItemType(event.target.value as CatalogItemType)} disabled={Boolean(editingId)}><option value="Servicio">Service</option><option value="Producto">Product</option></select><small>{editingId ? 'Type is fixed after creation to protect catalog references.' : 'Choose whether this record is a service or sellable product.'}</small></label>
                  <label className={styles.field}><span>SKU</span><input className={styles.input} value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} /></label>
                  <label className={styles.field}><span>Category</span><input className={styles.input} value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /></label>
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 9 }}><label className={styles.checkbox}><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />Active</label></div>
                {draft.itemType === 'Servicio' ? <div className={styles.notice} style={{ marginTop: 10 }}>Need this service as a fast appointment category? Configure it separately in <strong>System Settings → Appointment Work Types</strong>. Detailed BTU services remain here without cluttering Scheduling.</div> : null}
              </section>

              <section className={styles.formSection}>
                <header><strong>Sales</strong><span>For now, the catalog only needs the description and selling price. Accounting integration will be governed separately later.</span></header>
                <label className={styles.field}><span>Description</span><textarea className={styles.textarea} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <div className={styles.grid2} style={{ marginTop: 9 }}>
                  <label className={styles.field}><span>Price (AWG)</span><input className={styles.input} type="number" min="0" step="0.01" value={draft.basePrice} onChange={(event) => setDraft((current) => ({ ...current, basePrice: fieldNumber(event.target.value) }))} /><small>This is the selling price used by the catalog.</small></label>
                  <label className={styles.field}><span>Income account</span><input className={styles.input} value={incomeAccountPlaceholder(draft.itemType)} disabled /><small>Reference only for now. It is not yet connected to accounting postings or a chart of accounts.</small></label>
                </div>
              </section>

              {draft.itemType === 'Servicio' && draft.serviceDefinition ? (
                <section className={styles.formSection}>
                  <header><strong>Commercial service duration</strong><span>Enter the expected time for one execution of this detailed service. Scheduling quick categories are configured separately in System Settings.</span></header>
                  <div className={styles.grid2}>
                    <label className={styles.field}><span>Duration (hours)</span><input className={styles.input} type="number" min="0.5" max="12" step="0.25" value={Math.round((draft.serviceDefinition.duration.minutes / 60) * 100) / 100} onChange={(event) => updateDurationHours(fieldNumber(event.target.value))} /><small>Examples: 0.5 = 30 min · 1 = 60 min · 1.5 = 90 min · 2 = 120 min.</small></label>
                  </div>
                </section>
              ) : null}
            </div>
            <footer className={styles.drawerFooter}><button className={styles.button} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</button><button className={`${styles.button} ${styles.primary}`} type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save canonical item'}</button></footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
