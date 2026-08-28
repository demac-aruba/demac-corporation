import { firebaseClientConfig } from './firebase/client-config';
import { loadFirebaseWebSession, requireFirebaseWebSession, type FirebaseWebSession } from './firebase/session';
import {
  FieldOfflineQueuedError,
  cacheFieldRead,
  discardBlockedFieldMutation,
  enqueueFieldMutation,
  flushFieldOutbox,
  getFieldOutboxSummary,
  isGovernedFieldMutation,
  readCachedFieldRead,
  removeQueuedFieldMutation,
  type FieldOutboxRecord,
  type FieldOutboxSummary,
} from './field-offline';
import {
  parseFieldAttachVisitAssetResponse,
  parseFieldPrepareVisitResponse,
  parseFieldScheduleResponse,
  parseFieldTransitionVisitResponse,
  type FieldActiveVisitTransition,
} from './field-authority-contract';
import {
  parseFieldCreateAdditionalInterventionResponse,
  parseFieldCreatePlannedInterventionResponse,
  parseFieldTransitionInterventionResponse,
  type FieldInterventionExecutionTarget,
  type FieldTechnicianScopeChangeOrigin,
} from './field-intervention-contract';
import {
  parseFieldRecordAdditionalWorkDecisionResponse,
  type FieldAdditionalWorkDecision,
} from './field-approval-contract';
import {
  parseFieldAddReportMeasurementResponse,
  parseFieldAddReportPhotoEvidenceResponse,
  type FieldMeasurementMoment,
} from './field-report-contract';
import { parseFieldAddReportFindingResponse } from './field-finding-contract';
import { parseFieldSetReportChecklistItemResponse } from './field-checklist-contract';
import { parseFieldSetReportFreeTextResponse } from './field-free-text-contract';
import { parseFieldRecordCustomerAcknowledgementResponse } from './field-customer-acknowledgement-contract';
import { parseFieldAddReportVoiceNoteResponse } from './field-voice-note-contract';
import {
  parseFieldRecordPlannedWorkDispositionResponse,
  type FieldPlannedWorkDispositionReason,
} from './field-planned-work-disposition-contract';
import { parseFieldRegisterVisitAssetResponse } from './field-equipment-registration-contract';
import {
  parseFieldCreateSaleLineResponse,
  parseFieldDecideSaleLineResponse,
  parseFieldTransitionSaleLineResponse,
  type FieldSaleDecision,
  type FieldSaleExecutionTarget,
} from './field-sale-contract';
import {
  parseFieldDecideOfficeReviewResponse,
  parseFieldOfficeReviewQueueResponse,
  parseFieldSubmitOfficeReviewResponse,
  type FieldOfficeReviewDecision,
} from './field-office-review-contract';
import { parseFieldHistoryJobResponse } from './field-history-contract';

