'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  activeStaffAbsence,
  canonicalVanId,
  staffDisplayName,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import { saveCanonicalStaffAbsence, saveCanonicalStaffProfile } from '@/lib/canonical-operations-mutations';
import { offboardEmployee, reactivateEmployee } from '@/lib/employee-lifecycle';
import { employeeVan } from '@/lib/employee-work-schedule';
import {
  createManagedUser,
  listManagedUsers,
  sendPasswordSetupEmail,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
} from '@/lib/firebase/user-admin';
import styles from './employee-directory-overview.module.css';

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
const WEEKLY_DAY_OFF_OPTIONS = [
  { value: '', label: 'Not assigned' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
] as const;

type LoginEmailKind = 'company' | 'personal';
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
  weeklyDayOffWeekday: string;
  weeklyDayOffEffectiveFrom: string;
  createAccess: boolean;
  accessRole: ManagedUserRole;
  accessActive: boolean;
  loginEmail: string;
  loginEmailKind: LoginEmailKind;
};
type TimeOffDraft = { fromDate: string; toDate: string; reason: string; notes: string };
type OffboardDraft = { endDate: string; reason: string; releaseLoginEmail: boolean };

export function EmployeeProfileEditor({
  open,
  employee,
  operations,
  onClose,
  onChanged,
}: {
  open: boolean;
  employee: CanonicalStaffProfile | null;
  operations: CanonicalOperationsState;
  onClose: () => void;
  onChanged: (employeeId?: string) => Promise<void> | void;
}) {
  const { principal } = useAuth();
  const canManageEmployees = principal.capabilities.has('employees.manage');
  const canManageAccess = principal.role === 'super_admin';
  const today = todayKey();
  const isNew = employee === null;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [draft, setDraft] = useState<EmployeeDraft>(() => newEmployeeDraft());
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft>({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
  const [offboardDraft, setOffboardDraft] = useState<OffboardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(employee ? draftFromProfile(employee as LifecycleProfile) : newEmployeeDraft());
    setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setOffboardDraft(null);
    setError('');
    setMessage('');
    if (canManageAccess) {
      void listManagedUsers().then(setUsers).catch((cause) => setError(`ERP access information could not be loaded: ${errorText(cause)}`));
    } else {
      setUsers([]);
    }
  }, [open, employee?.id, canManageAccess, today]);

  const userByStaffId = useMemo(() => new Map(users.filter((user) => user.staffId).map((user) => [String(user.staffId), user])), [users]);
  const userByEmail = useMemo(() => new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user])), [users]);
  const profile = operations.staffProfiles.find((item) => item.id === draft.id) as LifecycleProfile | undefined;
  const linkedUser = userByStaffId.get(draft.id);

  useEffect(() => {
    if (!open || !employee || !canManageAccess || !linkedUser) return;
    setDraft(draftFromProfile(employee as LifecycleProfile, linkedUser));
  }, [open, employee?.id, canManageAccess, linkedUser?.uid]);

  if (!open) return null;

  const selectedVan = profile ? employeeVan(profile, operations.vans) : null;
  const selectedVanId = selectedVan ? canonicalVanId(selectedVan.id, operations.vans) : '';
  const selectedHalfDay = selectedVanId ? operations.vanHalfDaySchedules.find((rule) => canonicalVanId(rule.vanId, operations.vans) === selectedVanId) : undefined;
  const selectedAbsences = profile ? operations.staffAbsences.filter((absence) => absence.staffId === profile.id && absence.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))).slice(0, 5) : [];

  function changeEmployeeType(employeeType: string) {
    setDraft((current) => {
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
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const contactEmail = draft.contactEmail.trim().toLowerCase();
    const loginEmail = draft.loginEmail.trim().toLowerCase();
    if (!name) return setError('Full name is required.');
    if (!phone) return setError('Phone number is required.');
    if (draft.createAccess && canManageAccess && !loginEmail) return setError('ERP login email is required when sign-in access is enabled.');
    if (draft.weeklyDayOffWeekday && !draft.weeklyDayOffEffectiveFrom) return setError('Choose when the weekly day off becomes effective.');

    const duplicate = operations.staffProfiles.find((item) => item.id !== draft.id && (
      normalizeName(item.name ?? '') === normalizeName(name)
      || (normalizePhone(phone) && normalizePhone(item.phone ?? '') === normalizePhone(phone))
    ));
    if (duplicate) return setError(`A master employee profile already exists for ${staffDisplayName(duplicate)}.`);

    setBusy(true); setError(''); setMessage('');
    try {
      const current = operations.staffProfiles.find((item) => item.id === draft.id) as LifecycleProfile | undefined;
      const next: LifecycleProfile = {
        ...current,
        id: draft.id,
        name,
        phone,
        email: contactEmail || undefined,
        employeeType: draft.employeeType,
        role: draft.role,
        canDriveVan: draft.employeeType === 'Técnico' ? draft.canDriveVan : false,
        skills: draft.employeeType === 'Técnico' ? draft.skillsText.split(',').map((item) => item.trim()).filter(Boolean) : [],
        availability: current?.active === false ? 'Inactivo' : 'Disponible',
        active: current?.active !== false,
        notes: draft.notes.trim() || undefined,
        employmentStartedAt: draft.employmentStartedAt || current?.employmentStartedAt,
        weeklyDayOffWeekday: draft.weeklyDayOffWeekday ? Number(draft.weeklyDayOffWeekday) : null,
        weeklyDayOffEffectiveFrom: draft.weeklyDayOffWeekday ? draft.weeklyDayOffEffectiveFrom : null,
        loginEmailKind: canManageAccess && draft.createAccess ? draft.loginEmailKind : current?.loginEmailKind,
      };
      await saveCanonicalStaffProfile(next);

      if (canManageAccess && next.active !== false && draft.createAccess) {
        const linked = userByStaffId.get(draft.id) ?? userByEmail.get(loginEmail);
        if (linked) {
          if (linked.staffId && linked.staffId !== draft.id) throw new Error(`The login email ${loginEmail} is assigned to another employee.`);
          const emailChanged = linked.email.trim().toLowerCase() !== loginEmail;
          await updateManagedUser({ uid: linked.uid, name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: draft.id });
          if (emailChanged) await sendPasswordSetupEmail(loginEmail);
        } else {
          await createManagedUser({ name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: draft.id });
          await sendPasswordSetupEmail(loginEmail);
        }
      } else if (canManageAccess && next.active !== false) {
        const linked = userByStaffId.get(draft.id);
        if (linked?.active) await updateManagedUser({ uid: linked.uid, name, email: linked.email, phone: phone || undefined, role: linked.role, active: false, staffId: draft.id });
      }

      await onChanged(draft.id);
      onClose();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function sendAccessEmail() {
    const linked = userByStaffId.get(draft.id);
    const email = linked?.email ?? draft.loginEmail.trim().toLowerCase();
    if (!linked || !email) return setError('Create or link the ERP sign-in account first.');
    setBusy(true); setError('');
    try { await sendPasswordSetupEmail(email); setMessage(`Password setup / reset email sent to ${email}.`); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function addTimeOff() {
    if (!profile || isNew) return;
    if (!timeOffDraft.fromDate || !timeOffDraft.toDate || timeOffDraft.toDate < timeOffDraft.fromDate) return setError('Choose a valid time-off date range.');
    setBusy(true); setError('');
    try {
      await saveCanonicalStaffAbsence({ id: `profile-${draft.id}-${crypto.randomUUID()}`, staffId: draft.id, fromDate: timeOffDraft.fromDate, toDate: timeOffDraft.toDate, reason: timeOffDraft.reason, notes: timeOffDraft.notes.trim() || undefined, active: true });
      setMessage(`Time off saved for ${draft.name}.`);
      setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
      await onChanged(draft.id);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function confirmOffboard() {
    if (!profile || !offboardDraft) return;
    if (!offboardDraft.reason.trim()) return setError('Enter a short offboarding reason for the audit history.');
    setBusy(true); setError('');
    try {
      await offboardEmployee({ staffId: profile.id, endDate: offboardDraft.endDate, reason: offboardDraft.reason.trim(), releaseLoginEmail: offboardDraft.releaseLoginEmail });
      await onChanged(profile.id);
      onClose();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function confirmReactivate() {
    if (!profile || !canManageAccess) return;
    if (!window.confirm(`Reactivate ${staffDisplayName(profile)}? ERP access and van assignments will not be restored automatically.`)) return;
    setBusy(true); setError('');
    try { await reactivateEmployee(profile.id); await onChanged(profile.id); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label={isNew ? 'Add employee' : 'Employee profile'}>
      <header className={styles.modalHeader}><div><span className={styles.eyebrow}>{isNew ? 'New employee' : 'Canonical employee profile'}</span><h2>{isNew ? 'Add Employee' : draft.name}</h2><p>{isNew ? 'Create one master employee identity. ERP access remains a separate controlled credential.' : `${profile?.role ?? 'Unassigned role'} · ${profile?.active === false ? 'Former employee' : 'Active employee'}`}</p></div><button className={styles.button} type="button" onClick={onClose} disabled={busy}>Close</button></header>
      <div className={styles.modalBody}>
        {!isNew ? <div className={styles.summaryGrid}><Summary label="Main van" value={selectedVanId || 'Unassigned'} /><Summary label="Availability" value={profile?.active === false ? 'Inactive' : activeStaffAbsence(draft.id, today, operations.staffAbsences)?.reason ?? profile?.availability ?? 'Disponible'} /><Summary label="ERP access" value={linkedUser ? `${linkedUser.active ? 'Active' : 'Disabled'} · ${linkedUser.role}` : canManageAccess ? 'No sign-in account' : 'Owner controlled'} /><Summary label="Employment" value={profile?.employmentStartedAt ? `Since ${profile.employmentStartedAt}` : 'Start date not recorded'} /></div> : null}

        <Section title="Personal & Employment Information" subtitle="This is the canonical staff profile used by scheduling, attendance, payroll references and historical work records."><div className={styles.formGrid}><Field label="Full name"><input className={styles.control} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field><Field label="Phone"><input className={styles.control} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field><Field label="Contact / personal email"><input className={styles.control} type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field><Field label="Employment start date"><input className={styles.control} type="date" value={draft.employmentStartedAt} onChange={(event) => setDraft({ ...draft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field><Field label="Employee type"><select className={styles.control} value={draft.employeeType} onChange={(event) => changeEmployeeType(event.target.value)} disabled={!canManageEmployees || profile?.active === false}>{EMPLOYEE_TYPES.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Operational job role"><select className={styles.control} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} disabled={!canManageEmployees || profile?.active === false}>{rolesForType(draft.employeeType).map((value) => <option key={value}>{value}</option>)}</select></Field>{draft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select className={styles.control} value={draft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setDraft({ ...draft, canDriveVan: event.target.value === 'yes' })} disabled={!canManageEmployees || profile?.active === false}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}{draft.employeeType === 'Técnico' ? <Field label="Skills"><input className={styles.control} value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} placeholder="Service, installation, diagnostics…" disabled={!canManageEmployees || profile?.active === false} /></Field> : null}<Field label="Internal notes" full><textarea className={styles.textarea} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field></div></Section>

        <Section title="ERP Access & Login" subtitle="Operational role and system permission remain separate. Contact email never silently becomes a login credential.">{canManageAccess ? <><div className={styles.formGrid}><Field label="ERP sign-in"><select className={styles.control} value={draft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setDraft({ ...draft, createAccess: event.target.value === 'enabled' })} disabled={profile?.active === false}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>{draft.createAccess ? <Field label="ERP login email"><input className={styles.control} type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} disabled={profile?.active === false} /></Field> : null}{draft.createAccess ? <Field label="Login email ownership"><select className={styles.control} value={draft.loginEmailKind} onChange={(event) => setDraft({ ...draft, loginEmailKind: event.target.value as LoginEmailKind })} disabled={profile?.active === false}><option value="company">Company email · reusable</option><option value="personal">Personal email · not reused</option></select></Field> : null}{draft.createAccess ? <Field label="Access role"><select className={styles.control} value={draft.accessRole} onChange={(event) => setDraft({ ...draft, accessRole: event.target.value as ManagedUserRole })} disabled={profile?.active === false}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}{draft.createAccess ? <Field label="Account status"><select className={styles.control} value={draft.accessActive ? 'active' : 'disabled'} onChange={(event) => setDraft({ ...draft, accessActive: event.target.value === 'active' })} disabled={profile?.active === false}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}</div>{!isNew && linkedUser ? <div className={styles.inlineActions}><button className={styles.button} type="button" onClick={() => void sendAccessEmail()} disabled={busy}>Send / Reset Password Email</button></div> : null}<div className={styles.info}>Firebase identity remains distinct from the employee record. Login changes never create a second staff profile.</div></> : <div className={styles.info}>Only the owner / administrator can create or change ERP sign-in accounts.</div>}</Section>

        {!isNew ? <Section title="Work Schedule & Time Off" subtitle="The employee profile owns the recurring weekly day off. Van half-days remain separate operational exceptions, and dated time off continues to use staffAbsences."><div className={styles.scheduleGrid}><Summary label="Company schedule" value="Mon–Sat · 08:00–17:00 · lunch 12:00–13:00" /><Summary label="Weekly day off" value={draft.weeklyDayOffWeekday ? `${weekdayLabel(Number(draft.weeklyDayOffWeekday))}${draft.weeklyDayOffEffectiveFrom ? ` · from ${draft.weeklyDayOffEffectiveFrom}` : ''}` : 'Not assigned'} /><Summary label="Van half-day" value={selectedHalfDay ? `${weekdayLabel(selectedHalfDay.weekday)} · until ${selectedHalfDay.workdayEnd ?? '13:00'} · ${selectedVanId}` : 'No Van half-day assigned'} /><Summary label="Schedule source" value="Employee profile + dated absences + Van exceptions" /></div>{profile?.active !== false && canManageEmployees ? <><div className={styles.timeOffBox}><strong>Recurring weekly day off</strong><div className={styles.formGrid} style={{ marginTop: 10 }}><Field label="Weekly day off"><select className={styles.control} value={draft.weeklyDayOffWeekday} onChange={(event) => setDraft({ ...draft, weeklyDayOffWeekday: event.target.value, weeklyDayOffEffectiveFrom: event.target.value ? (draft.weeklyDayOffEffectiveFrom || today) : '' })}>{WEEKLY_DAY_OFF_OPTIONS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}</select></Field><Field label="Effective from"><input className={styles.control} type="date" value={draft.weeklyDayOffEffectiveFrom} onChange={(event) => setDraft({ ...draft, weeklyDayOffEffectiveFrom: event.target.value })} disabled={!draft.weeklyDayOffWeekday} /></Field></div><div className={styles.info}>This is a recurring full day off for this employee only. Save Employee to apply it. It does not change the Van schedule or another employee.</div></div><div className={styles.timeOffBox}><strong>Add time off / unavailability</strong><div className={styles.formGrid} style={{ marginTop: 10 }}><Field label="From"><input className={styles.control} type="date" value={timeOffDraft.fromDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, fromDate: event.target.value })} /></Field><Field label="To"><input className={styles.control} type="date" value={timeOffDraft.toDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, toDate: event.target.value })} /></Field><Field label="Type"><select className={styles.control} value={timeOffDraft.reason} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, reason: event.target.value })}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Notes"><input className={styles.control} value={timeOffDraft.notes} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, notes: event.target.value })} /></Field></div><div className={styles.inlineActions}><button className={styles.button} type="button" onClick={() => void addTimeOff()} disabled={busy}>Save Time Off</button></div></div></> : null}{selectedAbsences.length ? <div className={styles.history}><strong>Recent / current time off</strong>{selectedAbsences.map((absence) => <div className={styles.historyRow} key={absence.id}><span>{absence.reason ?? 'Unavailable'}</span><span>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</span><small>{absence.notes ?? ''}</small></div>)}</div> : null}</Section> : null}

        {!isNew && profile ? <Section title="Employment Lifecycle" subtitle="Former employees are archived, never deleted, so historical work, attendance and payroll references remain intact.">{profile.active !== false ? <div className={styles.dangerZone}><div><strong>Offboard employee</strong><span>Disables access and removes future crew assignments while preserving history.</span></div><button className={styles.dangerButton} type="button" onClick={() => setOffboardDraft({ endDate: today, reason: '', releaseLoginEmail: Boolean(linkedUser) && (profile.loginEmailKind ?? defaultLoginEmailKind(inferredEmployeeType(profile))) === 'company' })} disabled={!canManageAccess || busy}>Start Offboarding</button></div> : <div className={styles.dangerZone}><div><strong>Former employee</strong><span>{profile.employmentEndedAt ? `Employment ended ${profile.employmentEndedAt}. ` : ''}{profile.offboardingReason ?? ''}</span></div><button className={styles.button} type="button" onClick={() => void confirmReactivate()} disabled={!canManageAccess || busy}>Reactivate Employee</button></div>}</Section> : null}

        {message ? <div className={styles.success}>{message}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}{(isNew || profile?.active !== false) && canManageEmployees ? <div className={styles.footer}><button className={styles.button} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={styles.primaryButton} type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Employee'}</button></div> : null}
      </div>
    </section>

    {offboardDraft ? <div className={styles.backdrop} style={{ zIndex: 1500 }} role="presentation"><section className={styles.modal} style={{ width: 'min(620px,100%)' }} role="dialog" aria-modal="true" aria-label="Offboard employee"><header className={styles.modalHeader}><div><span className={styles.eyebrow}>Employment lifecycle</span><h2>Offboard {profile ? staffDisplayName(profile) : draft.name}</h2><p>Archive safely; never delete historical employee records.</p></div><button className={styles.button} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Close</button></header><div className={styles.modalBody}><div className={styles.formGrid}><Field label="Last employment date"><input className={styles.control} type="date" value={offboardDraft.endDate} onChange={(event) => setOffboardDraft({ ...offboardDraft, endDate: event.target.value })} /></Field><Field label="Reason"><input className={styles.control} value={offboardDraft.reason} onChange={(event) => setOffboardDraft({ ...offboardDraft, reason: event.target.value })} placeholder="Resigned, contract ended, terminated…" /></Field></div><label className={styles.checkCard}><input type="checkbox" checked={offboardDraft.releaseLoginEmail} onChange={(event) => setOffboardDraft({ ...offboardDraft, releaseLoginEmail: event.target.checked })} /><span><strong>Release reusable company login email</strong><small>The former identity is archived; the email may then be assigned to a replacement employee.</small></span></label><div className={styles.warning}>Regular van membership and future dated assignments are removed. Historical work orders, visits, attendance, payroll and audit records remain linked to this employee identity.</div>{error ? <div className={styles.error}>{error}</div> : null}<div className={styles.footer}><button className={styles.button} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Cancel</button><button className={styles.dangerButton} type="button" onClick={() => void confirmOffboard()} disabled={busy}>{busy ? 'Offboarding…' : 'Confirm Offboarding'}</button></div></div></section></div> : null}
  </div>;
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <section className={styles.section}><header className={styles.sectionHeader}><h3>{title}</h3><p>{subtitle}</p></header>{children}</section>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className={styles.summaryCard}><span>{label}</span><strong>{value}</strong></div>; }
function todayKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function normalizeName(value: string) { return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '); }
function normalizePhone(value: string) { return value.replace(/\D/g, ''); }
function rolesForType(employeeType: string) { return employeeType === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES; }
function defaultRole(employeeType: string) { if (employeeType === 'Técnico') return 'Ayudante'; if (employeeType === 'Secretaria') return 'Secretaria'; if (employeeType === 'Administración') return 'Administración'; return 'Otro'; }
function defaultAccessRole(employeeType: string): ManagedUserRole { return employeeType === 'Técnico' ? 'technician' : 'office'; }
function defaultLoginEmailKind(employeeType: string): LoginEmailKind { return employeeType === 'Técnico' ? 'personal' : 'company'; }
function inferredEmployeeType(profile: CanonicalStaffProfile) { if (profile.employeeType) return profile.employeeType; if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '')) return 'Técnico'; if (profile.role === 'Secretaria') return 'Secretaria'; return 'Administración'; }
function newEmployeeDraft(): EmployeeDraft { return { id: `staff-${crypto.randomUUID()}`, name: '', phone: '', contactEmail: '', employeeType: 'Secretaria', role: 'Secretaria', canDriveVan: false, skillsText: '', notes: '', employmentStartedAt: todayKey(), weeklyDayOffWeekday: '', weeklyDayOffEffectiveFrom: '', createAccess: true, accessRole: 'office', accessActive: true, loginEmail: '', loginEmailKind: 'company' }; }
function draftFromProfile(profile: LifecycleProfile, linkedUser?: ManagedUser): EmployeeDraft { const employeeType = inferredEmployeeType(profile); const weeklyDayOffWeekday = Number(profile.weeklyDayOffWeekday); return { id: profile.id, name: profile.name ?? '', phone: profile.phone ?? '', contactEmail: profile.email ?? '', employeeType, role: profile.role ?? defaultRole(employeeType), canDriveVan: profile.canDriveVan === true, skillsText: (profile.skills ?? []).join(', '), notes: profile.notes ?? '', employmentStartedAt: profile.employmentStartedAt ?? '', weeklyDayOffWeekday: Number.isInteger(weeklyDayOffWeekday) && weeklyDayOffWeekday >= 1 && weeklyDayOffWeekday <= 6 ? String(weeklyDayOffWeekday) : '', weeklyDayOffEffectiveFrom: profile.weeklyDayOffEffectiveFrom ?? '', createAccess: Boolean(linkedUser), accessRole: linkedUser?.role ?? defaultAccessRole(employeeType), accessActive: linkedUser?.active ?? true, loginEmail: linkedUser?.email ?? profile.loginEmail ?? '', loginEmailKind: profile.loginEmailKind ?? defaultLoginEmailKind(employeeType) }; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
