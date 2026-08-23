'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth/auth-provider';
import {
  activeStaffAbsence,
  canonicalVanId,
  loadCanonicalOperationsState,
  resolveCanonicalCrew,
  staffDisplayName,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalVan,
} from '../lib/canonical-operations';
import {
  getVanScheduleGroupSettings,
  saveVanScheduleGroupSetting,
  type VanScheduleGroupSetting,
} from '../lib/van-schedule-settings';

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
  const fieldStaff = active.filter((profile) => profile.canDriveVan || Boolean(profile.primaryVanId) || /t[eé]cnico|ayudante|supervisor/i.test(profile.role || ''));
  const drivers = fieldStaff.filter((profile) => profile.canDriveVan).length;
  const helpers = fieldStaff.filter((profile) => /ayudante|helper/i.test(profile.role || '') || (!profile.canDriveVan && Boolean(profile.primaryVanId))).length;
  const unavailable = fieldStaff.filter((profile) => Boolean((profile.availability && profile.availability !== 'Disponible') || activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []))).length;

  return <div className="fa-stack">
    <section className="page-head"><div><div className="eyebrow">Field Workforce · Canonical</div><h1>Technicians</h1><p>Live staffProfiles data used by Booking Authority for crew availability, daily assignments and scheduling decisions.</p></div><div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh Live Data'}</button></div></section>
    {error ? <section className="panel"><strong>Unable to load canonical workforce</strong><p>{error}</p></section> : null}
    <section className="fa-metrics"><article><span>Active Field Staff</span><strong>{fieldStaff.length}</strong><small className="fa-good">Firestore staffProfiles</small></article><article><span>Authorized Drivers</span><strong>{drivers}</strong><small>canDriveVan</small></article><article><span>Helpers / Support</span><strong>{helpers}</strong><small>crew support profiles</small></article><article><span>Unavailable Today</span><strong>{unavailable}</strong><small>{today}</small></article></section>
    <section className="panel fa-table-panel"><header className="panel-head"><div><h2>Canonical Technician & Helper Roster</h2><span>No static preview performance data</span></div><span>LIVE</span></header><div className="fa-table fa-tech-table"><div className="fa-row fa-head"><span>Employee / Role</span><span>Primary Van</span><span>Skills</span><span>Availability</span><span>Driver</span><span>Source</span></div>{fieldStaff.map((profile) => {
      const absence = activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []);
      return <div className="fa-row" key={profile.id}><div><strong>{staffDisplayName(profile)}</strong><small>{profile.role || 'Role not configured'}</small></div><div><strong>{profile.primaryVanId ? canonicalVanId(profile.primaryVanId, state?.vans ?? []) : 'UNASSIGNED'}</strong><small>{profile.id}</small></div><div className="fa-tags">{(profile.skills ?? []).length ? (profile.skills ?? []).map((skill) => <b key={`${profile.id}-${skill}`}>{skill}</b>) : <span>No skills recorded</span>}</div><div><strong>{absence?.reason || profile.availability || 'Disponible'}</strong><small>{absence ? `${absence.fromDate || ''} → ${absence.toDate || ''}` : 'Current profile state'}</small></div><strong>{profile.canDriveVan ? 'Yes' : 'No'}</strong><span>staffProfiles</span></div>;
    })}</div></section>
    <section className="fa-two-col"><article className="panel"><header className="panel-head"><div><h2>Dispatch Use</h2><span>How canonical staff data affects booking</span></div></header><div className="fa-rules"><div><strong>Driver required</strong><span>A van without an available authorized driver cannot receive automatic bookings.</span></div><div><strong>Daily assignment wins</strong><span>dailyVanAssignments overrides the van's regular driver/helper for that date.</span></div><div><strong>Absence wins</strong><span>staffAbsences and inactive availability remove the person from automatic crew resolution.</span></div></div></article><article className="panel"><header className="panel-head"><div><h2>Data Integrity</h2><span>One operational roster</span></div></header><div className="fa-callout"><strong>Firestore is the source of truth</strong><p>The previous static technician preview remains only legacy presentation code and is no longer used on this screen.</p></div></article></section>
  </div>;
}

