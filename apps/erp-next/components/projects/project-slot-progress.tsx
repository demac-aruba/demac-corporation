'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserProject } from '@/lib/browser-projects';
import type { AuthPrincipal } from '@/lib/security';
import { useAuth } from '@/components/auth/auth-provider';
import { loadProjectSlotPeople, loadProjectSlotSources } from '@/lib/live-project-slot-progress';
import {
  linkedProjectWorkOrderIds, projectSlotProgress, projectSlotTechnician,
  type ProjectSlotPeople, type ProjectSlotProgress, type ProjectSlotSources,
} from '@/lib/project-slot-progress';
import styles from './project-slot-progress.module.css';

function principalKey(principal: AuthPrincipal) {
  return JSON.stringify([principal.userId, principal.active, [...principal.capabilities].sort()]);
}
function format(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value); }

export function useProjectSlotSources(projects: BrowserProject[], principal: AuthPrincipal) {
  const key = principalKey(principal);
  const idsKey = JSON.stringify(linkedProjectWorkOrderIds(projects));
  const enabled = principal.active && principal.capabilities.has('projects.view') && principal.capabilities.has('work_orders.view');
  const [snapshot, setSnapshot] = useState<{ key: string; idsKey: string; sources: ProjectSlotSources; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef(() => {});
  const principalRef = useRef(principal);
  principalRef.current = principal;
  useEffect(() => {
    if (!enabled) { refreshRef.current = () => {}; setSnapshot(null); setBusy(false); return; }
    let active = true;
    const controller = new AbortController();
    let pending = false;
    let again = false;
    const refresh = async () => {
      if (pending) { again = true; return; }
      pending = true;
      setBusy(true);
      do {
        again = false;
        const sources = await loadProjectSlotSources(principalRef.current, JSON.parse(idsKey), undefined, controller.signal).catch(() => ({}));
        if (active) setSnapshot((previous) => ({ key, idsKey, sources, revision: (previous?.revision ?? 0) + 1 }));
      } while (active && again);
      pending = false;
      if (active) setBusy(false);
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(onFocus, 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [enabled, key, idsKey]);
  const current = enabled && snapshot?.key === key && snapshot.idsKey === idsKey ? snapshot : null;
  const refresh = useCallback(() => refreshRef.current(), []);
  return { sources: current?.sources ?? {}, revision: current?.revision ?? 0, ready: Boolean(current), enabled, busy, refresh };
}
export type ProjectSlotSourceState = ReturnType<typeof useProjectSlotSources>;

function SlotDetails({ project, progress, source, onClose }: {
  project: BrowserProject; progress: ProjectSlotProgress; source: ProjectSlotSourceState; onClose: () => void;
}) {
  const { principal } = useAuth();
  const sessionKey = principalKey(principal);
  const ref = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<{ key: string; rows: string; revision: number; value: ProjectSlotPeople } | null>(null);
  const rowsKey = JSON.stringify(progress.rows.map((row) => [row.workOrderId, row.date, row.technicianIds]));
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const rowsRef = useRef(progress.rows);
  rowsRef.current = progress.rows;
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPeople(null);
    void loadProjectSlotPeople(principalRef.current, rowsRef.current, undefined, controller.signal).then((value) => {
      if (active) setPeople({ key: sessionKey, rows: rowsKey, revision: source.revision, value });
    }).catch(() => {
      if (active) setPeople({ key: sessionKey, rows: rowsKey, revision: source.revision, value: { staff: {}, attendance: {}, canReadAttendance: principalRef.current.capabilities.has('payroll_sensitive.view') } });
    });
    return () => { active = false; controller.abort(); };
    // row identity and revision ensure past-day attendance corrections are re-read too.
  }, [sessionKey, rowsKey, source.revision]);
  const currentPeople = people?.key === sessionKey && people.rows === rowsKey && people.revision === source.revision ? people.value : undefined;
  return <dialog ref={ref} className={styles.dialog} role="dialog" aria-label={`Slot progress · ${project.name}`} onCancel={onClose} onClose={onClose}>
    <header className={styles.header}>
      <div><span>{project.projectNumber}</span><h2>Slot progress · {project.name}</h2><p>Bookings in chronological order · oldest first</p></div>
      <button type="button" onClick={onClose} aria-label="Close slot progress">×</button>
    </header>
    <div className={styles.body}>
      <div className={styles.detailSummary}><strong>{format(progress.total)} {progress.complete ? 'allocated' : 'verified'} / {progress.budget === null ? '—' : format(progress.budget)} budget slots</strong>
        {progress.overBudget > 0 && <span className={styles.over}>+{format(progress.overBudget)} slots over budget{!progress.complete ? ' (at least)' : ''}</span>}
        <button type="button" className={styles.refresh} onClick={source.refresh} disabled={source.busy}>{source.busy ? 'Refreshing…' : 'Refresh progress'}</button>
      </div>
      <p className={styles.explanation}>Each Van slot counts once, regardless of crew size. Past and future bookings count toward this allocation budget. Cancelled or removed Work Orders count as zero. Corrections to linked bookings are recalculated when you return here, refresh, or after one minute while this tab is visible.</p>
      <p className={styles.explanation}>Technicians below are the crew recorded on each Work Order. Attendance is a separate daily record; it does not confirm a visit to this Project or change Van slots. Missing attendance entries are not proof of absence.</p>
      {!progress.complete && <p className={styles.warning} role="status">The total is incomplete. Verify the flagged rows before relying on it.</p>}
      {progress.previewCount > 0 && <p className={styles.warning}>{progress.previewCount} phase preview assignment(s) are excluded because they are not linked to live Scheduling.</p>}
      {progress.rows.length === 0 ? <p>No linked Scheduling bookings yet.</p> : <ol className={styles.history}>
        {progress.rows.map((row) => <li key={row.workOrderId}>
          <div className={styles.rowHeading}><strong>{row.date || 'Date unavailable'}{row.time ? ` · ${row.time}` : ''}</strong><span>{row.slots === null ? 'Slots unverified' : `${format(row.slots)} slots`}</span></div>
          <p>{row.vanId || 'Van unavailable'} · {row.phase || 'Project link'} · {row.status}</p>
          {row.issue ? <p className={styles.warning}>{row.issue}</p> : <ul className={styles.crew}>{row.technicianIds.length ? row.technicianIds.map((id) => {
            const person = projectSlotTechnician(id, row.date, currentPeople);
            return <li key={id}><strong>{person.name}</strong><span>{person.attendance}</span></li>;
          }) : <li>Assigned technicians unavailable in this Work Order.</li>}</ul>}
          <small className={styles.reference}>Work Order: {row.workOrderId}</small>
        </li>)}
      </ol>}
    </div>
  </dialog>;
}

export function ProjectSlotBudgetProgress({ project, projects, source, compact = false }: {
  project: BrowserProject; projects: BrowserProject[]; source: ProjectSlotSourceState; compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = projectSlotProgress(project, projects, source.sources);
  if (!source.enabled) return <div className={styles.progress}><small>Scheduling access required to verify slot progress.</small></div>;
  return <section className={`${styles.progress} ${compact ? styles.compact : styles.card}`} aria-label={`Van slot budget · ${project.name}`}>
    {!compact && <h2>Van slot budget</h2>}
    {!source.ready ? <p>Loading current slots…</p> : <>
      <strong>{format(progress.total)} / {progress.budget === null ? '—' : format(progress.budget)} slots</strong>
      <small>{progress.complete ? 'Allocated / budget' : 'Verified subtotal · incomplete'}</small>
      <div className={`${styles.track} ${progress.overBudget > 0 ? styles.red : ''}`} role="progressbar" aria-label="Allocated Van slots"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.complete ? Math.min(100, progress.percent) : undefined}
        aria-valuetext={`${format(progress.total)} of ${progress.budget === null ? 'unknown' : format(progress.budget)} budget slots${progress.complete ? '' : '; incomplete total'}`}>
        <i style={{ width: `${Math.min(100, progress.percent)}%` }} />
      </div>
      {progress.overBudget > 0 ? <span className={styles.over}>+{format(progress.overBudget)} slots over budget{!progress.complete ? ' (at least)' : ''}</span>
        : progress.complete && <small>{format(Math.max(0, (progress.budget ?? 0) - progress.total))} slots remaining</small>}
      {!progress.complete && <small className={styles.warning}>Some allocations could not be verified.</small>}
      <button type="button" className={styles.more} onClick={() => { setExpanded(true); source.refresh(); }}>More info</button>
    </>}
    {expanded && <SlotDetails key={project.id} project={project} progress={progress} source={source} onClose={() => setExpanded(false)} />}
  </section>;
}
