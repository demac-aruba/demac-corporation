'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { addDaysToDateKey, arubaDateKey, arubaTimeKey, formatArubaDateKey } from '@/lib/aruba-date';
import {
  addFieldReportFinding,
  addFieldReportMeasurement,
  addFieldReportPhotoEvidence,
  addFieldReportVoiceEvidence,
  attachExistingFieldAsset,
  createAdditionalFieldIntervention,
  createPlannedFieldIntervention,
  getFieldJob,
  getFieldSchedule,
  prepareFieldVisit,
  recordAdditionalFieldInterventionDecision,
  recordFieldCustomerAcknowledgement,
  registerOnSiteFieldEquipment,
  setFieldReportChecklistItem,
  setFieldReportFreeText,
  transitionFieldIntervention,
  transitionFieldVisit,
  type FieldActiveVisitTransition,
  type FieldAdditionalWorkDecision,
  type FieldExecutionJobDetail,
  type FieldInterventionExecutionTarget,
  type FieldScheduleJob,
  type FieldTechnicianScopeChangeOrigin,
  type FieldVisitStatus,
} from '@/lib/field-authority';
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
import { PlannedInterventionControls } from './planned-intervention-controls';
import {
  VoiceNoteReportControls,
  type ReportVoiceNoteInput,
} from './voice-note-report-controls';
import styles from './technician-field-home.module.css';

type RangeKey = 'today' | 'tomorrow' | 'week';

type PlannedInterventionInput = {
  visitAssetId: string;
  plannedWorkLineId: string;
  serviceCatalogItemId: string;
};

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

