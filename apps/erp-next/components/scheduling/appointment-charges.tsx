'use client';

import { useEffect, useRef, useState } from 'react';
import { officeBookingOutcomeUnknown } from '../../lib/office-booking-authority';
import { bookingChargeDraft, chargeInputFromQuote, chargeMoney, mutateAppointmentCharges, newChargeRequestId,
  paymentMethods, quoteAppointmentCharges, type ChargeDraft, type ChargeLineInput, type ChargeQuote, type PaymentInput, type PaymentMethod } from '../../lib/appointment-charges';
import { ChargeIcon, type ChargeIconName } from './appointment-charge-icons';
import styles from './appointment-charges.module.css';
import { useAppointmentCharges } from './use-appointment-charges';
import { ChargeLineSummary, ChargeOverviewMetrics } from './appointment-charge-overview';
import { ChargeLinesEditor } from './charge-lines-editor';
import { useChargeEditSession } from './use-charge-edit-session';
import { ChargeAddSearch } from './charge-add-search';

const methodIcon: Record<PaymentMethod, ChargeIconName> = { cash: 'money', transfer: 'bank', pos: 'card', suave: 'phone' };
const dateLabel = (value: string) => new Date(value).toLocaleString('es', { timeZone: 'America/Aruba', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const newPayment = (): PaymentInput => ({ method: 'cash', amount: '', reference: '', receivedAt: new Date().toISOString(), note: '' });
function useQuote(lines: ChargeLineInput[], revision = 0, appointmentId?: string, expectedVersion?: number, purpose: 'projection' | 'final' = 'final') {
  const [quote, setQuote] = useState<ChargeQuote | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const signature = JSON.stringify(lines);
  useEffect(() => {
    let active = true;
    setQuote(null); setError('');
    if (!lines.length) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => { void quoteAppointmentCharges(JSON.parse(signature), appointmentId ? { appointmentId, expectedVersion: expectedVersion ?? 0 } : undefined, purpose).then(result => {
      if (active) setQuote(result.quote);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el precio.'); }).finally(() => { if (active) setLoading(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  // The serialized immutable input prevents stale quote responses from replacing edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, revision, appointmentId, expectedVersion, purpose]);
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
export function BookingChargesEditor({ seeds, value, onChange, disabled }: { seeds: ChargeLineInput[]; value: ChargeDraft | null; onChange: (draft: ChargeDraft) => void; disabled: boolean }) {
  const draft = bookingChargeDraft(seeds, value);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const { quote, error, loading } = useQuote(draft?.lines || [], quoteRevision, undefined, undefined, 'projection');
  const quoteDraft = useRef({ draft, onChange });
  quoteDraft.current = { draft, onChange };
  useEffect(() => {
    const current = quoteDraft.current;
    if (quote && current.draft && current.draft.quoteToken !== quote.quoteToken) current.onChange({ ...current.draft, quoteToken: quote.quoteToken });
  }, [quote]);
  if (!draft) return <div className={styles.workspace}><div className={styles.empty}>Selecciona los trabajos en Datos de la cita para preparar el importe proyectado.</div></div>;
  return <div className={styles.workspace} data-charge-stage="booking"><div className={styles.columns}>
    <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="work"/>Proyección automática de la cita</h3><p className={styles.muted}>Se calcula con los trabajos seleccionados. Si aún no conocemos los BTU, usamos la tarifa mínima configurada.</p>
      {draft.lines.map(line => { const priced = quote?.lines.find(item => item.id === line.id); return <div className={styles.summary} key={line.id}><span>{line.label} × {line.quantity}<small className={styles.muted}>{priced?.projectionOnly ? ' · Tarifa mínima · BTU por confirmar' : priced?.pendingReason || ''}</small></span><strong>{loading ? 'Consultando…' : chargeMoney(priced?.totalCents)}</strong></div>; })}
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
    </section>
    <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="receipt"/>Resumen de cobro</h3><button type="button" className={styles.link} disabled={disabled || loading} onClick={() => { onChange({ ...draft, quoteToken: undefined }); setQuoteRevision(value => value + 1); }}>Actualizar tarifas</button><div className={styles.hero}><span>TOTAL PROYECTADO</span><strong>{loading ? 'Consultando…' : chargeMoney(quote?.totalCents)}</strong><div className={styles.muted}>{draft.lines.length} conceptos · Afl.</div>{quote?.totalCents === null ? <div className={styles.summary}><span>Subtotal conocido</span><b>{chargeMoney(quote.knownTotalCents)}</b></div> : null}<div className={styles.summary}><span>Monto final</span><b>Por confirmar</b></div></div>
      <h3 className={styles.heading}><ChargeIcon name="money"/>Anticipo / abono</h3><label className={styles.check}><input type="checkbox" checked={Boolean(draft.payment)} disabled={disabled} onChange={event => onChange({ ...draft, payment: event.target.checked ? newPayment() : null })}/>Registrar anticipo al confirmar la cita</label>
      {draft.payment ? <PaymentFields value={draft.payment} disabled={disabled} onChange={payment => onChange({ ...draft, payment })}/> : <div className={styles.methods}>{paymentMethods.map(method => <button key={method.id} type="button" disabled={disabled} onClick={() => onChange({ ...draft, payment: { ...newPayment(), method: method.id } })}><ChargeIcon name={methodIcon[method.id]}/>{method.label}</button>)}</div>}
      <ChargeNotice>La proyección se guarda automáticamente al crear la cita. Al terminar seleccionas del catálogo los servicios y productos realizados con sus cantidades. Un servicio sin tarifa configurada queda por cotizar.</ChargeNotice>
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
export function AppointmentChargesWorkspace({ appointmentId, seeds, canManage, showHistory = false, active = true, onBusyChange, onChanged, onShowHistory }: { appointmentId: string; seeds: ChargeLineInput[]; canManage: boolean; showHistory?: boolean; active?: boolean; onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void> | void; onShowHistory?: () => void }) {
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState<'final' | null>(null);
  const [lines, setLines] = useState<ChargeLineInput[]>([]), [note, setNote] = useState(''), [reviewed, setReviewed] = useState(false), [payment, setPayment] = useState<PaymentInput | null>(null);
  const [candidateFingerprint, setCandidateFingerprint] = useState('');
  const [editingVersion, setEditingVersion] = useState(0), [paymentVersion, setPaymentVersion] = useState(0);
  const [pending, setPending] = useState<{ action: string; data: Record<string,unknown> } | null>(null);
  const inFlight = useRef(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const { quote, error: quoteError, loading: quoting } = useQuote(editing ? lines : [], quoteRevision, appointmentId, editingVersion);
  const { record, error: readError, loading, updatedAt, reload: read, ensureVersion } = useAppointmentCharges(appointmentId, active, Boolean(editing || payment || busy || pending));
  const editSession = useChargeEditSession(appointmentId, canManage && active && !showHistory && Boolean(record) && !record?.blocker, ensureVersion);
  const reload = () => { setQuoteRevision(value => value + 1); return read(); };
  useEffect(() => { onBusyChange(busy || Boolean(pending)); return () => onBusyChange(false); }, [busy, pending, onBusyChange]);
  const state = record?.state;
  const estimate = state?.estimate;
  const amount = state?.final?.totalCents ?? estimate?.totalCents;
  const balance = amount == null ? null : amount - (state?.receivedCents || 0);
  const blocked = !canManage || !editSession.owned || Boolean(record?.blocker) || busy || Boolean(pending) || loading || Boolean(readError);
  const version = state?.version || 0;
  const editingConflict = Boolean(editing) && editingVersion !== version;
  const paymentConflict = Boolean(payment) && paymentVersion !== version;
  const candidateReviewed = Boolean(candidateFingerprint) && candidateFingerprint === record?.candidateEvidence?.fingerprint;
  const startEdit = (_mode: 'final', addition?: ChargeLineInput, usePlanned = false) => {
    setEditing('final'); setEditingVersion(version);
    const existing = state?.final || (usePlanned ? estimate : null);
    setLines([...(existing ? chargeInputFromQuote(existing) : usePlanned ? record?.workItems || seeds : []), ...(addition ? [addition] : [])]);
    setNote(''); setReviewed(false); setCandidateFingerprint(''); setError(''); setSuccess('');
  };
  const addActual = (line: ChargeLineInput) => {
    if (editing) { setLines(current => [...current, line]); setReviewed(false); }
    else startEdit('final', line);
  };
  const perform = async (request: { action: string; data: Record<string,unknown> }) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess(''); setPending(request);
    try {
      const result = await mutateAppointmentCharges(request.action, request.data);
      setPending(null);
      // Rebase only across our one proven write. An exact replay can return a
      // later state containing other changes; keep that draft stale for review.
      const ownVersion = result.state.version === Number(request.data.expectedVersion) + 1;
      if (request.action === 'finalize_appointment_charges') {
        setEditing(null);
        if (payment && ownVersion && paymentVersion === request.data.expectedVersion) setPaymentVersion(result.state.version);
      } else {
        if (request.action === 'record_appointment_payment') setPayment(null);
        if (editing && ownVersion && editingVersion === request.data.expectedVersion) setEditingVersion(result.state.version);
        if (payment && request.action !== 'record_appointment_payment' && ownVersion && paymentVersion === request.data.expectedVersion) setPaymentVersion(result.state.version);
      } setSuccess('Registro guardado con su historial.');
      await reload();
      try { await onChanged(); } catch { /* Monetary commit already succeeded; refresh does not undo it. */ }
    } catch (cause) {
      if (!officeBookingOutcomeUnknown(cause)) setPending(null);
      setError(cause instanceof Error ? cause.message : 'No se confirmó el resultado. Reintenta la misma operación.');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const save = (action: string, values: Record<string,unknown>) => {
    const lease = editSession.credentials();
    if (!lease) { setError('Recupera el acceso de edición antes de guardar. Tu borrador se conserva.'); return; }
    void perform({ action, data: { ...values, ...lease, appointmentId, expectedVersion: action === 'record_appointment_payment' ? paymentVersion : action === 'void_appointment_payment' ? version : editingVersion, requestId: newChargeRequestId() } });
  };
  const startPayment = (method: PaymentMethod = 'cash') => { setPaymentVersion(version); setPayment({ ...newPayment(), method }); setSuccess(''); };
  if (loading && !record) return <ChargesSkeleton/>;
  return <div className={`${styles.workspace} ${!editing && !showHistory ? styles.overview : ''}`} aria-busy={loading} data-charge-stage={editing === 'final' ? 'final' : 'appointment'}>
    {canManage && active && !showHistory && record && !record.blocker ? <ChargeNotice><span role="status">{editSession.message}</span>{!editSession.owned && !editSession.loading ? <button type="button" className={styles.link} disabled={busy || Boolean(pending)} onClick={() => { void read(); editSession.retry(); }}>Recuperar acceso de edición</button> : null}</ChargeNotice> : null}
    {readError ? <div role="alert" className={styles.error}>{record ? 'No se pudieron actualizar los importes. Los datos visibles corresponden a la última consulta; vuelve a actualizar antes de guardar. ' : ''}{readError}</div> : null}
    {editingConflict || paymentConflict ? <div role="alert" className={styles.error}>Los importes cambiaron desde que abriste el formulario. Conservamos tu borrador: vuelve atrás o cancela y revisa los datos actualizados antes de iniciar otro registro.</div> : null}
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}{success ? <div role="status" className={styles.success}><ChargeIcon name="check"/>{success}</div> : null}
    {pending && !busy ? <div className={styles.notice}><ChargeIcon name="info"/><div>El resultado todavía no está confirmado. Reintentar conserva la misma solicitud y evita duplicados.<div style={{ marginTop: 9 }}><button type="button" className={styles.primary} onClick={() => void perform(pending)}>Reintentar la misma operación</button></div></div></div> : null}
    {!record ? <button type="button" className={styles.secondary} onClick={() => void reload()}>Volver a cargar</button> : <>
    <div className={styles.refresh}><span className={styles.muted} role="status">{loading ? 'Consultando datos actuales…' : `Última consulta · ${dateLabel(new Date(updatedAt).toISOString())}`}</span><button type="button" className={styles.link} disabled={busy || Boolean(pending) || loading} onClick={() => void reload()}>{loading ? 'Actualizando…' : 'Actualizar importes'}</button></div>
    {record.blocker ? <div className={styles.error} role="alert">{record.blocker}</div> : null}
    {showHistory ? <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="history"/>Historial de importes y pagos</h3>{record.history.length ? <ol className={styles.history}>{record.history.map(event => <li key={event.id}><strong>{historyLabels[event.action] || event.action}</strong><small>{dateLabel(event.at)} · {event.actor.name || 'Usuario registrado'} · Versión {event.version}</small>{event.after ? <p>{chargeMoney(event.after.totalCents)} · {event.after.note}</p> : null}{event.amountCents !== undefined ? <p>{chargeMoney(event.amountCents)}</p> : null}{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol> : <div className={styles.empty}>Todavía no hay movimientos registrados.</div>}<ChargeNotice>El estimado original se conserva. Cada cambio y anulación mantiene su responsable, fecha y motivo. Se muestran los últimos 100 movimientos.</ChargeNotice></section> : <>
    {!editing && state?.final && !readError && !record.blocker ? <div className={styles.confirmation}><ChargeIcon name="check"/><strong>Importe final confirmado</strong><span>{state.originalEstimate ? 'El estimado original se conserva en el historial.' : 'El importe final queda registrado en el historial.'}</span></div> : null}
    {editing ? <div className={styles.metrics}><Metric icon="receipt" label="PROYECTADO ORIGINAL" value={state?.originalEstimate?.totalCents}/><Metric icon="receipt" label="MONTO FINAL" value={editing === 'final' ? quote?.totalCents ?? null : state?.final?.totalCents ?? null} note={editing === 'final' ? 'Vista previa · sin guardar' : state?.final ? 'Confirmado por oficina' : 'Por confirmar'}/><Metric icon="money" label="TOTAL RECIBIDO" value={state ? state.receivedCents : undefined} color={styles.green}/><Metric icon="clock" label={balance !== null && balance < 0 ? 'SALDO A FAVOR' : state?.final ? 'SALDO PENDIENTE' : 'SALDO ESTIMADO'} value={balance === null ? null : Math.abs(balance)} color={balance === 0 ? styles.green : styles.amber} note={!state?.final ? 'Hasta confirmar el monto final' : undefined}/></div> : <ChargeOverviewMetrics record={record}/>}

    <div className={styles.columns}>
      <section className={styles.panel} aria-label="Trabajos e importes"><div className={styles.panelHeader}><div className={styles.panelTitle}><span className={styles.tile}><ChargeIcon name="work"/></span><div><h3 className={styles.heading}>{editing ? 'Trabajos realizados y monto final' : 'Trabajos e importes'}</h3>{!editing ? <p>{state?.final ? 'Servicios y productos confirmados' : 'Añade lo que se realizó o vendió al cliente'}</p> : null}</div></div>{!editing && state?.final ? <button type="button" className={styles.secondary} disabled={blocked || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onClick={() => startEdit('final')}><ChargeIcon name="edit"/>Editar trabajos</button> : null}</div>
      {editing ? <ChargeLinesEditor lines={lines} quote={quote} loading={quoting} disabled={blocked || editingConflict} onChange={value => { setLines(value); setReviewed(false); }}/> : state?.final ? <ChargeLineSummary record={record}/> : null}
      <ChargeAddSearch disabled={blocked || editingConflict || (editing ? lines.length >= 60 : (state?.final?.lines.length || 0) >= 60) || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onAdd={addActual}/>
      {record.candidateEvidence?.records.length ? <ChargeNotice><strong>Trabajos revisados en Field</strong><p>Contrasta estos conceptos con el monto final. No se suman automáticamente.</p>{record.candidateEvidence.records.map(candidate => <div key={candidate.id}><small>Revisión {candidate.revisionNumber}</small>{candidate.lines.map((line, index) => <div key={index}>{line.description} · {line.quantity} · {chargeMoney(Math.round(line.lineTotal * 100))}</div>)}{candidate.blockers.map((blocker, index) => <div key={index}>{blocker.message}</div>)}</div>)}{editing === 'final' ? <label className={styles.check}><input type="checkbox" disabled={blocked} checked={candidateReviewed} onChange={event => setCandidateFingerprint(event.target.checked ? record.candidateEvidence?.fingerprint || '' : '')}/>Concilié los conceptos Field en este total, sin duplicarlos.</label> : null}</ChargeNotice> : null}
      {editing ? <><label>Motivo / detalle del alcance{state?.originalEstimate || state?.estimate || state?.final ? ' *' : ''}<textarea maxLength={1000} rows={2} value={note} disabled={blocked} onChange={event => setNote(event.target.value)} placeholder="Describe el cambio de servicio, tiempo extra o adicionales"/></label>{editing === 'final' ? <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={blocked} onChange={event => setReviewed(event.target.checked)}/>Revisé los trabajos realizados, los adicionales y el importe acordado con el cliente.</label> : null}{quoteError ? <div className={styles.error} role="alert">{quoteError}</div> : null}<div className={styles.summary}><strong>{editing === 'final' ? 'Total final' : 'Total proyectado'}</strong><strong>{chargeMoney(quote?.totalCents)}</strong></div>{quote?.totalCents != null && state?.originalEstimate?.totalCents != null ? <div className={styles.summary}><span>Diferencia vs. original</span><strong>{chargeMoney(quote.totalCents - state.originalEstimate.totalCents)}</strong></div> : null}<div className={styles.footer}><button type="button" disabled={busy || Boolean(pending)} className={styles.secondary} onClick={() => setEditing(null)}>Volver</button><button type="button" disabled={blocked || editingConflict || paymentConflict || quoting || !quote || (editing === 'final' && (!reviewed || quote.totalCents === null || (Boolean(record.candidateEvidence?.records.length) && !candidateReviewed)))} className={styles.primary} onClick={() => save('finalize_appointment_charges', { lines, note, scopeReviewed: reviewed, quoteToken: quote?.quoteToken, candidateReviewed, candidateFingerprint })}>{busy ? 'Guardando…' : editing === 'final' ? 'Confirmar monto final' : 'Guardar proyección'}</button></div></> : <>
      {!state?.final ? <p className={styles.muted}>Selecciona los artículos realizados del catálogo. Cada selección añade una línea y deja el buscador listo para el siguiente artículo.</p> : null}
      {estimate ? <details className={styles.priorEstimate}><summary>Ver proyección del booking · {chargeMoney(estimate.totalCents)}</summary><ChargeLineSummary record={{ ...record, state: state ? { ...state, final: null } : null }}/></details> : !state?.final ? <p className={styles.muted}>Esta cita no tiene una proyección original guardada.</p> : null}
      {!state?.final ? <div className={styles.footer}><div><button type="button" className={styles.primary} disabled={blocked || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onClick={() => startEdit('final')}>Registrar trabajos realizados</button><button type="button" className={styles.secondary} disabled={blocked || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onClick={() => startEdit('final', undefined, true)}>Usar trabajos agendados</button></div></div> : null}
      </>}
      {editing ? <ChargeNotice>La confirmación del importe permite saldo pendiente. El cierre técnico, las evidencias y las horas del equipo se mantienen en su flujo habitual.</ChargeNotice> : null}
      </section>
      <section className={styles.panel} aria-label="Pagos de la visita"><div className={styles.panelHeader}><div className={styles.panelTitle}><span className={`${styles.tile} ${styles.green}`}><ChargeIcon name="money"/></span><div><h3 className={styles.heading}>Pagos de la visita</h3><p>Pagos registrados para esta cita</p></div></div><span className={`${styles.paymentStatus} ${!record.blocker && state?.final && balance === 0 ? styles.paidStatus : ''}`}>{record.blocker ? 'Por conciliar' : state?.final && balance === 0 ? '✓ Pagado' : balance !== null && balance < 0 ? 'A favor' : state?.final && state.receivedCents > 0 ? 'Parcial' : 'Abonos y cobros'}</span></div>
        {record.payments.length ? [...record.payments].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map(item => <div className={`${styles.payment} ${item.status === 'voided' ? styles.voided : ''}`} key={item.id}><span className={`${styles.tile} ${item.method === 'cash' ? styles.green : ''}`}><ChargeIcon name={methodIcon[item.method] || 'money'}/></span><div><strong>{paymentMethods.find(method => method.id === item.method)?.label || item.method}</strong><small>{dateLabel(item.receivedAt)} · {item.reference || 'Sin referencia'}</small><small>Registrado por {item.createdByName || 'Oficina'}</small>{item.note ? <small>{item.note}</small> : null}{item.status === 'voided' ? <small>Anulado · {item.voidReason}</small> : <button type="button" disabled={blocked || editingConflict || paymentConflict} onClick={() => { const reason = window.prompt('Motivo de la anulación del registro (no realiza un reembolso):'); if (reason?.trim()) save('void_appointment_payment', { paymentId: item.id, reason }); }}>Anular registro</button>}</div><strong className={styles.paymentAmount}>{chargeMoney(item.amountCents)}</strong></div>) : <div className={styles.empty}>{record.blocker ? 'Consulta el aviso de conciliación antes de registrar pagos.' : 'Sin pagos registrados en este historial.'}</div>}
        <div className={styles.receivedStrip}><strong>Total recibido</strong><strong>{state ? chargeMoney(state.receivedCents) : 'Sin registrar'}</strong></div>
        {balance !== null ? <div className={`${styles.balanceStrip} ${balance === 0 ? styles.settledStrip : ''}`}><strong>{balance < 0 ? 'Saldo a favor' : state?.final ? 'Saldo por cobrar' : 'Saldo estimado'}</strong><strong>{chargeMoney(Math.abs(balance))}</strong></div> : null}
        {payment ? <div className={styles.paymentForm}><PaymentFields value={payment} onChange={setPayment} disabled={blocked}/><div className={styles.footer}><button type="button" className={styles.secondary} disabled={busy || Boolean(pending)} onClick={() => setPayment(null)}>Cancelar</button><button type="button" className={styles.primary} disabled={blocked || paymentConflict || editingConflict || !payment.amount} onClick={() => save('record_appointment_payment', { payment })}>Guardar pago</button></div></div> : <div className={styles.paymentEntry}><h4>Registrar depósito, abono o pago</h4><div className={styles.methodShortcuts}>{paymentMethods.map(method => <button key={method.id} type="button" disabled={blocked || editingConflict || record.appointmentStatus === 'temporary_hold'} onClick={() => startPayment(method.id)}><ChargeIcon name={methodIcon[method.id]}/>{method.label}</button>)}</div><button type="button" className={styles.primary} disabled={blocked || editingConflict || record.appointmentStatus === 'temporary_hold'} onClick={() => startPayment()}><ChargeIcon name="plus"/>Registrar pago</button></div>}
        {onShowHistory ? <button type="button" className={styles.historyShortcut} disabled={busy || Boolean(pending)} onClick={onShowHistory}><ChargeIcon name="history"/>Ver movimientos</button> : null}
        {payment ? <ChargeNotice>Registra un pago ya recibido. Este formulario no realiza cargos en POS o SUAVE.</ChargeNotice> : null}
      </section>
    </div></>}
    </>}
  </div>;
}
