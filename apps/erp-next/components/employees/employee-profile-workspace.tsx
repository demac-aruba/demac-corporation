'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  activeStaffAbsence,
  canonicalVanId,
  loadCanonicalOperationsState,
  staffDisplayName,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import { saveCanonicalStaffAbsence, saveCanonicalStaffProfile } from '@/lib/canonical-operations-mutations';
import { offboardEmployee, reactivateEmployee } from '@/lib/employee-lifecycle';
import {
  createManagedUser,
  listManagedUsers,
  sendPasswordSetupEmail,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
} from '@/lib/firebase/user-admin';

const EMPLOYEE_TYPES = ['Técnico', 'Secretaria', 'Administración', 'Otro'] as const;
const TECHNICAL_ROLES = ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'];
const OFFICE_ROLES = ['Secretaria', 'Administración', 'Contabilidad', 'Almacén', 'Otro'];
const ACCESS_ROLES: Array<{ value: ManagedUserRole; label: string }> = [
  { value: 'admin', label: 'Administrator' },
  { value: 'office', label: 'Office / Scheduling' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'technician', label: 'Technician' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'inventory', label: 'Inventory' },
];
const ABSENCE_REASONS = [
  { value: 'Vacaciones', label: 'Vacation' },
  { value: 'Enfermo', label: 'Sick / AO' },
  { value: 'Libre', label: 'Day Off' },
  { value: 'Otro', label: 'Other / unavailable' },
] as const;

type LoginEmailKind = 'company' | 'personal';
type DirectoryMode = 'active' | 'former';

type LifecycleProfile = CanonicalStaffProfile & {
  loginEmail?: string;
  loginEmailKind?: LoginEmailKind;
  formerLoginEmails?: string[];
  employmentStartedAt?: string;
  employmentEndedAt?: string;
  offboardingReason?: string;
  offboardingCleanupPending?: boolean;
};

type EmployeeDraft = {
  id: string;
  name: string;
  phone: string;
  contactEmail: string;
  employeeType: string;
  role: string;
  canDriveVan: boolean;
  skillsText: string;
  notes: string;
  employmentStartedAt: string;
  createAccess: boolean;
  accessRole: ManagedUserRole;
  accessActive: boolean;
  loginEmail: string;
  loginEmailKind: LoginEmailKind;
};

type OffboardDraft = {
  profile: LifecycleProfile;
  endDate: string;
  reason: string;
  releaseLoginEmail: boolean;
};

type TimeOffDraft = {
  fromDate: string;
  toDate: string;
  reason: string;
  notes: string;
};

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function rolesForType(employeeType: string) {
  return employeeType === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES;
}

function defaultRole(employeeType: string) {
  if (employeeType === 'Técnico') return 'Ayudante';
  if (employeeType === 'Secretaria') return 'Secretaria';
  if (employeeType === 'Administración') return 'Administración';
  return 'Otro';
}

function defaultAccessRole(employeeType: string): ManagedUserRole {
  return employeeType === 'Técnico' ? 'technician' : 'office';
}

function defaultLoginEmailKind(employeeType: string): LoginEmailKind {
  return employeeType === 'Técnico' ? 'personal' : 'company';
}

function inferredEmployeeType(profile: CanonicalStaffProfile) {
  if (profile.employeeType) return profile.employeeType;
  if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '')) return 'Técnico';
  if (profile.role === 'Secretaria') return 'Secretaria';
  return 'Administración';
}

function newEmployeeDraft(): EmployeeDraft {
  return {
    id: `staff-${crypto.randomUUID()}`,
    name: '',
    phone: '',
    contactEmail: '',
    employeeType: 'Secretaria',
    role: 'Secretaria',
    canDriveVan: false,
    skillsText: '',
    notes: '',
    employmentStartedAt: todayKey(),
    createAccess: true,
    accessRole: 'office',
    accessActive: true,
    loginEmail: '',
    loginEmailKind: 'company',
  };
}

