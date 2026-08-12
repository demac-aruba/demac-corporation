'use client';

import { useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import type { BookingWorkLine, WorkPresetId } from '../../lib/scheduling';
import { defaultWorkPresets } from '../../lib/scheduling';
import type { CalendarDispatchJob } from '../../lib/scheduling-capacity';
import { buildOperationalWeek } from '../../lib/scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  appointmentSnapshot,
  cancelAppointment,
  recordOperationalIssue,
  updateAppointmentDetails,
  validMoveCandidates,
  validRescheduleCandidates,
  type AppointmentActor,
} from '../../lib/scheduling-appointment-lifecycle';
import styles from './scheduling-overview-v2.module.css';

type DrawerMode = 'details' | 'edit' | 'move' | 'reschedule' | 'cancel' | 'issue';
type WorkLineDraft = { id: string; presetId: WorkPresetId; quantityInput: string };

type Props = {
  appointment: BrowserAppointmentRecord;
  allJobs: CalendarDispatchJob[];
  canManage: boolean;
  actor: AppointmentActor;
  moveArmed: boolean;
  onArmMove: () => void;
  onClose: () => void;
  onUpdate: (next: BrowserAppointmentRecord, message: string, undoSnapshot?: BrowserAppointmentRecord) => void;
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

const issueReasons = [
  'No one home / no-show',
  'Customer unreachable',
  'Access unavailable',
  'Property closed',
  'Safety / site issue',
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

function historyLabel(kind: string) {
  return kind.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
}

function presetLabel(id: WorkPresetId) {
  return defaultWorkPresets.find((item) => item.id === id)?.label ?? id;
}

function draftsFromAppointment(appointment: BrowserAppointmentRecord): WorkLineDraft[] {
  const source: BookingWorkLine[] = appointment.workLines?.length
    ? appointment.workLines
    : [{ id: 'work-1', presetId: appointment.presetId, quantity: appointment.totalQuantity }];
  return source.map((line, index) => ({
    id: line.id || `work-${index + 1}`,
    presetId: line.presetId,
    quantityInput: String(line.quantity),
  }));
}

function newWorkLine(index: number): WorkLineDraft {
  return { id: `work-${Date.now()}-${index}`, presetId: 'standard_service', quantityInput: '1' };
}

export function AppointmentDetailsDrawer({ appointment, allJobs, canManage, actor, moveArmed, onArmMove, onClose, onUpdate }: Props) {
  const [mode, setMode] = useState<DrawerMode>('details');
  const [editWorkLines, setEditWorkLines] = useState<WorkLineDraft[]>(() => draftsFromAppointment(appointment));
  const [instructions, setInstructions] = useState(appointment.technicianInstructions ?? '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [targetDate, setTargetDate] = useState(appointment.dateKey);
  const [selectedRescheduleKey, setSelectedRescheduleKey] = useState('');
  const [error, setError] = useState('');

  const snapshot = appointmentSnapshot(appointment);
  const day = buildOperationalWeek(appointment.dateKey).find((item) => item.dateKey === appointment.dateKey)!;
  const sameDayJobs = allJobs.filter((job) => job.dateKey === appointment.dateKey);
  const moveCandidates = useMemo(() => {
    return validMoveCandidates(day, appointment, sameDayJobs)
      .filter((slot) => !(slot.vanId === snapshot.primaryVanId && slot.start === snapshot.primaryStart));
  }, [appointment, day, sameDayJobs, snapshot.primaryStart, snapshot.primaryVanId]);

  const reschedule = useMemo(() => {
    const targetJobs = allJobs.filter((job) => job.dateKey === targetDate);
    return validRescheduleCandidates(targetDate, appointment, targetJobs);
  }, [allJobs, appointment, targetDate]);

  const selectedReschedule = reschedule.slots.find((slot) => `${slot.vanId}|${slot.start}|${slot.supportVanId ?? ''}|${slot.supportStart ?? ''}` === selectedRescheduleKey);
  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  const displayWorkLines = appointment.workLines?.length
    ? appointment.workLines
    : [{ id: 'legacy-work-1', presetId: appointment.presetId, quantity: appointment.totalQuantity }];

  const updateWorkLine = (id: string, patch: Partial<WorkLineDraft>) => {
    setEditWorkLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    setError('');
  };

  const applyEdit = () => {
    const parsed: BookingWorkLine[] = editWorkLines.map((line) => ({
      id: line.id,
      presetId: line.presetId,
      quantity: Number(line.quantityInput),
    }));
    if (!parsed.length || parsed.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 14)) {
      setError('Every work line needs a whole-number quantity from 1 to 14.');
      return;
    }
    const result = updateAppointmentDetails({ record: appointment, update: { workLines: parsed, technicianInstructions: instructions }, day, jobs: sameDayJobs, actor });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onUpdate(result.record, 'Appointment scope updated. Booking Intelligence recalculated the complete work duration and verified the existing work spot.');
    setMode('details');
    setError('');
  };

  const applyMove = (slotKey: string) => {
    const slot = moveCandidates.find((item) => `${item.vanId}|${item.start}|${item.supportVanId ?? ''}|${item.supportStart ?? ''}` === slotKey);
    if (!slot) return;
    const result = applyAppointmentScheduleChange({ record: appointment, slot, dateKey: appointment.dateKey, kind: 'operational_move', actor, reason: 'Manual dispatch optimization' });
    onUpdate(result.record, result.customerNotificationRecommended ? 'Appointment moved. The customer-facing time changed, so a customer notification is recommended.' : 'Appointment reassigned operationally. Customer-facing time did not change.', appointment);
    setMode('details');
  };

  const applyReschedule = () => {
    if (!reason) {
      setError('Select a reschedule reason.');
      return;
    }
    if (!selectedReschedule) {
      setError('Select a valid new work spot.');
      return;
    }
    const result = applyAppointmentScheduleChange({ record: appointment, slot: selectedReschedule, dateKey: targetDate, kind: 'customer_reschedule', actor, reason, note });
    onUpdate(result.record, 'Customer reschedule saved. The previous schedule remains in the immutable appointment history.', appointment);
    setMode('details');
    setError('');
  };

  const applyCancellation = () => {
    if (!reason) {
      setError('Select a cancellation reason.');
      return;
    }
    onUpdate(cancelAppointment({ record: appointment, reason, note, actor }), 'Appointment cancelled. Its capacity is immediately available again.');
    setMode('details');
    setError('');
  };

  const applyIssue = () => {
    if (!reason) {
      setError('Select an operational issue.');
      return;
    }
    onUpdate(recordOperationalIssue({ record: appointment, reason, note, actor }), 'Operational issue added to the appointment history. Capacity and appointment status were not changed.');
    setMode('details');
    setError('');
  };

  const begin = (next: DrawerMode) => {
    setMode(next);
    setReason('');
    setNote('');
    setError('');
    if (next === 'edit') {
      setEditWorkLines(draftsFromAppointment(appointment));
      setInstructions(appointment.technicianInstructions ?? '');
    }
    if (next === 'reschedule') {
      setTargetDate(appointment.dateKey);
      setSelectedRescheduleKey('');
    }
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true">
      <header className={styles.drawerHeader}>
        <div><span>Appointment · {appointment.id}</span><h2>{appointment.customer}</h2><p>{appointment.site} · {appointment.sector} · {appointment.customerFacingDescription}</p></div>
        <button type="button" onClick={onClose}>×</button>
      </header>
      <div className={styles.drawerBody}>
        <section className={styles.formSection}>
          <header><strong>Appointment details</strong><span>{appointment.status === 'cancelled' ? `Cancelled · ${appointment.cancellationReason ?? 'No reason recorded'}` : `${formatDate(appointment.dateKey)} · ${formatTime(primary?.start)}–${formatTime(primary?.end)}`}</span></header>
          <div className={styles.formGrid}>
            <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>WORK SCOPE</span><div style={{ display: 'grid', gap: 4, marginTop: 5 }}>{displayWorkLines.map((line) => <strong key={line.id} style={{ display: 'block' }}>{presetLabel(line.presetId)} · {line.quantity} item/unit{line.quantity === 1 ? '' : 's'}</strong>)}</div></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>TOTAL ITEMS / UNITS</span><strong style={{ display: 'block', marginTop: 4 }}>{appointment.totalQuantity}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>PRIMARY VAN</span><strong style={{ display: 'block', marginTop: 4 }}>{primary?.vanId?.replace('VAN-', 'Van ') ?? appointment.primaryVanId}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>SUPPORT</span><strong style={{ display: 'block', marginTop: 4 }}>{support ? `${support.vanId.replace('VAN-', 'Van ')} · ${formatTime(support.start)}–${formatTime(support.end)}` : 'None'}</strong></div>
            <div><span style={{ color: 'var(--muted)', fontSize: 7 }}>CUSTOMER RESTRICTION</span><strong style={{ display: 'block', marginTop: 4 }}>{appointment.bookingRestriction?.halfDay ? appointment.bookingRestriction.halfDay.toUpperCase() : appointment.bookingRestriction?.notBefore ? `After ${formatTime(appointment.bookingRestriction.notBefore)}` : appointment.bookingRestriction?.notAfter ? `Before ${formatTime(appointment.bookingRestriction.notAfter)}` : 'None'}</strong></div>
            <div className={styles.wide}><span style={{ color: 'var(--muted)', fontSize: 7 }}>TECHNICIAN INSTRUCTIONS</span><strong style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap' }}>{appointment.technicianInstructions || 'No internal instructions.'}</strong></div>
          </div>
        </section>

        {mode === 'details' ? <>
          <section className={styles.formSection}>
            <header><strong>Manage appointment</strong><span>Actions are separated so customer changes are not confused with internal dispatch optimization.</span></header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, padding: 11 }}>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={() => begin('edit')}>Edit Scope / Details</button>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={() => begin('move')}>Move / Reassign</button>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={() => begin('reschedule')}>Reschedule</button>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={() => begin('issue')}>Record Issue</button>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={onArmMove}>{moveArmed ? 'Drag Mode Armed' : 'Arm Drag Mode'}</button>
              <button className={styles.secondary} type="button" disabled={!canManage || appointment.status === 'cancelled'} onClick={() => begin('cancel')} style={{ color: 'var(--danger)' }}>Cancel Appointment</button>
            </div>
            {!canManage ? <div className={styles.descriptionPreview}><span>READ-ONLY ACCESS</span><strong>Your role can view Scheduling but does not have scheduling.manage permission.</strong></div> : null}
            {moveArmed ? <div className={styles.descriptionPreview}><span>MOVE MODE ARMED</span><strong>Close this panel, then hold and drag the appointment to a highlighted valid slot. Press Esc or double-click the appointment again to disarm.</strong></div> : null}
          </section>
        </> : null}

        {mode === 'edit' ? <section className={styles.formSection}><header><strong>Edit appointment scope</strong><span>Every work line participates in the combined duration; saving is blocked if the current work spot no longer fits.</span></header>
          <div style={{ display: 'grid', gap: 8, padding: 11 }}>{editWorkLines.map((line, index) => <div className={styles.formGrid} key={line.id} style={{ padding: 9, border: '1px solid var(--border)', borderRadius: 9 }}>
            <label className={styles.wide}><span>Work line {index + 1}</span><select value={line.presetId} onChange={(event) => updateWorkLine(line.id, { presetId: event.target.value as WorkPresetId })}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>
            <label><span>Quantity</span><input type="number" min={1} max={14} value={line.quantityInput} onChange={(event) => { if (/^\d*$/.test(event.target.value)) updateWorkLine(line.id, { quantityInput: event.target.value }); }} /></label>
            <div style={{ display: 'flex', alignItems: 'end' }}>{editWorkLines.length > 1 ? <button type="button" className={styles.secondary} onClick={() => setEditWorkLines((current) => current.filter((item) => item.id !== line.id))}>Remove line</button> : null}</div>
          </div>)}</div>
          <div style={{ padding: '0 11px 9px' }}><button type="button" className={styles.secondary} onClick={() => setEditWorkLines((current) => [...current, newWorkLine(current.length)])}>+ Add another work type</button></div>
          <div className={styles.formGrid}><label className={styles.wide}><span>Technician instructions</span><textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label></div>
          <ActionFooter error={error} onBack={() => setMode('details')} onSave={applyEdit} saveLabel="Save Scope" />
        </section> : null}

        {mode === 'move' ? <section className={styles.formSection}><header><strong>Move / Reassign · same day</strong><span>Only Booking Intelligence-approved destinations are shown. This is an operational move, not a customer reschedule.</span></header><div className={styles.slotOptions}>
          {moveCandidates.length ? moveCandidates.map((slot) => {
            const key = `${slot.vanId}|${slot.start}|${slot.supportVanId ?? ''}|${slot.supportStart ?? ''}`;
            return <button type="button" className={styles.slotOption} key={key} onClick={() => applyMove(key)}><div><strong>{slot.vanId.replace('VAN-', 'Van ')} · {formatTime(slot.start)}–{formatTime(slot.end)}</strong><span>{slot.supportVanId ? `Support ${slot.supportVanId.replace('VAN-', 'Van ')} · ${formatTime(slot.supportStart)}–${formatTime(slot.supportEnd)}` : 'Single-van assignment'}</span></div><b>MOVE</b><small>{slot.reasons.join(' · ') || 'Valid capacity'}</small></button>;
          }) : <div className={styles.noSlots}><strong>No safe move available</strong><p>No other same-day slot satisfies the current duration, route, sector, lunch and support rules.</p></div>}
        </div><ActionFooter error={error} onBack={() => setMode('details')} /></section> : null}

        {mode === 'reschedule' ? <section className={styles.formSection}><header><strong>Customer Reschedule</strong><span>Changing the promised date/time requires a reason and preserves the old schedule in history.</span></header><div className={styles.formGrid}>
          <label><span>New date</span><input type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); setSelectedRescheduleKey(''); }} /></label>
          <label><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{rescheduleReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context..." /></label>
        </div><div className={styles.slotOptions}>{reschedule.day?.isOpen && reschedule.slots.length ? reschedule.slots.map((slot) => {
          const key = `${slot.vanId}|${slot.start}|${slot.supportVanId ?? ''}|${slot.supportStart ?? ''}`;
          return <button type="button" key={key} className={`${styles.slotOption} ${selectedRescheduleKey === key ? styles.slotOptionSelected : ''}`} onClick={() => setSelectedRescheduleKey(key)}><div><strong>{formatDate(targetDate)} · {slot.vanId.replace('VAN-', 'Van ')} · {formatTime(slot.start)}–{formatTime(slot.end)}</strong><span>{slot.supportVanId ? `Linked support ${slot.supportVanId.replace('VAN-', 'Van ')}` : 'Valid route-aware capacity'}</span></div><b>SELECT</b><small>{slot.reasons.join(' · ')}</small></button>;
        }) : <div className={styles.noSlots}><strong>No valid capacity on this date</strong><p>Select another operational date or review the request constraints.</p></div>}</div><ActionFooter error={error} onBack={() => setMode('details')} onSave={applyReschedule} saveLabel="Save Reschedule" /></section> : null}

        {mode === 'cancel' ? <section className={styles.formSection}><header><strong>Cancel appointment</strong><span>Cancellation releases capacity immediately and permanently records the reason.</span></header><div className={styles.formGrid}>
          <label className={styles.wide}><span>Cancellation reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{cancellationReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional details..." /></label>
        </div><ActionFooter error={error} onBack={() => setMode('details')} onSave={applyCancellation} saveLabel="Confirm Cancellation" danger /></section> : null}

        {mode === 'issue' ? <section className={styles.formSection}><header><strong>Record operational issue</strong><span>Use this for no-show/access problems without automatically cancelling the appointment.</span></header><div className={styles.formGrid}>
          <label className={styles.wide}><span>Issue</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select issue</option>{issueReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={styles.wide}><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div><ActionFooter error={error} onBack={() => setMode('details')} onSave={applyIssue} saveLabel="Record Issue" /></section> : null}

        <section className={styles.formSection}><header><strong>History / audit trail</strong><span>Changes are appended; previous schedule events are never overwritten.</span></header><div style={{ display: 'grid', gap: 7, padding: 10 }}>
          {(appointment.lifecycleHistory ?? []).length ? [...(appointment.lifecycleHistory ?? [])].reverse().map((item) => <article key={item.id} style={{ padding: 9, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)' }}><strong style={{ fontSize: 7.5 }}>{historyLabel(item.kind)}</strong><span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 6.2 }}>{new Date(item.at).toLocaleString()} · {item.actorName || 'ERP operator'}</span>{item.reason ? <span style={{ display: 'block', marginTop: 3, fontSize: 6.5 }}>{item.reason}</span> : null}{item.note ? <small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{item.note}</small> : null}{item.from && item.to ? <small style={{ display: 'block', marginTop: 4, color: 'var(--muted)' }}>{formatDate(item.from.dateKey)} {item.from.primaryVanId.replace('VAN-', 'Van ')} {formatTime(item.from.primaryStart)} → {formatDate(item.to.dateKey)} {item.to.primaryVanId.replace('VAN-', 'Van ')} {formatTime(item.to.primaryStart)}</small> : null}</article>) : <div className={styles.noSlots}><strong>No lifecycle changes yet</strong><p>Legacy-created appointments remain compatible; new changes will be recorded here.</p></div>}
        </div></section>
      </div>
      <footer className={styles.drawerFooter}><div><span>Status</span><strong>{appointment.status.replace('_', ' ')}</strong></div><div><button type="button" className={styles.secondary} onClick={onClose}>Close</button></div></footer>
    </aside>
  </div>;
}

function ActionFooter({ error, onBack, onSave, saveLabel, danger = false }: { error: string; onBack: () => void; onSave?: () => void; saveLabel?: string; danger?: boolean }) {
  return <div style={{ padding: '0 11px 11px' }}>{error ? <div style={{ marginBottom: 8, color: 'var(--danger)', fontSize: 7 }}>{error}</div> : null}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}><button type="button" className={styles.secondary} onClick={onBack}>Back</button>{onSave ? <button type="button" className={danger ? styles.secondary : styles.primary} style={danger ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined} onClick={onSave}>{saveLabel ?? 'Save'}</button> : null}</div></div>;
}