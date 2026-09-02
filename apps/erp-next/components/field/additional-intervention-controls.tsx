'use client';

import { useState } from 'react';
import type { FieldExecutionJobDetail, FieldTechnicianScopeChangeOrigin } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

type Draft = {
  serviceCatalogItemId: string;
  origin: '' | FieldTechnicianScopeChangeOrigin;
  reason: string;
};

type CreateInput = {
  visitAssetId: string;
  serviceCatalogItemId: string;
  origin: FieldTechnicianScopeChangeOrigin;
  reason: string;
};

function isTechnicianScopeOrigin(value: string): value is FieldTechnicianScopeChangeOrigin {
  return value === 'client_requested_additional_work' || value === 'technician_discovered_additional_need';
}

export function AdditionalInterventionControls({
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
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const serviceById = new Map(job.availableFieldServices.map((service) => [service.id, service]));

  const setDraft = (visitAssetId: string, changes: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [visitAssetId]: {
        serviceCatalogItemId: current[visitAssetId]?.serviceCatalogItemId ?? '',
        origin: current[visitAssetId]?.origin ?? '',
        reason: current[visitAssetId]?.reason ?? '',
        ...changes,
      },
    }));
  };

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>ALCANCE ADICIONAL</div>
      <p className={styles.helper}>Solicitar trabajo adicional no lo aprueba. Field Authority lo registra como pendiente de autorización hasta que exista una aprobación gobernada del cliente.</p>

      {job.additionalInterventionVisitAssetIds.map((visitAssetId) => {
        const visitAsset = visitAssetById.get(visitAssetId);
        if (!visitAsset) return null;
        const equipment = equipmentById.get(visitAsset.assetId);
        const rawDraft = drafts[visitAssetId] ?? { serviceCatalogItemId: '', origin: '', reason: '' };
        const serviceCatalogItemId = serviceById.has(rawDraft.serviceCatalogItemId)
          ? rawDraft.serviceCatalogItemId
          : '';
        const origin = isTechnicianScopeOrigin(rawDraft.origin) ? rawDraft.origin : '';
        const reason = rawDraft.reason;
        const canSubmit = Boolean(serviceCatalogItemId && origin && reason.trim().length >= 3) && !mutationBusy;

        return (
          <div className={styles.interventionForm} key={visitAssetId}>
            <strong>{visitAsset.locationLabel || equipment?.locationLabel || `A/C ${visitAsset.sequence}`}</strong>
            <label>
              <span>Servicio adicional</span>
              <select
                className={styles.select}
                disabled={mutationBusy}
                value={serviceCatalogItemId}
                onChange={(event) => setDraft(visitAssetId, { serviceCatalogItemId: event.target.value })}
              >
                <option value="">Selecciona el servicio canónico</option>
                {job.availableFieldServices.map((service) => (
                  <option key={service.id} value={service.id}>{service.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Cómo surgió</span>
              <select
                className={styles.select}
                disabled={mutationBusy}
                value={origin}
                onChange={(event) => setDraft(visitAssetId, {
                  origin: isTechnicianScopeOrigin(event.target.value) ? event.target.value : '',
                })}
              >
                <option value="">Selecciona el origen</option>
                <option value="client_requested_additional_work">Solicitado por el cliente</option>
                <option value="technician_discovered_additional_need">Detectado por el técnico</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Razón / necesidad observada</span>
              <textarea
                className={styles.select}
                disabled={mutationBusy}
                rows={3}
                value={reason}
                onChange={(event) => setDraft(visitAssetId, { reason: event.target.value })}
                placeholder="Describe brevemente por qué este trabajo no estaba en el alcance original."
              />
            </label>
            <button
              className={`${styles.action} ${styles.primary}`}
              disabled={!canSubmit}
              type="button"
              onClick={() => {
                if (!origin) return;
                onCreate({
                  visitAssetId,
                  serviceCatalogItemId,
                  origin,
                  reason,
                });
              }}
            >
              {creatingVisitAssetId === visitAssetId ? 'Registrando…' : 'Proponer trabajo adicional'}
            </button>
          </div>
        );
      })}

      {!job.canAddAdditionalIntervention && job.fieldVisit ? (
        <p className={styles.helper}>Field Authority no proyecta una opción de alcance adicional para el estado, A/C o asignación actual.</p>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
