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
import {
  EMPLOYEE_SHIFT_TEMPLATES,
  employeeScheduleConfig,
  halfDayRuleHours,
  saveEmployeeScheduleSettings,
  type EmployeeHalfDayRule,
  type EmployeeScheduleConfig,
  type EmployeeScheduleMode,
} from '@/lib/employee-schedule-settings';
import { offboardEmployee, reactivateEmployee } from '@/lib/employee-lifecycle';
import { employeeVan, isTechnicalEmployee } from '@/lib/employee-work-schedule';
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
const HALF_DAY_WEEKDAYS = [
  { value: '', label: 'Select weekday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
] as const;
const PROFILE_TABS = [
  { value: 'profile', label: 'Profile & Employment' },
  { value: 'access', label: 'Profile & Access' },
  { value: 'schedule', label: 'Work Schedule' },
  { value: 'timeOff', label: 'Time Off & Exceptions' },
  { value: 'lifecycle', label: 'Employment Lifecycle' },
] as const;
const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
] as const;

type LoginEmailKind = 'company' | 'personal';
type ProfileTab = (typeof PROFILE_TABS)[number]['value'];
type LifecycleProfile = CanonicalStaffProfile & {
  loginEmail?: string;
  loginEmailKind?: LoginEmailKind;
  formerLoginEmails?: string[];
  employmentStartedAt?: string;
  employmentEndedAt?: string;
  offboardingReason?: string;
  offboardingCleanupPending?: boolean;
  // Deprecated fields introduced by PR #413. They are neutralized on the next profile/schedule save.
  weeklyDayOffWeekday?: number | null;
  weeklyDayOffEffectiveFrom?: string | null;
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
type ScheduleDraft = {
  mode: EmployeeScheduleMode;
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: string;
  halfDayWeekday: string;
  halfDayOffPeriod: HalfDayOffPeriod;
  halfDayRule: EmployeeHalfDayRule;
  effectiveFrom: string;
};
type TimeOffDraft = { fromDate: string; toDate: string; reason: string; notes: string };
type OffboardDraft = { endDate: string; reason: string; releaseLoginEmail: boolean };
type PreviewRow = {
  weekday: number;
  short: string;
  label: string;
  status: 'working' | 'partial' | 'off';
  start: string;
  end: string;
  breakLabel: string;
  workedHours: number;
  paidFreeHours: number;
  note: string;
};

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
  const canManageIndividualSchedule = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const today = todayKey();
  const isNew = employee === null;
  const initialTechnical = employee ? isTechnicalEmployee(employee) : false;
  const [activeTab, setActiveTab] = useState<ProfileTab>(isNew ? 'profile' : 'schedule');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<EmployeePayrollSettings[]>([]);
  const [draft, setDraft] = useState<EmployeeDraft>(() => newEmployeeDraft());
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => scheduleDraftFromConfig(employeeScheduleConfig(undefined, initialTechnical), today));
  const [timeOffDraft, setTimeOffDraft] = useState<TimeOffDraft>({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
  const [offboardDraft, setOffboardDraft] = useState<OffboardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    const technical = employee ? isTechnicalEmployee(employee) : false;
    setActiveTab(employee ? 'schedule' : 'profile');
    setDraft(employee ? draftFromProfile(employee as LifecycleProfile) : newEmployeeDraft());
    setScheduleDraft(scheduleDraftFromConfig(employeeScheduleConfig(undefined, technical), today));
    setTimeOffDraft({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setOffboardDraft(null);
    setPayrollSettings([]);
    setError('');
    setMessage('');

    if (canManageAccess) {
      void listManagedUsers().then(setUsers).catch((cause) => setError(`ERP access information could not be loaded: ${errorText(cause)}`));
    } else {
      setUsers([]);
    }

    if (employee && canManageIndividualSchedule) {
      setScheduleLoading(true);
      void loadEmployeePayrollSettings()
        .then((settings) => {
          setPayrollSettings(settings);
          const existing = payrollSettingsForEmployee(settings, employee);
          setScheduleDraft(scheduleDraftFromConfig(employeeScheduleConfig(existing, technical), today));
        })
        .catch((cause) => setError(`Employee schedule settings could not be loaded: ${errorText(cause)}`))
        .finally(() => setScheduleLoading(false));
    } else {
      setScheduleLoading(false);
    }
  }, [open, employee?.id, canManageAccess, canManageIndividualSchedule, today]);

  const userByStaffId = useMemo(() => new Map(users.filter((user) => user.staffId).map((user) => [String(user.staffId), user])), [users]);
  const userByEmail = useMemo(() => new Map(users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user])), [users]);
  const profile = operations.staffProfiles.find((item) => item.id === draft.id) as LifecycleProfile | undefined;
  const linkedUser = userByStaffId.get(draft.id);

  useEffect(() => {
    if (!open || !employee || !canManageAccess || !linkedUser) return;
    setDraft(draftFromProfile(employee as LifecycleProfile, linkedUser));
  }, [open, employee?.id, canManageAccess, linkedUser?.uid]);

  if (!open) return null;

  const technical = profile ? isTechnicalEmployee(profile) : draft.employeeType === 'Técnico';
  const selectedVan = profile ? employeeVan(profile, operations.vans) : null;
  const selectedVanId = selectedVan ? canonicalVanId(selectedVan.id, operations.vans) : '';
  const selectedHalfDay = selectedVanId
    ? operations.vanHalfDaySchedules.find((rule) => canonicalVanId(rule.vanId, operations.vans) === selectedVanId && rule.active !== false)
    : undefined;
  const individualSchedule = profile ? payrollSettingsForEmployee(payrollSettings, profile) : undefined;
  const selectedAbsences = profile
    ? operations.staffAbsences
      .filter((absence) => absence.staffId === profile.id && absence.active !== false)
      .sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? '')))
      .slice(0, 8)
    : [];
  const weeklyPreview = buildWeeklyPreview(scheduleDraft, technical, selectedHalfDay);
  const weeklyWorkedHours = weeklyPreview.reduce((sum, row) => sum + row.workedHours, 0);
  const weeklyPaidFreeHours = weeklyPreview.reduce((sum, row) => sum + row.paidFreeHours, 0);
  const activeScheduleSource = scheduleDraft.mode === 'custom'
    ? 'employeePayrollSettings · employee custom override'
    : technical && selectedHalfDay
      ? `${selectedVanId || 'Van/team'} · inherited partial-day fallback`
      : 'Company default · Mon–Sat 08:00–17:00';

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
    setScheduleDraft((current) => ({
      ...current,
      halfDayRule: employeeType === 'Técnico' ? 'technician-5-3' : 'office-4-4',
    }));
  }

  async function saveEmployee() {
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const contactEmail = draft.contactEmail.trim().toLowerCase();
    const loginEmail = draft.loginEmail.trim().toLowerCase();
    if (!name) return setError('Full name is required.');
    if (!phone) return setError('Phone number is required.');
    if (draft.createAccess && canManageAccess && !loginEmail) return setError('ERP login email is required when sign-in access is enabled.');

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
        weeklyDayOffWeekday: null,
        weeklyDayOffEffectiveFrom: null,
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
      if (isNew) onClose();
      else setMessage(`Employee profile saved for ${name}.`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveWorkSchedule() {
    if (!profile || isNew) return setError('Save the employee profile before assigning a work schedule.');
    if (!canManageIndividualSchedule) return setError('Only the owner / administrator or authorized finance user can change an employee work schedule.');
    const weekday = scheduleDraft.halfDayWeekday ? Number(scheduleDraft.halfDayWeekday) : null;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveEmployeeScheduleSettings({
        employee: profile,
        existing: individualSchedule,
        mode: scheduleDraft.mode,
        workdayStart: scheduleDraft.workdayStart,
        workdayEnd: scheduleDraft.workdayEnd,
        breakMinutes: Number(scheduleDraft.breakMinutes),
        halfDayWeekday: weekday,
        halfDayOffPeriod: scheduleDraft.halfDayOffPeriod,
        halfDayRule: scheduleDraft.halfDayRule,
        effectiveFrom: scheduleDraft.effectiveFrom,
      });
      setPayrollSettings((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      // Neutralize obsolete full-day fields. Runtime scheduling only reads the governed schedule resolver.
      await saveCanonicalStaffProfile({ ...profile, weeklyDayOffWeekday: null, weeklyDayOffEffectiveFrom: null } as LifecycleProfile);
      setMessage(scheduleDraft.mode === 'custom'
        ? `Custom work schedule saved for ${staffDisplayName(profile)}.`
        : `${staffDisplayName(profile)} now uses the governed default / inherited schedule.`);
      await onChanged(profile.id);
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
    setBusy(true); setError(''); setMessage('');
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

  function applyShiftTemplate(template: keyof typeof EMPLOYEE_SHIFT_TEMPLATES) {
    const value = EMPLOYEE_SHIFT_TEMPLATES[template];
    setScheduleDraft((current) => ({
      ...current,
      mode: 'custom',
      workdayStart: value.workdayStart,
      workdayEnd: value.workdayEnd,
      breakMinutes: String(value.breakMinutes),
    }));
  }

  const profileSaveVisible = (activeTab === 'profile' || activeTab === 'access')
    && (isNew || profile?.active !== false)
    && canManageEmployees;
  const scheduleSaveVisible = activeTab === 'schedule' && !isNew && profile?.active !== false && canManageIndividualSchedule;

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className={`${styles.modal} ${styles.profileModal}`} role="dialog" aria-modal="true" aria-label={isNew ? 'Add employee' : 'Employee profile'}>
      <header className={styles.profileHero}>
        <div className={styles.profileIdentity}>
          <div className={styles.profileAvatar}>{initials(draft.name || 'New Employee')}</div>
          <div>
            <span className={styles.eyebrow}>{isNew ? 'New employee' : 'Canonical employee profile'}</span>
            <div className={styles.profileTitleRow}>
              <h2>{isNew ? 'Add Employee' : draft.name}</h2>
              {!isNew ? <span className={profile?.active === false ? styles.formerStatus : styles.status}>{profile?.active === false ? 'Former employee' : 'Active employee'}</span> : null}
            </div>
            <p>{isNew ? 'Create one master staff identity, then assign access and scheduling from this profile.' : `${profile?.role ?? draft.role} · ${draft.employeeType}`}</p>
          </div>
        </div>
        <div className={styles.profileHeaderActions}>
          {profileSaveVisible ? <button className={styles.primaryButton} type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button> : null}
          {scheduleSaveVisible ? <button className={styles.primaryButton} type="button" onClick={() => void saveWorkSchedule()} disabled={busy || scheduleLoading}>{busy ? 'Saving…' : 'Save Schedule'}</button> : null}
          <button className={styles.button} type="button" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </header>

      {!isNew ? <div className={styles.profileMetaStrip}>
        <ProfileMeta label="Employee ID" value={draft.id} />
        <ProfileMeta label="Position" value={profile?.role ?? draft.role} />
        <ProfileMeta label="Employee type" value={draft.employeeType} />
        <ProfileMeta label="Employment" value={profile?.employmentStartedAt ? `Since ${profile.employmentStartedAt}` : 'Start date not recorded'} />
        <ProfileMeta label="Main van" value={selectedVanId || 'Unassigned'} />
      </div> : null}

      <nav className={styles.profileTabs} aria-label="Employee profile sections">
        {PROFILE_TABS.map((tab) => {
          const disabled = isNew && (tab.value === 'schedule' || tab.value === 'timeOff' || tab.value === 'lifecycle');
          return <button
            key={tab.value}
            className={`${styles.profileTab} ${activeTab === tab.value ? styles.profileTabActive : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            disabled={disabled}
            onClick={() => setActiveTab(tab.value)}
          >{tab.label}</button>;
        })}
      </nav>

      <div className={styles.modalBody}>
        {message ? <div className={styles.success}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {activeTab === 'profile' ? <div className={styles.tabContent}>
          {!isNew ? <div className={styles.summaryGrid}>
            <Summary label="Availability" value={profile?.active === false ? 'Inactive' : activeStaffAbsence(draft.id, today, operations.staffAbsences)?.reason ?? profile?.availability ?? 'Disponible'} />
            <Summary label="ERP access" value={linkedUser ? `${linkedUser.active ? 'Active' : 'Disabled'} · ${linkedUser.role}` : canManageAccess ? 'No sign-in account' : 'Owner controlled'} />
            <Summary label="Schedule" value={scheduleDraft.mode === 'custom' ? `${scheduleDraft.workdayStart}–${scheduleDraft.workdayEnd}` : 'Company / inherited'} />
            <Summary label="Sunday" value="Company closed" />
          </div> : null}
          <PremiumPanel title="Personal & Employment Information" subtitle="One canonical profile feeds scheduling, attendance, payroll references and historical work records.">
            <div className={styles.formGrid}>
              <Field label="Full name"><input className={styles.control} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field>
              <Field label="Phone"><input className={styles.control} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field>
              <Field label="Contact / personal email"><input className={styles.control} type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field>
              <Field label="Employment start date"><input className={styles.control} type="date" value={draft.employmentStartedAt} onChange={(event) => setDraft({ ...draft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field>
              <Field label="Employee type"><select className={styles.control} value={draft.employeeType} onChange={(event) => changeEmployeeType(event.target.value)} disabled={!canManageEmployees || profile?.active === false}>{EMPLOYEE_TYPES.map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Operational job role"><select className={styles.control} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} disabled={!canManageEmployees || profile?.active === false}>{rolesForType(draft.employeeType).map((value) => <option key={value}>{value}</option>)}</select></Field>
              {draft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select className={styles.control} value={draft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setDraft({ ...draft, canDriveVan: event.target.value === 'yes' })} disabled={!canManageEmployees || profile?.active === false}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}
              {draft.employeeType === 'Técnico' ? <Field label="Skills"><input className={styles.control} value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} placeholder="Service, installation, diagnostics…" disabled={!canManageEmployees || profile?.active === false} /></Field> : null}
              <Field label="Internal notes" full><textarea className={styles.textarea} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManageEmployees || profile?.active === false} /></Field>
            </div>
          </PremiumPanel>
          {profileSaveVisible ? <div className={styles.footer}><button className={styles.button} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={styles.primaryButton} type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create Employee' : 'Save Employee'}</button></div> : null}
        </div> : null}

        {activeTab === 'access' ? <div className={styles.tabContent}>
          <PremiumPanel title="ERP Access & Login" subtitle="Operational job role and ERP permissions remain separate. Contact email never silently becomes a login credential.">
            {canManageAccess ? <>
              <div className={styles.formGrid}>
                <Field label="ERP sign-in"><select className={styles.control} value={draft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setDraft({ ...draft, createAccess: event.target.value === 'enabled' })} disabled={profile?.active === false}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>
                {draft.createAccess ? <Field label="ERP login email"><input className={styles.control} type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} disabled={profile?.active === false} /></Field> : null}
                {draft.createAccess ? <Field label="Login email ownership"><select className={styles.control} value={draft.loginEmailKind} onChange={(event) => setDraft({ ...draft, loginEmailKind: event.target.value as LoginEmailKind })} disabled={profile?.active === false}><option value="company">Company email · reusable</option><option value="personal">Personal email · not reused</option></select></Field> : null}
                {draft.createAccess ? <Field label="Access role"><select className={styles.control} value={draft.accessRole} onChange={(event) => setDraft({ ...draft, accessRole: event.target.value as ManagedUserRole })} disabled={profile?.active === false}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
                {draft.createAccess ? <Field label="Account status"><select className={styles.control} value={draft.accessActive ? 'active' : 'disabled'} onChange={(event) => setDraft({ ...draft, accessActive: event.target.value === 'active' })} disabled={profile?.active === false}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}
              </div>
              {!isNew && linkedUser ? <div className={styles.inlineActions}><button className={styles.button} type="button" onClick={() => void sendAccessEmail()} disabled={busy}>Send / Reset Password Email</button></div> : null}
              <div className={styles.info}>Firebase identity remains distinct from the employee record. Login changes never create a second staff profile.</div>
            </> : <div className={styles.info}>Only the owner / administrator can create or change ERP sign-in accounts.</div>}
          </PremiumPanel>
          {profileSaveVisible ? <div className={styles.footer}><button className={styles.button} type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={styles.primaryButton} type="button" onClick={() => void saveEmployee()} disabled={busy}>{busy ? 'Saving…' : 'Save Access & Profile'}</button></div> : null}
        </div> : null}

        {activeTab === 'schedule' && !isNew ? <div className={styles.scheduleWorkspace}>
          <div className={styles.scheduleMain}>
            <PremiumPanel title="Schedule Mode" subtitle="Choose the governed source for this employee. A custom employee schedule overrides the technical Van/team fallback.">
              <div className={styles.scheduleModeGrid}>
                <button className={`${styles.choiceCard} ${scheduleDraft.mode === 'custom' ? styles.choiceCardActive : ''}`} type="button" onClick={() => setScheduleDraft({ ...scheduleDraft, mode: 'custom' })} disabled={!canManageIndividualSchedule || profile?.active === false}>
                  <span className={styles.choiceIndicator}>{scheduleDraft.mode === 'custom' ? '●' : '○'}</span>
                  <span><strong>Use custom employee schedule</strong><small>Define this employee’s shift and recurring partial day directly in the profile.</small></span>
                </button>
                <button className={`${styles.choiceCard} ${scheduleDraft.mode === 'company-default' ? styles.choiceCardActive : ''}`} type="button" onClick={() => setScheduleDraft({ ...scheduleDraft, mode: 'company-default' })} disabled={!canManageIndividualSchedule || profile?.active === false}>
                  <span className={styles.choiceIndicator}>{scheduleDraft.mode === 'company-default' ? '●' : '○'}</span>
                  <span><strong>Use company / inherited default</strong><small>{technical ? 'Technician inherits the Van/team partial-day rule when available.' : 'Uses the DEMAC company schedule without an employee override.'}</small></span>
                </button>
              </div>
            </PremiumPanel>

            <PremiumPanel title="Shift Templates" subtitle="Apply a standard DEMAC shift, then fine-tune before saving if needed.">
              <div className={styles.shiftTemplateGrid}>
                <button className={styles.shiftTemplateCard} type="button" onClick={() => applyShiftTemplate('office')} disabled={!canManageIndividualSchedule || profile?.active === false}>
                  <span><strong>Office Shift</strong><small>Standard</small></span><b>08:00 AM – 05:00 PM</b><em>1 hour break · 8 paid hours</em>
                </button>
                <button className={styles.shiftTemplateCard} type="button" onClick={() => applyShiftTemplate('late')} disabled={!canManageIndividualSchedule || profile?.active === false}>
                  <span><strong>Late Shift</strong><small>Alternative</small></span><b>09:00 AM – 06:00 PM</b><em>1 hour break · 8 paid hours</em>
                </button>
              </div>
            </PremiumPanel>

            <PremiumPanel title="Employee Work Schedule" subtitle="Sunday is locked as company-closed. The selected partial day is paid according to the employee rule.">
              {scheduleLoading ? <div className={styles.info}>Loading employee schedule…</div> : null}
              <div className={styles.formGrid}>
                <Field label="Shift start"><input className={styles.control} type="time" value={scheduleDraft.workdayStart} onChange={(event) => setScheduleDraft({ ...scheduleDraft, workdayStart: event.target.value })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading} /></Field>
                <Field label="Shift end"><input className={styles.control} type="time" value={scheduleDraft.workdayEnd} onChange={(event) => setScheduleDraft({ ...scheduleDraft, workdayEnd: event.target.value })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading} /></Field>
                <Field label="Break duration"><select className={styles.control} value={scheduleDraft.breakMinutes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, breakMinutes: event.target.value })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option></select></Field>
                <Field label="Effective from"><input className={styles.control} type="date" value={scheduleDraft.effectiveFrom} onChange={(event) => setScheduleDraft({ ...scheduleDraft, effectiveFrom: event.target.value })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading} /></Field>
                <Field label="Partial-day weekday"><select className={styles.control} value={scheduleDraft.halfDayWeekday} onChange={(event) => setScheduleDraft({ ...scheduleDraft, halfDayWeekday: event.target.value })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading}>{HALF_DAY_WEEKDAYS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}</select></Field>
                <Field label="Free period"><select className={styles.control} value={scheduleDraft.halfDayOffPeriod} onChange={(event) => setScheduleDraft({ ...scheduleDraft, halfDayOffPeriod: event.target.value as HalfDayOffPeriod })} disabled={scheduleDraft.mode !== 'custom' || !canManageIndividualSchedule || scheduleLoading}><option value="afternoon">Afternoon off · works first</option><option value="morning">Morning off · works later</option></select></Field>
              </div>

              <div className={styles.scheduleTableWrap}>
                <table className={styles.scheduleTable}>
                  <thead><tr><th>Day</th><th>Status</th><th>Start</th><th>End</th><th>Break</th><th>Rule / notes</th></tr></thead>
                  <tbody>{weeklyPreview.map((row) => <tr key={row.weekday}><td><strong>{row.label}</strong></td><td><span className={`${styles.dayStatus} ${row.status === 'partial' ? styles.dayStatusPartial : row.status === 'off' ? styles.dayStatusOff : ''}`}>{row.status === 'working' ? 'Working day' : row.status === 'partial' ? 'Partial day' : 'Off day'}</span></td><td>{row.start || '—'}</td><td>{row.end || '—'}</td><td>{row.breakLabel}</td><td>{row.note}</td></tr>)}</tbody>
                </table>
              </div>

              <div className={styles.info}>Schedule authority: <strong>{activeScheduleSource}</strong>. Employment start/end dates and dated absences remain separate gates, and Sunday cannot be overridden.</div>
              {scheduleSaveVisible ? <div className={styles.inlineActions}><button className={styles.primaryButton} type="button" onClick={() => void saveWorkSchedule()} disabled={busy || scheduleLoading}>{busy ? 'Saving…' : 'Save Work Schedule'}</button></div> : <div className={styles.info}>This schedule is payroll-sensitive. The owner/administrator or an authorized finance user can edit it.</div>}
            </PremiumPanel>
          </div>

          <aside className={styles.scheduleAside}>
            <PremiumPanel title="Weekly Overview" subtitle="Resolved preview of physical and paid hours.">
              <div className={styles.weeklyBars}>{weeklyPreview.map((row) => <div className={styles.weeklyBarRow} key={row.weekday}><span>{row.short}</span><div className={styles.weeklyBarTrack}><i className={`${styles.weeklyBarFill} ${row.status === 'partial' ? styles.weeklyBarPartial : row.status === 'off' ? styles.weeklyBarOff : ''}`} style={{ width: `${Math.min(100, (row.workedHours / 8) * 100)}%` }} /></div><b>{formatHour(row.workedHours)}h</b></div>)}</div>
              <div className={styles.weeklyTotals}><span><small>Worked</small><strong>{formatHour(weeklyWorkedHours)}h</strong></span><span><small>Paid free</small><strong>{formatHour(weeklyPaidFreeHours)}h</strong></span><span><small>Total paid</small><strong>{formatHour(weeklyWorkedHours + weeklyPaidFreeHours)}h</strong></span></div>
            </PremiumPanel>

            <PremiumPanel title="Partial-Day Rule" subtitle="Choose the policy that applies to this employee’s recurring free period.">
              <button className={`${styles.ruleCard} ${scheduleDraft.halfDayRule === 'office-4-4' ? styles.ruleCardActive : ''}`} type="button" onClick={() => setScheduleDraft({ ...scheduleDraft, mode: 'custom', halfDayRule: 'office-4-4' })} disabled={!canManageIndividualSchedule || profile?.active === false}><span className={styles.ruleIcon}>O</span><span><strong>Office / Admin / Operator</strong><small>4 hours worked + 4 hours paid free</small></span></button>
              <button className={`${styles.ruleCard} ${scheduleDraft.halfDayRule === 'technician-5-3' ? styles.ruleCardActive : ''}`} type="button" onClick={() => setScheduleDraft({ ...scheduleDraft, mode: 'custom', halfDayRule: 'technician-5-3' })} disabled={!canManageIndividualSchedule || profile?.active === false}><span className={styles.ruleIcon}>T</span><span><strong>Technician / Field</strong><small>5 hours worked + 3 hours paid free</small></span></button>
            </PremiumPanel>

            <PremiumPanel title="Current Source" subtitle="One resolver controls calendar, attendance and payroll schedule calculations.">
              <div className={styles.sourceCard}><span>Active source</span><strong>{activeScheduleSource}</strong></div>
              {technical && scheduleDraft.mode === 'company-default' ? <div className={styles.sourceCard}><span>Inherited Van rule</span><strong>{selectedHalfDay ? `${weekdayLabel(selectedHalfDay.weekday)} · ${selectedHalfDay.workdayStart ?? '08:00'}–${selectedHalfDay.workdayEnd ?? '13:00'}` : 'No Van partial day configured'}</strong></div> : null}
            </PremiumPanel>
          </aside>
        </div> : null}

        {activeTab === 'timeOff' && !isNew ? <div className={styles.tabContent}>
          <PremiumPanel title="Time Off & Exceptions" subtitle="Dated vacation, sick leave and one-off unavailability stay separate from the recurring weekly schedule.">
            {profile?.active !== false && canManageEmployees ? <div className={styles.timeOffBox}>
              <strong>Add dated time off / unavailability</strong>
              <div className={styles.formGrid} style={{ marginTop: 10 }}>
                <Field label="From"><input className={styles.control} type="date" value={timeOffDraft.fromDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, fromDate: event.target.value })} /></Field>
                <Field label="To"><input className={styles.control} type="date" value={timeOffDraft.toDate} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, toDate: event.target.value })} /></Field>
                <Field label="Type"><select className={styles.control} value={timeOffDraft.reason} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, reason: event.target.value })}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                <Field label="Notes"><input className={styles.control} value={timeOffDraft.notes} onChange={(event) => setTimeOffDraft({ ...timeOffDraft, notes: event.target.value })} /></Field>
              </div>
              <div className={styles.inlineActions}><button className={styles.primaryButton} type="button" onClick={() => void addTimeOff()} disabled={busy}>Save Time Off</button></div>
            </div> : null}
            {selectedAbsences.length ? <div className={styles.history}><strong>Recent / current exceptions</strong>{selectedAbsences.map((absence) => <div className={styles.historyRow} key={absence.id}><span>{absence.reason ?? 'Unavailable'}</span><span>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</span><small>{absence.notes ?? ''}</small></div>)}</div> : <div className={styles.emptyState}>No dated time-off records are currently attached to this employee.</div>}
          </PremiumPanel>
        </div> : null}

        {activeTab === 'lifecycle' && !isNew && profile ? <div className={styles.tabContent}>
          <PremiumPanel title="Employment Lifecycle" subtitle="Former employees are archived, never deleted, so historical work, attendance and payroll references remain intact.">
            {profile.active !== false ? <div className={styles.dangerZone}><div><strong>Offboard employee</strong><span>Disables access and removes future crew assignments while preserving history.</span></div><button className={styles.dangerButton} type="button" onClick={() => setOffboardDraft({ endDate: today, reason: '', releaseLoginEmail: Boolean(linkedUser) && (profile.loginEmailKind ?? defaultLoginEmailKind(inferredEmployeeType(profile))) === 'company' })} disabled={!canManageAccess || busy}>Start Offboarding</button></div> : <div className={styles.dangerZone}><div><strong>Former employee</strong><span>{profile.employmentEndedAt ? `Employment ended ${profile.employmentEndedAt}. ` : ''}{profile.offboardingReason ?? ''}</span></div><button className={styles.button} type="button" onClick={() => void confirmReactivate()} disabled={!canManageAccess || busy}>Reactivate Employee</button></div>}
          </PremiumPanel>
        </div> : null}
      </div>
    </section>

    {offboardDraft ? <div className={styles.backdrop} style={{ zIndex: 1500 }} role="presentation"><section className={styles.modal} style={{ width: 'min(620px,100%)' }} role="dialog" aria-modal="true" aria-label="Offboard employee"><header className={styles.modalHeader}><div><span className={styles.eyebrow}>Employment lifecycle</span><h2>Offboard {profile ? staffDisplayName(profile) : draft.name}</h2><p>Archive safely; never delete historical employee records.</p></div><button className={styles.button} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Close</button></header><div className={styles.modalBody}><div className={styles.formGrid}><Field label="Last employment date"><input className={styles.control} type="date" value={offboardDraft.endDate} onChange={(event) => setOffboardDraft({ ...offboardDraft, endDate: event.target.value })} /></Field><Field label="Reason"><input className={styles.control} value={offboardDraft.reason} onChange={(event) => setOffboardDraft({ ...offboardDraft, reason: event.target.value })} placeholder="Resigned, contract ended, terminated…" /></Field></div><label className={styles.checkCard}><input type="checkbox" checked={offboardDraft.releaseLoginEmail} onChange={(event) => setOffboardDraft({ ...offboardDraft, releaseLoginEmail: event.target.checked })} /><span><strong>Release reusable company login email</strong><small>The former identity is archived; the email may then be assigned to a replacement employee.</small></span></label><div className={styles.warning}>Regular van membership and future dated assignments are removed. Historical work orders, visits, attendance, payroll and audit records remain linked to this employee identity.</div>{error ? <div className={styles.error}>{error}</div> : null}<div className={styles.footer}><button className={styles.button} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Cancel</button><button className={styles.dangerButton} type="button" onClick={() => void confirmOffboard()} disabled={busy}>{busy ? 'Offboarding…' : 'Confirm Offboarding'}</button></div></div></section></div> : null}
  </div>;
}

function PremiumPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <section className={styles.premiumPanel}><header className={styles.premiumPanelHeader}><div><h3>{title}</h3><p>{subtitle}</p></div></header><div className={styles.premiumPanelBody}>{children}</div></section>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className={styles.summaryCard}><span>{label}</span><strong>{value}</strong></div>; }
function ProfileMeta({ label, value }: { label: string; value: string }) { return <div className={styles.profileMeta}><span>{label}</span><strong>{value}</strong></div>; }
function todayKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function normalizeName(value: string) { return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '); }
function normalizePhone(value: string) { return value.replace(/\D/g, ''); }
function rolesForType(employeeType: string) { return employeeType === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES; }
function defaultRole(employeeType: string) { if (employeeType === 'Técnico') return 'Ayudante'; if (employeeType === 'Secretaria') return 'Secretaria'; if (employeeType === 'Administración') return 'Administración'; return 'Otro'; }
function defaultAccessRole(employeeType: string): ManagedUserRole { return employeeType === 'Técnico' ? 'technician' : 'office'; }
function defaultLoginEmailKind(employeeType: string): LoginEmailKind { return employeeType === 'Técnico' ? 'personal' : 'company'; }
function inferredEmployeeType(profile: CanonicalStaffProfile) { if (profile.employeeType) return profile.employeeType; if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '')) return 'Técnico'; if (profile.role === 'Secretaria') return 'Secretaria'; return 'Administración'; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'E'; }
function formatHour(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

function newEmployeeDraft(): EmployeeDraft { return { id: `staff-${crypto.randomUUID()}`, name: '', phone: '', contactEmail: '', employeeType: 'Secretaria', role: 'Secretaria', canDriveVan: false, skillsText: '', notes: '', employmentStartedAt: todayKey(), createAccess: true, accessRole: 'office', accessActive: true, loginEmail: '', loginEmailKind: 'company' }; }
function draftFromProfile(profile: LifecycleProfile, linkedUser?: ManagedUser): EmployeeDraft { const employeeType = inferredEmployeeType(profile); return { id: profile.id, name: profile.name ?? '', phone: profile.phone ?? '', contactEmail: profile.email ?? '', employeeType, role: profile.role ?? defaultRole(employeeType), canDriveVan: profile.canDriveVan === true, skillsText: (profile.skills ?? []).join(', '), notes: profile.notes ?? '', employmentStartedAt: profile.employmentStartedAt ?? '', createAccess: Boolean(linkedUser), accessRole: linkedUser?.role ?? defaultAccessRole(employeeType), accessActive: linkedUser?.active ?? true, loginEmail: linkedUser?.email ?? profile.loginEmail ?? '', loginEmailKind: profile.loginEmailKind ?? defaultLoginEmailKind(employeeType) }; }
function scheduleDraftFromConfig(config: EmployeeScheduleConfig, today: string): ScheduleDraft { return { mode: config.mode, workdayStart: config.workdayStart, workdayEnd: config.workdayEnd, breakMinutes: String(config.breakMinutes), halfDayWeekday: config.halfDayWeekday ? String(config.halfDayWeekday) : '', halfDayOffPeriod: config.halfDayOffPeriod, halfDayRule: config.halfDayRule, effectiveFrom: config.effectiveFrom ?? today }; }

function buildWeeklyPreview(
  draft: ScheduleDraft,
  technical: boolean,
  inheritedHalfDay?: { weekday?: number; workdayStart?: string; workdayEnd?: string },
): PreviewRow[] {
  const defaultStart = '08:00';
  const defaultEnd = '17:00';
  const custom = draft.mode === 'custom';
  const normalStart = custom ? draft.workdayStart : defaultStart;
  const normalEnd = custom ? draft.workdayEnd : defaultEnd;
  const normalBreak = custom ? Math.max(0, Number(draft.breakMinutes) || 0) : 60;
  const grossMinutes = Math.max(0, toMinutes(normalEnd) - toMinutes(normalStart));
  const normalWorkedHours = Math.max(0, grossMinutes - normalBreak) / 60;
  const customHalfDayWeekday = custom && draft.halfDayWeekday ? Number(draft.halfDayWeekday) : null;
  const inheritedWeekday = !custom && technical && inheritedHalfDay?.weekday != null ? Number(inheritedHalfDay.weekday) : null;

  return WEEKDAYS.map((day) => {
    if (day.value === 0) return { weekday: 0, short: day.short, label: day.label, status: 'off', start: '', end: '', breakLabel: '—', workedHours: 0, paidFreeHours: 0, note: 'Company closed · locked' };

    if (customHalfDayWeekday === day.value) {
      const rule = halfDayRuleHours(draft.halfDayRule);
      const range = partialRange(normalStart, normalEnd, rule.workedHours, draft.halfDayOffPeriod);
      return {
        weekday: day.value,
        short: day.short,
        label: day.label,
        status: 'partial',
        start: range.start,
        end: range.end,
        breakLabel: '—',
        workedHours: rule.workedHours,
        paidFreeHours: rule.paidFreeHours,
        note: `${rule.workedHours}h work + ${rule.paidFreeHours}h paid free`,
      };
    }

    if (inheritedWeekday === day.value) {
      const start = inheritedHalfDay?.workdayStart ?? defaultStart;
      const end = inheritedHalfDay?.workdayEnd ?? '13:00';
      const workedHours = Math.max(0, toMinutes(end) - toMinutes(start)) / 60 || 5;
      return {
        weekday: day.value,
        short: day.short,
        label: day.label,
        status: 'partial',
        start,
        end,
        breakLabel: '—',
        workedHours,
        paidFreeHours: Math.max(0, 8 - workedHours),
        note: 'Inherited Van/team partial day',
      };
    }

    return {
      weekday: day.value,
      short: day.short,
      label: day.label,
      status: 'working',
      start: normalStart,
      end: normalEnd,
      breakLabel: `${normalBreak} min`,
      workedHours: normalWorkedHours,
      paidFreeHours: 0,
      note: custom ? 'Employee custom shift' : 'Company default',
    };
  });
}

function partialRange(start: string, end: string, workedHours: number, offPeriod: HalfDayOffPeriod) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const workedMinutes = Math.round(workedHours * 60);
  const workStart = offPeriod === 'morning' ? Math.max(startMinutes, endMinutes - workedMinutes) : startMinutes;
  const workEnd = offPeriod === 'morning' ? endMinutes : Math.min(endMinutes, startMinutes + workedMinutes);
  return { start: fromMinutes(workStart), end: fromMinutes(workEnd) };
}
function toMinutes(value: string) { const [hours, minutes] = value.split(':').map(Number); if (![hours, minutes].every(Number.isFinite)) return 0; return hours * 60 + minutes; }
function fromMinutes(value: number) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
