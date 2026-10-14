import { chargeMoney, type ChargeLineInput, type ChargeQuote } from '../../lib/appointment-charges';
import styles from './appointment-charges.module.css';

// Catalog identity and the server-owned quote define the selected item. Editing
// quantity never rewrites its service, specifications or historical agreed price.
export function ChargeLinesEditor({ lines, onChange, quote, disabled, loading }: {
  lines: ChargeLineInput[]; onChange: (lines: ChargeLineInput[]) => void;
  quote: ChargeQuote | null; disabled: boolean; loading: boolean;
}) {
  return <fieldset disabled={disabled} className={styles.invoiceLines} aria-label="Servicios y productos seleccionados">
    {lines.map((line, index) => {
      const priced = quote?.lines.find(item => item.id === line.id);
      const pending = !loading && priced?.unitCents === null;
      return <div className={styles.invoiceLine} key={line.id}>
        <div className={styles.invoiceConcept}>
          <strong aria-label={`Concepto ${index + 1}`}>{priced?.label || line.label}</strong>
          {priced?.btu || line.btu ? <small>{Number(priced?.btu || line.btu).toLocaleString('en-US')} BTU</small> : null}
          {priced?.manualPrice ? <small>Precio acordado conservado</small> : null}
        </div>
        <label className={styles.invoiceDescription}>Descripción<textarea aria-label={`Descripción ${index + 1}`} rows={2} maxLength={1000} value={line.description || ''}
          placeholder="Descripción del servicio o producto" onChange={event => onChange(lines.map(item => item.id === line.id ? { ...item, description: event.target.value } : item))}/></label>
        <label>Cantidad<input aria-label={`Cantidad ${index + 1}`} inputMode="decimal" value={line.quantity}
          onChange={event => onChange(lines.map(item => item.id === line.id ? { ...item, quantity: event.target.value } : item))}/></label>
        <div className={styles.invoiceMoney}><span>Precio unitario</span><strong aria-label={`Precio unitario ${index + 1}`}>{loading ? 'Consultando…' : chargeMoney(priced?.unitCents)}</strong></div>
        <div className={styles.invoiceMoney}><span>Importe</span><strong aria-label={`Importe ${index + 1}`}>{loading ? 'Consultando…' : chargeMoney(priced?.totalCents)}</strong></div>
        <button type="button" className={styles.removeLine} aria-label={`Eliminar concepto ${index + 1}`} onClick={() => onChange(lines.filter(item => item.id !== line.id))}>Eliminar</button>
        {pending ? <p className={styles.invoicePending}>{line.serviceId
          ? 'No hay una tarifa final disponible. Elige el artículo específico del catálogo o revisa su tarifa antes de confirmar.'
          : 'Selecciona el servicio específico del catálogo: elimina este concepto pendiente y añade el artículo realizado.'}</p> : null}
      </div>;
    })}
  </fieldset>;
}
