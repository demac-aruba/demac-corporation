'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  liveCompanyClosureReason,
  liveOperationalStartTimes,
  liveOperationalWindowAllows,
  liveVanCrew,
  liveVanHalfDaySchedule,
  liveVanOperationallyAvailable,
  loadLiveOperationalCapacityState,
  type LiveOperationalCapacityState,
} from '../../lib/live-operational-capacity';
import {
  enrichLiveSchedulingAttribution,
  loadLiveSchedulingAppointmentsFast,
} from '../../lib/live-scheduling-fast';
import {
  liveDragMoveCandidates,
  liveMoveTargetKey,
  projectCommittedLiveMove,
} from '../../lib/live-scheduling-move';
import {
  createOfficeLifecycleRequestId,
  moveOfficeAppointment,
} from '../../lib/office-booking-authority';
import type { CandidateSlot, DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { defaultWorkPresets, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey } from '../../lib/scheduling-capacity';
import { DragMoveConfirmation, type PendingDragMove } from './drag-move-confirmation';
import { LiveAppointmentCreateDrawer, type LiveBookingTarget, type LiveCreatedBooking } from './live-appointment-create-drawer';
import { LiveAppointmentDetailsDrawer } from './live-appointment-details-drawer';
import styles from './scheduling-overview-v2.module.css';

type DisplaySlot = { start: string; end: string; segment: 'am' | 'pm'; operational: boolean; offReason?: string };
type DisplayVan = { id: string; name: string; active: boolean };
type JobLink = { appointmentId: string; appointment: BrowserAppointmentRecord };
type PendingLiveMove = PendingDragMove & { jobId: string; candidate: CandidateSlot };

function appointmentAssignments(record: BrowserAppointmentRecord): CalendarDispatchJob[] {
  if (record.status === 'cancelled') return [];
  return record.assignments
    .filter((assignment) => assignment.status !== 'cancelled')
    .map((assignment) => ({ ...assignment, dateKey: record.dateKey, status: 'confirmed' }));
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function presetLabel(id: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === id)?.label ?? 'Other work';
}

function displaySlotsForVan(day: OperationalDay, vanId: string, capacityState: LiveOperationalCapacityState | null): DisplaySlot[] {
  if (!day.isOpen) return [];
  const baseStarts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : getRuntimeSchedulingSettings().serviceStartTimes;
  const starts = liveOperationalStartTimes(capacityState, vanId, day.dateKey, baseStarts);
  const halfDay = liveVanHalfDaySchedule(capacityState, vanId, day.dateKey);
  const vanAvailable = liveVanOperationallyAvailable(capacityState, vanId, day.dateKey);

  return starts.map((start) => {
    const startMinutes = timeToMinutes(start);
    const end = minutesToTime(startMinutes + 60);
    const operational = vanAvailable && liveOperationalWindowAllows(capacityState, vanId, day.dateKey, start, end);
    const offReason = operational
      ? undefined
      : !vanAvailable
        ? 'Van unavailable'
        : halfDay
          ? `Weekly half-day · off after ${formatTime(halfDay.workdayEnd || '13:00')}`
          : liveCompanyClosureReason(capacityState, day.dateKey) || 'Outside operating capacity';
    return { start, end, segment: startMinutes < 12 * 60 ? 'am' : 'pm', operational, offReason };
  });
}

function overlapsSlot(job: CalendarDispatchJob, slot: DisplaySlot) {
  if (job.status === 'cancelled') return false;
  return timeToMinutes(job.start) < timeToMinutes(slot.end) && timeToMinutes(job.end) > timeToMinutes(slot.start);
}

function activeJobsForSlot(jobs: CalendarDispatchJob[], slot: DisplaySlot) {
  return jobs.filter((job) => overlapsSlot(job, slot)).sort((a, b) => a.id.localeCompare(b.id));
}

function sameJobSet(left: CalendarDispatchJob[], right: CalendarDispatchJob[]) {
  return left.length === right.length && left.every((job, index) => job.id === right[index]?.id);
}

function activeSetSpan(jobs: CalendarDispatchJob[], slots: DisplaySlot[], startIndex: number) {
  const current = activeJobsForSlot(jobs, slots[startIndex]);
  let span = 1;
  for (let index = startIndex + 1; index < slots.length; index += 1) {
    if (!sameJobSet(current, activeJobsForSlot(jobs, slots[index]))) break;
    span += 1;
  }
  return span;
}

function occupancyForDay(day: OperationalDay, jobs: CalendarDispatchJob[], vans: DisplayVan[], capacityState: LiveOperationalCapacityState | null) {
  if (!day.isOpen) return { total: 0, occupied: 0, open: 0, percent: 0 };
  let total = 0;
  let occupied = 0;
  for (const van of vans) {
    for (const slot of displaySlotsForVan(day, van.id, capacityState)) {
      if (!slot.operational) continue;
      total += 1;
      if (jobs.some((job) => job.dateKey === day.dateKey && job.vanId === van.id && overlapsSlot(job, slot))) occupied += 1;
    }
  }
  if (!total) return { total: 0, occupied: 0, open: 0, percent: 0 };
  return { total, occupied, open: Math.max(0, total - occupied), percent: Math.round((occupied / total) * 100) };
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function anchorFor(jobs: CalendarDispatchJob[], vanId: string, segment: 'am' | 'pm') {
  const anchor = jobs
    .filter((job) => job.vanId === vanId)
    .filter((job) => segment === 'am' ? timeToMinutes(job.start) < 12 * 60 : timeToMinutes(job.start) >= 13 * 60)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0];
  return anchor?.sector || 'Open';
}

function readinessLabel(value: DispatchJob['readiness']) {
  return value === 'ready' ? 'Ready' : value === 'blocked' ? 'Blocked' : value === 'at_risk' ? 'At Risk' : 'Booked';
}

function slotClass(value: DispatchJob['readiness']) {
  return value === 'ready' ? styles.ready : value === 'blocked' ? styles.blocked : value === 'at_risk' ? styles.risk : styles.notChecked;
}

function jobCrossesLunch(job: CalendarDispatchJob) {
  return timeToMinutes(job.start) < 12 * 60 && timeToMinutes(job.end) > 13 * 60;
}

function bookingBadge(name?: string) {
  if (!name) return null;
  const initial = name.trim().charAt(0).toUpperCase() || 'D';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content', marginTop: 4, padding: '3px 6px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 5.8, fontWeight: 850 }}>
    <b style={{ width: 14, height: 14, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--brand)', color: '#fff', fontSize: 5.4 }}>{initial}</b>
    Booked by {name}
  </span>;
}

