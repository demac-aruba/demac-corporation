'use client';

import { useEffect, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  cancelOfficeAppointment,
  confirmOfficeTemporaryHold,
  createOfficeLifecycleRequestId,
  getOfficeAppointment,
} from '../../lib/office-booking-authority';
import { AppointmentCommunicationPanel } from './appointment-communication-panel';
import { LiveAppointmentEditPanel } from './live-appointment-edit-panel';
import { PartialCompletionPanel } from './partial-completion-panel';
import { AppointmentRescheduleSchedulePicker } from './remaining-work-schedule-picker';
import styles from './scheduling-overview-v2.module.css';

type Mode = 'details' | 'edit' | 'reschedule' | 'cancel' | 'outcome';

type Props = {
  appointment: BrowserAppointmentRecord;
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
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function formatDateTime(value?: string) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    timeZone: 'America/Aruba', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function durationLabel(minutes?: number) {
  const value = Number(minutes || 0);
  if (!value) return 'Not recorded';
  const hours = value / 60;
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))} hour${hours === 1 ? '' : 's'}`;
}

function sourceLabel(value?: string) {
  if (value === 'demac-customer-agent') return 'Maya / AI Customer Agent';
  if (value === 'office-scheduling') return 'Office Scheduling';
  return value || 'Not recorded';
}

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? styles.wide : undefined}><span style={{ color: 'var(--muted)', fontSize: 7 }}>{label}</span><strong style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</strong></div>;
}

export function LiveAppointmentDetailsDrawer({ appointment, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('details');
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
  const canManageLifecycle = Boolean(appointment.customerId && appointment.siteId && appointment.status !== 'cancelled');
  const temporaryHold = appointment.status === 'temporary_hold';
  const workLabel = appointment.workLabel || appointment.workTypeId?.replaceAll('_', ' ') || appointment.customerFacingDescription || 'Scheduled work';

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

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Appointment ${appointment.id}`}>
      <header className={styles.drawerHeader}>
        <div>
          <span>{partialOutcome ? 'Partial completion' : temporaryHold ? 'Temporary hold' : 'Live appointment'} · Booking Authority</span>
          <h2>{appointment.customer}</h2>
          <p>{appointment.propertyAddress || appointment.site} · {appointment.sector}</p>
        </div>
        <button type="button" disabled={busy} onClick={onClose}>×</button>
      </header>

      <div className={styles.drawerBody}>
        <section className={styles.formSection}>
          <header><strong>Appointment &amp; work</strong><span>{appointment.status === 'cancelled' ? 'Cancelled' : `${temporaryHold ? 'Temporary hold · ' : ''}${formatDate(appointment.dateKey)} · Van capacity ${formatTime(primary?.start)}–${formatTime(primaryCapacityEnd)}`}</span></header>
          <div className={styles.formGrid}>
            <Field wide label="WORK TYPE" value={`${workLabel} · ${appointment.totalQuantity} unit${appointment.totalQuantity === 1 ? '' : 's'}`} />
            <Field label="TIME / UNIT" value={durationLabel(appointment.durationMinutesPerUnit)} />
            <Field label="TOTAL WORK" value={durationLabel(appointment.scheduledDurationMinutes)} />
            <Field label="CAPACITY SPOTS" value={appointment.scheduledSlotCount ? `${appointment.scheduledSlotCount} spot${appointment.scheduledSlotCount === 1 ? '' : 's'}` : 'Not recorded'} />
            <Field label="PRIMARY WORK ESTIMATE" value={primary ? `${formatTime(primary.start)}–${formatTime(primary.end)}` : 'Not recorded'} />
            <Field label="CAPACITY WINDOW" value={primary ? `${formatTime(primary.start)}–${formatTime(primaryCapacityEnd)}` : 'Not recorded'} />
            <Field label="PRIMARY VAN" value={primary?.vanId?.replace('VAN-', 'Van ') || '—'} />
            <Field label="SUPPORT VAN" value={support?.vanId.replace('VAN-', 'Van ') || 'None'} />
            {support ? <Field label="SUPPORT WORK ESTIMATE" value={`${formatTime(support.start)}–${formatTime(support.end)}`} /> : null}
            {support ? <Field label="SUPPORT CAPACITY WINDOW" value={`${formatTime(support.start)}–${formatTime(supportCapacityEnd)}`} /> : null}
            <Field wide label="CUSTOMER-FACING DESCRIPTION" value={appointment.customerFacingDescription} />
          </div>
        </section>

        {partialOutcome ? <section className={styles.formSection} style={{ borderColor: 'var(--warning, #f59e0b)' }}>
          <header><strong style={{ color: 'var(--warning, #b45309)' }}>PARTIAL COMPLETION · ACTUAL OUTCOME</strong><span>Executed history preserved</span></header>
          <div className={styles.descriptionPreview} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
            <div><span>PLANNED</span><strong style={{ fontSize: 17 }}>{partialOutcome.plannedQuantity}</strong></div>
            <div><span>COMPLETED</span><strong style={{ fontSize: 17 }}>{partialOutcome.completedQuantity}</strong></div>
            <div><span>REMAINING</span><strong style={{ fontSize: 17 }}>{partialOutcome.remainingQuantity}</strong></div>
          </div>
          <div className={styles.descriptionPreview}>
            <span>CREW RELEASED {formatTime(partialOutcome.actualEndTime)}</span>
            <strong>{partialOutcome.reason || 'Partial work recorded.'}{partialOutcome.remainingWorkStatus === 'scheduled' && partialOutcome.followUpAppointmentId ? ` Remaining work is linked to ${partialOutcome.followUpAppointmentId}.` : ' Remaining work is pending scheduling.'}</strong>
          </div>
        </section> : null}

        {temporaryHold ? <section className={styles.formSection} style={{ borderColor: 'var(--warning, #f59e0b)' }}>
          <header><strong style={{ color: 'var(--warning, #b45309)' }}>TEMPORARY HOLD · CAPACITY RESERVED</strong><span>Customer is not confirmed</span></header>
          <div className={styles.descriptionPreview}><span>COMMUNICATION PAUSED</span><strong>This hold owns the canonical Van/time capacity, but customer confirmation and reminder communication stay disabled until an office user confirms the hold.</strong></div>
        </section> : null}

        <section className={styles.formSection}>
          <header><strong>Customer</strong><span>Canonical CRM relationship</span></header>
          <div className={styles.formGrid}>
            <Field label="CUSTOMER / COMPANY" value={appointment.customer} />
            <Field label="PREFERRED LANGUAGE" value={appointment.customerPreferredLanguage || 'Not recorded'} />
            <Field label="PHONE" value={appointment.customerPhone || 'Not recorded'} />
            <Field label="WHATSAPP" value={appointment.customerWhatsapp || 'Not recorded'} />
            <Field wide label="EMAIL" value={appointment.customerEmail || 'Not recorded'} />
          </div>
        </section>

        <section className={styles.formSection}>
          <header><strong>Job location</strong><span>Where the appointment will be executed</span></header>
          <div className={styles.formGrid}>
            <Field label="LOCATION" value={appointment.site} />
            <Field label="AREA / ZONE" value={appointment.sector} />
            <Field wide label="ADDRESS" value={appointment.propertyAddress || 'Not recorded'} />
            <Field wide label="ACCESS INSTRUCTIONS" value={appointment.propertyAccessInstructions || 'None'} />
          </div>
        </section>

        <section className={styles.formSection}>
          <header><strong>Booking audit</strong><span>Who created it and when</span></header>
          <div className={styles.formGrid}>
            <Field label="BOOKED BY" value={appointment.bookedByName || 'Not recorded'} />
            <Field label="SOURCE" value={sourceLabel(appointment.bookedBySource)} />
            <Field label="BOOKING CREATED" value={formatDateTime(appointment.createdAt)} />
            <Field label="CONFIRMED" value={temporaryHold ? 'Not confirmed — capacity held' : formatDateTime(appointment.confirmedAt)} />
            <Field label="LAST UPDATED" value={formatDateTime(appointment.updatedAt)} />
            <Field label="WORK ORDER" value={appointment.workOrderIds?.join(', ') || appointment.workOrderId || 'Not recorded'} />
            <Field wide label="APPOINTMENT ID" value={appointment.id} />
          </div>
        </section>

        {temporaryHold ? <section className={styles.formSection}>
          <header><strong>Customer communication</strong><span>Paused while temporary hold</span></header>
          <div className={styles.descriptionPreview}><span>NO CUSTOMER MESSAGE IS ACTIVE</span><strong>Recipient intent is preserved on the canonical hold and becomes eligible only after the hold is manually confirmed.</strong></div>
        </section> : <AppointmentCommunicationPanel appointmentId={appointment.id} />}

        {mode === 'details' ? <section className={styles.formSection}>
          <header><strong>Manage {partialOutcome ? 'actual outcome' : temporaryHold ? 'temporary hold' : 'appointment'}</strong><span>{partialOutcome ? 'Executed history is locked. Continue by scheduling the canonical remaining work.' : 'All changes go through Booking Authority so capacity locks and Work Orders remain synchronized.'}</span></header>
          {temporaryHold ? <div style={{ padding: '11px 11px 0' }}><button type="button" className={styles.primary} style={{ width: '100%' }} disabled={!canManageLifecycle || busy} onClick={() => void confirmHold()}>{busy ? 'Confirming hold…' : 'Confirm temporary hold'}</button></div> : null}
          {partialOutcome ? <div style={{ padding: 11 }}><button type="button" className={styles.primary} style={{ width: '100%' }} disabled={!canManageLifecycle || busy} onClick={() => begin('outcome')}>{partialOutcome.remainingWorkStatus === 'scheduled' ? 'Review Actual Outcome' : `Schedule Remaining ${partialOutcome.remainingQuantity}`}</button></div> : <div style={{ display: 'grid', gridTemplateColumns: temporaryHold ? 'repeat(3,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 8, padding: 11 }}>
            <button type="button" className={styles.secondary} disabled={!canManageLifecycle || busy} onClick={() => begin('edit')}>Edit Appointment</button>
            <button type="button" className={styles.secondary} disabled={!canManageLifecycle || busy} onClick={() => begin('reschedule')}>Reschedule</button>
            {!temporaryHold ? <button type="button" className={styles.secondary} disabled={!canManageLifecycle || busy} onClick={() => begin('outcome')}>Record Actual Outcome</button> : null}
            <button type="button" className={styles.secondary} disabled={!canManageLifecycle || busy} onClick={() => begin('cancel')} style={{ color: 'var(--danger)' }}>{temporaryHold ? 'Cancel Hold' : 'Cancel Appointment'}</button>
          </div>}
          {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
          {!canManageLifecycle && appointment.status !== 'cancelled' ? <div className={styles.descriptionPreview}><span>CANONICAL RELATIONSHIP REQUIRED</span><strong>This appointment cannot be changed until its customer and property IDs are resolved.</strong></div> : null}
        </section> : null}

        {mode === 'edit' ? <LiveAppointmentEditPanel appointment={appointment} onBack={() => begin('details')} onSaved={async () => { await onChanged(); onClose(); }} /> : null}

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
    </aside>
  </div>;
}
