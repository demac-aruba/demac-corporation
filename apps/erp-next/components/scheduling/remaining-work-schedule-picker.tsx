'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  checkOfficeCreateAvailability,
  checkOfficeRescheduleAvailability,
  createOfficeLifecycleRequestId,
  getOfficeAppointment,
  rescheduleOfficeAppointment,
  type OfficeAvailabilityResult,
  type OfficeBookingOption,
  type OfficeBookingWorkLine,
} from '../../lib/office-booking-authority';
import {
  createPartialOutcomeRequestId,
  scheduleOfficeRemainingWork,
  type PartialCompletionOutcome,
} from '../../lib/office-partial-completion-authority';
import {
  optionAssignmentCapacityEnd,
  optionAssignmentStart,
  optionPrimaryAssignment,
  optionSupportWindows,
} from '../../lib/live-appointment-edit-state';
import {
  liveCompanyClosureReason,
  liveVanCrew,
  type LiveOperationalCapacityState,
} from '../../lib/live-operational-capacity';
import { currentArubaDateKey, jobOwnsCapacityStart } from '../../lib/scheduling-capacity';
import { getRuntimeSchedulingSettings, minutesToTime, timeToMinutes } from '../../lib/scheduling';
import {
  addDays,
  laterDate,
  optionDurationMinutes,
  optionKey,
  optionsForVan,
} from '../../lib/remaining-work-schedule-picker-model';
import {
  loadVisualScheduleDay,
  peekVisualScheduleDay,
  prefetchAdjacentVisualScheduleDays,
} from '../../lib/visual-schedule-day-cache';
import {
  visualOptionFitsVanPolicy,
  visualVanDayStatus,
  visualVanSlotAvailableByPolicy,
} from '../../lib/visual-schedule-operational-policy';
import styles from './remaining-work-schedule-picker.module.css';

type CanonicalAppointment = Record<string, unknown> & {
  customerId?: string;
  propertyId?: string;
  workLines?: unknown;
};

type RemainingProps = {
  appointment: BrowserAppointmentRecord;
  canonical: CanonicalAppointment;
  outcome: PartialCompletionOutcome;
  onClose: () => void;
  onScheduled: () => Promise<void> | void;
};

type RescheduleProps = {
  appointment: BrowserAppointmentRecord;
  onClose: () => void;
  onRescheduled: () => Promise<void> | void;
};

type VanJob = {
  appointment: BrowserAppointmentRecord;
  assignment: BrowserAppointmentRecord['assignments'][number];
};

type VisualPickerProps = {
  appointment: BrowserAppointmentRecord;
  title: string;
  subtitle: string;
  quantity: number;
  workLabel: string;
  workLines: OfficeBookingWorkLine[];
  initialDate: string;
  minDate: string;
  originalJobNote: string;
  fallbackRequiredMinutes: number;
  controls?: ReactNode;
  canConfirm?: boolean;
  confirmLabel: string;
  confirmingLabel: string;
  footerNote: string;
  loadAvailability: (dateKey: string) => Promise<OfficeAvailabilityResult>;
  confirmSelection: (availability: OfficeAvailabilityResult, option: OfficeBookingOption) => Promise<void>;
  onClose: () => void;
};

