'use client';

import { useState } from 'react';
import type {
  FieldAdditionalWorkDecision,
  FieldApproval,
  FieldExecutionJobDetail,
} from '@/lib/field-authority';
import { presentedFieldPriceLabel } from './field-price-display';
import styles from './technician-field-home.module.css';

type Draft = {
  receiverName: string;
  note: string;
};

type DecisionInput = Draft & {
  interventionId: string;
  decision: FieldAdditionalWorkDecision;
};

function decisionLabel(approval: FieldApproval) {
  return approval.status === 'approved' ? 'Aprobado por cliente' : 'Rechazado por cliente';
}

export function AdditionalApprovalControls({
  job,
  mutationBusy,
  decidingInterventionId,
  error,
  onDecide,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  decidingInterventionId: string | null;
  error: string | null;
  onDecide: (input: DecisionInput) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const scopeById = new Map(job.scopeChanges.map((scopeChange) => [scopeChange.id, scopeChange]));
  const visitAssetById = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const equipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));

  const setDraft = (interventionId: string, changes: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [interventionId]: {
        receiverName: current[interventionId]?.receiverName ?? '',
        note: current[interventionId]?.note ?? '',
        ...changes,
      },
    }));
  };

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>AUTORIZACIÓN DE TRABAJO ADICIONAL</div>
      <p className={styles.helper}>El técnico registra la decisión verbal del cliente sobre el precio ya presentado. Aprobar no marca el trabajo como realizado; sólo lo confirma para ejecución.</p>

      {job.fieldApprovals.map((approval) => {
        const interventionId = approval.affected.find((reference) => reference.type === 'intervention')?.id;
        const intervention = interventionId ? interventionById.get(interventionId) : undefined;
        return (
          <div className={styles.interventionCard} key={approval.id}>
            <div>
              <strong>{decisionLabel(approval)}</strong>
              <span>{intervention?.interventionType || 'Trabajo adicional'} · {approval.receiverName}</span>
              <span>Método: verbal{approval.decidedAt ? ` · ${new Date(approval.decidedAt).toLocaleString('es-AW', { timeZone: 'America/Aruba' })}` : ''}</span>
              {intervention?.priceSnapshot ? <span>Precio decidido: {presentedFieldPriceLabel(intervention.priceSnapshot)}</span> : null}
              {approval.note ? <span>Nota: {approval.note}</span> : null}
            </div>
            <span className={`${styles.badge} ${styles.badgeBrand}`}>{approval.status === 'approved' ? 'Aprobado' : 'Rechazado'}</span>
          </div>
        );
      })}

      {job.additionalApprovalInterventionIds.map((interventionId) => {
        const intervention = interventionById.get(interventionId);
        if (!intervention?.priceSnapshot) return null;
        const scopeChange = intervention.scopeChangeId ? scopeById.get(intervention.scopeChangeId) : undefined;
        const visitAsset = visitAssetById.get(intervention.visitAssetId);
        const equipment = visitAsset ? equipmentById.get(visitAsset.assetId) : undefined;
        const draft = drafts[interventionId] ?? { receiverName: '', note: '' };
        const receiverName = draft.receiverName.trim();
        const canSubmit = receiverName.length >= 2 && !mutationBusy;
        return (
          <div className={styles.interventionForm} key={interventionId}>
            <div style={{ gridColumn: '1 / -1' }}>
              <strong>{visitAsset?.locationLabel || equipment?.locationLabel || 'A/C confirmado'}</strong>
              <div className={styles.helper}>{intervention.interventionType} · <strong>{presentedFieldPriceLabel(intervention.priceSnapshot)}</strong></div>
              {scopeChange ? <div className={styles.helper}>Razón: {scopeChange.reason}</div> : null}
            </div>
            <label>
              <span>Nombre de quien decide</span>
              <input
                className={styles.select}
                disabled={mutationBusy}
                value={draft.receiverName}
                onChange={(event) => setDraft(interventionId, { receiverName: event.target.value })}
                placeholder="Nombre del cliente o representante"
              />
            </label>
            <label>
              <span>Nota opcional</span>
              <input
                className={styles.select}
                disabled={mutationBusy}
                value={draft.note}
                onChange={(event) => setDraft(interventionId, { note: event.target.value })}
                placeholder="Detalle de la decisión verbal"
              />
            </label>
            <div className={styles.actions} style={{ gridColumn: '1 / -1' }}>
              <button
                className={`${styles.action} ${styles.primary}`}
                disabled={!canSubmit}
                type="button"
                onClick={() => onDecide({ interventionId, decision: 'approved', receiverName, note: draft.note })}
              >
                {decidingInterventionId === interventionId ? 'Registrando…' : 'Cliente aprueba'}
              </button>
              <button
                className={styles.action}
                disabled={!canSubmit}
                type="button"
                onClick={() => onDecide({ interventionId, decision: 'rejected', receiverName, note: draft.note })}
              >
                {decidingInterventionId === interventionId ? 'Registrando…' : 'Cliente rechaza'}
              </button>
            </div>
          </div>
        );
      })}

      {!job.canRecordAdditionalApproval && job.fieldVisit ? (
        <p className={styles.helper}>No hay trabajo adicional pendiente de una decisión de cliente para esta visita o la asignación actual no puede registrar esa decisión.</p>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
