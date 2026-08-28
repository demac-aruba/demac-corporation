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
import {
  loadEmployeePayrollSettings,
  payrollSettingsForEmployee,
  type EmployeePayrollSettings,
  type HalfDayOffPeriod,
} from '@/lib/employee-attendance';
import { offboardEmployee, reactivateEmployee } from '@/lib/employee-lifecycle';
import { employeeVan, isTechnicalEmployee } from '@/lib/employee-work-schedule';
import {
  OFFICE_SCHEDULE_TEMPLATES,
  asEmployeePayrollScheduleSettings,
  defaultEmployeeWeeklySchedule,
  employeeWeeklyScheduleFromSettings,
  saveEmployeeScheduleSettings,
  type EmployeeScheduleMode,
  type EmployeeScheduleTemplateId,
  type EmployeeScheduleWeekdayKey,
  type EmployeeWeeklySchedule,
} from '@/lib/employee-schedule-settings';
import {
  createManagedUser,
  listManagedUsers,
  sendPasswordSetupEmail,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
} from '@/lib/firebase/user-admin';
import { EmployeeProfileEditor as LegacyEmployeeProfileEditor } from './employee-profile-editor';
import styles from './employee-profile-v2.module.css';

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
const WEEKDAYS: Array<{ key: EmployeeScheduleWeekdayKey; label: string; short: string }> = [
  { key: '1', label: 'Monday', short: 'Mon' },
  { key: '2', label: 'Tuesday', short: 'Tue' },
  { key: '3', label: 'Wednesday', short: 'Wed' },
  { key: '4', label: 'Thursday', short: 'Thu' },
  { key: '5', label: 'Friday', short: 'Fri' },
  { key: '6', label: 'Saturday', short: 'Sat' },
];