export function LiveSchedulingOverview() {
  const { principal } = useAuth();
  const [today] = useState(() => currentArubaDateKey());
  const [activeDate, setActiveDate] = useState(today);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [capacityState, setCapacityState] = useState<LiveOperationalCapacityState | null>(null);
  const [capacityError, setCapacityError] = useState('');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [bookingTarget, setBookingTarget] = useState<LiveBookingTarget | null>(null);
  const [moveArmedJobId, setMoveArmedJobId] = useState('');
  const [pendingDragMove, setPendingDragMove] = useState<PendingLiveMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveNotice, setMoveNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const clickTimerRef = useRef<number | null>(null);
  const reconcileTimerRef = useRef<number | null>(null);
  const refreshSequenceRef = useRef(0);
  const baseWeek = useMemo(() => buildOperationalWeek(activeDate), [activeDate]);
  const weekStartDate = baseWeek[0]?.dateKey ?? activeDate;
  const weekEndDate = baseWeek[6]?.dateKey ?? activeDate;
  const week = useMemo(() => baseWeek.map((day) => {
    const closureReason = liveCompanyClosureReason(capacityState, day.dateKey);
    return closureReason ? { ...day, isOpen: false, shiftLabel: closureReason } : day;
  }), [baseWeek, capacityState]);
  const canManage = principal.active && principal.capabilities.has('scheduling.manage');
  const actor = useMemo(() => ({ id: principal.userId, name: principal.displayName }), [principal.displayName, principal.userId]);
  const interactionActive = Boolean(bookingTarget || moveArmedJobId || pendingDragMove || moveBusy);

  const refresh = useCallback(async (forceCapacity = false) => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const [next, capacityResult] = await Promise.all([
        loadLiveSchedulingAppointmentsFast({ startDate: weekStartDate, endDate: weekEndDate }),
        loadLiveOperationalCapacityState({ startDate: weekStartDate, endDate: weekEndDate, force: forceCapacity })
          .then((value) => ({ value, error: '' }))
          .catch((capacityLoadError) => ({
            value: null,
            error: capacityLoadError instanceof Error ? capacityLoadError.message : 'Live operational capacity could not be loaded.',
          })),
      ]);
      if (sequence !== refreshSequenceRef.current) return;
      setAppointments(next);
      setCapacityState(capacityResult.value);
      setCapacityError(capacityResult.error);
      setError('');
      setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setLoading(false);

      void enrichLiveSchedulingAttribution(next)
        .then((enriched) => {
          if (sequence === refreshSequenceRef.current) setAppointments(enriched);
        })
        .catch(() => {
          // Booking attribution is supplemental; operational scheduling stays usable without it.
        });
    } catch (loadError) {
      if (sequence !== refreshSequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Live scheduling data could not be loaded.');
      setLoading(false);
    }
  }, [weekEndDate, weekStartDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (interactionActive) return;
    const interval = window.setInterval(() => void refresh(), 15_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [interactionActive, refresh]);

  useEffect(() => () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    if (reconcileTimerRef.current) window.clearTimeout(reconcileTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || moveBusy) return;
      if (bookingTarget) {
        setBookingTarget(null);
        return;
      }
      if (pendingDragMove) {
        setPendingDragMove(null);
        setMoveNotice('Move cancelled. Nothing was changed.');
        return;
      }
      if (moveArmedJobId) {
        setMoveArmedJobId('');
        setMoveNotice('Move mode cancelled.');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookingTarget, moveArmedJobId, moveBusy, pendingDragMove]);

  const jobs = useMemo(() => appointments.flatMap(appointmentAssignments), [appointments]);
  const vans = useMemo<DisplayVan[]>(() => previewVans.map((van) => ({ id: van.id, name: van.name, active: van.active })), []);
  const canonicalVanIds = useMemo(() => new Set(vans.map((van) => van.id)), [vans]);
  const unresolvedJobs = useMemo(() => jobs.filter((job) => !canonicalVanIds.has(job.vanId)), [canonicalVanIds, jobs]);
  const jobLinks = useMemo(() => {
    const result = new Map<string, JobLink>();
    for (const appointment of appointments) {
      for (const assignment of appointment.assignments) result.set(assignment.id, { appointmentId: appointment.id, appointment });
    }
    return result;
  }, [appointments]);
  const weekSummaries = useMemo(
    () => Object.fromEntries(week.map((day) => [day.dateKey, occupancyForDay(day, jobs, vans, capacityState)])),
    [capacityState, jobs, vans, week],
  );
  const activeDay = week.find((day) => day.dateKey === activeDate) ?? week[0];
  const activeJobs = jobs.filter((job) => job.dateKey === activeDate);
  const activeOccupancy = occupancyForDay(activeDay, jobs, vans, capacityState);
  const confirmed = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'confirmed').length;
  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const activeConflictSlots = vans.reduce((total, van) => {
    const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
    return total + displaySlotsForVan(activeDay, van.id, capacityState).filter((slot) => activeJobsForSlot(vanJobs, slot).length > 1).length;
  }, 0);
  const outsideCapacityJobs = activeJobs.filter((job) => {
    const slots = displaySlotsForVan(activeDay, job.vanId, capacityState);
    return slots.some((slot) => !slot.operational && overlapsSlot(job, slot));
  });
  const armedLink = moveArmedJobId ? jobLinks.get(moveArmedJobId) : undefined;
  const dragCandidates = useMemo(
    () => liveDragMoveCandidates(activeDay, armedLink?.appointment, activeJobs, capacityState),
    [activeDay, activeJobs, armedLink?.appointment, capacityState],
  );
  const dragCandidateMap = useMemo(
    () => new Map(dragCandidates.map((slot) => [liveMoveTargetKey(slot.vanId, slot.start), slot])),
    [dragCandidates],
  );
  const validDropTargets = useMemo(() => new Set(dragCandidateMap.keys()), [dragCandidateMap]);

  const openJob = (jobId: string) => {
    const link = jobLinks.get(jobId);
    if (link) setSelectedAppointmentId(link.appointmentId);
  };

  const scheduleOpenJob = (jobId: string) => {
    if (interactionActive) return;
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      openJob(jobId);
      clickTimerRef.current = null;
    }, 220);
  };

  const openCreateAppointment = (vanId: string, start: string, end: string) => {
    if (moveArmedJobId || pendingDragMove || moveBusy) return;
    if (!canManage) {
      setMoveNotice('Your account does not have permission to create appointments.');
      return;
    }
    if (!capacityState) {
      setMoveNotice(`Live capacity is not ready${capacityError ? `: ${capacityError}` : '.'} Refresh the agenda before creating an appointment.`);
      return;
    }
    const van = vans.find((item) => item.id === vanId);
    if (!van) return;
    setSelectedAppointmentId('');
    setMoveNotice('');
    setBookingTarget({ dateKey: activeDay.dateKey, vanId, vanName: van.name, start, end });
  };

  const handleCreatedBooking = (booking: LiveCreatedBooking) => {
    setBookingTarget(null);
    setSelectedAppointmentId('');
    setMoveNotice(`Appointment ${booking.appointmentId} confirmed for ${booking.customer.name || booking.customer.company || 'customer'} · ${booking.option.assignments[0]?.vanName || booking.option.assignments[0]?.vanId || bookingTarget?.vanName || 'van'} · ${formatTime(booking.option.time)}.`);
    void refresh();
  };

  const armMove = (jobId: string) => {
    if (moveBusy || pendingDragMove || bookingTarget) return;
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (!canManage) {
      setMoveNotice('Your account does not have permission to move appointments.');
      return;
    }
    if (!capacityState) {
      setMoveNotice(`Live van capacity is not ready${capacityError ? `: ${capacityError}` : '.'} Refresh the agenda before moving an appointment.`);
      return;
    }
    if (moveArmedJobId === jobId) {
      setMoveArmedJobId('');
      setMoveNotice('Move mode cancelled.');
      return;
    }
    const link = jobLinks.get(jobId);
    if (!link) return;
    if (link.appointment.assignments.length !== 1) {
      setMoveNotice('This booking uses multiple vans. Use the appointment panel → Reschedule so Booking Authority can coordinate all linked capacity safely.');
      setSelectedAppointmentId(link.appointmentId);
      return;
    }
    const candidates = liveDragMoveCandidates(activeDay, link.appointment, activeJobs, capacityState);
    if (!candidates.length) {
      setMoveNotice(`There are no valid same-day destinations for ${link.appointment.customer}. The existing appointment was not changed.`);
      return;
    }
    refreshSequenceRef.current += 1;
    setSelectedAppointmentId('');
    setMoveArmedJobId(jobId);
    setMoveNotice(`Move armed for ${link.appointment.customer}. Only destinations inside canonical operating capacity are highlighted.`);
  };

  const dropMove = (targetVanId: string, targetStart: string) => {
    if (!moveArmedJobId || moveBusy || pendingDragMove) return;
    const movingJobId = moveArmedJobId;
    const link = jobLinks.get(movingJobId);
    const currentJob = jobs.find((job) => job.id === movingJobId);
    const candidate = dragCandidateMap.get(liveMoveTargetKey(targetVanId, targetStart));
    if (!link || !currentJob || !candidate) {
      setMoveArmedJobId('');
      setMoveNotice('That destination is not valid for the complete appointment. Nothing was changed.');
      return;
    }
    const appointment = link.appointment;

    setMoveArmedJobId('');
    setMoveNotice('');
    setPendingDragMove({
      appointmentId: appointment.id,
      assignmentId: currentJob.id,
      jobId: currentJob.id,
      customer: appointment.customer,
      scope: 'primary',
      fromVanId: currentJob.vanId,
      fromStart: currentJob.start,
      fromEnd: currentJob.end,
      targetVanId,
      targetStart,
      targetEnd: candidate.end,
      customerNotificationRecommended: currentJob.start !== targetStart,
      candidate,
    });
  };

  const cancelPendingMove = () => {
    if (moveBusy) return;
    setPendingDragMove(null);
    setMoveNotice('Move cancelled. Nothing was changed.');
  };

  const confirmPendingMove = async () => {
    const pending = pendingDragMove;
    if (!pending || moveBusy) return;
    const appointment = appointments.find((item) => item.id === pending.appointmentId);
    const currentJob = appointment?.assignments.find((assignment) => assignment.id === pending.assignmentId) ?? appointment?.assignments[0];
    if (!appointment || !currentJob) {
      setPendingDragMove(null);
      setMoveNotice('The appointment changed before the move could be saved. Nothing was changed. Refresh the agenda and try again.');
      return;
    }

    setMoveBusy(true);
    setMoveNotice(`Moving ${appointment.customer} to ${pending.targetVanId.replace('VAN-', 'Van ')} at ${formatTime(pending.targetStart)}…`);
    refreshSequenceRef.current += 1;

    try {
      const result = await moveOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('drag-move'),
        requestedDate: appointment.dateKey,
        requestedTime: pending.targetStart,
        requiredVanId: pending.targetVanId,
        reason: 'Drag-and-drop operational move',
        note: `${currentJob.vanId} ${currentJob.start} → ${pending.targetVanId} ${pending.targetStart}`,
      });

      const committedSlot: CandidateSlot = {
        ...pending.candidate,
        vanId: pending.targetVanId,
        start: pending.targetStart,
        end: pending.targetEnd,
        segment: timeToMinutes(pending.targetStart) < 12 * 60 ? 'am' : 'pm',
        requiresSupportVan: false,
        supportVanId: undefined,
        supportStart: undefined,
        supportEnd: undefined,
        supportSegment: undefined,
        primaryUnits: appointment.totalQuantity,
      };
      const projected = projectCommittedLiveMove({
        appointment,
        slot: committedSlot,
        dateKey: appointment.dateKey,
        actor,
      });

      refreshSequenceRef.current += 1;
      setAppointments((items) => items.map((item) => item.id === appointment.id ? projected.record : item));
      setPendingDragMove(null);
      setError('');
      setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setMoveNotice(result.customerNotificationRecommended || pending.customerNotificationRecommended
        ? `Appointment moved to ${pending.targetVanId.replace('VAN-', 'Van ')} at ${formatTime(pending.targetStart)}. Customer follow-up is recommended because the promised time changed.`
        : `Appointment reassigned immediately to ${pending.targetVanId.replace('VAN-', 'Van ')} at ${formatTime(pending.targetStart)}.`);

      if (reconcileTimerRef.current) window.clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = window.setTimeout(() => {
        reconcileTimerRef.current = null;
        void refresh();
      }, 350);
    } catch (cause) {
      setPendingDragMove(null);
      setMoveNotice(`${cause instanceof Error ? cause.message : 'The appointment could not be moved.'} The original appointment was preserved.`);
    } finally {
      setMoveBusy(false);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Operations · Aruba · Live</span>
          <h1>Scheduling &amp; Dispatch</h1>
          <p>Live Booking Authority schedule. Confirmed customer appointments and canonical operating capacity are read from Firestore; local demo scheduling is not mixed into this view.</p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.secondary} onClick={() => void refresh(true)} disabled={loading || interactionActive}>↻ Refresh live</button>
        </div>
      </header>

      <div className={styles.notice}>
        <span>{error ? `Live sync error: ${error}` : loading ? 'Loading canonical Booking Authority schedule…' : `LIVE · Booking Authority${lastSyncedAt ? ` · synced ${lastSyncedAt}` : ''}`}</span>
      </div>
      {capacityError ? <div className={styles.notice}><span>Canonical operating-capacity policy could not be loaded: {capacityError}. Appointment data remains visible, but scheduling changes are disabled until capacity refresh succeeds.</span></div> : null}
      {moveNotice ? <div className={styles.notice}><span>{moveNotice}</span>{moveArmedJobId && !moveBusy ? <button type="button" onClick={() => { setMoveArmedJobId(''); setMoveNotice('Move mode cancelled.'); }}>×</button> : null}</div> : null}
      {unresolvedJobs.length ? <div className={styles.notice}><span>Data integrity attention: {unresolvedJobs.length} assignment{unresolvedJobs.length === 1 ? '' : 's'} reference a van that cannot be resolved to Van 1–4. They are not converted into fake extra lanes.</span></div> : null}
      {activeConflictSlots ? <div className={styles.notice}><span>Capacity integrity attention: {activeConflictSlots} occupied slot{activeConflictSlots === 1 ? '' : 's'} contain overlapping appointments after duplicate fleet records were collapsed to the physical Van 1–4. Both appointments remain visible below so they can be reviewed and rescheduled safely.</span></div> : null}
      {outsideCapacityJobs.length ? <div className={styles.notice}><span>Operating-calendar attention: {outsideCapacityJobs.length} appointment{outsideCapacityJobs.length === 1 ? '' : 's'} currently extend into capacity that is closed by the canonical van/company calendar. They remain visible for correction but are not counted as open capacity.</span></div> : null}

      <div className={styles.toolbar}>
        <div className={styles.dayNav}>
          <button type="button" onClick={() => setActiveDate(addDays(activeDate, -7))} disabled={interactionActive}>‹</button>
          <div><strong>{week[0]?.shortDate} – {week[6]?.shortDate}</strong><span>Navigate the live operational week</span></div>
          <button type="button" onClick={() => setActiveDate(addDays(activeDate, 7))} disabled={interactionActive}>›</button>
        </div>
        <div className={styles.dayNav}>
          <button type="button" onClick={() => setActiveDate(today)} disabled={interactionActive} style={{ width: 'auto', padding: '0 10px' }}>Today</button>
        </div>
      </div>

      <div className={styles.weekStrip}>
        {week.map((day) => {
          const summary = weekSummaries[day.dateKey];
          return (
            <button key={day.dateKey} type="button" className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.isToday ? styles.today : ''}`} disabled={!day.isOpen || interactionActive} onClick={() => setActiveDate(day.dateKey)}>
              <div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.isToday ? <b>Today</b> : null}</div>
              <small>{day.shiftLabel}</small>
              <i><em style={{ width: `${summary?.percent ?? 0}%` }} /></i>
              <p>{day.isOpen ? `${summary?.occupied ?? 0}/${summary?.total ?? 0} capacity spots filled · ${summary?.open ?? 0} open` : 'Operationally closed'}</p>
            </button>
          );
        })}
      </div>

      <div className={styles.metrics}>
        <article><span>Confirmed</span><strong>{confirmed}</strong><small>{activeDay.shortDate}</small></article>
        <article><span>Data source</span><strong className={styles.metricGood}>LIVE</strong><small>Booking Authority + canonical capacity</small></article>
        <article><span>Local holds</span><strong>0</strong><small>Demo/local holds are isolated</small></article>
        <article><span>Open spots</span><strong className={styles.metricGood}>{activeOccupancy.open}</strong><small>{activeOccupancy.occupied}/{activeOccupancy.total} operating spots occupied</small><i style={{ width: `${activeOccupancy.percent}%` }} /></article>
      </div>

      <div className={styles.board}>
        <header className={styles.boardHeader}>
          <div>
            <strong>Live Van Schedule</strong>
            <span>{activeDay.weekday} {activeDay.shortDate} · click open spot = new appointment · single click booked = details · double click booked = move</span>
            {moveNotice ? <span style={{ marginTop: 3, fontWeight: 700 }}>{moveNotice}</span> : null}
          </div>
          <b>{moveBusy ? 'SAVING MOVE…' : moveArmedJobId ? `${validDropTargets.size} VALID TARGETS` : `${activeOccupancy.open} OPEN SPOTS`}</b>
        </header>
        <div className={styles.boardScroll}>
          <div className={styles.vanGrid}>
            {vans.map((van) => {
              const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
              const vanSlots = displaySlotsForVan(activeDay, van.id, capacityState);
              const crew = liveVanCrew(capacityState, van.id, activeDay.dateKey);
              const halfDay = liveVanHalfDaySchedule(capacityState, van.id, activeDay.dateKey);
              const operational = liveVanOperationallyAvailable(capacityState, van.id, activeDay.dateKey);
              const laneStatus = !operational
                ? 'UNAVAILABLE'
                : halfDay
                  ? `HALF-DAY · TO ${formatTime(halfDay.workdayEnd || '13:00')}`
                  : van.active ? 'ACTIVE' : 'INACTIVE';
              return (
                <section key={van.id} className={styles.vanLane}>
                  <header>
                    <div className={styles.vanIdentity}>
                      <span>{van.id.replace('VAN-', 'V')}</span>
                      <div>
                        <strong>{van.name}</strong>
                        <small title={`Technician: ${crew.driverName || 'Unassigned'} · Helper: ${crew.helperName || 'Unassigned'}`}>{crew.label}</small>
                      </div>
                    </div>
                    <b style={{ color: !operational ? 'var(--danger)' : halfDay ? 'var(--warning)' : undefined }}>{laneStatus}</b>
                  </header>
                  <div className={styles.anchorBar}>
                    <div><span>AM anchor</span><strong>{anchorFor(activeJobs, van.id, 'am')}</strong></div>
                    <div><span>PM anchor</span><strong>{halfDay ? `Off after ${formatTime(halfDay.workdayEnd || '13:00')}` : anchorFor(activeJobs, van.id, 'pm')}</strong></div>
                  </div>
                  <VanScheduleSlots
                    slots={vanSlots}
                    jobs={vanJobs}
                    vanId={van.id}
                    jobLinks={jobLinks}
                    moveArmedJobId={moveArmedJobId}
                    moveBusy={moveBusy}
                    canCreate={canManage && Boolean(capacityState)}
                    validDropTargets={validDropTargets}
                    onCreateAppointment={openCreateAppointment}
                    onOpenAppointment={scheduleOpenJob}
                    onArmMove={armMove}
                    onDropMove={dropMove}
                  />
                  {!activeDay.isOpen ? <div className={styles.closedDay}>{activeDay.shiftLabel || 'Operationally closed.'}</div> : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {selectedAppointment ? <LiveAppointmentDetailsDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointmentId('')} onChanged={refresh} /> : null}
      {bookingTarget ? <LiveAppointmentCreateDrawer target={bookingTarget} onClose={() => setBookingTarget(null)} onCreated={handleCreatedBooking} /> : null}
      {pendingDragMove ? <DragMoveConfirmation move={pendingDragMove} busy={moveBusy} onCancel={cancelPendingMove} onConfirm={() => void confirmPendingMove()} /> : null}
    </section>
  );
}

function VanScheduleSlots({
  slots,
  jobs,
  vanId,
  jobLinks,
  moveArmedJobId,
  moveBusy,
  canCreate,
  validDropTargets,
  onCreateAppointment,
  onOpenAppointment,
  onArmMove,
  onDropMove,
}: {
  slots: DisplaySlot[];
  jobs: CalendarDispatchJob[];
  vanId: string;
  jobLinks: Map<string, JobLink>;
  moveArmedJobId: string;
  moveBusy: boolean;
  canCreate: boolean;
  validDropTargets: Set<string>;
  onCreateAppointment: (vanId: string, start: string, end: string) => void;
  onOpenAppointment: (jobId: string) => void;
  onArmMove: (jobId: string) => void;
  onDropMove: (vanId: string, start: string) => void;
}) {
  const rows: React.ReactNode[] = [];
  let index = 0;

  while (index < slots.length) {
    const slot = slots[index];
    const previous = slots[index - 1];
    const firstAfternoon = index > 0 && previous?.segment === 'am' && slot.segment === 'pm';
    if (firstAfternoon) rows.push(<div className={styles.lunchRow} key={`lunch-${slot.start}`}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div>);

    const active = activeJobsForSlot(jobs, slot);
    if (!active.length && !slot.operational) {
      rows.push(<div
        className={styles.openSlot}
        key={`off-${slot.start}`}
        style={{ borderStyle: 'solid', borderColor: 'var(--border)', background: 'var(--surface-2)', cursor: 'default', opacity: 0.76 }}
      >
        <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
        <div><strong style={{ color: 'var(--muted)' }}>Not available</strong><span>{slot.offReason || 'Outside operating capacity'}</span></div>
        <b style={{ color: 'var(--muted)' }}>OFF</b>
      </div>);
      index += 1;
      continue;
    }

    if (!active.length) {
      const dropEnabled = Boolean(moveArmedJobId)
        && !moveBusy
        && slot.operational
        && validDropTargets.has(liveMoveTargetKey(vanId, slot.start));
      const createEnabled = !moveArmedJobId && !moveBusy && canCreate && slot.operational;
      rows.push(<div
        className={styles.openSlot}
        key={`open-${slot.start}`}
        role={createEnabled ? 'button' : undefined}
        tabIndex={createEnabled ? 0 : undefined}
        onClick={() => { if (createEnabled) onCreateAppointment(vanId, slot.start, slot.end); }}
        onKeyDown={(event) => {
          if (!createEnabled || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onCreateAppointment(vanId, slot.start, slot.end);
        }}
        onDragOver={(event) => { if (dropEnabled) event.preventDefault(); }}
        onDrop={(event) => {
          if (!dropEnabled) return;
          event.preventDefault();
          onDropMove(vanId, slot.start);
        }}
        style={dropEnabled
          ? { borderStyle: 'solid', borderColor: 'var(--brand)', background: 'var(--brand-soft)', cursor: 'copy' }
          : createEnabled ? { cursor: 'pointer' } : undefined}
      >
        <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
        <div><strong>{dropEnabled ? 'Drop to move' : 'Available'}</strong><span>{dropEnabled ? 'Valid for the complete appointment' : createEnabled ? 'Click to schedule' : 'Open work spot'}</span></div>
        <b>{dropEnabled ? 'MOVE' : createEnabled ? 'BOOK' : 'LIVE'}</b>
      </div>);
      index += 1;
      continue;
    }

    const span = activeSetSpan(jobs, slots, index);
    const spanOutsideCapacity = slots.slice(index, index + span).some((spanSlot) => !spanSlot.operational);
    if (active.length > 1) {
      rows.push(<ConflictBlock key={`conflict-${slot.start}-${active.map((job) => job.id).join('-')}`} jobs={active} span={span} jobLinks={jobLinks} onOpenAppointment={onOpenAppointment} />);
      index += span;
      continue;
    }

    const job = active[0];
    rows.push(<AppointmentBlock
      key={`${job.id}-${slot.start}`}
      job={job}
      appointment={jobLinks.get(job.id)?.appointment}
      span={span}
      crossesLunch={jobCrossesLunch(job)}
      continuation={job.start !== slot.start}
      armed={moveArmedJobId === job.id}
      outsideCapacity={spanOutsideCapacity}
      onOpen={() => onOpenAppointment(job.id)}
      onArm={() => onArmMove(job.id)}
    />);
    index += span;
  }

  return <div className={styles.slotList}>{rows}</div>;
}

function AppointmentBlock({ job, appointment, span, crossesLunch, continuation = false, armed, outsideCapacity, onOpen, onArm }: {
  job: CalendarDispatchJob;
  appointment?: BrowserAppointmentRecord;
  span: number;
  crossesLunch: boolean;
  continuation?: boolean;
  armed: boolean;
  outsideCapacity: boolean;
  onOpen: () => void;
  onArm: () => void;
}) {
  const minHeight = span * 64 + Math.max(0, span - 1) * 6 + (crossesLunch ? 18 : 0);
  const openFromKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };
  return <div className={styles.occupiedSlot} style={{ minHeight, outline: armed ? '2px solid var(--brand)' : outsideCapacity ? '1px solid var(--warning)' : undefined, background: armed ? 'var(--brand-soft)' : undefined }}>
    <div className={styles.slotTime}><strong>{formatTime(job.start)}</strong><span>{formatTime(job.end)}</span>{span > 1 ? <span>{span} spots</span> : null}</div>
    <div className={styles.slotJobs}>
      <article
        className={styles.jobCard}
        role="button"
        tabIndex={0}
        draggable={armed}
        onDragStart={(event) => {
          if (!armed) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', job.id);
        }}
        onClick={(event) => { if (event.detail === 1) onOpen(); }}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onArm(); }}
        onKeyDown={openFromKeyboard}
        style={{ minHeight: '100%', alignItems: 'center', cursor: armed ? 'grab' : 'pointer' }}
      >
        <div>
          <div className={styles.jobTitle}><strong>{job.customer}</strong><b className={armed ? styles.ready : slotClass(job.readiness)}>{armed ? 'MOVE ARMED' : readinessLabel(job.readiness)}</b></div>
          {continuation ? <span>Reserved continuously until {formatTime(job.end)}</span> : <span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span>}
          <small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small>
          {!continuation && span > 1 ? <small>Reserved continuously · {formatTime(job.start)}–{formatTime(job.end)}</small> : null}
          {crossesLunch ? <small>Lunch/reset remains protected</small> : null}
          {outsideCapacity ? <small style={{ color: 'var(--warning)', fontWeight: 800 }}>Outside canonical operating capacity · review schedule</small> : null}
          {bookingBadge(appointment?.bookedByName)}
          <small>{armed ? 'Drag this block to a highlighted valid destination' : 'Single click details · double click to move'}</small>
        </div>
      </article>
    </div>
  </div>;
}

function ConflictBlock({ jobs, span, jobLinks, onOpenAppointment }: {
  jobs: CalendarDispatchJob[];
  span: number;
  jobLinks: Map<string, JobLink>;
  onOpenAppointment: (jobId: string) => void;
}) {
  const start = jobs.reduce((earliest, job) => timeToMinutes(job.start) < timeToMinutes(earliest) ? job.start : earliest, jobs[0].start);
  const end = jobs.reduce((latest, job) => timeToMinutes(job.end) > timeToMinutes(latest) ? job.end : latest, jobs[0].end);
  const minHeight = Math.max(span * 64 + Math.max(0, span - 1) * 6, jobs.length * 86 + 34);
  return <div className={styles.occupiedSlot} style={{ minHeight, outline: '1px solid var(--danger)' }}>
    <div className={styles.slotTime}><strong>{formatTime(start)}</strong><span>{formatTime(end)}</span><span>Conflict</span></div>
    <div className={styles.slotJobs}>
      <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--danger)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Capacity conflict · review both appointments</div>
      {jobs.map((job) => <article key={job.id} className={styles.jobCard} role="button" tabIndex={0} onClick={() => onOpenAppointment(job.id)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenAppointment(job.id);
        }
      }} style={{ cursor: 'pointer' }}>
        <div>
          <div className={styles.jobTitle}><strong>{job.customer}</strong><b className={styles.risk}>CONFLICT</b></div>
          <span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'} · {formatTime(job.start)}–{formatTime(job.end)}</span>
          <small>{job.site} · {job.sector}</small>
          {bookingBadge(jobLinks.get(job.id)?.appointment.bookedByName)}
          <small>Click to review / reschedule</small>
        </div>
      </article>)}
    </div>
  </div>;
}
