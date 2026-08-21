'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { loadCanonicalOperationsState, staffDisplayName, type CanonicalOperationsState, type CanonicalStaffProfile } from '@/lib/canonical-operations';
import { loadEmployeeAttendanceState, type EmployeeAttendanceState } from '@/lib/employee-attendance';
import {
  MONTHLY_HOURS_FACTOR,
  calculatePayrollDay,
  payrollPeriodDates,
  payrollPeriodForReference,
  shiftPayrollPeriod,
  summarizeEmployee,
  type PayrollPeriod,
} from '@/lib/employee-payroll';
import { downloadPayrollAccountingPdf } from '@/lib/payroll-accounting-pdf';
import styles from './employee-payroll-workspace.module.css';

function decimalHours(value: number) {
  return Number(value || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hoursMinutes(value: number) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours && !minutes) return '0m';
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function money(value: number) {
  return `Afl. ${Number(value || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvCell(value: string | number) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function employeeType(profile: CanonicalStaffProfile) {
  if (profile.employeeType) return profile.employeeType;
  if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '')) return 'Técnico';
  if (profile.role === 'Secretaria') return 'Secretaria';
  if (['Administración', 'Contabilidad', 'Almacén'].includes(profile.role ?? '')) return 'Administración';
  return 'Otro';
}

type LifecycleProfile = CanonicalStaffProfile & { employmentStartedAt?: string; employmentEndedAt?: string };
type DetailMode = 'exceptions' | 'all';
type IconName = 'calendar' | 'download' | 'users' | 'timer' | 'heart' | 'vacation' | 'ban' | 'wallet';

export function EmployeePayrollWorkspace() {
  const { principal } = useAuth();
  const canViewPayroll = principal.role === 'super_admin' || principal.role === 'finance' || principal.capabilities.has('payroll_sensitive.view');
  const [operations, setOperations] = useState<CanonicalOperationsState | null>(null);
  const [attendance, setAttendance] = useState<EmployeeAttendanceState>({ payrollSettings: [], timesheets: [], advances: [] });
  const [period, setPeriod] = useState<PayrollPeriod>(() => payrollPeriodForReference(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [detailMode, setDetailMode] = useState<DetailMode>('exceptions');

  const load = useCallback(async () => {
    if (!canViewPayroll) return;
    setLoading(true);
    setError('');
    try {
      const [canonical, records] = await Promise.all([loadCanonicalOperationsState(), loadEmployeeAttendanceState()]);
      setOperations(canonical);
      setAttendance(records);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [canViewPayroll]);

  useEffect(() => { void load(); }, [load]);

  const employees = useMemo(() => {
    const all = ((operations?.staffProfiles ?? []) as LifecycleProfile[]).filter((profile) => {
      if (profile.employmentStartedAt && profile.employmentStartedAt > period.endDate) return false;
      if (profile.active === false && profile.employmentEndedAt && profile.employmentEndedAt < period.startDate) return false;
      return profile.active !== false || Boolean(profile.employmentEndedAt && profile.employmentEndedAt >= period.startDate);
    });
    return all.sort((a, b) => staffDisplayName(a).localeCompare(staffDisplayName(b)));
  }, [operations?.staffProfiles, period.endDate, period.startDate]);

  const summaries = useMemo(() => {
    if (!operations) return [];
    return employees.map((employee) => summarizeEmployee({ employee, period, operations, attendance }));
  }, [attendance, employees, operations, period]);

  const periodAdvances = useMemo(() => (attendance.advances ?? []).filter((advance) => advance.payrollPeriodId === period.id), [attendance.advances, period.id]);
  const advanceByEmployee = useMemo(() => {
    const result = new Map<string, number>();
    for (const advance of periodAdvances) result.set(advance.employeeId, (result.get(advance.employeeId) ?? 0) + Number(advance.amount || 0));
    return result;
  }, [periodAdvances]);

  const filtered = useMemo(() => summaries.filter((summary) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || staffDisplayName(summary.employee).toLowerCase().includes(term) || String(summary.employee.role ?? '').toLowerCase().includes(term);
    const matchesType = typeFilter === 'All' || employeeType(summary.employee) === typeFilter;
    return matchesSearch && matchesType;
  }), [search, summaries, typeFilter]);

  useEffect(() => {
    if (!selectedEmployeeId && employees[0]) setSelectedEmployeeId(employees[0].id);
    if (selectedEmployeeId && !employees.some((employee) => employee.id === selectedEmployeeId)) setSelectedEmployeeId(employees[0]?.id ?? '');
  }, [employees, selectedEmployeeId]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? employees[0] ?? null;
  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployee?.id) ?? null;
  const selectedDays = useMemo(() => {
    if (!operations || !selectedEmployee) return [];
    return payrollPeriodDates(period).map((date) => calculatePayrollDay({ employee: selectedEmployee, date, operations, attendance }));
  }, [attendance, operations, period, selectedEmployee]);

  const visibleDays = useMemo(() => detailMode === 'all' ? selectedDays : selectedDays.filter((day) =>
    day.source !== 'schedule'
    || day.overtimeHours > 0
    || day.aoHours > 0
    || day.vacationHours > 0
    || day.noWorkNoPayHours > 0
  ), [detailMode, selectedDays]);

  const totals = useMemo(() => summaries.reduce((sum, item) => ({
    overtime: sum.overtime + item.overtimeHours,
    ao: sum.ao + item.aoHours,
    vacation: sum.vacation + item.vacationHours,
    noWork: sum.noWork + item.noWorkNoPayHours,
    payable: sum.payable + item.payableHoursEstimate,
    exceptionDays: sum.exceptionDays + item.exceptionDays,
  }), { overtime: 0, ao: 0, vacation: 0, noWork: 0, payable: 0, exceptionDays: 0 }), [summaries]);

  const totalAdvances = useMemo(() => periodAdvances.reduce((sum, advance) => sum + Number(advance.amount || 0), 0), [periodAdvances]);

  function exportSummary() {
    downloadCsv(`DEMAC-payroll-summary-${period.id}.csv`, [
      ['Employee', 'Role', 'Type', 'Weekly paid base', `Monthly base x ${MONTHLY_HOURS_FACTOR}`, 'Actual regular', 'Overtime', 'AO / Sick', 'Vacation', 'No Work No Pay', 'Paid free', 'Payable hours estimate', 'Salary Advances Afl.', 'Exception days'],
      ...summaries.map((item) => [
        staffDisplayName(item.employee), item.employee.role ?? '', employeeType(item.employee), decimalHours(item.weeklyPaidBaseHours), decimalHours(item.monthlyBaseHours), decimalHours(item.actualRegularHours), decimalHours(item.overtimeHours), decimalHours(item.aoHours), decimalHours(item.vacationHours), decimalHours(item.noWorkNoPayHours), decimalHours(item.paidFreeHours), decimalHours(item.payableHoursEstimate), (advanceByEmployee.get(item.employee.id) ?? 0).toFixed(2), item.exceptionDays,
      ]),
    ]);
  }

  function exportDetailed() {
    if (!operations) return;
    const rows: Array<Array<string | number>> = [['Employee', 'Date', 'Status', 'Scheduled', 'Regular', 'Paid free', 'Overtime', 'AO / Sick', 'Vacation', 'No Work No Pay', 'Source', 'Notes']];
    employees.forEach((employee) => payrollPeriodDates(period).forEach((date) => {
      const day = calculatePayrollDay({ employee, date, operations, attendance });
      rows.push([staffDisplayName(employee), date, day.status, decimalHours(day.scheduledWorkHours), decimalHours(day.regularHours), decimalHours(day.paidFreeHours), decimalHours(day.overtimeHours), decimalHours(day.aoHours), decimalHours(day.vacationHours), decimalHours(day.noWorkNoPayHours), day.source, day.notes]);
    }));
    downloadCsv(`DEMAC-payroll-detail-${period.id}.csv`, rows);
  }

  function downloadPdf() {
    setMessage('');
    const ok = downloadPayrollAccountingPdf({
      filename: `DEMAC_Payroll_Contabilidad_${period.startDate}_${period.endDate}.pdf`,
      periodLabel: period.label,
      summaries,
    });
    if (ok) setMessage(`Payroll PDF downloaded directly. ${summaries.length <= 12 ? 'The current workforce fits on one A4 landscape page.' : 'The report continues automatically after 12 employees.'}`);
    else setError('The PDF could not be generated in this browser.');
  }

  if (!canViewPayroll) return <section className={styles.loading}><strong>Payroll is restricted.</strong><p>Only the owner/administrator and authorized finance users can open employee payroll summaries.</p></section>;
  if (loading && !operations) return <section className={styles.loading}>Loading payroll control records…</section>;
  if (!operations) return <section className={styles.loading}><strong>Payroll unavailable.</strong><p>{error}</p><button className={styles.secondaryButton} type="button" onClick={() => void load()}>Retry</button></section>;

  return <div className={styles.workspace}>
    {error ? <div className={styles.error}>{error}</div> : null}
    {message ? <div className={styles.notice}>{message}</div> : null}

    <section className={styles.heroCard}>
      <div className={styles.heroTop}>
        <div className={styles.periodIdentity}>
          <span className={styles.periodIcon}><Icon name="calendar" /></span>
          <div className={styles.periodCopy}>
            <span>Payroll period · 27–26</span>
            <strong>{period.label}</strong>
            <small>Regular attendance comes from each employee schedule. This review focuses on payroll inputs and exceptions.</small>
          </div>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} type="button" onClick={exportSummary}>Summary CSV</button>
          <button className={styles.secondaryButton} type="button" onClick={exportDetailed}>Detailed CSV</button>
          <button className={styles.primaryButton} type="button" onClick={downloadPdf}><Icon name="download" /> Download Payroll PDF</button>
        </div>
      </div>

      <div className={styles.periodNav}>
        <button className={styles.iconButton} type="button" onClick={() => setPeriod((value) => shiftPayrollPeriod(value, -1))} aria-label="Previous payroll period">‹</button>
        <strong>{period.startDate} → {period.endDate}</strong>
        <button className={styles.iconButton} type="button" onClick={() => setPeriod((value) => shiftPayrollPeriod(value, 1))} aria-label="Next payroll period">›</button>
        <button className={styles.secondaryButton} type="button" onClick={() => setPeriod(payrollPeriodForReference(new Date()))}>Current Period</button>
      </div>

      <div className={styles.kpiGrid}>
        <Kpi icon="users" tone="blue" label="Employees" value={String(summaries.length)} sub="Included in this period" />
        <Kpi icon="timer" tone="purple" label="Overtime" value={hoursMinutes(totals.overtime)} sub="Recorded overtime" />
        <Kpi icon="heart" tone="pink" label="AO / Sick" value={hoursMinutes(totals.ao)} sub="Payroll exception hours" />
        <Kpi icon="vacation" tone="green" label="Vacation" value={hoursMinutes(totals.vacation)} sub="Recorded vacation" />
        <Kpi icon="ban" tone="orange" label="No Work No Pay" value={hoursMinutes(totals.noWork)} sub="Unpaid exception hours" />
        <Kpi icon="wallet" tone="cyan" label="Salary Advances" value={money(totalAdvances)} sub={`${periodAdvances.length} record${periodAdvances.length === 1 ? '' : 's'} this period`} />
      </div>
    </section>

    <section className={styles.summaryCard}>
      <header className={styles.cardHeader}>
        <div>
          <span className={styles.sectionEyebrow}>Accountant-ready payroll control</span>
          <h2>Employee Period Summary</h2>
          <p>Every employee remains visible. Exception values highlight only what Accounting needs to review beyond the configured schedule.</p>
        </div>
        <span className={styles.summaryMeta}>{summaries.length} employees · {totals.exceptionDays} exception days</span>
      </header>

      <div className={styles.filters}>
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee or role…" />
        <select className={styles.select} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option><option>Técnico</option><option>Secretaria</option><option>Administración</option><option>Otro</option></select>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Employee</th><th className={styles.metric}>Weekly Base</th><th className={styles.metric}>Regular</th><th className={styles.metric}>OT</th><th className={styles.metric}>AO / Sick</th><th className={styles.metric}>Vacation</th><th className={styles.metric}>NWNP</th><th className={styles.metric}>Paid Free</th><th className={styles.metric}>Advance</th><th className={styles.metric}>Payable Est.</th><th className={styles.metric}>Exceptions</th></tr></thead>
          <tbody>{filtered.map((item) => {
            const selected = item.employee.id === selectedEmployee?.id;
            return <tr key={item.employee.id} className={`${styles.row} ${selected ? styles.rowSelected : ''}`} onClick={() => setSelectedEmployeeId(item.employee.id)}>
              <td><div className={styles.employeeCell}><span className={styles.employeeAvatar}>{initials(staffDisplayName(item.employee))}</span><span><strong>{staffDisplayName(item.employee)}</strong><small>{item.employee.role ?? employeeType(item.employee)}{item.employee.active === false ? ' · Former employee' : ''}</small></span></div></td>
              <MetricCell value={`${decimalHours(item.weeklyPaidBaseHours)} h`} />
              <MetricCell value={hoursMinutes(item.actualRegularHours)} />
              <MetricCell value={hoursMinutes(item.overtimeHours)} active={item.overtimeHours > 0} />
              <MetricCell value={hoursMinutes(item.aoHours)} active={item.aoHours > 0} risk={item.aoHours > 0} />
              <MetricCell value={hoursMinutes(item.vacationHours)} active={item.vacationHours > 0} />
              <MetricCell value={hoursMinutes(item.noWorkNoPayHours)} active={item.noWorkNoPayHours > 0} risk={item.noWorkNoPayHours > 0} />
              <MetricCell value={hoursMinutes(item.paidFreeHours)} active={item.paidFreeHours > 0} />
              <MetricCell value={money(advanceByEmployee.get(item.employee.id) ?? 0)} active={(advanceByEmployee.get(item.employee.id) ?? 0) > 0} />
              <MetricCell value={hoursMinutes(item.payableHoursEstimate)} active />
              <td className={styles.metric}><span className={item.exceptionDays ? styles.exceptionPill : styles.metricZero}>{item.exceptionDays}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!filtered.length ? <div className={styles.empty}>No employees match this filter.</div> : null}
    </section>

    {selectedEmployee && selectedSummary ? <section className={styles.detailCard}>
      <header className={`${styles.cardHeader} ${styles.detailHeader}`}>
        <div className={styles.detailIdentity}><span className={styles.employeeAvatar}>{initials(staffDisplayName(selectedEmployee))}</span><div><span className={styles.sectionEyebrow}>Payroll drill-down</span><h2>{staffDisplayName(selectedEmployee)}</h2><p>{selectedEmployee.role ?? employeeType(selectedEmployee)} · schedule baseline + explicit exceptions</p></div></div>
        <div className={styles.detailControls}><div className={styles.segmented}><button type="button" className={`${styles.segmentButton} ${detailMode === 'exceptions' ? styles.segmentActive : ''}`} onClick={() => setDetailMode('exceptions')}>Exceptions Only</button><button type="button" className={`${styles.segmentButton} ${detailMode === 'all' ? styles.segmentActive : ''}`} onClick={() => setDetailMode('all')}>All Days</button></div></div>
      </header>

      <div className={styles.detailStats}>
        <DetailStat label="Weekly Base" value={`${decimalHours(selectedSummary.weeklyPaidBaseHours)} h`} sub="Configured schedule" />
        <DetailStat label="Overtime" value={hoursMinutes(selectedSummary.overtimeHours)} sub="This period" />
        <DetailStat label="AO / Sick" value={hoursMinutes(selectedSummary.aoHours)} sub="This period" />
        <DetailStat label="Vacation" value={hoursMinutes(selectedSummary.vacationHours)} sub="This period" />
        <DetailStat label="NWNP" value={hoursMinutes(selectedSummary.noWorkNoPayHours)} sub="This period" />
        <DetailStat label="Salary Advance" value={money(advanceByEmployee.get(selectedEmployee.id) ?? 0)} sub="Recorded input" />
      </div>

      <div className={`${styles.tableWrap} ${styles.detailScroll}`}>
        <table className={styles.table}>
          <thead><tr><th>Date</th><th>Status</th><th className={styles.metric}>Scheduled</th><th className={styles.metric}>Regular</th><th className={styles.metric}>Paid Free</th><th className={styles.metric}>OT</th><th className={styles.metric}>AO</th><th className={styles.metric}>Vacation</th><th className={styles.metric}>NWNP</th><th>Source</th></tr></thead>
          <tbody>{visibleDays.map((day) => {
            const risk = day.aoHours > 0 || day.vacationHours > 0 || day.noWorkNoPayHours > 0 || day.overtimeHours > 0;
            return <tr key={day.date}><td><strong>{formatDate(day.date)}</strong></td><td><span className={styles.dayStatus} data-risk={risk ? 'true' : 'false'}>{day.status}</span></td><MetricCell value={hoursMinutes(day.scheduledWorkHours)} /><MetricCell value={hoursMinutes(day.regularHours)} /><MetricCell value={hoursMinutes(day.paidFreeHours)} active={day.paidFreeHours > 0} /><MetricCell value={hoursMinutes(day.overtimeHours)} active={day.overtimeHours > 0} /><MetricCell value={hoursMinutes(day.aoHours)} active={day.aoHours > 0} risk={day.aoHours > 0} /><MetricCell value={hoursMinutes(day.vacationHours)} active={day.vacationHours > 0} /><MetricCell value={hoursMinutes(day.noWorkNoPayHours)} active={day.noWorkNoPayHours > 0} risk={day.noWorkNoPayHours > 0} /><td>{sourceLabel(day.source)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {!visibleDays.length ? <div className={styles.empty}>No payroll exceptions for {staffDisplayName(selectedEmployee)} in this period. Their regular schedule is already accounted for automatically.</div> : null}
    </section> : null}
  </div>;
}

function Kpi({ icon, tone, label, value, sub }: { icon: IconName; tone: string; label: string; value: string; sub: string }) {
  return <article className={styles.kpiCard}><span className={styles.kpiIcon} data-tone={tone}><Icon name={icon} /></span><div><span className={styles.kpiLabel}>{label}</span><strong>{value}</strong><small>{sub}</small></div></article>;
}

function MetricCell({ value, active = false, risk = false }: { value: string; active?: boolean; risk?: boolean }) {
  return <td className={styles.metric}><span className={risk ? styles.metricWarn : active ? styles.metricGood : styles.metricZero}>{value}</span></td>;
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className={styles.detailStat}><span className={styles.miniLabel}>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function Icon({ name }: { name: IconName }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v12M7.5 11.5 12 16l4.5-4.5"/><path d="M5 20h14"/></svg>;
  if (name === 'users') return <svg {...common}><path d="M16 20a4 4 0 0 0-8 0"/><circle cx="12" cy="9" r="3"/><path d="M5 18a3 3 0 0 1 2.5-3M19 18a3 3 0 0 0-2.5-3"/></svg>;
  if (name === 'timer') return <svg {...common}><path d="M9 3h6M12 3v3"/><circle cx="12" cy="14" r="7"/><path d="M12 10v4l2.4 1.5"/></svg>;
  if (name === 'heart') return <svg {...common}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M9 12h2l1-2 1.5 4 1-2H17"/></svg>;
  if (name === 'vacation') return <svg {...common}><path d="M4 18h16M7 18c.5-5 2-8 5-11 3 3 4.5 6 5 11M12 7c-2-2-4-2.5-6-1M12 7c2-2 4-2.5 6-1M12 7V4"/></svg>;
  if (name === 'ban') return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/></svg>;
  return <svg {...common}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v14H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"/><path d="M16 10h4v5h-4a2.5 2.5 0 0 1 0-5Z"/></svg>;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—';
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function sourceLabel(source: 'timesheet' | 'absence' | 'schedule') {
  if (source === 'timesheet') return 'Manual exception';
  if (source === 'absence') return 'Absence range';
  return 'Schedule';
}
