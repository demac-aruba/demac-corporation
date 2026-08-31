'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  checkOfficeCreateAvailability,
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
import { loadLiveSchedulingAppointmentsFast } from '../../lib/live-scheduling-fast';
import {
  liveCompanyClosureReason,
  liveVanCrew,
  liveVanOperationallyAvailable,
  loadLiveOperationalCapacityState,
  type LiveOperationalCapacityState,
} from '../../lib/live-operational-capacity';
import { currentArubaDateKey, jobOwnsCapacityStart } from '../../lib/scheduling-capacity';
import { getRuntimeSchedulingSettings, minutesToTime, timeToMinutes } from '../../lib/scheduling';
import {
  addDays,
  laterDate,
  optionDurationMinutes,
  optionKey,
  optionPrimaryVanId,
  optionsForVan,
} from '../../lib/remaining-work-schedule-picker-model';
import styles from './remaining-work-schedule-picker.module.css';

type CanonicalAppointment = Record<string, unknown> & {
  customerId?: string;
  propertyId?: string;
};

type Props = {
  appointment: BrowserAppointmentRecord;
  canonical: CanonicalAppointment;
  outcome: PartialCompletionOutcome;
  onClose: () => void;
  onScheduled: () => Promise<void> | void;
};

type VanJob = {
  appointment: BrowserAppointmentRecord;
  assignment: BrowserAppointmentRecord['assignments'][number];
};

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
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
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

function candidateSummary(option: OfficeBookingOption) {
  const primary = optionPrimaryAssignment(option);
  const start = primary ? optionAssignmentStart(option, primary) : option.time;
  const end = primary ? optionAssignmentCapacityEnd(option, primary) : option.capacityEndTime || option.endTime;
  return `${formatTime(start)}–${formatTime(end)}`;
}

