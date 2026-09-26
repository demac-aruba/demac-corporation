'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  adjustOfficeRegularHistoricalCapacity,
  createOfficeLifecycleRequestId,
  getOfficeAppointment,
  officeBookingOutcomeUnknown,
} from '../../lib/office-booking-authority';
import {
  regularHistoricalCapacitySource,
  type RegularHistoricalCapacitySource,
} from '../../lib/regular-historical-capacity';
import drawerStyles from './scheduling-overview-v2.module.css';
import styles from './regular-historical-capacity-panel.module.css';

const wholeSlots = [1, 2, 3, 4, 5, 6];

type Props = {
  appointment: BrowserAppointmentRecord;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
  onBusyChange: (busy: boolean) => void;
};

export function RegularHistoricalCapacityPanel({ appointment, onBack, onSaved, onBusyChange }: Props) {
  const [source, setSource] = useState<RegularHistoricalCapacitySource | null>(null);
  const [slots, setSlots] = useState(1);
  const [reason, setReason] = useState('');
  const [noBillingAcknowledged, setNoBillingAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestId = useRef('');
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSource(null);
    void getOfficeAppointment(appointment.id)
      .then((result) => {
        if (!active) return;
        if (result.appointmentId !== appointment.id) throw new Error('Booking Authority returned a different Appointment. Nothing was changed.');
        const nextSource = regularHistoricalCapacitySource(result.appointment);
        if (!nextSource) throw new Error('This booking cannot be corrected here. Only a past, confirmed, single-Van, one-hour-per-unit Regular Booking without a Project is supported. Nothing was changed.');
        setSource(nextSource);
        setSlots(nextSource.currentSlots);
        setReason('');
        setNoBillingAcknowledged(false);
        setUnknownOutcome(false);
        requestId.current = '';
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Booking Authority could not verify this Appointment. Nothing was changed.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appointment.id, refreshNonce]);

  const resetAttempt = () => {
    requestId.current = '';
    setError('');
    setMessage('');
    setUnknownOutcome(false);
  };

  const canSave = Boolean(source && !loading && !saving && !saved
    && slots !== source.currentSlots && wholeSlots.includes(slots)
    && reason.trim().length >= 5 && reason.trim().length <= 1000
    && noBillingAcknowledged);

  const save = async () => {
    if (!canSave || !source || inFlight.current) return;
    inFlight.current = true;
    if (!requestId.current) requestId.current = createOfficeLifecycleRequestId('regular-history');
    setSaving(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      const result = await adjustOfficeRegularHistoricalCapacity({
        appointmentId: appointment.id,
        requestId: requestId.current,
        expectedSlots: source.currentSlots,
        slots,
        reason: reason.trim(),
        noBillingAcknowledged: true,
      });
      setSaved(true);
      setMessage(result.replayed
        ? result.currentMatchesAudit
          ? `Original correction recovered. Current reservation: ${result.observedCurrentSlots} slots.`
          : `Original correction was already recorded, but a later change now leaves ${result.observedCurrentSlots ?? 'an unverified number of'} slots reserved. Review the refreshed schedule before any further correction.`
        : `Capacity corrected: ${result.previousSlots} → ${result.currentSlots} reserved slots.`);
      try {
        await onSaved();
      } catch {
        setError('The correction was saved, but the schedule could not refresh. Reload Scheduling to see the current reservation. Do not create another correction.');
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'The historical slot correction could not be verified.';
      const outcomeUnknown = officeBookingOutcomeUnknown(cause);
      setUnknownOutcome(outcomeUnknown);
      setError(outcomeUnknown
        ? `${detail} The result is uncertain. Retry the exact same correction below; do not change its details or create another booking.`
        : detail);
    } finally {
      inFlight.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  };

  return <section className={drawerStyles.formSection} aria-label="Correct past Regular Booking slots">
    <header><strong>Correct past reserved slots</strong><span>Booking Authority updates this Appointment, its Work Order and Van locks in place.</span></header>
    <div className={styles.content}>
      <p>This correction changes the <strong>Van slots reserved for this visit</strong>, not the hours technicians actually worked, work performed, payroll or billing. It applies only to a one-hour-per-unit Regular Booking with no Field or commercial evidence. Longer or fixed-duration services need separate reconciliation. Date, Van, crew and start time stay fixed. No customer confirmation or reminder is sent.</p>
      {loading ? <p role="status">Checking the canonical Appointment…</p> : null}
      {source ? <>
        <div className={styles.identity}>
          <span>{source.date} · {source.vanId} · {source.start}</span>
          <strong>{source.currentSlots} slot{source.currentSlots === 1 ? '' : 's'} currently reserved</strong>
          <small>Work Order: {source.workOrderId}</small>
        </div>
        <label className={styles.field}>Corrected reserved slots
          <select value={slots} disabled={saving || saved || unknownOutcome} onChange={(event) => { setSlots(Number(event.target.value)); resetAttempt(); }}>
            {wholeSlots.map((count) => <option key={count} value={count}>{count} slot{count === 1 ? '' : 's'}</option>)}
          </select>
        </label>
        <label className={styles.field}>Reason for correction
          <textarea rows={3} maxLength={1000} value={reason} disabled={saving || saved || unknownOutcome} onChange={(event) => { setReason(event.target.value); resetAttempt(); }} placeholder="What changed after this visit?" />
          <small>Required: 5–1000 characters. The reason is kept in the booking audit.</small>
        </label>
        <label className={styles.check}><input type="checkbox" checked={noBillingAcknowledged} disabled={saving || saved || unknownOutcome} onChange={(event) => { setNoBillingAcknowledged(event.target.checked); resetAttempt(); }} />I verified this booking has no invoice or payment, including outside DEMAC ERP.</label>
        <p className={styles.boundary}>Only whole slots 1–6 are supported. Increasing slots requires free contiguous historical Van and crew capacity. Existing Field or commercial evidence blocks the correction; the server checks everything again before saving.</p>
      </> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      {!source && !loading && !saved ? <button type="button" className={drawerStyles.secondary} onClick={() => setRefreshNonce((value) => value + 1)}>Recheck Appointment</button> : null}
    </div>
    <footer className={drawerStyles.drawerFooter}>
      <div><span>CAPACITY ONLY</span><strong>No new Appointment or Work Order</strong></div>
      <div><button type="button" className={drawerStyles.secondary} disabled={saving} onClick={onBack}>Back</button><button type="button" className={drawerStyles.primary} disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : unknownOutcome ? 'Retry same correction' : 'Save slot correction'}</button></div>
    </footer>
  </section>;
}
