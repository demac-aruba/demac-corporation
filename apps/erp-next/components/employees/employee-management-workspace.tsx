'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { saveCanonicalStaffProfile } from '@/lib/canonical-operations-mutations';
import {
  createManagedUser,
  listManagedUsers,
  sendPasswordSetupEmail,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
} from '@/lib/firebase/user-admin';

const EMPLOYEE_TYPES = ['Técnico', 'Secretaria', 'Administración', 'Otro'] as const;
const AVAILABILITY = ['Disponible', 'Enfermo', 'Vacaciones', 'Libre', 'Inactivo'] as const;
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

type EmployeeDraft = {
  id: string;
  name: string;
  phone: string;
  email: string;
  employeeType: string;
  role: string;
  canDriveVan: boolean;
  skillsText: string;
  availability: string;
  active: boolean;
  notes: string;
  createAccess: boolean;
  accessRole: ManagedUserRole;
  accessActive: boolean;
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

function newEmployeeDraft(): EmployeeDraft {
  return {
    id: `staff-${crypto.randomUUID()}`,
    name: '',
    phone: '',
    email: '',
    employeeType: 'Secretaria',
    role: 'Secretaria',
    canDriveVan: false,
    skillsText: '',
    availability: 'Disponible',
    active: true,
    notes: '',
    createAccess: true,
    accessRole: 'office',
    accessActive: true,
  };
}

function draftFromProfile(profile: CanonicalStaffProfile, linkedUser?: ManagedUser): EmployeeDraft {
  const employeeType = profile.employeeType
    ?? (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '') ? 'Técnico'
      : profile.role === 'Secretaria' ? 'Secretaria' : 'Administración');
  return {
    id: profile.id,
    name: profile.name ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? linkedUser?.email ?? '',
    employeeType,
    role: profile.role ?? defaultRole(employeeType),
    canDriveVan: profile.canDriveVan === true,
    skillsText: (profile.skills ?? []).join(', '),
    availability: profile.availability ?? 'Disponible',
    active: profile.active !== false,
    notes: profile.notes ?? '',
    createAccess: Boolean(linkedUser),
    accessRole: linkedUser?.role ?? defaultAccessRole(employeeType),
    accessActive: linkedUser?.active ?? true,
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function EmployeeManagementWorkspace() {
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
    if (!state) return '';
    const canonical = physicalVans.find((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id);
    return canonical ? canonicalVanId(canonical.id, state.vans) : profile.primaryVanId ?? '';
  }

  function openNew() {
    setIsNew(true);
    setDraft(newEmployeeDraft());
    setMessage('');
    setError('');
  }

  function openEdit(profile: CanonicalStaffProfile) {
    setIsNew(false);
    setDraft(draftFromProfile(profile, userByStaffId.get(profile.id)));
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
      };
    });
  }

  async function saveEmployee() {
    if (!draft || !state) return;
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const email = draft.email.trim().toLowerCase();
    if (!name) return setError('Full name is required.');
    if (!phone) return setError('Phone number is required.');
    if (draft.createAccess && canManageAccess && !email) return setError('A sign-in email is required when ERP access is enabled.');

    const duplicate = state.staffProfiles.find((profile) => profile.id !== draft.id && (
      normalizeName(profile.name ?? '') === normalizeName(name)
      || (normalizePhone(phone) && normalizePhone(profile.phone ?? '') === normalizePhone(phone))
    ));
    if (duplicate) return setError(`A master employee profile already exists for ${staffDisplayName(duplicate)}.`);

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const profile: CanonicalStaffProfile = {
        id: draft.id,
        name,
        phone,
        email: email || undefined,
        employeeType: draft.employeeType,
        role: draft.role,
        canDriveVan: draft.employeeType === 'Técnico' ? draft.canDriveVan : false,
        skills: draft.employeeType === 'Técnico'
          ? draft.skillsText.split(',').map((item) => item.trim()).filter(Boolean)
          : [],
        availability: draft.active ? draft.availability : 'Inactivo',
        active: draft.active,
        notes: draft.notes.trim() || undefined,
      };
      await saveCanonicalStaffProfile(profile);

      let accessMessage = '';
      if (canManageAccess && draft.createAccess) {
        const linked = userByStaffId.get(draft.id) ?? userByEmail.get(email);
        if (linked) {
          await updateManagedUser({
            uid: linked.uid,
            name,
            email,
            phone,
            role: draft.accessRole,
            active: draft.accessActive,
            staffId: draft.id,
          });
          accessMessage = ` ERP access is linked as ${draft.accessRole}.`;
        } else {
          await createManagedUser({
            name,
            email,
            phone,
            role: draft.accessRole,
            active: draft.accessActive,
            staffId: draft.id,
          });
          try {
            await sendPasswordSetupEmail(email);
            accessMessage = ' ERP access was created and a password setup email was sent.';
          } catch {
            accessMessage = ' ERP access was created; the password setup email can be resent from Access Control.';
          }
        }
      } else if (canManageAccess) {
        const linked = userByStaffId.get(draft.id);
        if (linked && linked.active) {
          await updateManagedUser({
            uid: linked.uid,
            name,
            email: linked.email,
            phone: phone || undefined,
            role: linked.role,
            active: false,
            staffId: draft.id,
          });
          accessMessage = ' Linked ERP sign-in access was disabled.';
        }
      }

      setDraft(null);
      setMessage(`${name} was saved in the canonical employee registry.${accessMessage}`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) return <section className="panel" style={{ padding: 18 }}>Loading live employee registry…</section>;
  if (!state) return <section className="panel" style={{ padding: 18 }}><strong>Employee registry unavailable.</strong><div>{error}</div><button className="btn" type="button" onClick={() => void load()}>Retry</button></section>;

  const activeStaff = state.staffProfiles.filter((profile) => profile.active !== false).length;
  const absentToday = state.staffProfiles.filter((profile) => Boolean(activeStaffAbsence(profile.id, today, state.staffAbsences))).length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel">
        <header className="panel-head">
          <div><h2>Employees, Crews & Van Capacity</h2><span>Canonical Firestore workforce. Operational profile and system access are separate responsibilities.</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh live data'}</button>
            <button className="btn primary" type="button" onClick={openNew} disabled={!canManageEmployees}>Add Employee</button>
          </div>
        </header>
        {message ? <div style={styles.notice}><strong>{message}</strong></div> : null}
        {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
        <div style={styles.metrics}>
          <Metric label="Active Staff" value={String(activeStaff)} detail="staffProfiles" />
          <Metric label="Canonical Vans" value={`${physicalVans.length}/4`} detail="authoritative crew membership" />
          <Metric label="Absent Today" value={String(absentToday)} detail={today} />
          <Metric label="Half-Day Rules" value={String(state.vanHalfDaySchedules.length)} detail="vanHalfDaySchedules" />
        </div>
      </section>

      <section className="panel" style={{ overflow: 'hidden' }}>
        <header className="panel-head"><div><h2>Employee Directory</h2><span>Click an employee to edit the master profile, job role and owner-controlled ERP access.</span></div><b>{state.staffProfiles.length} profiles</b></header>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th>Employee</th><th>Main Van</th><th>Role / Skills</th><th>Availability</th><th>ERP Access</th><th>Status</th></tr></thead>
            <tbody>
              {state.staffProfiles.map((profile) => {
                const absence = activeStaffAbsence(profile.id, today, state.staffAbsences);
                const linkedUser = userByStaffId.get(profile.id);
                const availability = absence?.reason ?? profile.availability ?? 'Disponible';
                return (
                  <tr key={profile.id} onClick={() => canManageEmployees && openEdit(profile)} style={{ cursor: canManageEmployees ? 'pointer' : 'default' }}>
                    <td><strong>{staffDisplayName(profile)}</strong><small style={styles.small}>{profile.id}{profile.phone ? ` · ${profile.phone}` : ''}</small></td>
                    <td><strong>{mainVan(profile) || 'UNASSIGNED'}</strong></td>
                    <td><div>{profile.role ?? 'Unassigned role'}</div>{profile.skills?.length ? <small style={styles.small}>{profile.skills.join(' · ')}</small> : null}</td>
                    <td>{availability}</td>
                    <td>{canManageAccess ? linkedUser ? `${linkedUser.active ? 'Active' : 'Disabled'} · ${linkedUser.role}` : 'No sign-in account' : 'Owner controlled'}</td>
                    <td>{profile.active === false ? 'Inactive' : 'Active'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ overflow: 'hidden' }}>
        <header className="panel-head"><div><h2>Canonical Van Crews</h2><span>Van crew membership remains the source of truth; staffProfiles.primaryVanId is only a compatibility hint.</span></div></header>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th>Van</th><th>Driver</th><th>Regular / Daily Helper</th><th>Weekly Half-Day</th><th>Operational</th></tr></thead>
            <tbody>
              {physicalVans.map((van) => {
                const vanId = canonicalVanId(van.id, state.vans);
                const driver = state.staffProfiles.find((profile) => profile.id === van.responsibleStaffId);
                const helper = state.staffProfiles.find((profile) => profile.id === van.regularHelperId);
                const halfDay = state.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
                return <tr key={vanId}><td><strong>{van.name ?? vanId}</strong><small style={styles.small}>{vanId}{van.plate ? ` · ${van.plate}` : ''}</small></td><td><strong>{staffDisplayName(driver)}</strong></td><td><strong>{staffDisplayName(helper)}</strong></td><td><strong>{weekdayLabel(halfDay?.weekday)}</strong>{halfDay?.workdayEnd ? <small style={styles.small}>works until {halfDay.workdayEnd}</small> : null}</td><td>{van.status ?? 'Disponible'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <div role="dialog" aria-modal="true" aria-label={isNew ? 'Add employee' : 'Edit employee'} style={styles.modalBackdrop}>
          <div className="panel" style={styles.modal}>
            <header className="panel-head"><div><h2>{isNew ? 'Add Employee' : `Edit ${draft.name}`}</h2><span>One master employee record for scheduling, vans, availability and attendance.</span></div><button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Close</button></header>
            <div style={styles.formGrid}>
              <Field label="Full name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus /></Field>
              <Field label="Phone"><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></Field>
              <Field label="Email"><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field>
              <Field label="Employee type"><select value={draft.employeeType} onChange={(event) => changeEmployeeType(event.target.value)}>{EMPLOYEE_TYPES.map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Operational job role"><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>{rolesForType(draft.employeeType).map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Availability"><select value={draft.availability} onChange={(event) => setDraft({ ...draft, availability: event.target.value, active: event.target.value !== 'Inactivo' })}>{AVAILABILITY.map((value) => <option key={value}>{value}</option>)}</select></Field>
              {draft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select value={draft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setDraft({ ...draft, canDriveVan: event.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}
              {draft.employeeType === 'Técnico' ? <Field label="Skills"><input value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} placeholder="Service, installation, diagnostics…" /></Field> : null}
              <Field label="Employment status"><select value={draft.active ? 'active' : 'inactive'} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'active', availability: event.target.value === 'active' && draft.availability === 'Inactivo' ? 'Disponible' : draft.availability })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
              <Field label="Internal notes" wide><textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
            </div>

            <section style={styles.accessCard}>
              <strong>System Access</strong>
              <p style={{ margin: '5px 0 12px', opacity: 0.75 }}>Job role and ERP permissions are intentionally separate. A secretary who schedules should normally use the <b>Office / Scheduling</b> access role.</p>
              {canManageAccess ? (
                <div style={styles.formGrid}>
                  <Field label="ERP sign-in"><select value={draft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setDraft({ ...draft, createAccess: event.target.value === 'enabled' })}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>
                  {draft.createAccess ? <Field label="Access role"><select value={draft.accessRole} onChange={(event) => setDraft({ ...draft, accessRole: event.target.value as ManagedUserRole })}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
                  {draft.createAccess ? <Field label="Account status"><select value={draft.accessActive ? 'active' : 'disabled'} onChange={(event) => setDraft({ ...draft, accessActive: event.target.value === 'active' })}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}
                </div>
              ) : <div>Only the owner / administrator can create or change sign-in accounts.</div>}
            </section>

            {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}><button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Cancel</button><button className="btn primary" type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Employee'}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article style={styles.metric}><span style={{ opacity: 0.68 }}>{label}</span><strong style={{ fontSize: 24 }}>{value}</strong><small style={{ opacity: 0.64 }}>{detail}</small></article>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label style={{ ...styles.field, ...(wide ? { gridColumn: '1 / -1' } : {}) }}><strong>{label}</strong>{children}</label>;
}

const styles: Record<string, CSSProperties> = {
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', borderTop: '1px solid var(--line)' },
  metric: { display: 'grid', gap: 3, padding: 14, borderRight: '1px solid var(--line)' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  small: { display: 'block', marginTop: 3, opacity: 0.62 },
  notice: { margin: '12px 16px', padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  error: { marginTop: 12, padding: 12, border: '1px solid #dc6b6b', borderRadius: 12, background: 'rgba(220,107,107,.08)' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(2,10,23,.62)' },
  modal: { width: 'min(880px,100%)', maxHeight: '92vh', overflow: 'auto', padding: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginTop: 16 },
  field: { display: 'grid', gap: 6 },
  accessCard: { marginTop: 18, padding: 16, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-subtle, rgba(127,127,127,.05))' },
};