const COMPLETED_WORK_ORDER_STATUSES = new Set(['Completada']);
const ACTIVE_VISIT_STATUSES = new Set<FieldVisitStatus>(['en_route', 'on_site', 'in_progress']);
const SCHEDULE_REVALIDATE_MS = 60_000;
const ACTIVE_TRANSITION_LABELS: Record<FieldActiveVisitTransition, string> = {
  en_route: 'En camino',
  on_site: 'Llegué',
  in_progress: 'Iniciar trabajo',
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

function jobCompleted(job: FieldScheduleJob) {
  return job.fieldVisit?.status === 'completed' || COMPLETED_WORK_ORDER_STATUSES.has(job.status);
}

function jobInProgress(job: FieldScheduleJob) {
  return job.fieldVisit ? ACTIVE_VISIT_STATUSES.has(job.fieldVisit.status) : false;
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

function JobActions({ job, onOpen }: { job: FieldScheduleJob; onOpen: () => void }) {
  const links = contactLinks(job);
  return (
    <div className={styles.actions}>
      <button className={`${styles.action} ${styles.primary}`} type="button" onClick={onOpen}>Abrir</button>
      {links.map ? <a className={styles.action} href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
      {links.call ? <a className={styles.action} href={links.call}>Llamar</a> : null}
      {links.whatsapp ? <a className={styles.action} href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
    </div>
  );
}

function JobCard({ job, onOpen }: { job: FieldScheduleJob; onOpen: () => void }) {
  return (
    <article className={styles.jobCard}>
      <div className={styles.time}>{job.time || '—'}<small>{job.endTime ? `hasta ${job.endTime}` : job.status}</small></div>
      <div className={styles.jobMain}>
        <strong>{job.customerName}</strong>
        <div className={styles.address}>{job.propertyName ? `${job.propertyName} · ` : ''}{job.address || 'Dirección no disponible'}</div>
        <div className={styles.work}>{workSummary(job)}</div>
        <div className={styles.badges}>
          <span className={`${styles.badge} ${styles.badgeBrand}`}>Campo: {visitStatusLabel(job.fieldVisit?.status)}</span>
          <span className={styles.badge}>Programación: {job.status}</span>
          <span className={styles.badge}>{job.vanId || 'Sin van'}</span>
          <span className={styles.badge}>{roleLabel(job.responsibility)}</span>
          <span className={styles.badge}>{assignmentLabel(job.assignmentSource)}</span>
          <span className={styles.badge}>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C estimado` : 'Cantidad por confirmar'}</span>
        </div>
      </div>
      <JobActions job={job} onOpen={onOpen} />
    </article>
  );
}

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
  transitioning,
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
  onTransition,
  onAttachAsset,
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
  transitioning: FieldActiveVisitTransition | null;
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
  onTransition: (target: FieldActiveVisitTransition) => void;
  onAttachAsset: (assetId: string) => void;
  onRegisterEquipment: (input: EquipmentRegistrationInput) => Promise<boolean>;
  onCreatePlannedIntervention: (input: PlannedInterventionInput) => void;
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
      ? ['en_route']
      : [];
  const attachedAssetIds = new Set(job.visitAssets.map((visitAsset) => visitAsset.assetId));
  const knownEquipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const mutationBusy = transitioning !== null
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
    || savingCustomerAcknowledgementKey !== null;

  return (
    <div className={styles.shell}>
      <div className={styles.detailHeader}>
        <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
        <div className={styles.detailTitle}>
          <h1>{job.customerName}</h1>
          <p>{job.time || 'Sin hora'} · Campo: {visitStatusLabel(job.fieldVisit?.status)} · {job.workOrderId}</p>
        </div>
      </div>

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
            {availableTransitions.map((target) => (
              <button
                className={`${styles.action} ${styles.primary}`}
                disabled={mutationBusy}
                key={target}
                onClick={() => onTransition(target)}
                type="button"
              >
                {transitioning === target ? 'Procesando…' : ACTIVE_TRANSITION_LABELS[target]}
              </button>
            ))}
          </div>
        ) : <p className={styles.helper}>No hay otra transición activa disponible para esta visita en este slice.</p>}
        {transitionError ? <div className={styles.mutationError}>{transitionError}</div> : null}
      </section>

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
                    <strong>{progress.linkedActualQuantity} vinculada(s) · {progress.remainingQuantity} restante(s) de {progress.plannedQuantity}</strong>
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

export function TechnicianFieldHome() {
  const { principal } = useAuth();
  const [clockNow, setClockNow] = useState(() => new Date());
  const [jobs, setJobs] = useState<FieldScheduleJob[]>([]);
  const [jobsOwnerUserId, setJobsOwnerUserId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('today');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FieldExecutionJobDetail | null>(null);
  const [detailOwnerUserId, setDetailOwnerUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<FieldActiveVisitTransition | null>(null);
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
  const [reportPhotoError, setReportPhotoError] = useState<string | null>(null);
  const [reportMeasurementError, setReportMeasurementError] = useState<string | null>(null);
  const [reportFindingError, setReportFindingError] = useState<string | null>(null);
  const [reportChecklistError, setReportChecklistError] = useState<string | null>(null);
  const [reportFreeTextError, setReportFreeTextError] = useState<string | null>(null);
  const [reportVoiceNoteError, setReportVoiceNoteError] = useState<string | null>(null);
  const [customerAcknowledgementError, setCustomerAcknowledgementError] = useState<string | null>(null);
  const scheduleRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const mutationLockRef = useRef<number | null>(null);
  const equipmentRegistrationRequestRef = useRef<string | null>(null);
  const reportPhotoRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportMeasurementRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportFindingRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportChecklistRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportFreeTextRequestRef = useRef<ReportMutationRetry | null>(null);
  const reportVoiceNoteRequestRef = useRef<ReportMutationRetry | null>(null);
  const customerAcknowledgementRequestRef = useRef<ReportMutationRetry | null>(null);
  const selectedWorkOrderRef = useRef<string | null>(null);

  const today = arubaDateKey(clockNow);
  const nowTime = arubaTimeKey(clockNow);
  const tomorrow = addDaysToDateKey(today, 1);
  const weekEnd = addDaysToDateKey(today, 6);
  const principalFieldIdentityKey = `${principal.userId}|${principal.role}|${principal.staffId ?? ''}|${principal.vanId ?? ''}`;

  const closeJob = useCallback(() => {
    detailRequestRef.current += 1;
    mutationRequestRef.current += 1;
    mutationLockRef.current = null;
    equipmentRegistrationRequestRef.current = null;
    reportPhotoRequestRef.current = null;
    reportMeasurementRequestRef.current = null;
    reportFindingRequestRef.current = null;
    reportChecklistRequestRef.current = null;
    reportFreeTextRequestRef.current = null;
    reportVoiceNoteRequestRef.current = null;
    customerAcknowledgementRequestRef.current = null;
    selectedWorkOrderRef.current = null;
    setSelectedWorkOrderId(null);
    setSelectedOwnerUserId(null);
    setDetail(null);
    setDetailOwnerUserId(null);
    setDetailError(null);
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
    setReportPhotoError(null);
    setReportMeasurementError(null);
    setReportFindingError(null);
    setReportChecklistError(null);
    setReportFreeTextError(null);
    setReportVoiceNoteError(null);
    setCustomerAcknowledgementError(null);
  }, []);

  const loadDetail = useCallback(async (workOrderId: string, background = false) => {
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
    } catch (loadError) {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailError(loadError instanceof Error ? loadError.message : 'No se pudo abrir el trabajo.');
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [principalFieldIdentityKey]);

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
      const response = await getFieldSchedule(today, weekEnd);
      if (requestId !== scheduleRequestRef.current) return;
      setJobs(response.jobs);
      setJobsOwnerUserId(requestPrincipalKey);

      const selectedId = selectedWorkOrderRef.current;
      if (selectedId) {
        if (response.jobs.some((job) => job.workOrderId === selectedId)) {
          void loadDetail(selectedId, true);
        } else {
          closeJob();
        }
      }
    } catch (loadError) {
      if (requestId !== scheduleRequestRef.current) return;
      setJobs([]);
      setJobsOwnerUserId(null);
      closeJob();
      setScheduleError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el itinerario del técnico.');
    } finally {
      if (requestId === scheduleRequestRef.current) setLoading(false);
    }
  }, [closeJob, loadDetail, principalFieldIdentityKey, today, weekEnd]);

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
  }, []);

  const runVisitTransition = useCallback(async (target: FieldActiveVisitTransition) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail) return;

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setTransitioning(target);
    clearMutationErrors();
    try {
      let visit = currentDetail.fieldVisit;
      if (!visit) {
        if (!currentDetail.canPrepareVisit || target !== 'en_route') {
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
        clientRequestId(`transition-${target}`, workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;

      setDetail((current) => current?.workOrderId === workOrderId
        ? { ...current, fieldVisit: transitioned.visit, canPrepareVisit: false }
        : current);
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

  const runAttachAsset = useCallback(async (assetId: string) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setAssetError('La visita todavía no está disponible para confirmar equipos en sitio.');
      return;
    }
    if (!currentDetail.canAddExistingAsset) {
      setAssetError('Field Authority no autoriza agregar equipos en el estado o asignación actual.');
      return;
    }
    if (currentDetail.visitAssets.some((visitAsset) => visitAsset.assetId === assetId)) return;

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setAttachingAssetId(assetId);
    clearMutationErrors();
    try {
      await attachExistingFieldAsset(
        currentDetail.fieldVisit.id,
        assetId,
        clientRequestId('attach-asset', workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setAssetError(mutationError instanceof Error ? mutationError.message : 'No se pudo agregar el A/C a esta visita.');
      void loadDetail(workOrderId, true);
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

  const runCreatePlannedIntervention = useCallback(async (input: PlannedInterventionInput) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setInterventionError('La visita todavía no está disponible para vincular trabajo a un A/C.');
      return;
    }
    if (!currentDetail.canAddPlannedIntervention) {
      setInterventionError('Field Authority no autoriza vincular trabajo planificado en el estado o asignación actual.');
      return;
    }

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setCreatingInterventionVisitAssetId(input.visitAssetId);
    clearMutationErrors();
    try {
      await createPlannedFieldIntervention(
        currentDetail.fieldVisit.id,
        input.visitAssetId,
        input.plannedWorkLineId,
        input.serviceCatalogItemId,
        clientRequestId('planned-intervention', workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setInterventionError(mutationError instanceof Error ? mutationError.message : 'No se pudo vincular el trabajo planificado al A/C.');
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

  useEffect(() => {
    void loadSchedule();
    return () => { scheduleRequestRef.current += 1; };
  }, [loadSchedule]);

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
    if (!selectedWorkOrderId || selectedOwnerUserId !== principalFieldIdentityKey) {
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    void loadDetail(selectedWorkOrderId);
    return () => { detailRequestRef.current += 1; };
  }, [loadDetail, principalFieldIdentityKey, selectedOwnerUserId, selectedWorkOrderId]);

  const authorizedJobs = jobsOwnerUserId === principalFieldIdentityKey ? jobs : [];
  const todayJobs = useMemo(() => authorizedJobs.filter((job) => job.date === today), [authorizedJobs, today]);
  const summary = useMemo(() => {
    const completed = todayJobs.filter(jobCompleted).length;
    const inProgress = todayJobs.filter(jobInProgress).length;
    return { scheduled: todayJobs.length, completed, inProgress, remaining: Math.max(0, todayJobs.length - completed) };
  }, [todayJobs]);

  const visibleJobs = useMemo(() => {
    if (range === 'today') return authorizedJobs.filter((job) => job.date === today);
    if (range === 'tomorrow') return authorizedJobs.filter((job) => job.date === tomorrow);
    return authorizedJobs;
  }, [authorizedJobs, range, today, tomorrow]);

  const nextJob = useMemo(() => {
    const open = todayJobs.filter((job) => !jobCompleted(job));
    const active = open.find(jobInProgress);
    if (active) return active;
    return open.find((job) => job.time && job.time >= nowTime) ?? open[0] ?? null;
  }, [nowTime, todayJobs]);

  const openJob = (workOrderId: string) => {
    selectedWorkOrderRef.current = workOrderId;
    setSelectedOwnerUserId(principalFieldIdentityKey);
    setSelectedWorkOrderId(workOrderId);
  };

  if (selectedWorkOrderId && selectedOwnerUserId === principalFieldIdentityKey) {
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
        onTransition={(target) => void runVisitTransition(target)}
        onAttachAsset={(assetId) => void runAttachAsset(assetId)}
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
        onBack={closeJob}
      />
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div><div className={styles.eyebrow}>DEMAC · Trabajo de campo</div><h1>Mi ruta de trabajo</h1></div>
        <div className={styles.identity}>{principal.displayName}{principal.staffId ? ` · ${principal.staffId}` : ''}</div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Período del itinerario">
        <button className={`${styles.tab} ${range === 'today' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('today')}>Hoy</button>
        <button className={`${styles.tab} ${range === 'tomorrow' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('tomorrow')}>Mañana</button>
        <button className={`${styles.tab} ${range === 'week' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('week')}>Semana</button>
      </div>

      <section className={styles.summary} aria-label="Resumen de hoy">
        <div className={styles.metric}><strong>{summary.scheduled}</strong><span>Programados hoy</span></div>
        <div className={styles.metric}><strong>{summary.completed}</strong><span>Completados</span></div>
        <div className={styles.metric}><strong>{summary.inProgress}</strong><span>En curso</span></div>
        <div className={styles.metric}><strong>{summary.remaining}</strong><span>Restantes</span></div>
      </section>

      {scheduleError ? <section className={styles.panel}><div className={styles.error}>{scheduleError}<div style={{ marginTop: 12 }}><button className={styles.action} type="button" onClick={() => void loadSchedule()}>Reintentar</button></div></div></section> : null}

      {range === 'today' ? <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Próximo trabajo</h2><span>{formatArubaDateKey(today, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
        {loading ? <div className={styles.loading}>Cargando ruta asignada…</div> : nextJob ? <div className={styles.next}><JobCard job={nextJob} onOpen={() => openJob(nextJob.workOrderId)} /></div> : <div className={styles.empty}>No quedan trabajos activos asignados para hoy.</div>}
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{range === 'today' ? 'Hoy' : range === 'tomorrow' ? 'Mañana' : 'Próximos 7 días'}</h2>
          <span>{loading ? 'Cargando…' : `${visibleJobs.length} trabajo${visibleJobs.length === 1 ? '' : 's'}`}</span>
        </div>
        {loading ? <div className={styles.loading}>Cargando itinerario autorizado…</div> : visibleJobs.length ? visibleJobs.map((job) => <JobCard key={job.workOrderId} job={job} onOpen={() => openJob(job.workOrderId)} />) : <div className={styles.empty}>No hay trabajos asignados en este período.</div>}
      </section>
    </div>
  );
}
