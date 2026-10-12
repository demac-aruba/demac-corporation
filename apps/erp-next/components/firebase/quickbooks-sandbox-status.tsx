'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { loadQuickBooksSandbox, readQuickBooksSandboxStatus, startQuickBooksSandbox, readQuickBooksSandboxReport,
  type QuickBooksReportInput, type QuickBooksSandboxReport, type QuickBooksSandboxStatus } from '@/lib/firebase/quickbooks-sandbox';
import styles from './quickbooks-sandbox-status.module.css';

function SandboxReports({ uid, busy, setBusy }: { uid: string; busy: boolean; setBusy: (value: boolean) => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [input, setInput] = useState<QuickBooksReportInput>({ report: 'ProfitAndLoss', startDate: `${today.slice(0, 7)}-01`, endDate: today, basis: 'Accrual' });
  const [result, setResult] = useState<QuickBooksSandboxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function change(patch: Partial<QuickBooksReportInput>) { setInput(previous => ({ ...previous, ...patch })); setResult(null); setError(null); }
  async function consult() {
    if (busy) return;
    setBusy(true); setError(null); setResult(null);
    try { const report = await readQuickBooksSandboxReport(uid, input); if (alive.current) setResult(report); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el informe.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const snapshot = result?.report;
  return <section className={styles.reports} aria-label="Informes del sandbox">
    <h3>Informes de prueba · solo lectura</h3>
    <p>Consulta los datos de esta empresa de prueba. Los importes provienen de QuickBooks y no representan las finanzas de DEMAC.</p>
    <form onSubmit={event => { event.preventDefault(); void consult(); }}>
      <label>Informe<select aria-label="Informe" disabled={busy} value={input.report} onChange={event => change({ report: event.target.value as QuickBooksReportInput['report'], basis: 'Accrual' })}>
        <option value="ProfitAndLoss">Ingresos y gastos (resultados)</option><option value="BalanceSheet">Balance general</option><option value="AgedReceivables">Cuentas por cobrar</option>
      </select></label>
      {input.report === 'ProfitAndLoss' ? <label>Desde<input type="date" required disabled={busy} value={input.startDate} max={input.endDate}
        onChange={event => change({ startDate: event.target.value })} /></label> : null}
      <label>{input.report === 'ProfitAndLoss' ? 'Hasta' : 'Fecha de corte'}<input type="date" required disabled={busy} value={input.endDate}
        onChange={event => change({ endDate: event.target.value, ...(input.report !== 'ProfitAndLoss' ? { startDate: event.target.value } : {}) })} /></label>
      <label>Base contable<select aria-label="Base contable" disabled={busy || input.report === 'AgedReceivables'} value={input.basis}
        onChange={event => change({ basis: event.target.value as QuickBooksReportInput['basis'] })}>
        <option value="Accrual">Devengado</option><option value="Cash">Efectivo</option>
      </select></label>
      <button className={`btn ${styles.retry}`} type="submit" disabled={busy}>{busy ? 'Consultando…' : 'Consultar informe de prueba'}</button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {snapshot && result ? <div role="region" aria-label="Resultado de QuickBooks" aria-live="polite">
      <p><strong>{result.companyName} · {snapshot.currency}</strong><br />
        {result.request.report === 'ProfitAndLoss' ? `${snapshot.startPeriod} — ${snapshot.endPeriod}` : `Al ${snapshot.endPeriod}`} · Base: {snapshot.basis === 'Accrual' ? 'Devengado' : snapshot.basis === 'Cash' ? 'Efectivo' : 'No indicada por QuickBooks'}<br />
        Consultado: <time dateTime={result.fetchedAt}>{new Date(result.fetchedAt).toLocaleString('es')}</time></p>
      {snapshot.noData ? <p>QuickBooks indica que no hay datos para esta consulta.</p> : null}
      {snapshot.rows.length > 0 ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabla del informe">
        <table><caption>Datos del sandbox · importes originales de QuickBooks</caption>
          <thead><tr>{snapshot.columns.map((column, index) => <th scope="col" key={index}>{column.title || (index === 0 ? 'Concepto' : column.type)}</th>)}</tr></thead>
          <tbody>{snapshot.rows.map((row, index) => <tr key={index} className={row.kind === 'data' ? undefined : styles.emphasis}>
            {row.values.map((value, column) => <td key={column} style={column === 0 ? { paddingInlineStart: 10 + row.depth * 10 } : undefined}>{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : null}
    </div> : null}
  </section>;
}

function SandboxCard({ uid }: { uid: string | null }) {
  const [status, setStatus] = useState<QuickBooksSandboxStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    setBusy(true);
    setError(null);
    void loadQuickBooksSandbox(uid).then(result => { if (active) setStatus(result); }, async failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la conexión.');
      // A cancelled/expired handshake must not disable the button needed to start a fresh one.
      try { const result = await readQuickBooksSandboxStatus(uid); if (active) setStatus(result); } catch { /* Retain safe error and retry control. */ }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [uid, reload]);

  async function connect() {
    if (!uid || busy) return;
    setBusy(true);
    setError(null);
    try { await startQuickBooksSandbox(uid); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo iniciar la conexión.');
      setBusy(false);
    }
  }
  const connection = status?.connection;
  return <article className={`panel sg-integration-card ${styles.card}`} aria-busy={busy}>
    <div className="sg-integration-head">
      <div className="sg-provider-mark">QB</div>
      <div><span>Accounting · prueba</span><h2>QuickBooks Online</h2></div>
      <b className={connection ? 'ready' : ''}>{connection ? 'Sandbox autorizado' : status?.configured ? 'Por conectar' : 'Configuración pendiente'}</b>
    </div>
    <p>Primero autorizamos la empresa de prueba y verificamos su identidad. La sincronización de facturas, pagos y gastos todavía no está habilitada.</p>
    {connection ? <div className={styles.details}>
      <strong>{connection.companyName}</strong>
      <p>Empresa de prueba · ID {connection.realmId}{connection.country ? ` · ${connection.country}` : ''}<br />
        Identidad verificada: <time dateTime={connection.verifiedAt}>{new Date(connection.verifiedAt).toLocaleString('es')}</time>.
        Esta fecha corresponde a la última autorización; no confirma acceso continuo.</p>
    </div> : status?.configured ? <p>Sandbox esperado: {status.expectedRealmId}</p> : null}
    {!uid ? <p>Solo el propietario o un administrador puede gestionar esta conexión.</p> : null}
    {uid && status && !status.configured ? <p>Falta activar la conexión de prueba en el servidor. No introduzcas credenciales en esta pantalla.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="sg-integration-foot">
      <div><span>Environment</span><strong>Sandbox · sin movimientos contables</strong></div>
      {uid ? <button type="button" disabled={busy || !status?.configured} onClick={() => void connect()}>
        {busy ? 'Procesando…' : connection ? 'Volver a autorizar sandbox' : 'Conectar sandbox →'}
      </button> : null}
    </div>
    {uid ? <button className={`btn ${styles.retry}`} type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Consultar estado / reintentar</button> : null}
    {uid && connection ? <SandboxReports key={connection.connectedAt} uid={uid} busy={busy} setBusy={setBusy} /> : null}
  </article>;
}

export function QuickBooksSandboxStatusCard() {
  const { principal, status } = useAuth();
  const uid = status === 'ready' && principal.active && principal.role === 'super_admin' ? principal.userId : null;
  return <SandboxCard key={uid || 'unauthorized'} uid={uid} />;
}