export function RemainingWorkSchedulePicker({ appointment, canonical, outcome, onClose, onScheduled }: Props) {
  const today = currentArubaDateKey();
  const firstFollowUpDate = laterDate(today, addDays(appointment.dateKey, 1));
  const [dateKey, setDateKey] = useState(firstFollowUpDate);
  const [availability, setAvailability] = useState<OfficeAvailabilityResult | null>(null);
  const [dayAppointments, setDayAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [capacityState, setCapacityState] = useState<LiveOperationalCapacityState | null>(null);
  const [selectedOptionKey, setSelectedOptionKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [scheduleWarning, setScheduleWarning] = useState('');

  const customerId = text(canonical.customerId) || appointment.customerId || '';
  const propertyId = text(canonical.propertyId) || appointment.siteId || '';
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
    if (fromAuthority) return fromAuthority;
    const perUnit = Number(appointment.durationMinutesPerUnit || 0);
    if (perUnit > 0) return perUnit * outcome.remainingQuantity;
    const manual = outcome.remainingWorkLines.reduce((sum, line) => sum + Math.max(0, Number(line.manualDurationMinutes) || 0), 0);
    return manual;
  }, [appointment.durationMinutesPerUnit, dayOptions, outcome.remainingQuantity, outcome.remainingWorkLines]);

  const allVanJobs = useMemo<VanJob[]>(() => dayAppointments.flatMap((item) => item.assignments
    .filter((assignment) => assignment.status !== 'cancelled')
    .map((assignment) => ({ appointment: item, assignment }))), [dayAppointments]);

  const vanIds = useMemo(() => {
    const ids = new Set<string>();
    capacityState?.vans.forEach((_van, id) => ids.add(id));
    allVanJobs.forEach((entry) => ids.add(entry.assignment.vanId));
    dayOptions.forEach((option) => option.assignments.forEach((assignment) => ids.add(assignment.vanId)));
    return [...ids]
      .filter((id) => /^VAN-\d+$/i.test(id))
      .sort((left, right) => vanNumber(left) - vanNumber(right));
  }, [allVanJobs, capacityState, dayOptions]);

  const loadDay = async (target: string) => {
    if (!customerId || !propertyId || !outcome.remainingWorkLines.length) {
      setError('The remaining work is missing its canonical customer, property, or work definition.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setScheduleWarning('');
    setSelectedOptionKey('');

    const availabilityPromise = checkOfficeCreateAvailability({
      requestId: createPartialOutcomeRequestId('remaining-visual-availability'),
      customerId,
      propertyId,
      workLines: outcome.remainingWorkLines as OfficeBookingWorkLine[],
      requestedDate: target,
      requestedTime: '',
      requiredVanId: '',
      customerFacingDescription: outcome.remainingWorkLines.map((line) => line.customerFacingDescription).filter(Boolean).join('; '),
      technicianInstructions: outcome.remainingWorkLines.map((line) => line.technicianInstructions).filter(Boolean).join('; '),
      notes: `Remaining work from partial completion of appointment ${appointment.id}.`,
    });
    const schedulePromise = loadLiveSchedulingAppointmentsFast({ startDate: target, endDate: target });
    const statePromise = loadLiveOperationalCapacityState({ startDate: target, endDate: target });

    const [availabilityResult, scheduleResult, stateResult] = await Promise.allSettled([
      availabilityPromise,
      schedulePromise,
      statePromise,
    ]);

    if (availabilityResult.status === 'fulfilled') {
      setAvailability(availabilityResult.value);
      if (!availabilityResult.value.available || !availabilityResult.value.options.some((option) => option.date === target)) {
        setScheduleWarning('No Van has a complete Booking Authority allocation for all remaining work on this date. You can inspect the schedule or move to another day.');
      }
    } else {
      setAvailability(null);
      setError(availabilityResult.reason instanceof Error ? availabilityResult.reason.message : 'Booking Authority availability could not be loaded.');
    }

    if (scheduleResult.status === 'fulfilled') setDayAppointments(scheduleResult.value);
    else {
      setDayAppointments([]);
      setScheduleWarning((current) => current || 'The live schedule could not be loaded. Booking Authority remains the final capacity authority.');
    }

    if (stateResult.status === 'fulfilled') setCapacityState(stateResult.value);
    else setCapacityState(null);
    setLoading(false);
  };

  useEffect(() => {
    void loadDay(dateKey);
  }, [dateKey]);

  const moveDay = (delta: number) => {
    const next = addDays(dateKey, delta);
    if (next < today) return;
    setDateKey(next);
  };

  const confirm = async () => {
    if (!availability?.offer || !selectedOption || scheduling) return;
    setScheduling(true);
    setError('');
    try {
      await scheduleOfficeRemainingWork({
        appointmentId: appointment.id,
        requestId: createPartialOutcomeRequestId('remaining-schedule'),
        offerId: availability.offer.id,
        offerVersion: availability.offer.version,
        optionId: selectedOption.id,
      });
      await onScheduled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The remaining work could not be reassigned.');
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
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Schedule remaining work">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>BOOKING AUTHORITY · VISUAL CAPACITY</span>
          <h2>Schedule Remaining Work</h2>
          <p>{appointment.customer} · {outcome.remainingQuantity} {appointment.workLabel || 'work'} unit{outcome.remainingQuantity === 1 ? '' : 's'} remaining</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} disabled={scheduling} aria-label="Close schedule picker">×</button>
      </header>

      <div className={styles.body}>
        <section className={styles.kpis}>
          <article><span>REMAINING</span><strong>{outcome.remainingQuantity} units</strong><small>{appointment.workLabel || outcome.remainingWorkLines[0]?.presetId.replaceAll('_', ' ')}</small></article>
          <article><span>REQUIRED WORK TIME</span><strong>{hoursLabel(requiredMinutes)}</strong><small>{dayOptions.length ? 'Based on Booking Authority allocation' : 'Recalculated when capacity is available'}</small></article>
          <article><span>ORIGINAL JOB</span><strong>{vanLabel(appointment.primaryVanId)} · {formatLongDate(appointment.dateKey)}</strong><small>Partial completion recorded</small></article>
        </section>

        <section className={styles.dayToolbar}>
          <button type="button" onClick={() => moveDay(-1)} disabled={dateKey <= today || loading || scheduling}>← <span>Previous Day</span></button>
          <label><span>📅</span><input type="date" min={today} value={dateKey} disabled={loading || scheduling} onChange={(event) => setDateKey(event.target.value)} /><strong>{formatLongDate(dateKey)}</strong></label>
          <button type="button" onClick={() => moveDay(1)} disabled={loading || scheduling}><span>Next Day</span> →</button>
        </section>

        {closure ? <div className={styles.warning}><strong>{closure}</strong><span>This date is operationally closed. Navigate to another day.</span></div> : null}
        {scheduleWarning ? <div className={styles.info}><strong>Capacity note</strong><span>{scheduleWarning}</span></div> : null}
        {error ? <div className={styles.error}><strong>Attention</strong><span>{error}</span></div> : null}

        {loading ? <div className={styles.loadingGrid}>{Array.from({ length: 5 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}</div> : <div className={styles.vanScroller}>
          <div className={styles.vanGrid}>
            {vanIds.map((vanId) => {
              const crew = liveVanCrew(capacityState, vanId, dateKey);
              const operational = !closure && liveVanOperationallyAvailable(capacityState, vanId, dateKey);
              const jobs = allVanJobs.filter((entry) => entry.assignment.vanId === vanId);
              const candidates = operational ? optionsForVan(dayOptions, dateKey, vanId) : [];
              return <article key={vanId} className={`${styles.vanCard} ${candidates.length ? styles.hasMatch : ''}`}>
                <header>
                  <div><strong>{vanLabel(vanId)}</strong><span>{crew.label}</span></div>
                  <b className={operational ? styles.activeBadge : styles.offBadge}>{operational ? 'ACTIVE' : 'UNAVAILABLE'}</b>
                </header>

                <div className={styles.matches}>
                  {candidates.length ? candidates.map((option) => {
                    const key = optionKey(option);
                    const selected = selectedOptionKey === key;
                    const duration = optionDurationMinutes(option);
                    const support = optionSupportWindows(option);
                    return <button key={key} type="button" className={`${styles.match} ${selected ? styles.matchSelected : ''}`} aria-pressed={selected} onClick={() => setSelectedOptionKey(key)} disabled={scheduling}>
                      <span>✓ COMPLETE MATCH</span>
                      <strong>{candidateSummary(option)}</strong>
                      <small>{hoursLabel(duration)} available · fits remaining work</small>
                      {support.length ? <small>{support.map((item) => `${vanLabel(item.assignment.vanId)} support ${formatTime(item.start)}–${formatTime(item.capacityEnd || item.workEnd)}`).join(' · ')}</small> : null}
                    </button>;
                  }) : <div className={styles.noMatch}><span>NO COMPLETE MATCH</span><small>{operational ? 'Inspect open slots or try another day.' : 'Van unavailable for this date.'}</small></div>}
                </div>

                <div className={styles.timeline}>
                  {settings.serviceStartTimes.map((slot, index) => {
                    const owned = jobs.find((entry) => jobOwnsCapacityStart(entry.assignment, slot));
                    const isAvailable = operational && !owned;
                    return <div key={slot} className={owned ? styles.bookedSlot : isAvailable ? styles.availableSlot : styles.closedSlot}>
                      <strong>{formatTime(slot)}–{formatTime(slotEnd(slot))}</strong>
                      <span>{owned ? owned.appointment.customer : isAvailable ? 'Available' : 'Not available'}</span>
                      <b>{owned ? 'Booked' : isAvailable ? 'Open' : 'Off'}</b>
                    </div>;
                  }).flatMap((row, index) => index === 2 ? [row, <div key="lunch" className={styles.lunch}><span>{formatTime(settings.lunchStart)}–{formatTime(settings.lunchEnd)}</span><strong>Lunch / Break</strong></div>] : [row])}
                </div>
              </article>;
            })}
          </div>
        </div>}

        {!loading && !vanIds.length ? <div className={styles.empty}><strong>No active Vans were found for this date.</strong><span>Booking Authority did not return a usable fleet view.</span></div> : null}
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerHint}>
          <span>ⓘ</span>
          <p><strong>Only complete Booking Authority matches are selectable.</strong> Open-looking slots are visual context; they are not a reservation until the complete work allocation is highlighted and confirmed.</p>
        </div>
        <div className={styles.selection}>
          <div>
            <span>SELECTED OPTION</span>
            {selectedOption && selectedPrimary ? <>
              <strong>{selectedPrimary.vanName || vanLabel(selectedPrimary.vanId)} · {formatLongDate(selectedOption.date)}</strong>
              <small>{candidateSummary(selectedOption)} · {hoursLabel(selectedDuration)}{selectedSupport.length ? ` · ${selectedSupport.length} support Van${selectedSupport.length === 1 ? '' : 's'}` : ''}</small>
            </> : <><strong>No allocation selected</strong><small>Select a green complete-match block above.</small></>}
          </div>
          <div className={styles.workSummary}>
            <span>WORK SUMMARY</span>
            <strong>{outcome.remainingQuantity} {appointment.workLabel || 'work'} unit{outcome.remainingQuantity === 1 ? '' : 's'}</strong>
            <small>Follow-up will stay linked to the original appointment.</small>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose} disabled={scheduling}>Cancel</button>
            <button type="button" className={styles.confirm} disabled={!selectedOption || !availability?.offer || scheduling} onClick={() => void confirm()}>{scheduling ? 'Reassigning…' : 'Confirm Reassignment'}</button>
          </div>
        </div>
      </footer>
    </section>
  </div>;
}