function draftFromProfile(profile: LifecycleProfile, linkedUser?: ManagedUser): EmployeeDraft {
  const employeeType = inferredEmployeeType(profile);
  return {
    id: profile.id,
    name: profile.name ?? '',
    phone: profile.phone ?? '',
    contactEmail: profile.email ?? '',
    employeeType,
    role: profile.role ?? defaultRole(employeeType),
    canDriveVan: profile.canDriveVan === true,
    skillsText: (profile.skills ?? []).join(', '),
    notes: profile.notes ?? '',
    employmentStartedAt: profile.employmentStartedAt ?? '',
    createAccess: Boolean(linkedUser),
    accessRole: linkedUser?.role ?? defaultAccessRole(employeeType),
    accessActive: linkedUser?.active ?? true,
    loginEmail: linkedUser?.email ?? profile.loginEmail ?? '',
    loginEmailKind: profile.loginEmailKind ?? defaultLoginEmailKind(employeeType),
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function EmployeeProfileWorkspace() {
  const { principal } = useAuth();
  const canManageEmployees = principal.capabilities.has('employees.manage');
  const canManageAccess = principal.role === 'super_admin';
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<EmployeeDraft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>('active');
  const [offboardDraft, setOffboardDraft] = useState<OffboardDraft | null>(null);
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft>({ fromDate: todayKey(), toDate: todayKey(), reason: 'Vacaciones', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [operations, managedUsers] = await Promise.all([
        loadCanonicalOperationsState(),
        canManageAccess ? listManagedUsers() : Promise.resolve([]),
      ]);
      setState(operations);
      setUsers(managedUsers);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [canManageAccess]);

  useEffect(() => { void load(); }, [load]);

  const userByStaffId = useMemo(() => new Map(users.filter((user) => user.staffId).map((user) => [String(user.staffId), user])), [users]);
  const userByEmail = useMemo(() => new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user])), [users]);
  const today = todayKey();
  const profiles = (state?.staffProfiles ?? []) as LifecycleProfile[];
  const activeProfiles = profiles.filter((profile) => profile.active !== false);
  const formerProfiles = profiles.filter((profile) => profile.active === false);
  const visibleProfiles = directoryMode === 'active' ? activeProfiles : formerProfiles;

  const physicalVans = useMemo(() => {
    if (!state) return [];
    const byId = new Map<string, (typeof state.vans)[number]>();
    state.vans.forEach((van) => {
      const id = canonicalVanId(van.id, state.vans);
      const current = byId.get(id);
      if (!current || van.id === id) byId.set(id, van);
    });
    return [...byId.values()].sort((a, b) => canonicalVanId(a.id, state.vans).localeCompare(canonicalVanId(b.id, state.vans)));
  }, [state]);

  function mainVan(profile: CanonicalStaffProfile) {
    if (!state) return null;
    return physicalVans.find((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id) ?? null;
  }

  function openNew() {
    setIsNew(true);
    setDraft(newEmployeeDraft());
    setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setMessage('');
    setError('');
  }

  function openProfile(profile: LifecycleProfile) {
    setIsNew(false);
    setDraft(draftFromProfile(profile, userByStaffId.get(profile.id)));
    setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setMessage('');
    setError('');
  }

  function changeEmployeeType(employeeType: string) {
    setDraft((current) => {
      if (!current) return current;
      const allowedRoles = rolesForType(employeeType);
      return {
        ...current,
        employeeType,
        role: allowedRoles.includes(current.role) ? current.role : defaultRole(employeeType),
        canDriveVan: employeeType === 'Técnico' ? current.canDriveVan : false,
        skillsText: employeeType === 'Técnico' ? current.skillsText : '',
        accessRole: isNew ? defaultAccessRole(employeeType) : current.accessRole,
        loginEmailKind: isNew ? defaultLoginEmailKind(employeeType) : current.loginEmailKind,
      };
    });
  }

  async function saveEmployee() {
    if (!draft || !state) return;
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const contactEmail = draft.contactEmail.trim().toLowerCase();
    const loginEmail = draft.loginEmail.trim().toLowerCase();
    if (!name) return setError('Full name is required.');
    if (!phone) return setError('Phone number is required.');
    if (draft.createAccess && canManageAccess && !loginEmail) return setError('ERP login email is required when system access is enabled.');

    const duplicate = state.staffProfiles.find((profile) => profile.id !== draft.id && (
      normalizeName(profile.name ?? '') === normalizeName(name)
      || (normalizePhone(phone) && normalizePhone(profile.phone ?? '') === normalizePhone(phone))
    ));
    if (duplicate) return setError(`A master employee profile already exists for ${staffDisplayName(duplicate)}.`);

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const currentProfile = profiles.find((profile) => profile.id === draft.id);
      const profile: LifecycleProfile = {
        ...currentProfile,
        id: draft.id,
        name,
        phone,
        email: contactEmail || undefined,
        employeeType: draft.employeeType,
        role: draft.role,
        canDriveVan: draft.employeeType === 'Técnico' ? draft.canDriveVan : false,
        skills: draft.employeeType === 'Técnico' ? draft.skillsText.split(',').map((item) => item.trim()).filter(Boolean) : [],
        availability: currentProfile?.active === false ? 'Inactivo' : 'Disponible',
        active: currentProfile?.active !== false,
        notes: draft.notes.trim() || undefined,
        employmentStartedAt: draft.employmentStartedAt || currentProfile?.employmentStartedAt,
        loginEmailKind: draft.createAccess ? draft.loginEmailKind : currentProfile?.loginEmailKind,
      };
      await saveCanonicalStaffProfile(profile);

      let accessMessage = '';
      if (canManageAccess && profile.active !== false && draft.createAccess) {
        const linked = userByStaffId.get(draft.id) ?? userByEmail.get(loginEmail);
        if (linked) {
          if (linked.staffId && linked.staffId !== draft.id) {
            throw new Error(`The login email ${loginEmail} is still assigned to another active employee. Offboard that employee and release the company login first.`);
          }
          const loginEmailChanged = linked.email.trim().toLowerCase() !== loginEmail;
          await updateManagedUser({ uid: linked.uid, name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: draft.id });
          if (loginEmailChanged) {
            try {
              await sendPasswordSetupEmail(loginEmail);
              accessMessage = ' ERP login email was changed and a new password setup email was sent.';
            } catch {
              accessMessage = ' ERP login email was changed, but the password setup email could not be sent automatically. Use Send / Reset Password Email in the employee profile.';
            }
          } else {
            accessMessage = ` ERP access is linked as ${draft.accessRole}.`;
          }
        } else {
          await createManagedUser({ name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: draft.id });
          try {
            await sendPasswordSetupEmail(loginEmail);
            accessMessage = ' ERP access was created and a password setup email was sent. The employee must choose a new password.';
          } catch {
            accessMessage = ' ERP access was created, but the password setup email could not be sent automatically. Use Send / Reset Password Email in the employee profile.';
          }
        }
      } else if (canManageAccess && profile.active !== false) {
        const linked = userByStaffId.get(draft.id);
        if (linked && linked.active) {
          await updateManagedUser({ uid: linked.uid, name, email: linked.email, phone: phone || undefined, role: linked.role, active: false, staffId: draft.id });
          accessMessage = ' Linked ERP sign-in access was disabled.';
        }
      }

      setDraft(null);
      setMessage(`${name} was saved.${accessMessage}`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function sendAccessEmail() {
    if (!draft || !canManageAccess) return;
    const linked = userByStaffId.get(draft.id);
    const email = linked?.email ?? draft.loginEmail.trim().toLowerCase();
    if (!linked || !email) return setError('Create or link the ERP sign-in account first, then send the password email.');
    setBusy(true);
    setError('');
    try {
      await sendPasswordSetupEmail(email);
      setMessage(`Password setup / reset email sent to ${email}.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function addTimeOff() {
    if (!draft || !state || isNew) return;
    if (!timeOffDraft.fromDate || !timeOffDraft.toDate || timeOffDraft.toDate < timeOffDraft.fromDate) return setError('Choose a valid time-off date range.');
    setBusy(true);
    setError('');
    try {
      await saveCanonicalStaffAbsence({
        id: `profile-${draft.id}-${crypto.randomUUID()}`,
        staffId: draft.id,
        fromDate: timeOffDraft.fromDate,
        toDate: timeOffDraft.toDate,
        reason: timeOffDraft.reason,
        notes: timeOffDraft.notes.trim() || undefined,
        active: true,
      });
      setMessage(`Time off saved for ${draft.name}: ${timeOffDraft.fromDate} to ${timeOffDraft.toDate}.`);
      setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function startOffboard(profile: LifecycleProfile) {
    const linked = userByStaffId.get(profile.id);
    const kind = profile.loginEmailKind ?? defaultLoginEmailKind(inferredEmployeeType(profile));
    setDraft(null);
    setOffboardDraft({ profile, endDate: today, reason: '', releaseLoginEmail: Boolean(linked) && kind === 'company' });
    setError('');
    setMessage('');
  }

  async function confirmOffboard() {
    if (!offboardDraft) return;
    if (!offboardDraft.reason.trim()) return setError('Enter a short offboarding reason for the audit history.');
    setBusy(true);
    setError('');
    try {
      const result = await offboardEmployee({ staffId: offboardDraft.profile.id, endDate: offboardDraft.endDate, reason: offboardDraft.reason.trim(), releaseLoginEmail: offboardDraft.releaseLoginEmail });
      setOffboardDraft(null);
      setDirectoryMode('former');
      setMessage(`${result.employeeName} was moved to Former Employees.${result.releasedLoginEmail ? ` ${result.releasedLoginEmail} is now free to assign to a replacement employee.` : ''}${result.cleanupWarning ? ` ${result.cleanupWarning}` : ''}`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReactivate(profile: LifecycleProfile) {
    if (!canManageAccess) return setError('Only the owner / administrator can reactivate a former employee.');
    if (!window.confirm(`Reactivate ${staffDisplayName(profile)}? ERP login access and van assignments will NOT be restored automatically.`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await reactivateEmployee(profile.id);
      setDraft(null);
      setDirectoryMode('active');
      setMessage(`${result.employeeName} is active again. Assign ERP access and van responsibility explicitly if needed.`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) return <section className="panel" style={{ padding: 18 }}>Loading live employee registry…</section>;
  if (!state) return <section className="panel" style={{ padding: 18 }}><strong>Employee registry unavailable.</strong><div>{error}</div><button className="btn" type="button" onClick={() => void load()}>Retry</button></section>;

  const absentToday = activeProfiles.filter((profile) => Boolean(activeStaffAbsence(profile.id, today, state.staffAbsences))).length;
  const selectedProfile = draft ? profiles.find((profile) => profile.id === draft.id) : undefined;
  const selectedLinkedUser = draft ? userByStaffId.get(draft.id) : undefined;
  const selectedVan = selectedProfile ? mainVan(selectedProfile) : null;
  const selectedVanId = selectedVan ? canonicalVanId(selectedVan.id, state.vans) : '';
  const selectedHalfDay = selectedVanId ? state.vanHalfDaySchedules.find((rule) => canonicalVanId(rule.vanId, state.vans) === selectedVanId) : undefined;
  const selectedAbsences = selectedProfile ? state.staffAbsences.filter((absence) => absence.staffId === selectedProfile.id && absence.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))).slice(0, 5) : [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel">
        <header className="panel-head">
          <div><h2>Employees, Crews & Van Capacity</h2><span>Employee records, system identity, schedules, time off and lifecycle actions are managed from each employee profile.</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh live data'}</button>
            <button className="btn primary" type="button" onClick={openNew} disabled={!canManageEmployees}>Add Employee</button>
          </div>
        </header>
        {message ? <div style={styles.notice}><strong>{message}</strong></div> : null}
        {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
        <div style={styles.metrics}>
          <Metric label="Active Staff" value={String(activeProfiles.length)} detail="current workforce" />
          <Metric label="Former Staff" value={String(formerProfiles.length)} detail="retained history" />
          <Metric label="Canonical Vans" value={`${physicalVans.length}/4`} detail="authoritative crew membership" />
          <Metric label="Absent Today" value={String(absentToday)} detail={today} />
          <Metric label="Half-Day Rules" value={String(state.vanHalfDaySchedules.length)} detail="operational schedules" />
        </div>
      </section>

      <section className="panel" style={{ overflow: 'hidden' }}>
        <header className="panel-head">
          <div><h2>Employee Directory</h2><span>Destructive or sensitive actions are intentionally kept inside the employee profile, not in the directory.</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn${directoryMode === 'active' ? ' primary' : ''}`} type="button" onClick={() => setDirectoryMode('active')}>Active ({activeProfiles.length})</button>
            <button className={`btn${directoryMode === 'former' ? ' primary' : ''}`} type="button" onClick={() => setDirectoryMode('former')}>Former / Inactive ({formerProfiles.length})</button>
          </div>
        </header>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th>Employee</th><th>Main Van</th><th>Role / Skills</th><th>Availability</th><th>ERP Access</th>{directoryMode === 'former' ? <th>Ended</th> : null}<th>Profile</th></tr></thead>
            <tbody>
              {visibleProfiles.map((profile) => {
                const absence = activeStaffAbsence(profile.id, today, state.staffAbsences);
                const linkedUser = userByStaffId.get(profile.id);
                const van = mainVan(profile);
                const availability = directoryMode === 'former' ? 'Inactive' : absence?.reason ?? profile.availability ?? 'Disponible';
                return (
                  <tr key={profile.id}>
                    <td><strong>{staffDisplayName(profile)}</strong><small style={styles.small}>{profile.phone || profile.id}{profile.email ? ` · ${profile.email}` : ''}</small></td>
                    <td><strong>{directoryMode === 'former' ? 'ARCHIVED' : van ? canonicalVanId(van.id, state.vans) : 'UNASSIGNED'}</strong></td>
                    <td><div>{profile.role ?? 'Unassigned role'}</div>{profile.skills?.length ? <small style={styles.small}>{profile.skills.join(' · ')}</small> : null}</td>
                    <td>{availability}{profile.offboardingCleanupPending ? <small style={styles.warningText}>Assignment cleanup review required</small> : null}</td>
                    <td>{canManageAccess ? linkedUser ? `${linkedUser.active ? 'Active' : 'Disabled'} · ${linkedUser.role}` : directoryMode === 'former' ? 'Retired / unlinked' : 'No sign-in account' : 'Owner controlled'}</td>
                    {directoryMode === 'former' ? <td><strong>{profile.employmentEndedAt ?? '—'}</strong><small style={styles.small}>{profile.offboardingReason ?? ''}</small></td> : null}
                    <td><button className="btn" type="button" onClick={() => openProfile(profile)}>{canManageEmployees ? 'View / Edit' : 'View Profile'}</button></td>
                  </tr>
                );
              })}
              {!visibleProfiles.length ? <tr><td colSpan={directoryMode === 'former' ? 7 : 6} style={{ padding: 20, opacity: 0.7 }}>No employees in this list.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ overflow: 'hidden' }}>
        <header className="panel-head"><div><h2>Canonical Van Crews</h2><span>Only active employees belong here. Lifecycle changes never delete historical work records.</span></div></header>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th>Van</th><th>Driver</th><th>Regular Helper</th><th>Weekly Half-Day</th><th>Operational</th></tr></thead>
            <tbody>{physicalVans.map((van) => {
              const vanId = canonicalVanId(van.id, state.vans);
              const driver = state.staffProfiles.find((profile) => profile.id === van.responsibleStaffId && profile.active !== false);
              const helper = state.staffProfiles.find((profile) => profile.id === van.regularHelperId && profile.active !== false);
              const halfDay = state.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
              return <tr key={vanId}><td><strong>{van.name ?? vanId}</strong><small style={styles.small}>{vanId}{van.plate ? ` · ${van.plate}` : ''}</small></td><td><strong>{staffDisplayName(driver)}</strong></td><td><strong>{staffDisplayName(helper)}</strong></td><td><strong>{weekdayLabel(halfDay?.weekday)}</strong>{halfDay?.workdayEnd ? <small style={styles.small}>works until {halfDay.workdayEnd}</small> : null}</td><td>{van.status ?? 'Disponible'}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <div role="dialog" aria-modal="true" aria-label={isNew ? 'Add employee' : 'Employee profile'} style={styles.modalBackdrop}>
          <div className="panel" style={styles.modal}>
            <header className="panel-head">
              <div><div className="eyebrow">{isNew ? 'New Employee' : 'Employee Profile'}</div><h2>{isNew ? 'Add Employee' : draft.name}</h2><span>{isNew ? 'Create the master employee record and optional ERP access.' : `${selectedProfile?.role ?? 'Unassigned role'} · ${selectedProfile?.active === false ? 'Former employee' : 'Active employee'}`}</span></div>
              <button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Close</button>
            </header>

            {!isNew ? <div style={styles.profileSummary}>
              <Summary label="Main van" value={selectedVanId || 'Unassigned'} />
              <Summary label="Availability" value={selectedProfile?.active === false ? 'Inactive' : activeStaffAbsence(draft.id, today, state.staffAbsences)?.reason ?? selectedProfile?.availability ?? 'Disponible'} />
              <Summary label="ERP access" value={selectedLinkedUser ? `${selectedLinkedUser.active ? 'Active' : 'Disabled'} · ${selectedLinkedUser.role}` : 'No sign-in account'} />
              <Summary label="Employment" value={selectedProfile?.employmentStartedAt ? `Since ${selectedProfile.employmentStartedAt}` : 'Start date not recorded'} />
            </div> : null}

            <ProfileSection title="Personal & Employment Information" subtitle="Contact information is not the same thing as an ERP login credential.">
              <div style={styles.formGrid}>
                <Field label="Full name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canManageEmployees || selectedProfile?.active === false} /></Field>
                <Field label="Phone"><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} disabled={!canManageEmployees || selectedProfile?.active === false} /></Field>
                <Field label="Contact / personal email"><input type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} placeholder="Optional contact email" disabled={!canManageEmployees || selectedProfile?.active === false} /></Field>
                <Field label="Employment start date"><input type="date" value={draft.employmentStartedAt} onChange={(event) => setDraft({ ...draft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees || selectedProfile?.active === false} /></Field>
                <Field label="Employee type"><select value={draft.employeeType} onChange={(event) => changeEmployeeType(event.target.value)} disabled={!canManageEmployees || selectedProfile?.active === false}>{EMPLOYEE_TYPES.map((value) => <option key={value}>{value}</option>)}</select></Field>
                <Field label="Operational job role"><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} disabled={!canManageEmployees || selectedProfile?.active === false}>{rolesForType(draft.employeeType).map((value) => <option key={value}>{value}</option>)}</select></Field>
                {draft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select value={draft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setDraft({ ...draft, canDriveVan: event.target.value === 'yes' })} disabled={!canManageEmployees || selectedProfile?.active === false}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}
                {draft.employeeType === 'Técnico' ? <Field label="Skills"><input value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} placeholder="Service, installation, diagnostics…" disabled={!canManageEmployees || selectedProfile?.active === false} /></Field> : null}
                <Field label="Internal notes" wide><textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManageEmployees || selectedProfile?.active === false} /></Field>
              </div>
            </ProfileSection>

            <ProfileSection title="ERP Access & Login" subtitle="Changing a contact email above does not send an invitation. ERP access is controlled here.">
              {canManageAccess ? <>
                <div style={styles.formGrid}>
                  <Field label="ERP sign-in"><select value={draft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setDraft({ ...draft, createAccess: event.target.value === 'enabled' })} disabled={selectedProfile?.active === false}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>
                  {draft.createAccess ? <Field label="ERP login email"><input type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} placeholder="Email used to sign in" disabled={selectedProfile?.active === false} /></Field> : null}
                  {draft.createAccess ? <Field label="Login email ownership"><select value={draft.loginEmailKind} onChange={(event) => setDraft({ ...draft, loginEmailKind: event.target.value as LoginEmailKind })} disabled={selectedProfile?.active === false}><option value="company">Company email · reusable</option><option value="personal">Personal email · not reused</option></select></Field> : null}
                  {draft.createAccess ? <Field label="Access role"><select value={draft.accessRole} onChange={(event) => setDraft({ ...draft, accessRole: event.target.value as ManagedUserRole })} disabled={selectedProfile?.active === false}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
                  {draft.createAccess ? <Field label="Account status"><select value={draft.accessActive ? 'active' : 'disabled'} onChange={(event) => setDraft({ ...draft, accessActive: event.target.value === 'active' })} disabled={selectedProfile?.active === false}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}
                </div>
                {!isNew && selectedLinkedUser ? <div style={styles.inlineActions}><button className="btn" type="button" onClick={() => void sendAccessEmail()} disabled={busy}>Send / Reset Password Email</button><span>Use this to resend the Firebase password setup link at any time.</span></div> : null}
                <div style={styles.info}><strong>Invitation behavior</strong><span>If an existing employee has no sign-in account and you enable ERP access with a login email, the system creates the Firebase account and automatically sends a password setup email. If you change an existing user's ERP login email, it also sends a new setup email. Updating only Contact / personal email does not create or change login access.</span></div>
              </> : <div>Only the owner / administrator can create or change sign-in accounts.</div>}
            </ProfileSection>

            {!isNew ? <ProfileSection title="Work Schedule & Time Off" subtitle="Schedules remain canonical; time off is written to staffAbsences so Scheduling and Attendance see the same availability.">
              <div style={styles.scheduleGrid}>
                <Summary label="Weekday schedule" value="08:00–17:00 · lunch 12:00–13:00" />
                <Summary label="Saturday" value="09:00–13:00" />
                <Summary label="Weekly half-day" value={selectedHalfDay ? `${weekdayLabel(selectedHalfDay.weekday)} · until ${selectedHalfDay.workdayEnd ?? '13:00'} · ${selectedVanId}` : 'No canonical half-day assigned'} />
                <Summary label="Schedule source" value={selectedVanId ? `Van crew policy · ${selectedVanId}` : 'Company default / employee attendance settings'} />
              </div>
              {selectedProfile?.active !== false && canManageEmployees ? <div style={styles.timeOffBox}>
                <strong>Add time off / unavailability</strong>
                <div style={styles.formGrid}>
                  <Field label="From"><input type="date" value={timeOffDraft.fromDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, fromDate: event.target.value })} /></Field>
                  <Field label="To"><input type="date" value={timeOffDraft.toDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, toDate: event.target.value })} /></Field>
                  <Field label="Type"><select value={timeOffDraft.reason} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, reason: event.target.value })}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="Notes"><input value={timeOffDraft.notes} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, notes: event.target.value })} placeholder="Optional" /></Field>
                </div>
                <div style={styles.inlineActions}><button className="btn" type="button" onClick={() => void addTimeOff()} disabled={busy}>Save Time Off</button><Link className="btn" href="/employees/attendance">Open Attendance</Link><Link className="btn" href="/employees/payroll">Open Payroll</Link></div>
              </div> : null}
              {selectedAbsences.length ? <div style={styles.history}><strong>Recent / current time off</strong>{selectedAbsences.map((absence) => <div key={absence.id}><span>{absence.reason ?? 'Unavailable'}</span><span>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</span><small>{absence.notes ?? ''}</small></div>)}</div> : null}
            </ProfileSection> : null}

            {!isNew && selectedProfile ? <ProfileSection title="Employment Lifecycle" subtitle="Sensitive lifecycle actions live here deliberately, away from the employee list.">
              {selectedProfile.active !== false ? <div style={styles.dangerZone}><div><strong>Offboard employee</strong><span>Archives the employee, preserves work/payroll history, disables access and removes future crew assignments. Reusable company login emails can be released for the replacement employee.</span></div><button className="btn" type="button" onClick={() => startOffboard(selectedProfile)} disabled={!canManageAccess || busy}>Start Offboarding</button></div>
                : <div style={styles.dangerZone}><div><strong>Former employee</strong><span>{selectedProfile.employmentEndedAt ? `Employment ended ${selectedProfile.employmentEndedAt}. ` : ''}{selectedProfile.offboardingReason ?? ''} Reactivation does not restore old login access or van assignments automatically.</span></div><button className="btn" type="button" onClick={() => void confirmReactivate(selectedProfile)} disabled={!canManageAccess || busy}>Reactivate Employee</button></div>}
            </ProfileSection> : null}

            {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
            {(isNew || selectedProfile?.active !== false) && canManageEmployees ? <div style={styles.footerActions}><button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Cancel</button><button className="btn primary" type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Employee'}</button></div> : null}
          </div>
        </div>
      ) : null}

      {offboardDraft ? <div role="dialog" aria-modal="true" aria-label="Offboard employee" style={{ ...styles.modalBackdrop, zIndex: 1300 }}>
        <div className="panel" style={{ ...styles.modal, width: 'min(650px,100%)' }}>
          <header className="panel-head"><div><h2>Offboard {staffDisplayName(offboardDraft.profile)}</h2><span>Archive the employee safely; never delete work or payroll history.</span></div><button className="btn" type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Close</button></header>
          <div style={styles.formGrid}>
            <Field label="Last employment date"><input type="date" value={offboardDraft.endDate} onChange={(event) => setOffboardDraft({ ...offboardDraft, endDate: event.target.value })} /></Field>
            <Field label="Reason"><input value={offboardDraft.reason} onChange={(event) => setOffboardDraft({ ...offboardDraft, reason: event.target.value })} placeholder="Resigned, contract ended, terminated…" /></Field>
          </div>
          <label style={styles.checkCard}><input type="checkbox" checked={offboardDraft.releaseLoginEmail} onChange={(event) => setOffboardDraft({ ...offboardDraft, releaseLoginEmail: event.target.checked })} /><span><strong>Release ERP login email for reuse</strong><small>For fixed DEMAC office emails, the former Firebase identity is disabled and archived, sessions are revoked, and the original company email becomes available for the replacement employee's new identity.</small></span></label>
          <div style={styles.warning}><strong>This operation also removes regular van membership and future dated van assignments.</strong><span>Historical work orders, visits, attendance, payroll and audit records remain linked to the former employee.</span></div>
          {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
          <div style={styles.footerActions}><button className="btn" type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Cancel</button><button className="btn primary" type="button" onClick={() => void confirmOffboard()} disabled={busy}>{busy ? 'Offboarding…' : 'Confirm Offboarding'}</button></div>
        </div>
      </div> : null}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article style={styles.metric}><span style={{ opacity: 0.68 }}>{label}</span><strong style={{ fontSize: 24 }}>{value}</strong><small style={{ opacity: 0.64 }}>{detail}</small></article>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label style={{ ...styles.field, ...(wide ? { gridColumn: '1 / -1' } : {}) }}><strong>{label}</strong>{children}</label>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div style={styles.summary}><small>{label}</small><strong>{value}</strong></div>;
}

function ProfileSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section style={styles.profileSection}><div><h3 style={{ margin: 0 }}>{title}</h3><p style={{ margin: '4px 0 0', opacity: 0.68 }}>{subtitle}</p></div>{children}</section>;
}

const styles: Record<string, CSSProperties> = {
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', borderTop: '1px solid var(--line)' },
  metric: { display: 'grid', gap: 3, padding: 14, borderRight: '1px solid var(--line)' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 980 },
  small: { display: 'block', marginTop: 3, opacity: 0.62 },
  warningText: { display: 'block', marginTop: 4, fontWeight: 800 },
  notice: { margin: '12px 16px', padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  error: { marginTop: 12, padding: 12, border: '1px solid #dc6b6b', borderRadius: 12, background: 'rgba(220,107,107,.08)' },
  warning: { marginTop: 16, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'rgba(209,143,24,.08)', display: 'grid', gap: 5 },
  info: { marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 12, display: 'grid', gap: 5 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(2,10,23,.62)' },
  modal: { width: 'min(980px,100%)', maxHeight: '92vh', overflow: 'auto', padding: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginTop: 14 },
  field: { display: 'grid', gap: 6 },
  profileSummary: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 14 },
  summary: { display: 'grid', gap: 3, padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  profileSection: { marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)', display: 'grid', gap: 12 },
  scheduleGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 },
  timeOffBox: { padding: 14, border: '1px solid var(--line)', borderRadius: 12 },
  inlineActions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 },
  history: { display: 'grid', gap: 8, padding: 14, border: '1px solid var(--line)', borderRadius: 12 },
  dangerZone: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 14, border: '1px solid rgba(220,107,107,.55)', borderRadius: 12, background: 'rgba(220,107,107,.06)' },
  footerActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  checkCard: { marginTop: 18, padding: 14, border: '1px solid var(--line)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' },
};
