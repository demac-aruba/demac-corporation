'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { arubaDateKey, arubaTimeKey, formatArubaDateKey } from '@/lib/aruba-date';
import {
  addFieldReportFinding,
  addFieldReportMeasurement,
  addFieldReportPhotoEvidence,
  addFieldReportVoiceEvidence,
  attachFieldAssetByQr,
  attachExistingFieldAsset,
  createAdditionalFieldIntervention,
  createFieldSaleLine,
  createPlannedFieldIntervention,
  createReturnFieldVisit,
  discardOfflineFieldConflict,
  getFieldJob,
  getOfflineFieldOutboxSummary,
  getFieldSchedule,
  prepareFieldVisit,
  recordAdditionalFieldInterventionDecision,
  decideFieldSaleLine,
  recordFieldCustomerAcknowledgement,
  recordFieldPlannedWorkDisposition,
  registerOnSiteFieldEquipment,
  setFieldReportChecklistItem,
  setFieldReportFreeText,
  submitFieldVisitForOfficeReview,
  syncOfflineFieldOutbox,
  transitionFieldIntervention,
  transitionFieldSaleLine,
  transitionFieldVisit,
  type FieldActiveVisitTransition,
  type FieldAdditionalWorkDecision,
  type FieldExecutionJobDetail,
  type FieldInterventionExecutionTarget,
  type FieldOutboxSummary,
  type FieldScheduleJob,
  type FieldTechnicianScopeChangeOrigin,
  type FieldVisitStatus,
} from '@/lib/field-authority';
import { FIELD_OFFLINE_STATE_EVENT } from '@/lib/field-offline';
import {
  canUseFieldAdminSimulation,
  loadFieldAdminSimulationData,
  resolveFieldAdminSimulationJobs,
  type FieldAdminSimulationData,
  type FieldAdminSimulationTarget,
} from '@/lib/field-admin-simulator';
import {
  FIELD_EXPERIENCE_STAGES,
  fieldExperienceStageForStatus,
  fieldExperienceStepState,
  fieldRouteWithoutNextJob,
  isFieldJobCompleted,
  isFieldJobInProgress,
  selectNextFieldJob,
  type FieldExperienceStage,
} from '@/lib/field-ui-flow';
import {
  uploadFieldEquipmentRegistrationImage,
  uploadFieldReportPhoto,
  uploadFieldReportVoice,
} from '@/lib/field-evidence-upload';
import { AdditionalApprovalControls } from './additional-approval-controls';
import { AdditionalInterventionControls } from './additional-intervention-controls';
import {
  CustomerAcknowledgementControls,
  type CustomerAcknowledgementInput,
} from './customer-acknowledgement-controls';
import {
  EquipmentRegistrationControls,
  type EquipmentRegistrationInput,
} from './equipment-registration-controls';
import {
  FreeTextReportControls,
  type ReportFreeTextInput,
} from './free-text-report-controls';
import {
  InterventionReportControls,
  type ReportChecklistInput,
  type ReportFindingInput,
  type ReportMeasurementInput,
  type ReportPhotoInput,
} from './intervention-report-controls';
import { InterventionExecutionControls } from './intervention-execution-controls';
import {
  PlannedInterventionControls,
  type PlannedWorkMutationInput,
} from './planned-intervention-controls';
import {
  VoiceNoteReportControls,
  type ReportVoiceNoteInput,
} from './voice-note-report-controls';
import { VisitPendingControls, type VisitPendingInput } from './visit-pending-controls';
import { VisitNoAccessControls, type VisitNoAccessInput } from './visit-no-access-controls';
import { VisitCancellationControls, type VisitCancellationInput } from './visit-cancellation-controls';
import { VisitReturnControls, type VisitReturnInput } from './visit-return-controls';
import { VisitReturnCreationControls } from './visit-return-creation-controls';
import { VisitOfficeReviewControls } from './visit-office-review-controls';
import {
  FieldSaleControls,
  type FieldSaleCreateInput,
  type FieldSaleDecisionInput,
  type FieldSaleTransitionInput,
} from './field-sale-controls';
import { FieldHistoryPanel } from './field-history-panel';
import { FieldQrLookup } from './field-qr-lookup';
import { FieldAdminSimulationDetail, FieldAdminSimulationSelector } from './field-admin-simulator';
import { ProfessionalReportPreview } from './professional-report-preview';
import simulationStyles from './field-admin-simulator.module.css';
import styles from './technician-field-home.module.css';

type AdditionalInterventionInput = {
  visitAssetId: string;
  serviceCatalogItemId: string;
  origin: FieldTechnicianScopeChangeOrigin;
  reason: string;
};

type AdditionalApprovalInput = {
  interventionId: string;
  decision: FieldAdditionalWorkDecision;
  receiverName: string;
  note: string;
};

type InterventionExecutionInput = {
  interventionId: string;
  target: FieldInterventionExecutionTarget;
  expectedVersion: number;
  note: string;
};

type ReportMutationRetry = {
  key: string;
  signature: string;
  requestId: string;
};

type VisitTransitionInput = {
  target: FieldActiveVisitTransition;
  pendingReason?: string;
  pendingAction?: string;
  noAccessReason?: string;
  cancellationReason?: string;
  secondVisitReason?: string;
};

const SCHEDULE_REVALIDATE_MS = 60_000;
const ACTIVE_TRANSITION_LABELS: Record<FieldActiveVisitTransition, string> = {
  en_route: 'En camino',
  on_site: 'Llegué',
  in_progress: 'Iniciar trabajo',
  pending: 'Dejar pendiente',
  no_access: 'Sin acceso',
  cancelled: 'Cancelar visita',
  requires_return_visit: 'Requiere retorno',
};

function workSummary(job: Pick<FieldScheduleJob, 'plannedWork' | 'customerFacingDescription'>) {
  if (job.plannedWork.length) {
    return job.plannedWork.map((line) => `${line.quantity} × ${line.label}`).join(' · ');
  }
  return job.customerFacingDescription || 'Trabajo programado';
}

function roleLabel(value: FieldScheduleJob['responsibility']) {
  if (value === 'lead') return 'Líder';
  if (value === 'helper') return 'Ayudante';
  if (value === 'office') return 'Oficina';
  return 'Técnico';
}

function assignmentLabel(value: FieldScheduleJob['assignmentSource']) {
  if (value === 'daily_assignment') return 'Equipo del día';
  if (value === 'regular_crew') return 'Equipo regular';
  if (value === 'direct_staff') return 'Asignación directa';
  if (value === 'profile_van_fallback') return 'Van · solo lectura';
  return 'Oficina';
}

function visitStatusLabel(value?: FieldVisitStatus) {
  if (!value) return 'No iniciada';
  if (value === 'scheduled') return 'Lista para salir';
  if (value === 'en_route') return 'En camino';
  if (value === 'on_site') return 'En el sitio';
  if (value === 'in_progress') return 'En proceso';
  if (value === 'pending') return 'Pendiente';
  if (value === 'requires_return_visit') return 'Requiere segunda visita';
  if (value === 'ready_for_office_review') return 'Lista para revisión';
  if (value === 'completed') return 'Completada';
  if (value === 'no_access') return 'Sin acceso';
  return 'Cancelada';
}

function visitAssetSourceLabel(value: FieldExecutionJobDetail['visitAssets'][number]['source']) {
  if (value === 'existing_asset') return 'Equipo CRM existente';
  if (value === 'registered_on_site') return 'Registrado en sitio';
  if (value === 'qr_scan') return 'Identificado por QR';
  return 'Equipo programado';
}

function clientRequestId(prefix: string, workOrderId: string) {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${workOrderId}-${random}`.slice(0, 240);
}

function reportPhotoSignature(input: ReportPhotoInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.file.name,
    input.file.type,
    input.file.size,
    input.file.lastModified,
    input.caption.trim(),
  ].join('|');
}

function reportMeasurementSignature(input: ReportMeasurementInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.metric.trim(),
    typeof input.value,
    String(input.value),
    input.unit.trim(),
    input.moment,
  ].join('|');
}

function reportFindingSignature(input: ReportFindingInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.summary.trim(),
    input.details.trim(),
    input.recommendation.trim(),
  ].join('|');
}

function reportChecklistSignature(input: ReportChecklistInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.itemId,
    String(input.checked),
    String(input.expectedVersion),
  ].join('|');
}

function reportFreeTextSignature(input: ReportFreeTextInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.value.trim(),
    String(input.expectedVersion),
  ].join('|');
}

function reportVoiceNoteSignature(input: ReportVoiceNoteInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.blob.type,
    String(input.blob.size),
    String(Math.round(input.durationSeconds * 1000)),
  ].join('|');
}

function customerAcknowledgementSignature(input: CustomerAcknowledgementInput) {
  return [
    input.interventionId,
    input.sectionId,
    input.receiverName.trim(),
    input.note.trim(),
  ].join('|');
}

function whatsappDigits(value?: string) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 7 ? `297${digits}` : digits;
}

function callHref(value?: string) {
  const raw = String(value ?? '').trim();
  return raw ? `tel:${raw.replace(/[^+\d]/g, '')}` : '';
}

function whatsappHref(value?: string) {
  const digits = whatsappDigits(value);
  return digits ? `https://wa.me/${digits}` : '';
}

