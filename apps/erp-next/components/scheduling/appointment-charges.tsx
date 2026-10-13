'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { chargeRetryWasNotCommitted, chargeRecoveryBaseline, readChargeRecovery, writeChargeRecovery, type PendingChargeOperation } from '../../lib/appointment-charge-recovery';
import { appointmentChargeBalance } from '../../lib/appointment-charge-balance';
import { OfficeBookingRequestError, officeBookingOutcomeUnknown } from '../../lib/office-booking-authority';
import { bookingChargeDraft, chargeInputFromQuote, chargeMoney, getAppointmentCharges, mutateAppointmentCharges, newChargeRequestId,
  paymentMethods, quoteAppointmentCharges, type ChargeDraft, type ChargeLineInput, type ChargeQuote, type PaymentInput, type PaymentMethod } from '../../lib/appointment-charges';
import { ChargeIcon, type ChargeIconName } from './appointment-charge-icons';
import styles from './appointment-charges.module.css';
import { useAppointmentCharges } from './use-appointment-charges';
import { ChargeLineSummary, ChargeOverviewMetrics } from './appointment-charge-overview';
import { ChargeLinesEditor } from './charge-lines-editor';
import { useChargeEditSession } from './use-charge-edit-session';
import { ChargeAddSearch } from './charge-add-search';
import { AppointmentQuickBooksPreviewButton } from './appointment-quickbooks-preview';