const rescheduleReasons = [
  'Customer requested another date',
  'Customer work / personal conflict',
  'No one will be at the property',
  'Access unavailable',
  'DEMAC operational adjustment',
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

function formatLongDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function hoursLabel(minutes: number) {
  if (!minutes) return 'Calculated by Booking Authority';
  const hours = minutes / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
  return `${value} hour${hours === 1 ? '' : 's'}`;
}

function vanNumber(value: string) {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function vanLabel(value: string) {
  const match = value.match(/^VAN-(\d+)$/i);
  return match ? `Van ${Number(match[1])}` : value;
}

function slotEnd(start: string) {
  return minutesToTime(timeToMinutes(start) + 60);
}

function candidateWindow(option: OfficeBookingOption) {
  const primary = optionPrimaryAssignment(option);
  return {
    primary,
    start: primary ? optionAssignmentStart(option, primary) : option.time,
    end: primary ? optionAssignmentCapacityEnd(option, primary) : option.capacityEndTime || option.endTime || '',
  };
}

function candidateSummary(option: OfficeBookingOption) {
  const window = candidateWindow(option);
  return `${formatTime(window.start)}–${formatTime(window.end)}`;
}

function canonicalWorkLines(value: unknown): OfficeBookingWorkLine[] {
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

function sharedWorkText(lines: OfficeBookingWorkLine[], field: 'customerFacingDescription' | 'technicianInstructions') {
  return [...new Set(lines.map((line) => text(line[field])).filter(Boolean))].join('; ');
}

function VisualCapacitySchedulePicker({
  appointment,
  title,
  subtitle,
  quantity,
  workLabel,
  workLines,
  initialDate,
  minDate,
  originalJobNote,
  fallbackRequiredMinutes,
  controls,
  canConfirm = true,
  confirmLabel,
  confirmingLabel,
  footerNote,
  loadAvailability,
  confirmSelection,
  onClose,
}: VisualPickerProps) {
  const [dateKey, setDateKey] = useState(initialDate);
  const initialContext = peekVisualScheduleDay(initialDate);
  const [dayAppointments, setDayAppointments] = useState<BrowserAppointmentRecord[]>(initialContext?.appointments ?? []);
  const [capacityState, setCapacityState] = useState<LiveOperationalCapacityState | null>(initialContext?.capacityState ?? null);
  const [availability, setAvailability] = useState<OfficeAvailabilityResult | null>(null);
  const [selectedOptionKey, setSelectedOptionKey] = useState('');
  const [contextLoading, setContextLoading] = useState(!initialContext);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [scheduleWarning, setScheduleWarning] = useState('');
  const requestSequence = useRef(0);
  const availabilityCache = useRef(new Map<string, OfficeAvailabilityResult>());

  const dayOptions = useMemo(
    () => (availability?.options ?? []).filter((option) => option.date === dateKey),
    [availability, dateKey],
  );
  const selectedOption = useMemo(
    () => dayOptions.find((option) => optionKey(option) === selectedOptionKey) ?? null,
    [dayOptions, selectedOptionKey],
  );
  const requiredMinutes = useMemo(() => {
    const fromAuthority = dayOptions.map(optionDurationMinutes).find((value) => value > 0) ?? 0;
    return fromAuthority || fallbackRequiredMinutes;
  }, [dayOptions, fallbackRequiredMinutes]);

  const allVanJobs = useMemo<VanJob[]>(() => dayAppointments.flatMap((item) => item.assignments
    .filter((assignment) => assignment.status !== 'cancelled')
    .map((assignment) => ({ appointment: item, assignment }))), [dayAppointments]);

  const vanIds = useMemo(() => {
    const ids = new Set<string>();
    capacityState?.vans.forEach((_van, id) => ids.add(id));
    allVanJobs.forEach((entry) => ids.add(entry.assignment.vanId));
    dayOptions.forEach((option) => option.assignments.forEach((assignment) => ids.add(assignment.vanId)));
    return [...ids].filter((id) => /^VAN-\d+$/i.test(id)).sort((a, b) => vanNumber(a) - vanNumber(b));
  }, [allVanJobs, capacityState, dayOptions]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setSelectedOptionKey('');
    setError('');
    setScheduleWarning('');

    const cachedContext = peekVisualScheduleDay(dateKey);
    if (cachedContext) {
      setDayAppointments(cachedContext.appointments);
      setCapacityState(cachedContext.capacityState);
      setContextLoading(false);
    } else {
      setContextLoading(true);
    }

    const cachedAvailability = availabilityCache.current.get(dateKey);
    if (cachedAvailability) {
      setAvailability(cachedAvailability);
      setAvailabilityLoading(false);
      if (!cachedAvailability.available || !cachedAvailability.options.some((option) => option.date === dateKey)) {
        setScheduleWarning('No Van has a complete Booking Authority allocation for all required work on this date. You can inspect the schedule or move to another day.');
      }
    } else {
      setAvailability(null);
      setAvailabilityLoading(true);
      void loadAvailability(dateKey).then((result) => {
        availabilityCache.current.set(dateKey, result);
        if (requestSequence.current !== sequence) return;
        setAvailability(result);
        if (!result.available || !result.options.some((option) => option.date === dateKey)) {
          setScheduleWarning('No Van has a complete Booking Authority allocation for all required work on this date. You can inspect the schedule or move to another day.');
        }
      }).catch((cause) => {
        if (requestSequence.current !== sequence) return;
        setError(cause instanceof Error ? cause.message : 'Booking Authority availability could not be loaded.');
      }).finally(() => {
        if (requestSequence.current === sequence) setAvailabilityLoading(false);
      });
    }

    void loadVisualScheduleDay(dateKey).then((context) => {
      if (requestSequence.current !== sequence) return;
      setDayAppointments(context.appointments);
      setCapacityState(context.capacityState);
      setContextLoading(false);
      prefetchAdjacentVisualScheduleDays(dateKey);
    }).catch(() => {
      if (requestSequence.current !== sequence) return;
      setContextLoading(false);
      setScheduleWarning((current) => current || 'The live schedule context could not be loaded. Booking Authority remains the final capacity authority.');
    });
  }, [dateKey]);

  const moveDay = (delta: number) => {
    const next = addDays(dateKey, delta);
    if (next < minDate) return;
    setDateKey(next);
  };

  const confirm = async () => {
    if (!availability?.offer || !selectedOption || !canConfirm || scheduling) return;
    setScheduling(true);
    setError('');
    try {
      await confirmSelection(availability, selectedOption);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scheduling change could not be completed.');
    } finally {
      setScheduling(false);
    }
  };

  const selectedPrimary = selectedOption ? optionPrimaryAssignment(selectedOption) : null;
  const selectedSupport = selectedOption ? optionSupportWindows(selectedOption) : [];
  const selectedDuration = selectedOption ? optionDurationMinutes(selectedOption) : requiredMinutes;
  const settings = getRuntimeSchedulingSettings();
  const closure = liveCompanyClosureReason(capacityState, dateKey);

  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !scheduling) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>BOOKING AUTHORITY · VISUAL CAPACITY</span><h2>{title}</h2><p>{subtitle}</p></div>
        <button type="button" className={styles.close} onClick={onClose} disabled={scheduling} aria-label="Close schedule picker">×</button>
      </header>

      <div className={styles.body}>
        <section className={styles.kpis}>
          <article><span>WORK</span><strong>{quantity} unit{quantity === 1 ? '' : 's'}</strong><small>{workLabel}</small></article>
          <article><span>REQUIRED WORK TIME</span><strong>{hoursLabel(requiredMinutes)}</strong><small>{dayOptions.length ? 'Based on Booking Authority allocation' : 'Recalculated when capacity is available'}</small></article>
          <article><span>ORIGINAL JOB</span><strong>{vanLabel(appointment.primaryVanId)} · {formatLongDate(appointment.dateKey)}</strong><small>{originalJobNote}</small></article>
        </section>

        {controls}

        <section className={styles.dayToolbar}>
          <button type="button" onClick={() => moveDay(-1)} disabled={dateKey <= minDate || scheduling}>← <span>Previous Day</span></button>
          <label><span>📅</span><input type="date" min={minDate} value={dateKey} disabled={scheduling} onChange={(event) => setDateKey(event.target.value)} /><strong>{formatLongDate(dateKey)}</strong></label>
          <button type="button" onClick={() => moveDay(1)} disabled={scheduling}><span>Next Day</span> →</button>
        </section>

        {closure ? <div className={styles.warning}><strong>{closure}</strong><span>This date is operationally closed. Navigate to another day.</span></div> : null}
        {availabilityLoading ? <div className={styles.info}><strong>Checking Booking Authority</strong><span>The live schedule is available while verified complete-match options are being calculated.</span></div> : null}
        {scheduleWarning ? <div className={styles.info}><strong>Capacity note</strong><span>{scheduleWarning}</span></div> : null}
        {error ? <div className={styles.error}><strong>Attention</strong><span>{error}</span></div> : null}

        {contextLoading && !dayAppointments.length && !capacityState ? <div className={styles.loadingGrid}>{Array.from({ length: 5 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}</div> : <div className={styles.vanScroller}>
          <div className={styles.vanGrid}>
            {vanIds.map((vanId) => {
              const crew = liveVanCrew(capacityState, vanId, dateKey);
              const dayStatus = visualVanDayStatus(capacityState, vanId, dateKey);
              const operational = !closure && dayStatus.operational;
              const jobs = allVanJobs.filter((entry) => entry.assignment.vanId === vanId);
              const candidates = operational ? optionsForVan(dayOptions, dateKey, vanId).filter((option) => {
                const window = candidateWindow(option);
                return visualOptionFitsVanPolicy(capacityState, vanId, dateKey, window.start, window.end);
              }) : [];
              const halfDay = Boolean(dayStatus.halfDay);
              return <article key={vanId} className={`${styles.vanCard} ${candidates.length ? styles.hasMatch : ''}`}>
                <header>
                  <div><strong>{vanLabel(vanId)}</strong><span>{crew.label}</span></div>
                  <b className={operational ? styles.activeBadge : styles.offBadge} style={halfDay && operational ? { color: 'var(--warning)' } : undefined}>{closure ? 'UNAVAILABLE' : dayStatus.label}</b>
                </header>

                <div className={styles.matches}>
                  {candidates.length ? candidates.map((option) => {
                    const key = optionKey(option);
                    const selected = selectedOptionKey === key;
                    const duration = optionDurationMinutes(option);
                    const support = optionSupportWindows(option);
                    return <button key={key} type="button" className={`${styles.match} ${selected ? styles.matchSelected : ''}`} aria-pressed={selected} onClick={() => setSelectedOptionKey(key)} disabled={scheduling}>
                      <span>✓ COMPLETE MATCH</span><strong>{candidateSummary(option)}</strong><small>{hoursLabel(duration)} available · fits required work</small>
                      {support.length ? <small>{support.map((item) => `${vanLabel(item.assignment.vanId)} support ${formatTime(item.start)}–${formatTime(item.capacityEnd || item.workEnd)}`).join(' · ')}</small> : null}
                    </button>;
                  }) : <div className={styles.noMatch}><span>NO COMPLETE MATCH</span><small>{operational ? 'Inspect open slots or try another day.' : 'Van unavailable for this date.'}</small></div>}
                </div>

                <div className={styles.timeline}>
                  {settings.serviceStartTimes.map((slot) => {
                    const owned = jobs.find((entry) => jobOwnsCapacityStart(entry.assignment, slot));
                    const policyAvailable = !closure && visualVanSlotAvailableByPolicy(capacityState, vanId, dateKey, slot);
                    const isAvailable = policyAvailable && !owned;
                    return <div key={slot} className={owned ? styles.bookedSlot : isAvailable ? styles.availableSlot : styles.closedSlot}>
                      <strong>{formatTime(slot)}–{formatTime(slotEnd(slot))}</strong>
                      <span>{owned ? owned.appointment.customer : isAvailable ? 'Available' : halfDay && !policyAvailable ? 'Half-day schedule' : 'Not available'}</span>
                      <b>{owned ? 'Booked' : isAvailable ? 'Open' : 'Off'}</b>
                    </div>;
                  }).flatMap((row, index) => index === 2 ? [row, <div key="lunch" className={styles.lunch}><span>{formatTime(settings.lunchStart)}–{formatTime(settings.lunchEnd)}</span><strong>Lunch / Break</strong></div>] : [row])}
                </div>
              </article>;
            })}
          </div>
        </div>}

        {!contextLoading && !vanIds.length ? <div className={styles.empty}><strong>No active Vans were found for this date.</strong><span>Booking Authority did not return a usable fleet view.</span></div> : null}
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerHint}><span>ⓘ</span><p><strong>Only complete Booking Authority matches are selectable.</strong> Open-looking slots are visual context; half-day and operational rules are enforced, and no slot becomes a reservation until the complete allocation is confirmed.</p></div>
        <div className={styles.selection}>
          <div><span>SELECTED OPTION</span>{selectedOption && selectedPrimary ? <><strong>{selectedPrimary.vanName || vanLabel(selectedPrimary.vanId)} · {formatLongDate(selectedOption.date)}</strong><small>{candidateSummary(selectedOption)} · {hoursLabel(selectedDuration)}{selectedSupport.length ? ` · ${selectedSupport.length} support Van${selectedSupport.length === 1 ? '' : 's'}` : ''}</small></> : <><strong>No allocation selected</strong><small>Select a green complete-match block above.</small></>}</div>
          <div className={styles.workSummary}><span>WORK SUMMARY</span><strong>{quantity} {workLabel} unit{quantity === 1 ? '' : 's'}</strong><small>{footerNote}</small></div>
          <div className={styles.actions}><button type="button" className={styles.cancel} onClick={onClose} disabled={scheduling}>Cancel</button><button type="button" className={styles.confirm} disabled={!selectedOption || !availability?.offer || availabilityLoading || !canConfirm || scheduling} onClick={() => void confirm()}>{scheduling ? confirmingLabel : confirmLabel}</button></div>
        </div>
      </footer>
    </section>
  </div>;
}

export function RemainingWorkSchedulePicker({ appointment, canonical, outcome, onClose, onScheduled }: RemainingProps) {
  const today = currentArubaDateKey();
  const customerId = text(canonical.customerId) || appointment.customerId || '';
  const propertyId = text(canonical.propertyId) || appointment.siteId || '';
  const workLines = outcome.remainingWorkLines as OfficeBookingWorkLine[];
  const perUnit = Number(appointment.durationMinutesPerUnit || 0);
  const manual = workLines.reduce((sum, line) => sum + Math.max(0, Number(line.manualDurationMinutes) || 0), 0);
  const fallbackRequiredMinutes = perUnit > 0 ? perUnit * outcome.remainingQuantity : manual;

  return <VisualCapacitySchedulePicker
    appointment={appointment}
    title="Schedule Remaining Work"
    subtitle={`${appointment.customer} · ${outcome.remainingQuantity} ${appointment.workLabel || 'work'} unit${outcome.remainingQuantity === 1 ? '' : 's'} remaining`}
    quantity={outcome.remainingQuantity}
    workLabel={appointment.workLabel || workLines[0]?.presetId.replaceAll('_', ' ') || 'work'}
    workLines={workLines}
    initialDate={laterDate(today, addDays(appointment.dateKey, 1))}
    minDate={today}
    originalJobNote="Partial completion recorded"
    fallbackRequiredMinutes={fallbackRequiredMinutes}
    confirmLabel="Confirm Reassignment"
    confirmingLabel="Reassigning…"
    footerNote="Follow-up will stay linked to the original appointment."
    loadAvailability={(target) => {
      if (!customerId || !propertyId || !workLines.length) return Promise.reject(new Error('The remaining work is missing its canonical customer, property, or work definition.'));
      return checkOfficeCreateAvailability({
        requestId: createPartialOutcomeRequestId('remaining-visual-availability'),
        customerId,
        propertyId,
        workLines,
        requestedDate: target,
        requestedTime: '',
        requiredVanId: '',
        customerFacingDescription: workLines.map((line) => line.customerFacingDescription).filter(Boolean).join('; '),
        technicianInstructions: workLines.map((line) => line.technicianInstructions).filter(Boolean).join('; '),
        notes: `Remaining work from partial completion of appointment ${appointment.id}.`,
      });
    }}
    confirmSelection={async (availability, option) => {
      if (!availability.offer) throw new Error('Booking Authority did not return a valid offer.');
      await scheduleOfficeRemainingWork({
        appointmentId: appointment.id,
        requestId: createPartialOutcomeRequestId('remaining-schedule'),
        offerId: availability.offer.id,
        offerVersion: availability.offer.version,
        optionId: option.id,
      });
      await onScheduled();
    }}
    onClose={onClose}
  />;
}

export function AppointmentRescheduleSchedulePicker({ appointment, onClose, onRescheduled }: RescheduleProps) {
  const today = currentArubaDateKey();
  const [canonical, setCanonical] = useState<CanonicalAppointment | null>(null);
  const [canonicalError, setCanonicalError] = useState('');
  const [reason, setReason] = useState('Customer requested another date');
  const [note, setNote] = useState('');

  useEffect(() => {
    let active = true;
    void getOfficeAppointment(appointment.id).then((result) => {
      if (active) setCanonical(result.appointment as CanonicalAppointment);
    }).catch((cause) => {
      if (active) setCanonicalError(cause instanceof Error ? cause.message : 'The canonical appointment could not be loaded.');
    });
    return () => { active = false; };
  }, [appointment.id]);

  if (!canonical) {
    return <div className={styles.overlay} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Reschedule appointment"><header className={styles.header}><div><span className={styles.eyebrow}>BOOKING AUTHORITY · VISUAL CAPACITY</span><h2>Reschedule Appointment</h2><p>{appointment.customer}</p></div><button type="button" className={styles.close} onClick={onClose}>×</button></header><div className={styles.body}>{canonicalError ? <div className={styles.error}><strong>Attention</strong><span>{canonicalError}</span></div> : <div className={styles.loadingGrid}>{Array.from({ length: 5 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}</div>}</div></section></div>;
  }

  const workLines = canonicalWorkLines(canonical.workLines);
  const customerId = text(canonical.customerId) || appointment.customerId || '';
  const propertyId = text(canonical.propertyId) || appointment.siteId || '';
  const quantity = workLines.reduce((sum, line) => sum + line.quantity, 0) || appointment.totalQuantity;
  const fallbackRequiredMinutes = Number(appointment.scheduledDurationMinutes || 0)
    || (Number(appointment.durationMinutesPerUnit || 0) > 0 ? Number(appointment.durationMinutesPerUnit) * quantity : 0);
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)', background: 'var(--surface-2)', font: 'inherit', fontSize: 12 };

  return <VisualCapacitySchedulePicker
    appointment={appointment}
    title={appointment.status === 'temporary_hold' ? 'Move Temporary Hold' : 'Reschedule Appointment'}
    subtitle={`${appointment.customer} · move the existing appointment without recreating it`}
    quantity={quantity}
    workLabel={appointment.workLabel || 'scheduled work'}
    workLines={workLines}
    initialDate={laterDate(today, appointment.dateKey)}
    minDate={today}
    originalJobNote="Current appointment"
    fallbackRequiredMinutes={fallbackRequiredMinutes}
    controls={<section style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, .7fr) minmax(320px, 1.3fr)', gap: 10, marginBottom: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
      <label style={{ display: 'grid', gap: 5 }}><span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 850, letterSpacing: '.05em' }}>RESCHEDULE REASON</span><select value={reason} onChange={(event) => setReason(event.target.value)} style={inputStyle}><option value="">Select reason</option>{rescheduleReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label style={{ display: 'grid', gap: 5 }}><span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 850, letterSpacing: '.05em' }}>INTERNAL NOTE</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional operational context" style={inputStyle} /></label>
    </section>}
    canConfirm={Boolean(reason)}
    confirmLabel={appointment.status === 'temporary_hold' ? 'Confirm Hold Move' : 'Confirm Reschedule'}
    confirmingLabel="Rescheduling…"
    footerNote="The same appointment and Work Order relationship will be preserved."
    loadAvailability={(target) => {
      if (!customerId || !propertyId || !workLines.length) return Promise.reject(new Error('This appointment is missing its canonical customer, property, or work definition.'));
      return checkOfficeRescheduleAvailability({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('visual-reschedule-availability'),
        customerId,
        propertyId,
        workLines,
        requestedDate: target,
        includeRequestedDateAlternatives: true,
        customerFacingDescription: sharedWorkText(workLines, 'customerFacingDescription') || appointment.customerFacingDescription,
        technicianInstructions: sharedWorkText(workLines, 'technicianInstructions') || appointment.technicianInstructions,
        changeKind: 'customer_reschedule',
      });
    }}
    confirmSelection={async (availability, option) => {
      if (!availability.offer) throw new Error('Booking Authority did not return a valid reschedule offer.');
      await rescheduleOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('visual-reschedule'),
        offerId: availability.offer.id,
        offerVersion: availability.offer.version,
        optionId: option.id,
        reason,
        note,
        changeKind: 'customer_reschedule',
      });
      await onRescheduled();
    }}
    onClose={onClose}
  />;
}
