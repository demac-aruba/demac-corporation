'use client';

import { useState } from 'react';
import type {
  FieldExecutionJobDetail,
  FieldInterventionExecutionTarget,
} from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

type TransitionInput = {
  interventionId: string;
  target: FieldInterventionExecutionTarget;
  expectedVersion: number;
  note: string;
};

const TARGET_LABELS: Record<FieldInterventionExecutionTarget, string> = {
  in_progress: 'Iniciar servicio',
  completed: 'Completar servicio',
  pending_part: 'Pendiente por pieza',
  not_performed: 'No realizado',
};

function reasonRequired(target: FieldInterventionExecutionTarget) {
  return target === 'pending_part' || target === 'not_performed';
}

export function InterventionExecutionControls({
  job,
  mutationBusy,
  transitioningInterventionId,
  error,
  onTransition,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  transitioningInterventionId: string | null;
  error: string | null;
  onTransition: (input: TransitionInput) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));

  if (!job.interventionExecutionOptions.length && !error) return null;

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>EJECUCIÓN DEL TRABAJO</div>
      {job.interventionExecutionOptions.map((option) => {
        const intervention = interventionById.get(option.interventionId);
        if (!intervention) return null;
        const visitAsset = visitAssetById.get(intervention.visitAssetId);
        const equipment = visitAsset ? equipmentById.get(visitAsset.assetId) : undefined;
        const note = notes[intervention.id] ?? '';
        const hasReasonTarget = option.allowedTargets.some(reasonRequired);
        return (
          <div className={styles.interventionForm} key={intervention.id}>
            <strong>{visitAsset?.locationLabel || equipment?.locationLabel || 'A/C confirmado'}</strong>
            <span>{intervention.interventionType}</span>
            {hasReasonTarget ? (
              <label>
                <span>Razón / nota de resultado</span>
                <textarea
                  className={styles.textarea}
                  disabled={mutationBusy}
                  value={note}
                  onChange={(event) => setNotes((current) => ({ ...current, [intervention.id]: event.target.value }))}
                  placeholder="Obligatoria para pendiente por pieza o no realizado"
                  rows={3}
                />
              </label>
            ) : null}
            <div className={styles.actions}>
              {option.allowedTargets.map((target) => {
                const reasonOk = !reasonRequired(target) || note.trim().length >= 3;
                const active = transitioningInterventionId === intervention.id;
                return (
                  <button
                    className={`${styles.action} ${target === 'in_progress' || target === 'completed' ? styles.primary : ''}`}
                    disabled={mutationBusy || !reasonOk}
                    key={target}
                    type="button"
                    onClick={() => onTransition({
                      interventionId: intervention.id,
                      target,
                      expectedVersion: intervention.version,
                      note: target === 'in_progress' ? '' : note.trim(),
                    })}
                  >
                    {active ? 'Procesando…' : TARGET_LABELS[target]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