function mapHref(job: Pick<FieldScheduleJob, 'latitude' | 'longitude' | 'address'>) {
  const query = Number.isFinite(job.latitude) && Number.isFinite(job.longitude)
    ? `${job.latitude},${job.longitude}`
    : job.address;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function contactLinks(job: FieldScheduleJob) {
  return {
    call: callHref(job.arrivalPhone),
    whatsapp: whatsappHref(job.arrivalWhatsapp || job.arrivalPhone),
    map: mapHref(job),
  };
}

function JobActions({
  job,
  onOpen,
  simulated = false,
  featured = false,
}: {
  job: FieldScheduleJob;
  onOpen: () => void;
  simulated?: boolean;
  featured?: boolean;
}) {
  const links = contactLinks(job);
  return (
    <div className={`${styles.actions} ${featured ? styles.actionsFeatured : ''}`}>
      {simulated ? <>
        <button className={styles.action} type="button" disabled title="Contacto real deshabilitado durante la simulación">Navegar</button>
        <button className={styles.action} type="button" disabled title="Contacto real deshabilitado durante la simulación">Llamar</button>
      </> : <>
        {links.map ? <a className={styles.action} href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
        {links.call ? <a className={styles.action} href={links.call}>Llamar</a> : null}
      </>}
      <button className={`${styles.action} ${styles.primary}`} type="button" onClick={onOpen}>
        {isFieldJobInProgress(job) ? 'Continuar trabajo' : featured ? 'Abrir próximo trabajo' : 'Ver trabajo'}
      </button>
    </div>
  );
}

function JobCard({
  job,
  onOpen,
  simulated = false,
  featured = false,
}: {
  job: FieldScheduleJob;
  onOpen: () => void;
  simulated?: boolean;
  featured?: boolean;
}) {
  return (
    <article className={`${styles.jobCard} ${featured ? styles.jobFeatured : ''}`}>
      <div className={styles.time}>{job.time || '—'}<small>{job.endTime ? `hasta ${job.endTime}` : job.status}</small></div>
      <div className={styles.jobMain}>
        <strong>{job.customerName}</strong>
        <div className={styles.address}>{job.propertyName ? `${job.propertyName} · ` : ''}{job.address || 'Dirección no disponible'}</div>
        <div className={styles.work}>{workSummary(job)}</div>
        <div className={styles.badges}>
          <span className={`${styles.badge} ${styles.badgeBrand}`}>{simulated ? 'Vista simulada' : `Campo: ${visitStatusLabel(job.fieldVisit?.status)}`}</span>
          <span className={styles.badge}>{job.vanId || 'Sin van'}</span>
          <span className={styles.badge}>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C estimado` : 'Cantidad por confirmar'}</span>
        </div>
      </div>
      <JobActions job={job} onOpen={onOpen} simulated={simulated} featured={featured} />
    </article>
  );
}

function OfflineStatus({ capturedAt, summary, syncing, onSync, onDiscard }: {
  capturedAt: string | null;
  summary: FieldOutboxSummary;
  syncing: boolean;
  onSync: () => void;
  onDiscard: (id: string) => void;
}) {
  if (!capturedAt && summary.total === 0) return null;
  return (
    <section className={summary.blocked ? styles.mutationError : styles.section} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }} aria-live="polite">
      <div>
        <strong style={{ display: 'block', fontSize: 12 }}>{capturedAt ? 'Vista sin conexión · no es estado canónico actual' : 'Sincronización de campo pendiente'}</strong>
        <span className={styles.helper} style={{ display: 'block', marginTop: 4 }}>
          {capturedAt ? `Copia capturada ${new Date(capturedAt).toLocaleString('es-AW', { timeZone: 'America/Aruba' })}. ` : ''}
          {summary.pending ? `${summary.pending} operación(es) esperan confirmación del servidor. ` : ''}
          {summary.blocked ? `${summary.blocked} operación(es) tienen conflicto y requieren revisión.` : ''}
        </span>
        {summary.conflicts.map((conflict) => (
          <div key={conflict.id} style={{ marginTop: 8 }}>
            <span className={styles.helper} style={{ display: 'block', margin: 0 }}>{conflict.action}: {conflict.message}</span>
            <button className={styles.action} style={{ marginTop: 6 }} type="button" onClick={() => onDiscard(conflict.id)}>Descartar conflicto local</button>
          </div>
        ))}
      </div>
      {summary.pending ? <button className={styles.action} disabled={syncing} type="button" onClick={onSync}>{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</button> : null}
    </section>
  );
}

function LegacyDetailView({
  job,
  loading,
  error,
  transitionError,
  assetError,
  equipmentRegistrationError,
  interventionError,
  additionalInterventionError,
  approvalError,
  executionError,
  reportError,
  freeTextError,
  voiceNoteError,
  customerAcknowledgementError,
  officeReviewError,
  fieldSaleError,
  officeReviewCorrectionNote,
  transitioning,
  creatingReturnVisit,
  attachingAssetId,
  registeringEquipment,
  creatingInterventionVisitAssetId,
  creatingAdditionalInterventionVisitAssetId,
  decidingApprovalInterventionId,
  transitioningInterventionId,
  uploadingReportPhotoKey,
  savingReportMeasurementKey,
  savingReportFindingKey,
  savingChecklistKey,
  savingFreeTextKey,
  savingVoiceNoteKey,
  savingCustomerAcknowledgementKey,
  submittingOfficeReview,
  savingFieldSaleLineId,
  offlineCapturedAt,
  outboxSummary,
  syncingOutbox,
  draftOwnerUserId,
  onTransition,
  onCreateReturnVisit,
  onAttachAsset,
  onAttachAssetByQr,
  onRegisterEquipment,
  onCreatePlannedIntervention,
  onCreateAdditionalIntervention,
  onRecordAdditionalDecision,
  onTransitionIntervention,
  onAddReportPhoto,
  onAddReportMeasurement,
  onAddReportFinding,
  onSetChecklistItem,
  onSaveFreeText,
  onSaveVoiceNote,
  onRecordCustomerAcknowledgement,
  onCreateFieldSaleLine,
  onDecideFieldSaleLine,
  onTransitionFieldSaleLine,
  onOfficeReviewCorrectionNoteChange,
  onSubmitOfficeReview,
  onSyncOutbox,
  onDiscardOutboxConflict,
  onBack,
}: {
  job: FieldExecutionJobDetail | null;
  loading: boolean;
  error: string | null;
  transitionError: string | null;
  assetError: string | null;
  equipmentRegistrationError: string | null;
  interventionError: string | null;
  additionalInterventionError: string | null;
  approvalError: string | null;
  executionError: string | null;
  reportError: string | null;
  freeTextError: string | null;
  voiceNoteError: string | null;
  customerAcknowledgementError: string | null;
  officeReviewError: string | null;
  fieldSaleError: string | null;
  officeReviewCorrectionNote: string;
  transitioning: FieldActiveVisitTransition | null;
  creatingReturnVisit: boolean;
  attachingAssetId: string | null;
  registeringEquipment: boolean;
  creatingInterventionVisitAssetId: string | null;
  creatingAdditionalInterventionVisitAssetId: string | null;
  decidingApprovalInterventionId: string | null;
  transitioningInterventionId: string | null;
  uploadingReportPhotoKey: string | null;
  savingReportMeasurementKey: string | null;
  savingReportFindingKey: string | null;
  savingChecklistKey: string | null;
  savingFreeTextKey: string | null;
  savingVoiceNoteKey: string | null;
  savingCustomerAcknowledgementKey: string | null;
  submittingOfficeReview: boolean;
  savingFieldSaleLineId: string | null;
  offlineCapturedAt: string | null;
  outboxSummary: FieldOutboxSummary;
  syncingOutbox: boolean;
  draftOwnerUserId: string;
  onTransition: (input: VisitTransitionInput) => void;
  onCreateReturnVisit: () => void;
  onAttachAsset: (assetId: string) => void;
  onAttachAssetByQr: (assetId: string, qrCode: string) => Promise<boolean>;
  onRegisterEquipment: (input: EquipmentRegistrationInput) => Promise<boolean>;
  onCreatePlannedIntervention: (input: PlannedWorkMutationInput) => void;
  onCreateAdditionalIntervention: (input: AdditionalInterventionInput) => void;
  onRecordAdditionalDecision: (input: AdditionalApprovalInput) => void;
  onTransitionIntervention: (input: InterventionExecutionInput) => void;
  onAddReportPhoto: (input: ReportPhotoInput) => Promise<boolean>;
  onAddReportMeasurement: (input: ReportMeasurementInput) => Promise<boolean>;
  onAddReportFinding: (input: ReportFindingInput) => Promise<boolean>;
  onSetChecklistItem: (input: ReportChecklistInput) => Promise<boolean>;
  onSaveFreeText: (input: ReportFreeTextInput) => Promise<boolean>;
  onSaveVoiceNote: (input: ReportVoiceNoteInput) => Promise<boolean>;
  onRecordCustomerAcknowledgement: (input: CustomerAcknowledgementInput) => Promise<boolean>;
  onCreateFieldSaleLine: (input: FieldSaleCreateInput) => Promise<boolean>;
  onDecideFieldSaleLine: (input: FieldSaleDecisionInput) => Promise<boolean>;
  onTransitionFieldSaleLine: (input: FieldSaleTransitionInput) => Promise<boolean>;
  onOfficeReviewCorrectionNoteChange: (value: string) => void;
  onSubmitOfficeReview: () => void;
  onSyncOutbox: () => void;
  onDiscardOutboxConflict: (id: string) => void;
  onBack: () => void;
}) {
  if (loading || error || !job) {
    return (
      <div className={styles.shell}>
        <div className={styles.detailHeader}>
          <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
          <div className={styles.detailTitle}>
            <h1>Detalle del trabajo</h1>
            <p>{loading ? 'Cargando…' : 'No disponible'}</p>
          </div>
        </div>
        <section className={styles.panel}>
          <div className={error ? styles.error : styles.loading}>
            {loading ? 'Cargando información del trabajo…' : error || 'No se pudo abrir este trabajo.'}
          </div>
        </section>
      </div>
    );
  }

  const links = contactLinks(job);
  const availableTransitions: FieldActiveVisitTransition[] = job.fieldVisit
    ? job.fieldVisit.availableTransitions
    : job.canPrepareVisit
      ? ['en_route', 'no_access', 'cancelled']
      : [];
  const attachedAssetIds = new Set(job.visitAssets.map((visitAsset) => visitAsset.assetId));
  const knownEquipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const mutationBusy = transitioning !== null
    || creatingReturnVisit
    || attachingAssetId !== null
    || registeringEquipment
    || creatingInterventionVisitAssetId !== null
    || creatingAdditionalInterventionVisitAssetId !== null
    || decidingApprovalInterventionId !== null
    || transitioningInterventionId !== null
    || uploadingReportPhotoKey !== null
    || savingReportMeasurementKey !== null
    || savingReportFindingKey !== null
    || savingChecklistKey !== null
    || savingFreeTextKey !== null
    || savingVoiceNoteKey !== null
    || savingCustomerAcknowledgementKey !== null
    || savingFieldSaleLineId !== null
    || submittingOfficeReview
    || offlineCapturedAt !== null;

  return (
    <div className={styles.shell}>
      <div className={styles.detailHeader}>
        <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
        <div className={styles.detailTitle}>
          <h1>{job.customerName}</h1>
          <p>{job.time || 'Sin hora'} · Campo: {visitStatusLabel(job.fieldVisit?.status)} · {job.workOrderId}</p>
        </div>
      </div>

      <OfflineStatus capturedAt={offlineCapturedAt} summary={outboxSummary} syncing={syncingOutbox} onSync={onSyncOutbox} onDiscard={onDiscardOutboxConflict} />

      <section className={styles.section}>
        <h2>ESTADO DE LA VISITA</h2>
        <div className={styles.infoGrid}>
          <div className={styles.info}><span>Programación / Work Order</span><strong>{job.status}</strong></div>
          <div className={styles.info}><span>Estado físico en campo</span><strong>{visitStatusLabel(job.fieldVisit?.status)}</strong></div>
          {job.fieldVisit?.departedAt ? <div className={styles.info}><span>Salida registrada</span><strong>{new Date(job.fieldVisit.departedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
          {job.fieldVisit?.arrivedAt ? <div className={styles.info}><span>Llegada registrada</span><strong>{new Date(job.fieldVisit.arrivedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
          {job.fieldVisit?.startedAt ? <div className={styles.info}><span>Trabajo iniciado</span><strong>{new Date(job.fieldVisit.startedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
        </div>
        {availableTransitions.length ? (
          <div className={styles.visitActions}>
            {availableTransitions.filter((target) => target !== 'pending' && target !== 'requires_return_visit' && target !== 'no_access' && target !== 'cancelled').map((target) => (
              <button
                className={`${styles.action} ${styles.primary}`}
                disabled={mutationBusy}
                key={target}
                onClick={() => onTransition({ target })}
                type="button"
              >
                {transitioning === target
                  ? 'Procesando…'
                  : target === 'in_progress' && job.fieldVisit?.status === 'pending'
                    ? 'Reanudar trabajo'
                    : ACTIVE_TRANSITION_LABELS[target]}
              </button>
            ))}
          </div>
        ) : <p className={styles.helper}>No hay otra transición activa disponible para esta visita en este slice.</p>}
        {availableTransitions.includes('pending') ? (
          <VisitPendingControls
            disabled={mutationBusy}
            onSubmit={(input: VisitPendingInput) => onTransition(input)}
            saving={transitioning === 'pending'}
          />
        ) : null}
        {availableTransitions.includes('no_access') ? (
          <VisitNoAccessControls
            disabled={mutationBusy}
            onSubmit={(input: VisitNoAccessInput) => onTransition(input)}
            saving={transitioning === 'no_access'}
          />
        ) : null}
        {availableTransitions.includes('cancelled') ? (
          <VisitCancellationControls
            disabled={mutationBusy}
            onSubmit={(input: VisitCancellationInput) => onTransition(input)}
            saving={transitioning === 'cancelled'}
          />
        ) : null}
        {availableTransitions.includes('requires_return_visit') ? (
          <VisitReturnControls
            disabled={mutationBusy}
            onSubmit={(input: VisitReturnInput) => onTransition(input)}
            saving={transitioning === 'requires_return_visit'}
          />
        ) : null}
        {job.canCreateReturnVisit ? (
          <VisitReturnCreationControls
            disabled={mutationBusy}
            onCreate={onCreateReturnVisit}
            saving={creatingReturnVisit}
          />
        ) : null}
        {job.fieldVisit?.pendingReason ? (
          <div className={styles.planned} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>Último motivo pendiente</div>
            <strong>{job.fieldVisit.pendingReason}</strong>
            {job.fieldVisit.pendingAction ? <p>Próxima acción: {job.fieldVisit.pendingAction}</p> : null}
          </div>
        ) : null}
        {job.fieldVisit?.noAccessReason ? (
          <div className={styles.planned} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>Motivo de falta de acceso</div>
            <strong>{job.fieldVisit.noAccessReason}</strong>
          </div>
        ) : null}
        {job.fieldVisit?.cancellationReason ? (
          <div className={styles.planned} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>Motivo de cancelación de la visita</div>
            <strong>{job.fieldVisit.cancellationReason}</strong>
          </div>
        ) : null}
        {job.fieldVisit?.secondVisitReason ? (
          <div className={styles.planned} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>Motivo de segunda visita</div>
            <strong>{job.fieldVisit.secondVisitReason}</strong>
          </div>
        ) : null}
        {transitionError ? <div className={styles.mutationError}>{transitionError}</div> : null}
      </section>

      <VisitOfficeReviewControls
        correctionNote={officeReviewCorrectionNote}
        disabled={mutationBusy}
        error={officeReviewError}
        job={job}
        onCorrectionNoteChange={onOfficeReviewCorrectionNoteChange}
        onSubmit={onSubmitOfficeReview}
        saving={submittingOfficeReview}
      />

      <div className={styles.detailGrid}>
        <div>
          <section className={styles.section}>
            <h2>PROGRAMADO POR LA OFICINA</h2>
            <div className={styles.planned}>
              <div className={styles.plannedTitle}>Alcance planificado · no se modifica en campo</div>
              {job.plannedWork.length ? job.plannedWork.map((line) => (
                <div className={styles.plannedItem} key={line.id}><span>{line.label}</span><strong>{line.quantity}×</strong></div>
              )) : <p className={styles.helper}>No hay líneas programadas estructuradas. Revisa la descripción del cliente.</p>}
            </div>
            <div className={styles.infoGrid} style={{ marginTop: 12 }}>
              <div className={styles.info}><span>Cantidad estimada</span><strong>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C` : 'Por confirmar en sitio'}</strong></div>
              <div className={styles.info}><span>Asignación</span><strong>{roleLabel(job.responsibility)} · {assignmentLabel(job.assignmentSource)}</strong></div>
            </div>
            {job.plannedWorkProgress.length ? (
              <div className={styles.infoGrid} style={{ marginTop: 12 }}>
                {job.plannedWorkProgress.map((progress) => (
                  <div className={styles.info} key={progress.id}>
                    <span>{job.plannedWork.find((line) => line.id === progress.id)?.label || progress.id}</span>
                    <strong>{progress.linkedActualQuantity} vinculada(s) · {progress.disposedQuantity} no realizada(s) reconciliada(s) · {progress.remainingQuantity} restante(s) de {progress.plannedQuantity}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {job.customerFacingDescription ? <p className={styles.helper}>{job.customerFacingDescription}</p> : null}
          </section>

          <section className={styles.section}>
            <h2>CONFIRMADO EN SITIO</h2>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Programado</span><strong>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C` : 'Cantidad desconocida'}</strong></div>
              <div className={styles.info}><span>Confirmado físicamente</span><strong>{job.visitAssets.length} A/C</strong></div>
            </div>
            {job.visitAssets.length ? job.visitAssets.map((visitAsset) => {
              const equipment = knownEquipmentById.get(visitAsset.assetId);
              return (
                <div className={styles.equipment} key={visitAsset.id}>
                  <div>
                    <strong>{visitAsset.locationLabel || equipment?.locationLabel || `A/C ${visitAsset.sequence}`}</strong>
                    <span>{[equipment?.brand, equipment?.model, equipment?.systemType].filter(Boolean).join(' · ') || 'Equipo confirmado para esta visita'}</span>
                    <span>{equipment?.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'} · {visitAssetSourceLabel(visitAsset.source)}</span>
                  </div>
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${styles.badgeBrand}`}>Confirmado #{visitAsset.sequence}</span>
                  </div>
                </div>
              );
            }) : <p className={styles.helper}>Todavía no hay A/C confirmados físicamente para esta visita. La cantidad programada permanece intacta.</p>}
            <EquipmentRegistrationControls
              job={job}
              mutationBusy={mutationBusy}
              registering={registeringEquipment}
              error={equipmentRegistrationError}
              onRegister={onRegisterEquipment}
            />
            <PlannedInterventionControls
              job={job}
              mutationBusy={mutationBusy}
              creatingVisitAssetId={creatingInterventionVisitAssetId}
              error={interventionError}
              onCreate={onCreatePlannedIntervention}
            />
            <AdditionalInterventionControls
              job={job}
              mutationBusy={mutationBusy}
              creatingVisitAssetId={creatingAdditionalInterventionVisitAssetId}
              error={additionalInterventionError}
              onCreate={onCreateAdditionalIntervention}
            />
            <AdditionalApprovalControls
              job={job}
              mutationBusy={mutationBusy}
              decidingInterventionId={decidingApprovalInterventionId}
              error={approvalError}
              onDecide={onRecordAdditionalDecision}
            />
            <FieldSaleControls
              busy={mutationBusy}
              error={fieldSaleError}
              job={job}
              onCreate={onCreateFieldSaleLine}
              onDecide={onDecideFieldSaleLine}
              onTransition={onTransitionFieldSaleLine}
            />
            <FieldHistoryPanel job={job} />
            <InterventionExecutionControls
              job={job}
              mutationBusy={mutationBusy}
              transitioningInterventionId={transitioningInterventionId}
              error={executionError}
              onTransition={onTransitionIntervention}
            />
            <InterventionReportControls
              job={job}
              mutationBusy={mutationBusy}
              uploadingPhotoKey={uploadingReportPhotoKey}
              savingMeasurementKey={savingReportMeasurementKey}
              savingFindingKey={savingReportFindingKey}
              savingChecklistKey={savingChecklistKey}
              error={reportError}
              onAddPhoto={onAddReportPhoto}
              onAddMeasurement={onAddReportMeasurement}
              onAddFinding={onAddReportFinding}
              onSetChecklistItem={onSetChecklistItem}
            />
            <FreeTextReportControls
              job={job}
              draftOwnerUserId={draftOwnerUserId}
              allowDraftWhileOffline={offlineCapturedAt !== null}
              mutationBusy={mutationBusy}
              savingKey={savingFreeTextKey}
              error={freeTextError}
              onSave={onSaveFreeText}
            />
            <VoiceNoteReportControls
              job={job}
              mutationBusy={mutationBusy}
              savingKey={savingVoiceNoteKey}
              error={voiceNoteError}
              onSave={onSaveVoiceNote}
            />
            <CustomerAcknowledgementControls
              job={job}
              mutationBusy={mutationBusy}
              savingKey={savingCustomerAcknowledgementKey}
              error={customerAcknowledgementError}
              onRecord={onRecordCustomerAcknowledgement}
            />
            {assetError ? <div className={styles.mutationError}>{assetError}</div> : null}
          </section>

          <section className={styles.section}>
            <h2>EQUIPOS CONOCIDOS EN ESTA PROPIEDAD</h2>
            <FieldQrLookup
              attachingAssetId={attachingAssetId}
              busy={mutationBusy}
              canAttach={job.canAddExistingAsset}
              equipment={job.knownEquipment}
              onAttach={onAttachAssetByQr}
              visitAssets={job.visitAssets}
            />
            {job.knownEquipment.length ? job.knownEquipment.map((equipment) => {
              const attached = attachedAssetIds.has(equipment.id);
              return (
                <div className={styles.equipment} key={equipment.id}>
                  <div>
                    <strong>{equipment.locationLabel || 'Ubicación no registrada'}</strong>
                    <span>{[equipment.brand, equipment.model, equipment.systemType].filter(Boolean).join(' · ') || 'Información técnica incompleta'}</span>
                    <span>{equipment.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'}{equipment.refrigerant ? ` · ${equipment.refrigerant}` : ''}{equipment.voltage ? ` · ${equipment.voltage}` : ''}</span>
                  </div>
                  <div className={styles.actions}>
                    <span className={styles.badge}>{equipment.qrCode || 'Sin QR'}</span>
                    {attached ? <span className={`${styles.badge} ${styles.badgeBrand}`}>Incluido en visita</span> : null}
                    {!attached && !equipment.active ? <span className={styles.badge}>Equipo inactivo</span> : null}
                    {!attached && equipment.active && job.canAddExistingAsset ? (
                      <button
                        className={`${styles.action} ${styles.primary}`}
                        disabled={mutationBusy}
                        onClick={() => onAttachAsset(equipment.id)}
                        type="button"
                      >
                        {attachingAssetId === equipment.id ? 'Agregando…' : 'Agregar a esta visita'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }) : <div className={styles.empty}>No hay equipos registrados todavía. El alcance real se confirmará en sitio.</div>}
            {!job.canAddExistingAsset && job.fieldVisit ? <p className={styles.helper}>La disponibilidad para agregar equipos es calculada por Field Authority según el estado y la asignación actual.</p> : null}
          </section>
        </div>

        <aside>
          <section className={styles.section}>
            <h2>CLIENTE Y UBICACIÓN</h2>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Propiedad</span><strong>{job.propertyName || 'Sin nombre'}</strong></div>
              <div className={styles.info}><span>Van</span><strong>{job.vanId || 'Sin van'}</strong></div>
              <div className={styles.info} style={{ gridColumn: '1 / -1' }}><span>Dirección</span><strong>{job.address || 'No disponible'}</strong></div>
            </div>
            <div className={styles.contactActions}>
              {links.map ? <a href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
              {links.call ? <a href={links.call}>Llamar</a> : null}
              {links.whatsapp ? <a href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          </section>

          <section className={styles.section}>
            <h2>INSTRUCCIONES</h2>
            <div className={styles.info}><span>Acceso</span><strong>{job.accessInstructions || 'Sin instrucciones especiales'}</strong></div>
            <div className={styles.info} style={{ marginTop: 10 }}><span>Nota para técnico</span><strong>{job.technicianInstructions || 'Sin instrucciones adicionales'}</strong></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

type DetailViewProps = Parameters<typeof LegacyDetailView>[0];

function DetailView({
  job,
  loading,
  error,
  transitionError,
  assetError,
  equipmentRegistrationError,
  interventionError,
  additionalInterventionError,
  approvalError,
  executionError,
  reportError,
  freeTextError,
  voiceNoteError,
  customerAcknowledgementError,
  officeReviewError,
  fieldSaleError,
  officeReviewCorrectionNote,
  transitioning,
  creatingReturnVisit,
  attachingAssetId,
  registeringEquipment,
  creatingInterventionVisitAssetId,
  creatingAdditionalInterventionVisitAssetId,
  decidingApprovalInterventionId,
  transitioningInterventionId,
  uploadingReportPhotoKey,
  savingReportMeasurementKey,
  savingReportFindingKey,
  savingChecklistKey,
  savingFreeTextKey,
  savingVoiceNoteKey,
  savingCustomerAcknowledgementKey,
  submittingOfficeReview,
  savingFieldSaleLineId,
  offlineCapturedAt,
  outboxSummary,
  syncingOutbox,
  draftOwnerUserId,
  onTransition,
  onCreateReturnVisit,
  onAttachAsset,
  onAttachAssetByQr,
  onRegisterEquipment,
  onCreatePlannedIntervention,
  onCreateAdditionalIntervention,
  onRecordAdditionalDecision,
  onTransitionIntervention,
  onAddReportPhoto,
  onAddReportMeasurement,
  onAddReportFinding,
  onSetChecklistItem,
  onSaveFreeText,
  onSaveVoiceNote,
  onRecordCustomerAcknowledgement,
  onCreateFieldSaleLine,
  onDecideFieldSaleLine,
  onTransitionFieldSaleLine,
  onOfficeReviewCorrectionNoteChange,
  onSubmitOfficeReview,
  onSyncOutbox,
  onDiscardOutboxConflict,
  onBack,
}: DetailViewProps) {
  const canonicalStage = fieldExperienceStageForStatus(job?.fieldVisit?.status);
  const [activeStage, setActiveStage] = useState<FieldExperienceStage>(canonicalStage);

  useEffect(() => {
    setActiveStage(canonicalStage);
  }, [canonicalStage, job?.workOrderId]);

  if (loading || error || !job) {
    return (
      <div className={styles.technicianApp}>
        <header className={styles.mobileHeader}>
          <button className={styles.headerBack} type="button" onClick={onBack} aria-label="Volver a Mi día">←</button>
          <div><span>DEMAC ERP Next</span><strong>Trabajo activo</strong></div>
        </header>
        <main className={styles.mobileContent}>
          <section className={styles.panel}>
            <div className={error ? styles.error : styles.loading}>
              {loading ? 'Cargando información del trabajo…' : error || 'No se pudo abrir este trabajo.'}
            </div>
          </section>
        </main>
      </div>
    );
  }

  const links = contactLinks(job);
  const availableTransitions: FieldActiveVisitTransition[] = job.fieldVisit
    ? job.fieldVisit.availableTransitions
    : job.canPrepareVisit
      ? ['en_route', 'no_access', 'cancelled']
      : [];
  const primaryTransition = availableTransitions.find((target) => (
    target === 'en_route' || target === 'on_site' || target === 'in_progress'
  )) ?? null;
  const attachedAssetIds = new Set(job.visitAssets.map((visitAsset) => visitAsset.assetId));
  const knownEquipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const mutationBusy = transitioning !== null
    || creatingReturnVisit
    || attachingAssetId !== null
    || registeringEquipment
    || creatingInterventionVisitAssetId !== null
    || creatingAdditionalInterventionVisitAssetId !== null
    || decidingApprovalInterventionId !== null
    || transitioningInterventionId !== null
    || uploadingReportPhotoKey !== null
    || savingReportMeasurementKey !== null
    || savingReportFindingKey !== null
    || savingChecklistKey !== null
    || savingFreeTextKey !== null
    || savingVoiceNoteKey !== null
    || savingCustomerAcknowledgementKey !== null
    || savingFieldSaleLineId !== null
    || submittingOfficeReview
    || offlineCapturedAt !== null;
  const primaryTransitionLabel = primaryTransition === 'en_route'
    ? 'Iniciar ruta'
    : primaryTransition === 'on_site'
      ? 'Confirmar llegada'
      : primaryTransition === 'in_progress' && job.fieldVisit?.status === 'pending'
        ? 'Reanudar servicio'
        : primaryTransition === 'in_progress'
          ? 'Iniciar servicio'
          : '';

  return (
    <div className={styles.technicianApp} data-field-experience-stage={activeStage}>
      <header className={styles.mobileHeader}>
        <button className={styles.headerBack} type="button" onClick={onBack} aria-label="Volver a Mi día">←</button>
        <div><span>DEMAC ERP Next</span><strong>Trabajo activo</strong></div>
        <span className={styles.headerStatus}>{visitStatusLabel(job.fieldVisit?.status)}</span>
      </header>

      <main className={styles.mobileContent}>
        <section className={styles.jobHero}>
          <div className={styles.heroTopline}>
            <span>{job.time || 'Hora pendiente'}{job.endTime ? ` – ${job.endTime}` : ''}</span>
            <span>{job.vanId || 'Sin Van'}</span>
          </div>
          <h1>{job.customerName}</h1>
          <p>{job.propertyName || job.address || 'Ubicación pendiente'}</p>
          <div className={styles.heroWork}>{workSummary(job)}</div>
          <div className={styles.quickActions}>
            {links.call ? <a href={links.call}>Llamar</a> : null}
            {links.whatsapp ? <a href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            {links.map ? <a href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
          </div>
        </section>

        <nav className={styles.flowStepper} aria-label="Pasos del trabajo">
          {FIELD_EXPERIENCE_STAGES.map((step, index) => {
            const state = fieldExperienceStepState(step.id, activeStage);
            return (
              <button
                className={state === 'current' ? styles.flowStepCurrent : state === 'complete' ? styles.flowStepComplete : styles.flowStep}
                key={step.id}
                type="button"
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => setActiveStage(step.id)}
              >
                <b>{state === 'complete' ? '✓' : index + 1}</b>
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>

        <OfflineStatus capturedAt={offlineCapturedAt} summary={outboxSummary} syncing={syncingOutbox} onSync={onSyncOutbox} onDiscard={onDiscardOutboxConflict} />

        <div className={styles.stagePanel} hidden={activeStage !== 'arrival'}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div><span>Paso 1</span><h2>Llegada al cliente</h2></div>
              <span className={styles.syncBadge}>{offlineCapturedAt ? 'Guardado local' : 'Sincronizado'}</span>
            </div>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Estado</span><strong>{visitStatusLabel(job.fieldVisit?.status)}</strong></div>
              <div className={styles.info}><span>Orden</span><strong>{job.workOrderId}</strong></div>
              <div className={styles.info}><span>Dirección</span><strong>{job.address || 'No disponible'}</strong></div>
              <div className={styles.info}><span>Acceso</span><strong>{job.accessInstructions || 'Sin instrucciones especiales'}</strong></div>
            </div>
            <div className={styles.planned}>
              <div className={styles.plannedTitle}>Alcance programado</div>
              {job.plannedWork.length ? job.plannedWork.map((line) => (
                <div className={styles.plannedItem} key={line.id}><span>{line.label}</span><strong>{line.quantity}×</strong></div>
              )) : <p className={styles.helper}>{job.customerFacingDescription || 'Trabajo programado'}</p>}
            </div>
            {job.technicianInstructions ? <div className={styles.siteNote}><strong>Nota de oficina</strong><span>{job.technicianInstructions}</span></div> : null}
          </section>

          <details className={styles.moreOptions}>
            <summary>Más opciones de llegada</summary>
            {availableTransitions.includes('no_access') ? (
              <VisitNoAccessControls disabled={mutationBusy} onSubmit={(input: VisitNoAccessInput) => onTransition(input)} saving={transitioning === 'no_access'} />
            ) : null}
            {availableTransitions.includes('cancelled') ? (
              <VisitCancellationControls disabled={mutationBusy} onSubmit={(input: VisitCancellationInput) => onTransition(input)} saving={transitioning === 'cancelled'} />
            ) : null}
          </details>
          {transitionError ? <div className={styles.mutationError}>{transitionError}</div> : null}
        </div>

        <div className={styles.stagePanel} hidden={activeStage !== 'service'}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div><span>Paso 2</span><h2>Registrar servicio</h2></div>
              <span className={styles.syncBadge}>{job.visitAssets.length} equipo{job.visitAssets.length === 1 ? '' : 's'}</span>
            </div>
            {job.visitAssets.length ? job.visitAssets.map((visitAsset) => {
              const equipment = knownEquipmentById.get(visitAsset.assetId);
              return (
                <div className={styles.equipment} key={visitAsset.id}>
                  <div>
                    <strong>{visitAsset.locationLabel || equipment?.locationLabel || `A/C ${visitAsset.sequence}`}</strong>
                    <span>{[equipment?.brand, equipment?.model, equipment?.systemType].filter(Boolean).join(' · ') || 'Equipo confirmado'}</span>
                    <span>{equipment?.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'} · {visitAssetSourceLabel(visitAsset.source)}</span>
                  </div>
                  <span className={`${styles.badge} ${styles.badgeBrand}`}>#{visitAsset.sequence}</span>
                </div>
              );
            }) : <p className={styles.helper}>Confirma el primer equipo para comenzar el registro.</p>}
          </section>

          <details className={styles.workflowDisclosure} open>
            <summary><b>1</b><span>Equipos atendidos<small>Escanea, selecciona o registra el A/C</small></span></summary>
            <div className={styles.disclosureBody}>
              <FieldQrLookup attachingAssetId={attachingAssetId} busy={mutationBusy} canAttach={job.canAddExistingAsset} equipment={job.knownEquipment} onAttach={onAttachAssetByQr} visitAssets={job.visitAssets} />
              {job.knownEquipment.map((equipment) => {
                const attached = attachedAssetIds.has(equipment.id);
                return (
                  <div className={styles.equipment} key={equipment.id}>
                    <div><strong>{equipment.locationLabel || 'Ubicación no registrada'}</strong><span>{[equipment.brand, equipment.model, equipment.systemType].filter(Boolean).join(' · ') || 'Información técnica incompleta'}</span></div>
                    {!attached && equipment.active && job.canAddExistingAsset ? <button className={styles.action} disabled={mutationBusy} onClick={() => onAttachAsset(equipment.id)} type="button">{attachingAssetId === equipment.id ? 'Agregando…' : 'Agregar'}</button> : <span className={styles.badge}>{attached ? 'Incluido' : 'Solo lectura'}</span>}
                  </div>
                );
              })}
              <EquipmentRegistrationControls job={job} mutationBusy={mutationBusy} registering={registeringEquipment} error={equipmentRegistrationError} onRegister={onRegisterEquipment} />
              {assetError ? <div className={styles.mutationError}>{assetError}</div> : null}
            </div>
          </details>

          <details className={styles.workflowDisclosure}>
            <summary><b>2</b><span>Trabajo y materiales<small>Planificado, adicional y add-ons</small></span></summary>
            <div className={styles.disclosureBody}>
              <PlannedInterventionControls job={job} mutationBusy={mutationBusy} creatingVisitAssetId={creatingInterventionVisitAssetId} error={interventionError} onCreate={onCreatePlannedIntervention} />
              <AdditionalInterventionControls job={job} mutationBusy={mutationBusy} creatingVisitAssetId={creatingAdditionalInterventionVisitAssetId} error={additionalInterventionError} onCreate={onCreateAdditionalIntervention} />
              <AdditionalApprovalControls job={job} mutationBusy={mutationBusy} decidingInterventionId={decidingApprovalInterventionId} error={approvalError} onDecide={onRecordAdditionalDecision} />
              <FieldSaleControls busy={mutationBusy} error={fieldSaleError} job={job} onCreate={onCreateFieldSaleLine} onDecide={onDecideFieldSaleLine} onTransition={onTransitionFieldSaleLine} />
            </div>
          </details>

          <details className={styles.workflowDisclosure}>
            <summary><b>3</b><span>Evidencia y reporte<small>Checklist, fotos, mediciones, notas y voz</small></span></summary>
            <div className={styles.disclosureBody}>
              <InterventionExecutionControls job={job} mutationBusy={mutationBusy} transitioningInterventionId={transitioningInterventionId} error={executionError} onTransition={onTransitionIntervention} />
              <InterventionReportControls job={job} mutationBusy={mutationBusy} uploadingPhotoKey={uploadingReportPhotoKey} savingMeasurementKey={savingReportMeasurementKey} savingFindingKey={savingReportFindingKey} savingChecklistKey={savingChecklistKey} error={reportError} onAddPhoto={onAddReportPhoto} onAddMeasurement={onAddReportMeasurement} onAddFinding={onAddReportFinding} onSetChecklistItem={onSetChecklistItem} />
              <FreeTextReportControls job={job} draftOwnerUserId={draftOwnerUserId} allowDraftWhileOffline={offlineCapturedAt !== null} mutationBusy={mutationBusy} savingKey={savingFreeTextKey} error={freeTextError} onSave={onSaveFreeText} />
              <VoiceNoteReportControls job={job} mutationBusy={mutationBusy} savingKey={savingVoiceNoteKey} error={voiceNoteError} onSave={onSaveVoiceNote} />
            </div>
          </details>

          <details className={styles.workflowDisclosure}>
            <summary><b>4</b><span>Historial<small>Contexto previo del equipo y la visita</small></span></summary>
            <div className={styles.disclosureBody}><FieldHistoryPanel job={job} /></div>
          </details>

          <details className={styles.moreOptions}>
            <summary>Pendiente, pieza o segunda visita</summary>
            {availableTransitions.includes('pending') ? <VisitPendingControls disabled={mutationBusy} onSubmit={(input: VisitPendingInput) => onTransition(input)} saving={transitioning === 'pending'} /> : null}
            {availableTransitions.includes('requires_return_visit') ? <VisitReturnControls disabled={mutationBusy} onSubmit={(input: VisitReturnInput) => onTransition(input)} saving={transitioning === 'requires_return_visit'} /> : null}
            {job.canCreateReturnVisit ? <VisitReturnCreationControls disabled={mutationBusy} onCreate={onCreateReturnVisit} saving={creatingReturnVisit} /> : null}
          </details>
          {transitionError ? <div className={styles.mutationError}>{transitionError}</div> : null}
        </div>

        <div className={styles.stagePanel} hidden={activeStage !== 'close'}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div><span>Paso 3</span><h2>Revisar y cerrar</h2></div>
              <span className={styles.syncBadge}>{visitStatusLabel(job.fieldVisit?.status)}</span>
            </div>
            <ProfessionalReportPreview job={job} />
            <CustomerAcknowledgementControls job={job} mutationBusy={mutationBusy} savingKey={savingCustomerAcknowledgementKey} error={customerAcknowledgementError} onRecord={onRecordCustomerAcknowledgement} />
          </section>

          {(job.fieldVisit?.pendingReason || job.fieldVisit?.noAccessReason || job.fieldVisit?.cancellationReason || job.fieldVisit?.secondVisitReason) ? (
            <section className={styles.section}>
              <h2>Seguimiento de la visita</h2>
              {job.fieldVisit?.pendingReason ? <div className={styles.siteNote}><strong>Pendiente</strong><span>{job.fieldVisit.pendingReason}{job.fieldVisit.pendingAction ? ` · ${job.fieldVisit.pendingAction}` : ''}</span></div> : null}
              {job.fieldVisit?.noAccessReason ? <div className={styles.siteNote}><strong>Sin acceso</strong><span>{job.fieldVisit.noAccessReason}</span></div> : null}
              {job.fieldVisit?.cancellationReason ? <div className={styles.siteNote}><strong>Cancelación</strong><span>{job.fieldVisit.cancellationReason}</span></div> : null}
              {job.fieldVisit?.secondVisitReason ? <div className={styles.siteNote}><strong>Segunda visita</strong><span>{job.fieldVisit.secondVisitReason}</span></div> : null}
            </section>
          ) : null}

          <VisitOfficeReviewControls correctionNote={officeReviewCorrectionNote} disabled={mutationBusy} error={officeReviewError} job={job} onCorrectionNoteChange={onOfficeReviewCorrectionNoteChange} onSubmit={onSubmitOfficeReview} saving={submittingOfficeReview} />
        </div>
      </main>

      {activeStage !== 'close' ? (
        <div className={styles.stickyActionBar}>
          {primaryTransition ? (
            <button className={styles.primaryWorkAction} disabled={mutationBusy} type="button" onClick={() => onTransition({ target: primaryTransition })}>
              {transitioning === primaryTransition ? 'Procesando…' : primaryTransitionLabel}
            </button>
          ) : (
            <button className={styles.primaryWorkAction} type="button" onClick={() => setActiveStage(activeStage === 'arrival' ? 'service' : 'close')}>
              {activeStage === 'arrival' ? 'Ver registro de servicio' : 'Revisar cierre'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TechnicianFieldHome({ enableAdminSimulation = false }: { enableAdminSimulation?: boolean }) {
  const { principal } = useAuth();
  const adminSimulation = canUseFieldAdminSimulation(principal.role, enableAdminSimulation);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [jobs, setJobs] = useState<FieldScheduleJob[]>([]);
  const [jobsOwnerUserId, setJobsOwnerUserId] = useState<string | null>(null);
  const [simulationTargetValue, setSimulationTargetValue] = useState('');
  const [simulationTargets, setSimulationTargets] = useState<FieldAdminSimulationTarget[]>([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FieldExecutionJobDetail | null>(null);
  const [detailOwnerUserId, setDetailOwnerUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [scheduleOfflineCapturedAt, setScheduleOfflineCapturedAt] = useState<string | null>(null);
  const [detailOfflineCapturedAt, setDetailOfflineCapturedAt] = useState<string | null>(null);
  const [outboxSummary, setOutboxSummary] = useState<FieldOutboxSummary>({ pending: 0, blocked: 0, total: 0, conflicts: [] });
  const [syncingOutbox, setSyncingOutbox] = useState(false);
  const [transitioning, setTransitioning] = useState<FieldActiveVisitTransition | null>(null);
  const [creatingReturnVisit, setCreatingReturnVisit] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [attachingAssetId, setAttachingAssetId] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [registeringEquipment, setRegisteringEquipment] = useState(false);
  const [equipmentRegistrationError, setEquipmentRegistrationError] = useState<string | null>(null);
  const [creatingInterventionVisitAssetId, setCreatingInterventionVisitAssetId] = useState<string | null>(null);
  const [interventionError, setInterventionError] = useState<string | null>(null);
  const [creatingAdditionalInterventionVisitAssetId, setCreatingAdditionalInterventionVisitAssetId] = useState<string | null>(null);
  const [additionalInterventionError, setAdditionalInterventionError] = useState<string | null>(null);
  const [decidingApprovalInterventionId, setDecidingApprovalInterventionId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [transitioningInterventionId, setTransitioningInterventionId] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [uploadingReportPhotoKey, setUploadingReportPhotoKey] = useState<string | null>(null);
  const [savingReportMeasurementKey, setSavingReportMeasurementKey] = useState<string | null>(null);
  const [savingReportFindingKey, setSavingReportFindingKey] = useState<string | null>(null);
  const [savingChecklistKey, setSavingChecklistKey] = useState<string | null>(null);
  const [savingFreeTextKey, setSavingFreeTextKey] = useState<string | null>(null);
  const [savingVoiceNoteKey, setSavingVoiceNoteKey] = useState<string | null>(null);
  const [savingCustomerAcknowledgementKey, setSavingCustomerAcknowledgementKey] = useState<string | null>(null);
  const [submittingOfficeReview, setSubmittingOfficeReview] = useState(false);
  const [reportPhotoError, setReportPhotoError] = useState<string | null>(null);
  const [reportMeasurementError, setReportMeasurementError] = useState<string | null>(null);
  const [reportFindingError, setReportFindingError] = useState<string | null>(null);
  const [reportChecklistError, setReportChecklistError] = useState<string | null>(null);
  const [reportFreeTextError, setReportFreeTextError] = useState<string | null>(null);
  const [reportVoiceNoteError, setReportVoiceNoteError] = useState<string | null>(null);
  const [customerAcknowledgementError, setCustomerAcknowledgementError] = useState<string | null>(null);
  const [officeReviewError, setOfficeReviewError] = useState<string | null>(null);
  const [fieldSaleError, setFieldSaleError] = useState<string | null>(null);
  const [savingFieldSaleLineId, setSavingFieldSaleLineId] = useState<string | null>(null);
  const [officeReviewCorrectionNote, setOfficeReviewCorrectionNote] = useState('');
  const scheduleRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const mutationLockRef = useRef<number | null>(null);
  const syncingOutboxRef = useRef(false);
  const visitTransitionRequestRef = useRef<ReportMutationRetry | null>(null);
  const returnVisitRequestRef = useRef<ReportMutationRetry | null>(null);
  const equipmentRegistrationRequestRef = useRef<string | null>(null);
  const reportPhotoRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportMeasurementRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportFindingRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportChecklistRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportFreeTextRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportVoiceNoteRequestRef = useRef<ReportMutationRetry | null>(null);
  const customerAcknowledgementRequestRef = useRef<ReportMutationRetry | null>(null);
  const officeReviewRequestRef = useRef<ReportMutationRetry | null>(null);
  const fieldSaleRequestRef = useRef<ReportMutationRetry | null>(null);
  const selectedWorkOrderRef = useRef<string | null>(null);
  const simulationDataRef = useRef<FieldAdminSimulationData | null>(null);

  const today = arubaDateKey(clockNow);
  const nowTime = arubaTimeKey(clockNow);
  const principalFieldIdentityKey = `${principal.userId}|${principal.role}|${principal.staffId ?? ''}|${principal.vanId ?? ''}|${adminSimulation ? simulationTargetValue : 'canonical'}`;

  const closeJob = useCallback(() => {
    detailRequestRef.current += 1;
    mutationRequestRef.current += 1;
    mutationLockRef.current = null;
    visitTransitionRequestRef.current = null;
    returnVisitRequestRef.current = null;
    equipmentRegistrationRequestRef.current = null;
    reportPhotoRequestRef.current = null;
    reportMeasurementRequestRef.current = null;
    reportFindingRequestRef.current = null;
    reportChecklistRequestRef.current = null;
    reportFreeTextRequestRef.current = null;
    reportVoiceNoteRequestRef.current = null;
    customerAcknowledgementRequestRef.current = null;
    officeReviewRequestRef.current = null;
    fieldSaleRequestRef.current = null;
    selectedWorkOrderRef.current = null;
    setSelectedWorkOrderId(null);
    setSelectedOwnerUserId(null);
    setDetail(null);
    setDetailOwnerUserId(null);
    setDetailError(null);
    setDetailOfflineCapturedAt(null);
    setDetailLoading(false);
    setTransitioning(null);
    setTransitionError(null);
    setAttachingAssetId(null);
    setAssetError(null);
    setRegisteringEquipment(false);
    setEquipmentRegistrationError(null);
    setCreatingInterventionVisitAssetId(null);
    setInterventionError(null);
    setCreatingAdditionalInterventionVisitAssetId(null);
    setAdditionalInterventionError(null);
    setDecidingApprovalInterventionId(null);
    setApprovalError(null);
    setTransitioningInterventionId(null);
    setExecutionError(null);
    setUploadingReportPhotoKey(null);
    setSavingReportMeasurementKey(null);
    setSavingReportFindingKey(null);
    setSavingChecklistKey(null);
    setSavingFreeTextKey(null);
    setSavingVoiceNoteKey(null);
    setSavingCustomerAcknowledgementKey(null);
    setSubmittingOfficeReview(false);
    setReportPhotoError(null);
    setReportMeasurementError(null);
    setReportFindingError(null);
    setReportChecklistError(null);
    setReportFreeTextError(null);
    setReportVoiceNoteError(null);
    setCustomerAcknowledgementError(null);
    setOfficeReviewError(null);
    setFieldSaleError(null);
    setSavingFieldSaleLineId(null);
    setOfficeReviewCorrectionNote('');
  }, []);

  const loadDetail = useCallback(async (workOrderId: string, background = false) => {
    if (adminSimulation) return;
    const requestId = ++detailRequestRef.current;
    const requestPrincipalKey = principalFieldIdentityKey;
    if (!background) {
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailLoading(true);
    }
    setDetailError(null);
    try {
      const response = await getFieldJob(workOrderId);
      if (requestId !== detailRequestRef.current) return;
      setDetail(response.job);
      setDetailOwnerUserId(requestPrincipalKey);
      setDetailOfflineCapturedAt(response.offlineCache?.capturedAt ?? null);
    } catch (loadError) {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailOfflineCapturedAt(null);
      setDetailError(loadError instanceof Error ? loadError.message : 'No se pudo abrir el trabajo.');
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [adminSimulation, principalFieldIdentityKey]);

  const loadSchedule = useCallback(async (background = false) => {
    const requestId = ++scheduleRequestRef.current;
    const requestPrincipalKey = principalFieldIdentityKey;
    if (!background) {
      setJobs([]);
      setJobsOwnerUserId(null);
      setLoading(true);
    }
    setScheduleError(null);
    try {
      let nextJobs: FieldScheduleJob[];
      let offlineCapturedAt: string | null = null;
      if (adminSimulation) {
        let simulationData = simulationDataRef.current;
        if (!simulationData || simulationData.dateKey !== today || background) {
          const loadedSimulationData = await loadFieldAdminSimulationData(today);
          if (requestId !== scheduleRequestRef.current) return;
          simulationData = loadedSimulationData;
          simulationDataRef.current = simulationData;
        }
        const targetValue = simulationData.targets.some((target) => target.value === simulationTargetValue)
          ? simulationTargetValue
          : simulationData.targets[0]?.value ?? '';
        if (targetValue !== simulationTargetValue) setSimulationTargetValue(targetValue);
        setSimulationTargets(simulationData.targets);
        nextJobs = targetValue ? resolveFieldAdminSimulationJobs(simulationData, targetValue) : [];
      } else {
        simulationDataRef.current = null;
        setSimulationTargets([]);
        const response = await getFieldSchedule(today, today);
        nextJobs = response.jobs;
        offlineCapturedAt = response.offlineCache?.capturedAt ?? null;
      }
      if (requestId !== scheduleRequestRef.current) return;
      setJobs(nextJobs);
      setJobsOwnerUserId(requestPrincipalKey);
      setScheduleOfflineCapturedAt(offlineCapturedAt);

      const selectedId = selectedWorkOrderRef.current;
      if (selectedId) {
        if (nextJobs.some((job) => job.workOrderId === selectedId)) {
          if (!adminSimulation) void loadDetail(selectedId, true);
        } else {
          closeJob();
        }
      }
    } catch (loadError) {
      if (requestId !== scheduleRequestRef.current) return;
      setJobs([]);
      setJobsOwnerUserId(null);
      setScheduleOfflineCapturedAt(null);
      closeJob();
      const detail = loadError instanceof Error ? loadError.message : '';
      setScheduleError(adminSimulation
        ? `No se pudo leer la Agenda real de hoy para la simulación.${detail ? ` ${detail}` : ''}`
        : detail || 'No se pudo cargar el itinerario del técnico.');
    } finally {
      if (requestId === scheduleRequestRef.current) setLoading(false);
    }
  }, [adminSimulation, closeJob, loadDetail, principalFieldIdentityKey, simulationTargetValue, today]);

  const refreshOutboxSummary = useCallback(async () => {
    if (adminSimulation) {
      setOutboxSummary({ pending: 0, blocked: 0, total: 0, conflicts: [] });
      return;
    }
    try {
      setOutboxSummary(await getOfflineFieldOutboxSummary(principal.userId));
    } catch {
      setOutboxSummary({ pending: 0, blocked: 0, total: 0, conflicts: [] });
    }
  }, [adminSimulation, principal.userId]);

  const syncOutbox = useCallback(async () => {
    if (adminSimulation || syncingOutboxRef.current || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    syncingOutboxRef.current = true;
    setSyncingOutbox(true);
    try {
      const result = await syncOfflineFieldOutbox();
      await refreshOutboxSummary();
      if (result.completed > 0) {
        await loadSchedule(true);
      }
    } catch {
      await refreshOutboxSummary();
    } finally {
      syncingOutboxRef.current = false;
      setSyncingOutbox(false);
    }
  }, [adminSimulation, loadDetail, loadSchedule, refreshOutboxSummary]);

  const discardOutboxConflict = useCallback(async (id: string) => {
    try {
      await discardOfflineFieldConflict(principal.userId, id);
      await refreshOutboxSummary();
      const selectedId = selectedWorkOrderRef.current;
      if (selectedId) await loadDetail(selectedId, true);
    } catch {
      await refreshOutboxSummary();
    }
  }, [loadDetail, principal.userId, refreshOutboxSummary]);

  const clearMutationErrors = useCallback(() => {
    setTransitionError(null);
    setAssetError(null);
    setEquipmentRegistrationError(null);
    setInterventionError(null);
    setAdditionalInterventionError(null);
    setApprovalError(null);
    setExecutionError(null);
    setReportPhotoError(null);
    setReportMeasurementError(null);
    setReportFindingError(null);
    setReportChecklistError(null);
    setReportFreeTextError(null);
    setReportVoiceNoteError(null);
    setCustomerAcknowledgementError(null);
    setOfficeReviewError(null);
    setFieldSaleError(null);
  }, []);

  const runVisitTransition = useCallback(async (input: VisitTransitionInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail) return;

    const target = input.target;
    const signature = `${target}|${input.pendingReason?.trim() || ''}|${input.pendingAction?.trim() || ''}|${input.noAccessReason?.trim() || ''}|${input.cancellationReason?.trim() || ''}|${input.secondVisitReason?.trim() || ''}`;
    const prior = visitTransitionRequestRef.current;
    const transitionRequestId = prior?.key === target && prior.signature === signature
      ? prior.requestId
      : clientRequestId(`transition-${target}`, currentDetail.workOrderId);
    visitTransitionRequestRef.current = { key: target, signature, requestId: transitionRequestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setTransitioning(target);
    clearMutationErrors();
    try {
      let visit = currentDetail.fieldVisit;
      if (!visit) {
        if (!currentDetail.canPrepareVisit || (target !== 'en_route' && target !== 'no_access' && target !== 'cancelled')) {
          throw new Error('La visita todavía no está disponible para esta transición. Actualiza el trabajo e intenta nuevamente.');
        }
        const prepared = await prepareFieldVisit(workOrderId, clientRequestId('prepare', workOrderId));
        if (mutationId !== mutationRequestRef.current) return;
        visit = prepared.visit;
      }

      const transitioned = await transitionFieldVisit(
        visit.id,
        target,
        visit.version,
        transitionRequestId,
        input.pendingReason,
        input.pendingAction,
        input.noAccessReason,
        input.cancellationReason,
        input.secondVisitReason,
      );
      if (mutationId !== mutationRequestRef.current) return;

      setDetail((current) => current?.workOrderId === workOrderId
        ? { ...current, fieldVisit: transitioned.visit, canPrepareVisit: false }
        : current);
      visitTransitionRequestRef.current = null;
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setTransitionError(mutationError instanceof Error ? mutationError.message : 'No se pudo actualizar el estado de la visita.');
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } finally {
      if (mutationId === mutationRequestRef.current) setTransitioning(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, loadSchedule, principalFieldIdentityKey]);

  const runCreateReturnVisit = useCallback(async () => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    const visit = currentDetail?.fieldVisit;
    if (!currentDetail || !visit || !currentDetail.canCreateReturnVisit) {
      setTransitionError('Field Authority todavía no autoriza crear la visita física de retorno. Actualiza el trabajo e intenta nuevamente.');
      return;
    }

    const signature = String(visit.version);
    const prior = returnVisitRequestRef.current;
    const requestId = prior?.key === visit.id && prior.signature === signature
      ? prior.requestId
      : clientRequestId('return-visit', visit.id);
    returnVisitRequestRef.current = { key: visit.id, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setCreatingReturnVisit(true);
    clearMutationErrors();
    try {
      const created = await createReturnFieldVisit(visit.id, visit.version, requestId);
      if (mutationId !== mutationRequestRef.current) return;
      setDetail((current) => current?.workOrderId === workOrderId
        ? {
          ...current,
          fieldVisit: created.visit,
          canPrepareVisit: false,
          canCreateReturnVisit: false,
        }
        : current);
      returnVisitRequestRef.current = null;
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setTransitionError(mutationError instanceof Error ? mutationError.message : 'No se pudo crear la visita física de retorno.');
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } finally {
      if (mutationId === mutationRequestRef.current) setCreatingReturnVisit(false);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, loadSchedule, principalFieldIdentityKey]);

  const runAttachAsset = useCallback(async (assetId: string, qrCode?: string) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setAssetError('La visita todavía no está disponible para confirmar equipos en sitio.');
      return false;
    }
    if (!currentDetail.canAddExistingAsset) {
      setAssetError('Field Authority no autoriza agregar equipos en el estado o asignación actual.');
      return false;
    }
    if (currentDetail.visitAssets.some((visitAsset) => visitAsset.assetId === assetId)) return true;

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setAttachingAssetId(assetId);
    clearMutationErrors();
    try {
      const requestId = clientRequestId(qrCode ? 'attach-asset-qr' : 'attach-asset', workOrderId);
      if (qrCode) {
        await attachFieldAssetByQr(currentDetail.fieldVisit.id, assetId, qrCode, requestId);
      } else {
        await attachExistingFieldAsset(currentDetail.fieldVisit.id, assetId, requestId);
      }
      if (mutationId !== mutationRequestRef.current) return false;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setAssetError(mutationError instanceof Error ? mutationError.message : 'No se pudo agregar el A/C a esta visita.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setAttachingAssetId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runRegisterEquipment = useCallback(async (input: EquipmentRegistrationInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setEquipmentRegistrationError('La visita todavía no está disponible para registrar equipos en sitio.');
      return false;
    }
    if (!currentDetail.canAddExistingAsset) {
      setEquipmentRegistrationError('Field Authority no autoriza registrar equipos en el estado o asignación actual.');
      return false;
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    const requestId = equipmentRegistrationRequestRef.current
      ?? clientRequestId('register-asset', workOrderId);
    equipmentRegistrationRequestRef.current = requestId;
    setRegisteringEquipment(true);
    clearMutationErrors();
    try {
      const [equipmentReferencePath, indoorNameplatePath, outdoorNameplatePath] = await Promise.all([
        uploadFieldEquipmentRegistrationImage({
          visitId: currentDetail.fieldVisit.id,
          requestId,
          kind: 'equipment_reference',
          file: input.equipmentReference,
        }),
        uploadFieldEquipmentRegistrationImage({
          visitId: currentDetail.fieldVisit.id,
          requestId,
          kind: 'indoor_nameplate',
          file: input.indoorNameplate,
        }),
        uploadFieldEquipmentRegistrationImage({
          visitId: currentDetail.fieldVisit.id,
          requestId,
          kind: 'outdoor_nameplate',
          file: input.outdoorNameplate,
        }),
      ]);
      if (mutationId !== mutationRequestRef.current) return false;

      await registerOnSiteFieldEquipment({
        visitId: currentDetail.fieldVisit.id,
        requestId,
        locationLabel: input.locationLabel,
        systemType: input.systemType,
        brand: input.brand,
        btu: input.btu,
        refrigerant: input.refrigerant,
        voltage: input.voltage,
        qrCode: input.qrCode,
        evidencePaths: {
          equipment_reference: equipmentReferencePath,
          indoor_nameplate: indoorNameplatePath,
          outdoor_nameplate: outdoorNameplatePath,
        },
      });
      if (mutationId !== mutationRequestRef.current) return false;

      equipmentRegistrationRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setEquipmentRegistrationError(mutationError instanceof Error ? mutationError.message : 'No se pudo registrar el A/C en esta propiedad.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setRegisteringEquipment(false);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runCreatePlannedIntervention = useCallback(async (input: PlannedWorkMutationInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setInterventionError(input.kind === 'disposition'
        ? 'La visita todavía no está disponible para reconciliar trabajo planificado.'
        : 'La visita todavía no está disponible para vincular trabajo a un A/C.');
      return;
    }

    if (input.kind === 'disposition') {
      const option = currentDetail.plannedWorkDispositionOptions.find((candidate) => candidate.plannedWorkLineId === input.plannedWorkLineId);
      if (!currentDetail.canRecordPlannedWorkDisposition
        || !option
        || !Number.isSafeInteger(input.quantity)
        || input.quantity < 1
        || input.quantity > option.maxQuantity) {
        setInterventionError('Field Authority ya no autoriza reconciliar esa cantidad programada. Actualiza el trabajo e intenta nuevamente.');
        void loadDetail(currentDetail.workOrderId, true);
        return;
      }
    } else {
      const option = currentDetail.plannedInterventionOptions.find((candidate) => candidate.visitAssetId === input.visitAssetId);
      const serviceExists = currentDetail.availableFieldServices.some((service) => service.id === input.serviceCatalogItemId);
      if (!currentDetail.canAddPlannedIntervention
        || !option?.plannedWorkLineIds.includes(input.plannedWorkLineId)
        || !serviceExists) {
        setInterventionError('Field Authority ya no autoriza vincular ese trabajo planificado al A/C. Actualiza el trabajo e intenta nuevamente.');
        void loadDetail(currentDetail.workOrderId, true);
        return;
      }
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    const busyKey = input.kind === 'disposition' ? `disposition:${input.plannedWorkLineId}` : input.visitAssetId;
    setCreatingInterventionVisitAssetId(busyKey);
    clearMutationErrors();
    try {
      if (input.kind === 'disposition') {
        await recordFieldPlannedWorkDisposition(
          currentDetail.fieldVisit.id,
          input.plannedWorkLineId,
          input.quantity,
          input.reasonCode,
          input.note,
          clientRequestId('planned-disposition', workOrderId),
        );
      } else {
        await createPlannedFieldIntervention(
          currentDetail.fieldVisit.id,
          input.visitAssetId,
          input.plannedWorkLineId,
          input.serviceCatalogItemId,
          clientRequestId('planned-intervention', workOrderId),
        );
      }
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setInterventionError(mutationError instanceof Error
        ? mutationError.message
        : input.kind === 'disposition'
          ? 'No se pudo registrar el trabajo planificado no realizado.'
          : 'No se pudo vincular el trabajo planificado al A/C.');
      void loadDetail(workOrderId, true);
    } finally {
      if (mutationId === mutationRequestRef.current) setCreatingInterventionVisitAssetId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runCreateAdditionalIntervention = useCallback(async (input: AdditionalInterventionInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setAdditionalInterventionError('La visita todavía no está disponible para registrar alcance adicional.');
      return;
    }
    if (!currentDetail.canAddAdditionalIntervention
      || !currentDetail.additionalInterventionVisitAssetIds.includes(input.visitAssetId)) {
      setAdditionalInterventionError('Field Authority no autoriza alcance adicional para este A/C en el estado o asignación actual.');
      return;
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setCreatingAdditionalInterventionVisitAssetId(input.visitAssetId);
    clearMutationErrors();
    try {
      await createAdditionalFieldIntervention(
        currentDetail.fieldVisit.id,
        input.visitAssetId,
        input.serviceCatalogItemId,
        input.origin,
        input.reason,
        clientRequestId('additional-intervention', workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setAdditionalInterventionError(mutationError instanceof Error ? mutationError.message : 'No se pudo registrar el alcance adicional.');
      void loadDetail(workOrderId, true);
    } finally {
      if (mutationId === mutationRequestRef.current) setCreatingAdditionalInterventionVisitAssetId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runRecordAdditionalDecision = useCallback(async (input: AdditionalApprovalInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setApprovalError('La visita todavía no está disponible para registrar una decisión del cliente.');
      return;
    }
    if (!currentDetail.canRecordAdditionalApproval
      || !currentDetail.additionalApprovalInterventionIds.includes(input.interventionId)) {
      setApprovalError('Field Authority no autoriza una decisión de cliente para este trabajo adicional.');
      return;
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setDecidingApprovalInterventionId(input.interventionId);
    clearMutationErrors();
    try {
      await recordAdditionalFieldInterventionDecision(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.decision,
        input.receiverName,
        input.note,
        clientRequestId('additional-decision', workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setApprovalError(mutationError instanceof Error ? mutationError.message : 'No se pudo registrar la decisión del cliente.');
      void loadDetail(workOrderId, true);
    } finally {
      if (mutationId === mutationRequestRef.current) setDecidingApprovalInterventionId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runTransitionIntervention = useCallback(async (input: InterventionExecutionInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setExecutionError('La visita todavía no está disponible para ejecutar trabajo técnico.');
      return;
    }
    const option = currentDetail.interventionExecutionOptions.find((candidate) => candidate.interventionId === input.interventionId);
    const intervention = currentDetail.workInterventions.find((candidate) => candidate.id === input.interventionId);
    if (!option || !intervention || !option.allowedTargets.includes(input.target) || intervention.version !== input.expectedVersion) {
      setExecutionError('Field Authority ya no autoriza esta transición para el trabajo actual. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return;
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setTransitioningInterventionId(input.interventionId);
    clearMutationErrors();
    try {
      await transitionFieldIntervention(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.target,
        input.expectedVersion,
        input.note,
        clientRequestId(`intervention-${input.target}`, workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setExecutionError(mutationError instanceof Error ? mutationError.message : 'No se pudo actualizar la ejecución del trabajo.');
      void loadDetail(workOrderId, true);
    } finally {
      if (mutationId === mutationRequestRef.current) setTransitioningInterventionId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runAddReportPhoto = useCallback(async (input: ReportPhotoInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportPhotoError('La visita todavía no está disponible para guardar evidencia del reporte.');
      return false;
    }
    const option = currentDetail.reportPhotoOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canAddReportPhoto || !option?.sectionIds.includes(input.sectionId)) {
      setReportPhotoError('Field Authority ya no autoriza fotos para esta sección del reporte. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = reportPhotoSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportPhotoRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-photo', workOrderId);
    reportPhotoRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setUploadingReportPhotoKey(key);
    clearMutationErrors();
    try {
      const storagePath = await uploadFieldReportPhoto({
        visitId: currentDetail.fieldVisit.id,
        interventionId: input.interventionId,
        sectionId: input.sectionId,
        requestId,
        file: input.file,
      });
      if (mutationId !== mutationRequestRef.current) return false;

      await addFieldReportPhotoEvidence(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        storagePath,
        input.caption,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportPhotoRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportPhotoError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar la foto del reporte.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setUploadingReportPhotoKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runAddReportVoiceNote = useCallback(async (input: ReportVoiceNoteInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportVoiceNoteError('La visita todavía no está disponible para guardar notas de voz.');
      return false;
    }
    const option = currentDetail.reportVoiceNoteOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canAddReportVoiceNote || !option?.sectionIds.includes(input.sectionId)) {
      setReportVoiceNoteError('Field Authority ya no autoriza esta nota de voz. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }
    const report = currentDetail.interventionReports.find((candidate) => candidate.interventionId === input.interventionId);
    const section = report?.template.sections.find((candidate) => candidate.id === input.sectionId && candidate.type === 'voice_note');
    const existing = report?.voiceNotes.find((candidate) => candidate.sectionId === input.sectionId);
    if (!report || !section || existing) {
      setReportVoiceNoteError('La nota de voz cambió o ya fue registrada. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = reportVoiceNoteSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportVoiceNoteRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-voice', workOrderId);
    reportVoiceNoteRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingVoiceNoteKey(key);
    clearMutationErrors();
    try {
      const storagePath = await uploadFieldReportVoice({
        visitId: currentDetail.fieldVisit.id,
        interventionId: input.interventionId,
        sectionId: input.sectionId,
        requestId,
        blob: input.blob,
        durationSeconds: input.durationSeconds,
      });
      if (mutationId !== mutationRequestRef.current) return false;

      await addFieldReportVoiceEvidence(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        storagePath,
        input.durationSeconds,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportVoiceNoteRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportVoiceNoteError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar la nota de voz.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingVoiceNoteKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runAddReportMeasurement = useCallback(async (input: ReportMeasurementInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportMeasurementError('La visita todavía no está disponible para guardar mediciones del reporte.');
      return false;
    }
    const option = currentDetail.reportMeasurementOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canAddReportMeasurement || !option?.sectionIds.includes(input.sectionId)) {
      setReportMeasurementError('Field Authority ya no autoriza mediciones para esta sección del reporte. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = reportMeasurementSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportMeasurementRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-measurement', workOrderId);
    reportMeasurementRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingReportMeasurementKey(key);
    clearMutationErrors();
    try {
      await addFieldReportMeasurement(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        input.metric,
        input.value,
        input.unit,
        input.moment,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportMeasurementRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportMeasurementError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar la medición del reporte.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingReportMeasurementKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runAddReportFinding = useCallback(async (input: ReportFindingInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportFindingError('La visita todavía no está disponible para guardar hallazgos del reporte.');
      return false;
    }
    const option = currentDetail.reportFindingOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canAddReportFinding || !option?.sectionIds.includes(input.sectionId)) {
      setReportFindingError('Field Authority ya no autoriza hallazgos para esta sección del reporte. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = reportFindingSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportFindingRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-finding', workOrderId);
    reportFindingRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingReportFindingKey(key);
    clearMutationErrors();
    try {
      await addFieldReportFinding(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        input.summary,
        input.details,
        input.recommendation,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportFindingRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportFindingError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar el hallazgo del reporte.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingReportFindingKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runSetReportChecklistItem = useCallback(async (input: ReportChecklistInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportChecklistError('La visita todavía no está disponible para actualizar la checklist del reporte.');
      return false;
    }
    const option = currentDetail.reportChecklistOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canEditReportChecklist || !option?.sectionIds.includes(input.sectionId)) {
      setReportChecklistError('Field Authority ya no autoriza editar esta checklist. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }
    const report = currentDetail.interventionReports.find((candidate) => candidate.interventionId === input.interventionId);
    const section = report?.template.sections.find((candidate) => candidate.id === input.sectionId && candidate.type === 'checklist');
    const itemExists = section?.checklistItems?.some((candidate) => candidate.id === input.itemId) === true;
    const currentResponse = report?.checklistResponses.find((candidate) => candidate.sectionId === input.sectionId && candidate.itemId === input.itemId);
    const actualVersion = currentResponse?.version ?? 0;
    if (!report || !section || !itemExists || actualVersion !== input.expectedVersion) {
      setReportChecklistError('La checklist cambió o ya no coincide con el template canónico. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}:${input.itemId}`;
    const signature = reportChecklistSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportChecklistRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-checklist', workOrderId);
    reportChecklistRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingChecklistKey(key);
    clearMutationErrors();
    try {
      await setFieldReportChecklistItem(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        input.itemId,
        input.checked,
        input.expectedVersion,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportChecklistRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportChecklistError(mutationError instanceof Error ? mutationError.message : 'No se pudo actualizar la checklist del reporte.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingChecklistKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runSetReportFreeText = useCallback(async (input: ReportFreeTextInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setReportFreeTextError('La visita todavía no está disponible para guardar notas técnicas.');
      return false;
    }
    const option = currentDetail.reportFreeTextOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canEditReportFreeText || !option?.sectionIds.includes(input.sectionId)) {
      setReportFreeTextError('Field Authority ya no autoriza editar esta nota. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }
    if (input.value.length > 5000) {
      setReportFreeTextError('La nota técnica no puede superar 5000 caracteres.');
      return false;
    }
    const report = currentDetail.interventionReports.find((candidate) => candidate.interventionId === input.interventionId);
    const section = report?.template.sections.find((candidate) => candidate.id === input.sectionId && candidate.type === 'free_text');
    const currentResponse = report?.freeTextResponses.find((candidate) => candidate.sectionId === input.sectionId);
    const actualVersion = currentResponse?.version ?? 0;
    if (!report || !section || actualVersion !== input.expectedVersion) {
      setReportFreeTextError('La nota técnica cambió o ya no coincide con el template canónico. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = reportFreeTextSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = reportFreeTextRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('report-free-text', workOrderId);
    reportFreeTextRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingFreeTextKey(key);
    clearMutationErrors();
    try {
      await setFieldReportFreeText(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        input.value,
        input.expectedVersion,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      reportFreeTextRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setReportFreeTextError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar la nota técnica.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingFreeTextKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runRecordCustomerAcknowledgement = useCallback(async (input: CustomerAcknowledgementInput) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setCustomerAcknowledgementError('La visita todavía no está disponible para registrar la confirmación del cliente.');
      return false;
    }
    const option = currentDetail.reportCustomerAcknowledgementOptions.find((candidate) => candidate.interventionId === input.interventionId);
    if (!currentDetail.canRecordCustomerAcknowledgement || !option?.sectionIds.includes(input.sectionId)) {
      setCustomerAcknowledgementError('Field Authority ya no autoriza registrar esta confirmación del cliente. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }
    const report = currentDetail.interventionReports.find((candidate) => candidate.interventionId === input.interventionId);
    const section = report?.template.sections.find((candidate) => candidate.id === input.sectionId && candidate.type === 'customer_acknowledgement');
    const existing = report?.customerAcknowledgements.find((candidate) => candidate.sectionId === input.sectionId);
    if (!report || !section || existing) {
      setCustomerAcknowledgementError('La confirmación cambió o ya fue registrada. Actualiza el trabajo e intenta nuevamente.');
      void loadDetail(currentDetail.workOrderId, true);
      return false;
    }

    const key = `${input.interventionId}:${input.sectionId}`;
    const signature = customerAcknowledgementSignature(input);
    const workOrderId = currentDetail.workOrderId;
    const prior = customerAcknowledgementRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('customer-acknowledgement', workOrderId);
    customerAcknowledgementRequestRef.current = { key, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    setSavingCustomerAcknowledgementKey(key);
    clearMutationErrors();
    try {
      await recordFieldCustomerAcknowledgement(
        currentDetail.fieldVisit.id,
        input.interventionId,
        input.sectionId,
        input.receiverName,
        input.note,
        requestId,
      );
      if (mutationId !== mutationRequestRef.current) return false;

      customerAcknowledgementRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setCustomerAcknowledgementError(mutationError instanceof Error ? mutationError.message : 'No se pudo registrar la confirmación del cliente.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingCustomerAcknowledgementKey(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runFieldSaleMutation = useCallback(async (
    key: string,
    signature: string,
    action: (visitId: string, requestId: string) => Promise<unknown>,
  ) => {
    if (mutationLockRef.current !== null) return false;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    const visit = currentDetail?.fieldVisit;
    if (!currentDetail || !visit) {
      setFieldSaleError('La visita canónica no está disponible para registrar ventas en campo.');
      return false;
    }
    const prior = fieldSaleRequestRef.current;
    const requestId = prior?.key === key && prior.signature === signature
      ? prior.requestId
      : clientRequestId('field-sale', currentDetail.workOrderId);
    fieldSaleRequestRef.current = { key, signature, requestId };
    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setSavingFieldSaleLineId(key);
    clearMutationErrors();
    try {
      await action(visit.id, requestId);
      if (mutationId !== mutationRequestRef.current) return false;
      fieldSaleRequestRef.current = null;
      await loadDetail(workOrderId, true);
      return true;
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return false;
      setFieldSaleError(mutationError instanceof Error ? mutationError.message : 'No se pudo guardar la venta de campo.');
      void loadDetail(workOrderId, true);
      return false;
    } finally {
      if (mutationId === mutationRequestRef.current) setSavingFieldSaleLineId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  const runCreateFieldSaleLine = useCallback((input: FieldSaleCreateInput) => {
    const signature = JSON.stringify(input);
    return runFieldSaleMutation(`create:${input.catalogItemId || input.description || 'draft'}`, signature, (visitId, requestId) => (
      createFieldSaleLine({ ...input, visitId, requestId })
    ));
  }, [runFieldSaleMutation]);

  const runDecideFieldSaleLine = useCallback((input: FieldSaleDecisionInput) => {
    const signature = `${input.saleLineId}|${input.decision}|${input.receiverName}|${input.note}|${input.expectedVersion}`;
    return runFieldSaleMutation(`decide:${input.saleLineId}`, signature, (visitId, requestId) => (
      decideFieldSaleLine(visitId, input.saleLineId, input.decision, input.receiverName, input.note, input.expectedVersion, requestId)
    ));
  }, [runFieldSaleMutation]);

  const runTransitionFieldSaleLine = useCallback((input: FieldSaleTransitionInput) => {
    const signature = `${input.saleLineId}|${input.to}|${input.note}|${input.expectedVersion}`;
    return runFieldSaleMutation(`transition:${input.saleLineId}`, signature, (visitId, requestId) => (
      transitionFieldSaleLine(visitId, input.saleLineId, input.to, input.note, input.expectedVersion, requestId)
    ));
  }, [runFieldSaleMutation]);

  const runSubmitOfficeReview = useCallback(async () => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    const visit = currentDetail?.fieldVisit;
    if (!currentDetail || !visit || !currentDetail.officeReviewSubmission?.allowed) {
      setOfficeReviewError('Field Authority todavía no autoriza este envío. Revisa los pendientes y actualiza el trabajo.');
      if (currentDetail) void loadDetail(currentDetail.workOrderId, true);
      return;
    }

    const correctionNote = currentDetail.officeReviewSubmission.correctionRequired
      ? officeReviewCorrectionNote.trim()
      : '';
    if (currentDetail.officeReviewSubmission.correctionRequired && correctionNote.length < 3) {
      setOfficeReviewError('Describe brevemente qué corregiste antes de reenviar a la oficina.');
      return;
    }
    const signature = `${visit.version}|${correctionNote}`;
    const prior = officeReviewRequestRef.current;
    const requestId = prior?.key === visit.id && prior.signature === signature
      ? prior.requestId
      : clientRequestId('office-review-submit', currentDetail.workOrderId);
    officeReviewRequestRef.current = { key: visit.id, signature, requestId };

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setSubmittingOfficeReview(true);
    clearMutationErrors();
    try {
      const submitted = await submitFieldVisitForOfficeReview(visit.id, visit.version, requestId, correctionNote);
      if (mutationId !== mutationRequestRef.current) return;
      setDetail((current) => current?.workOrderId === workOrderId
        ? {
          ...current,
          fieldVisit: submitted.visit,
          officeReviewSubmission: {
            allowed: false,
            status: 'pending',
            reviewId: submitted.review.id,
            revisionNumber: submitted.review.currentRevisionNumber,
            correctionRequired: false,
            blockers: [],
          },
        }
        : current);
      officeReviewRequestRef.current = null;
      setOfficeReviewCorrectionNote('');
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setOfficeReviewError(mutationError instanceof Error ? mutationError.message : 'No se pudo enviar la visita a revisión de oficina.');
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } finally {
      if (mutationId === mutationRequestRef.current) setSubmittingOfficeReview(false);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [clearMutationErrors, detail, detailOwnerUserId, loadDetail, loadSchedule, officeReviewCorrectionNote, principalFieldIdentityKey]);

  useEffect(() => {
    void loadSchedule();
    return () => { scheduleRequestRef.current += 1; };
  }, [loadSchedule]);

  useEffect(() => {
    if (adminSimulation) return undefined;
    const handleState = () => { void refreshOutboxSummary(); };
    const handleOnline = () => { void syncOutbox(); };
    void refreshOutboxSummary();
    if (typeof navigator === 'undefined' || navigator.onLine !== false) void syncOutbox();
    window.addEventListener(FIELD_OFFLINE_STATE_EVENT, handleState);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener(FIELD_OFFLINE_STATE_EVENT, handleState);
      window.removeEventListener('online', handleOnline);
    };
  }, [adminSimulation, refreshOutboxSummary, syncOutbox]);

  useEffect(() => {
    const revalidate = () => {
      setClockNow(new Date());
      if (document.visibilityState === 'visible') void loadSchedule(true);
    };
    const handleFocus = () => revalidate();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    const timer = window.setInterval(revalidate, SCHEDULE_REVALIDATE_MS);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadSchedule]);

  useEffect(() => {
    closeJob();
  }, [closeJob, principalFieldIdentityKey]);

  useEffect(() => {
    if (adminSimulation || !selectedWorkOrderId || selectedOwnerUserId !== principalFieldIdentityKey) {
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    void loadDetail(selectedWorkOrderId);
    return () => { detailRequestRef.current += 1; };
  }, [adminSimulation, loadDetail, principalFieldIdentityKey, selectedOwnerUserId, selectedWorkOrderId]);

  const authorizedJobs = jobsOwnerUserId === principalFieldIdentityKey ? jobs : [];
  const todayJobs = useMemo(() => authorizedJobs.filter((job) => job.date === today), [authorizedJobs, today]);
  const summary = useMemo(() => {
    const completed = todayJobs.filter(isFieldJobCompleted).length;
    const inProgress = todayJobs.filter(isFieldJobInProgress).length;
    return { scheduled: todayJobs.length, completed, inProgress, remaining: Math.max(0, todayJobs.length - completed) };
  }, [todayJobs]);

  const nextJob = useMemo(() => selectNextFieldJob(todayJobs, nowTime), [nowTime, todayJobs]);
  const routeJobs = useMemo(() => fieldRouteWithoutNextJob(todayJobs, nextJob), [nextJob, todayJobs]);

  const openJob = (workOrderId: string) => {
    selectedWorkOrderRef.current = workOrderId;
    setSelectedOwnerUserId(principalFieldIdentityKey);
    setSelectedWorkOrderId(workOrderId);
  };

  const selectedSimulationTarget = simulationTargets.find((target) => target.value === simulationTargetValue);

  if (adminSimulation && selectedWorkOrderId && selectedOwnerUserId === principalFieldIdentityKey) {
    const simulationJob = authorizedJobs.find((job) => job.workOrderId === selectedWorkOrderId);
    if (simulationJob) {
      return (
        <FieldAdminSimulationDetail
          key={`${simulationJob.workOrderId}|${simulationJob.status}|${simulationTargetValue}`}
          job={simulationJob}
          targetLabel={selectedSimulationTarget?.label || 'Selección temporal'}
          onBack={closeJob}
        />
      );
    }
  }

  if (!adminSimulation && selectedWorkOrderId && selectedOwnerUserId === principalFieldIdentityKey) {
    const authorizedDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    return (
      <DetailView
        job={authorizedDetail}
        loading={detailLoading}
        error={detailError}
        transitionError={transitionError}
        assetError={assetError}
        equipmentRegistrationError={equipmentRegistrationError}
        interventionError={interventionError}
        additionalInterventionError={additionalInterventionError}
        approvalError={approvalError}
        executionError={executionError}
        reportError={reportChecklistError || reportFindingError || reportMeasurementError || reportPhotoError}
        freeTextError={reportFreeTextError}
        voiceNoteError={reportVoiceNoteError}
        customerAcknowledgementError={customerAcknowledgementError}
        officeReviewError={officeReviewError}
        fieldSaleError={fieldSaleError}
        officeReviewCorrectionNote={officeReviewCorrectionNote}
        transitioning={transitioning}
        attachingAssetId={attachingAssetId}
        registeringEquipment={registeringEquipment}
        creatingInterventionVisitAssetId={creatingInterventionVisitAssetId}
        creatingAdditionalInterventionVisitAssetId={creatingAdditionalInterventionVisitAssetId}
        decidingApprovalInterventionId={decidingApprovalInterventionId}
        transitioningInterventionId={transitioningInterventionId}
        uploadingReportPhotoKey={uploadingReportPhotoKey}
        savingReportMeasurementKey={savingReportMeasurementKey}
        savingReportFindingKey={savingReportFindingKey}
        savingChecklistKey={savingChecklistKey}
        savingFreeTextKey={savingFreeTextKey}
        savingVoiceNoteKey={savingVoiceNoteKey}
        savingCustomerAcknowledgementKey={savingCustomerAcknowledgementKey}
        submittingOfficeReview={submittingOfficeReview}
        savingFieldSaleLineId={savingFieldSaleLineId}
        offlineCapturedAt={detailOfflineCapturedAt}
        outboxSummary={outboxSummary}
        syncingOutbox={syncingOutbox}
        draftOwnerUserId={principal.userId}
        creatingReturnVisit={creatingReturnVisit}
        onTransition={(input) => void runVisitTransition(input)}
        onCreateReturnVisit={() => void runCreateReturnVisit()}
        onAttachAsset={(assetId) => void runAttachAsset(assetId)}
        onAttachAssetByQr={(assetId, qrCode) => runAttachAsset(assetId, qrCode)}
        onRegisterEquipment={runRegisterEquipment}
        onCreatePlannedIntervention={(input) => void runCreatePlannedIntervention(input)}
        onCreateAdditionalIntervention={(input) => void runCreateAdditionalIntervention(input)}
        onRecordAdditionalDecision={(input) => void runRecordAdditionalDecision(input)}
        onTransitionIntervention={(input) => void runTransitionIntervention(input)}
        onAddReportPhoto={runAddReportPhoto}
        onAddReportMeasurement={runAddReportMeasurement}
        onAddReportFinding={runAddReportFinding}
        onSetChecklistItem={runSetReportChecklistItem}
        onSaveFreeText={runSetReportFreeText}
        onSaveVoiceNote={runAddReportVoiceNote}
        onRecordCustomerAcknowledgement={runRecordCustomerAcknowledgement}
        onCreateFieldSaleLine={runCreateFieldSaleLine}
        onDecideFieldSaleLine={runDecideFieldSaleLine}
        onTransitionFieldSaleLine={runTransitionFieldSaleLine}
        onOfficeReviewCorrectionNoteChange={setOfficeReviewCorrectionNote}
        onSubmitOfficeReview={() => void runSubmitOfficeReview()}
        onSyncOutbox={() => void syncOutbox()}
        onDiscardOutboxConflict={(id) => void discardOutboxConflict(id)}
        onBack={closeJob}
      />
    );
  }

  return (
    <div className={styles.technicianApp}>
      {adminSimulation ? (
        <aside className={styles.adminPreviewBar} aria-label="Controles temporales de prueba">
          <div><strong>Vista de prueba · solo Super Admin</strong><span>Selecciona una Van o técnico individual. Las acciones no modifican datos reales.</span></div>
          <FieldAdminSimulationSelector targets={simulationTargets} value={simulationTargetValue} loading={loading} onChange={setSimulationTargetValue} />
        </aside>
      ) : null}

      <header className={`${styles.mobileHeader} ${styles.homeHeader}`}>
        <div className={styles.brandBlock}><span>DEMAC</span><small>ERP Next</small></div>
        <div className={styles.headerTitle}><strong>Mi día</strong><span>{formatArubaDateKey(today, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
        <div className={styles.headerIdentity}>
          <strong>{adminSimulation ? selectedSimulationTarget?.label || 'Selecciona una Van' : principal.displayName}</strong>
          <span>{adminSimulation ? selectedSimulationTarget?.detail || 'Vista temporal' : principal.staffId || 'Técnico'}</span>
        </div>
      </header>

      <main className={styles.mobileContent}>
        {adminSimulation ? <section className={simulationStyles.simulationNotice}>
          <strong>{selectedSimulationTarget?.label || 'Selecciona una Van o técnico para comenzar'}</strong>
          <span>Agenda real de Aruba para hoy. La ejecución dentro del portal sigue siendo una simulación local segura.</span>
        </section> : <OfflineStatus capturedAt={scheduleOfflineCapturedAt} summary={outboxSummary} syncing={syncingOutbox} onSync={() => void syncOutbox()} onDiscard={(id) => void discardOutboxConflict(id)} />}

        <section className={styles.daySummary} aria-label="Resumen del día actual">
          <div><strong>{summary.scheduled}</strong><span>Trabajos</span></div>
          <div><strong>{summary.completed}</strong><span>Completados</span></div>
          <div><strong>{summary.inProgress}</strong><span>En curso</span></div>
          <div><strong>{summary.remaining}</strong><span>Restantes</span></div>
        </section>

        {scheduleError ? <section className={styles.panel}><div className={styles.error}>{scheduleError}<div style={{ marginTop: 12 }}><button className={styles.action} type="button" onClick={() => void loadSchedule()}>Reintentar</button></div></div></section> : null}

        <section className={`${styles.panel} ${styles.nextPanel}`}>
          <div className={styles.panelHead}><div><span>Ahora</span><h2>{nextJob && isFieldJobInProgress(nextJob) ? 'Trabajo activo' : 'Próximo trabajo'}</h2></div><span>{nextJob?.time || 'Hoy'}</span></div>
          {loading ? <div className={styles.loading}>Cargando agenda de hoy…</div> : nextJob ? <JobCard job={nextJob} featured simulated={adminSimulation} onOpen={() => openJob(nextJob.workOrderId)} /> : <div className={styles.empty}>No quedan trabajos activos asignados para hoy.</div>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div><span>Solo hoy</span><h2>Ruta del día</h2></div>
            <span>{loading ? 'Cargando…' : `${todayJobs.length} trabajo${todayJobs.length === 1 ? '' : 's'}`}</span>
          </div>
          {loading ? <div className={styles.loading}>Cargando itinerario autorizado…</div> : routeJobs.length ? routeJobs.map((job) => <JobCard key={job.workOrderId} job={job} simulated={adminSimulation} onOpen={() => openJob(job.workOrderId)} />) : todayJobs.length ? <div className={styles.empty}>El próximo trabajo ya aparece arriba. No hay otros trabajos en la ruta de hoy.</div> : <div className={styles.empty}>No hay trabajos asignados para esta selección hoy.</div>}
        </section>
      </main>
    </div>
  );
}
