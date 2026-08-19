'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  weekdayLabel,
  type CanonicalOperationsState,
} from '../lib/canonical-operations';

function arubaDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Aruba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function CanonicalOperatingCalendar() {
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = arubaDateKey();

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await loadCanonicalOperationsState());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const halfDays = useMemo(() => {
    if (!state) return [];
    const byVan = new Map<string, typeof state.vanHalfDaySchedules[number]>();
    for (const schedule of state.vanHalfDaySchedules) {
      const id = canonicalVanId(schedule.vanId, state.vans);
      if (!byVan.has(id)) byVan.set(id, schedule);
    }
    return ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'].map((vanId) => ({ vanId, schedule: byVan.get(vanId) }));
  }, [state]);

  const duplicateVans = useMemo(() => {
    if (!state) return [];
    const counts = new Map<string, number>();
    for (const van of state.vans) {
      const id = canonicalVanId(van.id, state.vans);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  }, [state]);

  const upcomingClosures = (state?.calendarClosures ?? []).filter((closure) => String(closure.date ?? '') >= today).slice(0, 8);
  const closedWeekdays = (state?.businessCalendar.closedWeekdays ?? [0]).map(weekdayLabel).join(', ');

  return (
    <>
      <article className="panel sg-setting-card">
        <header><div><span>Canonical Operations</span><h2>Weekly Van Half-Days</h2></div><b>Live Firestore</b></header>
        {error ? <div className="sg-runtime-note"><strong>Unable to read canonical calendar</strong><p>{error}</p></div> : null}
        <div className="sg-rule-table">
          {halfDays.map(({ vanId, schedule }) => <div key={vanId}><strong>{vanId}</strong><span>{schedule ? weekdayLabel(schedule.weekday) : 'Not configured'}</span><small>{schedule ? `${schedule.workdayStart || '08:00'}–${schedule.workdayEnd || '13:00'}${schedule.extraMorningSlot ? ` · extra slot ${schedule.extraMorningSlot}` : ''}` : 'Booking Authority has no active vanHalfDaySchedules record for this van.'}</small></div>)}
        </div>
        <div className="sg-runtime-note"><strong>Booking behavior</strong><p>These records remain part of automatic Booking Authority capacity. Manual office drag may override the half-day when an operator intentionally moves an existing appointment.</p></div>
        <div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh canonical schedule'}</button></div>
      </article>

      <article className="panel sg-setting-card">
        <header><div><span>Canonical Operations</span><h2>Company Closures</h2></div><b>Live Firestore</b></header>
        <div className="sg-rule-table">
          <div><strong>Weekly closed days</strong><span>{closedWeekdays || 'None configured'}</span><small>businessSettings / business-calendar</small></div>
          {upcomingClosures.length ? upcomingClosures.map((closure) => <div key={closure.id}><strong>{closure.date || 'Date missing'}</strong><span>{closure.reason || 'Special closure'}</span><small>{closure.notes || 'calendarClosures'}</small></div>) : <div><strong>Special closures</strong><span>None upcoming</span><small>No active calendarClosures records from {today} forward.</small></div>}
        </div>
        {duplicateVans.length ? <div className="sg-runtime-note"><strong>Legacy fleet cleanup needed</strong><p>{duplicateVans.map(([vanId, count]) => `${vanId}: ${count} active records`).join(' · ')}. The UI collapses them to the physical van, but these duplicate documents should be reviewed before deletion.</p></div> : <div className="sg-runtime-note"><strong>Fleet identity check</strong><p>No duplicate active physical van IDs were detected in the current Firestore read.</p></div>}
      </article>
    </>
  );
}
