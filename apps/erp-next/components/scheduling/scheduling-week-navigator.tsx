'use client';

import type { ChangeEvent } from 'react';
import type { OperationalDay } from '../../lib/scheduling-capacity';
import styles from './scheduling-overview-v2.module.css';

type DaySummary = { total: number; occupied: number; open: number; percent: number };

type Props = {
  week: OperationalDay[];
  activeDate: string;
  today: string;
  summaries: Record<string, DaySummary>;
  onSelectDate: (dateKey: string) => void;
};

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function shortDate(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`));
}

function weekLabel(week: OperationalDay[]) {
  const first = week[0]?.dateKey;
  const last = week.at(-1)?.dateKey;
  if (!first || !last) return 'Operational week';
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' }).format(new Date(`${last}T12:00:00Z`));
  return `${shortDate(first)} – ${shortDate(last)}, ${year}`;
}

function progressColor(percent: number) {
  if (percent >= 100) return 'var(--success)';
  if (percent >= 80) return 'var(--brand)';
  if (percent >= 55) return 'var(--success)';
  if (percent >= 30) return 'var(--warning)';
  return 'var(--danger)';
}

function calendarIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3.5 9h17M5.5 4h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

export function SchedulingWeekNavigator({ week, activeDate, today, summaries, onSelectDate }: Props) {
  const pickDate = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value) onSelectDate(event.target.value);
  };

  return <section aria-label="Week navigation" style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button type="button" onClick={() => onSelectDate(addDays(activeDate, -7))} title="Previous week" aria-label="Previous week" style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <div>
          <strong style={{ display: 'block', fontSize: 8.5 }}>{weekLabel(week)}</strong>
          <span style={{ display: 'block', marginTop: 2, color: 'var(--muted)', fontSize: 6.1 }}>Navigate operational weeks or jump directly to any booking date.</span>
        </div>
        <button type="button" onClick={() => onSelectDate(addDays(activeDate, 7))} title="Next week" aria-label="Next week" style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16 }}>›</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button type="button" onClick={() => onSelectDate(today)} style={{ height: 30, border: '1px solid var(--border)', borderRadius: 9, padding: '0 10px', color: activeDate === today ? 'var(--brand)' : 'var(--text)', background: activeDate === today ? 'var(--brand-soft)' : 'var(--surface)', cursor: 'pointer', fontSize: 6.8, fontWeight: 900 }}>Today</button>
        <label title="Choose a date" style={{ position: 'relative', height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 9, padding: '0 10px', color: 'var(--brand)', background: 'var(--surface)', cursor: 'pointer', fontSize: 6.8, fontWeight: 900, overflow: 'hidden' }}>
          {calendarIcon()}<span>Calendar</span>
          <input type="date" value={activeDate} onChange={pickDate} aria-label="Choose schedule date" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
        </label>
      </div>
    </div>

    <section className={styles.weekStrip} aria-label="Operational week">{week.map((day) => {
      const summary = summaries[day.dateKey] ?? { total: 0, occupied: 0, open: 0, percent: 0 };
      return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.dateKey === today ? styles.today : ''}`} onClick={() => onSelectDate(day.dateKey)}>
        <div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.dateKey === today ? <b>TODAY</b> : null}</div>
        <small>{day.shiftLabel}</small>
        {day.isOpen ? <><i><em style={{ width: `${summary.percent}%`, background: progressColor(summary.percent), transition: 'width .2s ease, background .2s ease' }} /></i><p>{summary.occupied}/{summary.total} spots filled · {summary.open} open</p></> : <p>Operationally closed</p>}
      </button>;
    })}</section>
  </section>;
}
