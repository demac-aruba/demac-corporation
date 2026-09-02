'use client';

import type { FieldExecutionJobDetail, FieldProfessionalReportStatus } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

function statusLabel(status: FieldProfessionalReportStatus) {
  if (status === 'field_complete') return 'Campo completo';
  if (status === 'partial') return 'Trabajo parcial';
  if (status === 'incomplete_report') return 'Falta evidencia requerida';
  return 'En preparación';
}

function interventionStatusLabel(status: FieldExecutionJobDetail['workInterventions'][number]['status']) {
  if (status === 'completed') return 'Completada';
  if (status === 'pending_part') return 'Pendiente por pieza';
  if (status === 'not_performed') return 'No realizada';
  if (status === 'declined') return 'Rechazada';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'in_progress') return 'En proceso';
  if (status === 'pending_authorization') return 'Pendiente de autorización';
  if (status === 'confirmed') return 'Confirmada';
  return 'Planificada';
}

export function ProfessionalReportPreview({ job }: { job: FieldExecutionJobDetail }) {
  const preview = job.professionalReportPreview;
  if (!preview) return null;
  const assetByVisitAssetId = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((asset) => [asset.id, asset]));
  const reportByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>REPORTE PROFESIONAL · VISTA PREVIA</div>
      <p className={styles.helper}>
        Proyección de solo lectura construida desde la evidencia canónica de campo. Todavía no es la versión aprobada por Office Review.
      </p>

      <div className={styles.infoGrid}>
        <div className={styles.info}><span>Estado</span><strong>{statusLabel(preview.status)}</strong></div>
        <div className={styles.info}><span>Programado</span><strong>{preview.plannedQuantity}</strong></div>
        <div className={styles.info}><span>A/C confirmados</span><strong>{preview.actualAssetCount}</strong></div>
        <div className={styles.info}><span>Intervenciones</span><strong>{preview.interventionCount}</strong></div>
        <div className={styles.info}><span>Completadas</span><strong>{preview.completedInterventionCount}</strong></div>
        <div className={styles.info}><span>Secciones requeridas</span><strong>{preview.completedRequiredSectionCount}/{preview.requiredSectionCount}</strong></div>
      </div>

      {preview.incompleteRequiredSections.length > 0 ? (
        <div className={styles.interventionForm}>
          <strong>Falta antes de cerrar el reporte</strong>
          {preview.incompleteRequiredSections.map((section) => (
            <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }} key={`${section.interventionId}:${section.sectionId}`}>
              {section.title} · {section.status}
            </div>
          ))}
        </div>
      ) : null}

      {job.workInterventions.map((intervention) => {
        const visitAsset = assetByVisitAssetId.get(intervention.visitAssetId);
        const equipment = visitAsset ? equipmentById.get(visitAsset.assetId) : undefined;
        const report = reportByInterventionId.get(intervention.id);
        const findings = report?.findings ?? [];
        const measurements = report?.measurements ?? [];
        const photos = report?.evidence ?? [];
        const voiceNotes = report?.voiceNotes ?? [];
        const freeText = report?.freeTextResponses?.filter((entry) => entry.value.trim()) ?? [];
        const acknowledgements = report?.customerAcknowledgements ?? [];
        return (
          <div className={styles.interventionForm} key={intervention.id}>
            <strong>{intervention.interventionType || intervention.serviceCatalogItemId}</strong>
            <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
              {visitAsset?.locationLabel || equipment?.locationLabel || intervention.assetId} · {interventionStatusLabel(intervention.status)}
            </div>
            {intervention.resultNotes ? <div className={styles.info} style={{ gridColumn: '1 / -1' }}><span>Resultado / nota</span><strong>{intervention.resultNotes}</strong></div> : null}
            {report ? (
              <div className={styles.infoGrid} style={{ gridColumn: '1 / -1' }}>
                <div className={styles.info}><span>Requeridas</span><strong>{report.completion.completedRequiredSectionCount}/{report.completion.requiredSectionCount}</strong></div>
                <div className={styles.info}><span>Fotos</span><strong>{photos.length}</strong></div>
                <div className={styles.info}><span>Mediciones</span><strong>{measurements.length}</strong></div>
                <div className={styles.info}><span>Hallazgos</span><strong>{findings.length}</strong></div>
                <div className={styles.info}><span>Notas de voz</span><strong>{voiceNotes.length}</strong></div>
                <div className={styles.info}><span>Confirmaciones cliente</span><strong>{acknowledgements.length}</strong></div>
              </div>
            ) : null}
            {measurements.map((measurement) => (
              <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }} key={measurement.id}>
                Medición: {measurement.metric} = {String(measurement.value)} {measurement.unit} ({measurement.moment})
              </div>
            ))}
            {findings.map((finding) => (
              <div className={styles.info} style={{ gridColumn: '1 / -1' }} key={finding.id}>
                <span>Hallazgo · {finding.summary}</span><strong>{finding.details}</strong>
                {finding.recommendation ? <span>Recomendación: {finding.recommendation}</span> : null}
              </div>
            ))}
            {freeText.map((entry) => (
              <div className={styles.info} style={{ gridColumn: '1 / -1' }} key={entry.id}>
                <span>Nota técnica</span><strong>{entry.value}</strong>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