export function CanonicalVansPanel() {
  const { principal } = useAuth();
  const { state, error, loading, refresh } = useCanonicalOperations();
  const [scheduleGroups, setScheduleGroups] = useState<VanScheduleGroupSetting[]>([]);
  const [scheduleGroupsLoading, setScheduleGroupsLoading] = useState(false);
  const [scheduleGroupsError, setScheduleGroupsError] = useState('');
  const [savingVanId, setSavingVanId] = useState('');
  const [scheduleGroupsMessage, setScheduleGroupsMessage] = useState('');
  const today = arubaDateKey();
  const canManageScheduleGroups = principal.active && principal.capabilities.has('scheduling.manage');

  const loadScheduleGroups = async () => {
    if (!canManageScheduleGroups) return;
    setScheduleGroupsLoading(true);
    setScheduleGroupsError('');
    try {
      const result = await getVanScheduleGroupSettings();
      setScheduleGroups(result.groups);
    } catch (cause) {
      setScheduleGroupsError(cause instanceof Error ? cause.message : 'Van WhatsApp schedule settings could not be loaded.');
    } finally {
      setScheduleGroupsLoading(false);
    }
  };

  useEffect(() => { void loadScheduleGroups(); }, [canManageScheduleGroups]);

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

  const scheduleGroupByVan = useMemo(() => new Map(scheduleGroups.map((group) => [group.vanId, group])), [scheduleGroups]);
  const available = canonicalVans.filter((van) => !['Mantenimiento', 'Fuera de servicio'].includes(van.status || '')).length;
  const configuredGroups = scheduleGroups.filter((group) => group.configured && group.enabled).length;

  const updateScheduleGroup = (vanId: string, patch: Partial<VanScheduleGroupSetting>) => {
    setScheduleGroups((current) => current.map((group) => group.vanId === vanId ? { ...group, ...patch } : group));
    setScheduleGroupsMessage('');
    setScheduleGroupsError('');
  };

  const saveScheduleGroup = async (vanId: string) => {
    const group = scheduleGroupByVan.get(vanId);
    if (!group || !canManageScheduleGroups) return;
    setSavingVanId(vanId);
    setScheduleGroupsMessage('');
    setScheduleGroupsError('');
    try {
      const result = await saveVanScheduleGroupSetting({
        vanId,
        groupName: group.groupName,
        groupJid: group.groupJid.trim(),
        enabled: group.enabled,
      });
      setScheduleGroups(result.groups);
      setScheduleGroupsMessage(`${vanId.replace('VAN-', 'Van ')} WhatsApp schedule group saved.`);
      await refresh();
    } catch (cause) {
      setScheduleGroupsError(cause instanceof Error ? cause.message : 'Van WhatsApp schedule settings could not be saved.');
    } finally {
      setSavingVanId('');
    }
  };

  const refreshAll = async () => {
    await Promise.all([refresh(), loadScheduleGroups()]);
  };

  return <div className="fa-stack">
    <section className="page-head"><div><div className="eyebrow">Mobile Warehouses · Canonical Fleet</div><h1>Vans & Readiness</h1><p>Live Van profiles, regular crews, weekly half-day rules and WhatsApp schedule delivery settings from the same canonical fleet records used by Booking Authority.</p></div><div className="page-actions"><button className="btn" type="button" onClick={() => void refreshAll()} disabled={loading || scheduleGroupsLoading}>{loading || scheduleGroupsLoading ? 'Refreshing…' : 'Refresh Live Data'}</button></div></section>
    {error ? <section className="panel"><strong>Unable to load canonical fleet</strong><p>{error}</p></section> : null}
    {scheduleGroupsError ? <section className="panel"><strong>WhatsApp schedule configuration</strong><p>{scheduleGroupsError}</p></section> : null}
    {scheduleGroupsMessage ? <section className="panel"><strong>{scheduleGroupsMessage}</strong></section> : null}
    <section className="fa-metrics"><article><span>Canonical Vans</span><strong>{canonicalVans.length} / 4</strong><small className="fa-good">physical fleet lanes</small></article><article><span>Operational Profiles</span><strong>{available}</strong><small>not maintenance / out of service</small></article><article><span>WhatsApp Groups</span><strong>{canManageScheduleGroups ? `${configuredGroups} / ${canonicalVans.length || 4}` : '—'}</strong><small>automatic Van schedule delivery</small></article><article><span>Date Evaluated</span><strong>{today.slice(5)}</strong><small>America/Aruba</small></article></section>
    <section className="fa-van-grid">{canonicalVans.map((van) => {
      const vanId = state ? canonicalVanId(van.id, state.vans) : van.id;
      const crew = state ? resolveCanonicalCrew(van, today, state) : null;
      const halfDay = state?.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
      const blocked = ['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(crew?.daily?.status || van.status || '');
      const group = scheduleGroupByVan.get(vanId);
      return <article className="panel fa-van-card" key={vanId}>
        <div className="fa-van-head"><div><span>{van.plate || 'Fleet profile'}</span><h2>{van.name || vanId}</h2><p>{staffDisplayName(crew?.driver)}{crew?.helper ? ` + ${staffDisplayName(crew.helper)}` : ''}</p></div><b className={blocked ? 'risk' : ''}>{crew?.daily?.status || van.status || 'Disponible'}</b></div>
        <div className="fa-van-context"><div><span>Canonical ID</span><strong>{vanId}</strong></div><div><span>Crew source</span><strong>{crew?.daily ? 'Daily override' : 'Van profile'}</strong></div></div>
        <div className="fa-van-alert"><span>Weekly half-day</span><strong>{halfDay ? weekdayLabel(halfDay.weekday) : 'Not configured'}</strong></div>
        <div className="fa-van-alert"><span>Regular driver / helper</span><strong>{staffDisplayName(crew?.driver)} · {staffDisplayName(crew?.helper)}</strong></div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div><strong style={{ display: 'block', fontSize: 12 }}>WhatsApp Schedule Group</strong><span style={{ display: 'block', marginTop: 2, color: 'var(--muted)', fontSize: 10 }}>Used automatically for this Van's daily Work Order messages.</span></div>
            <b className={group?.configured && group.enabled ? '' : 'risk'}>{scheduleGroupsLoading ? 'Loading…' : group?.configured && group.enabled ? 'Configured' : 'Not configured'}</b>
          </div>
          {canManageScheduleGroups ? <>
            <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 10, color: 'var(--muted)' }}>Group name</span><input value={group?.groupName ?? ''} onChange={(event) => updateScheduleGroup(vanId, { groupName: event.target.value })} disabled={!group || savingVanId === vanId} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 10, color: 'var(--muted)' }}>WhatsApp Group JID</span><input value={group?.groupJid ?? ''} onChange={(event) => updateScheduleGroup(vanId, { groupJid: event.target.value, configured: Boolean(event.target.value.trim()) })} placeholder="…@g.us" autoCapitalize="none" autoCorrect="off" disabled={!group || savingVanId === vanId} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} /></label>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}><input type="checkbox" checked={group?.enabled ?? true} onChange={(event) => updateScheduleGroup(vanId, { enabled: event.target.checked })} disabled={!group || savingVanId === vanId} /> Automatic schedule delivery active</label>
              <button className="btn" type="button" onClick={() => void saveScheduleGroup(vanId)} disabled={!group || savingVanId === vanId}>{savingVanId === vanId ? 'Saving…' : 'Save Group'}</button>
            </div>
          </> : <div className="fa-callout"><strong>{group?.configured ? 'Configured' : 'Managed by Scheduling administrators'}</strong><p>WhatsApp group IDs can only be changed by users with Scheduling management access.</p></div>}
        </div>
      </article>;
    })}</section>
    <section className="fa-two-col"><article className="panel"><header className="panel-head"><div><h2>Canonical Capacity Rules</h2><span>Automatic booking</span></div></header><div className="fa-rules"><div><strong>Crew</strong><span>Driver/helper resolve from vans, then dailyVanAssignments.</span></div><div><strong>Availability</strong><span>staffAbsences and staff availability can block automatic assignment.</span></div><div><strong>Half-day</strong><span>vanHalfDaySchedules affects automatic booking capacity.</span></div></div></article><article className="panel"><header className="panel-head"><div><h2>Van Communication</h2><span>One configuration per canonical Van</span></div></header><div className="fa-callout"><strong>The Van record owns its WhatsApp group</strong><p>Scheduling reads the same canonical Van configuration for automatic daily delivery. There is no separate group-mapping screen or duplicate configuration.</p></div></article></section>
  </div>;
}
