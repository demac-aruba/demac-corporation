import type { ChargeLine, ChargeQuote, ChargeRecord } from '../../lib/appointment-charges';
import { chargeMoney } from '../../lib/appointment-charges';
import { ChargeIcon, type ChargeIconName } from './appointment-charge-icons';
import styles from './appointment-charges.module.css';

const deltaMoney = (cents: number) => `${cents > 0 ? '+ ' : cents < 0 ? '− ' : ''}${chargeMoney(Math.abs(cents))}`;
function lineChange(line: ChargeLine, original: ChargeQuote | null | undefined) {
  if (!original) return '';
  const before = original.lines.find(item => item.id === line.id);
  if (!before) return 'Concepto añadido';
  if (before.label !== line.label || before.serviceId !== line.serviceId || before.presetId !== line.presetId) return 'Servicio cambiado';
  if (String(before.btu ?? '') !== String(line.btu ?? '') || before.quantityMillis !== line.quantityMillis) return 'Alcance ajustado';
  return before.unitCents !== line.unitCents ? 'Precio ajustado' : '';
}

export function ChargeOverviewMetrics({ record }: { record: ChargeRecord }) {
  const state = record.state, final = state?.final, original = state?.originalEstimate;
  const total = final?.totalCents ?? state?.estimate?.totalCents;
  const balance = total == null ? null : total - (state?.receivedCents ?? 0);
  const difference = final?.totalCents != null && original?.totalCents != null ? final.totalCents - original.totalCents : null;
  const paymentCount = record.payments.filter(payment => payment.status === 'recorded').length;
  const metrics: { icon: ChargeIconName; label: string; value: number | null | undefined; note: string; tone: string }[] = [
    { icon: 'receipt', label: 'PROYECCIÓN DEL BOOKING', value: original?.totalCents, note: original ? 'Proyección original conservada' : 'Sin proyección guardada', tone: '' },
    { icon: 'receipt', label: 'IMPORTE FINAL', value: final?.totalCents ?? null, note: difference !== null ? `${deltaMoney(difference)} vs. estimado` : final ? 'Confirmado por oficina' : 'Por confirmar', tone: styles.violet },
    { icon: 'money', label: 'RECIBIDO', value: state ? state.receivedCents : undefined, note: record.blocker ? 'Pagos pendientes de conciliación' : `${paymentCount} pago${paymentCount === 1 ? '' : 's'} vigente${paymentCount === 1 ? '' : 's'}`, tone: styles.green },
    { icon: 'clock', label: balance !== null && balance < 0 ? 'SALDO A FAVOR' : final ? 'PENDIENTE' : 'SALDO ESTIMADO', value: balance === null ? null : Math.abs(balance), note: !final ? 'Hasta confirmar el importe final' : balance === null ? 'Por confirmar' : balance < 0 ? 'Importe recibido por encima del total' : balance === 0 ? 'Sin saldo pendiente' : state?.receivedCents ? 'Pago parcial' : 'Por cobrar', tone: balance === 0 ? styles.green : styles.amber },
  ];
  return <div className={styles.metrics}>{metrics.map(metric => <div className={`${styles.metric} ${metric.tone}`} key={metric.label}>
    <div className={styles.tile}><ChargeIcon name={metric.icon}/></div><div><span>{metric.label}</span><strong>{metric.value === undefined ? 'Sin registrar' : chargeMoney(metric.value)}</strong><small>{metric.note}</small></div>
  </div>)}</div>;
}

export function ChargeLineSummary({ record }: { record: ChargeRecord }) {
  const state = record.state, current = state?.final || state?.estimate, original = state?.originalEstimate;
  const difference = state?.final?.totalCents != null && original?.totalCents != null ? state.final.totalCents - original.totalCents : null;
  // Compare the persisted snapshots by stable line identity. Never infer work,
  // equipment, tariffs or amounts that are absent from the financial record.
  const changes: { id: string; label: string; cents: number }[] = [];
  if (state?.final && original && difference !== null) {
    for (const line of state.final.lines) {
      const before = original.lines.find(item => item.id === line.id);
      if (line.totalCents === null || before?.totalCents === null) continue;
      const cents = line.totalCents - (before?.totalCents ?? 0);
      if (cents) changes.push({ id: line.id, label: `${before ? 'Ajuste' : 'Añadido'} · ${line.label}`, cents });
    }
    for (const line of original.lines) if (!state.final.lines.some(item => item.id === line.id) && line.totalCents != null && line.totalCents !== 0) changes.push({ id: `removed-${line.id}`, label: `Retirado · ${line.label}`, cents: -line.totalCents });
  }
  const reconciled = changes.reduce((sum, item) => sum + item.cents, 0) === difference;
  return <>
    {current ? <div className={styles.tableScroll}><table className={`${styles.table} ${styles.workTable}`}><thead><tr><th>Concepto</th><th>Cant.</th><th>Precio unit.</th><th>Importe</th></tr></thead><tbody>{current.lines.map(line => {
      const change = state?.final ? lineChange(line, original) : '';
      return <tr key={line.id}><td><div className={styles.workConcept}><span className={`${styles.tile} ${change === 'Concepto añadido' ? styles.violet : ''}`}><ChargeIcon name={line.btu ? 'air' : change === 'Concepto añadido' ? 'plus' : 'work'}/></span><div><strong>{line.label}</strong><div className={styles.lineTags}>{line.projectionOnly ? <span className={styles.badge}>Tarifa mínima · BTU por confirmar</span> : null}{line.btu ? <span className={styles.btu}>{Number(line.btu).toLocaleString('en-US')} BTU</span> : null}{change ? <span className={styles.changeTag}>{change}</span> : line.manualPrice ? <span className={styles.badge}>Precio acordado</span> : null}</div>{line.pendingReason ? <small>{line.pendingReason}</small> : null}{line.reason ? <small>{line.reason}</small> : null}</div></div></td><td>{line.quantityMillis / 1000}</td><td>{chargeMoney(line.unitCents)}</td><td><strong>{chargeMoney(line.totalCents)}</strong></td></tr>;
    })}</tbody></table></div> : <div className={styles.empty}>Esta cita todavía no tiene importes registrados.</div>}
    {state?.final && (state.final.note || difference !== null && difference !== 0) ? <div className={styles.changeExplanation}><ChargeIcon name="info"/><div><strong>{difference !== null && difference !== 0 ? '¿Por qué cambió el importe?' : 'Detalle del importe final'}</strong>{reconciled && changes.length ? <ul>{changes.map(change => <li key={change.id}><span>{change.label}</span><b>{deltaMoney(change.cents)}</b></li>)}</ul> : null}{state.final.note ? <p>{state.final.note}</p> : null}</div></div> : null}
    <div className={styles.finalTotal}><span>{state?.final ? 'Total final' : 'Proyección actual'}</span><strong>{chargeMoney(current?.totalCents)}</strong></div>
    {state?.final && state.estimate ? <details className={styles.priorEstimate}><summary>Ver proyección actual</summary><span>{chargeMoney(state.estimate.totalCents)}</span></details> : null}
  </>;
}
