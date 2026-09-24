'use client';

import { useState } from 'react';
import type {
  FieldExecutionJobDetail,
  FieldPlannedWorkDispositionReason,
  FieldWorkInterventionStatus,
} from '@/lib/field-authority';
import { FieldAirContext, FieldChoiceCards, FieldServiceCards, fieldAirChoices, fieldServiceStyles as picker } from './field-service-picker';
import { presentedFieldPriceLabel } from './field-price-display';
import styles from './technician-field-home.module.css';

type Draft = {
  plannedWorkLineId: string;
  serviceCatalogItemId: string;
};

type DispositionDraft = {
  quantity: number;
  reasonCode: FieldPlannedWorkDispositionReason | '';
  note: string;
};

export type PlannedWorkMutationInput =
  | {
      kind: 'intervention';
      visitAssetId: string;
      plannedWorkLineId: string;
      serviceCatalogItemId: string;
    }
  | {
      kind: 'disposition';
      plannedWorkLineId: string;
      quantity: number;
      reasonCode: FieldPlannedWorkDispositionReason;
      note: string;
    };

const REASON_LABELS: Record<FieldPlannedWorkDispositionReason, string> = {
  customer_cancelled: 'Cliente canceló esta parte',
  inaccessible: 'Equipo / área inaccesible',
  unsafe: 'Condición insegura',
  deferred: 'Trabajo diferido para otra visita',
  equipment_unavailable: 'Equipo no estaba disponible',
  other: 'Otra razón',
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

function PlannedInterventionContent({
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
  onCreate: (input: PlannedWorkMutationInput) => void;
}) {
  const [selectedAir, setSelectedAir] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dispositionDrafts, setDispositionDrafts] = useState<Record<string, DispositionDraft>>({});
  const plannedWorkById = new Map(job.plannedWork.map((line) => [line.id, line]));
  const serviceById = new Map(job.availableFieldServices.map((service) => [service.id, service]));
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const scopeChangeById = new Map(job.scopeChanges.map((scopeChange) => [scopeChange.id, scopeChange]));

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

  const setDispositionDraft = (plannedWorkLineId: string, changes: Partial<DispositionDraft>, maxQuantity: number) => {
    setDispositionDrafts((current) => ({
      ...current,
      [plannedWorkLineId]: {
        reasonCode: current[plannedWorkLineId]?.reasonCode ?? '',
        note: current[plannedWorkLineId]?.note ?? '',
        ...changes,
        quantity: Math.max(1, Math.min(maxQuantity, changes.quantity ?? current[plannedWorkLineId]?.quantity ?? 1)),
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
        const scopeChange = intervention.scopeChangeId ? scopeChangeById.get(intervention.scopeChangeId) : undefined;
        return (
          <div className={styles.interventionCard} key={intervention.id}>
            <div>
              <strong>{visitAsset?.locationLabel || equipment?.locationLabel || 'A/C confirmado'}</strong>
              <span>{intervention.interventionType}</span>
              <span>{plannedLine ? `Programado: ${plannedLine.label}` : 'Trabajo adicional'} · {interventionStatusLabel(intervention.status)}</span>
              {scopeChange ? <span>Razón: {scopeChange.reason}</span> : null}
              {intervention.priceSnapshot ? (
                <span><strong>Precio presentado: {presentedFieldPriceLabel(intervention.priceSnapshot)}</strong></span>
              ) : null}
            </div>
            <span className={`${styles.badge} ${styles.badgeBrand}`}>{intervention.origin === 'planned' ? 'Plan original' : 'Alcance adicional'}</span>
          </div>
        );
      }) : <p className={styles.helper}>Todavía no hay trabajo real vinculado a los A/C confirmados.</p>}

      {job.plannedWorkDispositions.length ? (
        <div className={styles.planned}>
          <div className={styles.plannedTitle}>CANTIDAD PROGRAMADA NO REALIZADA</div>
          {job.plannedWorkDispositions.map((disposition) => (
            <div className={styles.plannedItem} key={disposition.id}>
              <span>
                {plannedWorkById.get(disposition.plannedWorkLineId)?.label || disposition.plannedWorkLineId}
                {' · '}{REASON_LABELS[disposition.reasonCode]}
                {disposition.note ? ` · ${disposition.note}` : ''}
              </span>
              <strong>{disposition.quantity}×</strong>
            </div>
          ))}
        </div>
      ) : null}

      <section className={picker.panel} aria-label="Seleccionar servicio planificado">
        <h3 className={picker.heading}>Seleccionar servicio</h3>
        <p className={picker.help}>Vincula el trabajo programado al aire correcto. Seleccionar una tarjeta no inicia ni completa el servicio.</p>
        <FieldChoiceCards title="¿En qué aire trabajarás?"
          choices={fieldAirChoices(job, job.canAddPlannedIntervention ? job.plannedInterventionOptions.map((option) => option.visitAssetId) : [])}
          value={selectedAir} disabled={mutationBusy} onChange={setSelectedAir} />
        {!job.canAddPlannedIntervention || !job.plannedInterventionOptions.length ? <p className={picker.notice} role="status">
          No hay trabajo planificado disponible para vincular en este momento. Revisa los servicios registrados, los aires incluidos y el estado de la visita.
        </p> : null}
        {job.canAddPlannedIntervention && job.plannedInterventionOptions.filter((option) => option.visitAssetId === selectedAir).map((option) => {
          if (!visitAssetById.has(option.visitAssetId)) return null;
          const rawDraft = drafts[option.visitAssetId] ?? { plannedWorkLineId: '', serviceCatalogItemId: '' };
          const plannedWorkLineId = option.plannedWorkLineIds.includes(rawDraft.plannedWorkLineId) && plannedWorkById.has(rawDraft.plannedWorkLineId) ? rawDraft.plannedWorkLineId : '';
          const serviceCatalogItemId = serviceById.has(rawDraft.serviceCatalogItemId) ? rawDraft.serviceCatalogItemId : '';
          const canSubmit = Boolean(plannedWorkLineId && serviceCatalogItemId) && !mutationBusy;
          const selectionChanged = Boolean((rawDraft.plannedWorkLineId && !plannedWorkLineId) || (rawDraft.serviceCatalogItemId && !serviceCatalogItemId));
          return <div className={picker.choiceList} key={option.visitAssetId}>
            <FieldAirContext job={job} visitAssetId={option.visitAssetId} />
            <FieldChoiceCards title="Trabajo programado por oficina"
              choices={option.plannedWorkLineIds.flatMap((id) => {
                const line = plannedWorkById.get(id);
                return line ? [{ id, label: line.label, detail: 'Plan original · no se modifica la cita' }] : [];
              })} value={plannedWorkLineId} disabled={mutationBusy}
              onChange={(id) => setDraft(option.visitAssetId, { plannedWorkLineId: id })} />
            <FieldServiceCards services={job.availableFieldServices} value={serviceCatalogItemId} disabled={mutationBusy}
              onChange={(id) => setDraft(option.visitAssetId, { serviceCatalogItemId: id })} />
            {selectionChanged ? <p className={picker.error} role="status">Las opciones disponibles cambiaron. Revisa la selección antes de guardar.</p> : null}
            {plannedWorkLineId && serviceCatalogItemId ? <div className={picker.review} aria-label="Resumen de selección">
              <span>Programado: <strong>{plannedWorkById.get(plannedWorkLineId)?.label}</strong></span>
              <span>Servicio elegido: <strong>{serviceById.get(serviceCatalogItemId)?.label}</strong></span>
              <span>Guardar registra la selección; no marca el servicio realizado ni crea una factura.</span>
            </div> : null}
            <div className={picker.actions}>
              <button className={picker.secondary} disabled={mutationBusy} type="button" onClick={() => setDraft(option.visitAssetId, { plannedWorkLineId: '', serviceCatalogItemId: '' })}>Limpiar selección</button>
              <button className={picker.primary} disabled={!canSubmit} type="button" onClick={() => {
                if (!canSubmit) return;
                onCreate({ kind: 'intervention', visitAssetId: option.visitAssetId, plannedWorkLineId, serviceCatalogItemId });
              }}>{creatingVisitAssetId === option.visitAssetId ? 'Guardando servicio…' : 'Guardar servicio para este aire'}</button>
            </div>
          </div>;
        })}
      </section>

      {job.plannedWorkDispositionOptions.map((option) => {
        const draft = dispositionDrafts[option.plannedWorkLineId] ?? { quantity: 1, reasonCode: '', note: '' };
        const reasonCode = draft.reasonCode;
        const needsNote = reasonCode === 'other';
        const canSubmit = Boolean(reasonCode && (!needsNote || draft.note.trim().length >= 3)) && !mutationBusy;
        const busyKey = `disposition:${option.plannedWorkLineId}`;
        return (
          <div className={styles.interventionForm} key={busyKey}>
            <strong>Reconciliar: {plannedWorkById.get(option.plannedWorkLineId)?.label || option.plannedWorkLineId}</strong>
            <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
              Registra sólo cantidad programada que realmente no se ejecutó. Esto no crea un A/C ni modifica la cita original.
            </p>
            <label>
              <span>Cantidad no realizada</span>
              <input className={styles.select} disabled={mutationBusy} type="number" min={1} max={option.maxQuantity} step={1} value={draft.quantity} onChange={(event) => setDispositionDraft(option.plannedWorkLineId, { quantity: Number(event.target.value) }, option.maxQuantity)} />
            </label>
            <label>
              <span>Razón</span>
              <select className={styles.select} disabled={mutationBusy} value={reasonCode} onChange={(event) => setDispositionDraft(option.plannedWorkLineId, { reasonCode: event.target.value as FieldPlannedWorkDispositionReason }, option.maxQuantity)}>
                <option value="">Selecciona una razón</option>
                {Object.entries(REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Nota {needsNote ? '(requerida)' : '(opcional)'}</span>
              <textarea className={styles.select} disabled={mutationBusy} rows={2} value={draft.note} onChange={(event) => setDispositionDraft(option.plannedWorkLineId, { note: event.target.value }, option.maxQuantity)} placeholder="Explica brevemente cuando sea necesario." />
            </label>
            <button className={`${styles.action} ${styles.primary}`} disabled={!canSubmit} type="button" onClick={() => reasonCode && onCreate({ kind: 'disposition', plannedWorkLineId: option.plannedWorkLineId, quantity: draft.quantity, reasonCode, note: draft.note.trim() })}>
              {creatingVisitAssetId === busyKey ? 'Registrando…' : 'Registrar trabajo no realizado'}
            </button>
          </div>
        );
      })}

      {!job.canAddPlannedIntervention && !job.canRecordPlannedWorkDisposition && job.fieldVisit ? (
        <p className={styles.helper}>Las opciones de trabajo planificado son calculadas por Field Authority según el plan restante, los A/C confirmados, el estado de visita y la asignación actual.</p>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}

/** Existing controller retains mutation locks, request IDs, refresh, and server errors. */
export function PlannedInterventionControls(props: Parameters<typeof PlannedInterventionContent>[0]) {
  return <PlannedInterventionContent key={JSON.stringify([props.job.workOrderId, props.job.customerId, props.job.propertyId, props.job.fieldVisit?.id])} {...props} />;
}
