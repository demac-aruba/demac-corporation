import { amount, type summarizeBill } from '../../lib/supplier-bill-draft';
import { ChargeIcon } from '../scheduling/appointment-charge-icons';
import s from './price-calculator.module.css';

const funds = [
  ['marketing', 'Marketing'],
  ['profit', 'Ganancia prevista'],
  ['operations', 'Operaciones'],
  ['taxes', 'Impuesto sobre venta · 7%'],
  ['restock', 'Reposición de stock'],
] as const;

export function PriceCalculationSummary({ summary }: { summary: ReturnType<typeof summarizeBill> }) {
  const { totals, finalCount, suggestedCount, pendingLines, internalCount } = summary;
  const hasSales = finalCount + suggestedCount > 0;
  const partial = pendingLines.length > 0;

  return <section className={s.panel} aria-labelledby="price-summary-heading">
    <header className={s.bar}>
      <div>
        <h2 id="price-summary-heading"><ChargeIcon name="grid" />Resumen de toda la mercancía</h2>
        {hasSales && <p className={s.inputHelp}>
          {finalCount + suggestedCount === 1 ? '1 artículo' : (finalCount + suggestedCount) + ' artículos'}
          {' · '}{finalCount} con precio final · {suggestedCount} con precio sugerido
        </p>}
      </div>
      {hasSales && <div className={s.projectedSales}>
        <span>{partial ? 'Venta proyectada parcial' : 'Venta proyectada'}</span>
        <strong>Afl {amount(totals.sales)}</strong>
      </div>}
    </header>
    <div className={s.summaryBody}>
      {hasSales && <dl className={s.summaryFunds}>
        {funds.map(([key, label]) => <div key={key} data-fund={key}>
          <dt>{label}</dt><dd data-negative={totals[key] < 0n}>Afl {amount(totals[key])}</dd>
        </div>)}
      </dl>}
      {partial && <p className={s.pending}>
        <ChargeIcon name="info" />
        {hasSales ? 'Resumen parcial. ' : ''}
        {pendingLines.length === 1 ? 'Revisa los datos de la línea ' : 'Revisa los datos de las líneas '}
        {pendingLines.join(', ')} para incluir {pendingLines.length === 1 ? 'su importe' : 'sus importes'}.
      </p>}
      {internalCount > 0 && <p className={s.hint}>
        {internalCount === 1 ? '1 artículo de uso interno figura' : internalCount + ' artículos de uso interno figuran'} solo en los totales de compra.
      </p>}
    </div>
  </section>;
}
