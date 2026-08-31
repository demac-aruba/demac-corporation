'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import { getOfficeAppointment } from '../../lib/office-booking-authority';
import {
  createPartialOutcomeRequestId,
  recordOfficePartialCompletion,
  type PartialCompletionOutcome,
  type PartialCompletionWorkLine,
} from '../../lib/office-partial-completion-authority';
import { RemainingWorkSchedulePicker } from './remaining-work-schedule-picker';
import styles from './scheduling-overview-v2.module.css';

type Props = {
  appointment: BrowserAppointmentRecord;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
};

type CanonicalAppointment = Record<string, unknown> & {
  id?: string;
  appointmentId?: string;
  customerId?: string;
  propertyId?: string;
  workLines?: unknown;
  assignments?: unknown;
  executionOutcome?: unknown;
};

const partialReasons = [
  'DEMAC operational reassignment',
  'Customer requested stop',
  'Unexpected job-site condition',
  'Missing material / equipment',
  'Weather / external condition',
  'Other',
];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value?: string) {
  if (!value) return '—';
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function canonicalWorkLines(value: unknown): PartialCompletionWorkLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const manualDuration = Number(item.manualDurationMinutes || 0);
    return {
      id: text(item.id) || `work-${index + 1}`,
      presetId: text(item.presetId || item.serviceType || item.bookingCode),
      ...(text(item.serviceId) ? { serviceId: text(item.serviceId) } : {}),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      ...(Number.isFinite(manualDuration) && manualDuration > 0 ? { manualDurationMinutes: manualDuration } : {}),
      ...(text(item.customerFacingDescription) ? { customerFacingDescription: text(item.customerFacingDescription) } : {}),
      ...(text(item.technicianInstructions) ? { technicianInstructions: text(item.technicianInstructions) } : {}),
    };
  }).filter((line) => Boolean(line.presetId));
}

function canonicalAssignments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function canonicalOutcome(value: unknown): PartialCompletionOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (text(record.status) !== 'partial') return null;
  const plannedQuantity = Math.max(0, Math.round(Number(record.plannedQuantity) || 0));
  const completedQuantity = Math.max(0, Math.round(Number(record.completedQuantity) || 0));
  const remainingQuantity = Math.max(0, Math.round(Number(record.remainingQuantity) || 0));
  const actualEndTime = text(record.actualEndTime);
  if (!plannedQuantity || !completedQuantity || !actualEndTime) return null;
  return {
    status: 'partial',
    revision: Math.max(1, Math.round(Number(record.revision) || 1)),
    recordRequestId: text(record.recordRequestId) || undefined,
    recordedAtIso: text(record.recordedAtIso) || undefined,
    recordedById: text(record.recordedById) || undefined,
    recordedByName: text(record.recordedByName) || undefined,
    reason: text(record.reason),
    note: text(record.note) || undefined,
    actualEndTime,
    plannedQuantity,
    completedQuantity,
    remainingQuantity,
    plannedWorkLines: canonicalWorkLines(record.plannedWorkLines),
    completedWorkLines: canonicalWorkLines(record.completedWorkLines),
    remainingWorkLines: canonicalWorkLines(record.remainingWorkLines),
    remainingWorkStatus: text(record.remainingWorkStatus) === 'scheduled' ? 'scheduled' : 'pending_schedule',
    followUpAppointmentId: text(record.followUpAppointmentId) || undefined,
    followUpScheduledAtIso: text(record.followUpScheduledAtIso) || undefined,
  };
}

function workLabel(appointment: BrowserAppointmentRecord, line?: PartialCompletionWorkLine) {
  return appointment.workLabel
    || appointment.workTypeId?.replaceAll('_', ' ')
    || line?.presetId?.replaceAll('_', ' ')
    || 'Scheduled work';
}

