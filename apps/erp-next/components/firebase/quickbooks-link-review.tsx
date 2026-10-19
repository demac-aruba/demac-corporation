'use client';
import { useEffect, useRef, useState } from 'react';
import { confirmCatalogLink, linkAccessLost, linkFailureMessage, prepareCatalogLink, readCatalogLinks, revokeCatalogLink } from '@/lib/firebase/quickbooks-links';
import { catalogSearchText } from '@/lib/quickbooks-catalog-scan';
import type { ErpMatchRow, QuickBooksCatalogRow } from '@/lib/quickbooks-catalog';
import type { CatalogLink, LinkEntity, PreparedLink } from '@/lib/quickbooks-links';
import styles from './quickbooks-link-review.module.css';
export function QuickBooksLinkReview({ uid, entity, source, records, initialTarget, link, changed, unavailable, close }: {
  uid: string; entity: LinkEntity; source: ErpMatchRow; records: QuickBooksCatalogRow[]; initialTarget?: string; link: CatalogLink;
  changed: (link: CatalogLink) => void; unavailable: (message: string) => void; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(false), running = useRef(false);
  const [selected, setSelected] = useState(initialTarget || ''), [search, setSearch] = useState('');
  const [prepared, setPrepared] = useState<PreparedLink | null>(null), [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<CatalogLink | null>(null);
  const [revokeReview, setRevokeReview] = useState(false), [expired, setExpired] = useState(false);
  const revokeId = useRef<string | null>(null);
  useEffect(() => { alive.current = true; dialog.current?.showModal(); return () => { alive.current = false; dialog.current?.close(); }; }, []);
  useEffect(() => { if (!prepared) { setExpired(false); return; } const check = () => setExpired(Date.parse(prepared.expiresAt) <= Date.now()); check(); const interval = setInterval(check, 1000); return () => clearInterval(interval); }, [prepared]);
  const query = catalogSearchText(search), selectedRecord = records.find(row => row.id === selected);
  const options = records.filter(row => !query || catalogSearchText([row.name, row.id, row.email, row.sku].filter(Boolean).join(' ')).includes(query));
  async function run<T>(action: () => Promise<T>, completed: (value: T) => void) {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try { const value = await action(); if (alive.current) completed(value); }
    catch (failure) { if (alive.current) { const message = linkFailureMessage(failure); setError(message); if (linkAccessLost(failure)) unavailable(message); } }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function verify() {
    if (!selectedRecord) return;
    void run(() => prepareCatalogLink(uid, entity, source, selectedRecord, Math.floor(records.indexOf(selectedRecord) / 100) * 100 + 1, link.version), value => { setPrepared(value); setAck(false); });
  }
  function saved(value: CatalogLink) { changed(value); setResult(value); }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="qbo-link-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><div><small>DEMAC ERP · QUICKBOOKS</small><h2 id="qbo-link-title">{revokeReview ? 'Desvincular registros' : 'Revisar vínculo'}</h2></div><button className="btn" disabled={busy} onClick={close} aria-label="Cerrar revisión">Cerrar</button></header>
    <p className={styles.notice}>Esta acción guarda únicamente la relación en el ERP. No modifica clientes, artículos, facturas, pagos ni existencias en QuickBooks.</p>
    {result ? <div role="status" className={styles.success}><strong>{result.status === 'confirmed' ? 'Vínculo guardado en el ERP.' : result.status === 'revoked' ? 'Vínculo desvinculado. El historial se conserva.' : 'No hay un vínculo guardado.'}</strong><p>Versión {result.version}{result.needsReview ? ' · Requiere una nueva revisión.' : ''}</p><button className="btn primary" onClick={close}>Volver a la comparación</button></div> : <>
      <div className={styles.pair}><section><h3>ERP DEMAC</h3><strong>{source.name}</strong><p>ID {source.id}</p>{source.email ? <p>{source.email}</p> : null}{source.sku ? <p>SKU {source.sku}</p> : null}{source.type ? <p>{source.type}</p> : null}</section><section><h3>QUICKBOOKS</h3>{(prepared?.target || selectedRecord) ? <><strong>{(prepared?.target || selectedRecord)!.name}</strong><p>ID {(prepared?.target || selectedRecord)!.id}</p>{(prepared?.target || selectedRecord)!.email ? <p>{(prepared?.target || selectedRecord)!.email}</p> : null}{(prepared?.target || selectedRecord)!.sku ? <p>SKU {(prepared?.target || selectedRecord)!.sku}</p> : null}<p>{(prepared?.target || selectedRecord)!.type || (prepared?.target || selectedRecord)!.currency}</p></> : <p>{link.qboId ? `Vínculo actual: ID ${link.qboId}. No observado en esta consulta.` : 'Selecciona el registro correspondiente.'}</p>}</section></div>
      {revokeReview ? <><p>Se retirará la relación con el ID {link.qboId}. Ambos registros y sus historiales permanecen intactos.</p><div className={styles.actions}><button className="btn" disabled={busy} onClick={() => setRevokeReview(false)}>Volver</button><button className="btn danger" disabled={busy} onClick={() => { revokeId.current ||= crypto.randomUUID(); void run(() => revokeCatalogLink(uid, entity, link, revokeId.current!), saved); }}>Confirmar desvinculación en ERP</button></div></> : prepared ? <>
        <p>Selección verificada a las {new Date(prepared.verifiedAt).toLocaleTimeString('es')}. Confirma antes de {new Date(prepared.expiresAt).toLocaleTimeString('es')}.</p>
        <label className={styles.ack}><input type="checkbox" checked={ack} disabled={busy || expired} onChange={event => setAck(event.target.checked)} />Confirmo que ambos registros representan el mismo {entity === 'Customer' ? 'cliente' : 'producto o servicio'}.</label>
        {expired ? <p role="alert">La verificación venció. Verifica la selección nuevamente.</p> : null}
        <div className={styles.actions}><button className="btn" disabled={busy} onClick={() => { setPrepared(null); setAck(false); }}>Cambiar selección</button><button className="btn primary" disabled={busy || !ack || expired} onClick={() => void run(() => confirmCatalogLink(uid, prepared), saved)}>Confirmar vínculo en ERP</button></div>
      </> : <>
        {link.status === 'confirmed' ? <p>Ya existe un vínculo guardado. Puedes verificar nuevamente el mismo registro o desvincularlo antes de seleccionar otro.</p> : null}
        <label className={styles.search}>Buscar registro de QuickBooks<input type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="Nombre, correo, SKU o ID" /></label>
        <div className={styles.choices} role="group" aria-label="Elegir registro de QuickBooks">{options.slice(0, 50).map(row => <button type="button" key={row.id} aria-pressed={selected === row.id} disabled={busy || !row.active || (link.status === 'confirmed' && row.id !== link.qboId)} onClick={() => setSelected(row.id)}><strong>{row.name}</strong><small>ID {row.id}{row.sku ? ` · SKU ${row.sku}` : ''}{row.type ? ` · ${row.type}` : ''}{!row.active ? ' · Inactivo' : ''}</small></button>)}</div>
        <small>{options.length > 50 ? 'Se muestran las primeras 50 opciones. Escribe parte del nombre o el ID para encontrar cualquier registro cargado.' : `${options.length} opciones en los registros recibidos.`}</small>
        <div className={styles.actions}>{link.status === 'confirmed' ? <button className="btn" disabled={busy} onClick={() => { setRevokeReview(true); setError(''); }}>Desvincular en ERP</button> : null}<button className="btn primary" disabled={busy || !selectedRecord?.active || !source.active} onClick={verify}>Verificar selección</button></div>
      </>}
      {error ? <div className={styles.error}><p role="alert">{error}</p><button className="btn" disabled={busy} onClick={() => void run(() => readCatalogLinks(uid, entity, [source.id]), rows => saved(rows[0]))}>Consultar estado del vínculo</button></div> : null}
      {busy ? <p role="status">Verificando y guardando de forma segura…</p> : null}
    </>}
  </dialog>;
}
