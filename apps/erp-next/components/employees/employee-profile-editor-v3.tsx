'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  activeStaffAbsence,
  canonicalVanId,
  loadCanonicalOperationsState,
  staffDisplayName,
  weekdayLabel,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
  type CanonicalVanHalfDaySchedule,
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
  defaultPartialDayWindow,
  employeePartialDayFromSettings,
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

type Tab = 'profile' | 'employment' | 'schedule' | 'timeoff' | 'payroll';
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
type ProfileDraft = {
  name: string;
  phone: string;
  contactEmail: string;
  employeeType: string;
  role: string;
  employmentStartedAt: string;
  canDriveVan: boolean;
  skills: string;
  notes: string;
  createAccess: boolean;
  loginEmail: string;
  loginEmailKind: LoginEmailKind;
  accessRole: ManagedUserRole;
  accessActive: boolean;
};
type ScheduleDraft = {
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  halfDayWeekday: string;
  halfDayOffPeriod: HalfDayOffPeriod;
  halfDayStartTime: string;
  halfDayEndTime: string;
  halfDayBreakMinutes: number;
  effectiveFrom: string;
  effectiveUntil: string;
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

export function EmployeeProfileEditorV3(props: Props) {
  if (!props.employee) return <LegacyEmployeeProfileEditor {...props} />;
  return <ExistingEmployeeProfile {...props} employee={props.employee} />;
}

function ExistingEmployeeProfile({ open, employee, operations, onClose, onChanged }: Props & { employee: CanonicalStaffProfile }) {
  const { principal } = useAuth();
  const canManageEmployees = principal.capabilities.has('employees.manage');
  const canManageAccess = principal.role === 'super_admin';
  const canManageSchedule = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const today = todayKey();
  const profile = (operations.staffProfiles.find((item) => item.id === employee.id) ?? employee) as LifecycleProfile;
  const technical = isTechnicalEmployee(profile);
  const van = employeeVan(profile, operations.vans);
  const vanId = van ? canonicalVanId(van.id, operations.vans) : '';
  const scheduleLockedToVan = technical && Boolean(van);
  const [tab, setTab] = useState<Tab>('schedule');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [settings, setSettings] = useState<EmployeePayrollSettings[]>([]);
  const [profileDraft, setProfileDraft] = useState(() => profileDraftFrom(profile));
  const [scheduleDraft, setScheduleDraft] = useState(() => scheduleDraftFrom(undefined, profile, today));
  const [timeOff, setTimeOff] = useState<TimeOffDraft>({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
  const [offboardDraft, setOffboardDraft] = useState<OffboardDraft | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab('schedule');
    setProfileDraft(profileDraftFrom(profile));
    setScheduleDraft(scheduleDraftFrom(undefined, profile, today));
    setTimeOff({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
    setOffboardDraft(null);
    setError('');
    setMessage('');
    setUsers([]);
    setSettings([]);

    if (canManageAccess) {
      void listManagedUsers()
        .then((managed) => {
          setUsers(managed);
          setProfileDraft(profileDraftFrom(profile, managed.find((user) => user.staffId === profile.id)));
        })
        .catch((cause) => setError(`ERP access could not be loaded: ${errorText(cause)}`));
    }
    if (!scheduleLockedToVan && canManageSchedule) {
      setLoadingSchedule(true);
      void loadEmployeePayrollSettings()
        .then((records) => {
          setSettings(records);
          setScheduleDraft(scheduleDraftFrom(payrollSettingsForEmployee(records, profile), profile, today));
        })
        .catch((cause) => setError(`Work schedule could not be loaded: ${errorText(cause)}`))
        .finally(() => setLoadingSchedule(false));
    }
  }, [open, employee.id, canManageAccess, canManageSchedule, scheduleLockedToVan, today]);

  const userByStaffId = useMemo(() => new Map(users.filter((user) => user.staffId).map((user) => [String(user.staffId), user])), [users]);
  const userByEmail = useMemo(() => new Map(users.filter((user) => user.email).map((user) => [user.email.trim().toLowerCase(), user])), [users]);
  const linkedUser = userByStaffId.get(profile.id);
  const payrollSettings = payrollSettingsForEmployee(settings, profile);
  const vanHalfDay = vanId
    ? operations.vanHalfDaySchedules.find((rule) => canonicalVanId(rule.vanId, operations.vans) === vanId)
    : undefined;
  const absences = operations.staffAbsences
    .filter((absence) => absence.staffId === profile.id && absence.active !== false)
    .sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? '')))
    .slice(0, 8);
  const availability = profile.active === false
    ? 'Inactive'
    : activeStaffAbsence(profile.id, today, operations.staffAbsences)?.reason ?? profile.availability ?? 'Disponible';

  if (!open) return null;

  async function saveProfile() {
    if (!canManageEmployees || profile.active === false) return;
    const name = profileDraft.name.trim();
    const phone = profileDraft.phone.trim();
    const contactEmail = profileDraft.contactEmail.trim().toLowerCase();
    const loginEmail = profileDraft.loginEmail.trim().toLowerCase();
    if (!name || !phone) return setError('Full name and phone number are required.');
    if (canManageAccess && profileDraft.createAccess && !loginEmail) return setError('ERP login email is required when sign-in access is enabled.');
    const duplicate = operations.staffProfiles.find((item) => item.id !== profile.id && (
      normalizeName(item.name ?? '') === normalizeName(name)
      || (normalizePhone(phone) && normalizePhone(item.phone ?? '') === normalizePhone(phone))
    ));
    if (duplicate) return setError(`A master employee profile already exists for ${staffDisplayName(duplicate)}.`);

    setBusy(true); setError(''); setMessage('');
    try {
      await saveCanonicalStaffProfile({
        ...profile,
        name,
        phone,
        email: contactEmail || undefined,
        employeeType: profileDraft.employeeType,
        role: profileDraft.role,
        employmentStartedAt: profileDraft.employmentStartedAt || profile.employmentStartedAt,
        canDriveVan: profileDraft.employeeType === 'Técnico' ? profileDraft.canDriveVan : false,
        skills: profileDraft.employeeType === 'Técnico'
          ? profileDraft.skills.split(',').map((value) => value.trim()).filter(Boolean)
          : [],
        notes: profileDraft.notes.trim() || undefined,
        loginEmailKind: canManageAccess && profileDraft.createAccess ? profileDraft.loginEmailKind : profile.loginEmailKind,
        weeklyDayOffWeekday: null,
        weeklyDayOffEffectiveFrom: null,
      } as LifecycleProfile);

      if (canManageAccess && profileDraft.createAccess) {
        const managed = linkedUser ?? userByEmail.get(loginEmail);
        if (managed) {
          if (managed.staffId && managed.staffId !== profile.id) throw new Error(`The login email ${loginEmail} is assigned to another employee.`);
          const emailChanged = managed.email.trim().toLowerCase() !== loginEmail;
          await updateManagedUser({ uid: managed.uid, name, email: loginEmail, phone, role: profileDraft.accessRole, active: profileDraft.accessActive, staffId: profile.id });
          if (emailChanged) await sendPasswordSetupEmail(loginEmail);
        } else {
          await createManagedUser({ name, email: loginEmail, phone, role: profileDraft.accessRole, active: profileDraft.accessActive, staffId: profile.id });
          await sendPasswordSetupEmail(loginEmail);
        }
      } else if (canManageAccess && linkedUser?.active) {
        await updateManagedUser({ uid: linkedUser.uid, name, email: linkedUser.email, phone, role: linkedUser.role, active: false, staffId: profile.id });
      }

      await onChanged(profile.id);
      setMessage('Employee profile saved without changing the employee identity or historical records.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveSchedule() {
    if (scheduleLockedToVan) return setError(`This technician's recurring schedule is governed by ${vanId || 'the assigned Van/team'}.`);
    if (!canManageSchedule) return setError('This schedule is payroll-protected.');
    setBusy(true); setError(''); setMessage('');
    try {
      let technicalVanAssigned: boolean | undefined;
      if (technical) {
        const latestOperations = await loadCanonicalOperationsState();
        const latestVan = employeeVan(profile, latestOperations.vans);
        if (latestVan) {
          const latestVanId = canonicalVanId(latestVan.id, latestOperations.vans);
          throw new Error(`${staffDisplayName(profile)} is now assigned to ${latestVanId}. Refresh the profile; the Van/team schedule is authoritative.`);
        }
        technicalVanAssigned = false;
      }
      const saved = await saveEmployeeScheduleSettings({
        employee: profile,
        existing: payrollSettings,
        mode: scheduleDraft.mode,
        templateId: scheduleDraft.templateId,
        weeklySchedule: scheduleDraft.weeklySchedule,
        effectiveFrom: scheduleDraft.effectiveFrom,
        effectiveUntil: scheduleDraft.effectiveUntil || null,
        halfDayWeekday: scheduleDraft.halfDayWeekday ? Number(scheduleDraft.halfDayWeekday) : null,
        halfDayOffPeriod: scheduleDraft.halfDayOffPeriod,
        halfDayStartTime: scheduleDraft.halfDayWeekday ? scheduleDraft.halfDayStartTime : null,
        halfDayEndTime: scheduleDraft.halfDayWeekday ? scheduleDraft.halfDayEndTime : null,
        halfDayBreakMinutes: scheduleDraft.halfDayWeekday ? scheduleDraft.halfDayBreakMinutes : 0,
        technicalVanAssigned,
      });
      setSettings((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      await saveCanonicalStaffProfile({ ...profile, weeklyDayOffWeekday: null, weeklyDayOffEffectiveFrom: null } as LifecycleProfile);
      await onChanged(profile.id);
      setMessage(technical
        ? 'Individual technician schedule saved. It remains active only while the technician has no canonical Van assignment.'
        : 'Work schedule saved. Partial days use the exact worked hours you entered.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveTimeOff() {
    if (!canManageEmployees) return;
    if (!timeOff.fromDate || !timeOff.toDate || timeOff.toDate < timeOff.fromDate) return setError('Choose a valid time-off range.');
    setBusy(true); setError(''); setMessage('');
    try {
      await saveCanonicalStaffAbsence({ id: `profile-${profile.id}-${crypto.randomUUID()}`, staffId: profile.id, fromDate: timeOff.fromDate, toDate: timeOff.toDate, reason: timeOff.reason, notes: timeOff.notes.trim() || undefined, active: true });
      setTimeOff({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
      await onChanged(profile.id);
      setMessage('Dated exception saved separately from the recurring schedule.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    const email = linkedUser?.email ?? profileDraft.loginEmail.trim().toLowerCase();
    if (!linkedUser || !email) return setError('Create or link ERP access first.');
    setBusy(true); setError(''); setMessage('');
    try { await sendPasswordSetupEmail(email); setMessage(`Password setup / reset email sent to ${email}.`); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function confirmOffboard() {
    if (!offboardDraft || !canManageAccess) return;
    if (!offboardDraft.reason.trim()) return setError('Enter a short offboarding reason for the audit history.');
    setBusy(true); setError(''); setMessage('');
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
    setBusy(true); setError(''); setMessage('');
    try { await reactivateEmployee(profile.id); await onChanged(profile.id); onClose(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  function applyTemplate(templateId: Exclude<EmployeeScheduleTemplateId, 'custom'>) {
    const template = OFFICE_SCHEDULE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setScheduleDraft((current) => {
      const weeklySchedule = defaultEmployeeWeeklySchedule(template.startTime, template.endTime, template.breakMinutes);
      const weekday = Number(current.halfDayWeekday);
      const key = String(weekday) as EmployeeScheduleWeekdayKey;
      const partialDay = weekday >= 1 && weekday <= 6 ? defaultPartialDayWindow(weeklySchedule[key]!, current.halfDayOffPeriod, 240) : null;
      return { ...current, mode: 'custom', templateId, weeklySchedule, halfDayStartTime: partialDay?.startTime ?? current.halfDayStartTime, halfDayEndTime: partialDay?.endTime ?? current.halfDayEndTime, halfDayBreakMinutes: partialDay?.breakMinutes ?? current.halfDayBreakMinutes };
    });
  }

  function updateDay(day: EmployeeScheduleWeekdayKey, field: 'startTime' | 'endTime' | 'breakMinutes', value: string) {
    setScheduleDraft((draft) => {
      const partial = Number(draft.halfDayWeekday) === Number(day);
      if (partial) return { ...draft, halfDayStartTime: field === 'startTime' ? value : draft.halfDayStartTime, halfDayEndTime: field === 'endTime' ? value : draft.halfDayEndTime, halfDayBreakMinutes: field === 'breakMinutes' ? Number(value) : draft.halfDayBreakMinutes };
      const current = draft.weeklySchedule[day] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
      return { ...draft, mode: 'custom', templateId: 'custom', weeklySchedule: { ...draft.weeklySchedule, [day]: { ...current, [field]: field === 'breakMinutes' ? Number(value) : value } } };
    });
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'profile', label: 'Profile & Access' },
    { id: 'employment', label: 'Employment Details' },
    { id: 'schedule', label: 'Work Schedule' },
    { id: 'timeoff', label: 'Time Off & Exceptions' },
    { id: 'payroll', label: 'Payroll & Lifecycle' },
  ];
  const headerSavesSchedule = tab === 'schedule' && !scheduleLockedToVan;
  const canUseHeaderSave = profile.active !== false && (headerSavesSchedule ? canManageSchedule : canManageEmployees);

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className={styles.shell} role="dialog" aria-modal="true" aria-label="Employee profile">
      <header className={styles.topbar}>
        <div className={styles.identity}><div className={styles.avatar}>{initials(profileDraft.name)}</div><div><span className={styles.eyebrow}>Canonical employee profile</span><div className={styles.titleRow}><h2>{profileDraft.name}</h2><span className={profile.active === false ? styles.inactiveBadge : styles.activeBadge}>{profile.active === false ? 'Former employee' : 'Active employee'}</span></div><p>{profileDraft.role} · {profileDraft.employeeType}</p></div></div>
        <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button>{canUseHeaderSave ? <button className={styles.primaryButton} type="button" onClick={() => void (headerSavesSchedule ? saveSchedule() : saveProfile())} disabled={busy || (headerSavesSchedule && loadingSchedule)}>{busy ? 'Saving…' : headerSavesSchedule ? 'Save Work Schedule' : 'Save Changes'}</button> : null}<button className={styles.closeButton} type="button" onClick={onClose} disabled={busy}>×</button></div>
      </header>

      <div className={styles.metaGrid}><Meta label="Employee ID" value={profile.id} /><Meta label="Type" value={profileDraft.employeeType} /><Meta label="Position" value={profileDraft.role} /><Meta label="Email" value={profileDraft.contactEmail || '—'} /><Meta label="Phone" value={profileDraft.phone || '—'} /><Meta label="Availability" value={availability} /></div>
      <nav className={styles.tabs}>{tabs.map((item) => <button key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} type="button" onClick={() => { setTab(item.id); setError(''); setMessage(''); }}>{item.label}</button>)}</nav>

      <div className={styles.body}>
        {message ? <div className={styles.success}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === 'profile' ? <div className={styles.twoColumn}>
          <Card title="Profile & Access" subtitle="Employee master data and authentication remain separate."><div className={styles.formGrid}><Field label="Full name"><input className={styles.control} value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field><Field label="Phone"><input className={styles.control} value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field><Field label="Contact email"><input className={styles.control} type="email" value={profileDraft.contactEmail} onChange={(event) => setProfileDraft({ ...profileDraft, contactEmail: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field></div>{canManageAccess ? <div className={styles.subsection}><div className={styles.formGrid}><Field label="ERP sign-in"><select className={styles.control} value={profileDraft.createAccess ? 'enabled' : 'disabled'} onChange={(event) => setProfileDraft({ ...profileDraft, createAccess: event.target.value === 'enabled' })} disabled={profile.active === false}><option value="enabled">Linked / create access</option><option value="disabled">No active sign-in access</option></select></Field>{profileDraft.createAccess ? <Field label="ERP login email"><input className={styles.control} type="email" value={profileDraft.loginEmail} onChange={(event) => setProfileDraft({ ...profileDraft, loginEmail: event.target.value })} disabled={profile.active === false} /></Field> : null}{profileDraft.createAccess ? <Field label="Login email ownership"><select className={styles.control} value={profileDraft.loginEmailKind} onChange={(event) => setProfileDraft({ ...profileDraft, loginEmailKind: event.target.value as LoginEmailKind })} disabled={profile.active === false}><option value="company">Company email · reusable</option><option value="personal">Personal email · not reused</option></select></Field> : null}{profileDraft.createAccess ? <Field label="Access role"><select className={styles.control} value={profileDraft.accessRole} onChange={(event) => setProfileDraft({ ...profileDraft, accessRole: event.target.value as ManagedUserRole })} disabled={profile.active === false}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}{profileDraft.createAccess ? <Field label="Account status"><select className={styles.control} value={profileDraft.accessActive ? 'active' : 'disabled'} onChange={(event) => setProfileDraft({ ...profileDraft, accessActive: event.target.value === 'active' })} disabled={profile.active === false}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field> : null}</div>{linkedUser ? <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void resetPassword()}>Send / Reset Password Email</button> : null}</div> : <Info>ERP access is owner-controlled. Editing this profile never creates a duplicate employee master.</Info>}</Card>
          <Card title="Identity Safety" subtitle="Existing history stays linked to the same employee ID."><Status label="Employee master" value="staffProfiles" /><Status label="Authentication" value="Firebase Auth" /><Status label="Historical work/payroll" value="Preserved" /><Status label="Access create/disable" value="Preserved from previous profile" /></Card>
        </div> : null}

        {tab === 'employment' ? <div className={styles.twoColumn}>
          <Card title="Employment Details" subtitle="These dates bound generated schedules and assumed attendance."><div className={styles.formGrid}><Field label="Employment start date"><input className={styles.control} type="date" value={profileDraft.employmentStartedAt} onChange={(event) => setProfileDraft({ ...profileDraft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field><Field label="Employee type"><select className={styles.control} value={profileDraft.employeeType} onChange={(event) => setProfileDraft((current) => ({ ...current, employeeType: event.target.value, role: defaultRole(event.target.value), canDriveVan: event.target.value === 'Técnico' ? current.canDriveVan : false, skills: event.target.value === 'Técnico' ? current.skills : '' }))} disabled={!canManageEmployees || profile.active === false}>{EMPLOYEE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Operational role"><select className={styles.control} value={profileDraft.role} onChange={(event) => setProfileDraft({ ...profileDraft, role: event.target.value })} disabled={!canManageEmployees || profile.active === false}>{rolesForType(profileDraft.employeeType).map((role) => <option key={role}>{role}</option>)}</select></Field>{profileDraft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select className={styles.control} value={profileDraft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setProfileDraft({ ...profileDraft, canDriveVan: event.target.value === 'yes' })} disabled={profile.active === false}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}{profileDraft.employeeType === 'Técnico' ? <Field label="Skills" full><input className={styles.control} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })} disabled={profile.active === false} /></Field> : null}</div></Card>
          <Card title="Employment Boundary" subtitle="Same rule is consumed by Calendar, Attendance and Payroll."><Status label="Before start date" value="0 scheduled hours" /><Status label="Start date" value="Inclusive" /><Status label="After employment end" value="0 scheduled hours" /><Info>Historical explicit records are not deleted or rewritten.</Info></Card>
        </div> : null}

        {tab === 'schedule' ? <ScheduleEditor technical={technical} canManage={canManageSchedule && profile.active !== false} loading={loadingSchedule} draft={scheduleDraft} setDraft={setScheduleDraft} onApplyTemplate={applyTemplate} onUpdateDay={updateDay} onSave={() => void saveSchedule()} busy={busy} vanId={vanId} vanHalfDay={vanHalfDay} settings={payrollSettings} /> : null}

        {tab === 'timeoff' ? <div className={styles.twoColumn}>
          <Card title="Time Off & Exceptions" subtitle="Vacation, sickness and one-off unavailability stay date-scoped."><div className={styles.formGrid}><Field label="From"><input className={styles.control} type="date" value={timeOff.fromDate} onChange={(event) => setTimeOff({ ...timeOff, fromDate: event.target.value })} disabled={profile.active === false} /></Field><Field label="To"><input className={styles.control} type="date" value={timeOff.toDate} onChange={(event) => setTimeOff({ ...timeOff, toDate: event.target.value })} disabled={profile.active === false} /></Field><Field label="Type"><select className={styles.control} value={timeOff.reason} onChange={(event) => setTimeOff({ ...timeOff, reason: event.target.value })} disabled={profile.active === false}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Notes"><input className={styles.control} value={timeOff.notes} onChange={(event) => setTimeOff({ ...timeOff, notes: event.target.value })} disabled={profile.active === false} /></Field></div><div className={styles.actionRow}><button className={styles.primaryButton} type="button" onClick={() => void saveTimeOff()} disabled={!canManageEmployees || busy || profile.active === false}>Save Time Off</button></div></Card>
          <Card title="Recent / Current Exceptions" subtitle="Source: staffAbsences">{absences.length ? <div className={styles.history}>{absences.map((absence) => <div className={styles.historyRow} key={absence.id}><div><strong>{absence.reason ?? 'Unavailable'}</strong><span>{absence.notes ?? 'No notes'}</span></div><time>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</time></div>)}</div> : <Info>No current or recent exceptions.</Info>}</Card>
        </div> : null}

        {tab === 'payroll' ? <div className={styles.twoColumn}><Card title="Payroll Notes" subtitle="Notes do not alter schedule calculations."><Field label="Internal notes"><textarea className={styles.textarea} value={profileDraft.notes} onChange={(event) => setProfileDraft({ ...profileDraft, notes: event.target.value })} disabled={!canManageEmployees || profile.active === false} /></Field><Info>New schedule fields are additive on the existing payroll settings record. Existing attendance and payroll documents are not rewritten.</Info></Card><Card title="Employment Lifecycle" subtitle="Former employees are archived, never deleted.">{profile.active !== false ? <>{offboardDraft ? <div className={styles.subsection}><Field label="Last employment date"><input className={styles.control} type="date" value={offboardDraft.endDate} onChange={(event) => setOffboardDraft({ ...offboardDraft, endDate: event.target.value })} /></Field><Field label="Reason"><input className={styles.control} value={offboardDraft.reason} onChange={(event) => setOffboardDraft({ ...offboardDraft, reason: event.target.value })} placeholder="Resigned, contract ended, terminated…" /></Field><label className={styles.checkbox}><input type="checkbox" checked={offboardDraft.releaseLoginEmail} onChange={(event) => setOffboardDraft({ ...offboardDraft, releaseLoginEmail: event.target.checked })} /> Release reusable company login email</label><div className={styles.actionRow}><button className={styles.secondaryButton} type="button" onClick={() => setOffboardDraft(null)} disabled={busy}>Cancel</button><button className={styles.dangerButton} type="button" onClick={() => void confirmOffboard()} disabled={!canManageAccess || busy}>Confirm Offboarding</button></div></div> : <div className={styles.dangerCard}><div><strong>Offboard employee</strong><span>Disables access and removes future crew assignments while preserving history.</span></div><button className={styles.dangerButton} type="button" onClick={() => setOffboardDraft({ endDate: today, reason: '', releaseLoginEmail: Boolean(linkedUser) && (profile.loginEmailKind ?? defaultLoginEmailKind(profileDraft.employeeType)) === 'company' })} disabled={!canManageAccess || busy}>Start Offboarding</button></div>}</> : <div className={styles.dangerCard}><div><strong>Former employee</strong><span>{profile.employmentEndedAt ? `Employment ended ${profile.employmentEndedAt}. ` : ''}{profile.offboardingReason ?? ''}</span></div><button className={styles.secondaryButton} type="button" onClick={() => void confirmReactivate()} disabled={!canManageAccess || busy}>Reactivate Employee</button></div>}<div className={styles.subsection}><Status label="Payroll schedule record" value={payrollSettings?.id ?? 'Not configured'} /><Status label="Historical records" value="Preserved" /></div></Card></div> : null}
      </div>
    </section>
  </div>;
}

function ScheduleEditor({ technical, canManage, loading, draft, setDraft, onApplyTemplate, onUpdateDay, onSave, busy, vanId, vanHalfDay, settings }: {
  technical: boolean;
  canManage: boolean;
  loading: boolean;
  draft: ScheduleDraft;
  setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
  onApplyTemplate: (id: Exclude<EmployeeScheduleTemplateId, 'custom'>) => void;
  onUpdateDay: (day: EmployeeScheduleWeekdayKey, field: 'startTime' | 'endTime' | 'breakMinutes', value: string) => void;
  onSave: () => void;
  busy: boolean;
  vanId: string;
  vanHalfDay?: CanonicalVanHalfDaySchedule;
  settings?: EmployeePayrollSettings;
}) {
  const vanGoverned = technical && Boolean(vanId);
  if (vanGoverned) {
    const partialWorkedMinutes = vanHalfDay?.workdayStart && vanHalfDay?.workdayEnd ? Math.max(0, timeMinutes(vanHalfDay.workdayEnd) - timeMinutes(vanHalfDay.workdayStart)) : 300;
    const rows = WEEKDAYS.map((day) => {
      const partial = vanHalfDay?.weekday === Number(day.key);
      const startTime = partial ? vanHalfDay?.workdayStart ?? '08:00' : '08:00';
      const endTime = partial ? vanHalfDay?.workdayEnd ?? '13:00' : '17:00';
      return { ...day, partial, startTime, endTime, workedMinutes: partial ? partialWorkedMinutes : 480 };
    });
    const scheduledWorkedMinutes = rows.reduce((sum, row) => sum + row.workedMinutes, 0);
    return <div className={styles.scheduleLayout}>
      <div className={styles.stack}>
        <Card title="1 · Schedule Authority" subtitle="The assigned Van automatically owns this technician's recurring schedule."><div className={styles.modeGrid}><div className={styles.modeSelected}><strong>Use Van/team schedule</strong><span>{vanId} · protected operational authority</span></div><div className={styles.modeCard}><strong>Individual employee schedule</strong><span>Preserved but inactive while assigned to a Van.</span></div></div></Card>
        <Card title="2 · Van Assignment" subtitle="Changing the employee's regular Van automatically changes the inherited recurring partial day."><div className={styles.formGrid}><Status label="Assigned Van" value={vanId} /><Status label="Base schedule" value="Company calendar · 08:00–17:00" /><Status label="Recurring partial day" value={vanHalfDay?.weekday != null ? `${weekdayLabel(vanHalfDay.weekday)} · ${vanHalfDay.workdayStart ?? '08:00'}–${vanHalfDay.workdayEnd ?? '13:00'}` : 'Not configured'} /><Status label="Schedule ownership" value="Vans → Crew & Schedule" /></div></Card>
        <Card title="3 · Weekly Schedule" subtitle="Read-only projection of the effective Van/team schedule."><div className={styles.scheduleTable}><div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Rule</span></div>{rows.map((row) => <div className={styles.scheduleRow} key={row.key}><strong>{row.label}</strong><span className={row.partial ? styles.halfChip : styles.workChip}>{row.partial ? 'Partial day' : 'Working day'}</span><span>{row.startTime}</span><span>{row.endTime}</span><span>{row.partial ? `${formatWorkedHours(row.workedMinutes)} worked` : 'Company shift'}</span></div>)}<SundayRow /></div></Card>
        <Card title="4 · Schedule Rule" subtitle="One authority at a time prevents duplicate recurring schedules."><Info>To change this technician's recurring partial day, edit <strong>{vanId}</strong> in Vans → Crew & Schedule. If the technician is removed from all Vans, the individual Employee Profile schedule becomes editable and authoritative again.</Info></Card>
      </div>
      <aside className={styles.stack}>
        <Card title="Weekly Overview" subtitle="Effective worked-hour preview"><div className={styles.overview}>{rows.map((row) => <div className={styles.overviewRow} key={row.key}><strong>{row.short}</strong><span>{`${row.startTime}–${row.endTime}`}</span><div className={row.partial ? styles.halfBar : styles.workBar} /><b>{formatWorkedHours(row.workedMinutes)}</b></div>)}<div className={styles.overviewRow}><strong>Sun</strong><span>Closed</span><div className={styles.offBar} /><b>0h</b></div></div><div className={styles.totalRow}><span>Scheduled worked hours</span><strong>{formatWorkedHours(scheduledWorkedMinutes)}</strong></div></Card>
        <Card title="Payroll & Attendance Impact" subtitle="Shared effective schedule"><Status label="Attendance" value="Van/team exact worked hours" /><Status label="Calendar" value="Van/team schedule" /><Status label="Payroll" value="Van/team schedule dates" /><Status label="Employment start" value="Respected" /><Status label="Existing individual schedule" value="Preserved, inactive while assigned" /></Card>
        <Card title="Current Authority" subtitle="Protected source"><Status label="Van" value={vanId} /><Status label="Recurring partial day" value={vanHalfDay ? 'vanHalfDaySchedules' : 'Not configured'} /><Status label="Sunday" value="Company closed" /></Card>
      </aside>
    </div>;
  }

  const rows = WEEKDAYS.map((day) => {
    const fullDay = draft.weeklySchedule[day.key] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
    const partial = Number(draft.halfDayWeekday) === Number(day.key);
    const startTime = partial ? draft.halfDayStartTime : fullDay.startTime;
    const endTime = partial ? draft.halfDayEndTime : fullDay.endTime;
    const breakMinutes = partial ? draft.halfDayBreakMinutes : fullDay.breakMinutes;
    const workedMinutes = Math.max(0, timeMinutes(endTime) - timeMinutes(startTime) - breakMinutes);
    return { ...day, startTime, endTime, breakMinutes, workedMinutes, partial };
  });
  const scheduledWorkedMinutes = rows.reduce((sum, row) => sum + row.workedMinutes, 0);

  function selectPartialDay(value: string) {
    setDraft((current) => {
      const weekday = Number(value);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) return { ...current, halfDayWeekday: '' };
      const key = String(weekday) as EmployeeScheduleWeekdayKey;
      const companyDay = defaultEmployeeWeeklySchedule()[key]!;
      const fullDay = current.mode === 'custom' ? current.weeklySchedule[key] ?? companyDay : companyDay;
      const partial = defaultPartialDayWindow(fullDay, current.halfDayOffPeriod, 240);
      return { ...current, halfDayWeekday: value, halfDayStartTime: partial.startTime, halfDayEndTime: partial.endTime, halfDayBreakMinutes: partial.breakMinutes };
    });
  }

  function selectPartialPlacement(value: HalfDayOffPeriod) {
    setDraft((current) => {
      const weekday = Number(current.halfDayWeekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) return { ...current, halfDayOffPeriod: value };
      const key = String(weekday) as EmployeeScheduleWeekdayKey;
      const companyDay = defaultEmployeeWeeklySchedule()[key]!;
      const fullDay = current.mode === 'custom' ? current.weeklySchedule[key] ?? companyDay : companyDay;
      const partial = defaultPartialDayWindow(fullDay, value, 240);
      return { ...current, halfDayOffPeriod: value, halfDayStartTime: partial.startTime, halfDayEndTime: partial.endTime, halfDayBreakMinutes: partial.breakMinutes };
    });
  }

  return <div className={styles.scheduleLayout}>
    <div className={styles.stack}>
      <Card title="1 · Schedule Mode" subtitle="Choose company default or a custom employee schedule."><div className={styles.modeGrid}><button className={draft.mode === 'company' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'company' }))}><strong>Use company default</strong><span>08:00–17:00 · 1h break</span></button><button className={draft.mode === 'custom' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'custom' }))}><strong>Use custom employee schedule</strong><span>Assign an individual eight-work-hour full-day shift.</span></button></div>{technical ? <Info>This technician is not assigned to a canonical Van, so the individual Employee Profile schedule is currently authoritative. A future Van assignment will automatically take priority without deleting this schedule history.</Info> : null}</Card>
      <Card title="2 · Shift Templates" subtitle="Fast starting points for individual employee schedules."><div className={styles.templateGrid}>{OFFICE_SCHEDULE_TEMPLATES.map((template) => <button key={template.id} className={draft.templateId === template.id && draft.mode === 'custom' ? styles.templateSelected : styles.templateCard} type="button" disabled={!canManage || loading} onClick={() => onApplyTemplate(template.id)}><strong>{template.label}</strong><span>{template.startTime}–{template.endTime}</span><small>{template.breakMinutes / 60}h break</small></button>)}<div className={styles.templateReadonly}><strong>{technical ? 'Van/team schedule' : 'Technician Shift'}</strong><span>{technical ? 'Not assigned to a Van' : 'Van/team governed'}</span><small>{technical ? 'Activates automatically when this employee joins a Van crew.' : 'Partial-day hours come from the Van schedule'}</small></div></div></Card>
      <Card title="3 · Weekly Schedule" subtitle="Enter the employee's exact worked Start / End times. Sunday is company-closed and locked."><div className={styles.scheduleTable}><div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Break / Worked</span></div>{rows.map((row) => <div className={styles.scheduleRow} key={row.key}><strong>{row.label}</strong><span className={row.partial ? styles.halfChip : styles.workChip}>{row.partial ? 'Partial day' : 'Working day'}</span><input className={styles.timeControl} type="time" value={row.startTime} disabled={!canManage || loading || (!row.partial && draft.mode === 'company')} onChange={(event) => onUpdateDay(row.key, 'startTime', event.target.value)} /><input className={styles.timeControl} type="time" value={row.endTime} disabled={!canManage || loading || (!row.partial && draft.mode === 'company')} onChange={(event) => onUpdateDay(row.key, 'endTime', event.target.value)} />{row.partial ? <div className={styles.actionRow}><select className={styles.miniSelect} value={row.breakMinutes} disabled={!canManage || loading} onChange={(event) => onUpdateDay(row.key, 'breakMinutes', event.target.value)}><option value="0">No break</option><option value="30">30m break</option><option value="60">1h break</option></select><span className={styles.ruleText}>{formatWorkedHours(row.workedMinutes)} worked</span></div> : <select className={styles.miniSelect} value={row.breakMinutes} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'breakMinutes', event.target.value)}><option value="60">1h break</option></select>}</div>)}<SundayRow /></div></Card>
      <Card title="4 · Schedule Details" subtitle="Effective dates prevent future changes from rewriting historical schedule logic."><div className={styles.detailGrid}><Field label="Partial-day weekday"><select className={styles.control} value={draft.halfDayWeekday} onChange={(event) => selectPartialDay(event.target.value)} disabled={!canManage || loading}><option value="">Not configured</option>{WEEKDAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}</select></Field><Field label="Default placement"><select className={styles.control} value={draft.halfDayOffPeriod} onChange={(event) => selectPartialPlacement(event.target.value as HalfDayOffPeriod)} disabled={!canManage || loading}><option value="afternoon">Work first part of day</option><option value="morning">Work last part of day</option></select></Field><Field label="Effective from"><input className={styles.control} type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!canManage || loading} /></Field><Field label="Effective until"><input className={styles.control} type="date" value={draft.effectiveUntil} onChange={(event) => setDraft((current) => ({ ...current, effectiveUntil: event.target.value }))} disabled={!canManage || loading} /></Field></div><Info>The partial day uses the exact Start, End and Break shown above. Attendance and payroll count the resulting <strong>worked hours only</strong>.</Info><div className={styles.actionRow}><button className={styles.primaryButton} type="button" onClick={onSave} disabled={!canManage || loading || busy}>{busy ? 'Saving…' : 'Save Work Schedule'}</button></div></Card>
    </div>
    <aside className={styles.stack}><Card title="Weekly Overview" subtitle="Worked-hour preview"><div className={styles.overview}>{rows.map((row) => <div className={styles.overviewRow} key={row.key}><strong>{row.short}</strong><span>{`${row.startTime}–${row.endTime}`}</span><div className={row.partial ? styles.halfBar : styles.workBar} /><b>{formatWorkedHours(row.workedMinutes)}</b></div>)}<div className={styles.overviewRow}><strong>Sun</strong><span>Closed</span><div className={styles.offBar} /><b>0h</b></div></div><div className={styles.totalRow}><span>Scheduled worked hours</span><strong>{formatWorkedHours(scheduledWorkedMinutes)}</strong></div></Card><Card title="Payroll & Attendance Impact" subtitle="Shared effective schedule"><Status label="Attendance" value="Exact worked hours" /><Status label="Calendar" value="Exact schedule" /><Status label="Payroll" value="Worked-hour schedule dates" /><Status label="Employment start" value="Respected" /><Status label="Existing records" value="Not rewritten" /></Card>{technical ? <Card title="Schedule Source" subtitle="Current authority"><Status label="Van assignment" value="Not assigned" /><Status label="Recurring schedule" value="Individual employeePayrollSettings" /><Status label="Automatic switch" value="Van/team when assigned" /><Status label="Sunday" value="Company closed" /></Card> : null}{settings ? <Card title="Current Record" subtitle="Backward-compatible source"><Status label="Record ID" value={settings.id} /><Status label="Legacy partial-day weekday" value={settings.weeklyHalfDayWeekday ? weekdayLabel(settings.weeklyHalfDayWeekday) : 'Not configured'} /><Status label="V2 mode" value={asEmployeePayrollScheduleSettings(settings)?.scheduleMode ?? 'Legacy / company default'} /></Card> : null}</aside>
  </div>;
}

function SundayRow() { return <div className={styles.scheduleRow}><strong>Sunday</strong><span className={styles.offChip}>Off day</span><span>—</span><span>—</span><span className={styles.ruleText}>Business closed · locked</span></div>; }
function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <section className={styles.card}><header className={styles.cardHeader}><div><h3>{title}</h3><p>{subtitle}</p></div></header>{children}</section>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Meta({ label, value }: { label: string; value: string }) { return <div className={styles.meta}><span>{label}</span><strong>{value}</strong></div>; }
function Info({ children }: { children: ReactNode }) { return <div className={styles.info}>{children}</div>; }
function Status({ label, value }: { label: string; value: string }) { return <div className={styles.statusRow}><span className={styles.statusOk}>✓</span><div><strong>{label}</strong><span>{value}</span></div></div>; }
function todayKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function normalizeName(value: string) { return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '); }
function normalizePhone(value: string) { return value.replace(/\D/g, ''); }
function rolesForType(type: string) { return type === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES; }
function defaultRole(type: string) { if (type === 'Técnico') return 'Ayudante'; if (type === 'Secretaria') return 'Secretaria'; if (type === 'Administración') return 'Administración'; return 'Otro'; }
function defaultAccessRole(type: string): ManagedUserRole { return type === 'Técnico' ? 'technician' : 'office'; }
function defaultLoginEmailKind(type: string): LoginEmailKind { return type === 'Técnico' ? 'personal' : 'company'; }
function profileDraftFrom(profile: LifecycleProfile, user?: ManagedUser): ProfileDraft { const type = profile.employeeType ?? (isTechnicalEmployee(profile) ? 'Técnico' : profile.role === 'Secretaria' ? 'Secretaria' : 'Administración'); return { name: profile.name ?? '', phone: profile.phone ?? '', contactEmail: profile.email ?? '', employeeType: type, role: profile.role ?? defaultRole(type), employmentStartedAt: profile.employmentStartedAt ?? '', canDriveVan: profile.canDriveVan === true, skills: (profile.skills ?? []).join(', '), notes: profile.notes ?? '', createAccess: Boolean(user), loginEmail: user?.email ?? profile.loginEmail ?? '', loginEmailKind: profile.loginEmailKind ?? defaultLoginEmailKind(type), accessRole: user?.role ?? defaultAccessRole(type), accessActive: user?.active ?? true }; }
function scheduleDraftFrom(settings: EmployeePayrollSettings | undefined, profile: LifecycleProfile, today: string): ScheduleDraft { const extended = asEmployeePayrollScheduleSettings(settings); const weekday = Number(settings?.weeklyHalfDayWeekday); const halfDayWeekday = Number.isInteger(weekday) && weekday >= 1 && weekday <= 6 ? weekday : null; const halfDayOffPeriod = settings?.halfDayOffPeriod ?? 'afternoon'; const weeklySchedule = employeeWeeklyScheduleFromSettings(settings); const partialDay = employeePartialDayFromSettings(settings, weeklySchedule, halfDayWeekday, halfDayOffPeriod); return { mode: extended?.scheduleMode ?? 'company', templateId: extended?.scheduleTemplateId ?? 'office-8-5', weeklySchedule, halfDayWeekday: halfDayWeekday ? String(halfDayWeekday) : '', halfDayOffPeriod, halfDayStartTime: partialDay.startTime, halfDayEndTime: partialDay.endTime, halfDayBreakMinutes: partialDay.breakMinutes, effectiveFrom: extended?.scheduleEffectiveFrom ?? settings?.halfDayEffectiveFrom ?? profile.employmentStartedAt ?? today, effectiveUntil: extended?.scheduleEffectiveUntil ?? '' }; }
function initials(value: string) { return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DE'; }
function timeMinutes(value: string) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }
function formatWorkedHours(minutes: number) { const hours = Math.round((Math.max(0, minutes) / 60) * 100) / 100; return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}h`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
