'use client';

import { useMemo, useRef, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  addOfficeAdhocSupport,
  officeBookingOutcomeUnknown,
  createOfficeLifecycleRequestId,
  type OfficeAdhocSupportResult,
} from '../../lib/office-booking-authority';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import styles from './scheduling-overview-v2.module.css';
import modalStyles from './booking-support-modal.module.css';
import bookingStyles from './live-appointment-create-drawer.module.css';
import { useBookingDialog } from './use-booking-dialog';

export type AdhocSupportTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
  start: string;
  end: string;
  durationOptions: Array<{ slots: number; end: string }>;
};

type Props = {
  target: AdhocSupportTarget;
  active?: boolean;
  canScheduleProjects?: boolean;
  onBookingSourceChange?: (source: 'service' | 'project') => void;
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

export function AdhocSupportDrawer({ target, appointments, onClose, onCreated, active = true, canScheduleProjects = false, onBookingSourceChange }: Props) {
  const historical = target.dateKey < currentArubaDateKey();
  const [backdatingAcknowledged, setBackdatingAcknowledged] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestedSlots, setRequestedSlots] = useState(1);
  const [recovery, setRecovery] = useState<{ retry: () => Promise<void> } | null>(null);
  const inFlight = useRef(false);
  const blocked = busy || Boolean(recovery);
  const dialogRef = useBookingDialog(onClose, blocked, active);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const duration = target.durationOptions.find(option => option.slots === requestedSlots);

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

  const submit = async () => {
    if (blocked || inFlight.current) return;
    if (!duration) {
      setError('Select an available support duration.');
      return;
    }
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
    if (historical && !backdatingAcknowledged) {
      setError('Confirm that this support actually happened on the selected date.');
      return;
    }
    const input = {
      appointmentId: selected.id,
      requestedDate: target.dateKey,
      requestedTime: target.start,
      requiredVanId: target.vanId,
      requestedSlots,
      reason: composedReason,
      ...(historical ? { bookingMode: 'backdated' as const, backdatingAcknowledged: true } : {}),
    };
    const signature = JSON.stringify(input);
    if (requestRef.current?.signature !== signature) {
      requestRef.current = { signature, id: createOfficeLifecycleRequestId('adhoc-support') };
    }
    await executeSupport({ ...input, requestId: requestRef.current.id }, selected);
  };

  const executeSupport = async (input: Parameters<typeof addOfficeAdhocSupport>[0], appointment: BrowserAppointmentRecord) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await addOfficeAdhocSupport(input);
      setRecovery(null);
      await onCreated(result, appointment);
      onClose();
    } catch (cause) {
      setRecovery(officeBookingOutcomeUnknown(cause) ? { retry: () => executeSupport(input, appointment) } : null);
      setError(cause instanceof Error ? cause.message : 'The support assignment could not be saved.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <div className={`${styles.drawerOverlay} ${modalStyles.overlay}`} style={active ? undefined : { display: 'none' }} inert={!active} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !blocked && !inFlight.current) onClose(); }}>
    <aside className={`${styles.drawer} ${modalStyles.dialog}`} data-booking-modal ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Send van support">
      <header className={styles.drawerHeader}>
        <div>
          <span>Operational support · Booking Authority</span>
          <h2>{historical ? 'Record past van support' : 'Send support to a coworker'}</h2>
          <p>{target.vanName} · {formatDate(target.dateKey)} · {formatTime(target.start)}–{formatTime(duration?.end)}</p>
        </div>
        <button type="button" disabled={blocked} onClick={onClose}>×</button>
      </header>

      {onBookingSourceChange ? <div className={bookingStyles.sourceBar} inert={blocked}>
        <section className={bookingStyles.sourceSection}>
          <h3 className={bookingStyles.sourceLabel}>Appointment source</h3>
          <div className={bookingStyles.sourceActions}><div className={bookingStyles.sourceToggle}>
            <button type="button" className={bookingStyles.sourceOption} disabled={blocked} aria-pressed={false}
              aria-label="Regular Booking Choose customer, property and work from Services & Products."
              onClick={() => { if (!blocked && !inFlight.current) onBookingSourceChange('service'); }}><strong>Regular Booking</strong><span>Choose customer, property and work from Services & Products.</span></button>
            {canScheduleProjects ? <button type="button" className={bookingStyles.sourceOption} disabled={blocked} aria-pressed={false}
              aria-label="Project Find a Project and reserve whole Van capacity slots against it."
              onClick={() => { if (!blocked && !inFlight.current) onBookingSourceChange('project'); }}><strong>Project</strong><span>Find a Project and reserve whole Van capacity slots against it.</span></button> : null}
            <button type="button" className={`${bookingStyles.sourceOption} ${bookingStyles.sourceOptionActive}`} disabled={blocked} aria-pressed={true}
              aria-label="Send van support Use this open slot to help another Van with an existing appointment."><strong>Send van support</strong><span>Use this open slot to help another Van with an existing appointment.</span></button>
          </div></div>
        </section>
      </div> : null}

      <div className={`${styles.drawerBody} ${modalStyles.body}`} inert={blocked}>
        {historical ? <section className={styles.formSection}>
          <header><strong>Historical schedule correction</strong><span>Record support that actually happened on {formatDate(target.dateKey)}. No customer or technician alerts will be sent.</span></header>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12 }}>
            <input type="checkbox" checked={backdatingAcknowledged} disabled={blocked} onChange={(event) => { setBackdatingAcknowledged(event.target.checked); setError(''); }} />
            <span>I confirm this Van actually provided support on the selected date and time.</span>
          </label>
        </section> : null}
        <section className={styles.formSection}>
          <header><strong>Support capacity</strong><span>Choose consecutive open slots for this support assignment. The primary appointment does not move.</span></header>
          <div className={styles.formGrid}>
            <div><span>SUPPORT VAN</span><strong>{target.vanName}</strong></div>
            <div><span>SUPPORT TIME</span><strong>{formatTime(target.start)}–{formatTime(duration?.end)}</strong></div>
            <label className={styles.wide}><span>Support duration</span>
              <select value={requestedSlots} disabled={blocked} onChange={event => { setRequestedSlots(Number(event.target.value)); setError(''); }}>
                {target.durationOptions.map(option => <option key={option.slots} value={option.slots}>{option.slots} {option.slots === 1 ? 'slot' : 'slots'} · {option.slots} {option.slots === 1 ? 'hour' : 'hours'} · {formatTime(target.start)}–{formatTime(option.end)}</option>)}
              </select>
              <small>{target.durationOptions.length === 1 ? 'Only one consecutive slot is available.' : `Up to ${target.durationOptions.length} consecutive slots available.`} Stops before the next booking, break or unavailable time.</small>
            </label>
            <div className={styles.wide}><span>CUSTOMER COMMUNICATION</span><strong>None · the primary appointment remains the only customer communication owner.</strong></div>
          </div>
        </section>

        <section className={styles.formSection}>
          <header><strong>{historical ? 'Which appointment received support?' : 'Which appointment needs help?'}</strong><span>{historical ? 'Choose the original appointment on that date, including work already completed.' : 'Only confirmed appointments on another primary Van are shown.'}</span></header>
          {candidates.length ? <div className={styles.slotOptions}>
            {candidates.map((appointment) => {
              const primary = primaryAssignment(appointment);
              const selectedRow = appointment.id === selectedAppointmentId;
              return <button
                key={appointment.id}
                type="button"
                className={`${styles.slotOption} ${selectedRow ? styles.slotOptionSelected : ''}`}
                disabled={blocked}
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
          <header><strong>Reason / operational note</strong><span>{historical ? 'Recorded with the correction, your identity and the time it was entered.' : 'Recorded on the linked support Work Order and included in the technician alert.'}</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Reason</span><select value={reason} disabled={blocked} onChange={(event) => { setReason(event.target.value); setError(''); }}><option value="">Select reason</option>{supportReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className={styles.wide}><span>{reason === 'Other' ? 'Describe support *' : 'Additional note'}</span><textarea rows={3} value={note} disabled={blocked} onChange={(event) => { setNote(event.target.value); setError(''); }} placeholder={historical ? 'Describe the support that actually happened.' : 'What should the support team know before going to help?'} /></label>
          </div>
          {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
        </section>
      </div>

      <footer className={styles.drawerFooter}>
        {recovery ? <div role="alert"><p>La respuesta del apoyo está pendiente. Recupera la solicitud original antes de cambiar de tipo o cerrar.</p>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void recovery.retry()}>Recuperar apoyo original</button>
        </div> : <>
        <div><span>VAN SUPPORT</span><strong>{target.vanName} · {formatTime(target.start)}–{formatTime(duration?.end)}</strong></div>
        <div>
          <button type="button" className={styles.secondary} disabled={blocked} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primary} disabled={busy || !duration || !selected || !reason || (reason === 'Other' && !text(note)) || (historical && !backdatingAcknowledged)} onClick={() => void submit()}>{busy ? 'Saving support…' : historical ? 'Save historical support' : 'Send support'}</button>
        </div>
        </>}
      </footer>
    </aside>
  </div>;
}
