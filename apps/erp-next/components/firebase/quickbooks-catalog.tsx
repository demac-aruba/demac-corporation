'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { catalogFailureMessage, readErpComparisonRows, readProductionCatalog } from '@/lib/firebase/quickbooks-catalog';
import { suggestCatalogMatches, type CatalogEntity, type CatalogResult, type ErpMatchRow } from '@/lib/quickbooks-catalog';
import styles from './quickbooks-production-reports.module.css';
const labels = { Customer: 'Clientes', Item: 'Productos y servicios', Account: 'Cuentas contables' };
export function QuickBooksCatalog({ uid }: { uid: string }) {
  const [entity, setEntity] = useState<CatalogEntity>('Customer');
  const [result, setResult] = useState<{ owner: string; data: CatalogResult; source: ErpMatchRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const epoch = useRef(0); const lock = useRef(false);
  const actor = useRef(uid); actor.current = uid;
  useEffect(() => { epoch.current += 1; lock.current = false; setResult(null); setError(null); setBusy(false);
    return () => { epoch.current += 1; }; }, [uid]);
  async function consult(startPosition = 1) {
    if (lock.current) return;
    lock.current = true; const generation = ++epoch.current;
    const current = () => epoch.current === generation && actor.current === uid;
    setBusy(true); setError(null); setResult(null);
    try {
      // Provider authorization completes before any extra ERP reads. Neither call writes domain records.
      const data = await readProductionCatalog(uid, { entity, startPosition });
      if (!current()) return;
      const source = await readErpComparisonRows(uid, entity);
      if (current()) setResult({ owner: uid, data, source });
    } catch (failure) { if (current()) setError(catalogFailureMessage(failure)); }
    finally { if (current()) { lock.current = false; setBusy(false); } }
  }
  const snapshot = result?.owner === uid && result.data.request.entity === entity ? result : null;
  const data = snapshot?.data; const query = search.trim().toLocaleLowerCase('es');
  const matches = useMemo(() => snapshot ? suggestCatalogMatches(entity, snapshot.source, snapshot.data.catalog.records) : [], [entity, snapshot]);
  const suggestions = matches.filter(row => !query || `${row.source.name} ${row.source.id}`.toLocaleLowerCase('es').includes(query));
  const rows = data?.catalog.records.filter(row => !query || `${row.name} ${row.id} ${row.sku || ''}`.toLocaleLowerCase('es').includes(query)) || [];
  return <section className={styles.reports} aria-label="Preparación del emparejamiento" aria-busy={busy}>
    <h2>Preparar emparejamiento</h2>
    <p>Compara los registros existentes antes de vincularlos. Las coincidencias son propuestas para revisar; todavía no se guardan vínculos ni se crean registros.</p>
    <form onSubmit={event => { event.preventDefault(); void consult(); }}>
      <label>Catálogo<select aria-label="Catálogo para comparar" value={entity} disabled={busy} onChange={event => {
        epoch.current += 1; setEntity(event.target.value as CatalogEntity); setResult(null); setError(null); setSearch('');
      }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="btn primary" disabled={busy} type="submit">{busy ? 'Consultando catálogos…' : 'Consultar para comparar'}</button>
    </form>
    {busy ? <p role="status">Consultando la página de QuickBooks y los registros del ERP…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {data ? <div>
      <p><strong>{data.companyName}</strong> · Consultado: <time dateTime={data.fetchedAt}>{new Date(data.fetchedAt).toLocaleString('es')}</time></p>
      <p>Esta página comienza en la posición {data.request.startPosition} e incluye {data.catalog.records.length} registros, activos e inactivos.
        {' '}{data.catalog.atLimit ? 'Se alcanzó el límite de consulta: la revisión está incompleta.' : data.catalog.nextStartPosition ? 'Hay que consultar la siguiente página para continuar la revisión.' : 'Fin de esta consulta.'}
        {' '}Una página sin coincidencias no demuestra que falte un cliente o artículo. Los registros pueden cambiar entre consultas.</p>
      <label>Filtrar registros mostrados<input aria-label="Filtrar registros mostrados" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {entity !== 'Account' ? <div className={styles.tableScroll} role="region" aria-label="Comparación provisional" tabIndex={0}>
        <table><caption>ERP frente a esta página de QuickBooks · vínculos pendientes</caption>
          <thead><tr><th>Registro del ERP</th><th>Posibles coincidencias en QuickBooks</th><th>Revisión</th></tr></thead>
          <tbody>{suggestions.slice(0, 100).map(row => <tr key={row.source.id}><td>{row.source.name}<br /><small>{row.source.id} {row.source.type}</small></td>
            <td>{row.candidates.length ? row.candidates.map(candidate => <div key={candidate.id}>{candidate.name} · ID {candidate.id}
              <br /><small>{candidate.active ? 'Activo' : 'Inactivo'} · {candidate.type || candidate.currency || 'Moneda no informada'}{candidate.parentId || candidate.isJob ? ' · Subcliente / proyecto: revisar' : ''}</small></div>) : 'Sin coincidencia en esta página'}</td>
            <td>{row.status === 'inactive' ? 'Inactivo en ERP' : row.status === 'ambiguous' ? 'Varias coincidencias: revisar' : row.status === 'review' ? 'Posible coincidencia: confirmar identidad y configuración' : 'Revisión pendiente'}</td></tr>)}</tbody>
        </table>{suggestions.length > 100 ? <p>Se muestran 100 de {suggestions.length} registros del ERP. Filtra por nombre o ID para revisar los demás.</p> : null}
        {!suggestions.length ? <p>No hay registros del ERP que mostrar con este filtro.</p> : null}
      </div> : null}
      <div className={styles.tableScroll} role="region" aria-label="Catálogo de QuickBooks" tabIndex={0}>
        <table><caption>{labels[entity]} existentes en QuickBooks</caption><thead><tr><th>Nombre / ID</th><th>Estado</th><th>Configuración</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}<br /><small>{row.id}</small></td><td>{row.active ? 'Activo' : 'Inactivo'}</td>
            <td>{row.type || row.currency || 'Moneda no informada'}{row.sku ? ` · SKU ${row.sku}` : ''}{row.email ? <><br />{row.email}</> : null}
              {row.incomeAccountId ? <><br />Cuenta de ingreso: {row.incomeAccountId}</> : null}{row.subType ? <><br />{row.subType}</> : null}</td></tr>)}</tbody></table>
        {!rows.length ? <p>No hay registros en esta página con el filtro indicado.</p> : null}
      </div>
      <p><button className="btn" disabled={busy || data.request.startPosition === 1} onClick={() => void consult(data.request.startPosition - 100)}>Página anterior</button>{' '}
        <button className="btn" disabled={busy || data.catalog.nextStartPosition === null} onClick={() => void consult(data.catalog.nextStartPosition!)}>Página siguiente</button></p>
      <p className={styles.hint}>No se han verificado impuestos, cuentas de cobro ni existencias. La sincronización de facturas y pagos continúa desactivada.</p>
    </div> : null}
  </section>;
}
