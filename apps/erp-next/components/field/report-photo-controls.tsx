'use client';

import { useMemo, useState } from 'react';
import type {
  FieldExecutionJobDetail,
  FieldInterventionReport,
  FieldReportSection,
  FieldReportSectionStatus,
} from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

export type ReportPhotoInput = {
  interventionId: string;
  sectionId: string;
  file: File;
  caption: string;
};

function statusLabel(status: FieldReportSectionStatus) {
  if (status === 'completed') return 'Completa';
  if (status === 'in_progress') return 'En progreso';
  return 'Pendiente';
}

function sectionTypeLabel(section: FieldReportSection) {
  if (section.type === 'photos') return 'Fotos';
  if (section.type === 'checklist') return 'Checklist';
  if (section.type === 'measurement_table') return 'Mediciones';
  if (section.type === 'findings') return 'Hallazgos';
  if (section.type === 'free_text') return 'Notas';
  return 'Confirmación del cliente';
}

function evidenceCount(report: FieldInterventionReport, sectionId: string) {
  return report.evidence.filter((item) => item.sectionId === sectionId).length;
}

function PhotoSectionInput({
  report,
  section,
  allowed,
  mutationBusy,
  uploading,
  onAddPhoto,
}: {
  report: FieldInterventionReport;
  section: FieldReportSection;
  allowed: boolean;
  mutationBusy: boolean;
  uploading: boolean;
  onAddPhoto: (input: ReportPhotoInput) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const count = evidenceCount(report, section.id);
  const minimum = section.minEvidenceCount ?? 0;

  const submit = async () => {
    if (!file) {
      setLocalError('Selecciona o toma una foto antes de guardar la evidencia.');
      return;
    }
    setLocalError(null);
    const success = await onAddPhoto({
      interventionId: report.interventionId,
      sectionId: section.id,
      file,
      caption: caption.trim(),
    });
    if (success) {
      setFile(null);
      setCaption('');
    }
  };

  return (
    <div className={styles.interventionForm}>
      <strong>{section.title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {section.required ? 'Requerida' : 'Opcional'} · {count} foto{count === 1 ? '' : 's'} registrada{count === 1 ? '' : 's'}
        {minimum > 0 ? ` · mínimo configurado: ${minimum}` : ''}
      </div>
      {allowed ? (
        <>
          <label>
            <span>Foto</span>
            <input
              className={styles.select}
              disabled={mutationBusy}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <small className={styles.helper}>{file?.name || 'La imagen se guarda como evidencia del reporte de esta intervención.'}</small>
          </label>
          <label>
            <span>Descripción (opcional)</span>
            <input
              className={styles.select}
              disabled={mutationBusy}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Ej. Estado antes del servicio"
            />
          </label>
          <button
            className={`${styles.action} ${styles.primary}`}
            disabled={mutationBusy}
            type="button"
            onClick={() => void submit()}
          >
            {uploading ? 'Guardando foto…' : 'Agregar foto'}
          </button>
        </>
      ) : (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no proyecta otra captura de foto para esta sección en el estado actual.
        </p>
      )}
      {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
    </div>
  );
}

export function ReportPhotoControls({
  job,
  mutationBusy,
  uploadingKey,
  error,
  onAddPhoto,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  uploadingKey: string | null;
  error: string | null;
  onAddPhoto: (input: ReportPhotoInput) => Promise<boolean>;
}) {
  const optionsByIntervention = useMemo(() => new Map(
    job.reportPhotoOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportPhotoOptions]);

  if (job.interventionReports.length === 0) {
    return (
      <div className={styles.interventionGroup}>
        <div className={styles.plannedTitle}>REPORTE TÉCNICO DE LA INTERVENCIÓN</div>
        <p className={styles.helper}>El formulario del reporte aparece cuando una intervención con template configurado entra en ejecución.</p>
      </div>
    );
  }

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>REPORTE TÉCNICO DE LA INTERVENCIÓN</div>
      <p className={styles.helper}>El template y sus secciones vienen de Field Authority y quedan congelados al iniciar el trabajo.</p>
      {job.interventionReports.map((report) => {
        const intervention = job.workInterventions.find((item) => item.id === report.interventionId);
        const allowedSections = optionsByIntervention.get(report.interventionId) ?? new Set<string>();
        return (
          <div className={styles.interventionGroup} key={report.interventionId}>
            <div className={styles.interventionCard}>
              <div>
                <strong>{intervention?.interventionType || report.template.name}</strong>
                <span>{report.template.name} · versión {report.template.version}</span>
              </div>
              <span className={`${styles.badge} ${styles.badgeBrand}`}>{report.template.sections.length} sección{report.template.sections.length === 1 ? '' : 'es'}</span>
            </div>
            {report.template.sections.map((section) => {
              const status = report.sectionStatus[section.id];
              const count = evidenceCount(report, section.id);
              if (section.type === 'photos') {
                const key = `${report.interventionId}:${section.id}`;
                return (
                  <PhotoSectionInput
                    key={section.id}
                    report={report}
                    section={section}
                    allowed={allowedSections.has(section.id)}
                    mutationBusy={mutationBusy}
                    uploading={uploadingKey === key}
                    onAddPhoto={onAddPhoto}
                  />
                );
              }
              return (
                <div className={styles.interventionCard} key={section.id}>
                  <div>
                    <strong>{section.title}</strong>
                    <span>{sectionTypeLabel(section)} · {section.required ? 'requerida' : 'opcional'}</span>
                  </div>
                  <div className={styles.badges}>
                    {count > 0 ? <span className={styles.badge}>{count} evidencia{count === 1 ? '' : 's'}</span> : null}
                    <span className={status === 'completed' ? `${styles.badge} ${styles.badgeBrand}` : styles.badge}>{statusLabel(status)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}