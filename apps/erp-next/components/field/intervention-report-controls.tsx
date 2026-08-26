'use client';

import { useMemo, useState } from 'react';
import type {
  FieldChecklistInterventionReport,
  FieldChecklistReportSection,
  FieldExecutionJobDetail,
  FieldMeasurementMoment,
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

export type ReportMeasurementInput = {
  interventionId: string;
  sectionId: string;
  metric: string;
  value: number | string;
  unit: string;
  moment: FieldMeasurementMoment;
};

export type ReportFindingInput = {
  interventionId: string;
  sectionId: string;
  summary: string;
  details: string;
  recommendation: string;
};

export type ReportChecklistInput = {
  interventionId: string;
  sectionId: string;
  itemId: string;
  checked: boolean;
  expectedVersion: number;
};

const MEASUREMENT_MOMENTS: Array<{ value: FieldMeasurementMoment; label: string }> = [
  { value: 'before', label: 'Antes' },
  { value: 'during', label: 'Durante' },
  { value: 'after', label: 'Después' },
  { value: 'diagnostic', label: 'Diagnóstico' },
  { value: 'general', label: 'General' },
];

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

function evidenceCount(report: FieldChecklistInterventionReport, sectionId: string) {
  return report.evidence.filter((item) => item.sectionId === sectionId).length;
}

function measurementCount(report: FieldChecklistInterventionReport, sectionId: string) {
  return report.measurements.filter((item) => item.sectionId === sectionId).length;
}

function findingCount(report: FieldChecklistInterventionReport, sectionId: string) {
  return report.findings.filter((item) => item.sectionId === sectionId).length;
}

function PhotoSectionInput({
  report,
  section,
  allowed,
  mutationBusy,
  uploading,
  onAddPhoto,
}: {
  report: FieldChecklistInterventionReport;
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

function parseMeasurementValue(value: string): number | string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Registra un valor para la medición.');
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    const number = Number(normalized);
    if (Number.isFinite(number)) return number;
  }
  return normalized;
}

function MeasurementSectionInput({
  report,
  section,
  allowed,
  mutationBusy,
  saving,
  onAddMeasurement,
}: {
  report: FieldChecklistInterventionReport;
  section: FieldReportSection;
  allowed: boolean;
  mutationBusy: boolean;
  saving: boolean;
  onAddMeasurement: (input: ReportMeasurementInput) => Promise<boolean>;
}) {
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [moment, setMoment] = useState<FieldMeasurementMoment>('general');
  const [localError, setLocalError] = useState<string | null>(null);
  const measurements = report.measurements.filter((item) => item.sectionId === section.id);
  const minimum = section.minMeasurementCount ?? 0;

  const submit = async () => {
    const normalizedMetric = metric.trim();
    const normalizedUnit = unit.trim();
    if (!normalizedMetric) return setLocalError('Escribe qué estás midiendo, por ejemplo temperatura de suministro o presión.');
    if (!normalizedUnit) return setLocalError('Registra la unidad de la medición, por ejemplo °C, psi, A o V.');
    let normalizedValue: number | string;
    try {
      normalizedValue = parseMeasurementValue(value);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Registra un valor válido.');
      return;
    }
    setLocalError(null);
    const success = await onAddMeasurement({
      interventionId: report.interventionId,
      sectionId: section.id,
      metric: normalizedMetric,
      value: normalizedValue,
      unit: normalizedUnit,
      moment,
    });
    if (success) {
      setMetric('');
      setValue('');
      setUnit('');
      setMoment('general');
    }
  };

  return (
    <div className={styles.interventionForm}>
      <strong>{section.title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {section.required ? 'Requerida' : 'Opcional'} · {measurements.length} medición{measurements.length === 1 ? '' : 'es'} registrada{measurements.length === 1 ? '' : 's'}
        {minimum > 0 ? ` · mínimo configurado: ${minimum}` : ''}
      </div>
      {measurements.length ? (
        <div className={styles.infoGrid} style={{ gridColumn: '1 / -1' }}>
          {measurements.map((measurement) => (
            <div className={styles.info} key={measurement.id}>
              <span>{measurement.metric} · {MEASUREMENT_MOMENTS.find((item) => item.value === measurement.moment)?.label || measurement.moment}</span>
              <strong>{String(measurement.value)} {measurement.unit}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {allowed ? (
        <>
          <label>
            <span>Medición</span>
            <input className={styles.select} disabled={mutationBusy} value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="Ej. Temperatura de suministro" />
          </label>
          <label>
            <span>Valor</span>
            <input className={styles.select} disabled={mutationBusy} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ej. 18.5 u OL" />
          </label>
          <label>
            <span>Unidad</span>
            <input className={styles.select} disabled={mutationBusy} value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Ej. °C, psi, A, V" />
          </label>
          <label>
            <span>Momento</span>
            <select className={styles.select} disabled={mutationBusy} value={moment} onChange={(event) => setMoment(event.target.value as FieldMeasurementMoment)}>
              {MEASUREMENT_MOMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy} type="button" onClick={() => void submit()}>
            {saving ? 'Guardando medición…' : 'Agregar medición'}
          </button>
        </>
      ) : (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no proyecta otra medición para esta sección en el estado actual.
        </p>
      )}
      {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
    </div>
  );
}

function FindingSectionInput({
  report,
  section,
  allowed,
  mutationBusy,
  saving,
  onAddFinding,
}: {
  report: FieldChecklistInterventionReport;
  section: FieldReportSection;
  allowed: boolean;
  mutationBusy: boolean;
  saving: boolean;
  onAddFinding: (input: ReportFindingInput) => Promise<boolean>;
}) {
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const findings = report.findings.filter((item) => item.sectionId === section.id);

  const submit = async () => {
    const normalizedSummary = summary.trim();
    const normalizedDetails = details.trim();
    const normalizedRecommendation = recommendation.trim();
    if (normalizedSummary.length < 3) {
      setLocalError('Escribe un resumen corto del hallazgo.');
      return;
    }
    if (normalizedDetails.length < 3) {
      setLocalError('Describe el hallazgo técnico observado.');
      return;
    }
    setLocalError(null);
    const success = await onAddFinding({
      interventionId: report.interventionId,
      sectionId: section.id,
      summary: normalizedSummary,
      details: normalizedDetails,
      recommendation: normalizedRecommendation,
    });
    if (success) {
      setSummary('');
      setDetails('');
      setRecommendation('');
    }
  };

  return (
    <div className={styles.interventionForm}>
      <strong>{section.title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {section.required ? 'Requerida' : 'Opcional'} · {findings.length} hallazgo{findings.length === 1 ? '' : 's'} registrado{findings.length === 1 ? '' : 's'}
      </div>
      {findings.length ? (
        <div className={styles.infoGrid} style={{ gridColumn: '1 / -1' }}>
          {findings.map((finding) => (
            <div className={styles.info} key={finding.id}>
              <span>{finding.summary}</span>
              <strong>{finding.details}</strong>
              {finding.recommendation ? <small className={styles.helper}>Recomendación: {finding.recommendation}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      {allowed ? (
        <>
          <label>
            <span>Resumen del hallazgo</span>
            <input className={styles.select} disabled={mutationBusy} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ej. Drenaje parcialmente obstruido" />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Detalle técnico</span>
            <textarea className={styles.select} disabled={mutationBusy} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Describe exactamente lo observado en el equipo." rows={3} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Recomendación (opcional)</span>
            <textarea className={styles.select} disabled={mutationBusy} value={recommendation} onChange={(event) => setRecommendation(event.target.value)} placeholder="Ej. Recomendar limpieza profunda del drenaje." rows={2} />
          </label>
          <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy} type="button" onClick={() => void submit()}>
            {saving ? 'Guardando hallazgo…' : 'Agregar hallazgo'}
          </button>
        </>
      ) : (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no proyecta otro hallazgo para esta sección en el estado actual.
        </p>
      )}
      {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
    </div>
  );
}

function ChecklistSectionInput({
  report,
  section,
  allowed,
  mutationBusy,
  savingChecklistKey,
  onSetChecklistItem,
}: {
  report: FieldChecklistInterventionReport;
  section: FieldChecklistReportSection;
  allowed: boolean;
  mutationBusy: boolean;
  savingChecklistKey: string | null;
  onSetChecklistItem: (input: ReportChecklistInput) => Promise<boolean>;
}) {
  const items = section.checklistItems ?? [];
  const responsesByItemId = new Map(
    report.checklistResponses
      .filter((response) => response.sectionId === section.id)
      .map((response) => [response.itemId, response]),
  );
  const checkedCount = items.filter((item) => responsesByItemId.get(item.id)?.checked === true).length;

  return (
    <div className={styles.interventionForm}>
      <strong>{section.title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {section.required ? 'Requerida' : 'Opcional'} · {checkedCount} de {items.length} verificados
      </div>
      <div style={{ display: 'grid', gap: 10, gridColumn: '1 / -1' }}>
        {items.map((item) => {
          const response = responsesByItemId.get(item.id);
          const checked = response?.checked === true;
          const key = `${report.interventionId}:${section.id}:${item.id}`;
          return (
            <label className={styles.info} key={item.id} style={{ cursor: allowed && !mutationBusy ? 'pointer' : 'default' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!allowed || mutationBusy}
                  onChange={() => void onSetChecklistItem({
                    interventionId: report.interventionId,
                    sectionId: section.id,
                    itemId: item.id,
                    checked: !checked,
                    expectedVersion: response?.version ?? 0,
                  })}
                />
                {item.label}
              </span>
              {savingChecklistKey === key ? <small className={styles.helper}>Guardando…</small> : null}
            </label>
          );
        })}
      </div>
      {!allowed ? (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no autoriza editar esta checklist en el estado actual.
        </p>
      ) : null}
    </div>
  );
}

export function InterventionReportControls({
  job,
  mutationBusy,
  uploadingPhotoKey,
  savingMeasurementKey,
  savingFindingKey,
  savingChecklistKey,
  error,
  onAddPhoto,
  onAddMeasurement,
  onAddFinding,
  onSetChecklistItem,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  uploadingPhotoKey: string | null;
  savingMeasurementKey: string | null;
  savingFindingKey: string | null;
  savingChecklistKey: string | null;
  error: string | null;
  onAddPhoto: (input: ReportPhotoInput) => Promise<boolean>;
  onAddMeasurement: (input: ReportMeasurementInput) => Promise<boolean>;
  onAddFinding: (input: ReportFindingInput) => Promise<boolean>;
  onSetChecklistItem: (input: ReportChecklistInput) => Promise<boolean>;
}) {
  const photoOptionsByIntervention = useMemo(() => new Map(
    job.reportPhotoOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportPhotoOptions]);
  const measurementOptionsByIntervention = useMemo(() => new Map(
    job.reportMeasurementOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportMeasurementOptions]);
  const findingOptionsByIntervention = useMemo(() => new Map(
    job.reportFindingOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportFindingOptions]);
  const checklistOptionsByIntervention = useMemo(() => new Map(
    job.reportChecklistOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportChecklistOptions]);

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
        const allowedPhotoSections = photoOptionsByIntervention.get(report.interventionId) ?? new Set<string>();
        const allowedMeasurementSections = measurementOptionsByIntervention.get(report.interventionId) ?? new Set<string>();
        const allowedFindingSections = findingOptionsByIntervention.get(report.interventionId) ?? new Set<string>();
        const allowedChecklistSections = checklistOptionsByIntervention.get(report.interventionId) ?? new Set<string>();
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
              if (section.type === 'photos') {
                const key = `${report.interventionId}:${section.id}`;
                return (
                  <PhotoSectionInput
                    key={section.id}
                    report={report}
                    section={section}
                    allowed={allowedPhotoSections.has(section.id)}
                    mutationBusy={mutationBusy}
                    uploading={uploadingPhotoKey === key}
                    onAddPhoto={onAddPhoto}
                  />
                );
              }
              if (section.type === 'measurement_table') {
                const key = `${report.interventionId}:${section.id}`;
                return (
                  <MeasurementSectionInput
                    key={section.id}
                    report={report}
                    section={section}
                    allowed={allowedMeasurementSections.has(section.id)}
                    mutationBusy={mutationBusy}
                    saving={savingMeasurementKey === key}
                    onAddMeasurement={onAddMeasurement}
                  />
                );
              }
              if (section.type === 'findings') {
                const key = `${report.interventionId}:${section.id}`;
                return (
                  <FindingSectionInput
                    key={section.id}
                    report={report}
                    section={section}
                    allowed={allowedFindingSections.has(section.id)}
                    mutationBusy={mutationBusy}
                    saving={savingFindingKey === key}
                    onAddFinding={onAddFinding}
                  />
                );
              }
              if (section.type === 'checklist') {
                return (
                  <ChecklistSectionInput
                    key={section.id}
                    report={report}
                    section={section}
                    allowed={allowedChecklistSections.has(section.id)}
                    mutationBusy={mutationBusy}
                    savingChecklistKey={savingChecklistKey}
                    onSetChecklistItem={onSetChecklistItem}
                  />
                );
              }
              const evidence = evidenceCount(report, section.id);
              const measurements = measurementCount(report, section.id);
              const findings = findingCount(report, section.id);
              return (
                <div className={styles.interventionCard} key={section.id}>
                  <div>
                    <strong>{section.title}</strong>
                    <span>{sectionTypeLabel(section)} · {section.required ? 'requerida' : 'opcional'}</span>
                  </div>
                  <div className={styles.badges}>
                    {evidence > 0 ? <span className={styles.badge}>{evidence} evidencia{evidence === 1 ? '' : 's'}</span> : null}
                    {measurements > 0 ? <span className={styles.badge}>{measurements} medición{measurements === 1 ? '' : 'es'}</span> : null}
                    {findings > 0 ? <span className={styles.badge}>{findings} hallazgo{findings === 1 ? '' : 's'}</span> : null}
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