'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { catalogFailureMessage, readErpComparisonRows, readProductionCatalog } from '@/lib/firebase/quickbooks-catalog';
import { catalogSearchText, comparisonRows, scanCatalogs, type CatalogCollection, type ComparisonRow } from '@/lib/quickbooks-catalog-scan';
import type { CatalogEntity, QuickBooksCatalogRow } from '@/lib/quickbooks-catalog';
import styles from './quickbooks-catalog.module.css';
const labels = { Customer: 'Clientes', Item: 'Productos y servicios', Account: 'Cuentas contables' };
const entities: CatalogEntity[] = ['Customer', 'Item', 'Account'];
type Filter = 'all' | 'matches' | 'pending' | 'ambiguous' | 'inactive';
const filters: Array<{ id: Filter; label: string }> = [{ id: 'all', label: 'Todos' }, { id: 'matches', label: 'Con coincidencia' }, { id: 'pending', label: 'Sin coincidencia sugerida' }, { id: 'ambiguous', label: 'Varias coincidencias' }, { id: 'inactive', label: 'Inactivos' }];
const matchesFilter = (row: ComparisonRow, filter: Filter) => filter === 'all' || (filter === 'matches' ? Boolean(row.source && row.candidates.length) : filter === 'pending' ? row.status === 'not-seen' || row.status === 'qbo-only' : filter === 'inactive' ? row.source?.active === false || row.candidates.some(candidate => !candidate.active) : row.status === filter);
function ProviderRecord({ row, entity }: { row: QuickBooksCatalogRow; entity: CatalogEntity }) {
  return <div className={styles.record}><strong>{row.name}</strong><div className={styles.details}><span>ID {row.id}</span>{!row.active ? <span className={styles.inactive}>Inactivo</span> : null}{row.type ? <span>{row.type}</span> : null}{row.currency ? <span>{row.currency}</span> : null}</div>
    {entity === 'Customer' && row.email ? <small>{row.email}</small> : null}{row.sku ? <small>SKU: {row.sku}</small> : null}{row.parentId || row.isJob ? <small>Subcliente / proyecto · revisar identidad</small> : null}
    {entity === 'Item' && row.incomeAccountId ? <small>Cuenta de ingreso: {row.incomeAccountId}</small> : null}{row.subType ? <small>{row.subType}</small> : null}</div>;
}
function ComparisonRecord({ row, entity, complete }: { row: ComparisonRow; entity: CatalogEntity; complete: boolean }) {
  const mismatch = row.source?.type && row.candidates.some(candidate => row.source!.type === 'Servicio' ? candidate.type !== 'Service' : candidate.type === 'Service');
  const pending = !row.source || !row.candidates.length;
  const title = row.status === 'ambiguous' ? 'Varias coincidencias' : row.status === 'inactive' ? 'Registro inactivo' : pending ? 'Por revisar' : 'Posible coincidencia';
  return <div className={styles.row} role="row">
    {entity !== 'Account' ? <div role="cell" className={styles.cell}><span className={styles.mobileLabel}>ERP DEMAC</span>{row.source ? <div className={styles.record}><strong>{row.source.name}</strong><div className={styles.details}><span>ID {row.source.id}</span>{row.source.type ? <span>{row.source.type}</span> : null}{!row.source.active ? <span className={styles.inactive}>Inactivo</span> : null}</div>{row.source.email ? <small>{row.source.email}</small> : null}{row.source.sku ? <small>SKU: {row.source.sku}</small> : null}</div> : <span className={styles.muted}>Sin coincidencia sugerida en el ERP</span>}</div> : null}
    <div role="cell" className={styles.cell}><span className={styles.mobileLabel}>QuickBooks</span>{row.candidates.length ? row.candidates.map(candidate => <ProviderRecord key={candidate.id} row={candidate} entity={entity} />) : <span className={styles.muted}>{complete ? 'Sin coincidencia por nombre, correo o SKU' : 'Sin coincidencia en los registros recibidos todavía'}</span>}</div>
    <div role="cell" className={styles.cell}><span className={styles.mobileLabel}>Revisión</span>{entity === 'Account' ? <><span className={`${styles.badge} ${row.candidates[0]?.active ? styles.neutral : styles.warning}`}>{row.candidates[0]?.active ? 'Activa' : 'Inactiva'}</span><small>Cuenta existente en QuickBooks</small></> : <><span className={`${styles.badge} ${row.status === 'ambiguous' || mismatch ? styles.warning : row.status === 'review' ? styles.positive : styles.neutral}`}>{title}</span><small>{mismatch ? 'Los tipos de artículo difieren. Revisar antes de vincular.' : row.status === 'ambiguous' ? 'Revisar cuál corresponde. No se ha vinculado.' : pending ? 'Esto no confirma que el registro falte.' : 'Identidad pendiente de confirmar. Sin vínculo guardado.'}</small></>}</div>
  </div>;
}
export function QuickBooksCatalog({ uid }: { uid: string }) {
  const [entity, setEntity] = useState<CatalogEntity>('Customer');
  const [snapshot, setSnapshot] = useState<{ owner: string; values: Partial<Record<CatalogEntity, CatalogCollection>> }>({ owner: uid, values: {} });
  const [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false), [stopped, setStopped] = useState(false);
  const [loadingEntity, setLoadingEntity] = useState<CatalogEntity | null>(null), [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<Filter>('all'), [kind, setKind] = useState('all');
  const [visibleCount, setVisibleCount] = useState(100); const sentinel = useRef<HTMLDivElement>(null);
  const actor = useRef(uid); actor.current = uid; const mounted = useRef(false);
  const job = useRef<{ uid: string; cancelled: boolean } | null>(null);
  useEffect(() => { mounted.current = true; setSnapshot({ owner: uid, values: {} }); setError(null); setBusy(false); setStopping(false); setStopped(false); setLoadingEntity(null); setSearch('');
    return () => { mounted.current = false; if (job.current) job.current.cancelled = true; job.current = null; }; }, [uid]);
  const values = snapshot.owner === uid ? snapshot.values : {};
  const collection = values[entity]; const query = catalogSearchText(useDeferredValue(search));
  const rows = useMemo(() => comparisonRows(entity, collection), [entity, collection]);
  const counts = useMemo(() => Object.fromEntries(filters.map(f => [f.id, rows.filter(row => matchesFilter(row, f.id)).length])), [rows]);
  const filtered = useMemo(() => rows.filter(row => (!query || row.search.includes(query)) && matchesFilter(row, filter) && (entity !== 'Item' || kind === 'all' || (row.source?.type || (row.candidates[0]?.type === 'Service' ? 'Servicio' : ['Inventory', 'NonInventory'].includes(row.candidates[0]?.type || '') ? 'Producto' : 'Otro')) === kind)), [rows, query, filter, kind, entity]);
  useEffect(() => { setVisibleCount(100); }, [entity, query, filter, kind]);
  useEffect(() => {
    if (!sentinel.current || visibleCount >= filtered.length) return;
    if (!('IntersectionObserver' in window)) { setVisibleCount(filtered.length); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisibleCount(count => Math.min(filtered.length, count + 100)); }, { rootMargin: '900px' });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [visibleCount, filtered.length, entity, query, filter, kind]);
  async function load() {
    if (job.current) return;
    const task = { uid, cancelled: false }; job.current = task;
    const live = () => mounted.current && actor.current === uid && job.current === task;
    const current = () => live() && !task.cancelled;
    setBusy(true); setStopping(false); setStopped(false); setError(null); setSnapshot({ owner: uid, values: {} });
    try { await scanCatalogs({ entities: [entity, ...entities.filter(value => value !== entity)], current,
      readPage: input => readProductionCatalog(uid, input), readErp: value => readErpComparisonRows(uid, value), started: value => { if (current()) setLoadingEntity(value); },
      progress: value => { if (current()) setSnapshot(previous => ({ owner: uid, values: { ...(previous.owner === uid ? previous.values : {}), [value.entity]: value } })); },
    }); } catch (failure) { if (live()) { setSnapshot({ owner: uid, values: {} }); setError(catalogFailureMessage(failure)); } }
    finally { if (live()) { setBusy(false); setStopping(false); setStopped(task.cancelled); setLoadingEntity(null); job.current = null; } }
  }
  const received = Object.values(values).reduce((sum, value) => sum + value.records.length, 0), done = entities.every(value => values[value]?.complete);
  return <section className={styles.workspace} aria-label="Comparación de catálogos">
    <div className={styles.intro}><div><h2>Preparar emparejamiento</h2><p>Clientes y artículos de ambos sistemas, juntos en una sola lista. Revisa las coincidencias antes de crear vínculos.</p></div><div className={styles.actions}>
      <button className="btn primary" disabled={busy} onClick={() => void load()}>{busy ? 'Cargando catálogos…' : received || done ? 'Actualizar catálogos' : 'Cargar catálogos'}</button>
      {busy ? <button className="btn" disabled={stopping} onClick={() => { if (job.current) job.current.cancelled = true; setStopping(true); }}>{stopping ? 'Deteniendo…' : 'Detener carga'}</button> : null}</div></div>
    <div className={styles.notice}><span className={styles.dot} /><span>Solo consulta · No se crean registros ni se envían facturas o pagos.</span></div>
    <div className={styles.tabs} role="group" aria-label="Catálogo para comparar">{entities.map(value => <button key={value} aria-pressed={entity === value} onClick={() => { setEntity(value); setFilter('all'); setKind('all'); }}>{labels[value]}{values[value] ? <span>{values[value]!.records.length}{values[value]!.complete ? '' : '+'}</span> : null}</button>)}</div>
    <div className={styles.progress} role="status">{busy ? `${stopping ? 'Terminando la consulta actual' : `Consultando ${labels[loadingEntity || entity].toLocaleLowerCase('es')}`} · ${received} registros recibidos. Puedes buscar y revisar mientras continúa la carga.` : error ? 'Consulta interrumpida. Vuelve a cargar después de resolver el aviso.' : done ? 'Catálogos consultados. Puedes recorrer toda la lista sin cambiar de página.' : stopped ? 'Carga detenida. Los resultados recibidos son parciales.' : received ? 'Consulta parcial: se alcanzó el límite disponible. Los resultados requieren revisión.' : 'Una sola carga reúne clientes, productos, servicios y cuentas contables.'}</div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.stats}><div><span>{entity === 'Account' ? 'Empresa' : 'Registros del ERP'}</span><strong>{entity === 'Account' ? collection?.companyName || 'DEMAC' : collection ? collection.source.length : '—'}</strong></div><div><span>Registros de QuickBooks</span><strong>{collection ? collection.records.length : '—'}</strong></div><div><span>{entity === 'Account' ? 'Cuentas activas' : 'Con coincidencia sugerida'}</span><strong>{collection ? entity === 'Account' ? collection.records.filter(row => row.active).length : counts.matches : '—'}</strong></div><div><span>Estado de la consulta</span><strong className={styles.stateValue}>{collection?.complete ? 'Consultado' : collection ? 'Parcial' : busy ? 'En curso' : 'Sin cargar'}</strong></div></div>
    <div className={styles.toolbar}><label className={styles.search}><span>Buscar en ambos sistemas</span><input type="search" aria-label="Buscar en ambos sistemas" placeholder="Nombre, correo, SKU o ID…" value={search} onChange={event => setSearch(event.target.value)} /></label>{entity === 'Item' ? <label><span>Tipo de artículo</span><select aria-label="Tipo de artículo" value={kind} onChange={event => setKind(event.target.value)}><option value="all">Productos y servicios</option><option value="Servicio">Servicios</option><option value="Producto">Productos</option></select></label> : null}
      <div className={styles.filters} role="group" aria-label="Filtrar comparación">{filters.filter(value => entity !== 'Account' || ['all', 'inactive'].includes(value.id)).map(value => <button key={value.id} aria-pressed={filter === value.id} onClick={() => setFilter(value.id)}>{value.label} <span>{counts[value.id]}</span></button>)}</div></div>
    {collection ? <p className={styles.caption}>{collection.companyName} · {filtered.length} resultados{query ? ' para tu búsqueda' : ''} · Última lectura: {new Date(collection.fetchedAt).toLocaleString('es')}{!collection.complete ? ' · La carga de este catálogo está incompleta.' : ''}</p> : null}
    {collection ? <div className={`${styles.table} ${entity === 'Account' ? styles.accounts : ''}`} role="table" aria-label={entity === 'Account' ? 'Cuentas de QuickBooks' : 'Comparación provisional'} aria-rowcount={filtered.length + 1}><div role="row" className={styles.tableHead}>{entity !== 'Account' ? <span role="columnheader">ERP DEMAC</span> : null}<span role="columnheader">QUICKBOOKS</span><span role="columnheader">REVISIÓN</span></div>{filtered.slice(0, visibleCount).map(row => <ComparisonRecord key={row.key} row={row} entity={entity} complete={collection.complete} />)}</div> : <div className={styles.empty}><strong>{busy ? `Preparando ${labels[entity].toLocaleLowerCase('es')}…` : 'Compara los registros existentes'}</strong><p>{busy ? 'Los resultados aparecerán aquí conforme se reciban.' : 'Pulsa «Cargar catálogos». Después podrás buscar y cambiar entre clientes y artículos sin volver a consultarlos.'}</p></div>}
    {collection && !filtered.length ? <div className={styles.empty}><strong>No hay resultados con estos filtros.</strong><p>{!collection.complete ? 'La consulta está incompleta; puede haber coincidencias en los registros pendientes.' : 'Prueba con parte del nombre, el correo o el SKU. No tener coincidencia sugerida no confirma que el registro no exista.'}</p></div> : null}
    <div ref={sentinel} className={styles.end}>{filtered.length > visibleCount ? `Mostrando ${Math.min(visibleCount, filtered.length)} de ${filtered.length}. La lista continúa al bajar.` : collection ? `${filtered.length} resultados mostrados` : ''}</div>
    <p className={styles.footnote}>Las coincidencias por nombre, correo o SKU son orientativas. No hay vínculos guardados. Las lecturas pueden reflejar cambios ocurridos durante la consulta; impuestos, cuentas de cobro, precios y existencias aún requieren revisión.</p>
  </section>;
}
