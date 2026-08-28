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
  type CanonicalVanHalfDaySchedule,
} from '@/lib/canonical-operations';
import { saveCanonicalStaffAbsence, saveCanonicalStaffProfile } from '@/lib/canonical-operations-mutations';
import {
  loadEmployeePayrollSettings,
  payrollSettingsForEmployee,
  type EmployeePayrollSettings,
  type HalfDayOffPeriod,
} from '@/lib/employee-attendance';
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
  loginEmail: string;
  accessRole: ManagedUserRole;
  accessActive: boolean;
};
type ScheduleDraft = {
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  halfDayWeekday: string;
  halfDayOffPeriod: HalfDayOffPeriod;
  effectiveFrom: string;
  effectiveUntil: string;
};
type TimeOffDraft = { fromDate: string; toDate: string; reason: string; notes: string };

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
  const [tab, setTab] = useState<Tab>('schedule');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [settings, setSettings] = useState<EmployeePayrollSettings[]>([]);
  const [profileDraft, setProfileDraft] = useState(() => profileDraftFrom(profile));
  const [scheduleDraft, setScheduleDraft] = useState(() => scheduleDraftFrom(undefined, profile, today));
  const [timeOff, setTimeOff] = useState<TimeOffDraft>({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
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
    if (!technical && canManageSchedule) {
      setLoadingSchedule(true);
      void loadEmployeePayrollSettings()
        .then((records) => {
          setSettings(records);
          setScheduleDraft(scheduleDraftFrom(payrollSettingsForEmployee(records, profile), profile, today));
        })
        .catch((cause) => setError(`Work schedule could not be loaded: ${errorText(cause)}`))
        .finally(() => setLoadingSchedule(false));
    }
  }, [open, employee.id, canManageAccess, canManageSchedule, technical, today]);

  const linkedUser = useMemo(() => users.find((user) => user.staffId === profile.id), [profile.id, users]);
  const payrollSettings = payrollSettingsForEmployee(settings, profile);
  const van = employeeVan(profile, operations.vans);
  const vanId = van ? canonicalVanId(van.id, operations.vans) : '';
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
    if (!name || !phone) return setError('Full name and phone number are required.');
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
        email: profileDraft.contactEmail.trim().toLowerCase() || undefined,
        employeeType: profileDraft.employeeType,
        role: profileDraft.role,
        employmentStartedAt: profileDraft.employmentStartedAt || profile.employmentStartedAt,
        canDriveVan: profileDraft.employeeType === 'Técnico' ? profileDraft.canDriveVan : false,
        skills: profileDraft.employeeType === 'Técnico'
          ? profileDraft.skills.split(',').map((value) => value.trim()).filter(Boolean)
          : [],
        notes: profileDraft.notes.trim() || undefined,
        weeklyDayOffWeekday: null,
        weeklyDayOffEffectiveFrom: null,
      } as LifecycleProfile);

      if (canManageAccess && linkedUser) {
        await updateManagedUser({
          uid: linkedUser.uid,
          name,
          email: profileDraft.loginEmail.trim().toLowerCase() || linkedUser.email,
          phone,
          role: profileDraft.accessRole,
          active: profileDraft.accessActive,
          staffId: profile.id,
        });
      }
      await onChanged(profile.id);
      setMessage('Employee profile saved without changing the employee identity or historical records.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveSchedule() {
    if (technical) return setError('Technician recurring schedules are governed by the Van/team.');
    if (!canManageSchedule) return setError('This schedule is payroll-protected.');
    setBusy(true); setError(''); setMessage('');
    try {
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
      });
      setSettings((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      await saveCanonicalStaffProfile({ ...profile, weeklyDayOffWeekday: null, weeklyDayOffEffectiveFrom: null } as LifecycleProfile);
      await onChanged(profile.id);
      setMessage('Work schedule saved. Effective dates preserve historical schedule calculations.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function saveTimeOff() {
    if (!canManageEmployees) return;
    if (!timeOff.fromDate || !timeOff.toDate || timeOff.toDate < timeOff.fromDate) return setError('Choose a valid time-off range.');
    setBusy(true); setError(''); setMessage('');
    try {
      await saveCanonicalStaffAbsence({
        id: `profile-${profile.id}-${crypto.randomUUID()}`,
        staffId: profile.id,
        fromDate: timeOff.fromDate,
        toDate: timeOff.toDate,
        reason: timeOff.reason,
        notes: timeOff.notes.trim() || undefined,
        active: true,
      });
      setTimeOff({ fromDate: today, toDate: today, reason: 'Vacaciones', notes: '' });
      await onChanged(profile.id);
      setMessage('Dated exception saved separately from the recurring schedule.');
    } catch (cause) { setError(errorText(cause)); }
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

  function updateDay(day: EmployeeScheduleWeekdayKey, field: 'startTime' | 'endTime' | 'breakMinutes', value: string) {
    const current = scheduleDraft.weeklySchedule[day] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
    setScheduleDraft((draft) => ({
      ...draft,
      mode: 'custom',
      templateId: 'custom',
      weeklySchedule: {
        ...draft.weeklySchedule,
        [day]: { ...current, [field]: field === 'breakMinutes' ? Number(value) : value },
      },
    }));
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'profile', label: 'Profile & Access' },
    { id: 'employment', label: 'Employment Details' },
    { id: 'schedule', label: 'Work Schedule' },
    { id: 'timeoff', label: 'Time Off & Exceptions' },
    { id: 'payroll', label: 'Payroll Notes' },
  ];

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className={styles.shell} role="dialog" aria-modal="true" aria-label="Employee profile">
      <header className={styles.topbar}>
        <div className={styles.identity}><div className={styles.avatar}>{initials(profileDraft.name)}</div><div><span className={styles.eyebrow}>Canonical employee profile</span><div className={styles.titleRow}><h2>{profileDraft.name}</h2><span className={profile.active === false ? styles.inactiveBadge : styles.activeBadge}>{profile.active === false ? 'Former employee' : 'Active employee'}</span></div><p>{profileDraft.role} · {profileDraft.employeeType}</p></div></div>
        <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>Cancel</button>{profile.active !== false && canManageEmployees ? <button className={styles.primaryButton} type="button" onClick={() => void saveProfile()} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button> : null}<button className={styles.closeButton} type="button" onClick={onClose} disabled={busy}>×</button></div>
      </header>

      <div className={styles.metaGrid}><Meta label="Employee ID" value={profile.id} /><Meta label="Type" value={profileDraft.employeeType} /><Meta label="Position" value={profileDraft.role} /><Meta label="Email" value={profileDraft.contactEmail || '—'} /><Meta label="Phone" value={profileDraft.phone || '—'} /><Meta label="Availability" value={availability} /></div>
      <nav className={styles.tabs}>{tabs.map((item) => <button key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} type="button" onClick={() => { setTab(item.id); setError(''); setMessage(''); }}>{item.label}</button>)}</nav>

      <div className={styles.body}>
        {message ? <div className={styles.success}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === 'profile' ? <div className={styles.twoColumn}>
          <Card title="Profile & Access" subtitle="Employee master data and authentication remain separate."><div className={styles.formGrid}><Field label="Full name"><input className={styles.control} value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} disabled={!canManageEmployees} /></Field><Field label="Phone"><input className={styles.control} value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} disabled={!canManageEmployees} /></Field><Field label="Contact email"><input className={styles.control} type="email" value={profileDraft.contactEmail} onChange={(event) => setProfileDraft({ ...profileDraft, contactEmail: event.target.value })} disabled={!canManageEmployees} /></Field></div>{canManageAccess && linkedUser ? <div className={styles.subsection}><div className={styles.formGrid}><Field label="ERP login email"><input className={styles.control} type="email" value={profileDraft.loginEmail} onChange={(event) => setProfileDraft({ ...profileDraft, loginEmail: event.target.value })} /></Field><Field label="Access role"><select className={styles.control} value={profileDraft.accessRole} onChange={(event) => setProfileDraft({ ...profileDraft, accessRole: event.target.value as ManagedUserRole })}>{ACCESS_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Account status"><select className={styles.control} value={profileDraft.accessActive ? 'active' : 'disabled'} onChange={(event) => setProfileDraft({ ...profileDraft, accessActive: event.target.value === 'active' })}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field></div><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void sendPasswordSetupEmail(profileDraft.loginEmail)}>Send / Reset Password Email</button></div> : <Info>ERP access is owner-controlled. Editing this profile never creates a duplicate employee master.</Info>}</Card>
          <Card title="Identity Safety" subtitle="Existing history stays linked to the same employee ID."><Status label="Employee master" value="staffProfiles" /><Status label="Authentication" value="Firebase Auth" /><Status label="Historical work/payroll" value="Preserved" /></Card>
        </div> : null}

        {tab === 'employment' ? <div className={styles.twoColumn}>
          <Card title="Employment Details" subtitle="These dates bound generated schedules and assumed attendance."><div className={styles.formGrid}><Field label="Employment start date"><input className={styles.control} type="date" value={profileDraft.employmentStartedAt} onChange={(event) => setProfileDraft({ ...profileDraft, employmentStartedAt: event.target.value })} disabled={!canManageEmployees} /></Field><Field label="Employee type"><select className={styles.control} value={profileDraft.employeeType} onChange={(event) => setProfileDraft({ ...profileDraft, employeeType: event.target.value, role: defaultRole(event.target.value) })} disabled={!canManageEmployees}>{EMPLOYEE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Operational role"><select className={styles.control} value={profileDraft.role} onChange={(event) => setProfileDraft({ ...profileDraft, role: event.target.value })} disabled={!canManageEmployees}>{rolesForType(profileDraft.employeeType).map((role) => <option key={role}>{role}</option>)}</select></Field>{profileDraft.employeeType === 'Técnico' ? <Field label="Can drive vans"><select className={styles.control} value={profileDraft.canDriveVan ? 'yes' : 'no'} onChange={(event) => setProfileDraft({ ...profileDraft, canDriveVan: event.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></select></Field> : null}{profileDraft.employeeType === 'Técnico' ? <Field label="Skills" full><input className={styles.control} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })} /></Field> : null}</div></Card>
          <Card title="Employment Boundary" subtitle="Same rule is consumed by Calendar, Attendance and Payroll."><Status label="Before start date" value="0 scheduled hours" /><Status label="Start date" value="Inclusive" /><Status label="After employment end" value="0 scheduled hours" /><Info>Historical explicit records are not deleted or rewritten.</Info></Card>
        </div> : null}

        {tab === 'schedule' ? <ScheduleEditor technical={technical} canManage={canManageSchedule && profile.active !== false} loading={loadingSchedule} draft={scheduleDraft} setDraft={setScheduleDraft} onApplyTemplate={applyTemplate} onUpdateDay={updateDay} onSave={() => void saveSchedule()} busy={busy} vanId={vanId} vanHalfDay={vanHalfDay} settings={payrollSettings} /> : null}

        {tab === 'timeoff' ? <div className={styles.twoColumn}>
          <Card title="Time Off & Exceptions" subtitle="Vacation, sickness and one-off unavailability stay date-scoped."><div className={styles.formGrid}><Field label="From"><input className={styles.control} type="date" value={timeOff.fromDate} onChange={(event) => setTimeOff({ ...timeOff, fromDate: event.target.value })} /></Field><Field label="To"><input className={styles.control} type="date" value={timeOff.toDate} onChange={(event) => setTimeOff({ ...timeOff, toDate: event.target.value })} /></Field><Field label="Type"><select className={styles.control} value={timeOff.reason} onChange={(event) => setTimeOff({ ...timeOff, reason: event.target.value })}>{ABSENCE_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Notes"><input className={styles.control} value={timeOff.notes} onChange={(event) => setTimeOff({ ...timeOff, notes: event.target.value })} /></Field></div><div className={styles.actionRow}><button className={styles.primaryButton} type="button" onClick={() => void saveTimeOff()} disabled={!canManageEmployees || busy}>Save Time Off</button></div></Card>
          <Card title="Recent / Current Exceptions" subtitle="Source: staffAbsences">{absences.length ? <div className={styles.history}>{absences.map((absence) => <div className={styles.historyRow} key={absence.id}><div><strong>{absence.reason ?? 'Unavailable'}</strong><span>{absence.notes ?? 'No notes'}</span></div><time>{absence.fromDate ?? '—'} → {absence.toDate ?? '—'}</time></div>)}</div> : <Info>No current or recent exceptions.</Info>}</Card>
        </div> : null}

        {tab === 'payroll' ? <div className={styles.twoColumn}><Card title="Payroll Notes" subtitle="Notes do not alter schedule calculations."><Field label="Internal notes"><textarea className={styles.textarea} value={profileDraft.notes} onChange={(event) => setProfileDraft({ ...profileDraft, notes: event.target.value })} disabled={!canManageEmployees} /></Field></Card><Card title="Payroll Schedule Source" subtitle="Protected, backward-compatible source"><Status label="Employee identity" value={profile.id} /><Status label="Schedule record" value={payrollSettings?.id ?? 'Not configured'} /><Status label="Historical records" value="Preserved" /><Info>New schedule fields are additive on the existing payroll settings record.</Info></Card></div> : null}
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
  if (technical) return <div className={styles.scheduleLayout}><div className={styles.stack}><Card title="Work Schedule" subtitle="Technician recurring half-day is inherited from the Van/team."><div className={styles.scheduleTable}><div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Rule</span></div>{WEEKDAYS.map((day) => { const half = vanHalfDay?.weekday === Number(day.key); return <div className={styles.scheduleRow} key={day.key}><strong>{day.label}</strong><span className={half ? styles.halfChip : styles.workChip}>{half ? 'Half-day' : 'Working day'}</span><span>{half ? vanHalfDay?.workdayStart ?? '08:00' : '08:00'}</span><span>{half ? vanHalfDay?.workdayEnd ?? '13:00' : '17:00'}</span><span>{half ? '5h work + 3h paid free' : 'Company shift'}</span></div>; })}<SundayRow /></div><Info>Change technician half-days in the Van/team schedule. An employee-level technician half-day is intentionally blocked.</Info></Card></div><aside className={styles.stack}><Card title="Schedule Source" subtitle="Protected authority"><Status label="Base schedule" value="Company calendar" /><Status label="Recurring half-day" value={vanId ? `${vanId} · vanHalfDaySchedules` : 'Van not assigned'} /><Status label="Half-day policy" value="5h + 3h paid free" /><Status label="Sunday" value="Company closed" /></Card></aside></div>;

  const rows = WEEKDAYS.map((day) => {
    const row = draft.weeklySchedule[day.key] ?? { startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
    const half = Number(draft.halfDayWeekday) === Number(day.key);
    return { ...day, ...row, half };
  });
  const paidBaseHours = rows.reduce((sum, row) => sum + (row.half ? 8 : Math.max(0, (timeMinutes(row.endTime) - timeMinutes(row.startTime) - row.breakMinutes) / 60)), 0);

  return <div className={styles.scheduleLayout}>
    <div className={styles.stack}>
      <Card title="1 · Schedule Mode" subtitle="Choose company default or a custom employee schedule."><div className={styles.modeGrid}><button className={draft.mode === 'company' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'company' }))}><strong>Use company default</strong><span>08:00–17:00 · 1h break</span></button><button className={draft.mode === 'custom' ? styles.modeSelected : styles.modeCard} type="button" disabled={!canManage || loading} onClick={() => setDraft((current) => ({ ...current, mode: 'custom' }))}><strong>Use custom employee schedule</strong><span>Assign an individual eight-work-hour shift.</span></button></div></Card>
      <Card title="2 · Shift Templates" subtitle="Fast starting points for office employees."><div className={styles.templateGrid}>{OFFICE_SCHEDULE_TEMPLATES.map((template) => <button key={template.id} className={draft.templateId === template.id && draft.mode === 'custom' ? styles.templateSelected : styles.templateCard} type="button" disabled={!canManage || loading} onClick={() => onApplyTemplate(template.id)}><strong>{template.label}</strong><span>{template.startTime}–{template.endTime}</span><small>{template.breakMinutes / 60}h break</small></button>)}<div className={styles.templateReadonly}><strong>Technician Shift</strong><span>Van/team governed</span><small>5h + 3h half-day rule</small></div></div></Card>
      <Card title="3 · Weekly Schedule" subtitle="Sunday is company-closed and locked."><div className={styles.scheduleTable}><div className={styles.scheduleHead}><span>Day</span><span>Status</span><span>Start</span><span>End</span><span>Break / Rule</span></div>{rows.map((row) => <div className={styles.scheduleRow} key={row.key}><strong>{row.label}</strong><span className={row.half ? styles.halfChip : styles.workChip}>{row.half ? 'Half-day' : 'Working day'}</span><input className={styles.timeControl} type="time" value={row.startTime} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'startTime', event.target.value)} /><input className={styles.timeControl} type="time" value={row.endTime} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'endTime', event.target.value)} />{row.half ? <span className={styles.ruleText}>4h work + 4h paid free</span> : <select className={styles.miniSelect} value={row.breakMinutes} disabled={!canManage || loading || draft.mode === 'company'} onChange={(event) => onUpdateDay(row.key, 'breakMinutes', event.target.value)}><option value="60">1h break</option></select>}</div>)}<SundayRow /></div></Card>
      <Card title="4 · Schedule Details" subtitle="Effective dates prevent future changes from rewriting historical schedule logic."><div className={styles.detailGrid}><Field label="Half-day weekday"><select className={styles.control} value={draft.halfDayWeekday} onChange={(event) => setDraft((current) => ({ ...current, halfDayWeekday: event.target.value }))} disabled={!canManage || loading}><option value="">Not configured</option>{WEEKDAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}</select></Field><Field label="Half-day period"><select className={styles.control} value={draft.halfDayOffPeriod} onChange={(event) => setDraft((current) => ({ ...current, halfDayOffPeriod: event.target.value as HalfDayOffPeriod }))} disabled={!canManage || loading}><option value="afternoon">Afternoon off</option><option value="morning">Morning off</option></select></Field><Field label="Effective from"><input className={styles.control} type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!canManage || loading} /></Field><Field label="Effective until"><input className={styles.control} type="date" value={draft.effectiveUntil} onChange={(event) => setDraft((current) => ({ ...current, effectiveUntil: event.target.value }))} disabled={!canManage || loading} /></Field></div><Info>Office/Admin/Operators: <strong>4h worked + 4h paid free</strong>. Legacy records remain valid.</Info><div className={styles.actionRow}><button className={styles.primaryButton} type="button" onClick={onSave} disabled={!canManage || loading || busy}>{busy ? 'Saving…' : 'Save Work Schedule'}</button></div></Card>
    </div>
    <aside className={styles.stack}><Card title="Weekly Overview" subtitle="Paid base preview"><div className={styles.overview}>{rows.map((row) => <div className={styles.overviewRow} key={row.key}><strong>{row.short}</strong><span>{row.half ? halfDayLabel(row.startTime, row.endTime, draft.halfDayOffPeriod) : `${row.startTime}–${row.endTime}`}</span><div className={row.half ? styles.halfBar : styles.workBar} /><b>{row.half ? '4h' : '8h'}</b></div>)}<div className={styles.overviewRow}><strong>Sun</strong><span>Closed</span><div className={styles.offBar} /><b>0h</b></div></div><div className={styles.totalRow}><span>Paid base hours</span><strong>{paidBaseHours}h</strong></div></Card><Card title="Payroll & Attendance Impact" subtitle="Shared effective schedule"><Status label="Attendance" value="Effective schedule" /><Status label="Calendar" value="Effective schedule" /><Status label="Payroll" value="Effective schedule dates" /><Status label="Employment start" value="Respected" /><Status label="Existing records" value="Not rewritten" /></Card>{settings ? <Card title="Current Record" subtitle="Backward-compatible source"><Status label="Record ID" value={settings.id} /><Status label="Legacy half-day" value={settings.weeklyHalfDayWeekday ? weekdayLabel(settings.weeklyHalfDayWeekday) : 'Not configured'} /><Status label="V2 mode" value={asEmployeePayrollScheduleSettings(settings)?.scheduleMode ?? 'Legacy / company default'} /></Card> : null}</aside>
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
function profileDraftFrom(profile: LifecycleProfile, user?: ManagedUser): ProfileDraft { const type = profile.employeeType ?? (isTechnicalEmployee(profile) ? 'Técnico' : profile.role === 'Secretaria' ? 'Secretaria' : 'Administración'); return { name: profile.name ?? '', phone: profile.phone ?? '', contactEmail: profile.email ?? '', employeeType: type, role: profile.role ?? defaultRole(type), employmentStartedAt: profile.employmentStartedAt ?? '', canDriveVan: profile.canDriveVan === true, skills: (profile.skills ?? []).join(', '), notes: profile.notes ?? '', loginEmail: user?.email ?? profile.loginEmail ?? '', accessRole: user?.role ?? defaultAccessRole(type), accessActive: user?.active ?? true }; }
function scheduleDraftFrom(settings: EmployeePayrollSettings | undefined, profile: LifecycleProfile, today: string): ScheduleDraft { const extended = asEmployeePayrollScheduleSettings(settings); const weekday = Number(settings?.weeklyHalfDayWeekday); return { mode: extended?.scheduleMode ?? 'company', templateId: extended?.scheduleTemplateId ?? 'office-8-5', weeklySchedule: employeeWeeklyScheduleFromSettings(settings), halfDayWeekday: Number.isInteger(weekday) && weekday >= 1 && weekday <= 6 ? String(weekday) : '', halfDayOffPeriod: settings?.halfDayOffPeriod ?? 'afternoon', effectiveFrom: extended?.scheduleEffectiveFrom ?? settings?.halfDayEffectiveFrom ?? profile.employmentStartedAt ?? today, effectiveUntil: extended?.scheduleEffectiveUntil ?? '' }; }
function initials(value: string) { return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DE'; }
function timeMinutes(value: string) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }
function formatTime(total: number) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function halfDayLabel(start: string, end: string, off: HalfDayOffPeriod) { const startMinutes = timeMinutes(start); const endMinutes = timeMinutes(end); return off === 'morning' ? `${formatTime(Math.max(startMinutes, endMinutes - 240))}–${end}` : `${start}–${formatTime(Math.min(endMinutes, startMinutes + 240))}`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
