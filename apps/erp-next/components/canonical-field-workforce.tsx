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

function useCanonicalOperations() {
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
  return { state, error, loading, refresh };
}

export function CanonicalTechniciansPanel() {
  const { state, error, loading, refresh } = useCanonicalOperations();
  const today = arubaDateKey();
  const active = (state?.staffProfiles ?? []).filter((profile) => profile.active !== false);
  const drivers = active.filter((profile) => profile.canDriveVan).length;
  const helpers = active.filter((profile) => /ayudante|helper/i.test(profile.role || '') || !profile.canDriveVan).length;
  const unavailable = active.filter((profile) => profile.availability && profile.availability !== 'Disponible' || Boolean(activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []))).length;

  return <div className="fa-stack">
    <section className="page-head"><div><div className="eyebrow">Field Workforce · Canonical</div><h1>Technicians</h1><p>Live staffProfiles data used by Booking Authority for crew availability, daily assignments and scheduling decisions.</p></div><div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh Live Data'}</button></div></section>
    {error ? <section className="panel"><strong>Unable to load canonical workforce</strong><p>{error}</p></section> : null}
    <section className="fa-metrics"><article><span>Active Field Staff</span><strong>{active.length}</strong><small className="fa-good">Firestore staffProfiles</small></article><article><span>Authorized Drivers</span><strong>{drivers}</strong><small>canDriveVan</small></article><article><span>Helpers / Support</span><strong>{helpers}</strong><small>crew support profiles</small></article><article><span>Unavailable Today</span><strong>{unavailable}</strong><small>{today}</small></article></section>
    <section className="panel fa-table-panel"><header className="panel-head"><div><h2>Canonical Technician & Helper Roster</h2><span>No static preview performance data</span></div><span>LIVE</span></header><div className="fa-table fa-tech-table"><div className="fa-row fa-head"><span>Employee / Role</span><span>Primary Van</span><span>Skills</span><span>Availability</span><span>Driver</span><span>Source</span></div>{active.map((profile) => {
      const absence = activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []);
      return <div className="fa-row" key={profile.id}><div><strong>{staffDisplayName(profile)}</strong><small>{profile.role || 'Role not configured'}</small></div><div><strong>{profile.primaryVanId ? canonicalVanId(profile.primaryVanId, state?.vans ?? []) : 'UNASSIGNED'}</strong><small>{profile.id}</small></div><div className="fa-tags">{(profile.skills ?? []).length ? (profile.skills ?? []).map((skill) => <b key={`${profile.id}-${skill}`}>{skill}</b>) : <span>No skills recorded</span>}</div><div><strong>{absence?.reason || profile.availability || 'Disponible'}</strong><small>{absence ? `${absence.fromDate || ''} → ${absence.toDate || ''}` : 'Current profile state'}</small></div><strong>{profile.canDriveVan ? 'Yes' : 'No'}</strong><span>staffProfiles</span></div>;
    })}</div></section>
    <section className="fa-two-col"><article className="panel"><header className="panel-head"><div><h2>Dispatch Use</h2><span>How canonical staff data affects booking</span></div></header><div className="fa-rules"><div><strong>Driver required</strong><span>A van without an available authorized driver cannot receive automatic bookings.</span></div><div><strong>Daily assignment wins</strong><span>dailyVanAssignments overrides the van's regular driver/helper for that date.</span></div><div><strong>Absence wins</strong><span>staffAbsences and inactive availability remove the person from automatic crew resolution.</span></div></div></article><article className="panel"><header className="panel-head"><div><h2>Data Integrity</h2><span>One operational roster</span></div></header><div className="fa-callout"><strong>Firestore is the source of truth</strong><p>The previous static technician preview remains only legacy presentation code and is no longer used on this screen.</p></div></article></section>
  </div>;
}

