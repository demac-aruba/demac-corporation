'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  activeStaffAbsence,
  canonicalVanId,
  loadCanonicalOperationsState,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';

function arubaDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Aruba',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fieldEmployee(profile: CanonicalStaffProfile) {
  return profile.employeeType === 'Técnico' || /t[eé]cnico|ayudante|supervisor/i.test(profile.role ?? '');
}

export function CanonicalTechniciansPanel() {
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const today = arubaDateKey();

  async function refresh() {
    setLoading(true); setError('');
    try { setState(await loadCanonicalOperationsState()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const fieldStaff = useMemo(() => (state?.staffProfiles ?? []).filter((profile) => profile.active !== false && fieldEmployee(profile)), [state]);
  const assignmentByStaff = useMemo(() => {
    const result = new Map<string, Array<{ vanId: string; role: string }>>();
    if (!state) return result;
    for (const van of state.vans) {
      const vanId = canonicalVanId(van.id, state.vans);
      const entries = [
        { id: van.responsibleStaffId, role: 'Responsible Technician / Driver' },
        { id: van.regularHelperId, role: 'Regular Helper' },
        { id: van.additionalHelperId, role: 'Third Helper' },
      ];
      for (const entry of entries) {
        if (!entry.id) continue;
        const list = result.get(entry.id) ?? [];
        list.push({ vanId, role: entry.role });
        result.set(entry.id, list);
      }
    }
    return result;
  }, [state]);

  const drivers = fieldStaff.filter((profile) => profile.canDriveVan === true).length;
  const helpers = fieldStaff.filter((profile) => (assignmentByStaff.get(profile.id) ?? []).some((entry) => entry.role.includes('Helper')) || /ayudante|helper/i.test(profile.role ?? '')).length;
  const unavailable = fieldStaff.filter((profile) => Boolean(
    (profile.availability && profile.availability !== 'Disponible')
      || activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []),
  )).length;

  return <div className="fa-stack">
    <section className="page-head"><div><div className="eyebrow">Field Workforce · Canonical</div><h1>Technicians</h1><p>Technician and helper Van assignments are derived from the same canonical Van crew profiles used by Scheduling. Employee profiles do not own a second Van assignment.</p></div><div className="page-actions"><button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh Live Data'}</button></div></section>
    {error ? <section className="panel"><strong>Unable to load canonical workforce</strong><p>{error}</p></section> : null}
    <section className="fa-metrics"><article><span>Active Field Staff</span><strong>{fieldStaff.length}</strong><small className="fa-good">Firestore staffProfiles</small></article><article><span>Authorized Drivers</span><strong>{drivers}</strong><small>canDriveVan</small></article><article><span>Helpers / Support</span><strong>{helpers}</strong><small>Regular + third helper roles</small></article><article><span>Unavailable Today</span><strong>{unavailable}</strong><small>{today}</small></article></section>
    <section className="panel fa-table-panel"><header className="panel-head"><div><h2>Canonical Technician & Helper Roster</h2><span>Van assignment derives from the Van profile</span></div><span>LIVE</span></header><div className="fa-table fa-tech-table"><div className="fa-row fa-head"><span>Employee / Role</span><span>Regular Van</span><span>Skills</span><span>Availability</span><span>Driver</span><span>Source</span></div>{fieldStaff.map((profile) => {
      const absence = activeStaffAbsence(profile.id, today, state?.staffAbsences ?? []);
      const assignments = assignmentByStaff.get(profile.id) ?? [];
      return <div className="fa-row" key={profile.id}><div><strong>{staffDisplayName(profile)}</strong><small>{profile.role || 'Role not configured'}</small></div><div><strong>{assignments.length ? assignments.map((entry) => entry.vanId).join(' · ') : 'UNASSIGNED'}</strong><small>{assignments.length ? assignments.map((entry) => entry.role).join(' · ') : 'Assign from Vans'}</small></div><div className="fa-tags">{(profile.skills ?? []).length ? (profile.skills ?? []).map((skill) => <b key={`${profile.id}-${skill}`}>{skill}</b>) : <span>No skills recorded</span>}</div><div><strong>{absence?.reason || profile.availability || 'Disponible'}</strong><small>{absence ? `${absence.fromDate || ''} → ${absence.toDate || ''}` : 'Current profile state'}</small></div><strong>{profile.canDriveVan ? 'Yes' : 'No'}</strong><span>vans</span></div>;
    })}</div></section>
    <section className="fa-two-col"><article className="panel"><header className="panel-head"><div><h2>Crew Authority</h2><span>One assignment process</span></div></header><div className="fa-rules"><div><strong>Regular crew</strong><span>Responsible technician, helper and optional third helper are assigned from Vans.</span></div><div><strong>Daily override</strong><span>Temporary date-specific changes use dailyVanAssignments.</span></div><div><strong>Employee profile</strong><span>May display the assignment, but does not create another crew authority.</span></div></div></article><article className="panel"><header className="panel-head"><div><h2>Availability</h2><span>Same operational evidence</span></div></header><div className="fa-callout"><strong>Absences still win</strong><p>staffAbsences and inactive availability can remove a crew member from date-aware operational resolution without changing the person's regular Van assignment.</p></div></article></section>
  </div>;
}
