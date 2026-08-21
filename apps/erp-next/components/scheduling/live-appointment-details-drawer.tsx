'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  cancelOfficeAppointment,
  checkOfficeRescheduleAvailability,
  createOfficeLifecycleRequestId,
  getOfficeAppointmentCommunication,
  rescheduleOfficeAppointment,
  sendOfficeAppointmentReminder,
  updateOfficeAppointmentReminder,
  type OfficeAppointmentCommunication,
  type OfficeAvailabilityResult,
  type OfficeBookingOption,
} from '../../lib/office-booking-authority';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import styles from './scheduling-overview-v2.module.css';

type Mode = 'details' | 'reschedule' | 'cancel';

type Props = {
  appointment: BrowserAppointmentRecord;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
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

const rescheduleReasons = [
  'Customer requested another date',
  'Customer work / personal conflict',
  'No one will be at the property',
  'Access unavailable',
  'DEMAC operational adjustment',
  'Weather / external condition',
  'Other',
];

function formatTime(value?: string) {
  if (!value) return '—';
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatDateTime(value?: string) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    timeZone: 'America/Aruba',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

function communicationState(value?: string) {
  if (!value || value === 'not_queued') return 'Not queued';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isAlreadySent(value?: string) {
  return ['accepted', 'sent', 'delivered', 'read'].includes(String(value || '').toLowerCase());
}

function reminderControlCopy(communication: OfficeAppointmentCommunication) {
  const state = communication.reminder.state;
  if (isAlreadySent(state)) return 'Reminder already sent successfully; it cannot be recalled.';
  if (state === 'queued' || state === 'processing') return `Reminder is ${state}; another copy cannot be queued.`;
  if (communication.reminder.lastError) return `Last attempt failed: ${communication.reminder.lastError}`;
  if (!communication.reminder.enabled) return 'Reminder is disabled for this appointment.';
  return 'Automatic reminder is enabled. Use manual send only when you intentionally need to send it now.';
}

function optionKey(option: OfficeBookingOption) {
  return `${option.id}|${option.date}|${option.time}`;
}

function Field({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? styles.wide : undefined}><span style={{ color: 'var(--muted)', fontSize: 7 }}>{label}</span><strong style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</strong></div>;
}

export function LiveAppointmentDetailsDrawer({ appointment, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('details');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [targetDate, setTargetDate] = useState(appointment.dateKey);
  const [availability, setAvailability] = useState<OfficeAvailabilityResult | null>(null);
  const [selectedOptionKey, setSelectedOptionKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [communication, setCommunication] = useState<OfficeAppointmentCommunication | null>(null);
  const [communicationBusy, setCommunicationBusy] = useState(false);
  const [communicationError, setCommunicationError] = useState('');

  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment && assignment.status !== 'cancelled');
  const selectedOption = useMemo(() => availability?.options.find((option) => optionKey(option) === selectedOptionKey) ?? null, [availability, selectedOptionKey]);
  const canManageLifecycle = Boolean(appointment.customerId && appointment.siteId && appointment.status !== 'cancelled');
  const workLabel = appointment.workLabel || appointment.workTypeId?.replaceAll('_', ' ') || appointment.customerFacingDescription || 'Scheduled work';

  useEffect(() => {
    let active = true;
    setCommunication(null);
    setCommunicationError('');
    void getOfficeAppointmentCommunication(appointment.id)
      .then((value) => { if (active) setCommunication(value); })
      .catch((cause) => { if (active) setCommunicationError(cause instanceof Error ? cause.message : 'Communication status could not be loaded.'); });
    return () => { active = false; };
  }, [appointment.id]);

  const begin = (next: Mode) => {
    setMode(next);
    setReason('');
    setNote('');
    setError('');
    setAvailability(null);
    setSelectedOptionKey('');
    if (next === 'reschedule') setTargetDate(appointment.dateKey);
  };

  const toggleReminder = async () => {
    if (!communication || communicationBusy || isAlreadySent(communication.reminder.state)) return;
    setCommunicationBusy(true);
    setCommunicationError('');
    try {
      const next = await updateOfficeAppointmentReminder({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('reminder-preference'),
        sendReminder: !communication.reminder.enabled,
      });
      setCommunication(next);
    } catch (cause) {
      setCommunicationError(cause instanceof Error ? cause.message : 'Reminder preference could not be updated.');
    } finally {
      setCommunicationBusy(false);
    }
  };

  const sendReminderNow = async () => {
    if (!communication?.reminder.canSendNow || communicationBusy) return;
    if (!window.confirm('Send this appointment reminder now through the DEMAC WhatsApp queue?')) return;
    setCommunicationBusy(true);
    setCommunicationError('');
    try {
      const next = await sendOfficeAppointmentReminder({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('manual-reminder'),
      });
      setCommunication(next);
    } catch (cause) {
      setCommunicationError(cause instanceof Error ? cause.message : 'The appointment reminder could not be queued manually.');
    } finally {
      setCommunicationBusy(false);
    }
  };

  const cancel = async () => {
    if (!reason) {
      setError('Select a cancellation reason.');
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
      setError(cause instanceof Error ? cause.message : 'The appointment could not be cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const findAvailability = async () => {
    if (!appointment.customerId || !appointment.siteId) {
      setError('This appointment is missing its canonical customer/property relationship.');
      return;
    }
    if (!targetDate) {
      setError('Choose a new date.');
      return;
    }
    setBusy(true);
    setError('');
    setSelectedOptionKey('');
    try {
      const result = await checkOfficeRescheduleAvailability({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('reschedule-availability'),
        customerId: appointment.customerId,
        propertyId: appointment.siteId,
        presetId: appointment.workTypeId || appointment.presetId,
        serviceId: appointment.serviceId,
        quantity: appointment.totalQuantity,
        requestedDate: targetDate,
        customerFacingDescription: appointment.customerFacingDescription,
      });
      setAvailability(result);
      if (!result.available || !result.options.length) setError('No valid Booking Authority capacity is available for that date.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Availability could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const reschedule = async () => {
    if (!reason) {
      setError('Select a reschedule reason.');
      return;
    }
    if (!availability?.offer || !selectedOption) {
      setError('Select one valid Booking Authority option first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await rescheduleOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('reschedule'),
        offerId: availability.offer.id,
        offerVersion: availability.offer.version,
        optionId: selectedOption.id,
        reason,
        note,
      });
      await onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The appointment could not be rescheduled.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Appointment ${appointment.id}`}>
      <header className={styles.drawerHeader}>
        <div>
          <span>Live appointment · Booking Authority</span>
          <h2>{appointment.customer}</h2>
          <p>{appointment.propertyAddress || appointment.site} · {appointment.sector}</p>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </header>

      <div className={styles.drawerBody}>
        <section className={styles.formSection}>
          <header><strong>Appointment &amp; work</strong><span>{appointment.status === 'cancelled' ? 'Cancelled' : `${formatDate(appointment.dateKey)} · ${formatTime(primary?.start)}–${formatTime(primary?.end)}`}</span></header>
          <div className={styles.formGrid}>
            <Field wide label="WORK TYPE" value={`${workLabel} · ${appointment.totalQuantity} unit${appointment.totalQuantity === 1 ? '' : 's'}`} />
            <Field label="TIME / UNIT" value={durationLabel(appointment.durationMinutesPerUnit)} />
            <Field label="TOTAL WORK" value={durationLabel(appointment.scheduledDurationMinutes)} />
            <Field label="CAPACITY SPOTS" value={appointment.scheduledSlotCount ? `${appointment.scheduledSlotCount} spot${appointment.scheduledSlotCount === 1 ? '' : 's'}` : 'Not recorded'} />
            <Field label="PRIMARY VAN" value={primary?.vanId?.replace('VAN-', 'Van ') || '—'} />
            <Field label="SUPPORT" value={support ? `${support.vanId.replace('VAN-', 'Van ')} · ${formatTime(support.start)}–${formatTime(support.end)}` : 'None'} />
            <Field wide label="CUSTOMER-FACING DESCRIPTION" value={appointment.customerFacingDescription} />
          </div>
        </section>

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
            <Field label="CONFIRMED" value={formatDateTime(appointment.confirmedAt)} />
            <Field label="LAST UPDATED" value={formatDateTime(appointment.updatedAt)} />
            <Field label="WORK ORDER" value={appointment.workOrderIds?.join(', ') || appointment.workOrderId || 'Not recorded'} />
            <Field wide label="APPOINTMENT ID" value={appointment.id} />
          </div>
        </section>

        <section className={styles.formSection}>
          <header><strong>Customer communication</strong><span>Uses the canonical Work Order notification policy and the shared WhatsApp outbound queue.</span></header>
          {communication ? <div className={styles.formGrid}>
            <Field label="WHATSAPP NOTIFICATIONS" value={communication.whatsappEnabled ? 'Enabled' : 'Disabled'} />
            <Field label="RECIPIENT" value={communication.recipients.map((recipient) => recipient.name || recipient.phone).filter(Boolean).join(', ') || 'No recipient'} />
            <Field label="CONFIRMATION" value={communication.confirmation.enabled ? 'Enabled' : 'Disabled'} />
            <Field label="CONFIRMATION STATUS" value={communicationState(communication.confirmation.state)} />
            <Field label="REMINDER" value={communication.reminder.enabled ? 'Enabled' : 'Disabled'} />
            <Field label="REMINDER STATUS" value={communicationState(communication.reminder.state)} />
            <div className={styles.wide} style={{ display: 'grid', gap: 8 }}>
              <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>REMINDER CONTROL</span><strong style={{ display: 'block', marginTop: 4 }}>{reminderControlCopy(communication)}</strong></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className={styles.secondary} disabled={communicationBusy || isAlreadySent(communication.reminder.state)} onClick={() => void toggleReminder()}>{communicationBusy ? 'Saving…' : communication.reminder.enabled ? 'Turn Reminder Off' : 'Turn Reminder On'}</button>
                <button type="button" className={styles.primary} disabled={communicationBusy || !communication.reminder.canSendNow} onClick={() => void sendReminderNow()}>{communicationBusy ? 'Working…' : 'Send Reminder Now'}</button>
              </div>
            </div>
            {communication.confirmation.lastError ? <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>CONFIRMATION ERROR</span><strong style={{ display: 'block', marginTop: 4 }}>{communication.confirmation.lastError}</strong></div> : null}
          </div> : <div className={styles.descriptionPreview}><span>COMMUNICATION STATUS</span><strong>{communicationError || 'Loading confirmation and reminder status…'}</strong></div>}
          {communicationError && communication ? <div className={styles.descriptionPreview}><span>COMMUNICATION ATTENTION</span><strong>{communicationError}</strong></div> : null}
        </section>

        {mode === 'details' ? <section className={styles.formSection}>
          <header><strong>Manage appointment</strong><span>Lifecycle changes go through Booking Authority so capacity locks and Work Orders remain synchronized.</span></header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, padding: 11 }}>
            <button type="button" className={styles.secondary} disabled={!canManageLifecycle} onClick={() => begin('reschedule')}>Reschedule</button>
            <button type="button" className={styles.secondary} disabled={!canManageLifecycle} onClick={() => begin('cancel')} style={{ color: 'var(--danger)' }}>Cancel Appointment</button>
          </div>
          {!canManageLifecycle && appointment.status !== 'cancelled' ? <div className={styles.descriptionPreview}><span>CANONICAL RELATIONSHIP REQUIRED</span><strong>This appointment cannot be changed until its customer and property IDs are resolved.</strong></div> : null}
        </section> : null}

        {mode === 'reschedule' ? <section className={styles.formSection}>
          <header><strong>Reschedule appointment</strong><span>Choose a date, then select only from capacity returned by Booking Authority.</span></header>
          <div className={styles.formGrid}>
            <label><span>New date</span><input type="date" min={currentArubaDateKey()} value={targetDate} onChange={(event) => { setTargetDate(event.target.value); setAvailability(null); setSelectedOptionKey(''); setError(''); }} /></label>
            <label><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{rescheduleReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          <div style={{ padding: '0 11px 10px' }}><button type="button" className={styles.secondary} disabled={busy || !targetDate} onClick={() => void findAvailability()}>{busy ? 'Checking…' : 'Check Booking Authority availability'}</button></div>
          {availability?.options.length ? <div className={styles.slotOptions}>{availability.options.map((option) => <button key={optionKey(option)} type="button" className={`${styles.slotOption} ${selectedOptionKey === optionKey(option) ? styles.slotOptionSelected : ''}`} onClick={() => setSelectedOptionKey(optionKey(option))}><div><strong>{formatDate(option.date)} · {formatTime(option.time)}–{formatTime(option.endTime)}</strong><span>{option.assignments.map((assignment) => assignment.vanId.replace('VAN-', 'Van ')).join(' + ')} · {option.zone || 'route-aware capacity'}</span></div><b>Select</b></button>)}</div> : null}
          {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
          <footer className={styles.drawerFooter}><div><span>Current</span><strong>{formatDate(appointment.dateKey)} · {formatTime(primary?.start)}</strong></div><div><button type="button" className={styles.secondary} onClick={() => begin('details')}>Back</button><button type="button" className={styles.primary} disabled={busy || !reason || !selectedOption} onClick={() => void reschedule()}>Confirm Reschedule</button></div></footer>
        </section> : null}

        {mode === 'cancel' ? <section className={styles.formSection}>
          <header><strong>Cancel appointment</strong><span>Cancellation releases the canonical capacity locks and cancels the linked Work Order(s).</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{cancellationReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
          <footer className={styles.drawerFooter}><div><span>Appointment</span><strong>{appointment.customer} · {formatDate(appointment.dateKey)}</strong></div><div><button type="button" className={styles.secondary} onClick={() => begin('details')}>Back</button><button type="button" className={styles.primary} disabled={busy || !reason} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Cancel Appointment'}</button></div></footer>
        </section> : null}
      </div>
    </aside>
  </div>;
}
