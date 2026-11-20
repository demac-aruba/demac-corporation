'use client';

import { useState, type ReactNode } from 'react';
import {
  amount, compareMarket, percentOf, sellable, type BillDraft, type BillLine,
  type evaluateLine, type MarketReference, type summarizeBill,
} from '../../lib/supplier-bill-draft';
import { InventoryIcon } from '../inventory/inventory-visuals';
import { ChargeIcon } from '../scheduling/appointment-charge-icons';
import s from './price-purchase-analysis.module.css';

type Props = {
  bill: BillDraft;
  results: ReturnType<typeof evaluateLine>[];
  summary: ReturnType<typeof summarizeBill>;
  editItem: (index: number) => void;
  updateLine: (index: number, patch: Partial<BillLine>) => void;
};

const funds = [
  ['restock', 'Reposición', '#2674cc'],
  ['taxes', 'Impuesto', '#e4a43b'],
  ['marketing', 'Marketing', '#896ada'],
  ['profit', 'Ganancia prevista', '#25936e'],
  ['operations', 'Operaciones', '#48a3b3'],
] as const;

const analysisIcons = {
  sales: 'M3 18h18M5 14l5-5 4 3 6-7m-5 0h5v5',
  margin: 'M3 20h18M6 16v-3m5 3V9m5 7V5M4 9l7-6h4',
  chart: 'M10 3a9 9 0 1 0 11 11H10zM14 2v8h8a9 9 0 0 0-8-8Z',
  scale: 'M12 3v17m-5 1h10M3 7l9-2 9 2M6 7l-4 7h8L6 7Zm12 0-4 7h8l-4-7Z',
};

function ChartIcon({ name }: { name: keyof typeof analysisIcons }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round"><path d={analysisIcons[name]} /></svg>;
}

function money(value: bigint | null | undefined) {
  return value == null ? '—' : 'Afl ' + amount(value);
}

function percent(bps: bigint | null) {
  return bps == null ? '—' : amount(bps) + '%';
}

function itemName(line: BillLine, index: number) {
  return line.description.trim() || 'Artículo ' + (index + 1);
}

function Kpi({ icon, label, value, detail, tone }: {
  icon: ReactNode; label: string; value: bigint | null; detail: ReactNode; tone: string;
}) {
  return <section className={s.kpi} data-tone={tone}>
    <h3><i>{icon}</i>{label}</h3>
    <p className={s.kpiValue}>{value === null ? '—' : <><small>Afl</small> {amount(value)}</>}</p>
    <div className={s.kpiDetail}>{detail}</div>
  </section>;
}

function PanelHeader({ icon, title, children, badge }: {
  icon: ReactNode; title: string; children?: ReactNode; badge?: ReactNode;
}) {
  return <header className={s.panelHead}>
    <div><h2>{icon}{title}</h2>{children && <p>{children}</p>}</div>
    {badge}
  </header>;
}

const emptyMarket: MarketReference = { price: '', source: '', date: '', simulated: false };

