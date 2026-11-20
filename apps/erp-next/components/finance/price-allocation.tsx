import { amount, type BillLine, type saleQuote } from '../../lib/supplier-bill-draft';
import { allocationShare } from '../../lib/allocation-share';
import s from './price-calculator.module.css';

type Allocation = NonNullable<NonNullable<ReturnType<typeof saleQuote>>['allocation']>;

type Props = {
  line: BillLine;
  allocation: Allocation;
  suggested: Allocation | null;
  recommendedPrice: bigint;
};

const funds = [
  ['restock', 'Reposición'],
  ['taxes', 'Impuesto'],
  ['marketing', 'Marketing'],
  ['profit', 'Ganancia'],
  ['operations', 'Operaciones'],
] as const;

export function PriceAllocation({ line, allocation, suggested, recommendedPrice }: Props) {
  const hasFinal = line.finalPrice.trim() !== '';
  const changed = hasFinal && allocation.price !== recommendedPrice;
  const priceKind = hasFinal ? 'final' : 'sugerido';
  const targets = {
    restock: '',
    taxes: 'Fijo 7%',
    marketing: `Objetivo ${line.marketing}%`,
    profit: `Objetivo ${line.profit}%`,
    operations: `Objetivo ${line.operations}%`,
  };

  return <>
    <p className={s.allocationLabel}>Distribución del precio {priceKind} · Afl {amount(allocation.price)} por unidad</p>
    <div className={s.funds}>
      {funds.map(([key, name]) => <div key={key}>
        <span>{name}</span>
        <b>Afl {amount(allocation[key])}</b>
        <div className={s.shares}>
          {targets[key] && <span>{targets[key]}</span>}
          <strong className={changed ? s.finalShare : undefined}>
            {hasFinal ? 'Real' : 'Previsto'} {allocationShare(allocation[key], allocation.price)}
          </strong>
        </div>
        {changed && <small className={s.referenceShare}>{allocationShare(allocation[key], recommendedPrice)} del precio sugerido</small>}
      </div>)}
    </div>
    {allocation.price === 0n && <p className={s.hint}>Con un precio de Afl 0.00, el porcentaje sobre la venta queda sin definir.</p>}
    {allocation.operations < 0n && <p role="alert">Este precio no cubre reposición, impuesto, marketing y ganancia: operaciones queda en negativo.</p>}
    {changed && suggested && <details className={s.comparison}>
      <summary>Comparar con el precio sugerido</summary>
      <div className={s.scroll}><table>
        <caption>Distribución por unidad en florines</caption>
        <thead><tr>
          <th scope="col">Fondo</th>
          <th scope="col">Al sugerido<br/>Afl {amount(recommendedPrice)}</th>
          <th scope="col">Al final<br/>Afl {amount(allocation.price)}</th>
          <th scope="col">Diferencia</th>
        </tr></thead>
        <tbody>{funds.map(([key, name]) => {
          const difference = allocation[key] - suggested[key];
          return <tr key={key}>
            <th scope="row">{name}</th>
            <td>{amount(suggested[key])}</td>
            <td>{amount(allocation[key])}</td>
            <td>{difference > 0n ? '+' : ''}{amount(difference)}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>}
  </>;
}