export function PartialCompletionPanel({ appointment, onBack, onSaved }: Props) {
  const [canonical, setCanonical] = useState<CanonicalAppointment | null>(null);
  const [outcome, setOutcome] = useState<PartialCompletionOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [completedQuantity, setCompletedQuantity] = useState(1);
  const [actualEndTime, setActualEndTime] = useState('');
  const [reason, setReason] = useState('DEMAC operational reassignment');
  const [note, setNote] = useState('');
  const [releasedSlots, setReleasedSlots] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');

  const workLines = useMemo(() => canonicalWorkLines(canonical?.workLines), [canonical]);
  const assignments = useMemo(() => canonicalAssignments(canonical?.assignments), [canonical]);
  const primaryAssignment = assignments.find((item) => text(item.role).toLowerCase() !== 'support') ?? assignments[0];
  const supportAssignments = assignments.filter((item) => item !== primaryAssignment);
  const plannedQuantity = outcome?.plannedQuantity ?? workLines[0]?.quantity ?? 0;
  const remainingQuantity = outcome?.remainingQuantity ?? Math.max(0, plannedQuantity - completedQuantity);
  const supportedShape = Boolean(workLines.length === 1 && primaryAssignment && supportAssignments.length === 0);
  const appointmentStart = text(primaryAssignment?.time) || appointment.assignments[0]?.start || '';

  const loadCanonical = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getOfficeAppointment(appointment.id);
      const value = result.appointment as CanonicalAppointment;
      setCanonical(value);
      const existing = canonicalOutcome(value.executionOutcome);
      setOutcome(existing);
      const canonicalLines = canonicalWorkLines(value.workLines);
      if (!existing) setCompletedQuantity(Math.min(1, Math.max(1, (canonicalLines[0]?.quantity ?? 1) - 1)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The canonical appointment could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCanonical();
  }, [appointment.id]);

  const recordOutcome = async () => {
    if (!supportedShape || savingOutcome) return;
    if (plannedQuantity < 2) {
      setError('This appointment does not contain more than one planned unit, so there is no remaining quantity to record.');
      return;
    }
    if (completedQuantity < 1 || completedQuantity >= plannedQuantity) {
      setError(`Completed quantity must be between 1 and ${plannedQuantity - 1}.`);
      return;
    }
    if (!actualEndTime) {
      setError('Enter the actual time the crew stopped work at this property.');
      return;
    }
    if (!reason) {
      setError('Select why the work was stopped before completion.');
      return;
    }
    setSavingOutcome(true);
    setError('');
    try {
      const result = await recordOfficePartialCompletion({
        appointmentId: appointment.id,
        requestId: createPartialOutcomeRequestId('record-partial'),
        completedQuantity,
        actualEndTime,
        reason,
        note,
      });
      setCanonical(result.appointment as CanonicalAppointment);
      setOutcome(result.outcome);
      setReleasedSlots(result.releasedCapacitySlots ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The actual appointment outcome could not be recorded.');
    } finally {
      setSavingOutcome(false);
    }
  };

  if (loading) {
    return <section className={styles.formSection}>
      <header><strong>Actual outcome</strong><span>Loading canonical appointment…</span></header>
      <div className={styles.descriptionPreview}><span>LOADING</span><strong>Reading the Booking Authority record before changing executed work.</strong></div>
    </section>;
  }

  if (!outcome && !supportedShape) {
    return <section className={styles.formSection}>
      <header><strong>Actual outcome</strong><span>Manual reconciliation required</span></header>
      <div className={styles.descriptionPreview}>
        <span>SAFE GUARD</span>
        <strong>Partial completion currently supports one canonical work line and one primary Van only. This appointment has a more complex workload or multi-Van assignment, so the system will not guess how to split completed versus remaining work.</strong>
      </div>
      {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
      <footer className={styles.drawerFooter}><div><span>Appointment</span><strong>{appointment.customer}</strong></div><div><button type="button" className={styles.secondary} onClick={onBack}>Back</button></div></footer>
    </section>;
  }

  if (!outcome) {
    const label = workLabel(appointment, workLines[0]);
    return <section className={styles.formSection}>
      <header><strong>Record actual outcome</strong><span>Preserve what was planned, record what actually happened, and release unused Van capacity.</span></header>
      <div style={{ padding: 11, display: 'grid', gap: 10 }}>
        <div className={styles.descriptionPreview} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
          <div><span>PLANNED</span><strong style={{ fontSize: 18 }}>{plannedQuantity}</strong><small style={{ display: 'block' }}>{label}</small></div>
          <div><span>COMPLETED</span><strong style={{ fontSize: 18 }}>{completedQuantity}</strong><small style={{ display: 'block' }}>Actual work today</small></div>
          <div><span>REMAINING</span><strong style={{ fontSize: 18 }}>{remainingQuantity}</strong><small style={{ display: 'block' }}>Will stay pending</small></div>
        </div>

        <div className={styles.formGrid}>
          <label><span>Completed quantity</span><input type="number" min={1} max={Math.max(1, plannedQuantity - 1)} value={completedQuantity} disabled={savingOutcome} onChange={(event) => { setCompletedQuantity(Math.max(1, Math.min(plannedQuantity - 1, Number(event.target.value) || 1))); setError(''); }} /></label>
          <label><span>Actual crew end time</span><input type="time" value={actualEndTime} disabled={savingOutcome} onChange={(event) => { setActualEndTime(event.target.value); setError(''); }} /></label>
          <label className={styles.wide}><span>Reason</span><select value={reason} disabled={savingOutcome} onChange={(event) => { setReason(event.target.value); setError(''); }}>{partialReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} disabled={savingOutcome} placeholder="Optional operational context" onChange={(event) => setNote(event.target.value)} /></label>
        </div>

        <div className={styles.descriptionPreview}>
          <span>WHAT THIS WILL DO</span>
          <strong>The original appointment will keep an audit snapshot of {plannedQuantity} planned. The live Work Order will become {completedQuantity} completed, {remainingQuantity} remaining will be stored for follow-up, and Van capacity after {actualEndTime ? formatTime(actualEndTime) : 'the actual end time'} will be released.</strong>
        </div>
        {appointmentStart ? <small style={{ color: 'var(--muted)' }}>Original appointment start: {formatTime(appointmentStart)}. The actual end time must be later than the start.</small> : null}
        {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
      </div>
      <footer className={styles.drawerFooter}>
        <div><span>Historical record</span><strong>{plannedQuantity} planned → {completedQuantity} completed → {remainingQuantity} pending</strong></div>
        <div><button type="button" className={styles.secondary} disabled={savingOutcome} onClick={onBack}>Back</button><button type="button" className={styles.primary} disabled={savingOutcome || !actualEndTime || completedQuantity >= plannedQuantity} onClick={() => void recordOutcome()}>{savingOutcome ? 'Recording…' : 'Record Partial Completion'}</button></div>
      </footer>
    </section>;
  }

  const label = workLabel(appointment, outcome.plannedWorkLines[0]);
  return <>
    <section className={styles.formSection} style={{ borderColor: 'var(--warning, #f59e0b)' }}>
      <header><strong style={{ color: 'var(--warning, #b45309)' }}>Partial completion recorded</strong><span>Executed history is locked; remaining work is handled as a linked follow-up.</span></header>
      <div style={{ padding: 11, display: 'grid', gap: 10 }}>
        <div className={styles.descriptionPreview} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
          <div><span>PLANNED</span><strong style={{ fontSize: 18 }}>{outcome.plannedQuantity}</strong><small style={{ display: 'block' }}>{label}</small></div>
          <div><span>COMPLETED</span><strong style={{ fontSize: 18 }}>{outcome.completedQuantity}</strong><small style={{ display: 'block' }}>Crew ended {formatTime(outcome.actualEndTime)}</small></div>
          <div><span>REMAINING</span><strong style={{ fontSize: 18 }}>{outcome.remainingQuantity}</strong><small style={{ display: 'block' }}>{outcome.remainingWorkStatus === 'scheduled' ? 'Follow-up scheduled' : 'Pending scheduling'}</small></div>
        </div>

        <div className={styles.formGrid}>
          <div><span>REASON</span><strong style={{ display: 'block', marginTop: 4 }}>{outcome.reason || 'Not recorded'}</strong></div>
          <div><span>ACTUAL END</span><strong style={{ display: 'block', marginTop: 4 }}>{formatTime(outcome.actualEndTime)}</strong></div>
          <div className={styles.wide}><span>INTERNAL NOTE</span><strong style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap' }}>{outcome.note || 'None'}</strong></div>
        </div>

        {releasedSlots.length ? <div className={styles.descriptionPreview}><span>CAPACITY RELEASED</span><strong>{releasedSlots.map(formatTime).join(', ')} are now available for other work.</strong></div> : null}

        {outcome.remainingWorkStatus === 'scheduled' && outcome.followUpAppointmentId ? <div className={styles.descriptionPreview}>
          <span>REMAINING WORK SCHEDULED</span>
          <strong>{outcome.remainingQuantity} remaining unit{outcome.remainingQuantity === 1 ? '' : 's'} are linked to follow-up appointment {outcome.followUpAppointmentId}. The original executed history remains unchanged.</strong>
        </div> : null}

        {outcome.remainingWorkStatus !== 'scheduled' && outcome.remainingQuantity > 0 ? <div style={{ display: 'grid', gap: 7 }}>
          <button type="button" className={styles.primary} style={{ width: '100%', minHeight: 40 }} onClick={() => { setError(''); setPickerOpen(true); }}>Check Availability for Remaining Work</button>
          <small style={{ color: 'var(--muted)' }}>Opens the live Van schedule. Navigate day by day and select only a complete Booking Authority match for all {outcome.remainingQuantity} remaining unit{outcome.remainingQuantity === 1 ? '' : 's'}.</small>
        </div> : null}

        {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
      </div>
      <footer className={styles.drawerFooter}>
        <div><span>Original appointment</span><strong>{appointment.customer} · {appointment.id}</strong></div>
        <div><button type="button" className={styles.secondary} onClick={onBack}>Back</button></div>
      </footer>
    </section>

    {pickerOpen && canonical && outcome.remainingWorkStatus !== 'scheduled' ? <RemainingWorkSchedulePicker
      appointment={appointment}
      canonical={canonical}
      outcome={outcome}
      onClose={() => setPickerOpen(false)}
      onScheduled={onSaved}
    /> : null}
  </>;
}
