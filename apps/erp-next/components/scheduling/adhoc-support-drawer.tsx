'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  addOfficeAdhocSupport,
  createOfficeLifecycleRequestId,
  type OfficeAdhocSupportResult,
} from '../../lib/office-booking-authority';
import styles from './scheduling-overview-v2.module.css';

export type AdhocSupportTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
  start: string;
  end: string;
};

type Props = {
  target: AdhocSupportTarget;
  appointments: BrowserAppointmentRecord[];
  onClose: () => void;
  onCreated: (result: OfficeAdhocSupportResult, appointment: BrowserAppointmentRecord) => Promise<void> | void;
};

const supportReasons = [
  'Van delayed / schedule recovery',
  'Unexpected job complication',
  'Extra hands required on site',
  'Heavy lifting / installation support',
  'Emergency operational support',
  'Other',
];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value?: string) {
  if (!value) return '—';
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function primaryAssignment(appointment: BrowserAppointmentRecord) {
  return appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
}

function appointmentWorkLabel(appointment: BrowserAppointmentRecord) {
  return text(appointment.workLabel)
    || text(appointment.workTypeId).replaceAll('_', ' ')
    || text(appointment.customerFacingDescription)
    || 'Scheduled work';
}

export function AdhocSupportDrawer({ target, appointments, onClose, onCreated }: Props) {
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const candidates = useMemo(() => appointments
    .filter((appointment) => appointment.dateKey === target.dateKey && appointment.status === 'confirmed')
    .filter((appointment) => {
      const primary = primaryAssignment(appointment);
      return Boolean(primary && primary.vanId !== target.vanId);
    })
    .sort((left, right) => {
      const leftPrimary = primaryAssignment(left);
      const rightPrimary = primaryAssignment(right);
      return String(leftPrimary?.start || '').localeCompare(String(rightPrimary?.start || ''))
        || left.customer.localeCompare(right.customer);
    }), [appointments, target.dateKey, target.vanId]);

  const selected = candidates.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const composedReason = reason === 'Other'
    ? text(note)
    : [reason, text(note)].filter(Boolean).join(' · ');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  const submit = async () => {
    if (!selected) {
      setError('Select the primary appointment that needs help.');
      return;
    }
    if (!reason) {
      setError('Select why this support is being assigned.');
      return;
    }
    if (reason === 'Other' && !text(note)) {
      setError('Describe the support reason.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await addOfficeAdhocSupport({
        appointmentId: selected.id,
        requestId: createOfficeLifecycleRequestId('adhoc-support'),
        requestedDate: target.dateKey,
        requestedTime: target.start,
        requiredVanId: target.vanId,
        reason: composedReason,
      });
      await onCreated(result, selected);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The support assignment could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Send van support">
      <header className={styles.drawerHeader}>
        <div>
          <span>Operational support · Booking Authority</span>
          <h2>Send support to a coworker</h2>
          <p>{target.vanName} · {formatDate(target.dateKey)} · {formatTime(target.start)}–{formatTime(target.end)}</p>
        </div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close support drawer">×</button>
      </header>

      <div className={styles.drawerBody}>
        <section className={styles.formSection}>
          <header><strong>Support capacity</strong><span>This open slot will become a linked SUPPORT assignment. The primary appointment does not move.</span></header>
          <div className={styles.formGrid}>
            <div><span>SUPPORT VAN</span><strong>{target.vanName}</strong></div>
            <div><span>SUPPORT TIME</span><strong>{formatTime(target.start)}–{formatTime(target.end)}</strong></div>
            <div className={styles.wide}><span>CUSTOMER COMMUNICATION</span><strong>None · the primary appointment remains the only customer communication owner.</strong></div>
          </div>
        </section>

        <section className={styles.formSection}>
          <header><strong>Which appointment needs help?</strong><span>Only confirmed appointments on another primary Van are shown.</span></header>
          {candidates.length ? <div className={styles.slotOptions}>
            {candidates.map((appointment) => {
              const primary = primaryAssignment(appointment);
              const selectedRow = appointment.id === selectedAppointmentId;
              return <button
                key={appointment.id}
                type="button"
                className={`${styles.slotOption} ${selectedRow ? styles.slotOptionSelected : ''}`}
                disabled={busy}
                onClick={() => { setSelectedAppointmentId(appointment.id); setError(''); }}
              >
                <div>
                  <strong>{appointment.customer} · {primary?.vanId?.replace('VAN-', 'Van ')}</strong>
                  <span>{formatTime(primary?.start)}–{formatTime(primary?.end)} · {appointmentWorkLabel(appointment)}</span>
                  <small>{appointment.site} · {appointment.sector}</small>
                </div>
                <b>{selectedRow ? 'SELECTED' : 'SELECT'}</b>
              </button>;
            })}
          </div> : <div className={styles.descriptionPreview}><span>NO PRIMARY JOB AVAILABLE</span><strong>There is no confirmed appointment on another Van for this date. The support slot has not been changed.</strong></div>}
        </section>

        <section className={styles.formSection}>
          <header><strong>Reason / operational note</strong><span>Recorded on the linked support Work Order and included in the technician alert.</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Reason</span><select value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setError(''); }}><option value="">Select reason</option>{supportReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className={styles.wide}><span>{reason === 'Other' ? 'Describe support *' : 'Additional note'}</span><textarea rows={3} value={note} disabled={busy} onChange={(event) => { setNote(event.target.value); setError(''); }} placeholder="What should the support team know before going to help?" /></label>
          </div>
          {error ? <div className={styles.descriptionPreview} role="alert"><span>ATTENTION</span><strong>{error}</strong></div> : null}
        </section>
      </div>

      <footer className={styles.drawerFooter}>
        <div><span>CANONICAL WRITE</span><strong>Existing appointment → linked SUPPORT Work Order + capacity lock</strong></div>
        <div>
          <button type="button" className={styles.secondary} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primary} disabled={busy || !selected || !reason || (reason === 'Other' && !text(note))} onClick={() => void submit()}>{busy ? 'Assigning support…' : 'Send support'}</button>
        </div>
      </footer>
    </aside>
  </div>;
}
