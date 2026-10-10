'use client';

import { SavedVisitReferences } from './booking-visit-references';
import { AppointmentChargesWorkspace } from './appointment-charges';
import { ChargeIcon } from './appointment-charge-icons';
import { useBookingDialog } from './use-booking-dialog';
import chargeStyles from './appointment-charges.module.css';
import ui from './appointment-detail.module.css';

import { useEffect, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import { canOfferRegularHistoricalCapacityCorrection } from '../../lib/regular-historical-capacity';
import { assignmentReservedSlots, hasServiceWorkEstimate, schedulingWorkSummary } from '../../lib/scheduling-card-presentation';
import {
  cancelOfficeAppointment,
  confirmOfficeTemporaryHold,
  createOfficeLifecycleRequestId,
  getOfficeAppointment,
} from '../../lib/office-booking-authority';
import { AppointmentCommunicationPanel } from './appointment-communication-panel';
import { LiveAppointmentEditPanel } from './live-appointment-edit-panel';
import { PartialCompletionPanel } from './partial-completion-panel';
import { RegularHistoricalCapacityPanel } from './regular-historical-capacity-panel';
import { AppointmentRescheduleSchedulePicker } from './remaining-work-schedule-picker';
import styles from './scheduling-overview-v2.module.css';

type Mode = 'details' | 'edit' | 'reschedule' | 'cancel' | 'outcome' | 'capacity';

type Props = {
  appointment: BrowserAppointmentRecord;
  project?: import('../../lib/scheduling-project-labels').SchedulingProjectLabel;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

type PartialOutcomeSummary = {
  plannedQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  actualEndTime: string;
  reason: string;
  remainingWorkStatus: string;
  followUpAppointmentId?: string;
};

const cancellationReasons = [
  'Customer cancelled service',
  'Customer no longer needs service',
  'Customer unavailable',
  'No one will be at the property',
  'Access unavailable',
  'Duplicate / booking error',
  'Other',
];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function partialOutcomeSummary(value: unknown): PartialOutcomeSummary | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (text(record.status) !== 'partial') return null;
  const plannedQuantity = Math.max(0, Math.round(Number(record.plannedQuantity) || 0));
  const completedQuantity = Math.max(0, Math.round(Number(record.completedQuantity) || 0));
  const remainingQuantity = Math.max(0, Math.round(Number(record.remainingQuantity) || 0));
  const actualEndTime = text(record.actualEndTime);
  if (!plannedQuantity || !completedQuantity || !actualEndTime) return null;
  return {
    plannedQuantity,
    completedQuantity,
    remainingQuantity,
    actualEndTime,
    reason: text(record.reason),
    remainingWorkStatus: text(record.remainingWorkStatus) || 'pending_schedule',
    followUpAppointmentId: text(record.followUpAppointmentId) || undefined,
  };
}

function formatTime(value?: string) {
  if (!value) return '—';
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function formatDateTime(value?: string) {
  if (!value) return 'Sin registrar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es', {
    timeZone: 'America/Aruba', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function durationLabel(minutes?: number) {
  const value = Number(minutes || 0);
  if (!value) return 'Sin registrar';
  const hours = value / 60;
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))} hora${hours === 1 ? '' : 's'}`;
}

function sourceLabel(value?: string) {
  if (value === 'demac-customer-agent') return 'Maya / AI Customer Agent';
  if (value === 'office-scheduling') return 'Office Scheduling';
  return value || 'Not recorded';
}

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={`${ui.field} ${wide ? ui.wide : ''}`}><span>{label}</span><strong>{value || '—'}</strong></div>;
}

export function LiveAppointmentDetailsDrawer({ appointment, project, canManage, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('details');
  const [tab, setTab] = useState<'details' | 'charges' | 'history'>('details');
  const [chargeBusy, setChargeBusy] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [communicationBusy, setCommunicationBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [partialOutcome, setPartialOutcome] = useState<PartialOutcomeSummary | null>(null);

  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment && assignment.status !== 'cancelled');
  const primaryCapacityEnd = primary?.capacityEnd || primary?.end;
  const supportCapacityEnd = support?.capacityEnd || support?.end;
  const primarySlotCount = primary ? assignmentReservedSlots(primary) : undefined;
  const canManageLifecycle = Boolean(canManage && appointment.customerId && appointment.siteId && appointment.status !== 'cancelled');
  const temporaryHold = appointment.status === 'temporary_hold';
  const workLabel = schedulingWorkSummary(appointment, undefined, project);
  const serviceEstimate = hasServiceWorkEstimate(appointment, project);
  const canCorrectHistoricalCapacity = canManage && !partialOutcome
    && canOfferRegularHistoricalCapacityCorrection(appointment, Boolean(project));

  const refreshPartialOutcome = async () => {
    try {
      const result = await getOfficeAppointment(appointment.id);
      setPartialOutcome(partialOutcomeSummary(result.appointment.executionOutcome));
    } catch {
      // Supplemental lifecycle metadata must never hide base appointment details.
    }
  };

  useEffect(() => {
    let active = true;
    void getOfficeAppointment(appointment.id)
      .then((result) => { if (active) setPartialOutcome(partialOutcomeSummary(result.appointment.executionOutcome)); })
      .catch(() => {});
    return () => { active = false; };
  }, [appointment.id]);

  const begin = (next: Mode) => {
    setMoreOpen(false);
    setMode(next);
    setReason('');
    setNote('');
    setError('');
  };

  const backFromOutcome = () => {
    begin('details');
    void refreshPartialOutcome();
  };

  const confirmHold = async () => {
    if (!temporaryHold || busy) return;
    setBusy(true);
    setError('');
    try {
      await confirmOfficeTemporaryHold({ appointmentId: appointment.id, requestId: createOfficeLifecycleRequestId('confirm-hold') });
      await onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The temporary hold could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!reason) {
      setError(`Select a cancellation reason for this ${temporaryHold ? 'hold' : 'appointment'}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await cancelOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('cancel'),
        reason,
        note,
      });
      await onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${temporaryHold ? 'temporary hold' : 'appointment'} could not be cancelled.`);
    } finally {
      setBusy(false);
    }
  };

  const blocked = busy || chargeBusy || referenceBusy || communicationBusy;
  const dialogRef = useBookingDialog(onClose, blocked);
  const chargeSeeds = (appointment.workSummaryLines?.length ? appointment.workSummaryLines : [{ label: workLabel, quantity: appointment.totalQuantity }]).map((line, index) => ({ id: `work-${index + 1}`, label: line.label, quantity: line.quantity || 1, ...(index === 0 && !appointment.workSummaryLines?.length ? { presetId: appointment.workTypeId || appointment.presetId, serviceId: appointment.serviceId } : {}) }));

  const initials = appointment.customer.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const outcomeAction = partialOutcome ? partialOutcome.remainingWorkStatus === 'scheduled' ? 'Revisar resultado' : `Agendar ${partialOutcome.remainingQuantity} pendientes` : 'Registrar resultado';
  return <div className={chargeStyles.modalOverlay} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !blocked) onClose(); }}>
    <aside className={`${chargeStyles.modal} ${ui.modal}`} data-booking-modal ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Detalle de la cita · ${appointment.customer}`}>
      <header className={ui.header}>
        <div><span className={ui.eyebrow}>DEMAC · SCHEDULING</span><h2>Detalle de la cita</h2></div>
        <div className={ui.headerActions}>
          {tab === 'details' && mode === 'details' && !partialOutcome ? <button type="button" className={ui.button} disabled={!canManageLifecycle || blocked} onClick={() => begin('edit')}><ChargeIcon name="edit"/>Editar cita</button> : null}
          <button type="button" className={ui.close} disabled={blocked} aria-label="Cerrar cita" onClick={onClose}>×</button>
        </div>
      </header>
      <div className={ui.context}>
        <div><ChargeIcon name="calendar"/><span>{formatDate(appointment.dateKey)}</span></div>
        <div><ChargeIcon name="clock"/><span>{formatTime(primary?.start)}–{formatTime(primaryCapacityEnd)}</span></div>
        <div><ChargeIcon name="van"/><span>{primary?.vanId?.replace('VAN-', 'Van ') || 'Sin van asignada'}</span></div>
      </div>
      <nav className={chargeStyles.modalTabs} aria-label="Secciones de la cita">{([{ id: 'details', label: 'Resumen', icon: 'clipboard' }, { id: 'charges', label: 'Importes y pagos', icon: 'receipt' }, { id: 'history', label: 'Historial', icon: 'history' }] as const).map(item => <button key={item.id} type="button" disabled={blocked || mode !== 'details'} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? chargeStyles.active : ''} onClick={() => { setMoreOpen(false); setTab(item.id); }}><ChargeIcon name={item.icon}/>{item.label}</button>)}</nav>
      <div className={ui.body}>
        {tab === 'history' ? <div className={ui.history}>
          <section className={ui.card} aria-label="Auditoría de la cita">
            <div className={ui.cardHeader}><span className={ui.tile}><ChargeIcon name="history"/></span><div><h3>Historial de la reserva</h3><p>Creación, confirmación y referencias de la cita</p></div></div>
            <div className={ui.fields}>
              <Field label="Creada por" value={appointment.bookedByName}/><Field label="Origen" value={sourceLabel(appointment.bookedBySource)}/>
              <Field label="Creación" value={formatDateTime(appointment.createdAt)}/><Field label="Confirmación" value={temporaryHold ? 'Reserva pendiente de confirmar' : formatDateTime(appointment.confirmedAt)}/>
              <Field label="Última actualización" value={formatDateTime(appointment.updatedAt)}/><Field label="Orden de trabajo" value={appointment.workOrderIds?.join(', ') || appointment.workOrderId}/>
              <Field wide label="Identificador de cita" value={appointment.id}/>
            </div>
          </section>
        </div> : null}
        <div className={tab === 'details' ? ui.hidden : undefined}><AppointmentChargesWorkspace key={appointment.id} appointmentId={appointment.id} seeds={chargeSeeds} canManage={canManage} active={tab !== 'details'} showHistory={tab === 'history'} onBusyChange={setChargeBusy} onChanged={onChanged}/></div>
        <div className={tab === 'details' ? undefined : ui.hidden}>
          <div className={mode === 'details' ? undefined : ui.hidden}>
            {appointment.status === 'cancelled' ? <div className={ui.notice} role="status"><strong>Cita cancelada</strong>La información y el historial se conservan.</div> : null}
            {temporaryHold ? <div className={ui.notice} role="status"><strong>Reserva temporal · Capacidad reservada</strong>La confirmación y los recordatorios permanecen pausados hasta confirmar esta reserva.</div> : null}
            {partialOutcome ? <div className={ui.notice} role="status"><strong>Trabajo completado parcialmente</strong><div className={ui.pills}><span>Planificado: {partialOutcome.plannedQuantity}</span><span>Completado: {partialOutcome.completedQuantity}</span><span>Pendiente: {partialOutcome.remainingQuantity}</span></div><p>Equipo liberado: {formatTime(partialOutcome.actualEndTime)} · {partialOutcome.reason}</p><p>{partialOutcome.remainingWorkStatus === 'scheduled' && partialOutcome.followUpAppointmentId ? `Seguimiento: ${partialOutcome.followUpAppointmentId}` : 'Trabajo pendiente por agendar.'}</p></div> : null}
            <div className={ui.grid}>
              <div className={ui.column}>
                <section className={ui.card} aria-label="Trabajo programado">
                  <div className={ui.cardHeader}><span className={ui.tile}><ChargeIcon name="clipboard"/></span><div><h3>Trabajo programado</h3><p>Servicio a realizar en esta cita</p></div></div>
                  <div className={ui.service}><span className={ui.tile}><ChargeIcon name={project ? 'work' : 'air'}/></span><div><strong>{workLabel}</strong><div className={ui.pills}>{serviceEstimate ? <span className={ui.pill}><ChargeIcon name="clock"/>{durationLabel(appointment.scheduledDurationMinutes)} estimada{appointment.scheduledDurationMinutes === 60 ? '' : 's'}</span> : null}<span className={ui.pill}><ChargeIcon name="grid"/>{primary ? primarySlotCount ?? 'Sin verificar' : 'Sin registrar'} cupo{primarySlotCount === 1 ? '' : 's'} reservado{primarySlotCount === 1 ? '' : 's'}</span>{support ? <span className={ui.pill}><ChargeIcon name="van"/>Apoyo: {support.vanId.replace('VAN-', 'Van ')}</span> : null}</div></div></div>
                  <details className={ui.disclosure}><summary><ChargeIcon name="chevron"/>Detalle técnico y capacidad</summary><div className={ui.fields}>
                    {serviceEstimate && (appointment.workSummaryLines?.length ?? 0) === 1 ? <Field label="Tiempo por unidad" value={durationLabel(appointment.durationMinutesPerUnit)}/> : null}
                    {serviceEstimate ? <Field label="Trabajo técnico estimado" value={durationLabel(appointment.scheduledDurationMinutes)}/> : null}
                    <Field label="Cupos reservados · Van principal" value={primary ? primarySlotCount ?? 'Sin verificar' : 'Sin registrar'}/>
                    {serviceEstimate ? <Field label="Horario estimado del trabajo · No libera la van" value={primary ? `${formatTime(primary.start)}–${formatTime(primary.end)}` : 'Sin registrar'}/> : null}
                    <Field label="Horario de capacidad reservada" value={primary ? `${formatTime(primary.start)}–${formatTime(primaryCapacityEnd)}` : 'Sin registrar'}/><Field label="Van principal" value={primary?.vanId.replace('VAN-', 'Van ')}/>
                    <Field label="Van de apoyo" value={support?.vanId.replace('VAN-', 'Van ') || 'Sin apoyo'}/>
                    {support && serviceEstimate ? <Field label="Trabajo estimado · Apoyo" value={`${formatTime(support.start)}–${formatTime(support.end)}`}/> : null}
                    {support ? <><Field label="Cupos reservados · Apoyo" value={assignmentReservedSlots(support) ?? 'Sin verificar'}/><Field label="Capacidad reservada · Apoyo" value={`${formatTime(support.start)}–${formatTime(supportCapacityEnd)}`}/></> : null}
                    <Field wide label="Descripción para el cliente" value={appointment.customerFacingDescription}/>
                  </div></details>
                </section>
                <SavedVisitReferences key={appointment.id} appointmentId={appointment.id} canEdit={canManage && appointment.status !== 'cancelled'} compact onBusyChange={setReferenceBusy}/>
              </div>
              <div className={ui.column}>
                <section className={ui.card} aria-label="Cliente y propiedad">
                  <div className={ui.cardHeader}><span className={ui.tile}><ChargeIcon name="person"/></span><div><h3>Cliente y propiedad</h3><p>Información del cliente y dirección</p></div></div>
                  <div className={ui.identity}><span className={ui.avatar}>{initials || '—'}</span><div><strong>{appointment.customer}</strong><p className={ui.muted}>{appointment.customerPreferredLanguage || 'Idioma sin registrar'}</p></div></div>
                  <div className={ui.contactRows}>
                    <div className={ui.contactRow}><ChargeIcon name="call"/><span>{appointment.customerPhone || appointment.customerWhatsapp || 'Teléfono sin registrar'}</span></div>
                    <div className={ui.contactRow}><ChargeIcon name="pin"/><div><p>{appointment.propertyAddress || appointment.site || 'Dirección sin registrar'}</p><p>{appointment.sector}</p></div></div>
                  </div>
                  <details className={ui.disclosure}><summary><ChargeIcon name="chevron"/>Contacto y acceso</summary><div className={ui.fields}><Field label="Teléfono" value={appointment.customerPhone}/><Field label="WhatsApp" value={appointment.customerWhatsapp}/><Field wide label="Correo electrónico" value={appointment.customerEmail}/><Field wide label="Propiedad" value={appointment.site}/><Field wide label="Indicaciones de acceso" value={appointment.propertyAccessInstructions || 'Sin indicaciones adicionales'}/></div></details>
                </section>
                {temporaryHold ? <section className={ui.card}><div className={ui.cardHeader}><span className={`${ui.tile} ${ui.green}`}><ChargeIcon name="whatsapp"/></span><div><h3>Comunicación pausada</h3><p>Disponible al confirmar la reserva</p></div></div></section> : <AppointmentCommunicationPanel appointmentId={appointment.id} compact onBusyChange={setCommunicationBusy}/>}
                <button type="button" className={ui.shortcut} disabled={blocked} onClick={() => setTab('charges')}><span className={ui.tile}><ChargeIcon name="receipt"/></span><span><strong>Importes y pagos</strong><small>Proyección, monto final y cobros</small></span><ChargeIcon name="arrow"/></button>
              </div>
            </div>
            {error ? <p className={ui.notice} role="alert">{error}</p> : null}
            {canManage && !canManageLifecycle && appointment.status !== 'cancelled' ? <p className={ui.notice}>Vincula el cliente y la propiedad antes de modificar esta cita.</p> : null}
          </div>
        {mode === 'edit' ? <LiveAppointmentEditPanel appointment={appointment} onBack={() => begin('details')} onSaved={async () => { await onChanged(); onClose(); }} /> : null}

        {mode === 'capacity' ? <RegularHistoricalCapacityPanel appointment={appointment} onBack={() => begin('details')} onSaved={onChanged} onBusyChange={setBusy} /> : null}

        {mode === 'outcome' ? <PartialCompletionPanel appointment={appointment} onBack={backFromOutcome} onSaved={async () => { await onChanged(); onClose(); }} /> : null}

        {mode === 'reschedule' ? <AppointmentRescheduleSchedulePicker
          appointment={appointment}
          onClose={() => begin('details')}
          onRescheduled={async () => { await onChanged(); onClose(); }}
        /> : null}

        {mode === 'cancel' ? <section className={styles.formSection}>
          <header><strong>Cancel {temporaryHold ? 'temporary hold' : 'appointment'}</strong><span>Cancellation releases the canonical capacity locks and cancels the linked Work Order(s).</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{cancellationReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
          <footer className={styles.drawerFooter}><div><span>{temporaryHold ? 'Temporary hold' : 'Appointment'}</span><strong>{appointment.customer} · {formatDate(appointment.dateKey)}</strong></div><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => begin('details')}>Back</button><button type="button" className={styles.primary} disabled={busy || !reason} onClick={() => void cancel()}>{busy ? 'Cancelling…' : temporaryHold ? 'Cancel Hold & Release Capacity' : 'Cancel Appointment'}</button></div></footer>
        </section> : null}
        </div>
      </div>
      {tab === 'details' && mode === 'details' ? <footer className={ui.footer}>
        {!partialOutcome ? <details className={ui.more} open={moreOpen}><summary className={ui.button} aria-disabled={blocked} onClick={event => { event.preventDefault(); if (!blocked) setMoreOpen(!moreOpen); }}><ChargeIcon name="more"/>Más acciones<ChargeIcon name="chevron"/></summary><div className={ui.menu}>
          {canCorrectHistoricalCapacity ? <button type="button" disabled={blocked} onClick={() => begin('capacity')}>Corregir cupos pasados</button> : null}
          <button type="button" className={ui.danger} disabled={!canManageLifecycle || blocked} onClick={() => begin('cancel')}>{temporaryHold ? 'Cancelar reserva' : 'Cancelar cita'}</button>
        </div></details> : <span/>}
        <div className={ui.footerActions}>
          {!partialOutcome ? <button type="button" className={ui.button} disabled={!canManageLifecycle || blocked} onClick={() => begin('reschedule')}><ChargeIcon name="calendar"/>Reprogramar</button> : null}
          {temporaryHold ? <button type="button" className={ui.primary} disabled={!canManageLifecycle || blocked} onClick={() => void confirmHold()}><ChargeIcon name="check"/>{busy ? 'Confirmando…' : 'Confirmar reserva'}</button> : <button type="button" className={ui.primary} disabled={!canManageLifecycle || blocked} onClick={() => begin('outcome')}><ChargeIcon name="check"/>{outcomeAction}</button>}
        </div>
      </footer> : null}
    </aside>
  </div>;
}
