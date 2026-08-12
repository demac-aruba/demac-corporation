'use client';

import { useRef, type ChangeEvent } from 'react';
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
  const dateInputRef = useRef<HTMLInputElement>(null);

  const pickDate = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value) onSelectDate(event.target.value);
  };

  const openCalendar = () => {
    const input = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      // Fall back to focus/click for browsers that reject showPicker on this control.
    }
    input.focus();
    input.click();
  };

  return <section aria-label="Week navigation" style={{ marginBottom: 10 }}>
    <style>{`.${styles.toolbar}{display:none!important}`}</style>
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
        <button type="button" onClick={openCalendar} title="Choose a date" aria-label="Choose a schedule date" style={{ height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 9, padding: '0 10px', color: 'var(--brand)', background: 'var(--surface)', cursor: 'pointer', fontSize: 6.8, fontWeight: 900 }}>
          {calendarIcon()}<span>Calendar</span>
        </button>
        <input ref={dateInputRef} type="date" value={activeDate} onChange={pickDate} tabIndex={-1} aria-hidden="true" style={{ position: 'fixed', left: -20, top: -20, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      </div>
    </div>

    <section className={styles.weekStrip} aria-label="Operational week">{week.map((day) => {
      const summary = summaries[day.dateKey] ?? { total: 0, occupied: 0, open: 0, percent: 0 };
      const labelPosition = Math.min(96, Math.max(4, summary.percent));
      const color = progressColor(summary.percent);
      return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.dateKey === today ? styles.today : ''}`} onClick={() => onSelectDate(day.dateKey)}>
        <div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.dateKey === today ? <b>TODAY</b> : null}</div>
        <small>{day.shiftLabel}</small>
        {day.isOpen ? <>
          <span style={{ position: 'relative', display: 'block', marginTop: 13 }}>
            <b style={{ position: 'absolute', left: `${labelPosition}%`, top: -11, transform: 'translateX(-50%)', color, fontSize: 5.5, fontWeight: 950, lineHeight: 1, whiteSpace: 'nowrap' }}>{summary.percent}%</b>
            <i style={{ display: 'block', height: 4, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
              <em style={{ display: 'block', width: `${summary.percent}%`, height: '100%', borderRadius: 99, background: color, transition: 'width .2s ease, background .2s ease' }} />
            </i>
          </span>
          <p>{summary.occupied}/{summary.total} spots filled · {summary.open} open</p>
        </> : <p>Operationally closed</p>}
      </button>;
    })}</section>
  </section>;
}
