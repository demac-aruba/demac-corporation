'use client';

import { useRef, type ChangeEvent, type TouchEvent } from 'react';
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
  const weekTouchRef = useRef<{ x: number; y: number } | null>(null);
  const suppressDayClickRef = useRef(false);

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

  const startWeekSwipe = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    weekTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const endWeekSwipe = (event: TouchEvent<HTMLElement>) => {
    const start = weekTouchRef.current;
    weekTouchRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    suppressDayClickRef.current = true;
    onSelectDate(addDays(activeDate, deltaX < 0 ? 7 : -7));
    window.setTimeout(() => { suppressDayClickRef.current = false; }, 0);
  };

  const selectDay = (dateKey: string) => {
    if (suppressDayClickRef.current) return;
    onSelectDate(dateKey);
  };

  return <section aria-label="Week navigation" data-week-nav style={{ marginBottom: 10 }}>
    <style>{`
      .${styles.toolbar}{display:none!important}
      @media(max-width:600px){
        .${styles.pageHeader}{gap:8px!important;margin-bottom:10px!important}
        .${styles.pageHeader} p{display:none!important}
        .${styles.metrics}{display:none!important}
        .${styles.bookingIntelligence}{display:none!important}
        [data-week-nav]{width:100%!important;max-width:100%!important;min-width:0!important;overflow:hidden!important;margin-bottom:7px!important}
        [data-week-nav-bar]{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;min-width:0!important;max-width:100%!important;gap:6px!important;margin-bottom:6px!important}
        [data-week-nav-copy]{min-width:0!important;gap:4px!important}
        [data-week-nav-copy]>div{min-width:0!important}
        [data-week-nav-copy] strong{font-size:7px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        [data-week-nav-copy] span{display:none!important}
        [data-week-nav-copy]>button{width:27px!important;height:27px!important;flex:0 0 27px!important}
        [data-week-nav-actions]{min-width:0!important;gap:4px!important}
        [data-week-nav-actions]>button{height:27px!important;padding:0 7px!important}
        .${styles.weekStrip}{grid-template-columns:repeat(7,minmax(0,1fr))!important;width:100%!important;max-width:100%!important;min-width:0!important;gap:3px!important;margin-bottom:7px!important;overflow:hidden!important;touch-action:pan-y!important;user-select:none!important}
        .${styles.dayCard}{position:relative!important;width:100%!important;min-width:0!important;min-height:60px!important;padding:6px 3px!important;border-radius:9px!important;overflow:hidden!important}
        .${styles.dayCard}>div{display:flex!important;align-items:flex-start!important;flex-direction:column!important;gap:1px!important;min-width:0!important}
        .${styles.dayCard}>div>span{font-size:8px!important;line-height:1.05!important}
        .${styles.dayCard}>div>strong{font-size:8.8px!important;line-height:1.08!important;white-space:nowrap!important}
        .${styles.dayCard}>div>b{display:none!important}
        .${styles.dayCard}>small,.${styles.dayCard}>p{display:none!important}
        .${styles.dayCard}>span{margin-top:11px!important}
        .${styles.dayCard}>span>b{left:50%!important;transform:translateX(-50%)!important;font-size:7px!important}
        .${styles.dayCard}>span>i{height:3px!important}
        .${styles.boardHeader}{padding:9px 10px!important}
        .${styles.boardHeader} span{display:none!important}
        .${styles.boardHeader}>div::after{content:'Swipe left/right to change van';display:block;margin-top:2px;color:var(--muted);font-size:5.8px}
        .${styles.boardScroll}{overflow-x:auto!important;max-width:100%!important;scroll-snap-type:x mandatory!important;scrollbar-width:none!important;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x pan-y}
        .${styles.boardScroll}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
        .${styles.vanGrid}{display:flex!important;grid-template-columns:none!important;gap:0!important;min-width:0!important;width:100%!important;max-width:100%!important;padding:0!important}
        .${styles.vanLane}{flex:0 0 100%!important;width:100%!important;max-width:100%!important;min-width:0!important;scroll-snap-align:start!important;scroll-snap-stop:always!important;border:0!important;border-radius:0!important}
        .${styles.vanLane}>header{padding:10px 11px!important}
        .${styles.anchorBar}>div{padding:7px 9px!important}
        .${styles.slotList}{padding:8px!important}
      }
    `}</style>
    <div data-week-nav-bar style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
      <div data-week-nav-copy style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button type="button" onClick={() => onSelectDate(addDays(activeDate, -7))} title="Previous week" aria-label="Previous week" style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <div>
          <strong style={{ display: 'block', fontSize: 8.5 }}>{weekLabel(week)}</strong>
          <span style={{ display: 'block', marginTop: 2, color: 'var(--muted)', fontSize: 6.1 }}>Navigate operational weeks or jump directly to any booking date.</span>
        </div>
        <button type="button" onClick={() => onSelectDate(addDays(activeDate, 7))} title="Next week" aria-label="Next week" style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16 }}>›</button>
      </div>

      <div data-week-nav-actions style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button type="button" onClick={() => onSelectDate(today)} style={{ height: 30, border: '1px solid var(--border)', borderRadius: 9, padding: '0 10px', color: activeDate === today ? 'var(--brand)' : 'var(--text)', background: activeDate === today ? 'var(--brand-soft)' : 'var(--surface)', cursor: 'pointer', fontSize: 6.8, fontWeight: 900 }}>Today</button>
        <button type="button" onClick={openCalendar} title="Choose a date" aria-label="Choose a schedule date" style={{ height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 9, padding: '0 10px', color: 'var(--brand)', background: 'var(--surface)', cursor: 'pointer', fontSize: 6.8, fontWeight: 900 }}>
          {calendarIcon()}<span>Calendar</span>
        </button>
        <input ref={dateInputRef} type="date" value={activeDate} onChange={pickDate} tabIndex={-1} aria-hidden="true" style={{ position: 'fixed', left: -20, top: -20, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      </div>
    </div>

    <section className={styles.weekStrip} data-week-strip aria-label="Operational week" onTouchStart={startWeekSwipe} onTouchEnd={endWeekSwipe} onTouchCancel={() => { weekTouchRef.current = null; }}>{week.map((day) => {
      const summary = summaries[day.dateKey] ?? { total: 0, occupied: 0, open: 0, percent: 0 };
      const labelPosition = Math.min(96, Math.max(4, summary.percent));
      const color = progressColor(summary.percent);
      return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.dateKey === today ? styles.today : ''}`} onClick={() => selectDay(day.dateKey)}>
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
