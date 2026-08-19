'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  activeStaffAbsence,
  canonicalVanId,
  loadCanonicalOperationsState,
  resolveCanonicalCrew,
  staffDisplayName,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalVan,
} from '../../lib/canonical-operations';
import styles from './browser-workforce-registry.module.css';

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

export function CanonicalWorkforceRegistry() {
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const today = arubaDateKey();

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadCanonicalOperationsState();
      setState(next);
      setRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const metrics = useMemo(() => {
    if (!state) return { active: 0, vans: 0, absent: 0, halfDays: 0 };
    return {
      active: state.staffProfiles.filter((profile) => profile.active !== false).length,
      vans: new Set(state.vans.map((van) => canonicalVanId(van.id, state.vans))).size,
      absent: state.staffProfiles.filter((profile) => Boolean(activeStaffAbsence(profile.id, today, state.staffAbsences))).length,
      halfDays: state.vanHalfDaySchedules.length,
    };
  }, [state, today]);

  const canonicalVans = useMemo(() => {
    if (!state) return [] as CanonicalVan[];
    const byId = new Map<string, CanonicalVan>();
    for (const van of state.vans) {
      const id = canonicalVanId(van.id, state.vans);
      const current = byId.get(id);
      if (!current || van.id === id) byId.set(id, van);
    }
    return [...byId.values()].sort((a, b) => canonicalVanId(a.id, state.vans).localeCompare(canonicalVanId(b.id, state.vans)));
  }, [state]);

  const regularVanIdsByStaff = useMemo(() => {
    const result = new Map<string, string[]>();
    if (!state) return result;
    for (const van of canonicalVans) {
      const vanId = canonicalVanId(van.id, state.vans);
      for (const staffId of [van.responsibleStaffId, van.regularHelperId]) {
        if (!staffId) continue;
        const ids = result.get(staffId) ?? [];
        if (!ids.includes(vanId)) ids.push(vanId);
        result.set(staffId, ids);
      }
    }
    return result;
  }, [canonicalVans, state]);

  if (loading && !state) return <section className={styles.loading}>Loading canonical workforce from Firestore…</section>;

  return (
    <section className={styles.workspace}>
      <header>
        <div>
          <span>LIVE FIRESTORE · CANONICAL OPERATIONS</span>
          <h2>Employees, Crews & Van Capacity</h2>
          <p>This view reads the same staffProfiles, vans, dailyVanAssignments, staffAbsences and vanHalfDaySchedules used by Booking Authority. Browser preview records are not treated as operational truth here.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh live data'}</button>
        </div>
      </header>

      {error ? <div className={styles.notice}>Live Firestore read failed: {error}</div> : null}
      {!error && refreshedAt ? <div className={styles.notice}>Canonical operations loaded successfully · refreshed {refreshedAt}</div> : null}

      <div className={styles.metrics}>
        <article><span>Active Staff</span><strong>{metrics.active}</strong><small>staffProfiles</small></article>
        <article><span>Canonical Vans</span><strong>{metrics.vans}/4</strong><small>duplicate IDs collapse to physical vans</small></article>
        <article><span>Absent Today</span><strong>{metrics.absent}</strong><small>{today} · staffAbsences</small></article>
        <article><span>Half-Day Rules</span><strong>{metrics.halfDays}</strong><small>vanHalfDaySchedules</small></article>
      </div>

      <div className={styles.tableWrap}>
        <div className={`${styles.row} ${styles.head}`}><span>Employee</span><span>Main Van</span><span>Role / Skills</span><span>Availability</span><span>Status</span></div>
        {(state?.staffProfiles ?? []).map((profile) => {
          const absence = activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []);
          const availability = absence?.reason || profile.availability || 'Disponible';
          const crewVans = regularVanIdsByStaff.get(profile.id) ?? [];
          const staffProfileVan = profile.primaryVanId ? canonicalVanId(profile.primaryVanId, state?.vans ?? []) : '';
          const mainVan = crewVans.length ? crewVans.join(', ') : staffProfileVan || 'UNASSIGNED';
          const vanSource = crewVans.length ? 'Van crew profile' : staffProfileVan ? 'Staff profile' : '';
          return <div className={styles.row} key={profile.id}>
            <div className={styles.identity}><strong>{staffDisplayName(profile)}</strong><small>{profile.id}</small>{profile.phone ? <small>{profile.phone}</small> : null}</div>
            <div><strong>{mainVan}</strong>{vanSource ? <small>{vanSource}</small> : null}</div>
            <div className={styles.skills}><span>{profile.role || 'Role not configured'}</span>{(profile.skills ?? []).map((skill) => <button type="button" className={styles.skillActive} key={`${profile.id}-${skill}`} tabIndex={-1}>{skill}</button>)}</div>
            <span>{availability}</span>
            <span>{profile.active === false ? 'Inactive' : absence ? 'Unavailable today' : 'Active'}</span>
          </div>;
        })}
      </div>

      <div className={styles.tableWrap}>
        <div className={`${styles.row} ${styles.head}`}><span>Van</span><span>Driver</span><span>Regular / Daily Helper</span><span>Weekly Half-Day</span><span>Operational</span></div>
        {canonicalVans.map((van) => {
          const crew = state ? resolveCanonicalCrew(van, today, state) : null;
          const vanId = state ? canonicalVanId(van.id, state.vans) : van.id;
          const halfDay = state?.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
          const source = crew?.daily ? 'Daily assignment' : 'Van profile';
          return <div className={styles.row} key={vanId}>
            <div className={styles.identity}><strong>{van.name || vanId}</strong><small>{vanId}{van.plate ? ` · ${van.plate}` : ''}</small></div>
            <div><strong>{staffDisplayName(crew?.driver)}</strong>{crew?.driverAbsence ? <small>{crew.driverAbsence.reason || 'Absent today'}</small> : null}</div>
            <div><strong>{staffDisplayName(crew?.helper)}</strong><small>{source}</small>{crew?.helperAbsence ? <small>{crew.helperAbsence.reason || 'Absent today'}</small> : null}</div>
            <div><strong>{halfDay ? weekdayLabel(halfDay.weekday) : 'Not configured'}</strong>{halfDay?.workdayEnd ? <small>works until {halfDay.workdayEnd}</small> : null}</div>
            <span>{crew?.daily?.status || van.status || 'Disponible'}</span>
          </div>;
        })}
      </div>

      <footer>
        <span>SOURCE-OF-TRUTH RULE</span>
        <strong>Regular van membership is owned by the canonical van crew profile. staffProfiles.primaryVanId remains a compatibility hint only; dailyVanAssignments remain date-specific overrides.</strong>
      </footer>
    </section>
  );
}
