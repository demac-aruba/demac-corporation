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
import simulationStyles from './field-admin-simulator.module.css';
import styles from './technician-field-home.module.css';

type Props = {
  targets: FieldAdminSimulationTarget[];
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
};

const MAINLINE_STAGES: FieldSimulationStage[] = ['scheduled', 'en_route', 'on_site', 'in_progress', 'ready_for_office_review'];

function nextStageLabel(stage: FieldSimulationStage, canSubmitReview: boolean) {
  if (stage === 'scheduled') return 'Simular: En camino';
  if (stage === 'en_route') return 'Simular: Llegué';
  if (stage === 'on_site') return 'Simular: Iniciar trabajo';
  if (stage === 'pending') return 'Simular: Reanudar trabajo';
  if (stage === 'in_progress' || stage === 'requires_return_visit') {
    return canSubmitReview ? 'Simular: Enviar a revisión' : 'Envío reservado al líder';
  }
  if (stage === 'ready_for_office_review') return 'Enviado a revisión (simulado)';
  if (stage === 'completed') return 'Trabajo real completado';
  if (stage === 'no_access') return 'Visita cerrada: sin acceso';
  if (stage === 'cancelled') return 'Visita cancelada';
  return FIELD_SIMULATION_STAGE_LABELS[stage];
}

function progressIndex(stage: FieldSimulationStage) {
  if (stage === 'en_route') return 1;
  if (stage === 'on_site') return 2;
  if (stage === 'in_progress' || stage === 'pending' || stage === 'requires_return_visit') return 3;
  if (stage === 'ready_for_office_review' || stage === 'completed') return 4;
  return 0;
}

