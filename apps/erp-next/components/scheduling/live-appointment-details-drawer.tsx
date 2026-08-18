'use client';

import { useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  cancelOfficeAppointment,
  checkOfficeRescheduleAvailability,
  createOfficeLifecycleRequestId,
  rescheduleOfficeAppointment,
  type OfficeAvailabilityResult,
  type OfficeBookingOption,
} from '../../lib/office-booking-authority';
import { defaultWorkPresets } from '../../lib/scheduling';
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

function presetLabel(id: string) {
  return defaultWorkPresets.find((preset) => preset.id === id)?.label ?? id.replaceAll('_', ' ');
}

function optionKey(option: OfficeBookingOption) {
  return `${option.id}|${option.date}|${option.time}`;
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

  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment && assignment.status !== 'cancelled');
  const selectedOption = useMemo(() => availability?.options.find((option) => optionKey(option) === selectedOptionKey) ?? null, [availability, selectedOptionKey]);
  const canManageLifecycle = Boolean(appointment.customerId && appointment.siteId && appointment.status !== 'cancelled');

  const begin = (next: Mode) => {
    setMode(next);
    setReason('');
    setNote('');
    setError('');
    setAvailability(null);
    setSelectedOptionKey('');
    if (next === 'reschedule') setTargetDate(appointment.dateKey);
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
        presetId: appointment.presetId,
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
          <p>{appointment.site} · {appointment.sector}</p>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </header>

      <div className={styles.drawerBody}>
        <section className={styles.formSection}>
          <header><strong>Appointment details</strong><span>{appointment.status === 'cancelled' ? 'Cancelled' : `${formatDate(appointment.dateKey)} · ${formatTime(primary?.start)}–${formatTime(primary?.end)}`}</span></header>
          <div className={styles.formGrid}>
            <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>SERVICE</span><strong style={{ display: 'block', marginTop: 4 }}>{presetLabel(appointment.presetId)} · {appointment.totalQuantity} unit{appointment.totalQuantity === 1 ? '' : 's'}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>PRIMARY VAN</span><strong style={{ display: 'block', marginTop: 4 }}>{primary?.vanId?.replace('VAN-', 'Van ') || '—'}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>SUPPORT</span><strong style={{ display: 'block', marginTop: 4 }}>{support ? `${support.vanId.replace('VAN-', 'Van ')} · ${formatTime(support.start)}–${formatTime(support.end)}` : 'None'}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>BOOKED BY</span><strong style={{ display: 'block', marginTop: 4 }}>{appointment.bookedByName || 'Not recorded'}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>SOURCE</span><strong style={{ display: 'block', marginTop: 4 }}>{appointment.bookedBySource === 'demac-customer-agent' ? 'Maya / AI Customer Agent' : appointment.bookedBySource === 'office-scheduling' ? 'Office Scheduling' : appointment.bookedBySource || '—'}</strong></div>
            <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>CUSTOMER-FACING DESCRIPTION</span><strong style={{ display: 'block', marginTop: 4 }}>{appointment.customerFacingDescription}</strong></div>
            <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>APPOINTMENT ID</span><strong style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>{appointment.id}</strong></div>
          </div>
        </section>

        {mode === 'details' ? <section className={styles.formSection}>
          <header><strong>Manage appointment</strong><span>Lifecycle changes go through Booking Authority so capacity locks and work orders remain synchronized.</span></header>
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
          <header><strong>Cancel appointment</strong><span>Cancellation releases the canonical capacity locks and cancels the linked work order(s).</span></header>
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