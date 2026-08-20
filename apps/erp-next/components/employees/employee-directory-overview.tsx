'use client';

import { useMemo, useState } from 'react';
import {
  activeStaffAbsence,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import { employeeVan } from '@/lib/employee-work-schedule';
import styles from './employee-directory-overview.module.css';

export type EmployeeDirectoryPeriodSummary = {
  employeeId: string;
  overtime: number;
  ao: number;
  vacation: number;
  nwnp: number;
  lateMinutes: number;
  advances: number;
  exceptionDays: number;
};

type DirectoryMode = 'active' | 'former';

export function EmployeeDirectoryOverview({
  operations,
  periodSummaries,
  showPayrollMetrics,
  canManageEmployees,
  today,
  onAddEmployee,
  onOpenEmployee,
}: {
  operations: CanonicalOperationsState;
  periodSummaries: EmployeeDirectoryPeriodSummary[];
  showPayrollMetrics: boolean;
  canManageEmployees: boolean;
  today: string;
  onAddEmployee: () => void;
  onOpenEmployee: (employee: CanonicalStaffProfile) => void;
}) {
  const [mode, setMode] = useState<DirectoryMode>('active');
  const [search, setSearch] = useState('');

  const active = useMemo(() => operations.staffProfiles.filter((profile) => profile.active !== false), [operations.staffProfiles]);
  const former = useMemo(() => operations.staffProfiles.filter((profile) => profile.active === false), [operations.staffProfiles]);
  const summaryByEmployee = useMemo(() => new Map(periodSummaries.map((summary) => [summary.employeeId, summary])), [periodSummaries]);

  const visible = useMemo(() => {
    const source = mode === 'active' ? active : former;
    const term = search.trim().toLowerCase();
    return source
      .filter((profile) => !term || [
        staffDisplayName(profile),
        profile.role,
        profile.employeeType,
        profile.phone,
        profile.email,
        ...(profile.skills ?? []),
      ].some((value) => String(value ?? '').toLowerCase().includes(term)))
      .sort((a, b) => staffDisplayName(a).localeCompare(staffDisplayName(b)));
  }, [active, former, mode, search]);

  return (
    <section className={styles.directory}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Canonical employee registry</span>
          <h2>Employees & Payroll Exceptions</h2>
          <p>Every employee remains visible. Normal scheduled attendance stays automatic; payroll exception columns only highlight what needs attention.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.primaryButton} type="button" onClick={onAddEmployee} disabled={!canManageEmployees}>+ Add Employee</button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.segmented} aria-label="Employee lifecycle filter">
          <button type="button" className={`${styles.segmentButton} ${mode === 'active' ? styles.segmentActive : ''}`} onClick={() => setMode('active')}>Active ({active.length})</button>
          <button type="button" className={`${styles.segmentButton} ${mode === 'former' ? styles.segmentActive : ''}`} onClick={() => setMode('former')}>Former ({former.length})</button>
        </div>
        <div className={styles.filters}>
          <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, role, skill, phone…" />
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Team / Van</th>
              <th>Role / Skills</th>
              <th>Availability</th>
              {showPayrollMetrics ? <>
                <th className={styles.metric}>OT</th>
                <th className={styles.metric}>AO / Sick</th>
                <th className={styles.metric}>Vacation</th>
                <th className={styles.metric}>NWNP</th>
                <th className={styles.metric}>Late</th>
                <th className={styles.metric}>Advances</th>
                <th className={styles.metric}>Exceptions</th>
              </> : null}
              {mode === 'former' ? <th>Ended</th> : null}
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((profile) => {
              const van = employeeVan(profile, operations.vans);
              const absence = activeStaffAbsence(profile.id, today, operations.staffAbsences);
              const summary = summaryByEmployee.get(profile.id);
              const availability = mode === 'former' ? 'Inactive' : absence?.reason ?? profile.availability ?? 'Disponible';
              return (
                <tr key={profile.id} className={styles.row} onClick={() => onOpenEmployee(profile)}>
                  <td>
                    <div className={styles.employeeCell}>
                      <span className={styles.avatar}>{initials(staffDisplayName(profile))}</span>
                      <span>
                        <strong>{staffDisplayName(profile)}</strong>
                        <small>{profile.phone || profile.id}{profile.email ? ` · ${profile.email}` : ''}</small>
                      </span>
                    </div>
                  </td>
                  <td><strong>{mode === 'former' ? 'ARCHIVED' : van?.name ?? van?.id ?? profile.primaryVanId ?? 'UNASSIGNED'}</strong></td>
                  <td className={styles.role}><strong>{profile.role ?? profile.employeeType ?? 'Unassigned role'}</strong>{profile.skills?.length ? <small>{profile.skills.join(' · ')}</small> : null}</td>
                  <td><span className={mode === 'former' ? styles.formerStatus : styles.status}>{availability}</span></td>
                  {showPayrollMetrics ? <>
                    <MetricCell value={formatHours(summary?.overtime ?? 0)} active={(summary?.overtime ?? 0) > 0} />
                    <MetricCell value={formatHours(summary?.ao ?? 0)} active={(summary?.ao ?? 0) > 0} />
                    <MetricCell value={formatHours(summary?.vacation ?? 0)} active={(summary?.vacation ?? 0) > 0} />
                    <MetricCell value={formatHours(summary?.nwnp ?? 0)} active={(summary?.nwnp ?? 0) > 0} />
                    <MetricCell value={formatMinutes(summary?.lateMinutes ?? 0)} active={(summary?.lateMinutes ?? 0) > 0} />
                    <MetricCell value={formatMoney(summary?.advances ?? 0)} active={(summary?.advances ?? 0) > 0} />
                    <MetricCell value={String(summary?.exceptionDays ?? 0)} active={(summary?.exceptionDays ?? 0) > 0} />
                  </> : null}
                  {mode === 'former' ? <td><strong>{lifecycleValue(profile, 'employmentEndedAt') || '—'}</strong><small className={styles.muted}>{lifecycleValue(profile, 'offboardingReason')}</small></td> : null}
                  <td><button className={styles.rowButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenEmployee(profile); }}>{canManageEmployees ? 'View / Edit' : 'View'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!visible.length ? <div className={styles.empty}>No employees match this view.</div> : null}
    </section>
  );
}

function MetricCell({ value, active }: { value: string; active: boolean }) {
  return <td className={styles.metric}><span className={active ? styles.exception : styles.zero}>{value}</span></td>;
}

function lifecycleValue(profile: CanonicalStaffProfile, key: 'employmentEndedAt' | 'offboardingReason') {
  return String((profile as CanonicalStaffProfile & Record<string, unknown>)[key] ?? '');
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—';
}

function formatHours(value: number) {
  const minutes = Math.max(0, Math.round((Number(value) || 0) * 60));
  return formatMinutes(minutes);
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatMoney(value: number) {
  return `Afl. ${(Number(value) || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
