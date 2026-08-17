'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import { loadLiveSchedulingAppointments } from '../../lib/live-scheduling';
import type { DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { defaultWorkPresets, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey } from '../../lib/scheduling-capacity';
import styles from './scheduling-overview-v2.module.css';

type DisplaySlot = { start: string; end: string; segment: 'am' | 'pm' };
type DisplayVan = { id: string; name: string; team: string; active: boolean };

function appointmentAssignments(record: BrowserAppointmentRecord): CalendarDispatchJob[] {
  if (record.status === 'cancelled') return [];
  return record.assignments.map((assignment) => ({ ...assignment, dateKey: record.dateKey, status: 'confirmed' }));
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

export function LiveSchedulingOverview() {
  const [today] = useState(() => currentArubaDateKey());
  const [activeDate, setActiveDate] = useState(today);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
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
  const vans = useMemo<DisplayVan[]>(() => {
    const known = previewVans.map((van) => ({ id: van.id, name: van.name, team: van.team, active: van.active }));
    const knownIds = new Set(known.map((van) => van.id));
    const discovered = [...new Set(jobs.map((job) => job.vanId).filter(Boolean))]
      .filter((vanId) => !knownIds.has(vanId))
      .map((vanId) => ({ id: vanId, name: vanId.replace('VAN-', 'Van '), team: 'Assigned crew', active: true }));
    return [...known, ...discovered];
  }, [jobs]);
  const weekSummaries = useMemo(() => Object.fromEntries(week.map((day) => [day.dateKey, occupancyForDay(day, jobs, vans)])), [jobs, vans, week]);
  const activeDay = week.find((day) => day.dateKey === activeDate) ?? week[0];
  const activeJobs = jobs.filter((job) => job.dateKey === activeDate);
  const activeSlots = displaySlotsForDay(activeDay);
  const activeOccupancy = occupancyForDay(activeDay, jobs, vans);
  const confirmed = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'confirmed').length;

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
          <div><strong>Live Van Schedule</strong><span>{activeDay.weekday} {activeDay.shortDate} · canonical confirmed assignments</span></div>
          <b>{activeOccupancy.open} OPEN SPOTS</b>
        </header>
        <div className={styles.boardScroll}>
          <div className={styles.vanGrid} style={{ gridTemplateColumns: `repeat(${Math.max(4, vans.length)}, minmax(230px, 1fr))` }}>
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
                  <div className={styles.slotList}>
                    {activeSlots.length ? activeSlots.map((slot, index) => {
                      const overlapping = vanJobs.filter((job) => overlapsSlot(job, slot));
                      const starting = overlapping.filter((job) => job.start === slot.start);
                      const continuing = overlapping.filter((job) => job.start !== slot.start);
                      return (
                        <div key={`${van.id}-${slot.start}`}>
                          {overlapping.length === 0 ? (
                            <div className={styles.openSlot}>
                              <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
                              <div><strong>Available</strong><span>Open work spot</span></div>
                              <b>LIVE</b>
                            </div>
                          ) : (
                            <div className={styles.occupiedSlot}>
                              <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
                              <div className={styles.slotJobs}>
                                {starting.map((job) => (
                                  <article key={job.id} className={styles.jobCard}>
                                    <div>
                                      <div className={styles.jobTitle}><strong>{job.customer}</strong><b className={slotClass(job.readiness)}>{readinessLabel(job.readiness)}</b></div>
                                      <span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'} · until {formatTime(job.end)}</span>
                                      <small>{job.site} · {job.sector}</small>
                                    </div>
                                  </article>
                                ))}
                                {starting.length === 0 && continuing.length ? <article className={styles.jobCard}><div><div className={styles.jobTitle}><strong>Appointment continues</strong><b className={styles.notChecked}>BOOKED</b></div><span>Reserved until {formatTime(continuing.reduce((latest, job) => timeToMinutes(job.end) > timeToMinutes(latest) ? job.end : latest, continuing[0].end))}</span><small>{continuing.map((job) => job.customer).join(', ')}</small></div></article> : null}
                              </div>
                            </div>
                          )}
                          {activeDay.weekday !== 'Sat' && index === 2 ? <div className={styles.lunchRow}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div> : null}
                        </div>
                      );
                    }) : <div className={styles.closedDay}>Operationally closed.</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
