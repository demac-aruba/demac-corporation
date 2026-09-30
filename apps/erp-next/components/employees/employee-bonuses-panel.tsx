'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { staffDisplayName, type CanonicalStaffProfile } from '@/lib/canonical-operations';
import { dateKey, type EmployeePayrollSettings, type PayrollPeriodBounds } from '@/lib/employee-attendance';
import { BONUS_CATEGORIES, canManageBonuses, payrollBonusCsv, payrollBonusReport, saveEmployeeBonus, voidEmployeeBonus, type BonusCategory, type BonusDraft, type PayrollBonus } from '@/lib/employee-bonuses';
import styles from './employee-bonuses-panel.module.css';

const money = (amount: number) => `Afl. ${amount.toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function EmployeeBonusesPanel({ employees, settings, period, selectedEmployeeId, onSaved, onMovePeriod, onCurrentPeriod }: {
  employees: CanonicalStaffProfile[]; settings: EmployeePayrollSettings[]; period: PayrollPeriodBounds;
  selectedEmployeeId: string; onSaved: (record: EmployeePayrollSettings) => void;
  onMovePeriod: (offset: number) => void; onCurrentPeriod: () => void;
}) {
  const { principal } = useAuth();
  const allowed = canManageBonuses(principal);
  const today = dateKey(new Date());
  const blank = (): BonusDraft => ({ id: `payroll-adjustment-${crypto.randomUUID()}`, employeeId: selectedEmployeeId || employees[0]?.id || '',
    date: today < period.start ? period.start : today > period.end ? period.end : today, amount: '', category: 'perfect_attendance', concept: '' });
  const [draft, setDraft] = useState<BonusDraft>(blank);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [voiding, setVoiding] = useState<PayrollBonus | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const report = payrollBonusReport(settings, employees, period);
  const visible = report.bonuses.filter((bonus) => !filter || bonus.canonicalEmployeeId === filter);
  async function save() {
    const employee = employees.find((item) => item.id === draft.employeeId);
    if (!employee) { setError('Select an employee.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const record = await saveEmployeeBonus({ employee, employees, settings, period, draft, principal });
      onSaved(record); setDraft(blank()); setMessage('Bonus saved. It is included in the accounting exports for this payroll period.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function confirmVoid() {
    if (!voiding) return;
    const employee = employees.find((item) => item.id === voiding.canonicalEmployeeId);
    if (!employee) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const record = await voidEmployeeBonus({ bonus: voiding, employee, reason: voidReason, principal });
      onSaved(record); setVoiding(null); setVoidReason(''); setMessage('Bonus cancelled. Its history is retained and the amount is excluded from accounting totals.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function exportDetails() {
    const url = URL.createObjectURL(new Blob([payrollBonusCsv(report.bonuses)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `DEMAC-bonus-details-${period.id}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  if (!allowed) return <p>Bonuses are restricted to authorized payroll users.</p>;
  return <section className={styles.panel} aria-label="Employee bonuses">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Payroll inputs · 27–26</span><h2>Bonuses</h2><p>Record each approved bonus and include it in the report for Accounting.</p></div>
      <div className={styles.period}><button type="button" disabled={busy} aria-label="Previous bonus payroll period" onClick={() => onMovePeriod(-1)}>‹</button><strong>{period.start} → {period.end}</strong><button type="button" disabled={busy} aria-label="Next bonus payroll period" onClick={() => onMovePeriod(1)}>›</button><button type="button" disabled={busy} onClick={onCurrentPeriod}>Current Period</button></div>
    </header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {report.issues.length ? <p className={styles.error} role="alert">{report.issues.join(' ')}</p> : null}
    <div className={styles.layout}>
      <div className={styles.ledger}>
        <div className={styles.ledgerHeader}><div><span>Approved bonuses this period</span><strong>{money(report.total)}</strong></div><button type="button" disabled={busy || !!report.issues.length} onClick={exportDetails}>Export Bonus Details</button></div>
        <label className={styles.field}>Filter employee<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)}</option>)}</select></label>
        <div className={styles.tableWrap}><table><thead><tr><th>Employee / Date</th><th>Bonus / Reason</th><th>Amount</th><th>Status</th><th>Recorded by</th><th>Action</th></tr></thead><tbody>{visible.map((bonus) => <tr key={`${bonus.settingsId}-${bonus.id}`}>
          <td><strong>{bonus.employeeName}</strong><small>{bonus.date}</small></td><td><strong>{bonus.category ? BONUS_CATEGORIES[bonus.category] ?? 'Bonus' : 'Bonus'}</strong><span>{bonus.concept}</span>{bonus.voidReason ? <small>Cancellation: {bonus.voidReason}</small> : null}</td><td className={styles.amount}>{money(bonus.amountAfl)}</td><td><span className={bonus.status === 'active' ? styles.active : styles.voided}>{bonus.status === 'active' ? 'Active' : 'Cancelled'}</span></td><td>{bonus.createdByName || '—'}</td><td>{bonus.status === 'active' ? <button type="button" disabled={busy} onClick={() => { setVoiding(bonus); setVoidReason(''); }}>Cancel bonus</button> : '—'}</td>
        </tr>)}</tbody></table></div>
        {!visible.length ? <p className={styles.empty}>No bonuses recorded for this selection.</p> : null}
      </div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <span className={styles.eyebrow}>New payroll input</span><h3>Add Bonus</h3><p>Enter the approved amount in Afl. Accounting processes the final payroll.</p>
        <fieldset disabled={busy}><label className={styles.field}>Employee<select aria-label="Bonus employee" value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })} required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)}{employee.active === false ? ' · Former employee' : ''}</option>)}</select></label>
          <label className={styles.field}>Bonus Type<select aria-label="Bonus type" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as BonusCategory })}>{Object.entries(BONUS_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className={styles.formRow}><label className={styles.field}>Date<input aria-label="Bonus date" type="date" min={period.start} max={period.end} required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label className={styles.field}>Amount (Afl.)<input aria-label="Bonus amount" inputMode="decimal" required value={draft.amount} placeholder="0.00" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label></div>
          <label className={styles.field}>Concept / Reason<textarea aria-label="Bonus reason" required maxLength={500} rows={3} value={draft.concept} placeholder="Achievement, approved commission or other bonus details…" onChange={(event) => setDraft({ ...draft, concept: event.target.value })} /></label>
          <button className={styles.primary} type="submit" disabled={!draft.amount.trim() || !draft.concept.trim() || !draft.employeeId}>{busy ? 'Saving…' : 'Save Bonus'}</button>
        </fieldset>
      </form>
    </div>
    {voiding ? <div className={styles.confirm} role="dialog" aria-modal="false" aria-label="Cancel bonus">
      <h3>Cancel {money(voiding.amountAfl)} for {voiding.employeeName}?</h3><p>{voiding.concept}</p><label className={styles.field}>Cancellation reason<textarea aria-label="Bonus cancellation reason" maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} disabled={busy} /></label><div><button type="button" disabled={busy} onClick={() => setVoiding(null)}>Keep Bonus</button><button type="button" disabled={busy || !voidReason.trim()} onClick={() => void confirmVoid()}>Confirm Cancellation</button></div>
    </div> : null}
  </section>;
}
