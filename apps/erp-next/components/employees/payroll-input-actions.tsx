'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import type { CanonicalStaffProfile } from '@/lib/canonical-operations';
import { payrollPeriodBounds, type EmployeePayrollSettings, type EmployeeSalaryAdvance, type SalaryAdvanceMethod } from '@/lib/employee-attendance';
import { activeSalaryAdvance, correctSalaryAdvance } from '@/lib/employee-advances';
import { BONUS_CATEGORIES, correctEmployeeBonus, type BonusCategory, type PayrollBonus } from '@/lib/employee-bonuses';
import type { PayrollInputChange } from '@/lib/payroll-input-corrections';
import styles from './payroll-input-actions.module.css';

type Props = { kind: 'advance'; record: EmployeeSalaryAdvance; onSaved: (record: EmployeeSalaryAdvance) => void }
  | { kind: 'bonus'; record: PayrollBonus; employee: CanonicalStaffProfile; onSaved: (record: EmployeePayrollSettings) => void };
const labels: Record<string, string> = { employeeId: 'Employee ID', employeeName: 'Employee', date: 'Date', payrollPeriodId: 'Payroll period', amount: 'Amount (Afl.)', method: 'Method', reference: 'Reference', notes: 'Notes', category: 'Bonus type', concept: 'Concept', status: 'Status' };
const dateTime = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString('en-GB', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' }) : date;
const valueLabel = (key: string, value: string | number) => key === 'amount' ? `Afl. ${Number(value).toFixed(2)}` : key === 'category' ? BONUS_CATEGORIES[value as BonusCategory] ?? value : key === 'status' && value === 'voided' ? 'Deleted' : String(value || '—');

export function PayrollInputActions(props: Props) {
  const { record, kind } = props;
  const [mode, setMode] = useState<'edit' | 'delete' | 'history' | null>(null);
  const active = kind === 'advance' ? activeSalaryAdvance(record as EmployeeSalaryAdvance) : record.status === 'active';
  return <div className={styles.actions}>
    {active ? <><button type="button" onClick={() => setMode('edit')}>Edit</button><button type="button" className={styles.danger} onClick={() => setMode('delete')}>Delete</button></> : <span className={styles.deleted}>Deleted</span>}
    <button type="button" onClick={() => setMode('history')}>History</button>
    {mode ? <InputDialog key={mode} {...props} mode={mode} onClose={() => setMode(null)} /> : null}
  </div>;
}

function InputDialog(props: Props & { mode: 'edit' | 'delete' | 'history'; onClose: () => void }) {
  const { principal } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const { record, mode } = props;
  const advance = props.kind === 'advance' ? props.record : null;
  const bonus = props.kind === 'bonus' ? props.record : null;
  const title = `${mode === 'edit' ? 'Edit' : mode === 'delete' ? 'Delete' : 'History of'} ${advance ? 'salary advance' : 'bonus'}`;
  const [requestId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(record.date);
  const [amount, setAmount] = useState(String(advance?.amount ?? bonus?.amountAfl));
  const [method, setMethod] = useState<SalaryAdvanceMethod>(advance?.method ?? 'Cash');
  const [reference, setReference] = useState(advance?.reference ?? '');
  const [notes, setNotes] = useState(advance?.notes ?? '');
  const [category, setCategory] = useState<BonusCategory>(bonus?.category ?? 'other');
  const [concept, setConcept] = useState(bonus?.concept ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save() {
    if (mode === 'history' || busy) return;
    setBusy(true); setError('');
    try {
      const correction = { requestId, action: mode, reason, principal };
      if (props.kind === 'advance') props.onSaved(await correctSalaryAdvance({ advance: props.record, draft: { date, amount, method, reference, notes }, correction }));
      else props.onSaved(await correctEmployeeBonus({ bonus: props.record, employee: props.employee, draft: { date, amount, category, concept }, correction }));
      props.onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const creator = advance?.recordedByName ?? bonus?.createdByName;
  const creatorId = advance?.recordedByUserId ?? bonus?.createdByUserId;
  return <dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) props.onClose(); }}>
    <div className={styles.heading}><div><h2>{title}</h2><p>{record.employeeName} · {record.date} · Afl. {(advance?.amount ?? bonus?.amountAfl ?? 0).toFixed(2)}</p></div><button type="button" aria-label="Close payroll dialog" disabled={busy} onClick={props.onClose}>×</button></div>
    {mode === 'history' ? <div className={styles.history}>
      <article><h3>Recorded</h3><p>{creator || 'Operator not recorded'}{creatorId ? ` · ${creatorId}` : ''}</p><p>{dateTime(record.createdAt)} (Aruba)</p></article>
      {(record.changeHistory ?? []).map((event: PayrollInputChange) => <article key={event.id}><h3>{event.action === 'delete' ? 'Deleted' : 'Edited'}</h3><p>{event.actorName} · {event.actorId}</p><p>{dateTime(event.at)} (Aruba)</p><p><strong>Reason:</strong> {event.reason}</p><div className={styles.tableWrap}><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{Object.keys(event.after).filter((key) => event.before[key] !== event.after[key]).map((key) => <tr key={key}><td>{labels[key] ?? key}</td><td>{valueLabel(key, event.before[key])}</td><td>{valueLabel(key, event.after[key])}</td></tr>)}</tbody></table></div></article>)}
      {record.voidedAt && !record.changeHistory?.some((event) => event.action === 'delete') ? <article><h3>Cancelled</h3><p>{record.voidedByName || 'Operator not recorded'} · {dateTime(record.voidedAt)} (Aruba)</p><p><strong>Reason:</strong> {record.voidReason || 'Not recorded'}</p></article> : null}
      {!record.changeHistory?.length ? <p>No edit history was recorded for this entry.</p> : null}
    </div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <fieldset disabled={busy}>
        {mode === 'edit' ? <>
          <div className={styles.row}><label>Date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Amount (Afl.)<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div>
          {advance ? <><label>Method<select aria-label="Method" value={method} onChange={(event) => setMethod(event.target.value as SalaryAdvanceMethod)}><option>Cash</option><option>Bank Transfer</option></select></label><label>Reference / Receipt<input maxLength={500} value={reference} onChange={(event) => setReference(event.target.value)} /></label><label>Notes<textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></>
            : <><label>Bonus type<select aria-label="Bonus type" value={category} onChange={(event) => setCategory(event.target.value as BonusCategory)}>{Object.entries(BONUS_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Concept<textarea required maxLength={500} value={concept} onChange={(event) => setConcept(event.target.value)} /></label></>}
          {/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && payrollPeriodBounds(date).id !== record.payrollPeriodId ? <p className={styles.notice}>This date moves the amount to payroll period {payrollPeriodBounds(date).start} → {payrollPeriodBounds(date).end}.</p> : null}
        </> : <p className={styles.notice}>This entry will be excluded from payroll totals. Its original details and change history will remain available.</p>}
        <label>Reason for this change (required)<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this entry needs to be corrected or deleted." /></label>
        <p className={styles.operator}>Recorded as {principal.displayName}. Existing downloaded reports must be exported again.</p>
        <footer><button type="button" onClick={props.onClose}>Cancel</button><button type="submit" className={mode === 'delete' ? styles.deleteButton : styles.primary} disabled={!reason.trim()}>{busy ? 'Saving…' : mode === 'delete' ? 'Confirm deletion' : 'Save changes'}</button></footer>
      </fieldset>
    </form>}
    {mode === 'history' ? <footer><button type="button" onClick={props.onClose}>Close</button></footer> : null}
  </dialog>;
}