function MarketPanel({ bill, results, updateLine }: Pick<Props, 'bill' | 'results' | 'updateLine'>) {
  const [chosen, setChosen] = useState<number | null>(null);
  const indices = bill.lines.map((_, index) => index).filter(index => sellable(bill.lines[index].use));
  const selected = chosen !== null && indices.includes(chosen)
    ? chosen : indices.find(index => bill.lines[index].market) ?? indices[0];
  const line = bill.lines[selected];
  const price = results[selected]?.quote?.allocation?.price;
  const market = line?.market ?? emptyMarket;
  const comparison = price == null ? null : compareMarket(price, line?.market);
  const valid = comparison?.status === 'simulated' || comparison?.status === 'compared' ? comparison : null;
  const captured = indices.filter(index => {
    const itemPrice = results[index]?.quote?.allocation?.price;
    return itemPrice != null && compareMarket(itemPrice, bill.lines[index].market).status === 'compared';
  }).length;
  function editMarket(changes: Partial<MarketReference>) {
    updateLine(selected, { market: { ...market, ...changes } });
  }
  const position = valid?.position === 'below' ? 'por debajo' : 'por encima';

  return <section className={s.panel}>
    <PanelHeader title="Comparación con el mercado" icon={<ChartIcon name="scale" />}
      badge={line && <span className={s.badge} data-sample={!!market.simulated}>
        {market.simulated ? 'Referencia simulada' : valid ? 'Referencia ingresada' : 'Sin comparar'}
      </span>}>
      Compara el precio de venta por unidad con una cotización equivalente en florines.
    </PanelHeader>
    {!line ? <p className={s.note}>Agrega un artículo para venta para comparar su precio.</p> : <>
      <label className={s.marketChoice}>Artículo
        <select value={selected} onChange={event => setChosen(Number(event.target.value))}>
          {indices.map(index => <option key={index} value={index}>{itemName(bill.lines[index], index)}</option>)}
        </select>
      </label>
      <div className={s.compare}>
        <div><small>Precio DEMAC</small><b>{money(price)}</b></div>
        <div><small>{market.simulated ? 'Referencia de ejemplo' : 'Referencia de mercado'}</small>
          <b>{money(valid?.referencePrice)}</b></div>
        <div><small>Diferencia</small>{valid ? <><b className={s.marketResult}>
          {valid.position === 'equal' ? 'Mismo precio' : percent(valid.differenceBps < 0n ? -valid.differenceBps : valid.differenceBps) + ' ' + position}
        </b><small>{valid.difference > 0n ? '+' : ''}{money(valid.difference)}</small></> : <b>—</b>}</div>
      </div>
      {valid && <p className={s.source}>Fuente: {market.source} · {market.date}</p>}
      <details className={s.referenceDetails} key={selected}>
        <summary>{line.market ? 'Editar referencia' : 'Ingresar referencia de mercado'}</summary>
        <div className={s.referenceFields}>
          <label>Precio de referencia (Afl/u)<input inputMode="decimal" maxLength={16} value={market.price}
            onChange={event => editMarket({ price: event.target.value })} /></label>
          <label>Fuente de la cotización<input value={market.source} maxLength={240}
            onChange={event => editMarket({ source: event.target.value })} /></label>
          <label>Fecha de la cotización<input type="date" value={market.date}
            onChange={event => editMarket({ date: event.target.value })} /></label>
          <label className={s.check}><input type="checkbox" checked={!!market.simulated}
            onChange={event => editMarket({ simulated: event.target.checked })} />Referencia simulada</label>
        </div>
      </details>
      {price == null && <p className={s.note}>Completa el costo, los porcentajes y un precio válido para comparar este artículo.</p>}
      {comparison?.status === 'incomplete' && <p className={s.note}>Completa el precio, la fuente y la fecha de la cotización.</p>}
      {comparison?.status === 'invalid' && <p className={s.note}>Revisa el precio de referencia y la fecha. El importe debe ser mayor que cero y tener hasta dos decimales.</p>}
      <p className={s.marketNote}><ChargeIcon name="info" />{captured} de {indices.length} artículos de venta con cotización ingresada y fechada (excluye simulaciones).</p>
    </>}
  </section>;
}