export function FieldAdminSimulationSelector({ targets, value, loading, onChange }: Props) {
  const vans = targets.filter((target) => target.kind === 'van');
  const staff = targets.filter((target) => target.kind === 'staff');
  const selectedValue = targets.some((target) => target.value === value) ? value : '';
  return (
    <label className={simulationStyles.simulationSelector}>
      <span>Vista temporal</span>
      <select disabled={loading || !targets.length} value={selectedValue} onChange={(event) => onChange(event.target.value)}>
        {!selectedValue ? <option value="" disabled>{loading ? 'Cargando Vans y técnicos…' : 'Selecciona una Van o técnico'}</option> : null}
        {vans.length ? <optgroup label="Vans">
          {vans.map((target) => <option key={target.value} value={target.value}>{target.label} — {target.detail}</option>)}
        </optgroup> : null}
        {staff.length ? <optgroup label="Técnicos">
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
  const [notes, setNotes] = useState('');
  const [evidenceNames, setEvidenceNames] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const completedChecks = Object.values(checks).filter(Boolean).length;
  const stageIndex = progressIndex(stage);
  const transitions = fieldSimulationTransitions(stage);
  const readOnlyFallback = job.assignmentSource === 'profile_van_fallback';
  const canExecute = !readOnlyFallback && (job.responsibility === 'lead' || job.responsibility === 'technician');
  const canSubmitReview = canExecute && job.responsibility === 'lead';
  const canReport = !readOnlyFallback
    && job.responsibility !== 'office'
    && stage === 'in_progress';
  const canManageExecutionScope = canReport && canExecute;
  const mainTarget = nextFieldSimulationStage(stage);
  const mainTransitionAllowed = transitions.includes(mainTarget)
    && canExecute
    && (mainTarget !== 'ready_for_office_review' || canSubmitReview);

  const reset = () => {
    setStage(initialStage);
    setNotes('');
    setEvidenceNames([]);
    setChecks({});
  };

  const advance = () => {
    if (!mainTransitionAllowed) return;
    setStage(mainTarget);
  };

  return (
    <div className={styles.shell}>
      <header className={styles.detailHeader}>
        <button className={styles.back} type="button" onClick={onBack} aria-label="Volver a trabajos de hoy">←</button>
        <div className={styles.detailTitle}>
          <div className={styles.eyebrow}>DEMAC · Simulación temporal</div>
          <h1>{job.customerName}</h1>
          <p>{job.propertyName || job.address || job.workOrderId}</p>
        </div>
      </header>

      <section className={simulationStyles.simulationNotice} aria-live="polite">
        <strong>Modo simulación · {targetLabel}</strong>
        <span>Usa datos reales de la Agenda de hoy. Ninguna acción, nota, evidencia o cierre modifica el trabajo real.</span>
      </section>

      <section className={styles.section}>
        <div className={simulationStyles.simulationProgress} aria-label="Progreso simulado">
          {MAINLINE_STAGES.map((item, index) => (
            <div className={index <= stageIndex ? simulationStyles.simulationStepActive : simulationStyles.simulationStep} key={item}>
              <b>{index + 1}</b><span>{FIELD_SIMULATION_STAGE_LABELS[item]}</span>
            </div>
          ))}
        </div>
        <div className={simulationStyles.simulationOutcome}>Estado de esta prueba: <strong>{FIELD_SIMULATION_STAGE_LABELS[stage]}</strong></div>
        {!canExecute ? <p className={styles.helper}>Esta selección es de solo lectura/contribución y no recibe controles de transición en el portal real.</p> : !canSubmitReview ? <p className={styles.helper}>Este técnico puede ejecutar y reportar, pero el envío final a revisión pertenece al líder de la Van.</p> : null}
        <div className={styles.visitActions}>
          <button className={`${styles.action} ${styles.primary}`} type="button" disabled={!mainTransitionAllowed} onClick={advance}>{nextStageLabel(stage, canSubmitReview)}</button>
          {transitions.includes('pending') ? <button className={styles.action} type="button" disabled={!canExecute} onClick={() => setStage('pending')}>Dejar pendiente</button> : null}
          {transitions.includes('requires_return_visit') ? <button className={styles.action} type="button" disabled={!canExecute} onClick={() => setStage('requires_return_visit')}>Solicitar retorno</button> : null}
          {transitions.includes('no_access') ? <button className={styles.action} type="button" disabled={!canExecute} onClick={() => setStage('no_access')}>Sin acceso</button> : null}
          {transitions.includes('cancelled') ? <button className={styles.action} type="button" disabled={!canExecute} onClick={() => setStage('cancelled')}>Cancelar visita</button> : null}
          <button className={styles.action} type="button" disabled={initialStage === 'completed'} onClick={reset}>Reiniciar esta prueba</button>
        </div>
      </section>

      <div className={styles.detailGrid}>
        <main>
          <section className={styles.section}>
            <h2>TRABAJO REAL PROGRAMADO</h2>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Fecha y hora</span><strong>{job.date} · {job.time || 'Hora pendiente'}{job.endTime ? `–${job.endTime}` : ''}</strong></div>
              <div className={styles.info}><span>Orden / Van</span><strong>{job.workOrderId} · {job.vanId || 'Sin Van'}</strong></div>
              <div className={styles.info}><span>Dirección</span><strong>{job.address || 'Dirección pendiente'}</strong></div>
              <div className={styles.info}><span>Estado de Agenda</span><strong>{job.status}</strong></div>
            </div>
            <div className={styles.planned} style={{ marginTop: 12 }}>
              <div className={styles.plannedTitle}>Alcance</div>
              {job.plannedWork.length ? job.plannedWork.map((item) => (
                <div className={styles.plannedItem} key={item.id}><span>{item.label}</span><strong>× {item.quantity}</strong></div>
              )) : <p className={styles.helper}>{job.customerFacingDescription || 'Trabajo programado'}</p>}
            </div>
          </section>

          <section className={styles.section}>
            <h2>REGISTRO DE SERVICIO · SOLO PRUEBA</h2>
            <div className={simulationStyles.simulationChecklist}>
              {[
                { key: 'arrival', label: 'Confirmar llegada y equipo atendido', allowed: canManageExecutionScope },
                { key: 'measurements', label: 'Registrar diagnóstico y mediciones', allowed: canReport },
                { key: 'materials', label: 'Confirmar materiales / add-ons', allowed: canManageExecutionScope },
                { key: 'report', label: 'Completar reporte técnico', allowed: canReport },
                { key: 'ack', label: 'Registrar acuse del cliente', allowed: canManageExecutionScope },
              ].map(({ key, label, allowed }) => (
                <label key={key}><input type="checkbox" disabled={!allowed} checked={Boolean(checks[key])} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>
              ))}
            </div>
            <p className={styles.helper}>{completedChecks} de 5 pasos marcados en esta prueba.</p>
            <label className={simulationStyles.simulationTextArea}>
              <span>Notas del técnico (simuladas)</span>
              <textarea disabled={!canReport} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Escribe hallazgos, diagnóstico o recomendaciones…" />
            </label>
            <label className={simulationStyles.simulationEvidence}>
              <span>Agregar evidencia local de prueba</span>
              <input type="file" disabled={!canReport} accept="image/*" multiple onChange={(event) => setEvidenceNames(Array.from(event.target.files ?? []).map((file) => file.name))} />
            </label>
            {evidenceNames.length ? <p className={styles.helper}>{evidenceNames.length} archivo(s) seleccionados localmente: {evidenceNames.join(', ')}</p> : null}
          </section>
        </main>

        <aside>
          <section className={styles.section}>
            <h2>CLIENTE Y ACCESO</h2>
            <div className={styles.info}><span>Contacto</span><strong>{job.arrivalPhone || 'Sin teléfono registrado'}</strong></div>
            <div className={simulationStyles.disabledContactActions}>
              <button type="button" disabled>Llamar</button>
              <button type="button" disabled>WhatsApp</button>
              <button type="button" disabled>Navegar</button>
            </div>
            <p className={styles.helper}>Contacto y navegación reales deshabilitados durante la simulación.</p>
          </section>
          <section className={styles.section}>
            <h2>INSTRUCCIONES</h2>
            <div className={styles.info}><span>Acceso</span><strong>{job.accessInstructions || 'Sin instrucciones especiales'}</strong></div>
            <div className={styles.info} style={{ marginTop: 10 }}><span>Para técnico</span><strong>{job.technicianInstructions || 'Sin instrucciones adicionales'}</strong></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
