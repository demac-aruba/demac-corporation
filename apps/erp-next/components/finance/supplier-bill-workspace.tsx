'use client';
import { useEffect, useRef, useState } from 'react';
import { supplierBillGateway } from '../../lib/firebase/supplier-bill-drafts';
import { newSupplierDraftId } from '../../lib/supplier-bill-recovery';
import type { BillDraft } from '../../lib/supplier-bill-draft';
import type { SaveSupplierDraft, SupplierBillGateway, SupplierDraftHistory, SupplierDraftRecord, SupplierDraftSummary } from '../../lib/supplier-bill-records';
import { SupplierBillEditor } from './supplier-bill-editor';
import s from './supplier-bill-editor.module.css';

export function SupplierBillWorkspace({ close, gateway = supplierBillGateway }: { close: () => void; gateway?: SupplierBillGateway }) {
  const [rows, setRows] = useState<SupplierDraftSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [record, setRecord] = useState<SupplierDraftRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<SaveSupplierDraft[]>([]);
  const [history, setHistory] = useState<SupplierDraftHistory[]>([]);
  const [historyNext, setHistoryNext] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const alive = useRef(true), inFlight = useRef(false);
  const draftId = useRef('');
  async function refresh(after: string | null = null) {
    const [result, waiting] = await Promise.all([gateway.list(after), gateway.pending()]);
    if (!alive.current) return;
    setRows(current => after ? [...current, ...result.rows] : result.rows); setNext(result.next); setPending(waiting); setRecoveryError(false); setCanWrite(result.canWrite);
  }
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const status = await gateway.status();
        if (!alive.current) return;
        setEnabled(status.enabled); setCanWrite(status.canWrite);
        const waiting = await gateway.pending();
        if (!alive.current) return;
        setPending(waiting); setRecoveryError(false);
        if (status.enabled) await refresh();
        else setMessage('El guardado compartido está pendiente de activación. Puedes seguir preparando borradores en archivo.');
      } catch (error) { if (alive.current) { setRecoveryError(true); setMessage(error instanceof Error ? error.message : 'No se pudo cargar Compras.'); } }
      finally { if (alive.current) setBusy(false); }
    })();
    return () => { alive.current = false; };
  }, [gateway]); // A stable gateway belongs to one authenticated ERP surface.

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await work(); }
    catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'No se pudo comprobar la operación.'); }
    finally {
      try { const waiting = await gateway.pending(); if (alive.current) { setPending(waiting); setRecoveryError(false); } }
      catch { if (alive.current) { setRecoveryError(true); setMessage('No se pudo revisar la recuperación local. No envíes otra copia hasta resolverlo.'); } }
      if (alive.current) setBusy(false); inFlight.current = false;
    }
  }
  async function open(id: string) {
    const [result, changes] = await Promise.all([gateway.read(id), gateway.history(id, null)]);
    if (!alive.current) return;
    setRecord(result.record); draftId.current = id; setCanWrite(result.canWrite);
    setHistory(changes.rows); setHistoryNext(changes.next); setReason(''); setEditing(true); setConflictId(null); setMessage('');
  }
  async function send(command: SaveSupplierDraft) {
    const result = await gateway.save(command);
    if (!alive.current) return;
    if (!result.accepted) {
      setConflictId(result.conflictId);
      setMessage(result.code === 'draft-version-conflict' ? 'Otro usuario guardó una versión más reciente. Tu edición sigue abierta. Descárgala antes de abrir la versión guardada.' : 'Ya hay un borrador con ese proveedor y número. Tu edición sigue abierta para revisarla.');
      return;
    }
    await open(result.id);
    if (alive.current) setMessage(`Guardado confirmado · versión ${result.version}.`);
    await refresh();
  }
  const notices = <>
    {message && <p role="status" className={s.status}>{message}</p>}
    {pending.length > 0 && <section className={s.recovery} aria-label="Guardados pendientes"><b>Guardado pendiente de comprobación</b><p>Recupera la misma solicitud antes de iniciar otra.</p>{pending.map(command => <div key={command.requestId}><span>{command.draft.supplier} · {command.draft.invoiceNumber}</span><button disabled={busy || !enabled || !canWrite} onClick={() => void run(() => send(command))}>Comprobar guardado</button></div>)}</section>}
    {conflictId && <button disabled={busy} onClick={() => { if (window.confirm('¿Abrir la versión guardada? Descarga primero tu edición si deseas conservarla.')) void run(() => open(conflictId)); }}>Abrir versión guardada</button>}
  </>;
  if (editing) return <div>
    <div className={s.page}>{notices}
      {record && <div className={s.panel + ' ' + s.body}><b>Compartido · versión {record.version}</b><p>Pendiente de vincular al catálogo, recibir mercancía y enviar a QuickBooks.</p>
        <label className={s.field}>Motivo del cambio<input maxLength={500} value={reason} disabled={busy || pending.length > 0 || !canWrite} onChange={event => setReason(event.target.value)} /></label>
        <details><summary>Historial de versiones</summary>{history.map(entry => <p key={entry.version}>v{entry.version} · {new Date(entry.at).toLocaleString('es', { timeZone: 'America/Aruba' })} · {entry.actor.name} · {entry.reason || 'Primer guardado'}</p>)}
          {historyNext !== null && <button disabled={busy} onClick={() => void run(async () => { const result = await gateway.history(record.id, historyNext); if (alive.current) { setHistory(current => [...current, ...result.rows]); setHistoryNext(result.next); } })}>Ver versiones anteriores</button>}
        </details></div>}
    </div>
    <SupplierBillEditor key={record ? `${record.id}:${record.version}` : draftId.current} initialBill={record?.draft} locked={busy || pending.length > 0 || recoveryError || !canWrite} blockClose={busy || pending.length > 0}
      close={() => { setEditing(false); setRecord(null); setReason(''); setHistory([]); void run(() => refresh()); }}
      onSave={(bill: BillDraft) => {
        if (busy || pending.length || recoveryError || !enabled || !canWrite) return;
        if (!bill.supplier.trim() || !bill.invoiceNumber.trim() || (record && !reason.trim())) { setMessage('Completa proveedor, número de factura y motivo del cambio.'); return; }
        const command: SaveSupplierDraft = { action: 'save', id: record?.id || draftId.current, requestId: newSupplierDraftId(), expectedVersion: record?.version || 0, draft: structuredClone(bill), reason };
        void run(() => send(command));
      }} />
  </div>;
  return <section className={s.page}>
    <button className={s.back} onClick={close}>‹ Centro de compras</button>
    <header className={s.head}><div><h1>Facturas de proveedor</h1><p>Borradores compartidos · costos y precios con historial</p></div><div className={s.actions}>
      <button disabled={busy || !enabled} onClick={() => void run(() => refresh())}>Actualizar</button>
      <button className={s.primary} disabled={busy || !enabled || !canWrite || pending.length > 0 || recoveryError} onClick={() => { draftId.current = newSupplierDraftId(); setRecord(null); setHistory([]); setReason(''); setMessage(''); setConflictId(null); setEditing(true); }}>Nueva factura</button>
    </div></header>
    {notices}
    <div className={s.panel + ' ' + s.body}><p>Guardar un borrador conserva costos y precios propuestos. Las existencias cambian al recibir la mercancía.</p></div>
    <div className={s.panel + ' ' + s.scroll}><table className={s.records}><thead><tr><th>Proveedor</th><th>Factura</th><th>Artículos</th><th>Versión</th><th>Último cambio</th><th></th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td>{row.supplier}</td><td>{row.invoiceNumber}</td><td>{row.lineCount}</td><td>{row.version}</td><td>{row.updatedBy.name}<small>{new Date(row.updatedAt).toLocaleString('es', { timeZone: 'America/Aruba' })}</small></td><td><button disabled={busy || pending.length > 0} onClick={() => void run(() => open(row.id))}>Abrir</button></td></tr>)}
      {!rows.length && <tr><td colSpan={6}>{busy ? 'Cargando…' : enabled ? 'No hay borradores guardados.' : 'Guardado compartido pendiente de activación.'}</td></tr>}
    </tbody></table></div>
    {next && <button disabled={busy} onClick={() => void run(() => refresh(next))}>Ver más facturas</button>}
  </section>;
}