export { fieldActionAllowed } from './field-authorization';
export type {
  FieldActiveVisitTransition,
  FieldAllowedAction,
  FieldAssignmentSource,
  FieldAttachVisitAssetResponse,
  FieldJobDetail,
  FieldKnownEquipment,
  FieldPlannedWork,
  FieldPreparedVisit,
  FieldPrepareSource,
  FieldPrepareVisitResponse,
  FieldResponsibility,
  FieldScheduleJob,
  FieldTransitionVisitResponse,
  FieldVisitAsset,
  FieldVisitAssetSource,
  FieldVisitAssetStatus,
  FieldVisitState,
  FieldVisitStatus,
} from './field-authority-contract';
export type {
  FieldAvailableService,
  FieldCreateAdditionalInterventionResponse,
  FieldCreatePlannedInterventionResponse,
  FieldInterventionExecutionOption,
  FieldInterventionExecutionTarget,
  FieldPlannedInterventionOption,
  FieldPlannedWorkProgress,
  FieldPriceSnapshot,
  FieldScopeChange,
  FieldScopeChangeOrigin,
  FieldTechnicianScopeChangeOrigin,
  FieldTransitionInterventionResponse,
  FieldWorkIntervention,
  FieldWorkInterventionOrigin,
  FieldWorkInterventionRequester,
  FieldWorkInterventionStatus,
} from './field-intervention-contract';
export type {
  FieldAdditionalWorkDecision,
  FieldApproval,
  FieldApprovalMethod,
  FieldApprovalReference,
  FieldApprovalReferenceType,
  FieldApprovalStatus,
  FieldRecordAdditionalWorkDecisionResponse,
} from './field-approval-contract';
export type {
  FieldAddReportMeasurementResponse,
  FieldAddReportPhotoEvidenceResponse,
  FieldInterventionReport,
  FieldMeasurementMoment,
  FieldReportJobDetail,
  FieldReportMeasurement,
  FieldReportMeasurementOption,
  FieldReportPhotoEvidence,
  FieldReportPhotoOption,
  FieldReportSection,
  FieldReportSectionOption,
  FieldReportSectionStatus,
  FieldReportSectionType,
  FieldReportTemplateSnapshot,
} from './field-report-contract';
export type {
  FieldAddReportFindingResponse,
  FieldFindingInterventionReport,
  FieldFindingJobDetail,
  FieldReportFinding,
  FieldReportFindingOption,
} from './field-finding-contract';
export type {
  FieldChecklistInterventionReport,
  FieldChecklistJobDetail,
  FieldChecklistReportSection,
  FieldChecklistReportTemplateSnapshot,
  FieldReportChecklistItem,
  FieldReportChecklistOption,
  FieldReportChecklistResponse,
  FieldSetReportChecklistItemResponse,
} from './field-checklist-contract';
export type {
  FieldFreeTextInterventionReport,
  FieldFreeTextJobDetail,
  FieldReportFreeTextOption,
  FieldReportFreeTextResponse,
  FieldSetReportFreeTextResponse,
} from './field-free-text-contract';
export type {
  FieldCustomerAcknowledgement,
  FieldCustomerAcknowledgementInterventionReport,
  FieldCustomerAcknowledgementJobDetail,
  FieldCustomerAcknowledgementMethod,
  FieldCustomerAcknowledgementOption,
  FieldRecordCustomerAcknowledgementResponse,
} from './field-customer-acknowledgement-contract';
export type {
  FieldAddReportVoiceNoteResponse,
  FieldReportVoiceNoteEvidence,
  FieldReportVoiceNoteOption,
  FieldVoiceNoteInterventionReport,
  FieldVoiceNoteJobDetail,
} from './field-voice-note-contract';
export type {
  FieldProfessionalReportInterventionReport,
  FieldProfessionalReportMissingSection,
  FieldProfessionalReportPreview,
  FieldProfessionalReportStatus,
  FieldReportCompletion,
  FieldRequiredReportSectionBlocker,
} from './field-professional-report-contract';
export type {
  FieldDispositionPlannedWorkProgress,
  FieldPlannedWorkDisposition,
  FieldPlannedWorkDispositionJobDetail,
  FieldPlannedWorkDispositionOption,
  FieldPlannedWorkDispositionReason,
  FieldRecordPlannedWorkDispositionResponse,
} from './field-planned-work-disposition-contract';
export type {
  FieldCreateSaleLineResponse,
  FieldDecideSaleLineResponse,
  FieldSaleCatalogOption,
  FieldSaleDecision,
  FieldSaleExecutionTarget,
  FieldSaleJobDetail,
  FieldSaleLine,
  FieldSaleLineStatus,
  FieldSaleTransitionOption,
  FieldTransitionSaleLineResponse,
} from './field-sale-contract';
export type {
  FieldDecideOfficeReviewResponse,
  FieldBillingCandidate,
  FieldInventoryHandoff,
  FieldOfficeReview,
  FieldOfficeReviewBlocker,
  FieldOfficeReviewDecision,
  FieldOfficeReviewJobDetail,
  FieldOfficeReviewQueueItem,
  FieldOfficeReviewQueueResponse,
  FieldOfficeReviewRevision,
  FieldOfficeReviewSnapshot,
  FieldOfficeReviewStatus,
  FieldOfficeReviewSubmission,
  FieldOfficeReviewSubmissionStatus,
  FieldSubmitOfficeReviewResponse,
} from './field-office-review-contract';
export type {
  FieldCustomerHistory,
  FieldCustomerHistoryFinding,
  FieldCustomerHistoryIntervention,
  FieldCustomerHistorySaleLine,
  FieldCustomerHistoryVisit,
  FieldEquipmentHistory,
  FieldHistoryJobDetail,
  FieldHistoryJobDetail as FieldExecutionJobDetail,
} from './field-history-contract';
export type {
  FieldEquipmentRegistrationEvidence,
  FieldEquipmentRegistrationEvidenceKind,
  FieldRegisteredEquipment,
  FieldRegisterVisitAssetResponse,
} from './field-equipment-registration-contract';

type FieldApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
export type FieldOfflineReadMetadata = { capturedAt: string };
export type { FieldOutboxSummary };

class FieldAuthorityRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'FieldAuthorityRequestError';
  }
}

export type RegisterOnSiteFieldEquipmentInput = {
  visitId: string;
  requestId: string;
  locationLabel: string;
  systemType: string;
  brand: string;
  btu: number;
  refrigerant: string;
  voltage: string;
  qrCode?: string;
  evidencePaths: {
    equipment_reference: string;
    indoor_nameplate: string;
    outdoor_nameplate: string;
  };
};

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/fieldOperationsAuthority`;
}

function asApiErrorPayload(value: unknown): FieldApiError {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as FieldApiError
    : {};
}

function abortError() {
  const error = new Error('Field Operations request timed out.');
  error.name = 'AbortError';
  return error;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function retryableRequestError(error: unknown) {
  return error instanceof FieldAuthorityRequestError && error.retryable;
}

function browserTransportFailure(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TypeError');
}

async function performFieldAuthorityRequest(
  session: FirebaseWebSession,
  action: string,
  data: Record<string, unknown>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiError = asApiErrorPayload(payload);
      const code = apiError.error?.code ? ` (${apiError.error.code})` : '';
      throw new FieldAuthorityRequestError(
        `${apiError.error?.message ?? 'Field Operations could not complete the request.'}${code}`,
        response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500,
        apiError.error?.code,
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof FieldAuthorityRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FieldAuthorityRequestError('Field Operations took too long to respond. Refresh and try again.', true, 'request_timeout');
    }
    if (error instanceof Error && error.name === 'TypeError') {
      throw new FieldAuthorityRequestError('Field Operations could not be reached. Check the connection and try again.', true, 'network_unavailable');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function callFieldAuthority(action: string, data: Record<string, unknown>, timeoutMs = 12_000): Promise<unknown> {
  const mutation = isGovernedFieldMutation(action);
  const priorSession = loadFirebaseWebSession();
  if (mutation && typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!priorSession?.uid) throw new Error('Firebase authentication is required before saving an offline Field operation.');
    const queued = await enqueueFieldMutation(priorSession.uid, action, data);
    throw new FieldOfflineQueuedError(queued.id);
  }
  let session: FirebaseWebSession | null = null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      session = await abortable(requireFirebaseWebSession(), controller.signal);
    } finally {
      window.clearTimeout(timer);
    }
    const payload = await performFieldAuthorityRequest(session, action, data, timeoutMs);
    if (mutation && typeof data.requestId === 'string') {
      await removeQueuedFieldMutation(session.uid, data.requestId).catch(() => undefined);
    }
    return payload;
  } catch (error) {
    if (mutation && (retryableRequestError(error) || browserTransportFailure(error))) {
      const ownerUserId = session?.uid || priorSession?.uid;
      if (!ownerUserId) throw new Error('The Field request failed before an authenticated offline operation could be saved.');
      const queued = await enqueueFieldMutation(ownerUserId, action, data);
      throw new FieldOfflineQueuedError(queued.id);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FieldAuthorityRequestError('Field Operations took too long to respond. Refresh and try again.', true, 'request_timeout');
    }
    if (error instanceof Error && error.name === 'TypeError') {
      throw new FieldAuthorityRequestError('Field Operations could not be reached. Check the connection and try again.', true, 'network_unavailable');
    }
    throw error;
  }
}

async function cacheLiveFieldRead(cacheKey: string, value: unknown) {
  const session = loadFirebaseWebSession();
  if (session?.uid) await cacheFieldRead(session.uid, cacheKey, value).catch(() => undefined);
}

async function cachedFieldRead(cacheKey: string, ownerUserId?: string) {
  const owner = ownerUserId || loadFirebaseWebSession()?.uid;
  return owner ? readCachedFieldRead(owner, cacheKey).catch(() => null) : null;
}

export async function getOfflineFieldOutboxSummary(ownerUserId: string): Promise<FieldOutboxSummary> {
  return getFieldOutboxSummary(ownerUserId);
}

export async function discardOfflineFieldConflict(ownerUserId: string, id: string) {
  return discardBlockedFieldMutation(ownerUserId, id);
}

export async function syncOfflineFieldOutbox() {
  const session = await requireFirebaseWebSession();
  return flushFieldOutbox(session.uid, async (record: FieldOutboxRecord) => {
    try {
      await performFieldAuthorityRequest(session, record.action, record.data, 20_000);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        retryable: retryableRequestError(error),
        code: error instanceof FieldAuthorityRequestError ? error.code : undefined,
        message: error instanceof Error ? error.message : 'Field outbox synchronization failed.',
      };
    }
  });
}

export async function getFieldSchedule(startDate: string, endDate = startDate) {
  const cacheKey = `schedule:${startDate}:${endDate}`;
  const cacheOwner = loadFirebaseWebSession()?.uid;
  try {
    const parsed = parseFieldScheduleResponse(await callFieldAuthority('get_schedule', { startDate, endDate }));
    await cacheLiveFieldRead(cacheKey, parsed);
    return { ...parsed, offlineCache: undefined as FieldOfflineReadMetadata | undefined };
  } catch (error) {
    if (!retryableRequestError(error)) throw error;
    const cached = await cachedFieldRead(cacheKey, cacheOwner);
    if (!cached) throw error;
    const parsed = parseFieldScheduleResponse(cached.value);
    return { ...parsed, offlineCache: { capturedAt: cached.capturedAt } };
  }
}

export async function getFieldJob(workOrderId: string) {
  const cacheKey = `job:${workOrderId}`;
  const cacheOwner = loadFirebaseWebSession()?.uid;
  try {
    const parsed = parseFieldHistoryJobResponse(await callFieldAuthority('get_job', { workOrderId }));
    await cacheLiveFieldRead(cacheKey, parsed);
    return { ...parsed, offlineCache: undefined as FieldOfflineReadMetadata | undefined };
  } catch (error) {
    if (!retryableRequestError(error)) throw error;
    const cached = await cachedFieldRead(cacheKey, cacheOwner);
    if (!cached) throw error;
    const parsed = parseFieldHistoryJobResponse(cached.value);
    return { ...parsed, offlineCache: { capturedAt: cached.capturedAt } };
  }
}

export async function getFieldOfficeReviewQueue() {
  return parseFieldOfficeReviewQueueResponse(await callFieldAuthority('get_office_review_queue', {}));
}

export async function submitFieldVisitForOfficeReview(
  visitId: string,
  expectedVersion: number,
  requestId: string,
  correctionNote = '',
) {
  return parseFieldSubmitOfficeReviewResponse(await callFieldAuthority(
    'submit_visit_for_office_review',
    { visitId, expectedVersion, requestId, correctionNote },
  ));
}

export async function decideFieldOfficeReview(
  reviewId: string,
  decision: FieldOfficeReviewDecision,
  note: string,
  expectedVersion: number,
  requestId: string,
) {
  return parseFieldDecideOfficeReviewResponse(await callFieldAuthority(
    'decide_office_review',
    { reviewId, decision, note, expectedVersion, requestId },
  ));
}

export async function createFieldSaleLine(input: {
  visitId: string;
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unit?: string;
  interventionId?: string;
  assetId?: string;
  notes?: string;
  requestId: string;
}) {
  return parseFieldCreateSaleLineResponse(await callFieldAuthority('create_field_sale_line', input));
}

export async function decideFieldSaleLine(
  visitId: string,
  saleLineId: string,
  decision: FieldSaleDecision,
  receiverName: string,
  note: string,
  expectedVersion: number,
  requestId: string,
) {
  return parseFieldDecideSaleLineResponse(await callFieldAuthority('decide_field_sale_line', {
    visitId, saleLineId, decision, receiverName, note, expectedVersion, requestId,
  }));
}

export async function transitionFieldSaleLine(
  visitId: string,
  saleLineId: string,
  to: FieldSaleExecutionTarget,
  note: string,
  expectedVersion: number,
  requestId: string,
) {
  return parseFieldTransitionSaleLineResponse(await callFieldAuthority('transition_field_sale_line', {
    visitId, saleLineId, to, note, expectedVersion, requestId,
  }));
}

export async function prepareFieldVisit(workOrderId: string, requestId: string) {
  return parseFieldPrepareVisitResponse(await callFieldAuthority('prepare_visit', { workOrderId, requestId }));
}

export async function createReturnFieldVisit(previousVisitId: string, expectedVersion: number, requestId: string) {
  return parseFieldTransitionVisitResponse(await callFieldAuthority('create_return_visit', {
    previousVisitId, expectedVersion, requestId,
  }));
}

export async function transitionFieldVisit(
  visitId: string,
  to: FieldActiveVisitTransition,
  expectedVersion: number,
  requestId: string,
  pendingReason = '',
  pendingAction = '',
  noAccessReason = '',
  cancellationReason = '',
  secondVisitReason = '',
) {
  return parseFieldTransitionVisitResponse(await callFieldAuthority('transition_visit', {
    visitId, to, expectedVersion, requestId, pendingReason, pendingAction, noAccessReason, cancellationReason, secondVisitReason,
  }));
}

export async function attachExistingFieldAsset(visitId: string, assetId: string, requestId: string) {
  return parseFieldAttachVisitAssetResponse(await callFieldAuthority('attach_visit_asset', { visitId, assetId, requestId }));
}

export async function attachFieldAssetByQr(visitId: string, assetId: string, qrCode: string, requestId: string) {
  return parseFieldAttachVisitAssetResponse(await callFieldAuthority('attach_visit_asset_by_qr', {
    visitId, assetId, qrCode, requestId,
  }));
}

export async function registerOnSiteFieldEquipment(input: RegisterOnSiteFieldEquipmentInput) {
  return parseFieldRegisterVisitAssetResponse(await callFieldAuthority('register_visit_asset', {
    visitId: input.visitId, requestId: input.requestId, locationLabel: input.locationLabel, systemType: input.systemType,
    brand: input.brand, btu: input.btu, refrigerant: input.refrigerant, voltage: input.voltage, qrCode: input.qrCode ?? '', evidencePaths: input.evidencePaths,
  }, 20_000));
}

export async function createPlannedFieldIntervention(visitId: string, visitAssetId: string, plannedWorkLineId: string, serviceCatalogItemId: string, requestId: string) {
  return parseFieldCreatePlannedInterventionResponse(await callFieldAuthority('create_planned_intervention', { visitId, visitAssetId, plannedWorkLineId, serviceCatalogItemId, requestId }));
}

export async function recordFieldPlannedWorkDisposition(
  visitId: string,
  plannedWorkLineId: string,
  quantity: number,
  reasonCode: FieldPlannedWorkDispositionReason,
  note: string,
  requestId: string,
) {
  return parseFieldRecordPlannedWorkDispositionResponse(await callFieldAuthority('record_planned_work_disposition', {
    visitId, plannedWorkLineId, quantity, reasonCode, note, requestId,
  }));
}

export async function createAdditionalFieldIntervention(visitId: string, visitAssetId: string, serviceCatalogItemId: string, origin: FieldTechnicianScopeChangeOrigin, reason: string, requestId: string) {
  return parseFieldCreateAdditionalInterventionResponse(await callFieldAuthority('create_additional_intervention', { visitId, visitAssetId, serviceCatalogItemId, origin, reason, requestId }));
}

export async function recordAdditionalFieldInterventionDecision(visitId: string, interventionId: string, decision: FieldAdditionalWorkDecision, receiverName: string, note: string, requestId: string) {
  return parseFieldRecordAdditionalWorkDecisionResponse(await callFieldAuthority('record_additional_intervention_decision', { visitId, interventionId, decision, receiverName, note, requestId }));
}

export async function transitionFieldIntervention(visitId: string, interventionId: string, to: FieldInterventionExecutionTarget, expectedVersion: number, note: string, requestId: string) {
  return parseFieldTransitionInterventionResponse(await callFieldAuthority('transition_intervention', { visitId, interventionId, to, expectedVersion, note, requestId }));
}

export async function addFieldReportPhotoEvidence(visitId: string, interventionId: string, sectionId: string, storagePath: string, caption: string, requestId: string) {
  return parseFieldAddReportPhotoEvidenceResponse(await callFieldAuthority('add_report_photo_evidence', { visitId, interventionId, sectionId, storagePath, caption, requestId }, 20_000));
}

export async function addFieldReportVoiceEvidence(visitId: string, interventionId: string, sectionId: string, storagePath: string, durationSeconds: number, requestId: string) {
  return parseFieldAddReportVoiceNoteResponse(await callFieldAuthority('add_report_voice_evidence', {
    visitId, interventionId, sectionId, storagePath, durationSeconds, requestId,
  }, 20_000));
}

export async function addFieldReportMeasurement(visitId: string, interventionId: string, sectionId: string, metric: string, value: number | string, unit: string, moment: FieldMeasurementMoment, requestId: string) {
  return parseFieldAddReportMeasurementResponse(await callFieldAuthority('add_report_measurement', { visitId, interventionId, sectionId, metric, value, unit, moment, requestId }));
}

export async function addFieldReportFinding(visitId: string, interventionId: string, sectionId: string, summary: string, details: string, recommendation: string, requestId: string) {
  return parseFieldAddReportFindingResponse(await callFieldAuthority('add_report_finding', { visitId, interventionId, sectionId, summary, details, recommendation, requestId }));
}

export async function setFieldReportChecklistItem(visitId: string, interventionId: string, sectionId: string, itemId: string, checked: boolean, expectedVersion: number, requestId: string) {
  return parseFieldSetReportChecklistItemResponse(await callFieldAuthority('set_report_checklist_item', { visitId, interventionId, sectionId, itemId, checked, expectedVersion, requestId }));
}

export async function setFieldReportFreeText(visitId: string, interventionId: string, sectionId: string, value: string, expectedVersion: number, requestId: string) {
  return parseFieldSetReportFreeTextResponse(await callFieldAuthority('set_report_free_text', { visitId, interventionId, sectionId, value, expectedVersion, requestId }));
}

export async function recordFieldCustomerAcknowledgement(visitId: string, interventionId: string, sectionId: string, receiverName: string, note: string, requestId: string) {
  return parseFieldRecordCustomerAcknowledgementResponse(await callFieldAuthority('record_customer_report_acknowledgement', {
    visitId, interventionId, sectionId, receiverName, note, requestId,
  }));
}
