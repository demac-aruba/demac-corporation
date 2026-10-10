'use client';

import { useEffect, useRef, useState } from 'react';
import { officeBookingOutcomeUnknown } from '../../lib/office-booking-authority';
import { bookingChargeDraft, chargeInputFromQuote, chargeMoney, mutateAppointmentCharges, newChargeRequestId,
  paymentMethods, listChargeServices, quoteAppointmentCharges, type ChargeDraft, type ChargeLineInput, type ChargeQuote, type PaymentInput, type PaymentMethod } from '../../lib/appointment-charges';
import { ChargeIcon, type ChargeIconName } from './appointment-charge-icons';
import styles from './appointment-charges.module.css';
import { useAppointmentCharges } from './use-appointment-charges';

const methodIcon: Record<PaymentMethod, ChargeIconName> = { cash: 'money', transfer: 'bank', pos: 'card', suave: 'phone' };
const dateLabel = (value: string) => new Date(value).toLocaleString('es', { timeZone: 'America/Aruba', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const newPayment = (): PaymentInput => ({ method: 'cash', amount: '', reference: '', receivedAt: new Date().toISOString(), note: '' });
function useQuote(lines: ChargeLineInput[], revision = 0) {
  const [quote, setQuote] = useState<ChargeQuote | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const signature = JSON.stringify(lines);
  useEffect(() => {
    let active = true;
    setQuote(null); setError('');
    if (!lines.length) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => { void quoteAppointmentCharges(JSON.parse(signature)).then(result => {
      if (active) setQuote(result.quote);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el precio.'); }).finally(() => { if (active) setLoading(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  // The serialized immutable input prevents stale quote responses from replacing edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, revision]);
  return { quote, error, loading };
}
export function ChargeNotice({ children }: { children: React.ReactNode }) { return <div className={styles.notice}><ChargeIcon name="info"/><div>{children}</div></div>; }
function PaymentFields({ value, onChange, disabled = false }: { value: PaymentInput; onChange: (value: PaymentInput) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} style={{ padding: 0, margin: 0, border: 0, minWidth: 0 }}>
    <span className={styles.muted}>Método de pago</span><div className={styles.methods}>{paymentMethods.map(method => <button key={method.id} type="button" aria-pressed={value.method === method.id} className={value.method === method.id ? styles.selected : ''} onClick={() => onChange({ ...value, method: method.id })}><ChargeIcon name={methodIcon[method.id]}/>{method.label}</button>)}</div>
    <div className={styles.two}><label>Monto recibido (Afl.)<input inputMode="decimal" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })} placeholder="0.00"/></label><label>Referencia / comprobante{value.method !== 'cash' ? ' *' : ''}<input maxLength={180} value={value.reference} onChange={event => onChange({ ...value, reference: event.target.value })} placeholder={value.method === 'cash' ? 'N.º de recibo (opcional)' : 'Referencia de la transacción'}/></label></div>
    <label style={{ marginTop: 12 }}>Fecha y hora de recepción · Aruba<input type="datetime-local" value={value.receivedAt ? new Date(Date.parse(value.receivedAt) - 4 * 3600000).toISOString().slice(0,16) : ''} onChange={event => onChange({ ...value, receivedAt: event.target.value ? new Date(`${event.target.value}:00-04:00`).toISOString() : '' })}/></label>
    <label style={{ marginTop: 12 }}>Nota del pago<input maxLength={700} value={value.note || ''} onChange={event => onChange({ ...value, note: event.target.value })} placeholder="Información para contabilidad"/></label>
  </fieldset>;
}
function LinesEditor({ lines, onChange, quote, disabled, preserveWork = false }: { lines: ChargeLineInput[]; onChange: (lines: ChargeLineInput[]) => void; quote: ChargeQuote | null; disabled: boolean; preserveWork?: boolean }) {
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [catalogError, setCatalogError] = useState('');
  useEffect(() => { let active = true; void listChargeServices().then(result => { if (active) setServices(result.services); }).catch(() => { if (active) setCatalogError('No se pudo cargar el catálogo. Puedes ingresar un precio con motivo.'); }); return () => { active = false; }; }, []);
  const change = (id: string, patch: Partial<ChargeLineInput>) => onChange(lines.map(line => line.id === id ? { ...line, ...patch } : line));
  return <fieldset disabled={disabled} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
    {catalogError ? <ChargeNotice>{catalogError}</ChargeNotice> : null}
    {lines.map((line, index) => { const priced = quote?.lines.find(item => item.id === line.id); return <div className={styles.line} key={line.id}>
      <div className={styles.lineHeader}>{preserveWork && line.workLineId ? <strong>{line.label}</strong> : <input aria-label={`Concepto ${index + 1}`} maxLength={220} value={line.label} onChange={event => change(line.id, { label: event.target.value })} placeholder="Servicio, reparación o adicional"/>}{!(preserveWork && line.workLineId) ? <button type="button" aria-label={`Eliminar concepto ${index + 1}`} onClick={() => onChange(lines.filter(item => item.id !== line.id))}>Eliminar</button> : null}</div>
      <label className={styles.catalog}>Tarifa del catálogo<select aria-label={`Tarifa del catálogo ${index + 1}`} value={line.serviceId || ''} onChange={event => change(line.id, { serviceId: event.target.value, unitPrice: '', reason: '' })}><option value="">{line.presetId ? 'Tarifa según el trabajo / BTU' : 'Precio manual con motivo'}</option>{line.serviceId && !services.some(service => service.id === line.serviceId) ? <option value={line.serviceId}>Servicio seleccionado</option> : null}{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <div className={styles.lineFields}><label>BTU<input aria-label={`BTU ${index + 1}`} inputMode="numeric" value={line.btu || ''} onChange={event => change(line.id, { btu: event.target.value, unitPrice: '', reason: '' })} placeholder="Por confirmar"/></label><label>Cantidad<input aria-label={`Cantidad ${index + 1}`} inputMode="decimal" value={line.quantity} disabled={preserveWork && Boolean(line.workLineId)} onChange={event => change(line.id, { quantity: event.target.value })}/></label><div><span className={styles.muted}>Precio base</span><small>{chargeMoney(priced?.baseUnitCents)}</small></div><label>Precio / unidad (Afl.)<input aria-label={`Precio unitario ${index + 1}`} inputMode="decimal" value={line.unitPrice ?? ''} onChange={event => change(line.id, { unitPrice: event.target.value, reason: '' })} placeholder={priced?.baseUnitCents == null ? 'Por cotizar' : (priced.baseUnitCents / 100).toFixed(2)}/></label></div>
      {line.unitPrice !== undefined && line.unitPrice !== '' && line.unitPrice !== null ? <label className={styles.reason}>Motivo del precio / ajuste<input aria-label={`Motivo del precio ${index + 1}`} value={line.reason || ''} maxLength={700} onChange={event => change(line.id, { reason: event.target.value })} placeholder="Cambio de alcance, tiempo extra o precio acordado"/></label> : null}
      {preserveWork && line.workLineId && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 1 && lines.length + Number(line.quantity) - 1 <= 60 ? <button type="button" className={styles.link} onClick={() => onChange(lines.flatMap(item => item.id === line.id ? Array.from({ length: Number(line.quantity) }, (_, unit) => ({ ...line, id: `${line.id}-unit-${unit + 1}`, quantity: 1 })) : [item]))}>Separar equipos por BTU</button> : null}
      <div className={styles.summary}><span className={styles.muted}>{priced?.pendingReason || (priced?.manualPrice ? 'Precio ingresado por oficina' : 'Precio configurado en DEMAC')}</span><strong>{chargeMoney(priced?.totalCents)}</strong></div>
    </div>; })}
    <button type="button" className={styles.link} disabled={lines.length >= 60} onClick={() => onChange([...lines, { id: `extra-${crypto.randomUUID()}`, label: '', quantity: 1, unitPrice: '', reason: '' }])}><ChargeIcon name="plus"/>Añadir concepto / adicional</button>
  </fieldset>;
}
export function BookingChargesEditor({ seeds, value, onChange, disabled }: { seeds: ChargeLineInput[]; value: ChargeDraft | null; onChange: (draft: ChargeDraft) => void; disabled: boolean }) {
  const draft = bookingChargeDraft(seeds, value);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const { quote, error, loading } = useQuote(draft?.lines || [], quoteRevision);
  const quoteDraft = useRef({ draft, onChange });
  quoteDraft.current = { draft, onChange };
  useEffect(() => {
    const current = quoteDraft.current;
    if (quote && current.draft && current.draft.quoteToken !== quote.quoteToken) current.onChange({ ...current.draft, quoteToken: quote.quoteToken });
  }, [quote]);
  if (!draft) return <div className={styles.workspace}><div className={styles.empty}>Selecciona los trabajos en Datos de la cita para preparar el importe proyectado.</div></div>;
  return <div className={styles.workspace} data-charge-stage="booking"><div className={styles.columns}>
    <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="work"/>Trabajos y precio base</h3><LinesEditor preserveWork lines={draft.lines} quote={quote} disabled={disabled} onChange={lines => onChange({ ...draft, lines, quoteToken: undefined })}/><label>Nota de la proyección<textarea maxLength={1000} rows={2} value={draft.note || ''} disabled={disabled} onChange={event => onChange({ ...draft, note: event.target.value })} placeholder="Alcance previsto o condiciones del precio"/></label>{error ? <div role="alert" className={styles.error}>{error}</div> : null}</section>
    <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="receipt"/>Resumen de cobro</h3><button type="button" className={styles.link} disabled={disabled || loading} onClick={() => { onChange({ ...draft, quoteToken: undefined }); setQuoteRevision(value => value + 1); }}>Actualizar tarifas</button><div className={styles.hero}><span>TOTAL PROYECTADO</span><strong>{loading ? 'Consultando…' : chargeMoney(quote?.totalCents)}</strong><div className={styles.muted}>{draft.lines.length} conceptos · Afl.</div>{quote?.totalCents === null ? <div className={styles.summary}><span>Subtotal conocido</span><b>{chargeMoney(quote.knownTotalCents)}</b></div> : null}<div className={styles.summary}><span>Monto final</span><b>Por confirmar</b></div></div>
      <h3 className={styles.heading}><ChargeIcon name="money"/>Anticipo / abono</h3><label className={styles.check}><input type="checkbox" checked={Boolean(draft.payment)} disabled={disabled} onChange={event => onChange({ ...draft, payment: event.target.checked ? newPayment() : null })}/>Registrar anticipo al confirmar la cita</label>
      {draft.payment ? <PaymentFields value={draft.payment} disabled={disabled} onChange={payment => onChange({ ...draft, payment })}/> : <div className={styles.methods}>{paymentMethods.map(method => <button key={method.id} type="button" disabled={disabled} onClick={() => onChange({ ...draft, payment: { ...newPayment(), method: method.id } })}><ChargeIcon name={methodIcon[method.id]}/>{method.label}</button>)}</div>}
      <ChargeNotice>El estimado original queda guardado. El monto final se confirma tras revisar el trabajo realizado. Los precios sin BTU o tarifa quedan pendientes de cotizar.</ChargeNotice>
    </section>
  </div></div>;
}
function Metric({ icon, label, value, note, color = '' }: { icon: ChargeIconName; label: string; value: number | null | undefined; note?: string; color?: string }) { return <div className={`${styles.metric} ${color}`}><div className={styles.tile}><ChargeIcon name={icon}/></div><div><span>{label}</span><strong>{value === undefined ? 'Sin registrar' : chargeMoney(value)}</strong>{note ? <small>{note}</small> : null}</div></div>; }
function ChargesSkeleton() {
  return <div className={`${styles.workspace} ${styles.loadingWorkspace}`} aria-busy="true">
    <div className={styles.loadingLabel} role="status"><ChargeIcon name="receipt"/>Cargando importes y pagos…</div>
    <div aria-hidden="true">
      <div className={styles.metrics}>{['receipt', 'receipt', 'money', 'clock'].map((icon, index) => <div key={index} className={`${styles.metric} ${index === 2 ? styles.green : index === 3 ? styles.amber : ''}`}><div className={styles.tile}><ChargeIcon name={icon as ChargeIconName}/></div><div className={styles.skeletonMetric}><span className={styles.skeletonBar}/><span className={styles.skeletonBar}/></div></div>)}</div>
      <div className={styles.columns}>{['Trabajos e importes', 'Pagos del trabajo'].map((label, index) => <section key={label} className={`${styles.panel} ${styles.skeletonPanel}`}><h3 className={styles.heading}><ChargeIcon name={index ? 'card' : 'work'}/>{label}</h3>{[0, 1, 2, 3].map(row => <div key={row} className={styles.skeletonRow}><span className={styles.skeletonBar}/><span className={styles.skeletonBar}/></div>)}</section>)}</div>
    </div>
  </div>;
}
const historyLabels: Record<string,string> = { initial_estimate: 'Proyección inicial', save_appointment_estimate: 'Proyección actualizada', finalize_appointment_charges: 'Monto final confirmado', record_appointment_payment: 'Pago registrado', void_appointment_payment: 'Registro de pago anulado' };
export function AppointmentChargesWorkspace({ appointmentId, seeds, canManage, showHistory = false, active = true, onBusyChange, onChanged }: { appointmentId: string; seeds: ChargeLineInput[]; canManage: boolean; showHistory?: boolean; active?: boolean; onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void> | void }) {
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState<'estimate' | 'final' | null>(null);
  const [lines, setLines] = useState<ChargeLineInput[]>([]), [note, setNote] = useState(''), [reviewed, setReviewed] = useState(false), [payment, setPayment] = useState<PaymentInput | null>(null);
  const [candidateFingerprint, setCandidateFingerprint] = useState('');
  const [editingVersion, setEditingVersion] = useState(0), [paymentVersion, setPaymentVersion] = useState(0);
  const [pending, setPending] = useState<{ action: string; data: Record<string,unknown> } | null>(null);
  const inFlight = useRef(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const { quote, error: quoteError, loading: quoting } = useQuote(editing ? lines : [], quoteRevision);
  const { record, error: readError, loading, updatedAt, reload: read } = useAppointmentCharges(appointmentId, active, Boolean(editing || payment || busy || pending));
  const reload = () => { setQuoteRevision(value => value + 1); return read(); };
  useEffect(() => { onBusyChange(busy || Boolean(pending)); return () => onBusyChange(false); }, [busy, pending, onBusyChange]);
  const state = record?.state;
  const estimate = state?.estimate;
  const amount = state?.final?.totalCents ?? estimate?.totalCents;
  const balance = amount == null ? null : amount - (state?.receivedCents || 0);
  const blocked = !canManage || Boolean(record?.blocker) || busy || Boolean(pending) || loading || Boolean(readError);
  const version = state?.version || 0;
  const editingConflict = Boolean(editing) && editingVersion !== version;
  const paymentConflict = Boolean(payment) && paymentVersion !== version;
  const candidateReviewed = Boolean(candidateFingerprint) && candidateFingerprint === record?.candidateEvidence?.fingerprint;
  const startEdit = (mode: 'estimate' | 'final') => { setEditing(mode); setEditingVersion(version); const saved = state?.final || estimate; setLines(saved ? chargeInputFromQuote(saved) : (record?.workItems?.length ? record.workItems : seeds).map(line => ({ ...line, workLineId: '' }))); setNote(''); setReviewed(false); setCandidateFingerprint(''); setError(''); setSuccess(''); };
  const perform = async (request: { action: string; data: Record<string,unknown> }) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess(''); setPending(request);
    try {
      await mutateAppointmentCharges(request.action, request.data);
      setPending(null); setEditing(null); setPayment(null); setSuccess('Registro guardado con su historial.');
      await reload();
      try { await onChanged(); } catch { /* Monetary commit already succeeded; refresh does not undo it. */ }
    } catch (cause) {
      if (!officeBookingOutcomeUnknown(cause)) setPending(null);
      setError(cause instanceof Error ? cause.message : 'No se confirmó el resultado. Reintenta la misma operación.');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const save = (action: string, values: Record<string,unknown>) => { void perform({ action, data: { ...values, appointmentId, expectedVersion: action === 'record_appointment_payment' ? paymentVersion : action === 'void_appointment_payment' ? version : editingVersion, requestId: newChargeRequestId() } }); };
  if (loading && !record) return <ChargesSkeleton/>;
  return <div className={styles.workspace} aria-busy={loading} data-charge-stage={editing === 'final' ? 'final' : 'appointment'}>
    {readError ? <div role="alert" className={styles.error}>{record ? 'No se pudieron actualizar los importes. Los datos visibles corresponden a la última consulta; vuelve a actualizar antes de guardar. ' : ''}{readError}</div> : null}
    {editingConflict || paymentConflict ? <div role="alert" className={styles.error}>Los importes cambiaron desde que abriste el formulario. Conservamos tu borrador: vuelve atrás o cancela y revisa los datos actualizados antes de iniciar otro registro.</div> : null}
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}{success ? <div role="status" className={styles.success}><ChargeIcon name="check"/>{success}</div> : null}
    {pending && !busy ? <div className={styles.notice}><ChargeIcon name="info"/><div>El resultado todavía no está confirmado. Reintentar conserva la misma solicitud y evita duplicados.<div style={{ marginTop: 9 }}><button type="button" className={styles.primary} onClick={() => void perform(pending)}>Reintentar la misma operación</button></div></div></div> : null}
    {!record ? <button type="button" className={styles.secondary} onClick={() => void reload()}>Volver a cargar</button> : <>
    <div className={styles.refresh}><span className={styles.muted} role="status">{loading ? 'Consultando datos actuales…' : `Última consulta · ${dateLabel(new Date(updatedAt).toISOString())}`}</span><button type="button" className={styles.link} disabled={busy || Boolean(pending) || loading} onClick={() => void reload()}>{loading ? 'Actualizando…' : 'Actualizar importes'}</button></div>
    {record.blocker ? <div className={styles.error} role="alert">{record.blocker}</div> : null}
    {showHistory ? <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="history"/>Historial de importes y pagos</h3>{record.history.length ? <ol className={styles.history}>{record.history.map(event => <li key={event.id}><strong>{historyLabels[event.action] || event.action}</strong><small>{dateLabel(event.at)} · {event.actor.name || 'Usuario registrado'} · Versión {event.version}</small>{event.after ? <p>{chargeMoney(event.after.totalCents)} · {event.after.note}</p> : null}{event.amountCents !== undefined ? <p>{chargeMoney(event.amountCents)}</p> : null}{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol> : <div className={styles.empty}>Todavía no hay movimientos registrados.</div>}<ChargeNotice>El estimado original se conserva. Cada cambio y anulación mantiene su responsable, fecha y motivo. Se muestran los últimos 100 movimientos.</ChargeNotice></section> : <>
    <div className={styles.metrics}><Metric icon="receipt" label="PROYECTADO ORIGINAL" value={state?.originalEstimate?.totalCents}/><Metric icon="receipt" label="MONTO FINAL" value={editing === 'final' ? quote?.totalCents ?? null : state?.final?.totalCents ?? null} note={editing === 'final' ? 'Vista previa · sin guardar' : state?.final ? 'Confirmado por oficina' : 'Por confirmar'}/><Metric icon="money" label="TOTAL RECIBIDO" value={state ? state.receivedCents : undefined} color={styles.green}/><Metric icon="clock" label={balance !== null && balance < 0 ? 'SALDO A FAVOR' : state?.final ? 'SALDO PENDIENTE' : 'SALDO ESTIMADO'} value={balance === null ? null : Math.abs(balance)} color={balance === 0 ? styles.green : styles.amber} note={!state?.final ? 'Hasta confirmar el monto final' : undefined}/></div>
    <div className={styles.columns}>
      <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="work"/>{editing === 'final' ? 'Trabajos realizados y monto final' : editing ? 'Editar importe proyectado' : 'Trabajos e importes'}</h3>
      {record.candidateEvidence?.records.length ? <ChargeNotice><strong>Trabajos revisados en Field</strong><p>Contrasta estos conceptos con el monto final. No se suman automáticamente.</p>{record.candidateEvidence.records.map(candidate => <div key={candidate.id}><small>Revisión {candidate.revisionNumber}</small>{candidate.lines.map((line, index) => <div key={index}>{line.description} · {line.quantity} · {chargeMoney(Math.round(line.lineTotal * 100))}</div>)}{candidate.blockers.map((blocker, index) => <div key={index}>{blocker.message}</div>)}</div>)}{editing === 'final' ? <label className={styles.check}><input type="checkbox" disabled={blocked} checked={candidateReviewed} onChange={event => setCandidateFingerprint(event.target.checked ? record.candidateEvidence?.fingerprint || '' : '')}/>Concilié los conceptos Field en este total, sin duplicarlos.</label> : null}</ChargeNotice> : null}
      {editing ? <><LinesEditor lines={lines} quote={quote} disabled={blocked} onChange={setLines}/><label>Motivo / detalle del alcance{state?.originalEstimate || state?.estimate || state?.final ? ' *' : ''}<textarea maxLength={1000} rows={2} value={note} disabled={blocked} onChange={event => setNote(event.target.value)} placeholder="Describe el cambio de servicio, tiempo extra o adicionales"/></label>{editing === 'final' ? <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={blocked} onChange={event => setReviewed(event.target.checked)}/>Revisé los trabajos realizados, los adicionales y el importe acordado con el cliente.</label> : null}{quoteError ? <div className={styles.error} role="alert">{quoteError}</div> : null}<div className={styles.summary}><strong>{editing === 'final' ? 'Total final' : 'Total proyectado'}</strong><strong>{chargeMoney(quote?.totalCents)}</strong></div>{quote?.totalCents != null && state?.originalEstimate?.totalCents != null ? <div className={styles.summary}><span>Diferencia vs. original</span><strong>{chargeMoney(quote.totalCents - state.originalEstimate.totalCents)}</strong></div> : null}<div className={styles.footer}><button type="button" disabled={busy || Boolean(pending)} className={styles.secondary} onClick={() => setEditing(null)}>Volver</button><button type="button" disabled={blocked || editingConflict || quoting || !quote || (editing === 'final' && (!reviewed || quote.totalCents === null || (Boolean(record.candidateEvidence?.records.length) && !candidateReviewed)))} className={styles.primary} onClick={() => save(editing === 'final' ? 'finalize_appointment_charges' : 'save_appointment_estimate', { lines, note, scopeReviewed: reviewed, quoteToken: quote?.quoteToken, candidateReviewed, candidateFingerprint })}>{busy ? 'Guardando…' : editing === 'final' ? 'Confirmar monto final' : 'Guardar proyección'}</button></div></> : <>
      {state?.final || estimate ? <table className={styles.table}><thead><tr><th>Concepto</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>{(state?.final || estimate)?.lines.map(line => <tr key={line.id}><td><strong>{line.label}</strong><small>{line.btu ? `${Number(line.btu).toLocaleString('en-US')} BTU` : line.pendingReason || (line.manualPrice ? 'Importe acordado' : 'Precio del catálogo')}</small>{line.manualPrice ? <span className={styles.badge}>Precio ajustado</span> : null}{line.reason ? <small>{line.reason}</small> : null}</td><td>{line.quantityMillis / 1000}</td><td>{chargeMoney(line.totalCents)}</td></tr>)}</tbody></table> : <div className={styles.empty}>Esta cita todavía no tiene importes registrados.</div>}
      <div className={styles.summary}><span>Proyección actual</span><strong>{chargeMoney(estimate?.totalCents)}</strong></div>
      <div className={styles.footer}><div>{!state?.final ? <button type="button" className={styles.secondary} disabled={blocked || ['cancelled','canceled'].includes(record.appointmentStatus)} onClick={() => startEdit('estimate')}>{estimate ? 'Editar proyectado' : 'Registrar proyección'}</button> : null}<button type="button" className={styles.primary} disabled={blocked || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onClick={() => startEdit('final')}>{state?.final ? 'Corregir monto final' : 'Confirmar monto final'}</button></div></div>
      </>}
      <ChargeNotice>La confirmación del importe permite saldo pendiente. El cierre técnico, las evidencias y las horas del equipo se mantienen en su flujo habitual.</ChargeNotice>
      </section>
      <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="card"/>Pagos del trabajo<small>{state?.final && balance === 0 ? '✓ Pagado' : 'Abonos y cobros'}</small></h3>
        {record.payments.length ? [...record.payments].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map(item => <div className={`${styles.payment} ${item.status === 'voided' ? styles.voided : ''}`} key={item.id}><ChargeIcon name={methodIcon[item.method] || 'money'}/><div><strong>{paymentMethods.find(method => method.id === item.method)?.label || item.method}</strong><small>{dateLabel(item.receivedAt)} · {item.reference || 'Sin referencia'}</small><small>Registrado por {item.createdByName || 'Oficina'}</small>{item.note ? <small>{item.note}</small> : null}{item.status === 'voided' ? <small>Anulado · {item.voidReason}</small> : <button type="button" disabled={blocked} onClick={() => { const reason = window.prompt('Motivo de la anulación del registro (no realiza un reembolso):'); if (reason?.trim()) save('void_appointment_payment', { paymentId: item.id, reason }); }}>Anular registro</button>}</div><strong>{chargeMoney(item.amountCents)}</strong></div>) : <div className={styles.empty}>Sin pagos registrados en este historial.</div>}
        <div className={styles.summary}><strong>Total recibido</strong><strong>{state ? chargeMoney(state.receivedCents) : 'Sin registrar'}</strong></div>
        {payment ? <div className={styles.paymentForm}><PaymentFields value={payment} onChange={setPayment} disabled={blocked}/><div className={styles.footer}><button type="button" className={styles.secondary} disabled={busy || Boolean(pending)} onClick={() => setPayment(null)}>Cancelar</button><button type="button" className={styles.primary} disabled={blocked || paymentConflict || !payment.amount} onClick={() => save('record_appointment_payment', { payment })}>Guardar pago</button></div></div> : <button type="button" style={{ width: '100%', marginTop: 12 }} className={styles.secondary} disabled={blocked || record.appointmentStatus === 'temporary_hold'} onClick={() => { setPaymentVersion(version); setPayment(newPayment()); setSuccess(''); }}><ChargeIcon name="plus"/>Registrar pago</button>}
        {balance !== null ? <div className={balance === 0 ? styles.success : styles.notice}><ChargeIcon name={balance === 0 ? 'check' : 'info'}/>{balance < 0 ? 'Saldo a favor' : state?.final ? 'Saldo pendiente' : 'Saldo estimado'}: {chargeMoney(Math.abs(balance))}</div> : null}
        <ChargeNotice>Permite combinar efectivo, transferencia, POS y SUAVE. Cada registro conserva fecha, referencia y responsable para contabilidad.</ChargeNotice>
      </section>
    </div></>}
    </>}
  </div>;
}
