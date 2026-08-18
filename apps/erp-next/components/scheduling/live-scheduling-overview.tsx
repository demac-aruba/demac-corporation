'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import { loadLiveSchedulingAppointments } from '../../lib/live-scheduling';
import type { DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { defaultWorkPresets, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey } from '../../lib/scheduling-capacity';
import { LiveAppointmentDetailsDrawer } from './live-appointment-details-drawer';
import styles from './scheduling-overview-v2.module.css';

type DisplaySlot = { start: string; end: string; segment: 'am' | 'pm' };
type DisplayVan = { id: string; name: string; team: string; active: boolean };

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

function displaySlotsForDay(day: OperationalDay): DisplaySlot[] {
  if (!day.isOpen) return [];
  const starts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : getRuntimeSchedulingSettings().serviceStartTimes;
  return starts.map((start) => {
    const startMinutes = timeToMinutes(start);
    return { start, end: minutesToTime(startMinutes + 60), segment: startMinutes < 12 * 60 ? 'am' : 'pm' };
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

function occupancyForDay(day: OperationalDay, jobs: CalendarDispatchJob[], vans: DisplayVan[]) {
  const slots = displaySlotsForDay(day);
  const total = slots.length * vans.length;
  if (!total) return { total: 0, occupied: 0, open: 0, percent: 0 };
  let occupied = 0;
  for (const van of vans) {
    for (const slot of slots) {
      if (jobs.some((job) => job.dateKey === day.dateKey && job.vanId === van.id && overlapsSlot(job, slot))) occupied += 1;
    }
  }
  return { total, occupied, open: total - occupied, percent: Math.round((occupied / total) * 100) };
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

export function LiveSchedulingOverview() {
  const [today] = useState(() => currentArubaDateKey());
  const [activeDate, setActiveDate] = useState(today);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const week = useMemo(() => buildOperationalWeek(activeDate), [activeDate]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadLiveSchedulingAppointments();
      setAppointments(next);
      setError('');
      setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Live scheduling data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const jobs = useMemo(() => appointments.flatMap(appointmentAssignments), [appointments]);
  const vans = useMemo<DisplayVan[]>(() => previewVans.map((van) => ({ id: van.id, name: van.name, team: van.team, active: van.active })), []);
  const canonicalVanIds = useMemo(() => new Set(vans.map((van) => van.id)), [vans]);
  const unresolvedJobs = useMemo(() => jobs.filter((job) => !canonicalVanIds.has(job.vanId)), [canonicalVanIds, jobs]);
  const appointmentByJobId = useMemo(() => {
    const result = new Map<string, string>();
    for (const appointment of appointments) {
      for (const assignment of appointment.assignments) result.set(assignment.id, appointment.id);
    }
    return result;
  }, [appointments]);
  const weekSummaries = useMemo(() => Object.fromEntries(week.map((day) => [day.dateKey, occupancyForDay(day, jobs, vans)])), [jobs, vans, week]);
  const activeDay = week.find((day) => day.dateKey === activeDate) ?? week[0];
  const activeJobs = jobs.filter((job) => job.dateKey === activeDate);
  const activeSlots = displaySlotsForDay(activeDay);
  const activeOccupancy = occupancyForDay(activeDay, jobs, vans);
  const confirmed = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'confirmed').length;
  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const activeConflictSlots = vans.reduce((total, van) => {
    const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
    return total + activeSlots.filter((slot) => activeJobsForSlot(vanJobs, slot).length > 1).length;
  }, 0);

  const openJob = (jobId: string) => {
    const appointmentId = appointmentByJobId.get(jobId);
    if (appointmentId) setSelectedAppointmentId(appointmentId);
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Operations · Aruba · Live</span>
          <h1>Scheduling &amp; Dispatch</h1>
          <p>Live Booking Authority schedule. Confirmed customer appointments are read from canonical Firestore work orders; local demo scheduling is not mixed into this view.</p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={loading}>↻ Refresh live</button>
        </div>
      </header>

      <div className={styles.notice}>
        <span>{error ? `Live sync error: ${error}` : loading ? 'Loading canonical Booking Authority schedule…' : `LIVE · Booking Authority${lastSyncedAt ? ` · synced ${lastSyncedAt}` : ''}`}</span>
      </div>
      {unresolvedJobs.length ? <div className={styles.notice}><span>Data integrity attention: {unresolvedJobs.length} assignment{unresolvedJobs.length === 1 ? '' : 's'} reference a van that cannot be resolved to Van 1–4. They are not converted into fake extra lanes.</span></div> : null}
      {activeConflictSlots ? <div className={styles.notice}><span>Capacity integrity attention: {activeConflictSlots} occupied slot{activeConflictSlots === 1 ? '' : 's'} contain overlapping appointments after duplicate fleet records were collapsed to the physical Van 1–4. Both appointments remain visible below so they can be reviewed and rescheduled safely.</span></div> : null}

      <div className={styles.toolbar}>
        <div className={styles.dayNav}>
          <button type="button" onClick={() => setActiveDate(addDays(activeDate, -7))}>‹</button>
          <div><strong>{week[0]?.shortDate} – {week[6]?.shortDate}</strong><span>Navigate the live operational week</span></div>
          <button type="button" onClick={() => setActiveDate(addDays(activeDate, 7))}>›</button>
        </div>
        <div className={styles.dayNav}>
          <button type="button" onClick={() => setActiveDate(today)} style={{ width: 'auto', padding: '0 10px' }}>Today</button>
        </div>
      </div>

      <div className={styles.weekStrip}>
        {week.map((day) => {
          const summary = weekSummaries[day.dateKey];
          return (
            <button key={day.dateKey} type="button" className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.isToday ? styles.today : ''}`} disabled={!day.isOpen} onClick={() => setActiveDate(day.dateKey)}>
              <div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.isToday ? <b>Today</b> : null}</div>
              <small>{day.shiftLabel}</small>
              <i><em style={{ width: `${summary?.percent ?? 0}%` }} /></i>
              <p>{day.isOpen ? `${summary?.occupied ?? 0}/${summary?.total ?? 0} spots filled · ${summary?.open ?? 0} open` : 'Operationally closed'}</p>
            </button>
          );
        })}
      </div>

      <div className={styles.metrics}>
        <article><span>Confirmed</span><strong>{confirmed}</strong><small>{activeDay.shortDate}</small></article>
        <article><span>Data source</span><strong className={styles.metricGood}>LIVE</strong><small>Booking Authority work orders</small></article>
        <article><span>Local holds</span><strong>0</strong><small>Demo/local holds are isolated</small></article>
        <article><span>Open spots</span><strong className={styles.metricGood}>{activeOccupancy.open}</strong><small>{activeOccupancy.occupied}/{activeOccupancy.total} occupied today</small><i style={{ width: `${activeOccupancy.percent}%` }} /></article>
      </div>

      <div className={styles.board}>
        <header className={styles.boardHeader}>
          <div><strong>Live Van Schedule</strong><span>{activeDay.weekday} {activeDay.shortDate} · one continuous block per assignment</span></div>
          <b>{activeOccupancy.open} OPEN SPOTS</b>
        </header>
        <div className={styles.boardScroll}>
          <div className={styles.vanGrid}>
            {vans.map((van) => {
              const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
              return (
                <section key={van.id} className={styles.vanLane}>
                  <header>
                    <div className={styles.vanIdentity}><span>{van.id.replace('VAN-', 'V')}</span><div><strong>{van.name}</strong><small>{van.team}</small></div></div>
                    <b>{van.active ? 'ACTIVE' : 'INACTIVE'}</b>
                  </header>
                  <div className={styles.anchorBar}>
                    <div><span>AM anchor</span><strong>{anchorFor(activeJobs, van.id, 'am')}</strong></div>
                    <div><span>PM anchor</span><strong>{anchorFor(activeJobs, van.id, 'pm')}</strong></div>
                  </div>
                  <VanScheduleSlots slots={activeSlots} jobs={vanJobs} onOpenAppointment={openJob} />
                  {!activeDay.isOpen ? <div className={styles.closedDay}>Operationally closed.</div> : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {selectedAppointment ? <LiveAppointmentDetailsDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointmentId('')} onChanged={refresh} /> : null}
    </section>
  );
}

function VanScheduleSlots({ slots, jobs, onOpenAppointment }: { slots: DisplaySlot[]; jobs: CalendarDispatchJob[]; onOpenAppointment: (jobId: string) => void }) {
  const rows: React.ReactNode[] = [];
  let index = 0;

  while (index < slots.length) {
    const slot = slots[index];
    const previous = slots[index - 1];
    const firstAfternoon = index > 0 && previous?.segment === 'am' && slot.segment === 'pm';
    if (firstAfternoon) rows.push(<div className={styles.lunchRow} key={`lunch-${slot.start}`}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div>);

    const active = activeJobsForSlot(jobs, slot);
    if (!active.length) {
      rows.push(<div className={styles.openSlot} key={`open-${slot.start}`}>
        <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
        <div><strong>Available</strong><span>Open work spot</span></div>
        <b>LIVE</b>
      </div>);
      index += 1;
      continue;
    }

    const span = activeSetSpan(jobs, slots, index);
    if (active.length > 1) {
      rows.push(<ConflictBlock key={`conflict-${slot.start}-${active.map((job) => job.id).join('-')}`} jobs={active} span={span} onOpenAppointment={onOpenAppointment} />);
      index += span;
      continue;
    }

    const job = active[0];
    rows.push(<AppointmentBlock
      key={`${job.id}-${slot.start}`}
      job={job}
      span={span}
      crossesLunch={jobCrossesLunch(job)}
      continuation={job.start !== slot.start}
      onOpen={() => onOpenAppointment(job.id)}
    />);
    index += span;
  }

  return <div className={styles.slotList}>{rows}</div>;
}

function AppointmentBlock({ job, span, crossesLunch, continuation = false, onOpen }: { job: CalendarDispatchJob; span: number; crossesLunch: boolean; continuation?: boolean; onOpen: () => void }) {
  const minHeight = span * 64 + Math.max(0, span - 1) * 6 + (crossesLunch ? 18 : 0);
  const openFromKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };
  return <div className={styles.occupiedSlot} style={{ minHeight }}>
    <div className={styles.slotTime}><strong>{formatTime(job.start)}</strong><span>{formatTime(job.end)}</span>{span > 1 ? <span>{span} spots</span> : null}</div>
    <div className={styles.slotJobs}>
      <article className={styles.jobCard} role="button" tabIndex={0} onClick={onOpen} onKeyDown={openFromKeyboard} style={{ minHeight: '100%', alignItems: 'center', cursor: 'pointer' }}>
        <div>
          <div className={styles.jobTitle}><strong>{job.customer}</strong><b className={slotClass(job.readiness)}>{readinessLabel(job.readiness)}</b></div>
          {continuation ? <span>Reserved continuously until {formatTime(job.end)}</span> : <span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span>}
          <small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small>
          {!continuation && span > 1 ? <small>Reserved continuously · {formatTime(job.start)}–{formatTime(job.end)}</small> : null}
          {crossesLunch ? <small>Lunch/reset remains protected</small> : null}
          <small>Click for appointment details</small>
        </div>
      </article>
    </div>
  </div>;
}

function ConflictBlock({ jobs, span, onOpenAppointment }: { jobs: CalendarDispatchJob[]; span: number; onOpenAppointment: (jobId: string) => void }) {
  const start = jobs.reduce((earliest, job) => timeToMinutes(job.start) < timeToMinutes(earliest) ? job.start : earliest, jobs[0].start);
  const end = jobs.reduce((latest, job) => timeToMinutes(job.end) > timeToMinutes(latest) ? job.end : latest, jobs[0].end);
  const minHeight = Math.max(span * 64 + Math.max(0, span - 1) * 6, jobs.length * 78 + 34);
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
          <small>Click to review / reschedule</small>
        </div>
      </article>)}
    </div>
  </div>;
}
