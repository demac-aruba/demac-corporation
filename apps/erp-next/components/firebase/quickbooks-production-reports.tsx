'use client';
import { useEffect, useRef, useState } from 'react';
import { readProductionReport, type ProductionReport, type ProductionReportInput } from '@/lib/firebase/quickbooks-reports';
import styles from './quickbooks-production-reports.module.css';
export function QuickBooksProductionReports({ uid }: { uid: string }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [input, setInput] = useState<ProductionReportInput>({ report: 'ProfitAndLoss', startDate: `${today.slice(0, 7)}-01`, endDate: today, basis: 'Accrual' });
  const [result, setResult] = useState<ProductionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false); const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function change(patch: Partial<ProductionReportInput>) { setInput(previous => ({ ...previous, ...patch })); setResult(null); setError(null); }
  async function consult() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setResult(null);
    try { const data = await readProductionReport(uid, input); if (alive.current) setResult(data); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el informe.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const snapshot = result?.report; const range = input.report === 'ProfitAndLoss'; const aged = input.report.startsWith('Aged');
  return <section className={styles.reports} aria-label="Informes reales de QuickBooks" aria-busy={busy}>
    <h2>Informes reales · solo lectura</h2>
    <p>Consulta los registros existentes en QuickBooks de DEMAC. Los movimientos que registres en el ERP todavía no se envían a QuickBooks.</p>
    <form onSubmit={event => { event.preventDefault(); void consult(); }}>
      <label className={styles.reportChoice}>Informe<select aria-label="Informe" disabled={busy} value={input.report} onChange={event => change({ report: event.target.value as ProductionReportInput['report'], startDate: event.target.value === 'ProfitAndLoss' ? `${input.endDate.slice(0, 7)}-01` : input.endDate, basis: 'Accrual' })}>
        <option value="ProfitAndLoss">Ingresos y gastos · Profit and Loss</option><option value="BalanceSheet">Balance general · Balance Sheet</option>
        <option value="AgedReceivables">Cuentas por cobrar · A/R Aging Summary</option><option value="AgedPayables">Cuentas por pagar · A/P Aging Summary</option>
      </select></label>
      {range ? <label>Desde<input type="date" required disabled={busy} value={input.startDate} max={input.endDate} onChange={event => change({ startDate: event.target.value })} /></label> : null}
      <label>{range ? 'Hasta' : 'Fecha de corte'}<input type="date" required disabled={busy} value={input.endDate} onChange={event => change({ endDate: event.target.value, ...(!range ? { startDate: event.target.value } : {}) })} /></label>
      <label>Base contable<select aria-label="Base contable" disabled={busy || aged} value={input.basis} onChange={event => change({ basis: event.target.value as ProductionReportInput['basis'] })}>
        <option value="Accrual">Devengado · Accrual</option><option value="Cash">Efectivo · Cash</option>
      </select></label>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Consultando QuickBooks…' : 'Consultar informe real'}</button>
    </form>
    {range ? <p className={styles.hint}>Períodos de hasta 183 días por consulta.</p> : null}
    {busy ? <p role="status">Consultando el informe solicitado…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {snapshot && result ? <div aria-live="polite">
      <p><strong>{result.companyName} · Moneda: {snapshot.currency}</strong><br />
        {result.request.report === 'ProfitAndLoss' ? `${snapshot.startPeriod} — ${snapshot.endPeriod}` : `Fecha de corte: ${snapshot.endPeriod}`}<br />
        Base informada por QuickBooks: {snapshot.basis === 'Accrual' ? 'Devengado' : snapshot.basis === 'Cash' ? 'Efectivo' : 'No indicada'}<br />
        Consultado: <time dateTime={result.fetchedAt}>{new Date(result.fetchedAt).toLocaleString('es')}</time></p>
      {snapshot.noData ? <p role="status">QuickBooks indica que no hay datos para esta consulta.</p> : null}
      {snapshot.rows.length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabla del informe real">
        <table><caption>Importes originales de QuickBooks · {snapshot.currency}</caption>
          <thead><tr>{snapshot.columns.map((column, index) => <th scope="col" key={index}>{column.title || (index === 0 ? 'Concepto' : column.type)}</th>)}</tr></thead>
          <tbody>{snapshot.rows.map((row, index) => <tr key={index} className={row.kind === 'data' ? undefined : styles.emphasis}>
            {row.values.map((value, column) => <td key={column} style={column === 0 ? { paddingInlineStart: 10 + row.depth * 10 } : undefined}>{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : null}
      <p className={styles.hint}>La consulta refleja los registros de QuickBooks para el período seleccionado; no confirma una conciliación bancaria ni una auditoría contable.</p>
    </div> : null}
  </section>;
}
