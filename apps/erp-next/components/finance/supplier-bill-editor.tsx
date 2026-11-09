'use client';

import { useRef, useState } from 'react';
import { ChargeIcon } from '../scheduling/appointment-charge-icons';
import { amount, blankBill, blankLine, changeRate, evaluateLine, MAX_LINES, openDraft, sellable } from '../../lib/supplier-bill-draft';
import type { BillDraft, BillLine, ItemUse } from '../../lib/supplier-bill-draft';
import s from './supplier-bill-editor.module.css';

const uses: Record<ItemUse, string> = { product: 'Producto para venta', material: 'Material para venta', consumable: 'Insumo de uso interno', tool: 'Herramienta' };
const priceFields = [['marketing', 'Marketing'], ['profit', 'Ganancia'], ['operations', 'Operaciones objetivo']] as const;

function Field({ label, value, edit, numeric = false }: { label: string; value: string; edit: (v: string) => void; numeric?: boolean }) {
  return <label className={s.field}>{label}<input value={value} inputMode={numeric ? 'decimal' : 'text'} maxLength={240} onChange={e => edit(e.target.value)} /></label>;
}

function LineInput({ label, value, edit, numeric = true }: { label: string; value: string; edit: (v: string) => void; numeric?: boolean }) {
  return <input aria-label={label} title={label} inputMode={numeric ? 'decimal' : 'text'} value={value} maxLength={numeric ? 16 : 240} onChange={e => edit(e.target.value)} />;
}