export function PricePurchaseAnalysis({ bill, results, summary, editItem, updateLine }: Props) {
  const { totals, analysis, finalCount, suggestedCount, internalCount, pendingLines } = summary;
  const { purchase, purchasePendingLines, negativeOperationsLines } = analysis;
  const count = finalCount + suggestedCount;
  const hasSales = count > 0;
  const hasCosts = bill.lines.length > purchasePendingLines.length;
  const salesPartial = pendingLines.length > 0;
  const costsPartial = purchasePendingLines.length > 0;
  const importRatesVary = bill.lines.some(line => line.importOverride !== null && line.importOverride !== bill.generalImport);
  const negativeNames = negativeOperationsLines.map(number => itemName(bill.lines[number - 1], number - 1));
  const needsReview = negativeNames.length > 0 || analysis.operationsShortfall > 0n;
  const showUnits = analysis.productUnits !== null && !salesPartial;
  const salesScope = showUnits
    ? analysis.productUnits!.toLocaleString('en-US') + (analysis.productUnits === 1n ? ' unidad' : ' unidades')
    : count + (count === 1 ? ' artículo de venta calculado' : ' artículos de venta calculados');
  const opPercent = percent(percentOf(totals.operations, totals.sales));
  const targetPercent = percent(percentOf(analysis.operationsTarget, totals.sales));
  let verdict = 'La proyección cubre la meta de operaciones';
  if (negativeNames.length > 0) verdict = negativeNames.length === 1 ? 'Revisar ' + negativeNames[0] : 'Revisar ' + negativeNames.length + ' artículos';
  else if (needsReview) verdict = 'Operaciones queda por debajo de la meta';
  else if (!hasSales) verdict = 'Faltan artículos con precio de venta';
  else if (salesPartial || costsPartial) verdict = 'Completa los datos pendientes';
  const purchaseNote = costsPartial ? 'Costos pendientes en las líneas ' + purchasePendingLines.join(', ') + '.' : 'Costo puesto en depósito';
  const salesNote = salesPartial ? 'Proyección parcial · líneas pendientes: ' + pendingLines.join(', ') : 'A precios sugeridos';
  const purchaseLines = [
    ['Mercancía en florines', purchase.converted], ['Banco / wire', purchase.wire],
    ['Importación + shipping', purchase.shipping],
  ] as const;
  const imported = bill.currency === 'USD';
  const currency = imported ? 'USD' : 'Afl';

  return <div className={s.analysis}>
    <div className={s.kpis}>
      <Kpi icon={<InventoryIcon name="package" />} tone="blue"
        label={costsPartial && hasCosts ? 'Inversión estimada parcial' : 'Inversión estimada'}
        value={hasCosts ? purchase.landed : null} detail={purchaseNote} />
      <Kpi icon={<ChartIcon name="sales" />} tone="indigo"
        label={salesPartial && hasSales ? 'Venta proyectada parcial' : 'Venta proyectada'}
        value={hasSales ? totals.sales : null} detail={hasSales && !salesPartial ? salesNote + ' · ' + money(analysis.recommendedSales) : salesNote} />
      <Kpi icon={<ChartIcon name="margin" />} tone="teal" label={salesPartial && hasSales ? 'Margen bruto parcial' : 'Margen bruto'}
        value={hasSales ? analysis.grossMargin : null} detail={hasSales ? percent(percentOf(analysis.grossMargin, totals.sales)) + ' de la venta proyectada' : 'Venta menos costo de los artículos vendidos'} />
      <Kpi icon={<ChargeIcon name="money" />} tone="green" label={salesPartial && hasSales ? 'Ganancia prevista parcial' : 'Ganancia prevista'}
        value={hasSales ? totals.profit : null} detail={hasSales ? 'Reserva objetivo · ' + percent(percentOf(totals.profit, totals.sales)) + ' de la venta' : 'Reserva por artículo'} />
    </div>

    <div className={s.analysisGrid}>
      <section className={s.panel}>
        <PanelHeader icon={<ChartIcon name="chart" />} title="Distribución de la venta">
          {hasSales ? 'Proyección ' + (salesPartial ? 'parcial ' : '') + 'en florines para ' + salesScope + '.' : 'Completa los datos de venta para ver la distribución.'}
        </PanelHeader>
        {hasSales && <>
          {totals.sales > 0n && totals.operations >= 0n
            ? <div className={s.bar} aria-hidden="true">{funds.map(([key, , color]) =>
              <span key={key} style={{ flexGrow: Number(totals[key]), background: color }} />)}</div>
            : <p className={s.note}>{totals.sales === 0n ? 'El precio total es cero. Los porcentajes sobre la venta no se pueden calcular.' : 'Las reservas superan las ventas. El déficit de operaciones se muestra con signo negativo.'}</p>}
          <div className={s.legend}>{funds.map(([key, name, color]) => <div key={key}>
            <span className={s.fundName}><i style={{ background: color }} />{name}</span>
            <b data-negative={totals[key] < 0n}>{amount(totals[key])}</b><small>{percent(percentOf(totals[key], totals.sales))}</small>
          </div>)}</div>
        </>}
      </section>
      <section className={s.decision} data-tone={needsReview ? 'warning' : hasSales && !salesPartial && !costsPartial ? 'success' : 'neutral'}>
        <div className={s.decisionLabel}>{needsReview ? <InventoryIcon name="warning" /> : <ChargeIcon name={hasSales ? 'check' : 'info'} />}Evaluación de la compra</div>
        <h2>{verdict}</h2>
        {negativeNames.length > 0 && <p>{negativeNames.join(', ')}. El precio de venta deja un saldo negativo después de separar las reservas.</p>}
        {hasSales && <div className={s.decisionFoot}>
          <div><small>Operaciones {salesPartial ? 'del subtotal' : 'del lote'}</small><strong>{opPercent} <span>/ meta {targetPercent}</span></strong></div>
          <div><small>Faltan para la meta</small><strong>{money(analysis.operationsShortfall)}</strong></div>
        </div>}
      </section>
    </div>

    <section className={s.panel}>
      <PanelHeader title="Precios por artículo" icon={<ChargeIcon name="grid" />} badge={hasSales && <span className={s.badge}>{salesScope}</span>}>
        Importes por unidad. Escribe un precio final o deja la casilla vacía para usar el sugerido.
      </PanelHeader>
      <div className={s.tableScroll}><table className={s.table}>
        <thead><tr>{['Artículo', 'Cant.', 'Proveedor · ' + currency, 'Landed cost · Afl', 'Sugerido · Afl', 'Precio de venta · Afl', 'Operaciones · Afl'].map(name => <th scope="col" key={name}>{name}</th>)}</tr></thead>
        <tbody>{bill.lines.map((line, index) => {
          const { cost, quote } = results[index];
          const name = itemName(line, index);
          return <tr key={index}>
            <th scope="row"><button type="button" className={s.model} aria-label={'Editar ' + name} onClick={() => editItem(index)}>
              <i>{line.use === 'product' ? <ChargeIcon name="air" /> : <InventoryIcon name={line.use === 'tool' ? 'tool' : 'package'} />}</i>{name}
            </button></th>
            <td>{line.quantity || '—'}</td><td>{cost ? amount(cost.cost) : line.unitCost || '—'}</td>
            <td>{cost ? amount(cost.landed) : '—'}</td><td>{quote ? amount(quote.recommended) : '—'}</td>
            <td>{sellable(line.use) ? <input className={s.salePrice} data-auto={!line.finalPrice.trim()} inputMode="decimal" maxLength={16}
              aria-label={'Precio final de ' + name + ' (Afl)'} title="Deja en blanco para usar el precio sugerido."
              placeholder={quote ? amount(quote.recommended) : '—'} value={line.finalPrice}
              onChange={event => updateLine(index, { finalPrice: event.target.value })} /> : 'Uso interno'}</td>
            <td className={s.operation} data-negative={quote?.allocation && quote.allocation.operations < 0n}>
              {quote?.allocation ? amount(quote.allocation.operations) : '—'}
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      <footer className={s.tableFoot}>
        <span>Proveedor{costsPartial ? ' parcial' : ''} <b>{hasCosts ? currency + ' ' + amount(purchase.supplier) : '—'}</b></span>
        {imported && <><span>Cambio <b>1 USD = 1.80 Afl</b></span><span>Banco <b>{bill.wire.trim() ? bill.wire + '%' : 'Pendiente'}</b></span>
          <span>Importación + shipping <b>{bill.generalImport.trim() ? bill.generalImport + '% general' : 'Pendiente'}{importRatesVary && ' · ajustes por artículo'}</b></span></>}
      </footer>
      {(salesPartial || costsPartial || internalCount > 0) && <div className={s.tableNotes}>
        {salesPartial && <p>Proyección de venta pendiente en las líneas {pendingLines.join(', ')}.</p>}
        {costsPartial && <p>{purchaseNote}</p>}
        {internalCount > 0 && <p>{internalCount} {internalCount === 1 ? 'artículo de uso interno incluido' : 'artículos de uso interno incluidos'} solo en el costo de compra.</p>}
      </div>}
    </section>

    <div className={s.bottom}>
      <section className={s.panel}>
        <PanelHeader title="Costo de la compra" icon={<InventoryIcon name="package" />}>
          {imported ? 'Importación calculada sobre mercancía más banco.' : 'Compra local en florines.'}{costsPartial && ' Costos pendientes en las líneas ' + purchasePendingLines.join(', ') + '.'}
        </PanelHeader>
        <dl className={s.costLines}>{purchaseLines.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{hasCosts ? amount(value) : '—'}</dd></div>)}
          {purchase.rounding !== 0n && <div><dt>Ajuste por redondeo</dt><dd>{amount(purchase.rounding)}</dd></div>}
          <div className={s.total}><dt>Landed cost estimado{costsPartial && ' parcial'}</dt><dd>{money(hasCosts ? purchase.landed : null)}</dd></div>
        </dl>
      </section>
      <MarketPanel bill={bill} results={results} updateLine={updateLine} />
    </div>
  </div>;
}