export function CanonicalVansPanel() {
  const { state, error, loading, refresh } = useCanonicalOperations();
  const today = arubaDateKey();
  const canonicalVans = useMemo(() => {
    if (!state) return [];
    const byId = new Map<string, typeof state.vans[number]>();
    for (const van of state.vans) {
      const id = canonicalVanId(van.id, state.vans);
      const current = byId.get(id);
      if (!current || van.id === id) byId.set(id, van);
    }
    return [...byId.values()].sort((a, b) => canonicalVanId(a.id, state.vans).localeCompare(canonicalVanId(b.id, state.vans)));
  }, [state]);

  const available = canonicalVans.filter((van) => !['Mantenimiento', 'Fuera de servicio'].includes(van.status || '')).length;
  const halfDays = state?.vanHalfDaySchedules.length ?? 0;

  return <div className="fa-stack">
    <section className="page-head"><div><div className="eyebrow">Mobile Warehouses · Canonical Fleet</div><h1>Vans & Readiness</h1><p>Live van profiles, regular crews, daily assignment overrides and weekly half-day rules from the same Firestore records used by Booking Authority.</p></div><div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh Live Data'}</button></div></section>
    {error ? <section className="panel"><strong>Unable to load canonical fleet</strong><p>{error}</p></section> : null}
    <section className="fa-metrics"><article><span>Canonical Vans</span><strong>{canonicalVans.length} / 4</strong><small className="fa-good">physical fleet lanes</small></article><article><span>Operational Profiles</span><strong>{available}</strong><small>not maintenance / out of service</small></article><article><span>Half-Day Rules</span><strong>{halfDays}</strong><small>vanHalfDaySchedules</small></article><article><span>Date Evaluated</span><strong>{today.slice(5)}</strong><small>America/Aruba</small></article></section>
    <section className="fa-van-grid">{canonicalVans.map((van) => {
      const vanId = state ? canonicalVanId(van.id, state.vans) : van.id;
      const crew = state ? resolveCanonicalCrew(van, today, state) : null;
      const halfDay = state?.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
      const blocked = ['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(crew?.daily?.status || van.status || '');
      return <article className="panel fa-van-card" key={vanId}><div className="fa-van-head"><div><span>{van.plate || 'Fleet profile'}</span><h2>{van.name || vanId}</h2><p>{staffDisplayName(crew?.driver)}{crew?.helper ? ` + ${staffDisplayName(crew.helper)}` : ''}</p></div><b className={blocked ? 'risk' : ''}>{crew?.daily?.status || van.status || 'Disponible'}</b></div><div className="fa-van-context"><div><span>Canonical ID</span><strong>{vanId}</strong></div><div><span>Crew source</span><strong>{crew?.daily ? 'Daily override' : 'Van profile'}</strong></div></div><div className="fa-van-alert"><span>Weekly half-day</span><strong>{halfDay ? weekdayLabel(halfDay.weekday) : 'Not configured'}</strong></div><div className="fa-van-alert"><span>Regular driver / helper</span><strong>{staffDisplayName(crew?.driver)} · {staffDisplayName(crew?.helper)}</strong></div></article>;
    })}</section>
    <section className="fa-two-col"><article className="panel"><header className="panel-head"><div><h2>Canonical Capacity Rules</h2><span>Automatic booking</span></div></header><div className="fa-rules"><div><strong>Crew</strong><span>Driver/helper resolve from vans, then dailyVanAssignments.</span></div><div><strong>Availability</strong><span>staffAbsences and staff availability can block automatic assignment.</span></div><div><strong>Half-day</strong><span>vanHalfDaySchedules affects automatic booking capacity.</span></div></div></article><article className="panel"><header className="panel-head"><div><h2>Manual Dispatch</h2><span>Operator intent</span></div></header><div className="fa-callout"><strong>Separate from automatic booking</strong><p>Manual drag of an existing appointment follows visible free capacity, while Maya and Booking Authority continue to respect canonical crew and half-day rules for new bookings.</p></div></article></section>
  </div>;
}
