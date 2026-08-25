'use client';

import { useState } from 'react';
import type { FieldExecutionJobDetail, FieldWorkInterventionStatus } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

type Draft = {
  plannedWorkLineId: string;
  serviceCatalogItemId: string;
};

type CreateInput = Draft & {
  visitAssetId: string;
};

function interventionStatusLabel(status: FieldWorkInterventionStatus) {
  if (status === 'planned') return 'Planificada';
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'in_progress') return 'En proceso';
  if (status === 'pending_authorization') return 'Pendiente autorización';
  if (status === 'pending_part') return 'Pendiente repuesto';
  if (status === 'not_performed') return 'No realizada';
  if (status === 'declined') return 'Rechazada';
  if (status === 'cancelled') return 'Cancelada';
  return 'Completada';
}

export function PlannedInterventionControls({
  job,
  mutationBusy,
  creatingVisitAssetId,
  error,
  onCreate,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  creatingVisitAssetId: string | null;
  error: string | null;
  onCreate: (input: CreateInput) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const plannedWorkById = new Map(job.plannedWork.map((line) => [line.id, line]));
  const serviceById = new Map(job.availableFieldServices.map((service) => [service.id, service]));
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));

  const setDraft = (visitAssetId: string, changes: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [visitAssetId]: {
        plannedWorkLineId: current[visitAssetId]?.plannedWorkLineId ?? '',
        serviceCatalogItemId: current[visitAssetId]?.serviceCatalogItemId ?? '',
        ...changes,
      },
    }));
  };

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>TRABAJO REAL VINCULADO POR A/C</div>
      {job.workInterventions.length ? job.workInterventions.map((intervention) => {
        const visitAsset = visitAssetById.get(intervention.visitAssetId);
        const equipment = visitAsset ? equipmentById.get(visitAsset.assetId) : undefined;
        const plannedLine = intervention.plannedWorkLineId ? plannedWorkById.get(intervention.plannedWorkLineId) : undefined;
        return (
          <div className={styles.interventionCard} key={intervention.id}>
            <div>
              <strong>{visitAsset?.locationLabel || equipment?.locationLabel || 'A/C confirmado'}</strong>
              <span>{intervention.interventionType}</span>
              <span>{plannedLine ? `Programado: ${plannedLine.label}` : 'Trabajo adicional'} · {interventionStatusLabel(intervention.status)}</span>
            </div>
            <span className={`${styles.badge} ${styles.badgeBrand}`}>{intervention.origin === 'planned' ? 'Plan original' : 'Alcance adicional'}</span>
          </div>
        );
      }) : <p className={styles.helper}>Todavía no hay trabajo real vinculado a los A/C confirmados.</p>}

      {job.plannedInterventionOptions.map((option) => {
        const visitAsset = visitAssetById.get(option.visitAssetId);
        if (!visitAsset) return null;
        const equipment = equipmentById.get(visitAsset.assetId);
        const rawDraft = drafts[option.visitAssetId] ?? { plannedWorkLineId: '', serviceCatalogItemId: '' };
        const plannedWorkLineId = option.plannedWorkLineIds.includes(rawDraft.plannedWorkLineId)
          ? rawDraft.plannedWorkLineId
          : '';
        const serviceCatalogItemId = serviceById.has(rawDraft.serviceCatalogItemId)
          ? rawDraft.serviceCatalogItemId
          : '';
        const canSubmit = Boolean(plannedWorkLineId && serviceCatalogItemId) && !mutationBusy;
        return (
          <div className={styles.interventionForm} key={option.visitAssetId}>
            <strong>{visitAsset.locationLabel || equipment?.locationLabel || `A/C ${visitAsset.sequence}`}</strong>
            <label>
              <span>Línea programada</span>
              <select
                className={styles.select}
                disabled={mutationBusy}
                value={plannedWorkLineId}
                onChange={(event) => setDraft(option.visitAssetId, { plannedWorkLineId: event.target.value })}
              >
                <option value="">Selecciona el trabajo programado</option>
                {option.plannedWorkLineIds.map((lineId) => (
                  <option key={lineId} value={lineId}>{plannedWorkById.get(lineId)?.label || lineId}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Servicio real realizado / a realizar</span>
              <select
                className={styles.select}
                disabled={mutationBusy}
                value={serviceCatalogItemId}
                onChange={(event) => setDraft(option.visitAssetId, { serviceCatalogItemId: event.target.value })}
              >
                <option value="">Selecciona el servicio canónico</option>
                {job.availableFieldServices.map((service) => (
                  <option key={service.id} value={service.id}>{service.label}</option>
                ))}
              </select>
            </label>
            <button
              className={`${styles.action} ${styles.primary}`}
              disabled={!canSubmit}
              type="button"
              onClick={() => onCreate({ visitAssetId: option.visitAssetId, plannedWorkLineId, serviceCatalogItemId })}
            >
              {creatingVisitAssetId === option.visitAssetId ? 'Vinculando…' : 'Vincular trabajo planificado'}
            </button>
          </div>
        );
      })}

      {!job.canAddPlannedIntervention && job.fieldVisit ? (
        <p className={styles.helper}>Las opciones para vincular trabajo planificado son calculadas por Field Authority según el plan restante, el A/C, el estado de visita y la asignación actual.</p>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
