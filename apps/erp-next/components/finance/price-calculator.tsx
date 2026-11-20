'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChargeIcon } from '../scheduling/appointment-charge-icons';
import { amount, blankBill, blankLine, changeRate, evaluateLine, MAX_LINES, openDraft, sellable } from '../../lib/supplier-bill-draft';
import type { BillDraft, BillLine, ItemUse } from '../../lib/supplier-bill-draft';
import { totalSupplierCostInput } from '../../lib/supplier-cost-input';
import s from './price-calculator.module.css';

const uses: Record<ItemUse, string> = { product: 'Producto para venta', material: 'Material para venta', consumable: 'Insumo de uso interno', tool: 'Herramienta' };
const priceFields = [['marketing', 'Marketing'], ['profit', 'Ganancia'], ['operations', 'Operaciones objetivo']] as const;

function Field({ label, value, edit, numeric = false }: { label: string; value: string; edit: (v: string) => void; numeric?: boolean }) {
  return <label className={s.field}>{label}<input value={value} inputMode={numeric ? 'decimal' : 'text'} maxLength={240} onChange={e => edit(e.target.value)} /></label>;
}

function LineInput({ label, value, edit, numeric = true }: { label: string; value: string; edit: (v: string) => void; numeric?: boolean }) {
  return <input aria-label={label} title={label} inputMode={numeric ? 'decimal' : 'text'} value={value} maxLength={numeric ? 16 : 240} onChange={e => edit(e.target.value)} />;
}

