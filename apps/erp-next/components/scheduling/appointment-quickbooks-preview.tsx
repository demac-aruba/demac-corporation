'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { chargeMoney, getAppointmentCharges, paymentMethods } from '../../lib/appointment-charges';
import { loadFirebaseWebSession } from '../../lib/firebase/session';
import { prepareAppointmentQuickBooksPreview, type AppointmentQuickBooksPreview } from '../../lib/quickbooks-appointment-preview';
import styles from './appointment-quickbooks-preview.module.css';

export function AppointmentQuickBooksPreviewButton({ appointmentId, currentUserId, expectedVersion }: {
  appointmentId: string; currentUserId: string; expectedVersion: number;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<AppointmentQuickBooksPreview | null>(null);
  const [readAt, setReadAt] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), request = useRef(0), locked = useRef(false), alive = useRef(false);
  const titleId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  function close() { request.current++; locked.current = false; dialog.current?.close(); setOpen(false); setBusy(false); setPreview(null); setError(''); }
  async function prepare() {
    if (locked.current) return;
    locked.current = true; const ticket = ++request.current;
    setOpen(true); setBusy(true); setError(''); setPreview(null); setReadAt('');
    try {
      if (loadFirebaseWebSession()?.uid !== currentUserId) throw Error('Inicia sesión nuevamente para consultar esta cita.');
      const record = await getAppointmentCharges(appointmentId);
      if (!alive.current || ticket !== request.current) return;
      if (loadFirebaseWebSession()?.uid !== currentUserId) throw Error('La sesión cambió. Cierra esta vista e inicia sesión nuevamente.');
      if ((record.state?.version ?? 0) !== expectedVersion) throw Error('Los importes cambiaron. Cierra esta vista, pulsa «Actualizar importes» y vuelve a preparar.');
      setPreview(prepareAppointmentQuickBooksPreview(record)); setReadAt(new Date().toISOString());
    } catch (cause) { if (alive.current && ticket === request.current) setError(cause instanceof Error ? cause.message : 'No se pudo leer la cita.'); }
    finally { if (alive.current && ticket === request.current) { locked.current = false; setBusy(false); } }
  }
  return <>
    <button type="button" className={styles.trigger} onClick={() => void prepare()}>Vista previa QuickBooks</button>
    {open ? <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClose={close}>
      <header className={styles.header}><div><h2 id={titleId}>Vista previa QuickBooks</h2><p>Trabajos y pagos confirmados en el ERP</p></div><button type="button" onClick={close} aria-label="Cerrar vista previa QuickBooks">Cerrar</button></header>
      <div className={styles.content} aria-busy={busy}>
        <p className={styles.notice}>Esta vista no envía datos. El registro de estas operaciones en QuickBooks todavía no está verificado.</p>
        {busy ? <p role="status">Consultando los importes guardados de la cita…</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {preview ? <>
          <p className={styles.meta}>Consulta: <time dateTime={readAt}>{new Date(readAt).toLocaleString('es', { timeZone: 'America/Aruba' })}</time>{preview.invoice ? ' · Moneda: AWG' : ''}</p>
          {preview.sourceIssues.length ? <section className={styles.error} aria-label="Registros que requieren revisión"><h3>Revisar los registros del ERP</h3><ul>{preview.sourceIssues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul></section> : null}
          {preview.invoice ? <>
            <div className={styles.table} tabIndex={0} role="region" aria-label="Conceptos confirmados para la vista previa"><table><caption>Conceptos confirmados · sin factura emitida por esta vista</caption><thead><tr><th scope="col">Concepto</th><th scope="col">Cantidad</th><th scope="col">Precio</th><th scope="col">Importe</th></tr></thead><tbody>{preview.invoice.lines.map(line => <tr key={line.id}><td>{line.label}</td><td>{line.quantityMillis / 1000}</td><td>{chargeMoney(line.unitCents)}</td><td>{chargeMoney(line.totalCents)}</td></tr>)}</tbody></table></div>
            <dl className={styles.totals}><div><dt>Importe confirmado</dt><dd>{chargeMoney(preview.invoice.totalCents)}</dd></div><div><dt>Recibido en el ERP</dt><dd>{chargeMoney(preview.receivedCents)}</dd></div><div><dt>{(preview.operationalBalanceCents ?? 0) < 0 ? 'Saldo a favor en el ERP' : 'Saldo operativo del ERP'}</dt><dd>{chargeMoney(Math.abs(preview.operationalBalanceCents!))}</dd></div></dl>
            <h3>Pagos que requieren verificar su aplicación</h3>
            {preview.receipts.length ? <ul className={styles.receipts}>{preview.receipts.map(receipt => <li key={receipt.id}><span>{paymentMethods.find(method => method.id === receipt.method)?.label} · {receipt.receivedDate}{receipt.reference ? <small>{receipt.reference}</small> : null}</span><strong>{chargeMoney(receipt.amountCents)}</strong></li>)}</ul> : <p>No hay pagos vigentes en este registro.</p>}
            {preview.voidedReceiptCount ? <p className={styles.meta}>{preview.voidedReceiptCount} registro(s) anulado(s) excluido(s). No representan reembolsos.</p> : null}
          </> : null}
          <section className={styles.setup}><h3>Pendiente antes de enviar</h3><ul>{preview.setupIssues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul><p>La configuración se verificará con datos de QuickBooks. No se asignan cuentas ni impuestos automáticamente.</p></section>
        </> : null}
      </div>
    </dialog> : null}
  </>;
}
