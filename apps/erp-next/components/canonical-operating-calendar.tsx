'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalVanHalfDaySchedule,
} from '../lib/canonical-operations';
import {
  reopenCanonicalCalendarClosure,
  saveCanonicalBusinessCalendar,
  saveCanonicalCalendarClosure,
  saveCanonicalVanHalfDaySchedule,
} from '../lib/canonical-operations-mutations';

const weekdayOptions = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

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

function HalfDayEditor({ vanId, vanName, schedule, onSaved }: {
  vanId: string;
  vanName: string;
  schedule?: CanonicalVanHalfDaySchedule;
  onSaved: () => Promise<void>;
}) {
  const [weekday, setWeekday] = useState(Number(schedule?.weekday ?? 1));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setWeekday(Number(schedule?.weekday ?? 1)), [schedule?.id, schedule?.weekday]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await saveCanonicalVanHalfDaySchedule({
        id: schedule?.id || `half-day-${vanId}`,
        vanId,
        weekday,
        active: true,
        workdayStart: schedule?.workdayStart || '08:00',
        workdayEnd: schedule?.workdayEnd || '13:00',
        extraMorningSlot: schedule?.extraMorningSlot || '11:30',
        notes: schedule?.notes || 'Weekly van/team afternoon off managed from ERP Next Settings.',
      });
      setMessage('Saved');
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <strong>{vanName}</strong>
    <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
      {weekdayOptions.filter((day) => day.value !== 0).map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
    </select>
    <small>{vanId} · {schedule ? `${schedule.workdayStart || '08:00'}–${schedule.workdayEnd || '13:00'} · extra morning slot ${schedule.extraMorningSlot || '11:30'}` : 'Creates the canonical weekly half-day record used by Booking Authority.'}</small>
    <button className="btn" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save half-day'}</button>
    {message ? <small>{message}</small> : null}
  </div>;
}

export function CanonicalOperatingCalendar() {
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [closedWeekdaysDraft, setClosedWeekdaysDraft] = useState<number[]>([0]);
  const [closureDate, setClosureDate] = useState(arubaDateKey());
  const [closureReason, setClosureReason] = useState('Company closed');
  const [closureNotes, setClosureNotes] = useState('');
  const [savingCalendar, setSavingCalendar] = useState(false);
  const today = arubaDateKey();

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadCanonicalOperationsState();
      setState(next);
      setClosedWeekdaysDraft(next.businessCalendar.closedWeekdays ?? [0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const halfDays = useMemo(() => {
    if (!state) return [];
    const byVan = new Map<string, CanonicalVanHalfDaySchedule>();
    for (const schedule of state.vanHalfDaySchedules) {
      const id = canonicalVanId(schedule.vanId, state.vans);
      if (!byVan.has(id)) byVan.set(id, schedule);
    }
    const seen = new Set<string>();
    return state.vans.flatMap((van) => {
      const vanId = canonicalVanId(van.id, state.vans);
      if (!vanId || seen.has(vanId)) return [];
      seen.add(vanId);
      return [{ vanId, vanName: van.name || vanId, schedule: byVan.get(vanId) }];
    });
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

  const upcomingClosures = (state?.calendarClosures ?? []).filter((closure) => String(closure.date ?? '') >= today).slice(0, 12);

  const toggleClosedWeekday = (weekday: number) => {
    setClosedWeekdaysDraft((current) => current.includes(weekday)
      ? current.filter((day) => day !== weekday)
      : [...current, weekday].sort());
  };

  const saveWeeklyClosedDays = async () => {
    setSavingCalendar(true);
    setMessage('');
    try {
      await saveCanonicalBusinessCalendar({ id: 'business-calendar', closedWeekdays: closedWeekdaysDraft });
      setMessage('Weekly company-closed days saved to canonical Firestore.');
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingCalendar(false);
    }
  };

  const saveSpecialClosure = async () => {
    if (!closureDate || !closureReason.trim()) return;
    setSavingCalendar(true);
    setMessage('');
    try {
      const existing = state?.calendarClosures.find((closure) => closure.date === closureDate);
      await saveCanonicalCalendarClosure({
        id: existing?.id || `closure-${closureDate}`,
        date: closureDate,
        reason: closureReason.trim(),
        notes: closureNotes.trim() || undefined,
        active: true,
      });
      setMessage(`${closureDate} is now blocked for automatic booking.`);
      setClosureNotes('');
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingCalendar(false);
    }
  };

  const reopenClosure = async (id: string) => {
    const closure = state?.calendarClosures.find((item) => item.id === id);
    if (!closure) return;
    setSavingCalendar(true);
    setMessage('');
    try {
      await reopenCanonicalCalendarClosure(closure);
      setMessage(`${closure.date || 'Date'} reopened for automatic booking.`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingCalendar(false);
    }
  };

  return (
    <>
      <article className="panel sg-setting-card">
        <header><div><span>Canonical Operations</span><h2>Weekly Van Half-Days</h2></div><b>Live Firestore · Editable</b></header>
        {error ? <div className="sg-runtime-note"><strong>Unable to read canonical calendar</strong><p>{error}</p></div> : null}
        <div className="sg-rule-table">
          {halfDays.map(({ vanId, vanName, schedule }) => <HalfDayEditor key={vanId} vanId={vanId} vanName={vanName} schedule={schedule} onSaved={refresh} />)}
        </div>
        <div className="sg-runtime-note"><strong>Booking behavior</strong><p>The selected weekday is the team's recurring afternoon off. The canonical Legacy behavior is preserved: 08:00–13:00 with the additional 11:30 morning slot; afternoon booking capacity is closed. Manual office drag remains a separate intentional override path.</p></div>
        <div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh canonical schedule'}</button></div>
      </article>

      <article className="panel sg-setting-card">
        <header><div><span>Canonical Operations</span><h2>Company Closures</h2></div><b>Live Firestore · Editable</b></header>
        {message ? <div className="sg-runtime-note"><strong>Calendar update</strong><p>{message}</p></div> : null}
        <div className="sg-form-grid">
          {weekdayOptions.map((day) => <label key={day.value}><span>{day.label}</span><input type="checkbox" checked={closedWeekdaysDraft.includes(day.value)} onChange={() => toggleClosedWeekday(day.value)} /><small>{closedWeekdaysDraft.includes(day.value) ? 'Closed every week' : 'Normally open'}</small></label>)}
        </div>
        <div className="page-actions"><button className="btn primary" type="button" disabled={savingCalendar} onClick={() => void saveWeeklyClosedDays()}>{savingCalendar ? 'Saving…' : 'Save weekly closed days'}</button></div>

        <div className="sg-runtime-note"><strong>Special closed date</strong><p>Add holidays, internal closures, inventory days or any date on which Maya and Booking Authority must not offer appointments.</p></div>
        <div className="sg-form-grid">
          <label>Date<input type="date" value={closureDate} onChange={(event) => setClosureDate(event.target.value)} /></label>
          <label>Reason<input value={closureReason} onChange={(event) => setClosureReason(event.target.value)} placeholder="Holiday / company closed" /></label>
          <label>Internal notes<input value={closureNotes} onChange={(event) => setClosureNotes(event.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="page-actions"><button className="btn primary" type="button" disabled={savingCalendar || !closureDate || !closureReason.trim()} onClick={() => void saveSpecialClosure()}>{savingCalendar ? 'Saving…' : 'Block special date'}</button></div>

        <div className="sg-rule-table">
          <div><strong>Weekly closed days</strong><span>{(state?.businessCalendar.closedWeekdays ?? [0]).map(weekdayLabel).join(', ') || 'None configured'}</span><small>businessSettings / business-calendar</small></div>
          {upcomingClosures.length ? upcomingClosures.map((closure) => <div key={closure.id}><strong>{closure.date || 'Date missing'}</strong><span>{closure.reason || 'Special closure'}</span><small>{closure.notes || 'calendarClosures'}</small><button className="btn" type="button" disabled={savingCalendar} onClick={() => void reopenClosure(closure.id)}>Reopen date</button></div>) : <div><strong>Special closures</strong><span>None upcoming</span><small>No active calendarClosures records from {today} forward.</small></div>}
        </div>
        {duplicateVans.length ? <div className="sg-runtime-note"><strong>Legacy fleet cleanup needed</strong><p>{duplicateVans.map(([vanId, count]) => `${vanId}: ${count} active records`).join(' · ')}. The UI collapses them to the physical van, but these duplicate documents should be reviewed before deletion.</p></div> : <div className="sg-runtime-note"><strong>Fleet identity check</strong><p>No duplicate active physical van IDs were detected in the current Firestore read.</p></div>}
      </article>
    </>
  );
}