type ProfileTab = 'access' | 'employment' | 'schedule' | 'timeoff' | 'payroll';
type LoginEmailKind = 'company' | 'personal';
type LifecycleProfile = CanonicalStaffProfile & {
  loginEmail?: string;
  loginEmailKind?: LoginEmailKind;
  employmentStartedAt?: string;
  employmentEndedAt?: string;
  offboardingReason?: string;
  weeklyDayOffWeekday?: number | null;
  weeklyDayOffEffectiveFrom?: string | null;
};
type EmployeeDraft = {
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
type ScheduleDraft = {
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  effectiveFrom: string;
  effectiveUntil: string;
  halfDayWeekday: string;
  halfDayOffPeriod: HalfDayOffPeriod;
};
type TimeOffDraft = { fromDate: string; toDate: string; reason: string; notes: string };
type OffboardDraft = { endDate: string; reason: string; releaseLoginEmail: boolean };

type Props = {
  open: boolean;
  employee: CanonicalStaffProfile | null;
  operations: CanonicalOperationsState;
  onClose: () => void;
  onChanged: (employeeId?: string) => Promise<void> | void;
};

export function EmployeeProfileEditorV2(props: Props) {
  if (props.employee === null) return <LegacyEmployeeProfileEditor {...props} />;
  return <ExistingEmployeeProfileV2 {...props} employee={props.employee} />;
}

function ExistingEmployeeProfileV2({ open, employee, operations, onClose, onChanged }: Props & { employee: CanonicalStaffProfile }) {
  const { principal } = useAuth();
  const canManageEmployees = principal.capabilities.has('employees.manage');
  const canManageAccess = principal.role === 'super_admin';
  const canManageIndividualSchedule = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const today = todayKey();
  const profile = (operations.staffProfiles.find((item) => item.id === employee.id) ?? employee) as LifecycleProfile;
  const technical = isTechnicalEmployee(profile);
  const [tab, setTab] = useState<ProfileTab>('schedule');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<EmployeePayrollSettings[]>([]);
  const [draft, setDraft] = useState<EmployeeDraft>(() => draftFromProfile(profile));
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => scheduleDraftFromSettings(undefined, profile, today));
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft>({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
  const [offboardDraft, setOffboardDraft] = useState<OffboardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab('schedule');
    setDraft(draftFromProfile(profile));
    setScheduleDraft(scheduleDraftFromSettings(undefined, profile, today));
    setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setOffboardDraft(null);
    setUsers([]);
    setPayrollSettings([]);
    setError('');
    setMessage('');

    if (canManageAccess) {
      void listManagedUsers()
        .then((managedUsers) => {
          setUsers(managedUsers);
          const linked = managedUsers.find((user) => user.staffId === profile.id);
          setDraft(draftFromProfile(profile, linked));
        })
        .catch((cause) => setError(`ERP access information could not be loaded: ${errorText(cause)}`));
    }

    if (!technical && canManageIndividualSchedule) {
      setScheduleLoading(true);
      void loadEmployeePayrollSettings()
        .then((settings) => {
          setPayrollSettings(settings);
          setScheduleDraft(scheduleDraftFromSettings(payrollSettingsForEmployee(settings, profile), profile, today));
        })
        .catch((cause) => setError(`Employee schedule settings could not be loaded: ${errorText(cause)}`))
        .finally(() => setScheduleLoading(false));
    }
  }, [open, employee.id, canManageAccess, canManageIndividualSchedule, technical, today]);

  const userByStaffId = useMemo(() => new Map(users.filter((user) => user.staffId).map((user) => [String(user.staffId), user])), [users]);
  const userByEmail = useMemo(() => new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user])), [users]);
  const linkedUser = userByStaffId.get(profile.id);
  const individualSchedule = payrollSettingsForEmployee(payrollSettings, profile);
  const selectedVan = employeeVan(profile, operations.vans);
  const selectedVanId = selectedVan ? canonicalVanId(selectedVan.id, operations.vans) : '';
  const selectedVanHalfDay = selectedVanId ? operations.vanHalfDaySchedules.find((rule) => canonicalVanId(rule.vanId, operations.vans) === selectedVanId) : undefined;
  const selectedAbsences = operations.staffAbsences
    .filter((absence) => absence.staffId === profile.id && absence.active !== false)
    .sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? '')))
    .slice(0, 8);
  const availability = profile.active === false ? 'Inactive' : activeStaffAbsence(profile.id, today, operations.staffAbsences)?.reason ?? profile.availability ?? 'Disponible';

  if (!open) return null;

  function changeEmployeeType(employeeType: string) {
    setDraft((current) => {
      const roles = rolesForType(employeeType);
      return {
        ...current,
        employeeType,
        role: roles.includes(current.role) ? current.role : defaultRole(employeeType),
        canDriveVan: employeeType === 'Técnico' ? current.canDriveVan : false,
        skillsText: employeeType === 'Técnico' ? current.skillsText : '',
      };
    });
  }

  async function saveEmployee() {
    if (!canManageEmployees || profile.active === false) return;
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const contactEmail = draft.contactEmail.trim().toLowerCase();
    const loginEmail = draft.loginEmail.trim().toLowerCase();
    if (!name) return setError('Full name is required.');
    if (!phone) return setError('Phone number is required.');
    if (draft.createAccess && canManageAccess && !loginEmail) return setError('ERP login email is required when sign-in access is enabled.');
    const duplicate = operations.staffProfiles.find((item) => item.id !== profile.id && (
      normalizeName(item.name ?? '') === normalizeName(name)
      || (normalizePhone(phone) && normalizePhone(item.phone ?? '') === normalizePhone(phone))
    ));
    if (duplicate) return setError(`A master employee profile already exists for ${staffDisplayName(duplicate)}.`);

    setBusy(true); setError(''); setMessage('');
    try {
      const next: LifecycleProfile = {
        ...profile,
        name,
        phone,
        email: contactEmail || undefined,
        employeeType: draft.employeeType,
        role: draft.role,
        canDriveVan: draft.employeeType === 'Técnico' ? draft.canDriveVan : false,
        skills: draft.employeeType === 'Técnico' ? draft.skillsText.split(',').map((item) => item.trim()).filter(Boolean) : [],
        notes: draft.notes.trim() || undefined,
        employmentStartedAt: draft.employmentStartedAt || profile.employmentStartedAt,
        availability: 'Disponible',
        active: true,
        weeklyDayOffWeekday: null,
        weeklyDayOffEffectiveFrom: null,
        loginEmailKind: canManageAccess && draft.createAccess ? draft.loginEmailKind : profile.loginEmailKind,
      };
      await saveCanonicalStaffProfile(next);

      if (canManageAccess && draft.createAccess) {
        const linked = userByStaffId.get(profile.id) ?? userByEmail.get(loginEmail);
        if (linked) {
          if (linked.staffId && linked.staffId !== profile.id) throw new Error(`The login email ${loginEmail} is assigned to another employee.`);
          const emailChanged = linked.email.trim().toLowerCase() !== loginEmail;
          await updateManagedUser({ uid: linked.uid, name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: profile.id });
          if (emailChanged) await sendPasswordSetupEmail(loginEmail);
        } else {
          await createManagedUser({ name, email: loginEmail, phone, role: draft.accessRole, active: draft.accessActive, staffId: profile.id });
          await sendPasswordSetupEmail(loginEmail);
        }
      } else if (canManageAccess) {
        const linked = userByStaffId.get(profile.id);
        if (linked?.active) await updateManagedUser({ uid: linked.uid, name, email: linked.email, phone: phone || undefined, role: linked.role, active: false, staffId: profile.id });
      }

      await onChanged(profile.id);
      setMessage('Employee profile saved. Existing employee identity and history were preserved.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveSchedule() {
    if (technical) return setError('Technician recurring half-days are governed by the Van/team schedule, not the employee record.');
    if (!canManageIndividualSchedule) return setError('This schedule is payroll-protected. An authorized owner/finance user is required.');
    const halfDayWeekday = scheduleDraft.halfDayWeekday ? Number(scheduleDraft.halfDayWeekday) : null;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveEmployeeScheduleSettings({
        employee: profile,
        existing: individualSchedule,
        mode: scheduleDraft.mode,
        templateId: scheduleDraft.templateId,
        weeklySchedule: scheduleDraft.weeklySchedule,
        effectiveFrom: scheduleDraft.effectiveFrom,
        effectiveUntil: scheduleDraft.effectiveUntil || null,
        halfDayWeekday,
        halfDayOffPeriod: scheduleDraft.halfDayOffPeriod,
      });
      setPayrollSettings((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      await saveCanonicalStaffProfile({ ...profile, weeklyDayOffWeekday: null, weeklyDayOffEffectiveFrom: null } as LifecycleProfile);
      await onChanged(profile.id);
      setMessage('Work schedule saved. Attendance, calendar and payroll will resolve this effective schedule without rewriting historical records.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function sendAccessEmail() {
    const linked = userByStaffId.get(profile.id);
    const email = linked?.email ?? draft.loginEmail.trim().toLowerCase();
    if (!linked || !email) return setError('Create or link the ERP sign-in account first.');
    setBusy(true); setError('');
    try { await sendPasswordSetupEmail(email); setMessage(`Password setup / reset email sent to ${email}.`); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function addTimeOff() {
    if (!canManageEmployees) return;
    if (!timeOffDraft.fromDate || !timeOffDraft.toDate || timeOffDraft.toDate < timeOffDraft.fromDate) return setError('Choose a valid time-off date range.');
    setBusy(true); setError(''); setMessage('');
    try {
      await saveCanonicalStaffAbsence({
        id: `profile-${profile.id}-${crypto.randomUUID()}`,
        staffId: profile.id,
        fromDate: timeOffDraft.fromDate,
        toDate: timeOffDraft.toDate,
        reason: timeOffDraft.reason,
        notes: timeOffDraft.notes.trim() || undefined,
        active: true,
      });
      setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
      await onChanged(profile.id);
      setMessage('Dated time off saved separately from the recurring work schedule.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function confirmOffboard() {
    if (!offboardDraft || !canManageAccess) return;
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
    if (!canManageAccess) return;
    if (!window.confirm(`Reactivate ${staffDisplayName(profile)}? ERP access and van assignments will not be restored automatically.`)) return;
    setBusy(true); setError('');
    try { await reactivateEmployee(profile.id); await onChanged(profile.id); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  function applyTemplate(templateId: Exclude<EmployeeScheduleTemplateId, 'custom'>) {
    const template = OFFICE_SCHEDULE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setScheduleDraft((current) => ({
      ...current,
      mode: 'custom',
      templateId,
      weeklySchedule: defaultEmployeeWeeklySchedule(template.startTime, template.endTime, template.breakMinutes),
    }));
  }

  function updateScheduleDay(weekday: EmployeeScheduleWeekdayKey, field: 'startTime' | 'endTime' | 'breakMinutes', value: string) {
    setScheduleDraft((current) => ({
      ...current,
      mode: 'custom',
      templateId: 'custom',
      weeklySchedule: {
        ...current.weeklySchedule,
        [weekday]: {
          ...(current.weeklySchedule[weekday] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 }),
          [field]: field === 'breakMinutes' ? Number(value) : value,
        },
      },
    }));
  }

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: 'access', label: 'Profile & Access' },
    { id: 'employment', label: 'Employment Details' },
    { id: 'schedule', label: 'Work Schedule' },
    { id: 'timeoff', label: 'Time Off & Exceptions' },
    { id: 'payroll', label: 'Payroll Notes' },
  ];

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className={styles.shell} role="dialog" aria-modal="true" aria-label="Employee profile">
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <div className={styles.avatar}>{initials(draft.name)}</div>
          <div><span className={styles.eyebrow}>Canonical employee profile</span><div className={styles.titleRow}><h2>{draft.name || staffDisplayName(profile)}</h2><span className={profile.active === false ? styles.inactiveBadge : styles.activeBadge}>{profile.active === false ? 'Former employee' : 'Active employee'}</span></div><p>{draft.role || 'Unassigned role'} · {draft.employeeType}</p></div>
        </div>
        <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button>{profile.active !== false && canManageEmployees ? <button className={styles.primaryButton} type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button> : null}<button className={styles.closeButton} type="button" onClick={onClose} disabled={busy}>×</button></div>
      </header>

      <div className={styles.metaGrid}>
        <Meta label="Employee ID" value={profile.id} />
        <Meta label="Department / Type" value={draft.employeeType} />
        <Meta label="Position" value={draft.role || '—'} />
        <Meta label="Company / Contact Email" value={draft.contactEmail || '—'} />
        <Meta label="Phone" value={draft.phone || '—'} />
        <Meta label="Availability" value={availability} />
      </div>

      <nav className={styles.tabs} aria-label="Employee profile sections">{tabs.map((item) => <button key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} type="button" onClick={() => { setTab(item.id); setError(''); setMessage(''); }}>{item.label}</button>)}</nav>

      <div className={styles.body}>
        {message ? <div className={styles.success}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === 'access' ? <div className={styles.twoColumn}>
          <Card title="Profile & Access" subtitle="Employee identity and ERP sign-in remain separate records.">
            <div className={styles.formGrid}>
              <Field label="Full name"><input className={styles.control} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field>
              <Field label="Phone"><input className={styles.control} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field>
              <Field label="Contact / personal email"><input className={styles.control} type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field>
            </div>
            {canManageAccess ? <div className={styles.subsection}>
              <div className={styles.formGrid}>
                <Field label="ERP sign-in"><select className={styles.control} value={draft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setDraft({ ...draft, createAccess: event.target.value === 'enabled' })} disabled={profile.active === false}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>
                {draft.createAccess ? <Field label="ERP login email"><input className={styles.control} type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} disabled={profile.active === false} /></Field> : null}
                {draft.createAccess ? <Field label="Login email ownership"><select className={styles.control} value={draft.loginEmailKind} onChange={(event) => setDraft({ ...draft, loginEmailKind: event.target.value as LoginEmailKind })} disabled={profile.active === false}><option value="company">Company email · reusable</option><option value="personal">Personal email · not reused</option></select></Field> : null}
                {draft.createAccess ? <Field label="Access role"><select className={styles.control} value={draft.accessRole} onChange={(event) => setDraft({ ...draft, accessRole: event.target.value as ManagedUserRole })} disabled={profile.active === false}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
                {draft.createAccess ? <Field label="Account status"><select className={styles.control} value={draft.accessActive ? 'active' : 'disabled'} onChange={(event) => setDraft({ ...draft, accessActive: event.target.value === 'active' })} disabled={profile.active === false}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}
              </div>
              {linkedUser ? <button className={styles.secondaryButton} type="button" onClick={() => void sendAccessEmail()} disabled={busy}>Send / Reset Password Email</button> : null}
            </div> : <Info>Only the owner / administrator can create or change ERP sign-in accounts.</Info>}
          </Card>
          <Card title="Identity Safety" subtitle="No duplicate employee masters are created."><StatusRow label="Canonical employee" value="staffProfiles" ok /><StatusRow label="Authentication identity" value="Firebase Auth" ok /><StatusRow label="Historical references" value="Preserved by employee ID" ok /><Info>Changing a login never creates a second employee profile.</Info></Card>
        </div> : null}

        {tab === 'employment' ? <div className={styles.twoColumn}>
          <Card title="Employment Details" subtitle="Canonical employment data used by scheduling, attendance and payroll.">
            <div className={styles.formGrid}>
              <Field label="Employment start date"><input className={styles.control} type="date" value={draft.employmentStartedAt} onChange={(event) => setDraft({ ...draft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field>
              <Field label="Employee type"><select className={styles.control} value={draft.employeeType} onChange={(event) => changeEmployeeType(event.target.value)} disabled={!canManageEmployees || profile.active === false}>{EMPLOYEE_TYPES.map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Operational job role"><select className={styles.control} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} disabled={!canManageEmployees || profile.active === false}>{rolesForType(draft.employeeType).map((value) => <option key={value}>{value}</option>)}</select></Field>
              {draft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select className={styles.control} value={draft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setDraft({ ...draft, canDriveVan: event.target.value === 'yes' })} disabled={!canManageEmployees || profile.active === false}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}
              {draft.employeeType === 'Técnico' ? <Field label="Skills" full><input className={styles.control} value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} placeholder="Service, installation, diagnostics…" disabled={!canManageEmployees || profile.active === false} /></Field> : null}
            </div>
          </Card>
          <Card title="Employment Boundary" subtitle="The start date now limits generated attendance and payroll schedule days."><StatusRow label="Before start date" value="No scheduled work" ok /><StatusRow label="Start date" value="Included" ok /><StatusRow label="After employment end" value="No scheduled work" ok /><Info>Existing timesheets and historical records are never deleted or rewritten by this profile.</Info></Card>
        </div> : null}

        {tab === 'schedule' ? <SchedulePanel
          technical={technical}
          canManage={canManageIndividualSchedule && profile.active !== false}
          loading={scheduleLoading}
          draft={scheduleDraft}
          setDraft={setScheduleDraft}
          onApplyTemplate={applyTemplate}
          onUpdateDay={updateScheduleDay}
          onSave={() => void saveSchedule()}
          busy={busy}
          vanId={selectedVanId}
          vanHalfDay={selectedVanHalfDay}
          settings={individualSchedule}
        /> : null}

        {tab === 'timeoff' ? <div className={styles.twoColumn}>
          <Card title="Time Off & Exceptions" subtitle="Dated exceptions remain separate from the recurring weekly schedule.">
            {profile.active !== false && canManageEmployees ? <><div className={styles.formGrid}><Field label="From"><input className={styles.control} type="date" value={timeOffDraft.fromDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, fromDate: event.target.value })} /></Field><Field label="To"><input className={styles.control} type="date" value={timeOffDraft.toDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, toDate: event.target.value })} /></Field><Field label="Type"><select className={styles.control} value={timeOffDraft.reason} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, reason: event.target.value })}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Notes"><input className={styles.control} value={timeOffDraft.notes} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, notes: event.target.value })} /></Field></div><button className={styles.primaryButton} type="button" onClick={() => void addTimeOff()} disabled={busy}>Save Time Off</button></> : <Info>Time-off editing is unavailable for this profile or role.</Info>}
          </Card>
          <Card title="Recent / Current Exceptions" subtitle="Vacation, sick leave and one-off unavailability from staffAbsences.">{selectedAbsences.length ? <div className={styles.history}>{selectedAbsences.map((absence) => <div className={styles.historyRow} key={absence.id}><div><strong>{absence.reason ?? 'Unavailable'}</strong><span>{absence.notes ?? 'No notes'}</span></div><time>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</time></div>)}</div> : <Info>No current or recent dated exceptions.</Info>}</Card>
        </div> : null}

        {tab === 'payroll' ? <div className={styles.twoColumn}>
          <Card title="Payroll Notes" subtitle="Internal notes stay attached to the canonical employee profile."><Field label="Internal notes"><textarea className={styles.textarea} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field><Info>Schedule configuration is stored separately in the protected payroll schedule record; notes do not alter payroll calculations.</Info></Card>
          <Card title="Employment Lifecycle" subtitle="Former employees are archived, never deleted.">{profile.active !== false ? <>{offboardDraft ? <div className={styles.subsection}><Field label="Last employment date"><input className={styles.control} type="date" value={offboardDraft.endDate} onChange={(event) => setOffboardDraft({ ...offboardDraft, endDate: event.target.value })} /></Field><Field label="Reason"><input className={styles.control} value={offboardDraft.reason} onChange={(event) => setOffboardDraft({ ...offboardDraft, reason: event.target.value })} placeholder="Resigned, contract ended, terminated…" /></Field><label className={styles.checkbox}><input type="checkbox" checked={offboardDraft.releaseLoginEmail} onChange={(event) => setOffboardDraft({ ...offboardDraft, releaseLoginEmail: event.target.checked })} /> Release reusable company login email</label><div className={styles.actionRow}><button className={styles.secondaryButton} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Cancel</button><button className={styles.dangerButton} type="button" onClick={() => void confirmOffboard()} disabled={!canManageAccess || busy}>Confirm Offboarding</button></div></div> : <div className={styles.dangerCard}><div><strong>Offboard employee</strong><span>Disables access and future crew assignment while preserving all history.</span></div><button className={styles.dangerButton} type="button" onClick={() => setOffboardDraft({ endDate: today, reason: '', releaseLoginEmail: Boolean(linkedUser) && (profile.loginEmailKind ?? defaultLoginEmailKind(profile.employeeType ?? '')) === 'company' })} disabled={!canManageAccess || busy}>Start Offboarding</button></div>}</> : <div className={styles.dangerCard}><div><strong>Former employee</strong><span>{profile.employmentEndedAt ? `Employment ended ${profile.employmentEndedAt}. ` : ''}{profile.offboardingReason ?? ''}</span></div><button className={styles.secondaryButton} type="button" onClick={() => void confirmReactivate()} disabled={!canManageAccess || busy}>Reactivate Employee</button></div>}</Card>
        </div> : null}
      </div>
    </section>
  </div>;
}

function SchedulePanel({ technical, canManage, loading, draft, setDraft, onApplyTemplate, onUpdateDay, onSave, busy, vanId, vanHalfDay, settings }: {
  technical: boolean;
  canManage: boolean;
  loading: boolean;
  draft: ScheduleDraft;
  setDraft: (draft: ScheduleDraft | ((current: ScheduleDraft) => ScheduleDraft)) => void;
  onApplyTemplate: (templateId: Exclude<EmployeeScheduleTemplateId, 'custom'>) => void;
  onUpdateDay: (weekday: EmployeeScheduleWeekdayKey, field: 'startTime' | 'endTime' | 'breakMinutes', value: string) => void;
  onSave: () => void;
  busy: boolean;
  vanId: string;
  vanHalfDay?: { weekday: number; workdayStart?: string; workdayEnd?: string };
  settings?: EmployeePayrollSettings;
}) {
  if (technical) {
    return <div className={styles.scheduleLayout}>
      <div className={styles.stack}>
        <Card title="Work Schedule" subtitle="Technicians inherit the protected recurring half-day from their Van/team."><div className={styles.modeGrid}><div className={styles.modeSelected}><strong>Technician / Field Schedule</strong><span>Company base shift · Van-owned recurring half-day</span></div></div><div className={styles.scheduleTable}><div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Rule</span></div>{WEEKDAYS.map((day) => { const half = vanHalfDay?.weekday === Number(day.key); return <div className={styles.scheduleRow} key={day.key}><strong>{day.label}</strong><span className={half ? styles.halfChip : styles.workChip}>{half ? 'Half-day' : 'Working day'}</span><span>{half ? vanHalfDay?.workdayStart ?? '08:00' : '08:00'}</span><span>{half ? vanHalfDay?.workdayEnd ?? '13:00' : '17:00'}</span><span>{half ? '5h work + 3h paid free' : 'Company shift'}</span></div>; })}<div className={styles.scheduleRow}><strong>Sunday</strong><span className={styles.offChip}>Off day</span><span>—</span><span>—</span><span>Business closed · locked</span></div></div><Info>To change the technician recurring half-day, update the Van/team schedule. This profile intentionally cannot create a duplicate employee-level technician rule.</Info></Card>
      </div>
      <aside className={styles.stack}><Card title="Schedule Source" subtitle="Protected authority"><StatusRow label="Base schedule" value="Company calendar" ok /><StatusRow label="Recurring half-day" value={vanId ? `${vanId} · vanHalfDaySchedules` : 'Van not assigned'} ok={Boolean(vanId)} /><StatusRow label="Half-day policy" value="5h worked + 3h paid free" ok /><StatusRow label="Sunday" value="Company closed" ok /></Card></aside>
    </div>;
  }

  const weekly = draft.weeklySchedule;
  const halfDayWeekday = Number(draft.halfDayWeekday);
  const overview = WEEKDAYS.map((day) => {
    const row = weekly[day.key] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
    const isHalf = halfDayWeekday === Number(day.key);
    const fullMinutes = Math.max(0, minutes(row.startTime, row.endTime) - row.breakMinutes);
    const workMinutes = isHalf ? 240 : fullMinutes;
    const paidFreeMinutes = isHalf ? 240 : 0;
    const rendered = isHalf ? halfDayTimes(row.startTime, row.endTime, draft.halfDayOffPeriod) : { start: row.startTime, end: row.endTime };
    return { ...day, ...row, isHalf, workMinutes, paidFreeMinutes, rendered };
  });
  const paidBaseMinutes = overview.reduce((sum, row) => sum + row.workMinutes + row.paidFreeMinutes, 0);

  return <div className={styles.scheduleLayout}>
    <div className={styles.stack}>
      <Card title="1 · Schedule Mode" subtitle="Choose whether this office employee follows the company shift or a custom employee schedule.">
        <div className={styles.modeGrid}>
          <button className={draft.mode === 'company' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'company' }))}><strong>Use company default</strong><span>Mon–Sat · 08:00–17:00 · 1h break</span></button>
          <button className={draft.mode === 'custom' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'custom' }))}><strong>Use custom employee schedule</strong><span>Configure 08:00–17:00, 09:00–18:00 or another eight-hour office shift.</span></button>
        </div>
      </Card>

      <Card title="2 · Shift Templates" subtitle="Reusable starting points; each employee keeps their own effective schedule.">
        <div className={styles.templateGrid}>{OFFICE_SCHEDULE_TEMPLATES.map((template) => <button key={template.id} className={draft.templateId === template.id && draft.mode === 'custom' ? styles.templateSelected : styles.templateCard} type="button" disabled={!canManage || loading} onClick={() => onApplyTemplate(template.id)}><strong>{template.label}</strong><span>{template.startTime}–{template.endTime}</span><small>{template.breakMinutes / 60}h break</small></button>)}<div className={styles.templateReadonly}><strong>Technician Shift</strong><span>08:00–17:00</span><small>Half-day comes from Van/team</small></div></div>
      </Card>

      <Card title="3 · Weekly Schedule" subtitle="Sunday is company-closed and locked. The selected half-day is paid according to the office rule.">
        <div className={styles.legend}><span><i className={styles.workDot} /> Working day</span><span><i className={styles.halfDot} /> Half-day</span><span><i className={styles.offDot} /> Off day</span></div>
        <div className={styles.scheduleTable}>
          <div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Break / Rule</span></div>
          {overview.map((row) => <div className={styles.scheduleRow} key={row.key}><strong>{row.label}</strong><span className={row.isHalf ? styles.halfChip : styles.workChip}>{row.isHalf ? 'Half-day' : 'Working day'}</span><input className={styles.timeControl} type="time" value={row.startTime} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'startTime', event.target.value)} /><input className={styles.timeControl} type="time" value={row.endTime} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'endTime', event.target.value)} />{row.isHalf ? <span className={styles.ruleText}>4h work + 4h paid free</span> : <select className={styles.miniSelect} value={row.breakMinutes} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'breakMinutes', event.target.value)}><option value="60">1h break</option></select>}</div>)}
          <div className={styles.scheduleRow}><strong>Sunday</strong><span className={styles.offChip}>Off day</span><span>—</span><span>—</span><span className={styles.ruleText}>Business closed · locked</span></div>
        </div>
      </Card>

      <Card title="4 · Schedule Details" subtitle="Effective dates protect historical payroll and attendance from retroactive schedule changes.">
        <div className={styles.detailGrid}>
          <Field label="Half-day weekday"><select className={styles.control} value={draft.halfDayWeekday} onChange={(event) => setDraft((current) => ({ ...current, halfDayWeekday: event.target.value }))} disabled={!canManage || loading}><option value="">Not configured</option>{WEEKDAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}</select></Field>
          <Field label="Half-day period"><select className={styles.control} value={draft.halfDayOffPeriod} onChange={(event) => setDraft((current) => ({ ...current, halfDayOffPeriod: event.target.value as HalfDayOffPeriod }))} disabled={!canManage || loading}><option value="afternoon">Afternoon off · work first 4h</option><option value="morning">Morning off · work last 4h</option></select></Field>
          <Field label="Effective from"><input className={styles.control} type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!canManage || loading} /></Field>
          <Field label="Effective until (optional)"><input className={styles.control} type="date" value={draft.effectiveUntil} onChange={(event) => setDraft((current) => ({ ...current, effectiveUntil: event.target.value }))} disabled={!canManage || loading} /></Field>
        </div>
        <Info>Office/Admin/Operators: <strong>4 hours worked + 4 hours paid free</strong>. Existing legacy half-day records remain valid; no migration or backfill is required.</Info>
        <div className={styles.actionRow}><button className={styles.primaryButton} type="button" onClick={onSave} disabled={!canManage || loading || busy}>{busy ? 'Saving…' : 'Save Work Schedule'}</button></div>
      </Card>
    </div>

    <aside className={styles.stack}>
      <Card title="Weekly Overview" subtitle="Resolved preview of the current draft."><div className={styles.overview}>{overview.map((row) => <div className={styles.overviewRow} key={row.key}><strong>{row.short}</strong><span>{row.rendered.start}–{row.rendered.end}</span><div className={row.isHalf ? styles.halfBar : styles.workBar} /><b>{formatHours(row.workMinutes)}</b></div>)}<div className={styles.overviewRow}><strong>Sun</strong><span>Closed</span><div className={styles.offBar} /><b>0h</b></div></div><div className={styles.totalRow}><span>Paid base hours</span><strong>{formatHours(paidBaseMinutes)}</strong></div></Card>
      <Card title="Half-day Rule Templates" subtitle="The authority depends on employee type."><div className={styles.ruleSelected}><strong>Office staff: 4h work / 4h off</strong><span>Individual rule in employeePayrollSettings</span></div><div className={styles.ruleReadonly}><strong>Technician: 5h work / 3h off</strong><span>Inherited from Van/team; not editable here</span></div></Card>
      <Card title="Payroll & Attendance Impact" subtitle="One resolver is shared by connected employee modules."><StatusRow label="Attendance" value="Effective schedule" ok /><StatusRow label="Calendar" value="Effective schedule" ok /><StatusRow label="Payroll" value="Effective schedule dates" ok /><StatusRow label="Employment start" value="Respected" ok /><StatusRow label="Existing records" value="Not rewritten" ok /><div className={styles.auditNote}>Changes are additive to the existing payroll settings record. Firestore updates use an update mask, so unrelated real fields remain untouched.</div></Card>
      {settings ? <Card title="Current Record" subtitle="Backward-compatible payroll schedule source"><StatusRow label="Record ID" value={settings.id} ok /><StatusRow label="Legacy half-day" value={settings.weeklyHalfDayWeekday ? weekdayLabel(settings.weeklyHalfDayWeekday) : 'Not configured'} ok={Boolean(settings.weeklyHalfDayWeekday)} /><StatusRow label="V2 mode" value={asEmployeePayrollScheduleSettings(settings)?.scheduleMode ?? 'Legacy / company default'} ok /></Card> : null}
    </aside>
  </div>;
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <section className={styles.card}><header className={styles.cardHeader}><div><h3>{title}</h3><p>{subtitle}</p></div></header>{children}</section>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Meta({ label, value }: { label: string; value: string }) { return <div className={styles.meta}><span>{label}</span><strong>{value}</strong></div>; }
function Info({ children }: { children: ReactNode }) { return <div className={styles.info}>{children}</div>; }
function StatusRow({ label, value, ok = false }: { label: string; value: string; ok?: boolean }) { return <div className={styles.statusRow}><span className={ok ? styles.statusOk : styles.statusNeutral}>{ok ? '✓' : '•'}</span><div><strong>{label}</strong><span>{value}</span></div></div>; }
function todayKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function normalizeName(value: string) { return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '); }
function normalizePhone(value: string) { return value.replace(/\D/g, ''); }
function rolesForType(employeeType: string) { return employeeType === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES; }
function defaultRole(employeeType: string) { if (employeeType === 'Técnico') return 'Ayudante'; if (employeeType === 'Secretaria') return 'Secretaria'; if (employeeType === 'Administración') return 'Administración'; return 'Otro'; }
function defaultAccessRole(employeeType: string): ManagedUserRole { return employeeType === 'Técnico' ? 'technician' : 'office'; }
function defaultLoginEmailKind(employeeType: string): LoginEmailKind { return employeeType === 'Técnico' ? 'personal' : 'company'; }
function draftFromProfile(profile: LifecycleProfile, linkedUser?: ManagedUser): EmployeeDraft { const employeeType = profile.employeeType ?? (isTechnicalEmployee(profile) ? 'Técnico' : profile.role === 'Secretaria' ? 'Secretaria' : 'Administración'); return { name: profile.name ?? '', phone: profile.phone ?? '', contactEmail: profile.email ?? '', employeeType, role: profile.role ?? defaultRole(employeeType), canDriveVan: profile.canDriveVan === true, skillsText: (profile.skills ?? []).join(', '), notes: profile.notes ?? '', employmentStartedAt: profile.employmentStartedAt ?? '', createAccess: Boolean(linkedUser), accessRole: linkedUser?.role ?? defaultAccessRole(employeeType), accessActive: linkedUser?.active ?? true, loginEmail: linkedUser?.email ?? profile.loginEmail ?? '', loginEmailKind: profile.loginEmailKind ?? defaultLoginEmailKind(employeeType) }; }
function scheduleDraftFromSettings(settings: EmployeePayrollSettings | undefined, profile: LifecycleProfile, today: string): ScheduleDraft { const extended = asEmployeePayrollScheduleSettings(settings); const weekday = Number(settings?.weeklyHalfDayWeekday); return { mode: extended?.scheduleMode ?? 'company', templateId: extended?.scheduleTemplateId ?? 'office-8-5', weeklySchedule: employeeWeeklyScheduleFromSettings(settings), effectiveFrom: extended?.scheduleEffectiveFrom ?? settings?.halfDayEffectiveFrom ?? profile.employmentStartedAt ?? today, effectiveUntil: extended?.scheduleEffectiveUntil ?? '', halfDayWeekday: Number.isInteger(weekday) && weekday >= 1 && weekday <= 6 ? String(weekday) : '', halfDayOffPeriod: settings?.halfDayOffPeriod ?? 'afternoon' }; }
function initials(value: string) { return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DE'; }
function minutes(start: string, end: string) { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); return Math.max(0, (eh * 60 + em) - (sh * 60 + sm)); }
function halfDayTimes(start: string, end: string, offPeriod: HalfDayOffPeriod) { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); const startMinutes = sh * 60 + sm; const endMinutes = eh * 60 + em; const workStart = offPeriod === 'morning' ? Math.max(startMinutes, endMinutes - 240) : startMinutes; const workEnd = offPeriod === 'morning' ? endMinutes : Math.min(endMinutes, startMinutes + 240); return { start: formatTime(workStart), end: formatTime(workEnd) }; }
function formatTime(total: number) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function formatHours(totalMinutes: number) { const hours = totalMinutes / 60; return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
