import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

const FIELD_HISTORY_DATE_FORMAT = new Intl.DateTimeFormat('es-AW', { dateStyle: 'medium', timeStyle: 'short' });

function dateLabel(value: string) {
  return FIELD_HISTORY_DATE_FORMAT.format(new Date(value));
}

export function FieldHistoryPanel({ job }: { job: FieldExecutionJobDetail }) {
  const history = job.customerFieldHistory;
  const interventions = new Map(history.interventions.map((entry) => [entry.id, entry]));
  const findings = new Map(history.findings.map((entry) => [entry.id, entry]));
  const saleLines = new Map(history.saleLines.map((entry) => [entry.id, entry]));

  return (
    <section className={styles.section}>
      <h2>HISTORIAL CANÓNICO</h2>
      <p className={styles.helper}>Proyección de solo lectura desde visitas, intervenciones, hallazgos y ventas Field. No es una base histórica separada.</p>
      <div className={styles.planned} style={{ marginTop: 12 }}>
        <div className={styles.plannedTitle}>CLIENTE</div>
        <strong>{history.visits.length} visita(s) · {history.interventions.length} intervención(es) · {history.saleLines.length} venta(s) · {history.findings.length} hallazgo(s)</strong>
        {history.interventions.slice(0, 8).map((entry) => (
          <p key={entry.id}>{dateLabel(entry.completedAt || entry.updatedAt)} · {entry.interventionType || entry.serviceCatalogItemId} · {entry.status} · equipo {entry.assetId}</p>
        ))}
        {history.interventions.length === 0 ? <p>Este cliente todavía no tiene intervenciones Field canónicas.</p> : null}
      </div>
      {job.equipmentFieldHistories.map((equipment) => {
        const equipmentInterventions = equipment.interventionIds.map((id) => interventions.get(id)).filter((entry) => entry !== undefined);
        const equipmentFindings = equipment.findingIds.map((id) => findings.get(id)).filter((entry) => entry !== undefined);
        const equipmentSales = equipment.saleLineIds.map((id) => saleLines.get(id)).filter((entry) => entry !== undefined);
        return (
          <details key={equipment.assetId} style={{ marginTop: 12 }}>
            <summary className={styles.helper}>{equipment.locationLabel || equipment.assetId} · {equipmentInterventions.length} intervención(es), {equipmentFindings.length} hallazgo(s), {equipmentSales.length} venta(s)</summary>
            <div className={styles.planned} style={{ marginTop: 8 }}>
              <div className={styles.plannedTitle}>EQUIPO {equipment.assetId}</div>
              {equipmentInterventions.map((entry) => <p key={entry.id}>{dateLabel(entry.completedAt || entry.updatedAt)} · {entry.interventionType || entry.serviceCatalogItemId} · {entry.status}</p>)}
              {equipmentFindings.map((entry) => <p key={entry.id}>Hallazgo: {entry.summary}{entry.recommendation ? ` · ${entry.recommendation}` : ''}</p>)}
              {equipmentSales.map((entry) => <p key={entry.id}>Venta: {entry.descriptionSnapshot} · {entry.quantity} {entry.unit} · {entry.status}</p>)}
              {equipmentInterventions.length + equipmentFindings.length + equipmentSales.length === 0 ? <p>Sin actividad Field canónica registrada para este equipo.</p> : null}
            </div>
          </details>
        );
      })}
    </section>
  );
}
