'use client';

import { useState } from 'react';
import type { FieldExecutionJobDetail, FieldTechnicianScopeChangeOrigin } from '@/lib/field-authority';
import { FieldAirContext, FieldChoiceCards, FieldServiceCards, fieldAirChoices, fieldServiceStyles as styles } from './field-service-picker';

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

function AdditionalInterventionContent({
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
  const [selectedAir, setSelectedAir] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
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

  return <section className={styles.panel} aria-label="Proponer servicio adicional">
    <h3 className={styles.heading}>Trabajo adicional</h3>
    <p className={styles.help}>Fuera del plan original. La propuesta queda pendiente de autorización; no significa que el cliente aceptó ni que el trabajo fue realizado.</p>
    <FieldChoiceCards title="Aire para el adicional"
      choices={fieldAirChoices(job, job.canAddAdditionalIntervention ? job.additionalInterventionVisitAssetIds : [])}
      value={selectedAir} disabled={mutationBusy} onChange={setSelectedAir} />
    {job.canAddAdditionalIntervention && job.additionalInterventionVisitAssetIds.filter((id) => id === selectedAir).map((visitAssetId) => {
      if (!visitAssetById.has(visitAssetId)) return null;
      const rawDraft = drafts[visitAssetId] ?? { serviceCatalogItemId: '', origin: '', reason: '' };
      const serviceCatalogItemId = serviceById.has(rawDraft.serviceCatalogItemId) ? rawDraft.serviceCatalogItemId : '';
      const origin = isTechnicianScopeOrigin(rawDraft.origin) ? rawDraft.origin : '';
      const reason = rawDraft.reason;
      const canSubmit = Boolean(serviceCatalogItemId && origin && reason.trim().length >= 3) && !mutationBusy;
      return <div className={styles.choiceList} key={visitAssetId}>
        <FieldAirContext job={job} visitAssetId={visitAssetId} />
        <FieldServiceCards services={job.availableFieldServices} value={serviceCatalogItemId} disabled={mutationBusy}
          onChange={(id) => setDraft(visitAssetId, { serviceCatalogItemId: id })} />
        <FieldChoiceCards title="¿Cómo surgió este trabajo?" value={origin} disabled={mutationBusy}
          choices={[{ id: 'client_requested_additional_work', label: 'Solicitado por el cliente' }, { id: 'technician_discovered_additional_need', label: 'Necesidad observada en campo' }]}
          onChange={(id) => setDraft(visitAssetId, { origin: isTechnicianScopeOrigin(id) ? id : '' })} />
        <label className={styles.noteField}>
          <span>Razón / necesidad observada</span>
          <textarea disabled={mutationBusy} rows={3} value={reason}
            onChange={(event) => setDraft(visitAssetId, { reason: event.target.value })}
            placeholder="Describe por qué este trabajo no estaba en el alcance original." />
        </label>
        {rawDraft.serviceCatalogItemId && !serviceCatalogItemId ? <p className={styles.error} role="status">El servicio seleccionado ya no está disponible. Revisa el catálogo antes de proponer.</p> : null}
        <p className={styles.notice}>El precio y la autorización se revisan mediante el flujo existente. No se modifica la cita ni se descuenta inventario al proponer.</p>
        <button className={styles.primary} disabled={!canSubmit} type="button" onClick={() => {
          if (!canSubmit || !origin) return;
          onCreate({ visitAssetId, serviceCatalogItemId, origin, reason });
        }}>{creatingVisitAssetId === visitAssetId ? 'Registrando propuesta…' : 'Proponer trabajo adicional'}</button>
      </div>;
    })}
    {!job.canAddAdditionalIntervention || !job.additionalInterventionVisitAssetIds.length ? <p className={styles.notice} role="status">No hay adicionales habilitados para los aires, la visita o tu asignación actual.</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}

export function AdditionalInterventionControls(props: Parameters<typeof AdditionalInterventionContent>[0]) {
  return <AdditionalInterventionContent key={JSON.stringify([props.job.workOrderId, props.job.customerId, props.job.propertyId, props.job.fieldVisit?.id])} {...props} />;
}