export function SupplierBillEditor({ close, initialBill, onSave, locked = false, blockClose = false }: { close: () => void; initialBill?: BillDraft; onSave?: (bill: BillDraft) => void; locked?: boolean; blockClose?: boolean }) {
  const [bill, setBill] = useState<BillDraft>(() => initialBill ? structuredClone(initialBill) : blankBill());
  const [selected, select] = useState(0);
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const imported = bill.currency === 'USD';
  const hasChanges = JSON.stringify(bill) !== JSON.stringify(initialBill || blankBill());
  const results = bill.lines.map(line => evaluateLine(bill, line));
  const line = bill.lines[selected];
  const result = results[selected];
  const allocation = result.quote?.allocation;
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
    if (!window.confirm('¿Quitar este artículo del borrador?')) return;
    const remaining = bill.lines.filter((_, index) => index !== selected);
    select(Math.max(0, selected - 1));
    setBill({ ...bill, lines: remaining.length ? remaining : [blankLine()] });
    setMessage('');
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bill, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DEMAC-compra-' + (bill.invoiceNumber.replace(/[^\w.-]+/g, '_') || 'borrador') + '.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setMessage('Descarga de borrador solicitada. Puedes retomarlo con «Abrir borrador».');
  }
  async function restore(f?: File) {
    if (!f) return;
    try {
      if (f.size > 2000000) throw new Error('El archivo supera 2 MB.');
      const restored = openDraft(await f.text());
      if (hasChanges && !window.confirm('¿Reemplazar el borrador que estás editando?')) return;
      select(0);
      setBill(restored);
      setMessage('Borrador abierto. Revisa los precios antes de confirmarlos de nuevo.');
    } catch {
      setMessage('No se pudo abrir el archivo. Elige un borrador de compras DEMAC válido de hasta 2 MB.');
    }
  }

  return <section className={s.page}>
    <button type="button" disabled={blockClose} className={s.back} onClick={() => { if (!hasChanges || window.confirm('¿Salir con cambios sin guardar? Conserva una copia descargada para retomarlos.')) close(); }}>‹ {onSave ? 'Facturas guardadas' : 'Centro de compras'}</button>
    <header className={s.head}><div><h1>Factura de proveedor</h1><p>{onSave ? 'Guarda el borrador para retomarlo desde el ERP.' : 'Borrador de costos y precios. Para retomarlo otro día, descarga una copia.'}</p></div>
      <div className={s.actions}>
        <button disabled={locked} onClick={() => file.current?.click()}>Abrir borrador</button><button onClick={download}><ChargeIcon name="receipt" />Descargar borrador</button>
        {onSave && <button className={s.primary} disabled={locked} onClick={() => onSave(bill)}><ChargeIcon name="check" />Guardar en ERP</button>}
        <input hidden ref={file} aria-label="Archivo de borrador" type="file" accept=".json,application/json" onChange={e => { const picked = e.target.files?.[0]; e.target.value = ''; void restore(picked); }} />
      </div>
    </header>
    {message && <p role="status" className={s.status}>{message}</p>}
    <fieldset disabled={locked} className={s.editorFields}>
    <div className={s.panel + ' ' + s.fields}>
      <Field label="Proveedor" value={bill.supplier} edit={v => editHeader('supplier', v)} />
      <Field label="Número de factura" value={bill.invoiceNumber} edit={v => editHeader('invoiceNumber', v)} />
      <label className={s.field}>Tipo de compra<select aria-label="Tipo de compra" disabled={bill.lines.some(l => l.unitCost !== '')} title="Selecciona la moneda antes de introducir costos." value={bill.currency} onChange={e => setBill({ ...bill, currency: e.target.value === 'USD' ? 'USD' : 'AWG', lines: bill.lines.map(l => ({ ...l, confirmed: false })) })}>
        <option value="USD">Importación · USD</option><option value="AWG">Local · Afl</option></select></label>
      {imported && <><Field label="Origen" value={bill.origin} edit={v => editHeader('origin', v)} />
        <div className={s.field}>Cambio fijo<strong>1 USD = 1.80 Afl</strong></div>
        <Field numeric label="Wire estimado (%)" value={bill.wire} edit={v => setBill({ ...bill, wire: v, lines: bill.lines.map(l => ({ ...l, confirmed: false })) })} />
        <Field numeric label="Importación + shipping general (%)" value={bill.generalImport} edit={v => setBill(current => changeRate(current, v))} /></>}
      <div className={s.tax}><ChargeIcon name="info" /> Reserva sobre ventas · 7%</div>
    </div>

    <section className={s.panel}><header className={s.bar}><h2><ChargeIcon name="clipboard" />Artículos de la factura</h2><button onClick={addLine} disabled={bill.lines.length >= MAX_LINES}><ChargeIcon name="plus" />Agregar artículo</button></header>
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
            <td><LineInput label={name('Costo del proveedor')} value={item.unitCost} edit={v => patch('unitCost', v)} /></td>
            {imported && <td><LineInput label={name('Importación (%)')} value={item.importOverride ?? bill.generalImport} edit={v => patch('importOverride', v)} />
              {item.importOverride !== null ? <button className={s.override} title="Volver al porcentaje general" aria-label={name('Volver al porcentaje general')} onClick={() => updateLine(index, { importOverride: null })}>Personalizado ↶</button> : <small>General</small>}</td>}
            <td>{row.cost ? amount(row.cost.landed) : '—'}</td>
            {priceFields.map(([key, label]) => <td key={key}>{sellable(item.use) ? <LineInput label={name(label)} value={item[key]} edit={v => patch(key, v)} /> : '—'}</td>)}
            <td className={s.suggested}>{row.quote ? amount(row.quote.recommended) : '—'}</td>
            <td>{sellable(item.use) ? <><LineInput label={name('Precio final')} value={item.finalPrice} edit={v => patch('finalPrice', v)} />{item.confirmed && row.quote?.allocation && <small>✓ Confirmado</small>}</> : 'Uso interno'}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <footer className={s.bar}><span>Total proveedor <b>{imported ? 'USD' : 'Afl'} {calculatedTotal('supplierTotal')}</b></span><span>Landed estimado <b>Afl {calculatedTotal('landedTotal')}</b></span></footer>
    </section>

    <div className={s.details}>
      <section className={s.panel}><header className={s.bar}><h2><ChargeIcon name="money" />Costo por unidad</h2></header>
        <div className={s.body}><b>{line.description || 'Artículo ' + (selected + 1)}</b>
          {result.cost && <dl>{([['Costo en florines', result.cost.converted], ['Wire', result.cost.wire], ['Importación + shipping', result.cost.shipping], ['Landed estimado', result.cost.landed]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>Afl {amount(value)}</dd></div>)}</dl>}
          {result.error && <p className={s.hint}>{result.error}</p>}
          <button className={s.back} onClick={removeSelected}>Quitar este artículo</button>
        </div></section>
      <section className={s.panel}><header className={s.bar}><h2><ChargeIcon name="edit" />Precio de venta por unidad</h2></header><div className={s.body}>
        {sellable(line.use) ? <><div className={s.prices}><div>Recomendado<strong>Afl {result.quote ? amount(result.quote.recommended) : '—'}</strong></div>
          <Field numeric label="Tu precio final (Afl)" value={line.finalPrice} edit={v => updateLine(selected, { finalPrice: v })} />
          <button className={s.primary} disabled={!allocation || !line.description.trim() || line.confirmed} onClick={() => updateLine(selected, { confirmed: true })}><ChargeIcon name="check" />{line.confirmed ? 'Precio confirmado' : 'Confirmar precio en borrador'}</button></div>
          {allocation && <><div className={s.funds}>{([['Reposición', allocation.restock], ['Impuesto · 7%', allocation.taxes], ['Marketing', allocation.marketing], ['Ganancia', allocation.profit], ['Operaciones', allocation.operations]] as const).map(([label, value]) => <div key={label}><small>{label}</small><b>Afl {amount(value)}</b></div>)}</div>
          {allocation.operations < 0n && <p role="alert">El precio final deja operaciones en negativo.</p>}</>}</> :
          <p>Costo de compra para {line.use === 'tool' ? 'control de herramientas' : 'despacho de insumos'}.</p>}
      </div></section>
    </div>
    </fieldset>
  </section>;
}
