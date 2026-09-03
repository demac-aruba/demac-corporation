'use client';

import { useState } from 'react';
import type { FieldScheduleJob } from '@/lib/field-authority';
import {
  FIELD_SIMULATION_STAGE_LABELS,
  fieldSimulationStageForWorkOrderStatus,
  fieldSimulationTransitions,
  nextFieldSimulationStage,
  type FieldAdminSimulationTarget,
  type FieldSimulationStage,
} from '@/lib/field-admin-simulator';
import {
  FIELD_EXPERIENCE_STAGES,
  fieldExperienceStageForStatus,
  fieldExperienceStepState,
  type FieldExperienceStage,
} from '@/lib/field-ui-flow';
import simulationStyles from './field-admin-simulator.module.css';

type Props = {
  targets: FieldAdminSimulationTarget[];
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
};

const SERVICE_CHECKS = [
  { key: 'arrival', label: 'Llegada y equipo confirmados', permission: 'scope' },
  { key: 'measurements', label: 'Diagnóstico y mediciones', permission: 'report' },
  { key: 'materials', label: 'Materiales y add-ons', permission: 'scope' },
  { key: 'report', label: 'Reporte técnico', permission: 'report' },
] as const;

function nextStageLabel(stage: FieldSimulationStage, canSubmitReview: boolean) {
  if (stage === 'scheduled') return 'En camino';
  if (stage === 'en_route') return 'Confirmar llegada';
  if (stage === 'on_site') return 'Iniciar servicio';
  if (stage === 'pending') return 'Reanudar servicio';
  if (stage === 'in_progress' || stage === 'requires_return_visit') {
    return canSubmitReview ? 'Enviar a revisión' : 'Envío reservado al líder';
  }
  if (stage === 'ready_for_office_review') return 'Enviado a revisión';
  if (stage === 'completed') return 'Trabajo completado';
  if (stage === 'no_access') return 'Visita cerrada: sin acceso';
  if (stage === 'cancelled') return 'Visita cancelada';
  return FIELD_SIMULATION_STAGE_LABELS[stage];
}

function compactDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('es-AW', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

export function FieldAdminSimulationSelector({ targets, value, loading, onChange }: Props) {
  const vans = targets.filter((target) => target.kind === 'van');
  const staff = targets.filter((target) => target.kind === 'staff');
  const selectableTargets = [...vans, ...staff];
  const selectedValue = selectableTargets.some((target) => target.value === value) ? value : '';

  return (
    <label className={simulationStyles.simulationSelector}>
      <span>Vista de prueba · solo admin</span>
      <select disabled={loading || !selectableTargets.length} value={selectedValue} onChange={(event) => onChange(event.target.value)}>
        {!selectedValue ? <option value="" disabled>{loading ? 'Cargando Vans y técnicos…' : 'Selecciona una Van o técnico'}</option> : null}
        {vans.length ? <optgroup label="Vans individuales">
          {vans.map((target) => <option key={target.value} value={target.value}>{target.label} — {target.detail}</option>)}
        </optgroup> : null}
        {staff.length ? <optgroup label="Técnicos individuales">
          {staff.map((target) => <option key={target.value} value={target.value}>{target.label} — {target.detail}</option>)}
        </optgroup> : null}
      </select>
    </label>
  );
}

export function FieldAdminSimulationDetail({
  job,
  targetLabel,
  onBack,
}: {
  job: FieldScheduleJob;
  targetLabel: string;
  onBack: () => void;
}) {
  const initialStage = fieldSimulationStageForWorkOrderStatus(job.status);
  const [stage, setStage] = useState<FieldSimulationStage>(initialStage);
  const [visibleStep, setVisibleStep] = useState<FieldExperienceStage>(fieldExperienceStageForStatus(initialStage));
  const [notes, setNotes] = useState('');
  const [evidenceNames, setEvidenceNames] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const completedChecks = Object.values(checks).filter(Boolean).length;
  const transitions = fieldSimulationTransitions(stage);
  const readOnlyFallback = job.assignmentSource === 'profile_van_fallback';
  const canExecute = !readOnlyFallback && (job.responsibility === 'lead' || job.responsibility === 'technician');
  const canSubmitReview = canExecute && job.responsibility === 'lead';
  const canReport = !readOnlyFallback && job.responsibility !== 'office' && stage === 'in_progress';
  const canManageExecutionScope = canReport && canExecute;
  const mainTarget = nextFieldSimulationStage(stage);
  const mainTransitionAllowed = transitions.includes(mainTarget)
    && canExecute
    && (mainTarget !== 'ready_for_office_review' || canSubmitReview);

  const moveToStage = (next: FieldSimulationStage) => {
    setStage(next);
    setVisibleStep(fieldExperienceStageForStatus(next));
  };

  const reset = () => {
    setStage(initialStage);
    setVisibleStep(fieldExperienceStageForStatus(initialStage));
    setNotes('');
    setEvidenceNames([]);
    setChecks({});
  };

  const advance = () => {
    if (!mainTransitionAllowed) return;
    moveToStage(mainTarget);
  };

  const permissionForCheck = (permission: 'scope' | 'report') => permission === 'scope'
    ? canManageExecutionScope
    : canReport;

  return (
    <div className={simulationStyles.simulationShell}>
      <header className={simulationStyles.detailHeader}>
        <button className={simulationStyles.back} type="button" onClick={onBack} aria-label="Volver a trabajos de hoy">←</button>
        <div>
          <div className={simulationStyles.eyebrow}>DEMAC · Trabajo activo</div>
          <h1>{job.customerName}</h1>
          <p>{job.propertyName || job.address || job.workOrderId}</p>
        </div>
        <span className={simulationStyles.statusPill}>{FIELD_SIMULATION_STAGE_LABELS[stage]}</span>
      </header>

      <section className={simulationStyles.simulationNotice} aria-live="polite">
        <strong>Prueba temporal · {targetLabel}</strong>
        <span>Datos reales de la Agenda de hoy. Las acciones de esta pantalla son locales y no modifican el trabajo real.</span>
      </section>

      <section className={simulationStyles.jobOverview}>
        <div>
          <span>{compactDate(job.date)} · {job.time || 'Hora pendiente'}{job.endTime ? `–${job.endTime}` : ''}</span>
          <strong>{job.address || 'Dirección pendiente'}</strong>
        </div>
        <div className={simulationStyles.quickActions} aria-label="Contacto deshabilitado durante la prueba">
          <button type="button" disabled>Llamar</button>
          <button type="button" disabled>Navegar</button>
        </div>
      </section>

      <nav className={simulationStyles.simulationProgress} aria-label="Pasos del trabajo simulado">
        {FIELD_EXPERIENCE_STAGES.map((item, index) => {
          const stepState = fieldExperienceStepState(item.id, fieldExperienceStageForStatus(stage));
          return (
            <button
              className={visibleStep === item.id ? simulationStyles.simulationStepActive : simulationStyles.simulationStep}
              data-state={stepState}
              key={item.id}
              type="button"
              onClick={() => setVisibleStep(item.id)}
              aria-current={visibleStep === item.id ? 'step' : undefined}
            >
              <b>{stepState === 'complete' ? '✓' : index + 1}</b>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className={simulationStyles.stepPanel} hidden={visibleStep !== 'arrival'}>
        <div className={simulationStyles.panelHeading}>
          <div><span>Paso 1</span><h2>Llegada</h2></div>
          <span className={simulationStyles.syncState}>Guardado local</span>
        </div>
        <div className={simulationStyles.infoGrid}>
          <div className={simulationStyles.info}><span>Orden / Van</span><strong>{job.workOrderId} · {job.vanId || 'Sin Van'}</strong></div>
          <div className={simulationStyles.info}><span>Contacto</span><strong>{job.arrivalPhone || 'Sin teléfono registrado'}</strong></div>
          <div className={simulationStyles.info}><span>Acceso</span><strong>{job.accessInstructions || 'Sin instrucciones especiales'}</strong></div>
          <div className={simulationStyles.info}><span>Para el técnico</span><strong>{job.technicianInstructions || 'Sin instrucciones adicionales'}</strong></div>
        </div>
        <div className={simulationStyles.scopeCard}>
          <span>Alcance programado</span>
          <strong>{job.customerFacingDescription || job.plannedWork.map((item) => item.label).join(' · ') || 'Trabajo programado'}</strong>
        </div>
      </div>

      <div className={simulationStyles.stepPanel} hidden={visibleStep !== 'service'}>
        <div className={simulationStyles.panelHeading}>
          <div><span>Paso 2</span><h2>Servicio</h2></div>
          <span className={simulationStyles.syncState}>{completedChecks} de {SERVICE_CHECKS.length}</span>
        </div>
        <div className={simulationStyles.equipmentCard}>
          <div className={simulationStyles.equipmentIcon}>AC</div>
          <div><span>Equipo actual</span><strong>{job.estimatedQuantity || 1} unidad(es) programada(s)</strong></div>
          <span>{job.vanId || 'Sin Van'}</span>
        </div>
        <div className={simulationStyles.simulationChecklist}>
          {SERVICE_CHECKS.map(({ key, label, permission }) => (
            <label key={key}>
              <input
                type="checkbox"
                disabled={!permissionForCheck(permission)}
                checked={Boolean(checks[key])}
                onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <details className={simulationStyles.disclosure} open>
          <summary>Notas y evidencia</summary>
          <label className={simulationStyles.simulationTextArea}>
            <span>Notas del técnico (simuladas)</span>
            <textarea disabled={!canReport} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Hallazgos, diagnóstico o recomendaciones…" />
          </label>
          <label className={simulationStyles.simulationEvidence}>
            <span>Agregar fotos de prueba</span>
            <input type="file" disabled={!canReport} accept="image/*" multiple onChange={(event) => setEvidenceNames(Array.from(event.target.files ?? []).map((file) => file.name))} />
          </label>
          {evidenceNames.length ? <p>{evidenceNames.length} archivo(s) locales: {evidenceNames.join(', ')}</p> : null}
        </details>
      </div>

      <div className={simulationStyles.stepPanel} hidden={visibleStep !== 'close'}>
        <div className={simulationStyles.panelHeading}>
          <div><span>Paso 3</span><h2>Cierre</h2></div>
          <span className={simulationStyles.syncState}>{FIELD_SIMULATION_STAGE_LABELS[stage]}</span>
        </div>
        <div className={simulationStyles.closeSummary}>
          <div><span>Tareas</span><strong>{completedChecks}/{SERVICE_CHECKS.length}</strong></div>
          <div><span>Fotos</span><strong>{evidenceNames.length}</strong></div>
          <div><span>Nota técnica</span><strong>{notes.trim() ? 'Lista' : 'Pendiente'}</strong></div>
        </div>
        <label className={simulationStyles.acknowledgement}>
          <input
            type="checkbox"
            disabled={!canManageExecutionScope}
            checked={Boolean(checks.ack)}
            onChange={(event) => setChecks((current) => ({ ...current, ack: event.target.checked }))}
          />
          <span><strong>Acuse del cliente</strong><small>Confirmación local para esta prueba.</small></span>
        </label>
        <div className={simulationStyles.reportPreview}>
          <span>Resumen del reporte</span>
          <strong>{job.customerFacingDescription || 'Servicio programado'}</strong>
          <p>{notes.trim() || 'Agrega los hallazgos en el paso Servicio para verlos aquí.'}</p>
        </div>
      </div>

      {!canExecute ? <p className={simulationStyles.permissionNote}>Esta selección es de solo lectura/contribución y no recibe controles de transición en el portal real.</p> : !canSubmitReview ? <p className={simulationStyles.permissionNote}>Este técnico puede ejecutar y reportar; el envío final pertenece al líder de la Van.</p> : null}

      <details className={simulationStyles.moreActions}>
        <summary>Más opciones de la visita</summary>
        <div>
          {transitions.includes('pending') ? <button type="button" disabled={!canExecute} onClick={() => moveToStage('pending')}>Dejar pendiente</button> : null}
          {transitions.includes('requires_return_visit') ? <button type="button" disabled={!canExecute} onClick={() => moveToStage('requires_return_visit')}>Solicitar retorno</button> : null}
          {transitions.includes('no_access') ? <button type="button" disabled={!canExecute} onClick={() => moveToStage('no_access')}>Sin acceso</button> : null}
          {transitions.includes('cancelled') ? <button type="button" disabled={!canExecute} onClick={() => moveToStage('cancelled')}>Cancelar visita</button> : null}
          <button type="button" disabled={initialStage === 'completed'} onClick={reset}>Reiniciar prueba</button>
        </div>
      </details>

      <div className={simulationStyles.stickyAction}>
        <div><span>Estado simulado</span><strong>{FIELD_SIMULATION_STAGE_LABELS[stage]}</strong></div>
        <button type="button" disabled={!mainTransitionAllowed} onClick={advance}>{nextStageLabel(stage, canSubmitReview)} <span>→</span></button>
      </div>
    </div>
  );
}