function SupplierCostInput({ label, value, edit }: { label: string; value: string; edit: (v: string) => void }) {
  const errorId = useId();
  const [failure, setFailure] = useState<{ value: string; message: string } | null>(null);
  const error = failure?.value === value ? failure.message : '';
  return <>
    <input aria-label={label} title="Puedes sumar importes con +. El total se aplica al salir."
      inputMode="text" value={value} maxLength={240} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
      onChange={e => { setFailure(null); edit(e.target.value); }}
      onBlur={e => {
        const raw = e.target.value;
        try {
          const total = totalSupplierCostInput(raw);
          setFailure(null);
          if (total !== raw) edit(total);
        } catch (cause) {
          setFailure({ value: raw, message: cause instanceof Error ? cause.message : 'Revisa la suma de importes.' });
        }
      }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
    {error && <small id={errorId} role="alert" className={s.inputError}>{error}</small>}
  </>;
}

export function PriceCalculator() {
  const [bill, setBill] = useState<BillDraft>(blankBill);
  const [selected, select] = useState(0);
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const imported = bill.currency === 'USD';
  const hasChanges = JSON.stringify(bill) !== JSON.stringify(blankBill());
  const results = bill.lines.map(line => evaluateLine(bill, line));
  const line = bill.lines[selected];
  const result = results[selected];
  const suggestedPrice = result.quote ? amount(result.quote.recommended).replace(/,/g, '') : '';
  const allocation = line.finalPrice.trim() ? result.quote?.allocation : suggestedPrice ? evaluateLine(bill, { ...line, finalPrice: suggestedPrice }).quote?.allocation : null;
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);
  const allCosted = results.every(r => r.cost !== null);
  const calculatedTotal = (key: 'supplierTotal' | 'landedTotal') => allCosted
    ? amount(results.reduce((sum, row) => sum + row.cost![key], 0n)) : '—';

  function updateLine(index: number, patch: Partial<BillLine>) {
    setBill(current => ({ ...current, lines: current.lines.map((entry, n) => n === index ? { ...entry, confirmed: false, ...patch } : entry) }));
    setMessage('');
  }
  function editHeader(key: 'supplier' | 'invoiceNumber' | 'origin', value: string) {
    setBill(current => ({ ...current, [key]: value }));
    setMessage('');
  }
  function addLine() {
    if (bill.lines.length >= MAX_LINES) return;
    select(bill.lines.length);
    setBill(current => ({ ...current, lines: [...current.lines, blankLine()] }));
    setMessage('');
  }
  function removeSelected() {
    if (!window.confirm('¿Quitar este artículo del cálculo?')) return;
    const remaining = bill.lines.filter((_, index) => index !== selected);
    select(Math.max(0, selected - 1));
    setBill({ ...bill, lines: remaining.length ? remaining : [blankLine()] });
    setMessage('');
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bill, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DEMAC-calculo-' + (bill.invoiceNumber.replace(/[^\w.-]+/g, '_') || 'precios') + '.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setMessage('Descarga solicitada. Guarda el archivo para retomarlo con «Abrir cálculo».');
  }
  async function restore(f?: File) {
    if (!f) return;
    try {
      if (f.size > 2000000) throw new Error('El archivo supera 2 MB.');
      const restored = openDraft(await f.text());
      if (hasChanges && !window.confirm('¿Reemplazar el cálculo que estás editando? Descarga primero una copia si deseas conservarlo.')) return;
      select(0);
      setBill(restored);
      setMessage('Cálculo abierto. Los porcentajes y precios se han recuperado.');
    } catch {
      setMessage('No se pudo abrir el archivo. Elige un cálculo DEMAC válido de hasta 2 MB.');
    }
  }

  function reset(next: BillDraft) {
    if (hasChanges && !window.confirm('¿Reemplazar el cálculo actual? Descarga una copia para conservarlo.')) return;
    setBill(next); select(0); setMessage('');
  }
  function example() {
    reset({ ...blankBill(), supplier: 'Proveedor de ejemplo', invoiceNumber: 'Ejemplo de cálculo', generalImport: '50', lines: [
      { ...blankLine(), description: 'Mini split · ejemplo', quantity: '4', unitCost: '250', marketing: '5', profit: '15', operations: '22' },
      { ...blankLine(), description: 'Bracket · ejemplo', unitCost: '20', importOverride: '30', marketing: '4', profit: '18', operations: '20' },
    ] });
  }
  return <section className={s.page}>
    <header className={s.head}><div><span className={s.eyebrow}><ChargeIcon name="money" /> COMPRAS · HERRAMIENTAS</span><h1>Cálculo de precios</h1><p>Del costo del proveedor al precio de venta. Cada artículo tiene sus propios porcentajes.</p></div>
      <div className={s.actions}>
        <button onClick={example}>Cargar ejemplo</button>
        <button onClick={() => file.current?.click()}>Abrir cálculo</button>
        <button className={s.primary} onClick={download}><ChargeIcon name="receipt" />Descargar cálculo</button>
        <button onClick={() => reset(blankBill())}>Nuevo cálculo</button>
        <input hidden ref={file} aria-label="Archivo de cálculo" type="file" accept=".json,application/json" onChange={e => { const picked = e.target.files?.[0]; e.target.value = ''; void restore(picked); }} />
      </div>
    </header>
    <p className={s.notice}><ChargeIcon name="info" /> Calculadora de planificación. Descarga una copia antes de salir. No registra compras ni cambia inventario o QuickBooks.</p>
    {message && <p role="status" className={s.status}>{message}</p>}
    <div className={s.editorFields}>
    <div className={s.panel + ' ' + s.fields}>
      <Field label="Proveedor (opcional)" value={bill.supplier} edit={v => editHeader('supplier', v)} />
      <Field label="Nombre del cálculo (opcional)" value={bill.invoiceNumber} edit={v => editHeader('invoiceNumber', v)} />
      <label className={s.field}>Tipo de compra<select aria-label="Tipo de compra" disabled={bill.lines.some(l => l.unitCost !== '')} title="Selecciona la moneda antes de introducir costos." value={bill.currency} onChange={e => setBill({ ...bill, currency: e.target.value === 'USD' ? 'USD' : 'AWG', lines: bill.lines.map(l => ({ ...l, confirmed: false })) })}>
        <option value="USD">Importación · USD</option><option value="AWG">Local · Afl</option></select></label>
      {imported && <><Field label="Origen" value={bill.origin} edit={v => editHeader('origin', v)} />
        <div className={s.field}>Cambio fijo<strong>1 USD = 1.80 Afl</strong></div>
        <Field numeric label="Banco / wire (%)" value={bill.wire} edit={v => setBill({ ...bill, wire: v, lines: bill.lines.map(l => ({ ...l, confirmed: false })) })} />
        <Field numeric label="Importación + shipping general (%)" value={bill.generalImport} edit={v => setBill(current => changeRate(current, v))} /></>}
      <div className={s.tax}><ChargeIcon name="info" /> Impuesto sobre venta · 7% fijo</div>
    </div>

    <section className={s.panel}><header className={s.bar}><div><h2><ChargeIcon name="clipboard" />Artículos a calcular</h2><p className={s.inputHelp}>En Proveedor puedes sumar importes con +. El total se aplica al salir de la casilla.</p></div><button onClick={addLine} disabled={bill.lines.length >= MAX_LINES}><ChargeIcon name="plus" />Agregar artículo</button></header>
      <div className={s.scroll}><table className={s.table}><thead><tr><th>Artículo</th><th>Cant.</th><th>Proveedor<br/>{imported ? 'USD' : 'Afl'}/u</th>
        {imported && <th>Importación + shipping</th>}<th>Landed<br/>Afl/u</th><th>Marketing %</th><th>Ganancia %</th><th>Oper. objetivo %</th><th>Recomendado<br/>Afl</th><th>Precio final<br/>Afl</th></tr></thead>
        <tbody>{bill.lines.map((item, index) => {
          const row = results[index];
          const name = (label: string) => label + ' · línea ' + (index + 1);
          const patch = (key: keyof BillLine, value: string) => updateLine(index, { [key]: value });
          return <tr key={index} data-selected={index === selected} onFocus={() => select(index)} onClick={() => select(index)}>
            <td className={s.description}><LineInput numeric={false} label={name('Artículo')} value={item.description} edit={v => patch('description', v)} />
              <select aria-label={name('Tipo de artículo')} value={item.use} onChange={e => patch('use', e.target.value)}>{Object.entries(uses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
            <td><LineInput label={name('Cantidad')} value={item.quantity} edit={v => patch('quantity', v)} /></td>
            <td><SupplierCostInput label={name('Costo del proveedor')} value={item.unitCost} edit={v => patch('unitCost', v)} /></td>
            {imported && <td><LineInput label={name('Importación (%)')} value={item.importOverride ?? bill.generalImport} edit={v => patch('importOverride', v)} />
              {item.importOverride !== null ? <button className={s.override} title="Volver al porcentaje general" aria-label={name('Volver al porcentaje general')} onClick={() => updateLine(index, { importOverride: null })}>Personalizado ↶</button> : <small>General</small>}</td>}
            <td>{row.cost ? amount(row.cost.landed) : '—'}</td>
            {priceFields.map(([key, label]) => <td key={key}>{sellable(item.use) ? <LineInput label={name(label)} value={item[key]} edit={v => patch(key, v)} /> : '—'}</td>)}
            <td className={s.suggested}>{row.quote ? amount(row.quote.recommended) : '—'}</td>
            <td>{sellable(item.use) ? <><LineInput label={name('Precio final')} value={item.finalPrice} edit={v => patch('finalPrice', v)} /></> : 'Uso interno'}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <footer className={s.bar}><span>Total proveedor <b>{imported ? 'USD' : 'Afl'} {calculatedTotal('supplierTotal')}</b></span><span>Landed estimado <b>Afl {calculatedTotal('landedTotal')}</b></span></footer>
    </section>

    <div className={s.details}>
      <section className={s.panel}><header className={s.bar}><h2><ChargeIcon name="money" />Costo por unidad</h2></header>
        <div className={s.body}><b>{line.description || 'Artículo ' + (selected + 1)}</b>
          {result.cost && <dl>{([['Costo en florines', result.cost.converted], ['Banco / wire', result.cost.wire], ['Importación + shipping', result.cost.shipping], ['Landed estimado', result.cost.landed]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>Afl {amount(value)}</dd></div>)}</dl>}
          {result.error && <p role="status" className={s.hint}>{result.error}</p>}
          <button className={s.back} onClick={removeSelected}>Quitar este artículo</button>
        </div></section>
      <section className={s.panel}><header className={s.bar}><h2><ChargeIcon name="edit" />Precio de venta por unidad</h2></header><div className={s.body}>
        {sellable(line.use) ? <><div className={s.prices}><div>Recomendado<strong>Afl {result.quote ? amount(result.quote.recommended) : '—'}</strong></div>
          <Field numeric label="Tu precio final (Afl)" value={line.finalPrice} edit={v => updateLine(selected, { finalPrice: v })} />
          <button className={s.primary} disabled={!result.quote} onClick={() => updateLine(selected, { finalPrice: suggestedPrice })}><ChargeIcon name="check" />Usar precio sugerido</button></div>
          {allocation && <><p className={s.allocationLabel}>Distribución del {line.finalPrice.trim() ? 'precio final' : 'precio sugerido'} · por unidad</p><div className={s.funds}>{([['Reposición', allocation.restock], ['Impuesto · 7%', allocation.taxes], ['Marketing · ' + line.marketing + '%', allocation.marketing], ['Ganancia · ' + line.profit + '%', allocation.profit], ['Operaciones', allocation.operations]] as const).map(([label, value]) => <div key={label}><small>{label}</small><b>Afl {amount(value)}</b></div>)}</div>
          {allocation.operations < 0n && <p role="alert">Este precio no cubre reposición, impuesto, marketing y ganancia: operaciones queda en negativo.</p>}</>}</> :
          <p>Costo de compra para {line.use === 'tool' ? 'control de herramientas' : 'despacho de insumos'}.</p>}
      </div></section>
    </div>
    <details className={s.formula}><summary>Cómo se calcula el precio sugerido</summary><p>Proveedor en USD × 1.80 = costo en florines. Banco = costo en florines × % banco. Importación + shipping = (costo en florines + banco) × % de importación del artículo.</p><p>Precio sugerido = landed cost ÷ (1 − 7% − marketing% − ganancia% − operaciones objetivo%). Los porcentajes de distribución se calculan sobre el precio de venta. La ganancia es una reserva prevista; no equivale a la utilidad neta contable.</p><p>Importación se escribe manualmente; el origen no asigna porcentajes. Los cargos se redondean por unidad a dos decimales antes de multiplicar por la cantidad. Escribe decimales con punto o coma, sin separadores de miles.</p></details>
    </div>
  </section>;
}