const methodIcon: Record<PaymentMethod, ChargeIconName> = { cash: 'money', transfer: 'bank', pos: 'card', suave: 'phone' };
const dateLabel = (value: string) => new Date(value).toLocaleString('es', { timeZone: 'America/Aruba', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const newPayment = (): PaymentInput => ({ method: 'cash', amount: '', reference: '', receivedAt: new Date().toISOString(), note: '' });
function useQuote(lines: ChargeLineInput[], revision = 0, appointmentId?: string, expectedVersion?: number, purpose: 'projection' | 'final' = 'final') {
  const signature = JSON.stringify(lines);
  const key = JSON.stringify([signature, revision, appointmentId, expectedVersion, purpose]);
  const [result, setResult] = useState<{ key: string; quote: ChargeQuote | null; error: string; loading: boolean }>({ key: '', quote: null, error: '', loading: false });
  useEffect(() => {
    let active = true;
    setResult({ key, quote: null, error: '', loading: Boolean(lines.length) });
    if (!lines.length) return;
    const timer = window.setTimeout(() => { void quoteAppointmentCharges(JSON.parse(signature), appointmentId ? { appointmentId, expectedVersion: expectedVersion ?? 0 } : undefined, purpose).then(result => {
      if (active) setResult({ key, quote: result.quote, error: '', loading: false });
    }).catch(cause => { if (active) setResult({ key, quote: null, error: cause instanceof Error ? cause.message : 'No se pudo consultar el precio.', loading: false }); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  // The serialized immutable input prevents stale quote responses from replacing edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, revision, appointmentId, expectedVersion, purpose]);
  // Invalidate during render too: no frame may expose the previous input's price.
  return result.key === key ? result : { quote: null, error: '', loading: Boolean(lines.length) };
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
export function AppointmentChargesWorkspace({ appointmentId, currentUserId, onDraftStateChange, canManage, showHistory = false, active = true, onBusyChange, onChanged, onShowHistory, onClose, documentContext }: { appointmentId: string; currentUserId: string; onDraftStateChange?: (state: { dirty: boolean; recoverable: boolean }) => void; canManage: boolean; showHistory?: boolean; active?: boolean; onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void> | void; onShowHistory?: () => void; onClose?: () => void; documentContext?: { customer: string; dateKey: string } }) {
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState<'final' | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfFlight = useRef(false), pdfGeneration = useRef(0);
  useEffect(() => { pdfGeneration.current++; return () => { pdfGeneration.current++; }; }, [appointmentId, active, showHistory, editing, busy]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(''), 4500); return () => window.clearTimeout(timer); }, [success]);
  const [lines, setLines] = useState<ChargeLineInput[]>([]), [note, setNote] = useState(''), [reviewed, setReviewed] = useState(false), [payment, setPayment] = useState<PaymentInput | null>(null);
  const [candidateFingerprint, setCandidateFingerprint] = useState('');
  const [editingVersion, setEditingVersion] = useState(0), [paymentVersion, setPaymentVersion] = useState(0);
  const [pending, setPending] = useState<PendingChargeOperation | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false), [recoveringDraft, setRecoveringDraft] = useState(false);
  const [draftBaseline, setDraftBaseline] = useState(''), [storageError, setStorageError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false), [recovered, setRecovered] = useState(false);
  const [reviewRecovery, setReviewRecovery] = useState(''), [invalidRecovery, setInvalidRecovery] = useState(false);
  const acknowledgedVersion = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const { quote, error: quoteError, loading: quoting } = useQuote(editing ? lines : [], quoteRevision, appointmentId, editingVersion);
  const { record, error: readError, loading, updatedAt, reload: read, ensureVersion } = useAppointmentCharges(appointmentId, active, Boolean(editing || payment || busy || pending));
  const editSession = useChargeEditSession(appointmentId, canManage && active && !showHistory && Boolean(record) && !record?.blocker, ensureVersion);
  const reload = () => { setQuoteRevision(value => value + 1); return read(); };
  useEffect(() => { onBusyChange(busy || Boolean(pending)); return () => onBusyChange(false); }, [busy, pending, onBusyChange]);
  const state = record?.state;
  const estimate = state?.estimate;
  const accessBlocked = invalidRecovery || !canManage || !editSession.owned || Boolean(record?.blocker) || busy || Boolean(pending) || loading || Boolean(readError);
  const blocked = accessBlocked || recoveringDraft;
  const version = state?.version || 0;
  const currentBaseline = useMemo(() => record ? chargeRecoveryBaseline(record) : '', [record]);
  const recoveryReviewed = Boolean(reviewRecovery) && reviewRecovery === currentBaseline;
  const editingConflict = Boolean(editing) && editingVersion !== version;
  const paymentConflict = Boolean(payment) && paymentVersion !== version;
  const totals = record ? appointmentChargeBalance(record, editing ? { quote, unavailable: recoveringDraft || quoting || Boolean(quoteError) || editingConflict || paymentConflict || Boolean(pending) || Boolean(readError) || loading } : undefined) : null;
  const balance = totals?.balanceCents ?? null;
  const reasonRequired = Boolean(state?.originalEstimate || state?.estimate || state?.final);
  const candidateReviewed = Boolean(candidateFingerprint) && candidateFingerprint === record?.candidateEvidence?.fingerprint;
  const persistRecovery = (nextPending = pending, keepDraft = Boolean(editing)) => {
    if (!currentUserId) throw Error('No se pudo verificar el usuario del borrador.');
    writeChargeRecovery({ schema: 1, userId: currentUserId, appointmentId, savedAt: Date.now(),
      draft: keepDraft ? { lines, note, version: editingVersion, baseline: draftBaseline } : null, pending: nextPending });
  };
  useEffect(() => {
    if (recoveryReady || !canManage || !active || showHistory || !currentUserId || !record || loading || readError) return;
    try {
      const saved = readChargeRecovery(currentUserId, appointmentId);
      if (saved?.draft) {
        setLines(saved.draft.lines); setNote(saved.draft.note); setEditingVersion(saved.draft.version);
        setDraftBaseline(saved.draft.baseline); setEditing('final'); setReviewed(false); setCandidateFingerprint('');
        setRecoveringDraft(true); setRecovered(true);
      }
      if (saved?.pending) setPending(saved.pending);
    } catch { setInvalidRecovery(true); setStorageError('No se pudo recuperar el borrador de esta pestaña. Conserva esta pantalla abierta y revisa el historial antes de registrar otro pago.'); }
    setRecoveryReady(true);
  }, [active, showHistory, currentUserId, appointmentId, canManage, record, loading, readError, recoveryReady]);
  useEffect(() => {
    if (!record || loading || readError) return;
    if (acknowledgedVersion.current === version) {
      setDraftBaseline(currentBaseline); acknowledgedVersion.current = null;
    } else if (acknowledgedVersion.current !== null && version > acknowledgedVersion.current) acknowledgedVersion.current = null;
    // Returning from History reacquires a lease and advances version even for a
    // fresh draft. Rebase only when all financial evidence is still identical.
    if ((recoveringDraft || (editing && version > editingVersion)) && !busy && !pending && !record.blocker && draftBaseline === currentBaseline) {
      setEditingVersion(version); setRecoveringDraft(false); setReviewed(false); setCandidateFingerprint('');
    }
  }, [record, currentBaseline, version, loading, readError, recoveringDraft, editing, editingVersion, busy, pending, draftBaseline]);
  useEffect(() => {
    if (!recoveryReady || invalidRecovery || !canManage || !currentUserId) return;
    try { persistRecovery(); setDraftSaved(Boolean(editing)); setStorageError(''); }
    catch { setDraftSaved(false); setStorageError('No se pudo conservar el borrador en esta pestaña. No cierres ni refresques hasta confirmar los trabajos.'); }
  // Inputs plus comparison-only financial evidence and, if uncertain, one immutable
  // request for exact replay. None grants a new edit lease or confirms a total.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryReady, invalidRecovery, canManage, currentUserId, appointmentId, editing, lines, note, editingVersion, draftBaseline, pending]);
  useEffect(() => {
    onDraftStateChange?.({ dirty: Boolean(editing || payment), recoverable: Boolean(editing && draftSaved && !payment) });
    return () => onDraftStateChange?.({ dirty: false, recoverable: false });
  }, [editing, payment, draftSaved, onDraftStateChange]);
  useEffect(() => {
    if (!editing && !payment && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, payment, pending]);
  const discardDraft = () => {
    if (busy || pending || !window.confirm('¿Descartar los cambios de trabajos sin confirmar? Los pagos guardados se conservan.')) return;
    try { persistRecovery(null, false); } catch { setError('No se pudo descartar el borrador guardado. Reintenta.'); return; }
    setEditing(null); setRecoveringDraft(false); setRecovered(false); setDraftBaseline(''); setDraftSaved(false);
  };
  const recoveryConflict = recoveringDraft && Boolean(record) && !loading && !readError && draftBaseline !== currentBaseline;

  const startEdit = (addition?: ChargeLineInput) => {
    setEditing('final'); setEditingVersion(version); setDraftBaseline(currentBaseline); setRecoveringDraft(false); setRecovered(false);
    const existing = state?.final;
    setLines([...(existing ? chargeInputFromQuote(existing) : []), ...(addition ? [addition] : [])]);
    setNote(''); setReviewed(false); setCandidateFingerprint(''); setError(''); setSuccess('');
  };
  const addActual = (line: ChargeLineInput) => {
    if (editing) { setLines(current => [...current, line]); setReviewed(false); }
    else startEdit(line);
  };
  const perform = async (request: { action: string; data: Record<string,unknown> }) => {
    if (inFlight.current) return;
    const retryingUncertain = Boolean(pending);
    // Capture a proved fresh fence before this retry, never after its response.
    const retryFence = !loading && !readError ? editSession.credentials() : null;
    const retryVersion = version;
    try { persistRecovery(request); }
    catch { setError('No se pudo conservar la solicitud para recuperarla con seguridad. No se envió ningún cambio.'); return; }
    inFlight.current = true; setBusy(true); setError(''); setSuccess(''); setPending(request);
    try {
      const result = await mutateAppointmentCharges(request.action, request.data);
      setPending(null);
      // Rebase only across our one proven write. An exact replay can return a
      // later state containing other changes; keep that draft stale for review.
      const ownVersion = result.state.version === Number(request.data.expectedVersion) + 1;
      if (request.action === 'finalize_appointment_charges') {
        setEditing(null); setRecoveringDraft(false); setRecovered(false);
        if (payment && ownVersion && paymentVersion === request.data.expectedVersion) setPaymentVersion(result.state.version);
      } else {
        if (request.action === 'record_appointment_payment') setPayment(null);
        if (editing && ownVersion && editingVersion === request.data.expectedVersion) { setEditingVersion(result.state.version); acknowledgedVersion.current = result.state.version; }
        if (payment && request.action !== 'record_appointment_payment' && ownVersion && paymentVersion === request.data.expectedVersion) setPaymentVersion(result.state.version);
      } setSuccess(request.action === 'record_appointment_payment' && editing ? 'Pago registrado; los trabajos siguen pendientes de confirmar' : historyLabels[request.action] || 'Cambios guardados');
      await reload();
      try { await onChanged(); } catch { /* Monetary commit already succeeded; refresh does not undo it. */ }
    } catch (cause) {
      if ((!retryingUncertain && !officeBookingOutcomeUnknown(cause)) || (cause instanceof OfficeBookingRequestError && !cause.outcomeUnknown && chargeRetryWasNotCommitted(cause.code, request, retryFence, retryVersion))) setPending(null);
      setError(cause instanceof Error ? cause.message : 'No se confirmó el resultado. Reintenta la misma operación.');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const save = (action: string, values: Record<string,unknown>) => {
    const lease = editSession.credentials();
    if (!lease) { setError('Recupera el acceso de edición antes de guardar. Tu borrador se conserva.'); return; }
    void perform({ action, data: { ...values, ...lease, appointmentId, expectedVersion: action === 'record_appointment_payment' ? paymentVersion : action === 'void_appointment_payment' ? version : editingVersion, requestId: newChargeRequestId() } });
  };
  const startPayment = (method: PaymentMethod = 'cash') => { setPaymentVersion(version); setPayment({ ...newPayment(), method }); setSuccess(''); };
  const downloadPdf = async () => {
    if (pdfFlight.current || editing || pending || busy || loading || readError || !record?.state?.final || record.blocker || !documentContext) return;
    pdfFlight.current = true; setPdfBusy(true); setError('');
    const generation = pdfGeneration.current;
    try {
      const fresh = await getAppointmentCharges(appointmentId);
      const { downloadAppointmentChargesPdf } = await import('../../lib/appointment-charges-pdf');
      if (generation === pdfGeneration.current) downloadAppointmentChargesPdf({ appointmentId, ...documentContext, record: fresh });
    } catch (cause) { if (generation === pdfGeneration.current) setError(cause instanceof Error ? cause.message : 'No se pudo generar el PDF. Reintenta la descarga.'); }
    finally { pdfFlight.current = false; setPdfBusy(false); }
  };
  if (loading && !record) return <ChargesSkeleton/>;
  return <div className={`${styles.workspace} ${!showHistory ? `${styles.overview} ${styles.compactWorkspace}` : ''}`} aria-busy={loading} data-charge-stage={editing === 'final' ? 'final' : 'appointment'}>
    {readError ? <div role="alert" className={styles.error}>{record ? 'No se pudieron actualizar los importes. Los datos visibles corresponden a la última consulta; vuelve a actualizar antes de guardar. ' : ''}{readError}</div> : null}
    {editingConflict || paymentConflict ? <div role="alert" className={styles.error}>Los importes cambiaron desde que abriste el formulario. Conservamos tu borrador: vuelve atrás o cancela y revisa los datos actualizados antes de iniciar otro registro.</div> : null}
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}{storageError ? <div role="alert" className={styles.error}>{storageError}{invalidRecovery ? <button type="button" className={styles.secondary} onClick={() => { if (!window.confirm('Revisa los pagos del historial antes de descartar esta copia no verificable. ¿Descartar la copia local?')) return; try { persistRecovery(null, false); setInvalidRecovery(false); setStorageError(''); } catch { setError('No se pudo acceder a la copia de recuperación.'); } }}>Descartar copia de recuperación</button> : null}</div> : null}{success && active && !showHistory ? <div role="status" className={styles.successToast}><ChargeIcon name="check"/>{success}</div> : null}
    {pending && !busy ? <div className={styles.notice}><ChargeIcon name="info"/><div>El resultado todavía no está confirmado. Reintentar conserva la misma solicitud y evita duplicados.<div style={{ marginTop: 9 }}><button type="button" className={styles.primary} onClick={() => void perform(pending)}>Reintentar la misma operación</button></div></div></div> : null}
    {!record ? <button type="button" className={styles.secondary} onClick={() => void reload()}>Volver a cargar</button> : <>
    <div className={styles.refresh}><div className={styles.accessStatus}>{canManage && active && !showHistory && !record.blocker ? <><span role="status"><ChargeIcon name="info"/>{editSession.message}</span>{!editSession.owned && !editSession.loading ? <button type="button" className={styles.link} disabled={busy} onClick={() => { void read(); editSession.retry(); }}>Recuperar acceso de edición</button> : null}</> : <span className={styles.muted} role="status">{loading ? 'Consultando datos actuales…' : `Última consulta · ${dateLabel(new Date(updatedAt).toISOString())}`}</span>}</div><button type="button" className={styles.link} disabled={busy || Boolean(pending) || loading} onClick={() => void reload()}>{loading ? 'Actualizando…' : 'Actualizar importes'}</button></div>
    {editing ? <div className={styles.draftStatus} role="status">{recovered ? 'Borrador recuperado. ' : ''}Trabajos pendientes de confirmar · {draftSaved ? 'Borrador conservado en esta pestaña' : 'Conservando borrador…'}</div> : null}
    {recoveryConflict ? <div className={styles.notice}><div><strong>Los datos guardados cambiaron desde este borrador.</strong><p>Compara los trabajos y pagos actuales antes de continuar. Tu selección se conserva.</p><details><summary>Ver trabajos guardados actualmente</summary><ChargeLineSummary record={record}/></details><label className={styles.check}><input type="checkbox" checked={recoveryReviewed} onChange={event => setReviewRecovery(event.target.checked ? currentBaseline : '')}/>Revisé los trabajos y pagos guardados y quiero continuar con este borrador.</label><button type="button" className={styles.secondary} disabled={accessBlocked || !recoveryReviewed} onClick={() => { if (accessBlocked || !recoveryReviewed) return; setDraftBaseline(currentBaseline); setEditingVersion(version); setRecoveringDraft(false); setReviewed(false); setCandidateFingerprint(''); setReviewRecovery(''); }}>Continuar con este borrador</button></div></div> : null}
    {record.blocker ? <div className={styles.error} role="alert">{record.blocker}</div> : null}
    {showHistory ? <section className={styles.panel}><h3 className={styles.heading}><ChargeIcon name="history"/>Historial de importes y pagos</h3>{record.history.length ? <ol className={styles.history}>{record.history.map(event => <li key={event.id}><strong>{historyLabels[event.action] || event.action}</strong><small>{dateLabel(event.at)} · {event.actor.name || 'Usuario registrado'} · Versión {event.version}</small>{event.after ? <p>{chargeMoney(event.after.totalCents)} · {event.after.note}</p> : null}{event.amountCents !== undefined ? <p>{chargeMoney(event.amountCents)}</p> : null}{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol> : <div className={styles.empty}>Todavía no hay movimientos registrados.</div>}<ChargeNotice>El estimado original se conserva. Cada cambio y anulación mantiene su responsable, fecha y motivo. Se muestran los últimos 100 movimientos.</ChargeNotice></section> : <>
    {editing ? <div className={styles.metrics}>
      <Metric icon="receipt" label="PROYECCIÓN ORIGINAL" value={state?.originalEstimate?.totalCents} note="Solo referencia del booking"/>
      <Metric icon="receipt" label="TOTAL DE TRABAJOS" value={totals?.totalCents ?? null} note={quoting ? 'Consultando tarifas…' : 'Borrador · sin confirmar'} color={styles.violet}/>
      <Metric icon="money" label="TOTAL RECIBIDO" value={totals?.receivedCents} note="Pagos guardados" color={styles.green}/>
      <Metric icon="clock" label={balance !== null && balance < 0 ? 'A FAVOR ESTIMADO' : 'SALDO ESTIMADO'} value={balance === null ? null : Math.abs(balance)} color={styles.amber} note={balance === null ? 'Requiere un borrador válido' : 'Según este borrador'}/>
    </div> : <ChargeOverviewMetrics record={record}/>}

    <div className={styles.columns}>
      <section className={`${styles.panel} ${styles.workPanel} ${!editing && !state?.final ? styles.emptyWorkPanel : ''}`} aria-label="Trabajos e importes"><div className={styles.panelHeader}><div className={styles.panelTitle}><span className={styles.tile}><ChargeIcon name="work"/></span><div><h3 className={styles.heading}>{editing ? 'Trabajos realizados y monto final' : 'Trabajos e importes'}</h3>{!editing ? <p>{state?.final ? 'Importe final confirmado' : 'Añade los servicios, productos y adicionales realizados'}</p> : null}</div></div>{!editing && state?.final ? <button type="button" className={styles.secondary} disabled={blocked || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onClick={() => startEdit()}><ChargeIcon name="edit"/>Editar trabajos</button> : null}</div>
      <div className={styles.workScroll} tabIndex={0} aria-label="Lista de trabajos y detalles">
      {editing ? <ChargeLinesEditor lines={lines} quote={quote} loading={quoting} disabled={blocked || editingConflict} onChange={value => { setLines(value); setReviewed(false); }}/> : state?.final ? <ChargeLineSummary record={record}/> : null}

      {record.candidateEvidence?.records.length ? <ChargeNotice><strong>Trabajos revisados en Field</strong><p>Contrasta estos conceptos con el monto final. No se suman automáticamente.</p>{record.candidateEvidence.records.map(candidate => <div key={candidate.id}><small>Revisión {candidate.revisionNumber}</small>{candidate.lines.map((line, index) => <div key={index}>{line.description} · {line.quantity} · {chargeMoney(Math.round(line.lineTotal * 100))}</div>)}{candidate.blockers.map((blocker, index) => <div key={index}>{blocker.message}</div>)}</div>)}{editing === 'final' ? <label className={styles.check}><input type="checkbox" disabled={blocked} checked={candidateReviewed} onChange={event => setCandidateFingerprint(event.target.checked ? record.candidateEvidence?.fingerprint || '' : '')}/>Concilié los conceptos Field en este total, sin duplicarlos.</label> : null}</ChargeNotice> : null}
      {editing ? <><details className={styles.scopeDetails} open={reasonRequired || undefined}><summary>{reasonRequired ? 'Motivo del cambio (obligatorio)' : 'Añadir nota del trabajo (opcional)'}</summary><label>Motivo / detalle del alcance{reasonRequired ? ' *' : ''}<textarea maxLength={1000} rows={2} value={note} disabled={blocked} onChange={event => setNote(event.target.value)} placeholder="Describe el cambio de servicio o adicionales"/></label></details>{quoteError ? <div className={styles.error} role="alert">{quoteError}</div> : null}</> : <>
      {estimate ? <details className={styles.priorEstimate}><summary>Ver proyección del booking · {chargeMoney(estimate.totalCents)}</summary><ChargeLineSummary record={{ ...record, state: state ? { ...state, final: null } : null }}/></details> : null}
      </>}
      </div>
      <ChargeAddSearch disabled={blocked || editingConflict || (editing ? lines.length >= 60 : (state?.final?.lines.length || 0) >= 60) || ['cancelled','canceled','temporary_hold'].includes(record.appointmentStatus)} onAdd={addActual}/>
      </section>
      <section className={`${styles.panel} ${styles.paymentsPanel}`} aria-label="Pagos de la visita"><div className={styles.panelHeader}><div className={styles.panelTitle}><span className={`${styles.tile} ${styles.green}`}><ChargeIcon name="money"/></span><div><h3 className={styles.heading}>Pagos de la visita</h3><p>Pagos registrados para esta cita</p></div></div><span className={`${styles.paymentStatus} ${!editing && totals?.paymentStatus === '✓ Pagado' ? styles.paidStatus : ''}`}>{record.blocker ? 'Por conciliar' : editing ? 'Borrador en edición' : totals?.paymentStatus}</span></div>
        {record.payments.length ? [...record.payments].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map(item => <div className={`${styles.payment} ${item.status === 'voided' ? styles.voided : ''}`} key={item.id}><span className={`${styles.tile} ${item.method === 'cash' ? styles.green : ''}`}><ChargeIcon name={methodIcon[item.method] || 'money'}/></span><div><strong>{paymentMethods.find(method => method.id === item.method)?.label || item.method}</strong><small>{dateLabel(item.receivedAt)}</small>{item.status === 'voided' ? <small>Anulado · {item.voidReason}</small> : null}<details className={styles.paymentDetails}><summary>Ver detalle del pago</summary><small>{item.reference || 'Sin referencia'}</small><small>Registrado por {item.createdByName || 'Oficina'}</small>{item.note ? <small>{item.note}</small> : null}{item.status === 'voided' ? null : <button type="button" disabled={blocked || editingConflict || paymentConflict} onClick={() => { const reason = window.prompt('Motivo de la anulación del registro (no realiza un reembolso):'); if (reason?.trim()) save('void_appointment_payment', { paymentId: item.id, reason }); }}>Anular registro</button>}</details></div><strong className={styles.paymentAmount}>{chargeMoney(item.amountCents)}</strong></div>) : <div className={styles.empty}>{record.blocker ? 'Consulta el aviso de conciliación antes de registrar pagos.' : 'Sin pagos registrados en este historial.'}</div>}
        <div className={styles.receivedStrip}><strong>Total recibido</strong><strong>{chargeMoney(totals?.receivedCents)}</strong></div>
        {balance !== null ? <div className={`${styles.balanceStrip} ${!editing && balance === 0 ? styles.settledStrip : ''}`}><strong>{editing ? balance < 0 ? 'A favor estimado' : 'Saldo estimado' : balance < 0 ? 'Saldo a favor' : 'Saldo por cobrar'}</strong><strong>{chargeMoney(Math.abs(balance))}</strong></div> : null}
        {payment ? <div className={styles.paymentForm}><PaymentFields value={payment} onChange={setPayment} disabled={blocked}/><div className={styles.footer}><button type="button" className={styles.secondary} disabled={busy || Boolean(pending)} onClick={() => setPayment(null)}>Cancelar</button><button type="button" className={styles.primary} disabled={blocked || paymentConflict || editingConflict || !payment.amount} onClick={() => save('record_appointment_payment', { payment })}>Guardar pago</button></div></div> : <div className={styles.paymentEntry}><h4>Registrar depósito, abono o pago</h4><div className={styles.methodShortcuts}>{paymentMethods.map(method => <button key={method.id} type="button" disabled={blocked || editingConflict || record.appointmentStatus === 'temporary_hold'} onClick={() => startPayment(method.id)}><ChargeIcon name={methodIcon[method.id]}/>{method.label}</button>)}</div><button type="button" className={styles.primary} disabled={blocked || editingConflict || record.appointmentStatus === 'temporary_hold'} onClick={() => startPayment()}><ChargeIcon name="plus"/>Registrar pago</button></div>}
        {onShowHistory ? <button type="button" className={styles.historyShortcut} disabled={busy || Boolean(pending)} onClick={onShowHistory}><ChargeIcon name="history"/>Ver movimientos</button> : null}
        {payment ? <ChargeNotice>Registra un pago ya recibido. Este formulario no realiza cargos en POS o SUAVE.</ChargeNotice> : null}
      </section>
    </div>
    <footer className={styles.workspaceFooter}>
      <div>{editing ? <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={blocked} onChange={event => setReviewed(event.target.checked)}/>Revisé los trabajos realizados, los adicionales y el importe acordado con el cliente.</label> : <span className={styles.auditFooter}><ChargeIcon name="info"/>Todos los cambios quedan en el historial.</span>}</div>
      <div className={styles.footerActions}>
        {editing ? <><button type="button" disabled={busy || Boolean(pending)} className={styles.secondary} onClick={discardDraft}>Descartar borrador</button><button type="button" aria-label="Confirmar monto final" disabled={blocked || editingConflict || paymentConflict || quoting || !quote || !reviewed || quote.totalCents === null || (reasonRequired && !note.trim()) || (Boolean(record.candidateEvidence?.records.length) && !candidateReviewed)} className={styles.primary} onClick={() => save('finalize_appointment_charges', { lines, note, scopeReviewed: reviewed, quoteToken: quote?.quoteToken, candidateReviewed, candidateFingerprint })}>{busy ? 'Guardando…' : `Confirmar monto final${quote?.totalCents != null ? ` · ${chargeMoney(quote.totalCents)}` : ''}`}</button></> : <>
          <button type="button" className={styles.secondary} disabled={!state?.final || Boolean(record.blocker) || busy || Boolean(pending) || loading || Boolean(readError) || pdfBusy || !documentContext} onClick={() => void downloadPdf()} title="Resumen de trabajos y pagos confirmados de esta cita"><ChargeIcon name="receipt"/>{pdfBusy ? 'Preparando PDF…' : 'Descargar PDF'}</button>
          {onClose ? <button type="button" className={styles.secondary} disabled={busy || Boolean(pending)} onClick={onClose}>Cerrar</button> : null}
        </>}
        {!editing && !payment && !busy && !pending && !loading && !readError && active && !showHistory ? <AppointmentQuickBooksPreviewButton key={`${currentUserId}:${appointmentId}:${version}`} appointmentId={appointmentId} currentUserId={currentUserId} expectedVersion={version}/> : null}
      </div>
    </footer></>}
    </>}
  </div>;
}
