'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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

function hours(value: number) {
  return Number(value || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function EmployeePayrollWorkspace() {
  const { principal } = useAuth();
  const canViewPayroll = principal.role === 'super_admin' || principal.role === 'finance' || principal.capabilities.has('payroll_sensitive.view');
  const [operations, setOperations] = useState<CanonicalOperationsState | null>(null);
  const [attendance, setAttendance] = useState<EmployeeAttendanceState>({ payrollSettings: [], timesheets: [] });
  const [period, setPeriod] = useState<PayrollPeriod>(() => payrollPeriodForReference(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

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
  const selectedDays = useMemo(() => {
    if (!operations || !selectedEmployee) return [];
    return payrollPeriodDates(period).map((date) => calculatePayrollDay({ employee: selectedEmployee, date, operations, attendance }));
  }, [attendance, operations, period, selectedEmployee]);

  const totals = useMemo(() => summaries.reduce((sum, item) => ({
    base: sum.base + item.monthlyBaseHours,
    regular: sum.regular + item.actualRegularHours,
    overtime: sum.overtime + item.overtimeHours,
    ao: sum.ao + item.aoHours,
    vacation: sum.vacation + item.vacationHours,
    noWork: sum.noWork + item.noWorkNoPayHours,
    payable: sum.payable + item.payableHoursEstimate,
  }), { base: 0, regular: 0, overtime: 0, ao: 0, vacation: 0, noWork: 0, payable: 0 }), [summaries]);

  function exportSummary() {
    downloadCsv(`DEMAC-payroll-summary-${period.id}.csv`, [
      ['Employee', 'Role', 'Type', 'Weekly paid base', `Monthly base x ${MONTHLY_HOURS_FACTOR}`, 'Actual regular', 'Overtime', 'AO / Sick', 'Vacation', 'No Work No Pay', 'Paid free', 'Payable hours estimate', 'Exception days'],
      ...summaries.map((item) => [
        staffDisplayName(item.employee), item.employee.role ?? '', employeeType(item.employee), hours(item.weeklyPaidBaseHours), hours(item.monthlyBaseHours), hours(item.actualRegularHours), hours(item.overtimeHours), hours(item.aoHours), hours(item.vacationHours), hours(item.noWorkNoPayHours), hours(item.paidFreeHours), hours(item.payableHoursEstimate), item.exceptionDays,
      ]),
    ]);
  }

  function exportDetailed() {
    if (!operations) return;
    const rows: Array<Array<string | number>> = [['Employee', 'Date', 'Status', 'Scheduled', 'Regular', 'Paid free', 'Overtime', 'AO / Sick', 'Vacation', 'No Work No Pay', 'Source', 'Notes']];
    employees.forEach((employee) => payrollPeriodDates(period).forEach((date) => {
      const day = calculatePayrollDay({ employee, date, operations, attendance });
      rows.push([staffDisplayName(employee), date, day.status, hours(day.scheduledWorkHours), hours(day.regularHours), hours(day.paidFreeHours), hours(day.overtimeHours), hours(day.aoHours), hours(day.vacationHours), hours(day.noWorkNoPayHours), day.source, day.notes]);
    }));
    downloadCsv(`DEMAC-payroll-detail-${period.id}.csv`, rows);
  }

  if (!canViewPayroll) return <section className="panel" style={{ padding: 20 }}><h2>Payroll is restricted</h2><p>Only the owner/administrator and authorized finance users can open employee payroll summaries.</p></section>;
  if (loading && !operations) return <section className="panel" style={{ padding: 20 }}>Loading payroll records…</section>;
  if (!operations) return <section className="panel" style={{ padding: 20 }}><strong>Payroll unavailable.</strong><div>{error}</div><button className="btn" type="button" onClick={() => void load()}>Retry</button></section>;

  return <div style={{ display: 'grid', gap: 18 }}>
    <section className="panel">
      <header className="panel-head"><div><h2>Payroll Period</h2><span>DEMAC payroll cycle remains the 27th through the 26th. This view reviews hours; it does not change attendance records.</span></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn" type="button" onClick={() => setPeriod((value) => shiftPayrollPeriod(value, -1))}>‹ Previous</button><button className="btn" type="button" onClick={() => setPeriod(payrollPeriodForReference(new Date()))}>Current</button><button className="btn" type="button" onClick={() => setPeriod((value) => shiftPayrollPeriod(value, 1))}>Next ›</button></div></header>
      {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
      <div style={styles.periodBar}><div><span style={{ opacity: 0.65 }}>Period</span><strong>{period.label}</strong></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn" type="button" onClick={exportSummary}>Export Summary CSV</button><button className="btn" type="button" onClick={exportDetailed}>Export Detailed CSV</button><button className="btn primary" type="button" onClick={() => window.print()}>Print / Save PDF</button></div></div>
      <div style={styles.metrics}><Metric label="Employees" value={String(summaries.length)} /><Metric label="Monthly base" value={`${hours(totals.base)} h`} /><Metric label="Overtime" value={`${hours(totals.overtime)} h`} /><Metric label="AO / Sick" value={`${hours(totals.ao)} h`} /><Metric label="Vacation" value={`${hours(totals.vacation)} h`} /><Metric label="NWNP" value={`${hours(totals.noWork)} h`} /><Metric label="Payable estimate" value={`${hours(totals.payable)} h`} /></div>
    </section>

    <section className="panel" style={{ overflow: 'hidden' }}>
      <header className="panel-head"><div><h2>Employee Period Summary</h2><span>Paid-base hours include scheduled paid-free time. No Work No Pay reduces the estimate; overtime adds to it.</span></div></header>
      <div style={styles.filters}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee or role…" /><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option><option>Técnico</option><option>Secretaria</option><option>Administración</option><option>Otro</option></select></div>
      <div style={{ overflowX: 'auto' }}><table style={styles.table}><thead><tr><th>Employee</th><th>Weekly Base</th><th>Monthly Base</th><th>Regular</th><th>OT</th><th>AO</th><th>Vacation</th><th>NWNP</th><th>Paid Free</th><th>Payable Est.</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.employee.id} onClick={() => setSelectedEmployeeId(item.employee.id)} style={{ cursor: 'pointer' }}><td><strong>{staffDisplayName(item.employee)}</strong><small style={styles.small}>{item.employee.role ?? ''}{item.employee.active === false ? ' · Former employee' : ''}</small></td><td>{hours(item.weeklyPaidBaseHours)}</td><td>{hours(item.monthlyBaseHours)}</td><td>{hours(item.actualRegularHours)}</td><td>{hours(item.overtimeHours)}</td><td>{hours(item.aoHours)}</td><td>{hours(item.vacationHours)}</td><td>{hours(item.noWorkNoPayHours)}</td><td>{hours(item.paidFreeHours)}</td><td><strong>{hours(item.payableHoursEstimate)}</strong></td></tr>)}</tbody></table></div>
    </section>

    {selectedEmployee ? <section className="panel" style={{ overflow: 'hidden' }}><header className="panel-head"><div><h2>{staffDisplayName(selectedEmployee)} · Day Detail</h2><span>Source shows whether the day came from an explicit timesheet, an absence range, or the normal schedule.</span></div></header><div style={{ overflowX: 'auto', maxHeight: 540 }}><table style={styles.table}><thead><tr><th>Date</th><th>Status</th><th>Scheduled</th><th>Regular</th><th>Paid Free</th><th>OT</th><th>AO</th><th>Vacation</th><th>NWNP</th><th>Source</th></tr></thead><tbody>{selectedDays.map((day) => <tr key={day.date}><td><strong>{day.date}</strong></td><td>{day.status}</td><td>{hours(day.scheduledWorkHours)}</td><td>{hours(day.regularHours)}</td><td>{hours(day.paidFreeHours)}</td><td>{hours(day.overtimeHours)}</td><td>{hours(day.aoHours)}</td><td>{hours(day.vacationHours)}</td><td>{hours(day.noWorkNoPayHours)}</td><td>{day.source}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article style={styles.metric}><span style={{ opacity: 0.65 }}>{label}</span><strong>{value}</strong></article>;
}

const styles: Record<string, CSSProperties> = {
  error: { margin: 14, padding: 12, border: '1px solid #dc6b6b', borderRadius: 12, background: 'rgba(220,107,107,.08)' },
  periodBar: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', padding: 16, borderTop: '1px solid var(--line)', flexWrap: 'wrap' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', borderTop: '1px solid var(--line)' },
  metric: { padding: 14, display: 'grid', gap: 4, borderRight: '1px solid var(--line)' },
  filters: { display: 'grid', gridTemplateColumns: 'minmax(240px,1fr) 220px', gap: 10, padding: 14, borderTop: '1px solid var(--line)' },
  table: { width: '100%', minWidth: 980, borderCollapse: 'collapse' },
  small: { display: 'block', marginTop: 3, opacity: 0.62 },
};
